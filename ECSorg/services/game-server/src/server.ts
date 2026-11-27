import conf from './helpers/Config';
import CommandHandler from './controllers';
let handle = new CommandHandler();
import express = require('express');
import axiosStatic from 'axios';
import * as models from './models';
import * as HTTPExceptions from 'ts-httpexceptions';
import * as WSLib from 'ws';
import {getUploadCallbacks} from './rendering';

// WS - used for rendering
const ws = new WSLib.Server({
	port: conf.thumbnailWebsocketPort || 3040,
});
const rccContentBaseUrl = 'http://127.0.0.1';
const assetContentAvailability = new Map<string, { available: boolean; expiresAt: number }>();
const assetContentPreflight = new Map<number, { promise: Promise<void>; expiresAt: number }>();
// Express
const app = express();
app.use(express.text({ limit: '250mb' }));
app.use(express.json());

const isAssetContentAvailable = async (assetId: string, assetTypeId: number): Promise<boolean> => {
	const cacheKey = `${assetId}:${assetTypeId}`;
	const cached = assetContentAvailability.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.available;
	}

	const result = await axiosStatic.get(conf.baseUrl + '/asset', {
		params: { id: assetId, assetTypeId },
		headers: {
			'user-agent': 'Roblox/Linux',
			Requester: 'server',
			'bot-auth': conf.websiteBotAuth,
		},
		responseType: 'stream',
		validateStatus: () => true,
		timeout: 15000,
	});
	result.data.destroy();

	if (result.status !== 200 && result.status !== 400 && result.status !== 404) {
		throw new Error(`Unexpected status ${result.status} checking asset content ${assetId}`);
	}

	const available = result.status === 200;
	if (available) {
		assetContentAvailability.set(cacheKey, {
			available,
			expiresAt: Date.now() + 60 * 1000,
		});
	}
	return available;
};

const validateAssetContentReferences = async (xml: string): Promise<void> => {
	const references = [...xml.matchAll(
		/<Content name="(MeshId|TextureId|Texture|ShirtTemplate|PantsTemplate|Graphic)">\s*<url>([^<]*)<\/url>/gi,
	)];
	const contentReferences = references.flatMap(([, name, url]) => {
		const assetId = url.match(/^rbxassetid:\/\/(\d+)$/i)?.[1] ?? url.match(/[?&]id=(\d+)/i)?.[1];
		return assetId ? [{ name, assetId, assetTypeId: name === 'MeshId' ? 4 : 1 }] : [];
	});
	const assetReferences = [...new Map(contentReferences.map(reference => [
		`${reference.assetId}:${reference.assetTypeId}`,
		reference,
	] as const)).values()];
	const availability: Array<{ reference: typeof assetReferences[number]; available: boolean }> = [];
	for (const reference of assetReferences) {
		availability.push({
			reference,
			available: await isAssetContentAvailable(reference.assetId, reference.assetTypeId),
		});
	}
	const unavailableReferences = availability
		.filter(({ available }) => !available)
		.map(({ reference }) => reference);

	if (unavailableReferences.length > 0) {
		throw new Error(`Asset references unavailable mesh or texture content: ${unavailableReferences
			.map(reference => `${reference.name}=${reference.assetId}`).join(', ')}`);
	}
};

const preflightAssetContentReferences = (assetId: number): Promise<void> => {
	const cached = assetContentPreflight.get(assetId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.promise;
	}

	const pending = loadAssetContentReferences(assetId);
	assetContentPreflight.set(assetId, {
		promise: pending,
		expiresAt: Date.now() + 60 * 1000,
	});
	void pending.catch(() => {
		if (assetContentPreflight.get(assetId)?.promise === pending) {
			assetContentPreflight.delete(assetId);
		}
	});
	return pending;
};

const loadAssetContentReferences = async (assetId: number): Promise<void> => {
	const result = await axiosStatic.get(conf.baseUrl + '/asset', {
		params: { id: assetId },
		headers: {
			'user-agent': 'Roblox/Linux',
			Requester: 'server',
			'bot-auth': conf.websiteBotAuth,
		},
		responseType: 'stream',
		validateStatus: () => true,
		timeout: 15000,
	});

	if (result.status !== 200) {
		result.data.destroy();
		throw new Error(`Asset content ${assetId} is unavailable (HTTP ${result.status})`);
	}

	const chunks: Buffer[] = [];
	let bufferedBytes = 0;
	let isRobloxXml: boolean | undefined;
	try {
		for await (const chunk of result.data) {
			const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			chunks.push(data);
			bufferedBytes += data.length;

			if (isRobloxXml === undefined && bufferedBytes >= 16) {
				const prefix = Buffer.concat(chunks, bufferedBytes).subarray(0, 64).toString('utf8').trimStart();
				isRobloxXml = prefix.startsWith('<?xml') || /^<roblox(?:\s|>)/i.test(prefix);
				if (!isRobloxXml) {
					return;
				}
			}
		}

		if (isRobloxXml === undefined) {
			const prefix = Buffer.concat(chunks, bufferedBytes).subarray(0, 64).toString('utf8').trimStart();
			isRobloxXml = prefix.startsWith('<?xml') || /^<roblox(?:\s|>)/i.test(prefix);
		}
		if (isRobloxXml) {
			await validateAssetContentReferences(Buffer.concat(chunks, bufferedBytes).toString('utf8'));
		}
	} finally {
		result.data.destroy();
	}
};

