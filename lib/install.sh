#!/usr/bin/env bash
# LaunchClaw — OpenClaw installation

install_openclaw() {
    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would install openclaw@${OPENCLAW_VERSION} globally via npm"
        return
    fi

    # Check if already installed
    if command -v openclaw &>/dev/null; then
        local current_version
        current_version=$(openclaw --version 2>/dev/null || echo "unknown")
        log "OpenClaw already installed (${current_version}). Updating..."
    fi

    log "Installing openclaw@${OPENCLAW_VERSION}..."
    sudo npm install -g "openclaw@${OPENCLAW_VERSION}"
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
        # Create dedicated service user with a real home for user-level systemd service.
        if ! id openclaw &>/dev/null; then
            sudo useradd --create-home --shell /bin/bash openclaw
            ok "Created openclaw user"
        else
            ok "openclaw user already exists"
        fi

        # Create config directory
        sudo mkdir -p /home/openclaw/.openclaw /home/openclaw/.openclaw/workspace
        sudo chown -R openclaw:openclaw /home/openclaw/.openclaw
        ok "Config directory: /home/openclaw/.openclaw/"
        ok "Workspace directory: /home/openclaw/.openclaw/workspace/"

    elif [[ "$OS_TYPE" == "macos" ]]; then
        # Use current user on macOS
        mkdir -p "${HOME}/.openclaw" "${HOME}/.openclaw/workspace"
        ok "Config directory: ${HOME}/.openclaw/"
        ok "Workspace directory: ${HOME}/.openclaw/workspace/"
    fi
}
