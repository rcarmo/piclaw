#!/usr/bin/env bash
# scripts/docker/publish-smoke-test.sh – bounded Docker image smoke test for publish workflow.
#
# Verifies pinned runtime versions and that the container actually serves the web login page.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: publish-smoke-test.sh <image-ref> <platform> <expected-bun-version> <expected-restic-version>

Environment:
  STATIC_TIMEOUT_SEC   Timeout for one-shot binary/executable checks (default: 120)
  HTTP_TIMEOUT_SEC     Timeout for booting the web runtime and serving /login (default: 90)
  CURL_MAX_TIME_SEC    Per-request curl timeout while polling HTTP (default: 5)
  PICLAW_HTTP_PATH     HTTP path to probe after startup (default: /)
  PICLAW_CONTAINER_PORT Internal container port to publish (default: 8080)
EOF
}

if [ "$#" -ne 4 ]; then
  usage >&2
  exit 64
fi

IMAGE_REF="$1"
PLATFORM="$2"
EXPECTED_BUN_VERSION="$3"
EXPECTED_RESTIC_VERSION="$4"
STATIC_TIMEOUT_SEC="${STATIC_TIMEOUT_SEC:-120}"
HTTP_TIMEOUT_SEC="${HTTP_TIMEOUT_SEC:-90}"
CURL_MAX_TIME_SEC="${CURL_MAX_TIME_SEC:-5}"
PICLAW_HTTP_PATH="${PICLAW_HTTP_PATH:-/}"
PICLAW_CONTAINER_PORT="${PICLAW_CONTAINER_PORT:-8080}"

STATIC_OUTPUT="$(mktemp)"
CONTAINER_BASENAME="piclaw-smoke-${PLATFORM//\//-}-${GITHUB_RUN_ID:-local}"
CONTAINER_NAME=""
CONTAINER_ID=""
WORKSPACE_TMP_DIR=""
CONFIG_TMP_DIR=""
WORKSPACE_VOLUME=""

print_container_logs() {
  if [ -n "$CONTAINER_NAME" ] && docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    echo "[smoke] container logs (${CONTAINER_NAME})"
    docker logs "$CONTAINER_NAME" || true
    echo "[smoke] piclaw stderr log:"
    docker exec "$CONTAINER_NAME" cat /var/log/piclaw/piclaw.stderr.log 2>/dev/null || true
    echo "[smoke] piclaw stdout log:"
    docker exec "$CONTAINER_NAME" cat /var/log/piclaw/piclaw.stdout.log 2>/dev/null | tail -n 30 || true
  fi
}

cleanup_runtime_artifacts() {
  if [ -n "$CONTAINER_ID" ] && docker inspect "$CONTAINER_ID" >/dev/null 2>&1; then
    docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true
  fi
  if [ -n "$WORKSPACE_TMP_DIR" ] && [ -d "$WORKSPACE_TMP_DIR" ]; then
    rm -rf "$WORKSPACE_TMP_DIR"
  fi
  if [ -n "$CONFIG_TMP_DIR" ] && [ -d "$CONFIG_TMP_DIR" ]; then
    rm -rf "$CONFIG_TMP_DIR"
  fi
  if [ -n "$WORKSPACE_VOLUME" ]; then
    docker volume rm -f "$WORKSPACE_VOLUME" >/dev/null 2>&1 || true
  fi
  CONTAINER_NAME=""
  CONTAINER_ID=""
  WORKSPACE_TMP_DIR=""
  CONFIG_TMP_DIR=""
  WORKSPACE_VOLUME=""
}

cleanup() {
  rm -f "$STATIC_OUTPUT"
  cleanup_runtime_artifacts
}
trap cleanup EXIT

require_pattern() {
  local pattern="$1"
  if ! grep -Fq "$pattern" "$STATIC_OUTPUT"; then
    echo "[smoke] expected pattern not found: $pattern" >&2
    echo "[smoke] captured output:" >&2
    cat "$STATIC_OUTPUT" >&2
    exit 1
  fi
}

echo "[smoke] image=${IMAGE_REF} platform=${PLATFORM}"
echo "[smoke] running bounded binary checks"
timeout -k 10s "${STATIC_TIMEOUT_SEC}s" \
  docker run --rm --entrypoint sh --platform "$PLATFORM" "$IMAGE_REF" -c '
    set -e
    echo "=== Bun ===" && bun --version
    echo "=== Restic ===" && restic version
    echo "=== Restic Azure ===" && if command -v strings >/dev/null 2>&1; then strings "$(command -v restic)" | grep -qi azure.Config && echo "ok"; else echo "skipped (strings missing)"; fi
    node_guard="$(mktemp -d)"
    trap '\''rm -rf "$node_guard"'\'' EXIT
    printf "#!/bin/sh\necho NODE_MUST_NOT_RUN >&2\nexit 91\n" > "$node_guard/node"
    chmod 755 "$node_guard/node"
    export PATH="$node_guard:$PATH"
    echo "=== Pi CLI ===" && pi --version && pi --help >/dev/null
    echo "=== Piclaw CLI ===" && test -x "$(command -v piclaw)" && echo "ok"
  ' | tee "$STATIC_OUTPUT"

