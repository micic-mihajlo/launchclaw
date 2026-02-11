#!/usr/bin/env bash
# LaunchClaw — UFW firewall configuration

setup_firewall() {
    if [[ "$OS_TYPE" != "linux" ]]; then
        log "Firewall setup is Linux-only, skipping"
        return
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would configure UFW: allow SSH, HTTP, HTTPS"
        return
    fi

    if ! command -v ufw &>/dev/null; then
        warn "ufw not installed, skipping firewall setup"
        return
    fi

    log "Configuring firewall rules..."

    # Reset to defaults (deny incoming, allow outgoing)
    sudo ufw default deny incoming
    sudo ufw default allow outgoing

    # Always allow SSH
    sudo ufw allow OpenSSH

    # Allow HTTP and HTTPS
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp

    # If no domain/proxy, expose the gateway port directly
    if [[ "$SKIP_PROXY" == true || -z "$DOMAIN" ]]; then
        sudo ufw allow "${GATEWAY_PORT}/tcp"
        ok "Allowed port ${GATEWAY_PORT} (direct gateway access)"
    fi

    # Enable UFW (non-interactive)
    echo "y" | sudo ufw enable
    ok "Firewall enabled"

    # Show status
    sudo ufw status verbose
}
