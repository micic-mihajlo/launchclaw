#!/usr/bin/env bash
# LaunchClaw — One-command OpenClaw deployment
# Usage: launchclaw setup [options]
set -euo pipefail

LAUNCHCLAW_VERSION="1.0.0"
LAUNCHCLAW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Colors & Output ---
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[LaunchClaw]${NC} $*"; }
ok()   { echo -e "${GREEN}[  OK  ]${NC} $*"; }
warn() { echo -e "${YELLOW}[ WARN ]${NC} $*"; }
err()  { echo -e "${RED}[ERROR ]${NC} $*" >&2; }
step() { echo -e "\n${BOLD}${BLUE}==> $*${NC}"; }

# --- Logging ---
setup_logging() {
    if [[ "$OSTYPE" == darwin* ]]; then
        LOG_FILE="${HOME}/Library/Logs/launchclaw.log"
    else
        LOG_FILE="/var/log/launchclaw.log"
    fi
    mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
    touch "$LOG_FILE" 2>/dev/null || LOG_FILE="/tmp/launchclaw.log"
    exec > >(tee -a "$LOG_FILE") 2>&1
    log "Logging to ${LOG_FILE}"
}

# --- Defaults ---
PROFILE="personal"
CHANNELS=()
MODEL="anthropic/claude-sonnet-4-5"
DOMAIN=""
SOUL=""
AGENT_NAME="Assistant"
SKIP_PROXY=false
SKIP_SSL=false
SKIP_FIREWALL=false
DRY_RUN=false
UNINSTALL=false

# --- Parse Args ---
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            setup) shift ;; # consume subcommand
            --profile)   PROFILE="$2"; shift 2 ;;
            --channel)   CHANNELS+=("$2"); shift 2 ;;
            --model)     MODEL="$2"; shift 2 ;;
            --domain)    DOMAIN="$2"; shift 2 ;;
            --soul)      SOUL="$2"; shift 2 ;;
            --name)      AGENT_NAME="$2"; shift 2 ;;
            --skip-proxy)    SKIP_PROXY=true; shift ;;
            --skip-ssl)      SKIP_SSL=true; shift ;;
            --skip-firewall) SKIP_FIREWALL=true; shift ;;
            --dry-run)       DRY_RUN=true; shift ;;
            --uninstall)     UNINSTALL=true; shift ;;
            --version)   echo "LaunchClaw v${LAUNCHCLAW_VERSION}"; exit 0 ;;
            --help|-h)   usage; exit 0 ;;
            *) err "Unknown option: $1"; usage; exit 1 ;;
        esac
    done
}

usage() {
    cat <<EOF
${BOLD}LaunchClaw v${LAUNCHCLAW_VERSION}${NC} — One-command OpenClaw deployment

${BOLD}Usage:${NC}
  $0 setup [options]

${BOLD}Options:${NC}
  --profile <name>      Profile: personal|business|developer|agency|minimal (default: personal)
  --channel <name>      Primary channel: discord|telegram|whatsapp|slack|signal (repeatable)
  --model <model>       Primary model (default: anthropic/claude-sonnet-4-5)
  --domain <domain>     Domain for SSL (optional, skips SSL if not provided)
  --soul <path>         Custom SOUL.md file path
  --name <name>         Agent name (default: "Assistant")
  --skip-proxy          Don't set up nginx
  --skip-ssl            Don't set up certbot
  --skip-firewall       Don't configure ufw
  --dry-run             Show what would be done without doing it
  --uninstall           Remove OpenClaw and all config
  --version             Show version
  -h, --help            Show this help
EOF
}

# --- Source Libraries ---
source_libs() {
    local libs=(detect deps install configure service proxy ssl firewall verify)
    for lib in "${libs[@]}"; do
        local path="${LAUNCHCLAW_DIR}/lib/${lib}.sh"
        if [[ -f "$path" ]]; then
            # shellcheck source=/dev/null
            source "$path"
        else
            err "Missing library: ${path}"
            exit 1
        fi
    done
}

# --- Uninstall Flow ---
run_uninstall() {
    step "Uninstalling OpenClaw"

    detect_os

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would stop and remove OpenClaw service"
        log "[DRY RUN] Would remove openclaw user and config"
        log "[DRY RUN] Would remove nginx config"
        log "[DRY RUN] Would uninstall openclaw npm package"
        return
    fi

    # Stop service
    if [[ "$OS_TYPE" == "linux" ]]; then
        sudo systemctl stop openclaw-gateway 2>/dev/null || true
        sudo systemctl disable openclaw-gateway 2>/dev/null || true
        sudo rm -f /etc/systemd/system/openclaw-gateway.service
        sudo systemctl daemon-reload
        ok "Removed systemd service"

        # Remove nginx config
        sudo rm -f /etc/nginx/sites-enabled/openclaw
        sudo rm -f /etc/nginx/sites-available/openclaw
        sudo nginx -t 2>/dev/null && sudo systemctl reload nginx 2>/dev/null || true
        ok "Removed nginx config"

        # Remove user
        if id openclaw &>/dev/null; then
            sudo userdel -r openclaw 2>/dev/null || true
            ok "Removed openclaw user"
        fi
    elif [[ "$OS_TYPE" == "macos" ]]; then
        launchctl unload ~/Library/LaunchAgents/com.openclaw.gateway.plist 2>/dev/null || true
        rm -f ~/Library/LaunchAgents/com.openclaw.gateway.plist
        ok "Removed launchd service"

        rm -rf ~/.openclaw
        ok "Removed ~/.openclaw config"
    fi

    # Uninstall npm package
    npm uninstall -g openclaw 2>/dev/null || true
    ok "Uninstalled openclaw package"

    echo ""
    ok "OpenClaw has been uninstalled."
}

