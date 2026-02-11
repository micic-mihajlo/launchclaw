#!/usr/bin/env bash
# LaunchClaw — SSL via certbot

setup_ssl() {
    if [[ -z "$DOMAIN" ]]; then
        log "No domain provided, skipping SSL"
        return
    fi

    if [[ "$OS_TYPE" != "linux" ]]; then
        log "SSL setup is Linux-only, skipping"
        return
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would request SSL certificate for ${DOMAIN} via certbot"
        return
    fi

    # Check if cert already exists
    if [[ -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
        ok "SSL certificate already exists for ${DOMAIN}"
        return
    fi

    # Ensure certbot is available
    if ! command -v certbot &>/dev/null; then
        err "certbot not found — install with: sudo apt install certbot python3-certbot-nginx"
        return
    fi

    log "Requesting SSL certificate for ${DOMAIN}..."

    # Run certbot with nginx plugin
    sudo certbot --nginx \
        -d "$DOMAIN" \
        --non-interactive \
        --agree-tos \
        --redirect \
        --email "admin@${DOMAIN}" \
        --no-eff-email

    if [[ $? -eq 0 ]]; then
        ok "SSL certificate installed for ${DOMAIN}"

        # Set up auto-renewal cron if not already present
        if ! sudo crontab -l 2>/dev/null | grep -q certbot; then
            (sudo crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | sudo crontab -
            ok "Auto-renewal cron configured"
        fi
    else
        warn "SSL setup failed — you can retry manually: sudo certbot --nginx -d ${DOMAIN}"
    fi
}
