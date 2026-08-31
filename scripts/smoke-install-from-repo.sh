#!/usr/bin/env bash
# Verify Bun can install Piclaw from a Git repository into an isolated global prefix.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

REPO_DIR="$TMP_ROOT/repo"
BARE_REPO="$TMP_ROOT/piclaw.git"
GLOBAL_DIR="$TMP_ROOT/global"
GLOBAL_BIN="$TMP_ROOT/bin"
CACHE_DIR="$TMP_ROOT/cache"
HOME_DIR="$TMP_ROOT/home"

mkdir -p "$GLOBAL_DIR" "$GLOBAL_BIN" "$CACHE_DIR" "$HOME_DIR"
printf '{"dependencies":{}}\n' > "$GLOBAL_DIR/package.json"

git clone --no-hardlinks "$ROOT_DIR" "$REPO_DIR" >/dev/null
git -C "$REPO_DIR" clone --bare . "$BARE_REPO" >/dev/null

export HOME="$HOME_DIR"
export BUN_INSTALL="$TMP_ROOT/bun"
export BUN_INSTALL_GLOBAL_DIR="$GLOBAL_DIR"
export BUN_INSTALL_BIN="$GLOBAL_BIN"
export BUN_INSTALL_CACHE_DIR="$CACHE_DIR"

bun add -g --no-cache "git+file://$BARE_REPO"

test -e "$GLOBAL_BIN/piclaw"
test -f "$GLOBAL_DIR/node_modules/piclaw/package.json"
jq -e 'has("patchedDependencies") | not' "$GLOBAL_DIR/node_modules/piclaw/package.json" >/dev/null
"$GLOBAL_BIN/piclaw" --help >/dev/null

printf '%s\n' "[repo-install-smoke] Git global install and CLI help passed"
