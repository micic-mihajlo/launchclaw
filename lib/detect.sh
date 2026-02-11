#!/usr/bin/env bash
# LaunchClaw — OS/arch detection

OS_TYPE=""      # linux | macos
OS_DISTRO=""    # ubuntu | debian | macos
OS_ARCH=""      # x86_64 | arm64
OS_VERSION=""   # e.g. 22.04, 14.0

detect_os() {
    # Architecture
    case "$(uname -m)" in
        x86_64|amd64)  OS_ARCH="x86_64" ;;
        arm64|aarch64) OS_ARCH="arm64" ;;
        *) err "Unsupported architecture: $(uname -m)"; exit 1 ;;
    esac

    # OS type
    case "$OSTYPE" in
        linux*)
            OS_TYPE="linux"
            if [[ -f /etc/os-release ]]; then
                # shellcheck source=/dev/null
                source /etc/os-release
                case "$ID" in
                    ubuntu)
                        OS_DISTRO="ubuntu"
                        OS_VERSION="$VERSION_ID"
                        ;;
                    debian)
                        OS_DISTRO="debian"
                        OS_VERSION="$VERSION_ID"
                        ;;
                    *)
                        # Try ID_LIKE for derivatives
                        if [[ "$ID_LIKE" == *ubuntu* ]]; then
                            OS_DISTRO="ubuntu"
                        elif [[ "$ID_LIKE" == *debian* ]]; then
                            OS_DISTRO="debian"
                        else
                            err "Unsupported Linux distro: ${ID}. LaunchClaw supports Ubuntu and Debian."
                            exit 1
                        fi
                        OS_VERSION="$VERSION_ID"
                        ;;
                esac
            else
                err "Cannot detect Linux distribution (missing /etc/os-release)"
                exit 1
            fi
            ;;
        darwin*)
            OS_TYPE="macos"
            OS_DISTRO="macos"
            OS_VERSION="$(sw_vers -productVersion 2>/dev/null || echo 'unknown')"
            ;;
        *)
            err "Unsupported OS: ${OSTYPE}"
            exit 1
            ;;
    esac

    log "Detected: ${OS_TYPE}/${OS_DISTRO} ${OS_VERSION} (${OS_ARCH})"
}
