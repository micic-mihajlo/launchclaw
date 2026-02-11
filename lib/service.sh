#!/usr/bin/env bash
# LaunchClaw — systemd/launchd service setup

setup_service() {
    if [[ "$OS_TYPE" == "linux" ]]; then
        setup_systemd
    elif [[ "$OS_TYPE" == "macos" ]]; then
        setup_launchd
    fi
}

start_service() {
    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would start OpenClaw service"
        return
    fi

    if [[ "$OS_TYPE" == "linux" ]]; then
        sudo systemctl start openclaw-gateway
        ok "OpenClaw gateway started (systemd)"
    elif [[ "$OS_TYPE" == "macos" ]]; then
        launchctl load ~/Library/LaunchAgents/com.openclaw.gateway.plist 2>/dev/null || true
        launchctl start com.openclaw.gateway 2>/dev/null || true
        ok "OpenClaw gateway started (launchd)"
    fi
}

setup_systemd() {
    local service_src="${LAUNCHCLAW_DIR}/systemd/openclaw-gateway.service"
    local service_dst="/etc/systemd/system/openclaw-gateway.service"

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would install systemd unit to ${service_dst}"
        return
    fi

    if [[ ! -f "$service_src" ]]; then
        err "Missing systemd unit template: ${service_src}"
        exit 1
    fi

    # Resolve node path for ExecStart
    local node_path openclaw_path
    node_path=$(which node)
    openclaw_path=$(which openclaw)

    # Install the unit file with resolved paths
    sudo sed \
        -e "s|__NODE_PATH__|${node_path}|g" \
        -e "s|__OPENCLAW_PATH__|${openclaw_path}|g" \
        "$service_src" | sudo tee "$service_dst" > /dev/null

    sudo systemctl daemon-reload
    sudo systemctl enable openclaw-gateway
    ok "Systemd service installed and enabled"
}

setup_launchd() {
    local plist_src="${LAUNCHCLAW_DIR}/launchd/com.openclaw.gateway.plist"
    local plist_dst="${HOME}/Library/LaunchAgents/com.openclaw.gateway.plist"

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would install launchd plist to ${plist_dst}"
        return
    fi

    if [[ ! -f "$plist_src" ]]; then
        err "Missing launchd plist template: ${plist_src}"
        exit 1
    fi

    mkdir -p "${HOME}/Library/LaunchAgents"

    # Resolve paths
    local openclaw_path
    openclaw_path=$(which openclaw)

    # Install with resolved paths
    sed \
        -e "s|__OPENCLAW_PATH__|${openclaw_path}|g" \
        -e "s|__HOME__|${HOME}|g" \
        -e "s|__USER__|$(whoami)|g" \
        "$plist_src" > "$plist_dst"

    ok "Launchd plist installed"
}
