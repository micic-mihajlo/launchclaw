# LaunchClaw — Spec

## What Is It
A deployment toolkit for setting up OpenClaw on any machine (VPS, Mac Mini, mini PC). 
Used by Bullpen team to commercialize OpenClaw setup as a service.

One SSH session. One command. Client gets a fully configured AI agent.

## Core Flow

```
launchclaw setup --profile business --channel discord --model anthropic/claude-sonnet-4-5
```

1. Detect OS (Ubuntu/Debian/macOS)
2. Install dependencies (Node.js 22+, git, nginx if Linux)
3. Install OpenClaw globally (`npm install -g openclaw@latest`)
4. Create openclaw user (Linux) or use current user (macOS)
5. Generate openclaw.json from profile + flags
6. Set up systemd service (Linux) or launchd plist (macOS)
7. Configure reverse proxy (nginx on Linux, skip on macOS)
8. Set up SSL via certbot (if domain provided)
9. Configure firewall (ufw on Linux)
10. Start OpenClaw, verify it's running
11. Print summary: URL, gateway token, next steps

## Directory Structure

```
launchclaw/
├── setup.sh                    # Main installer script (bash, works on Linux + macOS)
├── lib/
│   ├── detect.sh               # OS/arch detection
│   ├── deps.sh                 # Dependency installation
│   ├── install.sh              # OpenClaw installation
│   ├── configure.sh            # Generate openclaw.json
│   ├── service.sh              # systemd/launchd setup
│   ├── proxy.sh                # nginx reverse proxy
│   ├── ssl.sh                  # certbot SSL
│   ├── firewall.sh             # ufw setup
│   └── verify.sh               # Post-install verification
├── profiles/
│   ├── personal.json           # Single user, casual, all channels open
│   ├── business.json           # Professional setup, specific channels
│   ├── developer.json          # Dev-focused, GitHub integration, coding tools
│   ├── agency.json             # Multi-agent, sub-agents enabled, high concurrency
│   └── minimal.json            # Bare bones, just gateway + one channel
├── souls/
│   ├── assistant.md            # Generic helpful assistant
│   ├── business.md             # Professional business assistant
│   ├── developer.md            # Coding-focused agent
│   └── custom-template.md      # Template for client customization
├── skills/
│   ├── README.md               # How to add skills
│   └── bundles/
│       ├── coding.txt          # List of coding skills to install
│       ├── business.txt        # Business/productivity skills
│       └── research.txt        # Research/analysis skills
├── nginx/
│   ├── openclaw.conf           # Main nginx config template
│   └── ssl-params.conf         # SSL hardening params
├── systemd/
│   └── openclaw-gateway.service # systemd unit template
├── launchd/
│   └── com.openclaw.gateway.plist # macOS launchd plist
├── cloud-init/
│   └── template.yaml           # Cloud-init for VPS auto-provisioning
├── README.md                   # Full documentation
└── LICENSE                     # MIT
```

## CLI Flags

```
launchclaw setup [options]

Options:
  --profile <name>      Profile: personal|business|developer|agency|minimal (default: personal)
  --channel <name>      Primary channel: discord|telegram|whatsapp|slack|signal (can repeat)
  --model <model>       Primary model (default: anthropic/claude-sonnet-4-5)
  --domain <domain>     Domain for SSL (optional, skips SSL if not provided)
  --soul <path>         Custom SOUL.md file path
  --name <name>         Agent name (default: "Assistant")
  --skip-proxy          Don't set up nginx
  --skip-ssl            Don't set up certbot
  --skip-firewall       Don't configure ufw
  --dry-run             Show what would be done without doing it
  --uninstall           Remove OpenClaw and all config
```

## Profile Configs

### personal.json
- Single user, open DM policy
- Heartbeat every 30m
- 2 max concurrent agents
- Model: claude-sonnet-4-5

### business.json  
- Allowlist-based access
- Heartbeat every 15m, business hours only
- 4 max concurrent agents
- Model: claude-sonnet-4-5
- Compaction: safeguard mode

### developer.json
- GitHub integration ready
- Coding skills pre-configured
- 4 max concurrent, 8 sub-agents
- Model: claude-sonnet-4-5
- Web tools enabled

### agency.json (Bullpen-style)
- Multi-agent orchestration
- 4 max concurrent, 8 sub-agents
- Heartbeat every 15m
- All channels configured
- Model: claude-opus-4-6
- Skills: coding, research, automation

### minimal.json
- Just the gateway
- 1 channel
- 2 max concurrent
- No heartbeat
- Model: claude-sonnet-4-5

## Cloud-Init Template
For VPS auto-provisioning (Hetzner, DigitalOcean, etc.):
- Based on ClawHost's cloud-init but simplified
- Takes profile name as variable
- Sets up swap, Node.js, OpenClaw, nginx, SSL, firewall
- Injects generated openclaw.json
- Starts service and verifies

## Key Design Decisions
- Pure bash — no extra runtime dependencies
- Works offline after initial download (just needs npm for OpenClaw install)
- Idempotent — safe to run multiple times
- Non-destructive — never overwrites existing config without asking
- Clean uninstall option
- Colorized output with progress indicators
- Logs everything to /var/log/launchclaw.log (Linux) or ~/Library/Logs/launchclaw.log (macOS)

## NOT in scope
- Web dashboard (that's ClawHost's thing)
- Billing/payments
- Multi-tenant management
- Automatic updates (client can run `launchclaw update` manually)
