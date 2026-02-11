#!/usr/bin/env bash
# LaunchClaw — nginx reverse proxy configuration

setup_proxy() {
    if [[ "$OS_TYPE" != "linux" ]]; then
        log "Reverse proxy setup is Linux-only, skipping"
        return
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would configure nginx reverse proxy"
        return
    fi

    local conf_src="${LAUNCHCLAW_DIR}/nginx/openclaw.conf"
    local ssl_src="${LAUNCHCLAW_DIR}/nginx/ssl-params.conf"

    if [[ ! -f "$conf_src" ]]; then
        err "Missing nginx config template: ${conf_src}"
        exit 1
    fi

    # Determine server_name
    local server_name="${DOMAIN:-_}"

    # Install SSL params
    if [[ -f "$ssl_src" ]]; then
        sudo cp "$ssl_src" /etc/nginx/snippets/ssl-params.conf 2>/dev/null || \
            sudo cp "$ssl_src" /etc/nginx/ssl-params.conf
        ok "SSL params installed"
    fi

    # Generate nginx config from template
    sudo sed \
        -e "s|__SERVER_NAME__|${server_name}|g" \
        -e "s|__GATEWAY_PORT__|3000|g" \
        "$conf_src" | sudo tee /etc/nginx/sites-available/openclaw > /dev/null

    # Enable site
    sudo ln -sf /etc/nginx/sites-available/openclaw /etc/nginx/sites-enabled/openclaw

    # Remove default site if it exists (avoids port 80 conflict)
    sudo rm -f /etc/nginx/sites-enabled/default

    # Test and reload
    if sudo nginx -t 2>&1; then
        sudo systemctl reload nginx
        ok "Nginx configured and reloaded"
    else
        err "Nginx config test failed — check /etc/nginx/sites-available/openclaw"
        exit 1
    fi
}
