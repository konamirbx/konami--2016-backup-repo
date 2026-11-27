# Docker setup

This Compose stack runs the existing Next.js frontend, ASP.NET website, PostgreSQL database, Redis cache, database migrations, Go asset validator, Node game-server/WebSocket endpoint, and an Nginx reverse proxy. It uses the project services and their existing pages; it does not generate replacement pages.

## Start

From this directory, run the stack with the local `.env` already provided in this workspace. On a fresh checkout, copy `.env.example` to `.env` and change the local-only secrets first. Then run:

```sh
docker compose up --build -d
```

All published host ports bind to `127.0.0.1`. Open the frontend at [http://roblox.localhost:8080](http://roblox.localhost:8080). The API/site host is [http://api.roblox.localhost:8080](http://api.roblox.localhost:8080), with the application form at `/auth/application` and admin panel at `/admin`. Services communicate over the private Compose network; the host-published ports are only for local access. Persistent database, uploaded storage, and public files use named volumes.

### macOS

Docker Desktop is supported on Intel and Apple silicon Macs. The game-server is pinned to `linux/amd64` because it runs the Windows RCC executable using 32-bit Wine. On Apple silicon, enable Docker Desktop's Rosetta support for x86/amd64 emulation if available; the renderer build and runtime may be slower than on Intel. The other services use their native container architecture.

For public website access from a Mac, configure the Cloudflare Tunnel token, public `FRONTEND_BASE_URL`, and hostname route as described in the repository README, then start with `docker compose --profile cloudflare up --build -d` instead of the local-only command. Cloudflare routes web requests to `http://proxy:80`; Docker Compose still runs the services and handles their private ports. No router port forwarding is needed for the website. This HTTP tunnel does not expose game-client connections or arbitrary TCP/UDP ports.

For local account setup, the Compose stack enables development-only application auto-approval. Applicants must still verify a supported social profile and pass hCaptcha; underage applications are rejected. The first accepted account receives ID `1`, matching `OWNER_USER_ID=1`. Set `LOCAL_AUTO_APPROVE_APPLICATIONS=false` to restore the normal account-age and reputation checks.

To inspect startup or migration errors, run `docker compose logs -f migrate website frontend proxy`. Stop the services with `docker compose down`; this keeps the named volumes. `docker compose down -v` also deletes database and uploaded data.

## Game services

The Node game-server and render WebSocket start in this stack. The checked-in `RCCService.exe` is Windows-only and runs inside the `linux/amd64` game-server container using Wine; the repository's `RCCService/` directory is mounted at `/opt/rcc/`. Rendering depends on that executable and its content files being present.

The included `.env.example` values are for local testing only. Configure real secrets, domain names, HTTPS termination, hCaptcha, and other external integrations before making the site public. This stack keeps the repository's .NET 6 and Node 18 targets; both runtime lines are out of support, so upgrade and retest them before public exposure.