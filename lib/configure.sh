#!/usr/bin/env bash
# LaunchClaw — Generate openclaw.json from profile + flags

generate_config() {
    local profile_path="$1"
    local config_dir config_file

    if [[ "$OS_TYPE" == "linux" ]]; then
        config_dir="/home/openclaw/.openclaw"
        config_file="${config_dir}/openclaw.json"
    else
        config_dir="${HOME}/.openclaw"
        config_file="${config_dir}/openclaw.json"
    fi

    # Non-destructive: don't overwrite existing config
    if [[ -f "$config_file" && "$DRY_RUN" == false ]]; then
        warn "Config already exists at ${config_file}"
        read -rp "Overwrite? [y/N] " answer
        if [[ "${answer,,}" != "y" ]]; then
            ok "Keeping existing config"
            return
        fi
        # Backup existing config
        cp "$config_file" "${config_file}.backup.$(date +%s)"
        ok "Backed up existing config"
    fi

    log "Generating config from profile: ${PROFILE}"

    # Read profile
    local profile_json
    profile_json=$(cat "$profile_path")

    # Build channel config — merge CLI channels with profile defaults
    local channels_json
    if [[ ${#CHANNELS[@]} -gt 0 ]]; then
        channels_json="["
        local first=true
        for ch in "${CHANNELS[@]}"; do
            [[ "$first" == true ]] && first=false || channels_json+=","
            channels_json+="\"${ch}\""
        done
        channels_json+="]"
    else
        channels_json=$(echo "$profile_json" | _json_extract_array "channels")
    fi

    # Override model if specified via CLI
    local model_value="$MODEL"

    # Override agent name
    local name_value="$AGENT_NAME"

    # Copy soul file
    local soul_path=""
    if [[ -n "$SOUL" && -f "$SOUL" ]]; then
        soul_path="${config_dir}/SOUL.md"
    else
        # Use profile-matched soul from souls/
        local soul_name
        soul_name=$(_profile_to_soul "$PROFILE")
        if [[ -f "${LAUNCHCLAW_DIR}/souls/${soul_name}.md" ]]; then
            soul_path="${config_dir}/SOUL.md"
            SOUL="${LAUNCHCLAW_DIR}/souls/${soul_name}.md"
        fi
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would generate config at ${config_file}"
        log "[DRY RUN] Profile: ${PROFILE}, Model: ${model_value}, Channels: ${channels_json}"
        return
    fi

    # Install soul file
    if [[ -n "$SOUL" && -n "$soul_path" ]]; then
        if [[ "$OS_TYPE" == "linux" ]]; then
            sudo cp "$SOUL" "$soul_path"
            sudo chown openclaw:openclaw "$soul_path"
        else
            cp "$SOUL" "$soul_path"
        fi
        ok "Installed SOUL.md"
    fi

    # Extract profile values for config generation
    local max_agents sub_agents heartbeat_interval heartbeat_schedule compaction
    max_agents=$(echo "$profile_json" | _json_extract "maxConcurrentAgents" "2")
    sub_agents=$(echo "$profile_json" | _json_extract "maxSubAgents" "0")
    heartbeat_interval=$(echo "$profile_json" | _json_extract "heartbeatInterval" "0")
    heartbeat_schedule=$(echo "$profile_json" | _json_extract_string "heartbeatSchedule" "")
    compaction=$(echo "$profile_json" | _json_extract_string "compaction" "default")

    # Build the openclaw.json
    local config
    config=$(cat <<JSONEOF
{
  "agent": {
    "name": "${name_value}",
    "model": "${model_value}",
    "maxConcurrentAgents": ${max_agents},
    "maxSubAgents": ${sub_agents},
    "compaction": "${compaction}"
  },
  "gateway": {
    "port": 3000,
    "host": "127.0.0.1",
    "token": "$(generate_token)"
  },
  "channels": ${channels_json},
  "heartbeat": {
    "enabled": $([ "$heartbeat_interval" -gt 0 ] 2>/dev/null && echo true || echo false),
    "intervalMinutes": ${heartbeat_interval}$([ -n "$heartbeat_schedule" ] && echo ",
    \"schedule\": \"${heartbeat_schedule}\"" || echo "")
  },
  "soul": "$([ -n "$soul_path" ] && echo "$soul_path" || echo "")",
  "keys": {
    "anthropic": "",
    "openai": ""
  },
  "channelTokens": {
    "discord": "",
    "telegram": "",
    "slack": "",
    "whatsapp": "",
    "signal": ""
  }
}
JSONEOF
)

    # Write config
    if [[ "$OS_TYPE" == "linux" ]]; then
        echo "$config" | sudo tee "$config_file" > /dev/null
        sudo chmod 600 "$config_file"
        sudo chown openclaw:openclaw "$config_file"
    else
        echo "$config" > "$config_file"
        chmod 600 "$config_file"
    fi

    ok "Config written to ${config_file}"
}

# --- Helpers ---

generate_token() {
    # Generate a secure random token for the gateway
    openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

_profile_to_soul() {
    case "$1" in
        personal|minimal) echo "assistant" ;;
        business)         echo "business" ;;
        developer)        echo "developer" ;;
        agency)           echo "assistant" ;;
        *)                echo "assistant" ;;
    esac
}

# Minimal JSON extraction without jq dependency
_json_extract() {
    local key="$1" default="${2:-}"
    local val
    val=$(grep -o "\"${key}\"[[:space:]]*:[[:space:]]*[0-9]*" | head -1 | grep -o '[0-9]*$') || true
    echo "${val:-$default}"
}

_json_extract_string() {
    local key="$1" default="${2:-}"
    local val
    val=$(grep -o "\"${key}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*: *"//;s/"$//') || true
    echo "${val:-$default}"
}

_json_extract_array() {
    local key="$1"
    local val
    val=$(grep -o "\"${key}\"[[:space:]]*:[[:space:]]*\[[^]]*\]" | head -1 | sed "s/\"${key}\"[[:space:]]*:[[:space:]]*//") || true
    echo "${val:-[]}"
}
