#!/usr/bin/env bash
# Run the same fast CI contract as GitHub Actions against the exact commit being pushed.
# Intended for .git/hooks/pre-push via `make install-git-hooks`.

set -euo pipefail

if [[ "${PICLAW_SKIP_PRE_PUSH_CI:-}" == "1" || "${PICLAW_PRE_PUSH_CI:-}" == "0" ]]; then
  echo "[pre-push-ci] Skipped by PICLAW_SKIP_PRE_PUSH_CI/PICLAW_PRE_PUSH_CI." >&2
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

ci_command="${PICLAW_PRE_PUSH_CI_COMMAND:-make ci-fast}"
# Receipts and potentially sensitive raw logs stay outside the disposable source.
receipt_dir="${PICLAW_PRE_PUSH_RECEIPT_DIR:-$(git rev-parse --path-format=absolute --git-common-dir)/local-ci-receipts}"
zero_sha="0000000000000000000000000000000000000000"
declare -a shas=()

add_sha() {
  local sha="$1"
  [[ -z "$sha" || "$sha" == "$zero_sha" ]] && return 0
  for existing in "${shas[@]:-}"; do
    [[ "$existing" == "$sha" ]] && return 0
  done
  shas+=("$sha")
}

if [[ "${1:-}" == "--current" ]]; then
  add_sha "$(git rev-parse HEAD)"
else
  while read -r local_ref local_sha remote_ref remote_sha; do
    [[ -z "${local_ref:-}" ]] && continue
    # GitHub Actions CI currently runs on pushes to main, so guard that path.
    # Pull-request checks still run remotely for feature branches.
    if [[ "$remote_ref" == "refs/heads/main" ]]; then
      add_sha "$local_sha"
    fi
  done
fi

if [[ "${#shas[@]}" -eq 0 ]]; then
  echo "[pre-push-ci] No main-branch push detected; skipping fast CI guard." >&2
  exit 0
fi

for sha in "${shas[@]}"; do
  tmp_parent="$(mktemp -d "${TMPDIR:-/tmp}/piclaw-pre-push.XXXXXX")"
  worktree="$tmp_parent/worktree"
  keep_worktree="${PICLAW_PRE_PUSH_KEEP_WORKTREE:-0}"
  cleanup() {
    if [[ "$keep_worktree" == "1" ]]; then
      echo "[pre-push-ci] Keeping worktree for inspection: $worktree" >&2
    else
      git -C "$repo_root" worktree remove --force "$worktree" >/dev/null 2>&1 || true
      rm -rf "$tmp_parent"
    fi
  }
  trap cleanup EXIT

  echo "[pre-push-ci] Checking commit ${sha:0:12} in a clean temporary worktree..." >&2
  git worktree add --detach --quiet "$worktree" "$sha"
  (
    # Git exports routing variables to hooks. They must not bind CI or its
    # nested fixture repositories back to the checkout initiating this push.
    while IFS= read -r name; do unset "$name"; done < <(git rev-parse --local-env-vars)
    cd "$worktree"
    export HOME="${PICLAW_PRE_PUSH_HOME:-$tmp_parent/home}"
    export BUN_INSTALL_CACHE_DIR="${PICLAW_PRE_PUSH_CACHE_DIR:-$tmp_parent/bun-cache}"
    export BUN_TMPDIR="${PICLAW_PRE_PUSH_BUN_TMPDIR:-$tmp_parent/bun-tmp}"
    export TMPDIR="${PICLAW_PRE_PUSH_TMPDIR:-$tmp_parent/tmp}"
    mkdir -p "$HOME" "$BUN_INSTALL_CACHE_DIR" "$BUN_TMPDIR" "$TMPDIR"
    bun install --frozen-lockfile --no-cache --cache-dir "$BUN_INSTALL_CACHE_DIR"
    echo "[pre-push-ci] Running: $ci_command" >&2
    bun "$worktree/scripts/local-ci-receipt.ts" "$worktree" "$receipt_dir" "$ci_command"
  )
  cleanup
  trap - EXIT
done

exit 0
