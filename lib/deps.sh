#!/usr/bin/env bash
# LaunchClaw — Dependency installation

NODE_MIN_VERSION=22

check_node_version() {
    if command -v node &>/dev/null; then
        local current
        current=$(node -v | sed 's/v//' | cut -d. -f1)
        if [[ "$current" -ge "$NODE_MIN_VERSION" ]]; then
            ok "Node.js v$(node -v | sed 's/v//') already installed"
            return 0
        fi
        warn "Node.js $(node -v) found but v${NODE_MIN_VERSION}+ required"
    fi
    return 1
}

install_node_linux() {
    log "Installing Node.js ${NODE_MIN_VERSION}.x via NodeSource..."
    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would install Node.js ${NODE_MIN_VERSION}.x"
        return
    fi

    # NodeSource setup
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MIN_VERSION}.x" | sudo -E bash -
    sudo apt-get install -y nodejs
    ok "Node.js $(node -v) installed"
}

install_node_macos() {
    log "Installing Node.js via Homebrew..."
    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would install Node.js ${NODE_MIN_VERSION}"
        return
    fi

    if ! command -v brew &>/dev/null; then
        err "Homebrew is required on macOS. Install it from https://brew.sh"
        exit 1
    fi

    brew install "node@${NODE_MIN_VERSION}"
    brew link --overwrite "node@${NODE_MIN_VERSION}" 2>/dev/null || true
    ok "Node.js $(node -v) installed"
}

install_deps() {
    if [[ "$OS_TYPE" == "linux" ]]; then
        install_deps_linux
    elif [[ "$OS_TYPE" == "macos" ]]; then
        install_deps_macos
    fi
}

install_deps_linux() {
    log "Updating package lists..."
    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would run apt-get update and install git, curl, nginx, ufw, certbot"
        return
    fi

    sudo apt-get update -qq

    # Essential packages
    local packages=(git curl build-essential)

    # nginx (unless skipped)
    if [[ "$SKIP_PROXY" == false ]]; then
        packages+=(nginx)
    fi

    # certbot (if domain provided and SSL not skipped)
    if [[ -n "$DOMAIN" && "$SKIP_SSL" == false ]]; then
        packages+=(certbot python3-certbot-nginx)
    fi

    # ufw (unless skipped)
    if [[ "$SKIP_FIREWALL" == false ]]; then
        packages+=(ufw)
    fi

    sudo apt-get install -y "${packages[@]}"
    ok "System packages installed"

    # Node.js
    if ! check_node_version; then
        install_node_linux
    fi
}

install_deps_macos() {
    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would install git and Node.js via Homebrew"
        return
    fi

    if ! command -v brew &>/dev/null; then
        err "Homebrew is required. Install from https://brew.sh"
        exit 1
    fi

    # git (usually pre-installed via Xcode CLI tools)
    if ! command -v git &>/dev/null; then
        brew install git
    fi
    ok "Git available"

    # Node.js
    if ! check_node_version; then
        install_node_macos
    fi
}
