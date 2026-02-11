#!/usr/bin/env bash
# LaunchClaw — OpenClaw installation

install_openclaw() {
    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would install openclaw@latest globally via npm"
        return
    fi

    # Check if already installed
    if command -v openclaw &>/dev/null; then
        local current_version
        current_version=$(openclaw --version 2>/dev/null || echo "unknown")
        log "OpenClaw already installed (${current_version}). Updating..."
    fi

    log "Installing openclaw@latest..."
    sudo npm install -g openclaw@latest
    ok "OpenClaw $(openclaw --version 2>/dev/null || echo '') installed"
}

setup_openclaw_user() {
    if [[ "$DRY_RUN" == true ]]; then
        if [[ "$OS_TYPE" == "linux" ]]; then
            log "[DRY RUN] Would create openclaw system user"
            log "[DRY RUN] Would create /home/openclaw/.openclaw/"
        else
            log "[DRY RUN] Would create ~/.openclaw/"
        fi
        return
    fi

    if [[ "$OS_TYPE" == "linux" ]]; then
        # Create dedicated system user
        if ! id openclaw &>/dev/null; then
            sudo useradd --system --create-home --shell /bin/bash openclaw
            ok "Created openclaw user"
        else
            ok "openclaw user already exists"
        fi

        # Create config directory
        sudo mkdir -p /home/openclaw/.openclaw
        sudo chown -R openclaw:openclaw /home/openclaw/.openclaw
        ok "Config directory: /home/openclaw/.openclaw/"

    elif [[ "$OS_TYPE" == "macos" ]]; then
        # Use current user on macOS
        mkdir -p "${HOME}/.openclaw"
        ok "Config directory: ${HOME}/.openclaw/"
    fi
}
