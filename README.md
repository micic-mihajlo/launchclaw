# LaunchClaw

One SSH session. One command. Fully configured AI agent.

LaunchClaw is a deployment toolkit for setting up [OpenClaw](https://github.com/openclaw/openclaw) on any machine — VPS, Mac Mini, mini PC. Built by the Bullpen team to commercialize OpenClaw setup as a service.

## Quick Start

```bash
git clone https://github.com/bullpen/launchclaw.git
cd launchclaw
chmod +x setup.sh
sudo ./setup.sh setup --profile business --channel discord --model anthropic/claude-sonnet-4-5
```

That's it. OpenClaw is running.

## What It Does

1. Detects your OS (Ubuntu/Debian/macOS)
2. Installs dependencies (Node.js 22+, git, nginx)
3. Installs OpenClaw globally
4. Creates a dedicated `openclaw` system user (Linux) or uses current user (macOS)
5. Generates `openclaw.json` from your chosen profile
6. Sets up systemd (Linux) or launchd (macOS) service
7. Configures nginx reverse proxy (Linux)
8. Sets up SSL via certbot (if domain provided)
9. Configures UFW firewall (Linux)
10. Starts OpenClaw and verifies it's running
11. Prints your gateway URL, token location, and next steps

## CLI Options

```
./setup.sh setup [options]

Options:
  --profile <name>      personal|business|developer|agency|minimal (default: personal)
  --channel <name>      discord|telegram|whatsapp|slack|signal (repeatable)
  --model <model>       AI model (default: anthropic/claude-sonnet-4-5)
  --domain <domain>     Domain for SSL (optional)
  --soul <path>         Custom SOUL.md file
  --name <name>         Agent name (default: "Assistant")
  --skip-proxy          Skip nginx setup
  --skip-ssl            Skip certbot
  --skip-firewall       Skip UFW
  --dry-run             Preview without making changes
  --uninstall           Remove everything
```

## Profiles

| Profile | Use Case | Agents | Model | Heartbeat |
|---------|----------|--------|-------|-----------|
| **personal** | Single user, casual | 2 concurrent | Sonnet 4.5 | 30 min |
| **business** | Professional, allowlist access | 4 concurrent | Sonnet 4.5 | 15 min (business hours) |
| **developer** | Dev-focused, GitHub integration | 4 + 8 sub-agents | Sonnet 4.5 | 15 min |
| **agency** | Multi-agent orchestration | 4 + 8 sub-agents | Opus 4.6 | 15 min |
| **minimal** | Bare bones gateway | 2 concurrent | Sonnet 4.5 | Disabled |

## Souls

Soul files define your agent's personality and capabilities. Located in `souls/`:

- `assistant.md` — Generic helpful assistant
- `business.md` — Professional business assistant
- `developer.md` — Senior software engineer
- `custom-template.md` — Template for your own

Use a custom soul:
```bash
./setup.sh setup --profile business --soul /path/to/my-soul.md
```

## Skills

Skill bundles in `skills/bundles/`:

- `coding.txt` — Code review, generation, debugging, git workflows
- `business.txt` — Email, meetings, reports, client communication
- `research.txt` — Web search, summarization, analysis

Install a bundle:
```bash
while read -r skill; do openclaw skills install "$skill"; done < skills/bundles/coding.txt
```

## Cloud-Init (VPS Auto-Provisioning)

For Hetzner, DigitalOcean, Vultr, etc. — use `cloud-init/template.yaml`:

1. Copy the template
2. Replace the `__VARIABLES__` with your values
3. Paste into your VPS provider's cloud-init / user-data field
4. Launch the server — it provisions itself

Variables to set:
- `__PROFILE__` — Profile name
- `__DOMAIN__` — Your domain
- `__MODEL__` — AI model
- `__AGENT_NAME__` — Agent name
- `__CHANNELS__` — Channel list (e.g., `"discord","telegram"`)
- `__ANTHROPIC_KEY__` — Your API key
- `__DISCORD_TOKEN__` — Channel bot token

## Post-Install

After setup completes:

1. **Set API keys** — Edit the config file:
   ```bash
   # Linux
   sudo nano /home/openclaw/.openclaw/openclaw.json

   # macOS
   nano ~/.openclaw/openclaw.json
   ```

2. **Set channel tokens** — Add your Discord/Telegram/Slack bot tokens

3. **Restart** — Apply changes:
   ```bash
   openclaw gateway restart
   ```

4. **Check status**:
   ```bash
   # Linux
   sudo systemctl status openclaw-gateway

   # macOS
   launchctl list com.openclaw.gateway
   ```

5. **View logs**:
   ```bash
   # Linux
   journalctl -u openclaw-gateway -f

   # macOS
   tail -f ~/Library/Logs/openclaw-gateway.log
   ```

## Uninstall

```bash
sudo ./setup.sh --uninstall
```

Removes the service, nginx config, openclaw user, and npm package.

## Directory Structure

```
launchclaw/
├── setup.sh                        # Main installer
├── lib/
│   ├── detect.sh                   # OS/arch detection
│   ├── deps.sh                     # Dependency installation
│   ├── install.sh                  # OpenClaw installation
│   ├── configure.sh                # Config generation
│   ├── service.sh                  # systemd/launchd setup
│   ├── proxy.sh                    # nginx reverse proxy
│   ├── ssl.sh                      # certbot SSL
│   ├── firewall.sh                 # UFW firewall
│   └── verify.sh                   # Post-install verification
├── profiles/                       # Pre-built config profiles
├── souls/                          # Agent personality files
├── skills/bundles/                 # Installable skill bundles
├── nginx/                          # Nginx config templates
├── systemd/                        # systemd unit template
├── launchd/                        # macOS launchd plist
├── cloud-init/                     # VPS auto-provisioning
└── README.md
```

## Design Decisions

- **Pure bash** — no extra runtime dependencies
- **Idempotent** — safe to run multiple times
- **Non-destructive** — never overwrites existing config without asking
- **Cross-platform** — Linux (Ubuntu/Debian) and macOS
- **Secure by default** — dedicated user, restrictive permissions, firewall, SSL

## Requirements

- Ubuntu 20.04+ / Debian 11+ / macOS 12+
- Root or sudo access (Linux)
- Internet connection for initial setup

## License

MIT
