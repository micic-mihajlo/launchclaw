#!/usr/bin/env bash
# LaunchClaw — Generate openclaw.json from profile + flags

generate_config() {
    local profile_path="$1"
    local config_dir config_file workspace_dir

    if [[ "$OS_TYPE" == "linux" ]]; then
        config_dir="/home/openclaw/.openclaw"
    else
        config_dir="${HOME}/.openclaw"
    fi

    config_file="${config_dir}/openclaw.json"
    workspace_dir="${config_dir}/workspace"

    if [[ "$DRY_RUN" == false ]]; then
        if [[ "$OS_TYPE" == "linux" ]]; then
            sudo mkdir -p "$config_dir" "$workspace_dir"
            sudo chown -R openclaw:openclaw "$config_dir"
        else
            mkdir -p "$config_dir" "$workspace_dir"
        fi
    fi

    # Non-destructive: don't overwrite existing config unless user accepts.
    if [[ -f "$config_file" && "$DRY_RUN" == false ]]; then
        warn "Config already exists at ${config_file}"

        if [[ "$ASSUME_YES" != true ]]; then
            read -rp "Overwrite? [y/N] " answer
            if [[ "${answer,,}" != "y" ]]; then
                GATEWAY_TOKEN=$(_extract_gateway_token "$config_file")
                ok "Keeping existing config"
                return
            fi
        fi

        # Backup existing config before overwriting.
        cp "$config_file" "${config_file}.backup.$(date +%s)"
        ok "Backed up existing config"
    fi

    log "Generating config from profile: ${PROFILE}"

    local profile_json
    profile_json=$(cat "$profile_path")

    # Channels: CLI channels override profile channels.
    local channels_list=()
    if [[ ${#CHANNELS[@]} -gt 0 ]]; then
        channels_list=("${CHANNELS[@]}")
    else
        local profile_channels
        profile_channels=$(_json_extract_array "channels" <<< "$profile_json")
        while IFS= read -r channel; do
            channels_list+=("$channel")
        done < <(echo "$profile_channels" | tr -d '[]" ' | tr ',' '\n' | sed '/^$/d')
    fi

    local channels_object
    channels_object=$(_build_channels_object "${channels_list[@]}")

    local model_value="$MODEL"
    if [[ -z "$model_value" ]]; then
        model_value=$(_json_extract_string "model" "anthropic/claude-sonnet-4-5" <<< "$profile_json")
    fi
    EFFECTIVE_MODEL="$model_value"

    local max_concurrent subagents_concurrent heartbeat_every compaction_mode
    max_concurrent=$(_json_extract_integer "maxConcurrent" "$(_json_extract_integer "maxConcurrentAgents" "2" <<< "$profile_json")" <<< "$profile_json")
    subagents_concurrent=$(_json_extract_integer "subagentsMaxConcurrent" "$(_json_extract_integer "maxSubAgents" "0" <<< "$profile_json")" <<< "$profile_json")
    heartbeat_every=$(_json_extract_string "heartbeatEvery" "" <<< "$profile_json")
    compaction_mode=$(_json_extract_string "compactionMode" "$(_json_extract_string "compaction" "default" <<< "$profile_json")" <<< "$profile_json")

    if [[ -z "$heartbeat_every" ]]; then
        local heartbeat_interval
        heartbeat_interval=$(_json_extract_integer "heartbeatInterval" "0" <<< "$profile_json")
        if [[ "$heartbeat_interval" -gt 0 ]]; then
            heartbeat_every="${heartbeat_interval}m"
        else
            heartbeat_every="0m"
        fi
    fi

    [[ "$max_concurrent" -lt 1 ]] && max_concurrent=1
    [[ "$compaction_mode" != "safeguard" ]] && compaction_mode="default"

    # Soul handling: copy into workspace/SOUL.md
    local soul_src=""
    local soul_dst="${workspace_dir}/SOUL.md"
    if [[ -n "$SOUL" && -f "$SOUL" ]]; then
        soul_src="$SOUL"
    else
        local soul_name
        soul_name=$(_profile_to_soul "$PROFILE")
        if [[ -f "${LAUNCHCLAW_DIR}/souls/${soul_name}.md" ]]; then
            soul_src="${LAUNCHCLAW_DIR}/souls/${soul_name}.md"
        fi
    fi

    local gateway_token
    gateway_token=$(generate_token)
    GATEWAY_TOKEN="$gateway_token"

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would generate config at ${config_file}"
        log "[DRY RUN] Profile: ${PROFILE}, Model: ${model_value}, Gateway Port: ${GATEWAY_PORT}"
        log "[DRY RUN] Channels: ${channels_list[*]:-none}"
        return
    fi

    if [[ -n "$soul_src" ]]; then
        if [[ "$OS_TYPE" == "linux" ]]; then
            sudo cp "$soul_src" "$soul_dst"
            sudo chown openclaw:openclaw "$soul_dst"
        else
            cp "$soul_src" "$soul_dst"
        fi
        ok "Installed SOUL.md to ${soul_dst}"
    fi

    local heartbeat_block=""
    if [[ -n "$heartbeat_every" ]]; then
        heartbeat_block=",
      \"heartbeat\": {
        \"every\": \"$(_json_escape "$heartbeat_every")\"
      }"
    fi

    local subagents_block=""
    if [[ "$subagents_concurrent" -gt 0 ]]; then
        subagents_block=",
      \"subagents\": {
        \"maxConcurrent\": ${subagents_concurrent}
      }"
    fi

    local config
    local model_json workspace_json agent_name_json compaction_mode_json
    model_json=$(_json_escape "$model_value")
    workspace_json=$(_json_escape "$workspace_dir")
    agent_name_json=$(_json_escape "$AGENT_NAME")
    compaction_mode_json=$(_json_escape "$compaction_mode")

    config=$(cat <<JSONEOF
{
  "gateway": {
    "mode": "local",
    "port": ${GATEWAY_PORT},
    "bind": "loopback",
    "controlUi": {
      "allowInsecureAuth": true
    },
    "auth": {
      "mode": "token",
      "token": "${gateway_token}"
    },
    "trustedProxies": ["127.0.0.1", "::1"]
  },
  "agents": {
    "defaults": {
      "workspace": "${workspace_json}",
      "model": {
        "primary": "${model_json}"
      },
      "maxConcurrent": ${max_concurrent},
      "compaction": {
        "mode": "${compaction_mode_json}"
      }${subagents_block}${heartbeat_block}
    }
  },
  "ui": {
    "assistant": {
      "name": "${agent_name_json}"
    }
  },
  "channels": ${channels_object}
}
JSONEOF
)

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
    # Generate a secure random token for gateway auth.
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

_json_escape() {
    local s="$1"
    s=${s//\\/\\\\}
    s=${s//\"/\\\"}
    s=${s//$'\n'/ }
    echo "$s"
}

_extract_gateway_token() {
    local config_file="$1"
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
}

_build_channel_entry() {
    case "$1" in
        discord)
            echo '"discord": {"enabled": true, "dm": {"enabled": true, "policy": "pairing"}}'
            ;;
        telegram)
            echo '"telegram": {"enabled": true, "dmPolicy": "pairing"}'
            ;;
        whatsapp)
            echo '"whatsapp": {"enabled": true, "dmPolicy": "pairing"}'
            ;;
        slack)
            echo '"slack": {"enabled": true, "dm": {"enabled": true, "policy": "pairing"}}'
            ;;
        signal)
            echo '"signal": {"enabled": true, "dmPolicy": "pairing"}'
            ;;
        *)
            return 1
            ;;
    esac
}

_build_channels_object() {
    local channels=("$@")
    local parts=()
    local seen=""

    for channel in "${channels[@]}"; do
        [[ -z "$channel" ]] && continue
        if [[ ",$seen," == *",${channel},"* ]]; then
            continue
        fi

        local entry
        if entry=$(_build_channel_entry "$channel"); then
            parts+=("$entry")
            seen="${seen},${channel}"
        else
            warn "Unknown channel in profile/flags: ${channel} (skipping)"
        fi
    done

    if [[ ${#parts[@]} -eq 0 ]]; then
        echo '{}'
        return
    fi

    local object="{"
    local first=true
    local part
    for part in "${parts[@]}"; do
        if [[ "$first" == true ]]; then
            first=false
        else
            object+=","
        fi
        object+="$part"
    done
    object+="}"

    echo "$object"
}

# Minimal JSON extraction without jq dependency.
_json_extract_integer() {
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