app.get(['/rcc-asset', '/rcc-asset/:id', '/Asset', '/Asset/', '/asset', '/asset/'], async (req, res) => {
	const remoteAddress = req.socket.remoteAddress;
	console.log('[debug] RCC asset request', remoteAddress, req.originalUrl);
	if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1' && remoteAddress !== '::ffff:127.0.0.1' && remoteAddress !== req.socket.localAddress) {
		return res.status(403).end();
	}

	const assetId = typeof req.query.id === 'string' ? req.query.id : req.params.id;
	if (typeof assetId !== 'string' || !/^\d+$/.test(assetId) || Number(assetId) <= 0) {
		return res.status(400).end();
	}

	try {
		const result = await axiosStatic.get(conf.baseUrl + '/asset', {
			params: { id: assetId },
			headers: {
				'user-agent': 'Roblox/Linux',
				Requester: 'server',
				'bot-auth': conf.websiteBotAuth,
			},
			responseType: 'stream',
			validateStatus: () => true,
		});
		if (result.status !== 200) {
			result.data.destroy();
			return res.status(result.status).send(`Asset content ${assetId} is unavailable (HTTP ${result.status})`);
		}
		res.status(result.status);
		if (result.headers['content-type']) {
			res.setHeader('content-type', result.headers['content-type']);
		}

		const chunks: Buffer[] = [];
		let bufferedBytes = 0;
		let isRobloxXml: boolean | undefined;
		for await (const chunk of result.data) {
			const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			if (isRobloxXml === undefined) {
				chunks.push(data);
				bufferedBytes += data.length;
				if (bufferedBytes < 16) {
					continue;
				}

				const prefix = Buffer.concat(chunks, bufferedBytes).subarray(0, 64).toString('utf8').trimStart();
				isRobloxXml = result.status === 200 &&
					(prefix.startsWith('<?xml') || /^<roblox(?:\s|>)/i.test(prefix));
				if (isRobloxXml) {
					continue;
				}

				if (result.headers['content-length']) {
					res.setHeader('content-length', result.headers['content-length']);
				}
				res.write(Buffer.concat(chunks, bufferedBytes));
				chunks.length = 0;
				continue;
			}

			if (isRobloxXml) {
				chunks.push(data);
				bufferedBytes += data.length;
			} else {
				res.write(data);
			}
		}

		if (isRobloxXml) {
			const sourceXml = Buffer.concat(chunks, bufferedBytes).toString('utf8');
			await validateAssetContentReferences(sourceXml);
			const xml = sourceXml.replace(
				/https?:\/\/(?:www\.)?(?:roblox\.com|economy-simulator\.org)\/asset\/?\?id=(\d+)/gi,
				`${rccContentBaseUrl}/asset/?id=$1`
			);
			const body = Buffer.from(xml);
			res.setHeader('content-length', body.length);
			return res.end(body);
		}

		if (isRobloxXml === undefined) {
			if (result.headers['content-length']) {
				res.setHeader('content-length', result.headers['content-length']);
			}
			return res.end(Buffer.concat(chunks, bufferedBytes));
		}
		res.end();
	} catch (error) {
		console.error('[error] RCC asset proxy request failed:', error);
		if (res.headersSent) {
			res.destroy(error instanceof Error ? error : undefined);
		} else {
			res.status(502).send(error instanceof Error ? error.message : String(error));
		}
	}
});

app.use((req, res, next) => {
	console.log('[AUTH] [' + req.method +']', req.url);
	if (req.url === '/api/upload-thumbnail-v1') {
		console.log('[info] skip auth for thumbnailer');
		return next();
	}
	if (req.headers['roblox-server-authorization'] !== conf.authorization) {
		console.error('bad auth')
		return res.status(500).send('Internal server error').end();
	}
	next();
});