# --- Main Setup Flow ---
run_setup() {
    echo ""
    echo -e "${BOLD}${CYAN}"
    echo "  ██╗      █████╗ ██╗   ██╗███╗   ██╗ ██████╗██╗  ██╗ ██████╗██╗      █████╗ ██╗    ██╗"
    echo "  ██║     ██╔══██╗██║   ██║████╗  ██║██╔════╝██║  ██║██╔════╝██║     ██╔══██╗██║    ██║"
    echo "  ██║     ███████║██║   ██║██╔██╗ ██║██║     ███████║██║     ██║     ███████║██║ █╗ ██║"
    echo "  ██║     ██╔══██║██║   ██║██║╚██╗██║██║     ██╔══██║██║     ██║     ██╔══██║██║███╗██║"
    echo "  ███████╗██║  ██║╚██████╔╝██║ ╚████║╚██████╗██║  ██║╚██████╗███████╗██║  ██║╚███╔███╔╝"
    echo "  ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝"
    echo -e "${NC}"
    echo -e "  ${BOLD}v${LAUNCHCLAW_VERSION}${NC} — One-command OpenClaw deployment"
    echo ""

    log "Profile: ${PROFILE}"
    log "Model: ${MODEL}"
    log "Channels: ${CHANNELS[*]:-auto (from profile)}"
    [[ -n "$DOMAIN" ]] && log "Domain: ${DOMAIN}"
    [[ "$DRY_RUN" == true ]] && warn "DRY RUN — no changes will be made"
    echo ""

    # Validate profile
    local profile_path="${LAUNCHCLAW_DIR}/profiles/${PROFILE}.json"
    if [[ ! -f "$profile_path" ]]; then
        err "Unknown profile: ${PROFILE}"
        err "Available profiles: personal, business, developer, agency, minimal"
        exit 1
    fi

    # Step 1: Detect OS
    step "Step 1/9 — Detecting environment"
    detect_os
    ok "OS: ${OS_TYPE} (${OS_DISTRO}), Arch: ${OS_ARCH}"

    # Step 2: Install dependencies
    step "Step 2/9 — Installing dependencies"
    install_deps

    # Step 3: Install OpenClaw
    step "Step 3/9 — Installing OpenClaw"
    install_openclaw

    # Step 4: Create user / directories
    step "Step 4/9 — Setting up user and directories"
    setup_openclaw_user

    # Step 5: Generate config
    step "Step 5/9 — Generating configuration"
    generate_config "$profile_path"

    # Step 6: Set up service
    step "Step 6/9 — Configuring service"
    setup_service

    # Step 7: Reverse proxy
    if [[ "$SKIP_PROXY" == false && "$OS_TYPE" == "linux" ]]; then
        step "Step 7/9 — Configuring reverse proxy"
        setup_proxy
    else
        step "Step 7/9 — Reverse proxy (skipped)"
    fi

    # Step 8: SSL
    if [[ "$SKIP_SSL" == false && -n "$DOMAIN" && "$OS_TYPE" == "linux" ]]; then
        step "Step 8/9 — Setting up SSL"
        setup_ssl
    else
        step "Step 8/9 — SSL (skipped)"
    fi

    # Step 9: Firewall
    if [[ "$SKIP_FIREWALL" == false && "$OS_TYPE" == "linux" ]]; then
        step "Step 9/9 — Configuring firewall"
        setup_firewall
    else
        step "Step 9/9 — Firewall (skipped)"
    fi

    # Start and verify
    step "Starting OpenClaw"
    start_service

    step "Verifying installation"
    verify_install

    # Print summary
    print_summary
}

# --- Summary ---
print_summary() {
    local gateway_url
    if [[ -n "$DOMAIN" ]]; then
        gateway_url="https://${DOMAIN}"
    elif [[ "$OS_TYPE" == "linux" ]]; then
        local ip
        ip=$(hostname -I 2>/dev/null | awk '{print $1}') || ip="<server-ip>"
        gateway_url="http://${ip}:3000"
    else
        gateway_url="http://localhost:3000"
    fi

    echo ""
    echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${GREEN}  LaunchClaw Setup Complete!${NC}"
    echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${BOLD}Agent Name:${NC}    ${AGENT_NAME}"
    echo -e "  ${BOLD}Profile:${NC}       ${PROFILE}"
    echo -e "  ${BOLD}Model:${NC}         ${MODEL}"
    echo -e "  ${BOLD}Gateway URL:${NC}   ${gateway_url}"

    # Show gateway token location
    if [[ "$OS_TYPE" == "linux" ]]; then
        echo -e "  ${BOLD}Config:${NC}        /home/openclaw/.openclaw/openclaw.json"
    else
        echo -e "  ${BOLD}Config:${NC}        ~/.openclaw/openclaw.json"
    fi

    echo ""
    echo -e "  ${BOLD}Next Steps:${NC}"
    echo -e "    1. Set your API keys in the config file"
    echo -e "    2. Set your channel bot tokens"
    if [[ -n "$DOMAIN" && "$SKIP_SSL" == false ]]; then
        echo -e "    3. SSL is configured for ${DOMAIN}"
    elif [[ -n "$DOMAIN" ]]; then
        echo -e "    3. Run: sudo certbot --nginx -d ${DOMAIN}"
    fi
    echo -e "    4. Restart: ${BOLD}openclaw gateway restart${NC}"
    echo ""
    echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════════════════${NC}"
}

# --- Entry Point ---
main() {
    parse_args "$@"
    setup_logging
    source_libs

    if [[ "$UNINSTALL" == true ]]; then
        run_uninstall
    else
        run_setup
    fi
}

main "$@"
