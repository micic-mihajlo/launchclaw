# launchclaw-api

Minimal provisioning API for LaunchClaw + Hetzner.

This service lets you:

- list Hetzner regions and server types
- inspect location/datacenter stock for server types
- expose LaunchClaw "plan templates" with live Hetzner pricing hints
- create an instance with LaunchClaw cloud-init preloaded
- fetch instance status
- start/stop/restart an instance
- delete an instance

It is intentionally stateless (no DB, no billing, no auth provider).

## Requirements

- Node.js 22+
- Hetzner Cloud API token

## Setup

```bash
cd /Users/mihajlomicic/Documents/GitHub/launchclaw/api
cp .env.example .env
# edit .env
npm run start
```

Server defaults to `http://localhost:8787`.

## Auth

If `LAUNCHCLAW_API_TOKEN` is set, send:

```http
Authorization: Bearer <token>
```

`/healthz` is always public.

## Endpoints

- `GET /healthz`
- `GET /v1/catalog/locations`
- `GET /v1/catalog/server-types`
- `GET /v1/catalog/images?type=system`
- `GET /v1/catalog/availability?location=nbg1&serverType=cpx21`
- `GET /v1/catalog/plans?location=nbg1`
- `GET /v1/instances?managedOnly=true`
- `POST /v1/instances`
- `GET /v1/instances/:id`
- `POST /v1/instances/:id/actions/:action` (`start|stop|restart`)
- `DELETE /v1/instances/:id?wait=true`

## Create Instance Example

```bash
curl -X POST http://localhost:8787/v1/instances \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer YOUR_API_TOKEN' \
  -d '{
    "name": "client-a-openclaw-01",
    "serverType": "cpx21",
    "location": "nbg1",
    "image": "ubuntu-24.04",
    "profile": "business",
    "model": "anthropic/claude-sonnet-4-5",
    "agentName": "Client Assistant",
    "channels": ["discord", "slack"],
    "domain": "bot.client-a.com",
    "anthropicKey": "sk-ant-...",
    "discordToken": "...",
    "waitForAction": true
  }'
```

Response includes:

- instance id/name/status/IP
- Hetzner action result
- metadata including cloud-init SHA-256

## Lifecycle Action Example

```bash
curl -X POST "http://localhost:8787/v1/instances/123456/actions/restart?wait=true" \
  -H 'authorization: Bearer YOUR_API_TOKEN'
```

## Availability Example

```bash
curl "http://localhost:8787/v1/catalog/availability?location=nbg1&serverType=cpx21" \
  -H 'authorization: Bearer YOUR_API_TOKEN'
```

## Plans Example

```bash
curl "http://localhost:8787/v1/catalog/plans?location=nbg1" \
  -H 'authorization: Bearer YOUR_API_TOKEN'
```

## Notes

- The API injects `/Users/mihajlomicic/Documents/GitHub/launchclaw/cloud-init/template.yaml`.
- `gatewayPort` defaults to `18789` and can be overridden per create request.
- `channels` are converted to LaunchClaw/OpenClaw config blocks.
- `plans` endpoint is a starter catalog (stateless); add DB + billing when moving to production SaaS.
- This API does not implement billing or tenancy isolation.
