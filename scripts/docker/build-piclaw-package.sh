#!/usr/bin/env bash
# scripts/docker/build-piclaw-package.sh – Build piclaw .tgz and install globally.
#
# Build pipeline:
#   1. `bun run build`     – Type-check/compile TypeScript for CI parity.
#   2. `bun run build:web` – Produces web/static/{classic,common}/dist bundles.
#   3. Drop browser sourcemaps for the runtime image.
#   4. `bun pm pack`       – Creates the tarball for global install.
set -euo pipefail

export BUN_INSTALL="${BUN_INSTALL:-/usr/local/lib/bun}"
export BUN_INSTALL_CACHE_DIR="${BUN_INSTALL_CACHE_DIR:-/tmp/bun-cache}"
export PATH="$BUN_INSTALL/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

cd /home/agent/piclaw

# Run the packaged postinstall explicitly after the scripts-disabled global
# installation, including the private durable engine dependency island.
bun update --ignore-scripts
bun install --ignore-scripts
bun run build
bun run build:web
bun run build:web:visual
find runtime/web/static/classic/dist runtime/web/static/common/dist runtime/web/static/visual/dist -type f -name '*.map' -delete

rm -f piclaw-*.tgz
PACK_DIR="$(mktemp -d)"
# Reason: the bundled add-on inventory otherwise exhausts Docker's build log limit.
bun pm pack --destination "$PACK_DIR" --quiet

TARBALL="$(find "$PACK_DIR" -maxdepth 1 -name 'piclaw-*.tgz' | head -n1)"
if [ -z "$TARBALL" ] || [ ! -f "$TARBALL" ]; then
  TARBALL="$(find . -maxdepth 1 -name 'piclaw-*.tgz' | head -n1)"
fi
if [ -z "$TARBALL" ] || [ ! -f "$TARBALL" ]; then
  echo "piclaw tarball not found" >&2
  exit 1
fi

TARBALL="$(realpath "$TARBALL")"

GLOBAL_DIR="$BUN_INSTALL/install/global"
GLOBAL_PKG="$GLOBAL_DIR/package.json"
GLOBAL_LOCK="$GLOBAL_DIR/bun.lock"
PI_AGENT_VERSION="$(jq -r '.dependencies["@earendil-works/pi-coding-agent"] // "0.74.0"' package.json)"
INSTALL_STAGE="$(mktemp -d)"
INSTALL_TARBALL="$(mktemp --suffix=.tgz)"
PATCH_STAGE="$(mktemp -d)"
GLOBAL_PACKAGE="$(mktemp)"
printf '[build-piclaw-package] prepare-global-install\n'
bun run scripts/prepare-local-install.ts \
  "$TARBALL" "$INSTALL_STAGE" "$INSTALL_TARBALL" "$PATCH_STAGE" "$GLOBAL_PACKAGE" "$PI_AGENT_VERSION"
printf '[build-piclaw-package] install-global\n'
sudo mkdir -p "$GLOBAL_DIR"
sudo cp -R "$PATCH_STAGE"/. "$GLOBAL_DIR"/
sudo cp "$GLOBAL_PACKAGE" "$GLOBAL_PKG"
sudo rm -f "$GLOBAL_LOCK"
sudo BUN_INSTALL="$BUN_INSTALL" BUN_INSTALL_CACHE_DIR="$BUN_INSTALL_CACHE_DIR" "$BUN_INSTALL/bin/bun" install -g "$INSTALL_TARBALL" --registry https://registry.npmjs.org --ignore-scripts

printf '[build-piclaw-package] cleanup-tarball\n'
rm -f "$TARBALL" "$INSTALL_TARBALL" "$GLOBAL_PACKAGE"
rm -rf "$PACK_DIR" "$INSTALL_STAGE" "$PATCH_STAGE"

printf '[build-piclaw-package] wire-extension-node_modules\n'
DEST_REAL="$BUN_INSTALL/install/global/node_modules/piclaw"
sudo BUN_INSTALL="$BUN_INSTALL" BUN_INSTALL_CACHE_DIR="$BUN_INSTALL_CACHE_DIR" "$BUN_INSTALL/bin/bun" "$DEST_REAL/scripts/postinstall.ts"
if [ -d "$DEST_REAL/runtime/extensions" ] && [ -d "$DEST_REAL/node_modules" ]; then
  sudo ln -sfn "$DEST_REAL/node_modules" "$DEST_REAL/runtime/extensions/node_modules" 2>/dev/null || true
fi

printf '[build-piclaw-package] chmod-runtime-paths\n'
# Bun's global installer already writes readable package contents in normal
# cases; the expensive recursive chmod across the full global tree can stall
# Docker builds on larger installs. Keep this step minimal and only normalize
# the entrypoints we rely on directly.
sudo chmod a+rx "$BUN_INSTALL/bin" 2>/dev/null || true
if [ -f "$BUN_INSTALL/bin/piclaw" ]; then
  sudo chmod a+rx "$BUN_INSTALL/bin/piclaw"
  printf '[build-piclaw-package] link-piclaw-bin\n'
  sudo ln -sf "$BUN_INSTALL/bin/piclaw" /usr/local/bin/piclaw
fi
if [ -f "$BUN_INSTALL/bin/pi" ]; then
  sudo chmod a+rx "$BUN_INSTALL/bin/pi"
fi

printf '[build-piclaw-package] drop-caches\n'
rm -rf "$HOME/.cache" "$HOME/.bun"
sudo rm -rf "$BUN_INSTALL_CACHE_DIR" "$BUN_INSTALL/install/cache"
printf '[build-piclaw-package] done\n'
