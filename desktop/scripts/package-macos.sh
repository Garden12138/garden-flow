#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DESKTOP_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
source "$DESKTOP_DIR/shared/brandEnvironment.sh"
TOOLS_DIR="$DESKTOP_DIR/.packaging-tools"
NODE_VERSION="${GARDENFLOW_NODE_VERSION:-22.23.2}"
PNPM_VERSION="${GARDENFLOW_PNPM_VERSION:-10.28.2}"
NODE_DIST_URL="${GARDENFLOW_NODE_DIST_URL:-https://nodejs.org/dist/v$NODE_VERSION}"
NODE_DIST_URL="${NODE_DIST_URL%/}"
BUILD_MODE="${1:---unsigned}"

log() {
    printf '[GardenFlow package] %s\n' "$*"
}

fail() {
    printf '[GardenFlow package] ERROR: %s\n' "$*" >&2
    exit 1
}

download() {
    local url="$1"
    local output="$2"
    curl --fail --location --retry 3 --connect-timeout 20 --output "$output" "$url"
}

if [[ "$(uname -s)" != 'Darwin' ]]; then
    fail 'This script must be run on macOS.'
fi

case "$BUILD_MODE" in
    --unsigned)
        ;;
    --signed)
        ;;
    --help|-h)
        printf '%s\n' \
            'Usage: bash ./scripts/package-macos.sh [--unsigned|--signed]' \
            '' \
            '  --unsigned  Build an unsigned local-test package (default).' \
            '  --signed    Use the signing/notarization settings from package.json.'
        exit 0
        ;;
    *)
        fail "Unknown option: $BUILD_MODE (use --help for usage)"
        ;;
esac

case "$(uname -m)" in
    arm64|aarch64)
        TARGET_ARCH='arm64'
        ;;
    x86_64|amd64)
        TARGET_ARCH='x64'
        ;;
    *)
        fail "Unsupported Mac architecture: $(uname -m)"
        ;;
esac

if ! command -v curl >/dev/null 2>&1; then
    fail 'curl is required to download the portable Node.js runtime.'
fi
if ! command -v shasum >/dev/null 2>&1; then
    fail 'shasum is required to verify the Node.js download.'
fi
if ! xcode-select -p >/dev/null 2>&1; then
    log 'Warning: Xcode Command Line Tools were not detected.'
    log 'If a native dependency needs compilation, run: xcode-select --install'
fi

mkdir -p "$TOOLS_DIR"

NODE_ARCHIVE="node-v$NODE_VERSION-darwin-$TARGET_ARCH.tar.gz"
NODE_HOME="$TOOLS_DIR/node-v$NODE_VERSION-darwin-$TARGET_ARCH"
NODE_ARCHIVE_PATH="$TOOLS_DIR/$NODE_ARCHIVE"
SHASUMS_PATH="$TOOLS_DIR/SHASUMS256-v$NODE_VERSION.txt"
NODE_BIN="$NODE_HOME/bin/node"

if [[ ! -x "$NODE_BIN" ]]; then
    log "Preparing portable Node.js v$NODE_VERSION ($TARGET_ARCH)..."
    if [[ ! -f "$NODE_ARCHIVE_PATH" ]]; then
        download "$NODE_DIST_URL/$NODE_ARCHIVE" "$NODE_ARCHIVE_PATH"
    fi
    download "$NODE_DIST_URL/SHASUMS256.txt" "$SHASUMS_PATH"

    EXPECTED_SHA="$(awk -v filename="$NODE_ARCHIVE" '$2 == filename { print $1; exit }' "$SHASUMS_PATH")"
    [[ -n "$EXPECTED_SHA" ]] || fail "Checksum entry not found for $NODE_ARCHIVE"
    ACTUAL_SHA="$(shasum -a 256 "$NODE_ARCHIVE_PATH" | awk '{ print $1 }')"
    if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
        rm -f "$NODE_ARCHIVE_PATH"
        fail "Node.js checksum mismatch (expected $EXPECTED_SHA, got $ACTUAL_SHA)"
    fi

    tar -xzf "$NODE_ARCHIVE_PATH" -C "$TOOLS_DIR"
    [[ -x "$NODE_BIN" ]] || fail "Node.js extraction failed: $NODE_BIN was not created"
fi

export PATH="$NODE_HOME/bin:$PATH"
# Standard distributable builds do not include the retired official login gate.
export VITE_OFFICIAL_ACCOUNT_AUTH=false

PNPM_HOME="$TOOLS_DIR/pnpm-$PNPM_VERSION"
PNPM_CLI="$PNPM_HOME/node_modules/pnpm/bin/pnpm.cjs"
if [[ ! -f "$PNPM_CLI" ]]; then
    log "Installing local pnpm $PNPM_VERSION..."
    "$NODE_HOME/bin/npm" install \
        --prefix "$PNPM_HOME" \
        --no-audit \
        --no-fund \
        "pnpm@$PNPM_VERSION"
fi
export GARDENFLOW_PNPM_CLI="$PNPM_CLI"

run_pnpm() {
    "$NODE_BIN" "$PNPM_CLI" "$@"
}

cd "$DESKTOP_DIR"

log "Using Node.js $($NODE_BIN --version), pnpm $(run_pnpm --version)"
log 'Installing project dependencies...'
# CI is scoped to dependency installation so pnpm can replace node_modules
# without a TTY. It must not leak into electron-builder's publish detection.
env CI=true "$NODE_BIN" "$PNPM_CLI" install --frozen-lockfile

log 'Checking TypeScript...'
run_pnpm run check:types

log "Building macOS $TARGET_ARCH package ($BUILD_MODE)..."
run_pnpm run prepare:private-runtime
run_pnpm run prepare:plugin-runtime
run_pnpm run prepare:ffmpeg
run_pnpm run clean
run_pnpm exec tsc
run_pnpm exec vite build
run_pnpm run sync:prompt-library

if [[ "$BUILD_MODE" == '--signed' ]]; then
    unset CSC_IDENTITY_AUTO_DISCOVERY || true
    run_pnpm exec electron-builder --mac "--$TARGET_ARCH" --publish never
else
    export CSC_IDENTITY_AUTO_DISCOVERY=false
    run_pnpm exec electron-builder \
        --mac \
        "--$TARGET_ARCH" \
        -c.mac.identity=null \
        -c.mac.hardenedRuntime=false \
        -c.mac.notarize=false \
        --publish never
fi

log 'Build completed. Artifacts:'
find "$DESKTOP_DIR/release" -maxdepth 1 -type f \
    \( -name '*.dmg' -o -name '*.zip' -o -name '*.blockmap' -o -name 'latest-mac.yml' \) \
    -print | sort
