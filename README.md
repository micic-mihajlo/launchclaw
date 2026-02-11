# LaunchClaw

One SSH session. One command. Production-ready OpenClaw deployment.

LaunchClaw is a deployment toolkit for setting up [OpenClaw](https://github.com/openclaw/openclaw) on VPS machines, Mac Minis, and mini PCs in a repeatable way.

## Quick Start

```bash
git clone https://github.com/bullpen/launchclaw.git
cd launchclaw
chmod +x setup.sh
sudo ./setup.sh setup --profile business --channel discord --domain bot.example.com
```

## What It Does

1. Detects OS (Ubuntu/Debian/macOS)
2. Installs dependencies (Node.js 22+, git, nginx/certbot/ufw on Linux when needed)
3. Installs OpenClaw (`npm -g openclaw@<version>`)
4. Creates `openclaw` service user on Linux
5. Generates a **current OpenClaw-compatible** `openclaw.json`
6. Installs daemon via native `openclaw gateway install`
7. Enables reverse proxy (nginx) on Linux
8. Provisions SSL with certbot when domain is provided
9. Configures UFW firewall on Linux
10. Verifies daemon health and gateway reachability

## CLI

```bash
./setup.sh setup [options]
./setup.sh status
./setup.sh --uninstall
```

Options:

- `--profile <name>`: `personal|business|developer|agency|minimal` (default: `personal`)
- `--channel <name>`: `discord|telegram|whatsapp|slack|signal` (repeatable)
- `--model <model>`: override profile model
- `--name <name>`: agent name label
- `--gateway-port <n>`: gateway port (default: `18789`)
- `--openclaw-version <v>`: npm tag/version (default: `latest`)
- `--domain <domain>`: domain for SSL (Linux)
- `--soul <path>`: custom soul file copied to workspace `SOUL.md`
- `--env-file <path>`: source `LAUNCHCLAW_*` vars from file
- `--skip-proxy`: skip nginx
- `--skip-ssl`: skip certbot
- `--skip-firewall`: skip UFW
- `--dry-run`: no changes
- `--yes` / `-y`: non-interactive overwrite mode
- `--uninstall`: remove LaunchClaw-managed install

## Profiles

| Profile | Model | Max Concurrent | Subagents | Heartbeat |
|---------|-------|----------------|-----------|-----------|
| personal | claude-sonnet-4-5 | 2 | 0 | 30m |
| business | claude-sonnet-4-5 | 4 | 0 | 15m |
| developer | claude-sonnet-4-5 | 4 | 8 | 15m |
| agency | claude-opus-4-6 | 4 | 8 | 15m |
| minimal | claude-sonnet-4-5 | 2 | 0 | 0m |

## Env-File Templating

Example `client.env`:

```bash
LAUNCHCLAW_PROFILE=business
LAUNCHCLAW_CHANNELS=discord,slack
LAUNCHCLAW_MODEL=anthropic/claude-sonnet-4-5
LAUNCHCLAW_DOMAIN=bot.example.com
LAUNCHCLAW_GATEWAY_PORT=18789
LAUNCHCLAW_OPENCLAW_VERSION=latest
LAUNCHCLAW_ASSUME_YES=true
```

Run:

```bash
sudo ./setup.sh setup --env-file ./client.env
```

## Cloud-Init (VPS)

Template: `cloud-init/template.yaml`

Replace variables before use:

- `__PROFILE__`
- `__DOMAIN__`
- `__MODEL__`
- `__AGENT_NAME__`
- `__CHANNEL_CONFIG__` (raw JSON object)
- `__ANTHROPIC_KEY__`
- `__DISCORD_TOKEN__`

`__CHANNEL_CONFIG__` example:

```json
{"discord":{"enabled":true,"dm":{"enabled":true,"policy":"pairing"}}}
```

## Post-Install

Linux:

```bash
sudo -u openclaw -H openclaw gateway status --deep
sudo -u openclaw -H openclaw gateway restart
```

macOS:

```bash
openclaw gateway status --deep
openclaw gateway restart
```

Gateway health:

```bash
curl -sf http://127.0.0.1:18789/health
```

## Status / Uninstall

```bash
./setup.sh status
sudo ./setup.sh --uninstall
```

## Notes

- Installer is idempotent and backs up existing `openclaw.json` before overwrite.
- Generated config uses current OpenClaw keys (`gateway.auth.token`, `gateway.mode=local`, `agents.defaults.*`).
- Linux daemon runs as `openclaw` via user-level systemd service with `linger` enabled.

## Optional Provisioning API

A minimal Hetzner provisioning API scaffold is included in:

- `/Users/mihajlomicic/Documents/GitHub/launchclaw/api`

It supports:

- listing Hetzner locations/server types/images
- creating OpenClaw instances with injected LaunchClaw cloud-init
- instance status and deletion

See `/Users/mihajlomicic/Documents/GitHub/launchclaw/api/README.md`.

## License

MIT
