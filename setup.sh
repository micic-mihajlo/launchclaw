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
MODEL=""
DOMAIN=""
SOUL=""
AGENT_NAME="Assistant"
GATEWAY_PORT=18789
OPENCLAW_VERSION="latest"
SKIP_PROXY=false
SKIP_SSL=false
SKIP_FIREWALL=false
DRY_RUN=false
UNINSTALL=false
ASSUME_YES=false
STATUS_ONLY=false

load_env_file() {
    local env_file="$1"
    if [[ ! -f "$env_file" ]]; then
        err "Env file not found: ${env_file}"
        exit 1
    fi

    # shellcheck disable=SC1090
    source "$env_file"
}

to_bool() {
    case "${1:-}" in
        1|true|TRUE|yes|YES|y|Y|on|ON) echo "true" ;;
        *) echo "false" ;;
    esac
}

apply_env_defaults() {
    PROFILE="${LAUNCHCLAW_PROFILE:-$PROFILE}"
    MODEL="${LAUNCHCLAW_MODEL:-$MODEL}"
    DOMAIN="${LAUNCHCLAW_DOMAIN:-$DOMAIN}"
    SOUL="${LAUNCHCLAW_SOUL:-$SOUL}"
    AGENT_NAME="${LAUNCHCLAW_NAME:-$AGENT_NAME}"
    GATEWAY_PORT="${LAUNCHCLAW_GATEWAY_PORT:-$GATEWAY_PORT}"
    OPENCLAW_VERSION="${LAUNCHCLAW_OPENCLAW_VERSION:-$OPENCLAW_VERSION}"

    if [[ -n "${LAUNCHCLAW_CHANNELS:-}" && ${#CHANNELS[@]} -eq 0 ]]; then
        IFS=',' read -r -a CHANNELS <<< "$LAUNCHCLAW_CHANNELS"
    fi

    if [[ -n "${LAUNCHCLAW_SKIP_PROXY:-}" ]]; then
        SKIP_PROXY=$(to_bool "$LAUNCHCLAW_SKIP_PROXY")
    fi
    if [[ -n "${LAUNCHCLAW_SKIP_SSL:-}" ]]; then
        SKIP_SSL=$(to_bool "$LAUNCHCLAW_SKIP_SSL")
    fi
    if [[ -n "${LAUNCHCLAW_SKIP_FIREWALL:-}" ]]; then
        SKIP_FIREWALL=$(to_bool "$LAUNCHCLAW_SKIP_FIREWALL")
    fi
    if [[ -n "${LAUNCHCLAW_ASSUME_YES:-}" ]]; then
        ASSUME_YES=$(to_bool "$LAUNCHCLAW_ASSUME_YES")
    fi
}

# --- Parse Args ---
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            setup) shift ;; # consume subcommand
            status) STATUS_ONLY=true; shift ;;
            --profile)   PROFILE="$2"; shift 2 ;;
            --channel)   CHANNELS+=("$2"); shift 2 ;;
            --model)     MODEL="$2"; shift 2 ;;
            --domain)    DOMAIN="$2"; shift 2 ;;
            --soul)      SOUL="$2"; shift 2 ;;
            --name)      AGENT_NAME="$2"; shift 2 ;;
            --gateway-port) GATEWAY_PORT="$2"; shift 2 ;;
            --openclaw-version) OPENCLAW_VERSION="$2"; shift 2 ;;
            --env-file) load_env_file "$2"; shift 2 ;;
            --skip-proxy)    SKIP_PROXY=true; shift ;;
            --skip-ssl)      SKIP_SSL=true; shift ;;
            --skip-firewall) SKIP_FIREWALL=true; shift ;;
            --dry-run)       DRY_RUN=true; shift ;;
            --uninstall)     UNINSTALL=true; shift ;;
            --yes|-y)        ASSUME_YES=true; shift ;;
            --version)   echo "LaunchClaw v${LAUNCHCLAW_VERSION}"; exit 0 ;;
            --help|-h)   usage; exit 0 ;;
            *) err "Unknown option: $1"; usage; exit 1 ;;
        esac
    done

    apply_env_defaults

    if ! [[ "$GATEWAY_PORT" =~ ^[0-9]+$ ]] || [[ "$GATEWAY_PORT" -lt 1 ]] || [[ "$GATEWAY_PORT" -gt 65535 ]]; then
        err "Invalid --gateway-port: ${GATEWAY_PORT} (expected 1-65535)"
        exit 1
    fi
}