app.post('/api/public-method', (req, res, next) => {
	const b = req.body;
	console.log('[' + req.method + '] ' + req.url + ' - ' + b.method);
	// @ts-ignore
	const f = handle[b.method];
	if (typeof f === 'function') {
		const c = f.apply(handle, b.arguments);
		if (typeof c === 'object' && c.then) {
			(c as Promise<any>).then((result) => {
				res.status(200).json(result).end();
			}).catch(e => {
				console.error('[error] error handling method', b.method, e);
				res.status(500).json({ success: false }).end();
			})
		} else {
			res.status(200).json(c).end();
		}
	} else {
		res.status(404).json({ success: false, message: 'NotFound' }).end();
	}
});

app.post('/api/upload-thumbnail-v1', (req, res, next) => {
	console.log('[info] upload-thumbnail start');
	try {
		if (req.body) {
			const js = JSON.parse(req.body);
			if (typeof js['debug'] === 'string') {
				console.log('[debug] avatar render:', js['debug']);
			}
			if (js['accessKey'] === conf.authorization) {
				const key = js['jobId'];
				const callbacks = getUploadCallbacks()[key];
				handle.removeFromRunningJobs(key);
				if (callbacks) {
					console.log("notifying", callbacks.length, 'subscribers')
					for (const item of callbacks) {
						item(js);
					}
					delete getUploadCallbacks()[key];
					return res.status(200).send({
						success: true,
					}).end();
				} else {
					console.error('[warning] no job id callback for', key);
				}
			} else {
				console.log('bad key', js);
			}
		}
	} catch (e) {
		console.error(e);
	}
	res.status(503).send('Unavailable').end();
});

export default () => {
	// Express
	app.listen(conf.port, () => {
		console.log(`[info] express listening on port`, conf.port)
	});
	app.listen(80, () => {
		console.log('[info] RCC content proxy listening on port 80');
	});
	// Ws
	console.log('[info] ws server listening on port', (conf.thumbnailWebsocketPort || 3040));
}

const onMessage = async (data: string) => {
	let cmd = JSON.parse(data.toString()) as models.Command;
	console.log('[info] ' + cmd.command)
	// @ts-ignore
	if (typeof handle[cmd.command] !== 'function') {
		console.log('[err] sending 404 for invalidCommand: ' + cmd.command)
		return {
			status: 404,
			code: 'InvalidCommand',
			id: cmd.id,
		};
	}
	try {
		if (['GenerateThumbnailAsset', 'GenerateThumbnailTexture'].includes(cmd.command)) {
			const assetId = Number(cmd.args[0]);
			if (Number.isSafeInteger(assetId) && assetId > 0) {
				await preflightAssetContentReferences(assetId);
			}
		} else if (['GenerateThumbnail', 'GenerateThumbnailHeadshot'].includes(cmd.command)) {
			const avatar = cmd.args[0];
			if (Array.isArray(avatar?.assets)) {
				for (const asset of avatar.assets) {
					const assetId = Number(asset?.id);
					if (Number.isSafeInteger(assetId) && assetId > 0) {
						await preflightAssetContentReferences(assetId);
					}
				}
			}
		}
		// @ts-ignore
		let results = await handle[cmd.command](...cmd.args);
		return {
			status: 200,
			data: results,
			id: cmd.id,
		}
	} catch (err) {
		if (err instanceof HTTPExceptions.Exception && err! instanceof HTTPExceptions.InternalServerError) {
			return {
				status: err.status,
				code: err.message,
				errorDetails: err,
				id: cmd.id,
			}
		}
		console.error('[error] [ws handle try/catch]', err);
		return {
			status: 500,
			code: err instanceof Error ? err.message : 'InternalServerError',
			errorDetails: err,
			id: cmd.id,
		};
	}
}

ws.on('connection', (c, req) => {
	console.log('[info] new connection');
	let url = req.url;
	if (!url) {
		console.log('[info] closing bad conn due to no url')
		return c.close();
	}
	let q = url.indexOf('?');
	if (q === -1) {
		console.log('[info] closing bad conn due to no query param');
		return c.close();
	}
	let d = new URLSearchParams(url.slice(q));
	let key = d.get('key');
	if (!key) {
		console.log('[info] closing bad conn due to no key');
		return c.close();
	}
	if (key !== conf.authorization) {
		console.log('[info] closing bad conn due to non-matching key');
		return c.close();
	}
	c.on('message', async (data) => {
		onMessage(data.toString()).then(result => {
			c.send(JSON.stringify(result))
		})
	})
	c.on('close', () => {
		console.log('[info] closed connection');
	});
});