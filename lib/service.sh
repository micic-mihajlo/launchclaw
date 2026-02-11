#!/usr/bin/env bash
# LaunchClaw — Gateway daemon setup via native OpenClaw commands

setup_service() {
    if [[ "$DRY_RUN" == true ]]; then
        if [[ "$OS_TYPE" == "linux" ]]; then
            log "[DRY RUN] Would run: sudo -u openclaw -H openclaw gateway install --port ${GATEWAY_PORT} --token <redacted> --force"
            log "[DRY RUN] Would enable linger for openclaw user"
        else
            log "[DRY RUN] Would run: openclaw gateway install --port ${GATEWAY_PORT} --token <redacted> --force"
        fi
        return
    fi

    if ! command -v openclaw &>/dev/null; then
        err "openclaw binary not found in PATH"
        exit 1
    fi

    local token
    token=$(_resolve_gateway_token)
    if [[ -z "$token" ]]; then
        err "Could not resolve gateway auth token from config"
        exit 1
    fi

    if [[ "$OS_TYPE" == "linux" ]]; then
        if ! id openclaw &>/dev/null; then
            err "openclaw user does not exist"
            exit 1
        fi

        sudo -u openclaw -H openclaw gateway install \
            --port "$GATEWAY_PORT" \
            --token "$token" \
            --force \
            --json >/dev/null

        if command -v loginctl &>/dev/null; then
            sudo loginctl enable-linger openclaw >/dev/null 2>&1 || warn "Failed to enable linger for openclaw user"
        else
            warn "loginctl not found; user-level systemd service may stop after logout"
        fi

        ok "OpenClaw daemon installed (systemd user service)"

    elif [[ "$OS_TYPE" == "macos" ]]; then
        openclaw gateway install \
            --port "$GATEWAY_PORT" \
            --token "$token" \
            --force \
            --json >/dev/null

        ok "OpenClaw daemon installed (launchd)"
    fi
}

start_service() {
    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would restart OpenClaw service"
        return
    fi

    if [[ "$OS_TYPE" == "linux" ]]; then
        sudo -u openclaw -H openclaw gateway restart --json >/dev/null 2>&1 || \
            sudo -u openclaw -H openclaw gateway start --json >/dev/null 2>&1 || true
        ok "OpenClaw gateway started/restarted"
    elif [[ "$OS_TYPE" == "macos" ]]; then
        openclaw gateway restart --json >/dev/null 2>&1 || \
            openclaw gateway start --json >/dev/null 2>&1 || true
        ok "OpenClaw gateway started/restarted"
    fi
}

_resolve_gateway_token() {
    if [[ -n "${GATEWAY_TOKEN:-}" ]]; then
        echo "$GATEWAY_TOKEN"
        return
    fi

    local config_file
    if [[ "$OS_TYPE" == "linux" ]]; then
        config_file="/home/openclaw/.openclaw/openclaw.json"
    else
        config_file="${HOME}/.openclaw/openclaw.json"
    fi

    if [[ -f "$config_file" ]]; then
        awk '
            /"gateway"[[:space:]]*:/ { in_gateway=1 }
            in_gateway && /"auth"[[:space:]]*:/ { in_auth=1 }
            in_gateway && in_auth && /"token"[[:space:]]*:/ {
                if (match($0, /"token"[[:space:]]*:[[:space:]]*"[^"]*"/)) {
                    token=substr($0, RSTART, RLENGTH)
                    gsub(/.*:[[:space:]]*"/, "", token)
                    gsub(/"$/, "", token)
                    print token
                    exit
                }
            }
            in_gateway && /}[[:space:]]*,?[[:space:]]*$/ && in_auth { in_auth=0 }
        ' "$config_file"
    fi
}
