#!/usr/bin/env bash
# LaunchClaw — Post-install verification

verify_install() {
    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would verify OpenClaw installation"
        return
    fi

    local failures=0

    # Check openclaw binary.
    if command -v openclaw &>/dev/null; then
        ok "openclaw binary found: $(which openclaw)"
    else
        err "openclaw binary not found in PATH"
        ((failures++))
    fi

    # Check config file.
    local config_file
    if [[ "$OS_TYPE" == "linux" ]]; then
        config_file="/home/openclaw/.openclaw/openclaw.json"
    else
        config_file="${HOME}/.openclaw/openclaw.json"
    fi

    if [[ -f "$config_file" ]]; then
        ok "Config file exists: ${config_file}"
    else
        err "Config file missing: ${config_file}"
        ((failures++))
    fi

    # Check gateway daemon state via native command.
    if [[ "$OS_TYPE" == "linux" ]]; then
        if sudo -u openclaw -H openclaw gateway status --deep >/dev/null 2>&1; then
            ok "Gateway service is reachable (openclaw gateway status)"
        else
            warn "Gateway status check failed — run: sudo -u openclaw -H openclaw gateway status --deep"
            ((failures++))
        fi
    else
        if openclaw gateway status --deep >/dev/null 2>&1; then
            ok "Gateway service is reachable (openclaw gateway status)"
        else
            warn "Gateway status check failed — run: openclaw gateway status --deep"
            ((failures++))
        fi
    fi

    # Check gateway health endpoint.
    log "Checking gateway health on 127.0.0.1:${GATEWAY_PORT}..."
    local retries=8
    local gateway_up=false

    for ((i=1; i<=retries; i++)); do
        if curl -sf "http://127.0.0.1:${GATEWAY_PORT}/health" &>/dev/null; then
            gateway_up=true
            break
        fi
        sleep 2
    done

    if [[ "$gateway_up" == true ]]; then
        ok "Gateway is responding on port ${GATEWAY_PORT}"
    else
        warn "Gateway not responding yet — it may still be starting up"
        warn "Check logs with: openclaw gateway status --deep"
        ((failures++))
    fi

    # Check nginx (if applicable).
    if [[ "$OS_TYPE" == "linux" && "$SKIP_PROXY" == false ]]; then
        if sudo systemctl is-active --quiet nginx; then
            ok "Nginx is running"
        else
            warn "Nginx is not running"
            ((failures++))
        fi
    fi

    echo ""
    if [[ $failures -eq 0 ]]; then
        ok "All checks passed!"
    else
        warn "${failures} check(s) need attention (see above)"
    fi
}