usage() {
    cat <<EOF
${BOLD}LaunchClaw v${LAUNCHCLAW_VERSION}${NC} — One-command OpenClaw deployment

${BOLD}Usage:${NC}
  $0 setup [options]
  $0 status

${BOLD}Options:${NC}
  --profile <name>      Profile: personal|business|developer|agency|minimal (default: personal)
  --channel <name>      Primary channel: discord|telegram|whatsapp|slack|signal (repeatable)
  --model <model>       Primary model (default: profile model)
  --domain <domain>     Domain for SSL (optional, skips SSL if not provided)
  --soul <path>         Custom SOUL.md file path
  --name <name>         Agent name (default: "Assistant")
  --gateway-port <n>    Gateway port (default: 18789)
  --openclaw-version <v>  OpenClaw npm version/tag (default: latest)
  --env-file <path>     Load LAUNCHCLAW_* variables from file
  --skip-proxy          Don't set up nginx
  --skip-ssl            Don't set up certbot
  --skip-firewall       Don't configure ufw
  --dry-run             Show what would be done without doing it
  --uninstall           Remove OpenClaw and all config
  --yes, -y             Non-interactive mode (overwrite config when needed)
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
        if command -v openclaw &>/dev/null; then
            sudo -u openclaw -H openclaw gateway uninstall --json >/dev/null 2>&1 || true
            ok "Removed OpenClaw daemon service"
        fi

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

run_status() {
    detect_os

    if ! command -v openclaw &>/dev/null; then
        err "openclaw is not installed"
        exit 1
    fi

    if [[ "$OS_TYPE" == "linux" ]]; then
        sudo -u openclaw -H openclaw gateway status --deep || true
    else
        openclaw gateway status --deep || true
    fi
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
    log "Model: ${MODEL:-auto (from profile)}"
    log "Channels: ${CHANNELS[*]:-auto (from profile)}"
    log "Gateway Port: ${GATEWAY_PORT}"
    log "OpenClaw Version: ${OPENCLAW_VERSION}"
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
        gateway_url="http://${ip}:${GATEWAY_PORT}"
    else
        gateway_url="http://localhost:${GATEWAY_PORT}"
    fi

    echo ""
    echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${GREEN}  LaunchClaw Setup Complete!${NC}"
    echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${BOLD}Agent Name:${NC}    ${AGENT_NAME}"
    echo -e "  ${BOLD}Profile:${NC}       ${PROFILE}"
    echo -e "  ${BOLD}Model:${NC}         ${EFFECTIVE_MODEL:-$MODEL}"
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
    local next_step=3
    if [[ -n "$DOMAIN" && "$SKIP_SSL" == false ]]; then
        echo -e "    ${next_step}. SSL is configured for ${DOMAIN}"
        ((next_step++))
    elif [[ -n "$DOMAIN" ]]; then
        echo -e "    ${next_step}. Run: sudo certbot --nginx -d ${DOMAIN}"
        ((next_step++))
    fi
    if [[ "$OS_TYPE" == "linux" ]]; then
        echo -e "    ${next_step}. Restart: ${BOLD}sudo -u openclaw -H openclaw gateway restart${NC}"
    else
        echo -e "    ${next_step}. Restart: ${BOLD}openclaw gateway restart${NC}"
    fi
    echo ""
    echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════════════════${NC}"
}

# --- Entry Point ---
main() {
    parse_args "$@"
    setup_logging
    source_libs

    if [[ "$STATUS_ONLY" == true ]]; then
        run_status
    elif [[ "$UNINSTALL" == true ]]; then
        run_uninstall
    else
        run_setup
    fi
}

main "$@"
