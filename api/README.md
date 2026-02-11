# launchclaw-api

Provisioning API for LaunchClaw + Hetzner with a lightweight order state machine.

This service lets you:

- provision OpenClaw instances on Hetzner
- start/stop/restart and delete instances
- inspect availability and pricing-informed plan templates
- create pending orders and drive provisioning after payment events
- optionally automate DNS (Cloudflare) during provisioning

## Requirements

- Node.js 22+
- Hetzner Cloud API token

Optional:

- Cloudflare API token + zone id (for DNS)
- webhook signing secret (for `/v1/webhooks/orders`)

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

Public endpoints:

- `GET /healthz`
- `POST /v1/webhooks/orders` (signature-verified when `ORDER_WEBHOOK_SECRET` is set)

## Endpoints

Catalog/instances:

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

Orders/provisioning:

- `POST /v1/orders`
- `GET /v1/orders?status=pending&limit=50`
- `GET /v1/orders/:id?events=true`
- `POST /v1/orders/:id/mark-paid?provision=true`
- `POST /v1/orders/:id/provision?force=false`
- `POST /v1/orders/:id/cancel`
- `POST /v1/webhooks/orders`

## Instance Create Example

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

Response includes `instance`, `action`, `metadata`, and `dns` status.

## Order Flow Example

1. Create pending order:

```bash
curl -X POST http://localhost:8787/v1/orders \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer YOUR_API_TOKEN' \
  -d '{
    "customer": {"name": "Client A", "email": "ops@clienta.com"},
    "externalRef": "checkout_123",
    "planId": "business",
    "instance": {
      "name": "client-a-openclaw-01",
      "location": "nbg1",
      "serverType": "cpx21",
      "profile": "business",
      "domain": "bot.client-a.com"
    }
  }'
```

2. Mark paid + provision:

```bash
curl -X POST "http://localhost:8787/v1/orders/<ORDER_ID>/mark-paid?provision=true" \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer YOUR_API_TOKEN' \
  -d '{"provider":"manual","eventId":"evt_001"}'
```

3. Or drive from webhook (`ORDER_WEBHOOK_SECRET` optional):

```bash
curl -X POST http://localhost:8787/v1/webhooks/orders \
  -H 'content-type: application/json' \
  -H 'x-launchclaw-signature: sha256=<hmac>' \
  -d '{
    "type":"order.paid",
    "orderId":"<ORDER_ID>",
    "externalRef":"checkout_123",
    "provider":"polar"
  }'
```

## Notes

- Cloud-init template source: `/Users/mihajlomicic/Documents/GitHub/launchclaw/cloud-init/template.yaml`.
- `gatewayPort` defaults to `18789` and is overrideable per request.
- Orders are persisted in SQLite (`LAUNCHCLAW_DB_PATH`).
- This is a practical control plane baseline; billing/auth UI/tenant dashboard are still out of scope.
