<script lang="ts">
	import Main from "../components/templates/Main.svelte";
	import request from "../lib/request";
	let disabled = false;
	let assetId = "";
	let errorMessage: string | undefined;
	let successMessage: string | undefined;
	import * as rank from "../stores/rank";
	rank.promise.then(() => {
		if (!rank.is("admin")) {
			errorMessage = "You must have the administrator permission to manage re-renders.";
		}
	});
</script>

<svelte:head>
	<title>Request Asset Re-Render</title>
</svelte:head>

<Main>
	<div class="row">
		<div class="col-12">
			<h1>Request Asset Re-Render</h1>
			{#if errorMessage}
				<p class="err">{errorMessage}</p>
			{/if}
		</div>
		<div class="col-6">
			<label for="assetid">Asset ID</label>
			<input type="number" class="form-control" id="assetid" min="1" step="1" bind:value={assetId} {disabled} />
		</div>
		{#if successMessage}
			<div class="col-12 mt-3">
				<p>{successMessage}</p>
			</div>
		{/if}

		<div class="col-12 mt-4">
			<button
				class="btn btn-success"
				{disabled}
				on:click={(e) => {
					e.preventDefault();
					if (disabled) {
						return;
					}
					const parsedAssetId = Number(assetId);
					if (!Number.isSafeInteger(parsedAssetId) || parsedAssetId <= 0) {
						errorMessage = "Enter a valid asset ID.";
						successMessage = undefined;
						return;
					}

					disabled = true;
					errorMessage = undefined;
					successMessage = undefined;
					request
						.post("/asset/re-render", { assetId: parsedAssetId })
						.then(() => {
							successMessage = `Asset ${parsedAssetId} rendered successfully.`;
						})
						.catch((e) => {
							errorMessage = e.message;
						})
						.finally(() => {
							disabled = false;
						});
				}}>Submit</button
			>
		</div>
	</div>
</Main>

<style>
	p.err {
		color: red;
	}
</style>