require_pattern "$EXPECTED_BUN_VERSION"
require_pattern "restic $EXPECTED_RESTIC_VERSION"
require_pattern "=== Pi CLI ==="
require_pattern "=== Piclaw CLI ==="

start_runtime() {
  local workspace_mode="$1"
  cleanup_runtime_artifacts

  CONTAINER_NAME="${CONTAINER_BASENAME}-${workspace_mode}-${RANDOM}"
  CONFIG_TMP_DIR="$(mktemp -d)"

  local docker_args=(
    docker run -d
    --name "$CONTAINER_NAME"
    --platform "$PLATFORM"
    # Private bind fixtures belong to the runner, whose UID need not be 1000.
    -e "PUID=$(id -u)" -e "PGID=$(id -g)"
    -p "127.0.0.1::${PICLAW_CONTAINER_PORT}"
    -v "$CONFIG_TMP_DIR:/config"
  )

  if [ "$workspace_mode" = "bind" ]; then
    WORKSPACE_TMP_DIR="$(mktemp -d)"
    docker_args+=( -v "$WORKSPACE_TMP_DIR:/workspace" )
  elif [ "$workspace_mode" = "named-volume" ]; then
    WORKSPACE_VOLUME="$(docker volume create)"
    docker_args+=( -v "$WORKSPACE_VOLUME:/workspace" )
  else
    echo "[smoke] unsupported workspace mode: $workspace_mode" >&2
    exit 64
  fi

  docker_args+=( "$IMAGE_REF" )
  CONTAINER_ID="$("${docker_args[@]}")"
}

wait_for_runtime() {
  local workspace_mode="$1"
  local host_port=""
  local http_url=""
  local ready=0
  local supervisor_ready=0

  for _ in $(seq 1 15); do
    host_port="$(docker port "$CONTAINER_NAME" "${PICLAW_CONTAINER_PORT}/tcp" 2>/dev/null | awk -F: 'NR==1 { print $NF }')"
    if [ -n "$host_port" ]; then
      break
    fi
    sleep 1
  done

  if [ -z "$host_port" ]; then
    echo "[smoke] failed to resolve published host port for ${CONTAINER_NAME}" >&2
    print_container_logs
    exit 1
  fi

  http_url="http://127.0.0.1:${host_port}${PICLAW_HTTP_PATH}"
  echo "[smoke] (${workspace_mode}) probing ${http_url}"

  local start_deadline=$((SECONDS + HTTP_TIMEOUT_SEC))
  while [ "$SECONDS" -lt "$start_deadline" ]; do
    if curl --silent --show-error --fail --location --max-time "$CURL_MAX_TIME_SEC" "$http_url" >/dev/null; then
      ready=1
      break
    fi

    if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo false)" != "true" ]; then
      echo "[smoke] container exited before serving ${PICLAW_HTTP_PATH} (${workspace_mode})" >&2
      print_container_logs
      exit 1
    fi

    sleep 2
  done

  if [ "$ready" -ne 1 ]; then
    echo "[smoke] timed out waiting for ${http_url} (${workspace_mode})" >&2
    print_container_logs
    exit 1
  fi

  echo "[smoke] (${workspace_mode}) HTTP startup ok"
  echo "[smoke] (${workspace_mode}) verifying supervisord is running"

  local supervisor_deadline=$((SECONDS + 30))
  while [ "$SECONDS" -lt "$supervisor_deadline" ]; do
    if docker exec "$CONTAINER_NAME" sh -c 'pgrep -af supervisord >/dev/null && supervisorctl -c /workspace/.piclaw/supervisor/supervisord.conf status piclaw | grep -q RUNNING'; then
      supervisor_ready=1
      break
    fi
    sleep 2
  done

  if [ "$supervisor_ready" -ne 1 ]; then
    echo "[smoke] supervisord or piclaw supervisor status check failed (${workspace_mode})" >&2
    print_container_logs
    exit 1
  fi
}

smoke_runtime() {
  local workspace_mode="$1"
  echo "[smoke] starting web runtime (${workspace_mode})"
  start_runtime "$workspace_mode"
  wait_for_runtime "$workspace_mode"
  cleanup_runtime_artifacts
}

smoke_runtime bind
smoke_runtime named-volume

echo "[smoke] ok"
