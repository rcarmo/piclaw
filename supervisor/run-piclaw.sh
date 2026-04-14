#!/usr/bin/env bash
# supervisor/run-piclaw.sh – Wrapper script that launches piclaw under supervisord.
#
# Sets up Bun and Homebrew paths, sources .bashrc for env vars, and
# execs the piclaw binary. Used as the command in supervisor/conf.d/piclaw.conf.
set -euo pipefail

export HOME="/home/agent"
export BUN_INSTALL="${BUN_INSTALL:-/usr/local/lib/bun}"
export TMPDIR="${TMPDIR:-/tmp}"
export PATH="$BUN_INSTALL/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:$PATH"

# Ensure login environment matches interactive shell
if [ -f "$HOME/.bashrc" ]; then
  # shellcheck source=/dev/null
  source "$HOME/.bashrc" >/dev/null 2>&1 || true
fi

if [ -f "/workspace/.env.sh" ]; then
  # shellcheck source=/dev/null
  source "/workspace/.env.sh" >/dev/null 2>&1 || true
fi

if [ "${PICLAW_AUTOSTART:-1}" != "1" ]; then
  echo "[run-piclaw] PICLAW_AUTOSTART=0; supervisor service is idle."
  tail -f /dev/null & wait $!
fi

PORT="${PICLAW_WEB_PORT:-8080}"
WORKDIR="${PICLAW_WORKSPACE:-/workspace}"
PICLAW_BIN="${PICLAW_BIN:-$(command -v piclaw 2>/dev/null || echo "$BUN_INSTALL/bin/piclaw")}" 

if [ ! -x "$PICLAW_BIN" ]; then
  echo "[run-piclaw] Unable to find piclaw binary at $PICLAW_BIN" >&2
  exit 1
fi

cd "$WORKDIR" 2>/dev/null || cd "$HOME"
echo "[run-piclaw] Starting piclaw from ${PICLAW_BIN} (port ${PORT}) in $(pwd)"
exec "$PICLAW_BIN" --port "$PORT"
