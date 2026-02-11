# LaunchClaw Spec

## Goal

Commercial-grade deployment toolkit to install and standardize OpenClaw across VPS and on-prem machines (Mac Mini/mini PC) with a reproducible template workflow.

## Core Command

```bash
./setup.sh setup --profile business --channel discord --domain bot.example.com
```

## Flow

1. Detect OS/arch
2. Install dependencies (Node.js 22+, git, nginx/certbot/ufw on Linux as required)
3. Install OpenClaw (`openclaw@<version>`)
4. Prepare service user + config/workspace dirs
5. Generate OpenClaw-compatible config
6. Install daemon with `openclaw gateway install`
7. Configure proxy/SSL/firewall (Linux)
8. Verify gateway health and status

## Supported Platforms

- Ubuntu/Debian (systemd + nginx + certbot + ufw)
- macOS (launchd via `openclaw gateway install`)

## Profiles

- `personal`: 2 concurrent, no subagents, 30m heartbeat
- `business`: 4 concurrent, no subagents, 15m heartbeat, safeguard compaction
- `developer`: 4 concurrent, 8 subagents, 15m heartbeat
- `agency`: 4 concurrent, 8 subagents, Opus model, safeguard compaction
- `minimal`: 2 concurrent, no subagents, heartbeat disabled

## Config Rules

Generated config must remain valid against modern OpenClaw schema:

- `gateway.mode = "local"`
- `gateway.port = <gateway-port>`
- `gateway.auth.mode = "token"`
- `gateway.auth.token = <generated>`
- `agents.defaults.model.primary = <model>`
- `agents.defaults.maxConcurrent = <profile value>`
- `agents.defaults.subagents.maxConcurrent = <profile value>` (only if > 0)
- `channels` as object (not array)

## CLI Surface

- `setup`
- `status`
- `--uninstall`

Important options:

- `--profile`, `--channel`, `--model`, `--name`
- `--gateway-port`
- `--openclaw-version`
- `--domain`, `--skip-proxy`, `--skip-ssl`, `--skip-firewall`
- `--env-file` (templated rollouts)
- `--yes` (non-interactive)
- `--dry-run`

## Cloud-Init

`cloud-init/template.yaml` should provision:

- Node.js + OpenClaw
- OpenClaw config using current schema
- nginx reverse proxy to gateway port `18789`
- TLS via certbot (optional)
- systemd service start + health verification

## Out of Scope

- Multi-tenant SaaS dashboard
- Billing/subscriptions
- Managed provider API integration (Hetzner/Cloudflare/Firebase/etc.)

## Optional API Scaffold

`/Users/mihajlomicic/Documents/GitHub/launchclaw/api` now contains a minimal stateless provisioning API for Hetzner:

- `GET /v1/catalog/locations`
- `GET /v1/catalog/server-types`
- `GET /v1/catalog/images`
- `POST /v1/instances`
- `GET /v1/instances/:id`
- `DELETE /v1/instances/:id`
