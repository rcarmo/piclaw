#!/usr/bin/env bash
# github-digest-scheduled.sh
#
# Scheduled GitHub issues/PR digest wrapper.
#
# Behavior:
# - refresh the normalized JSON + Markdown digest using the repo collator
# - emit nothing when there are zero open issues/PRs (so shell tasks stay quiet)
# - post the Markdown digest directly into the target chat when there is at least one item

set -euo pipefail

ROOT_DIR="/workspace/piclaw"
COLLATE_SCRIPT="$ROOT_DIR/scripts/github-collate-issues-prs.ts"
OUTPUT_DIR="$ROOT_DIR/runtime/generated/github-collate"
LATEST_JSON="$OUTPUT_DIR/latest-open-all-repos.json"
LATEST_MD="$OUTPUT_DIR/latest-open-all-repos.md"
TARGET_CHAT_JID="${1:-${PICLAW_CHAT_JID:-web:chat:94b5b0fe-d4d6-4e37-b6fe-a73f0d8362ec}}"

if [[ ! -f "$COLLATE_SCRIPT" ]]; then
  echo "Missing collate script: $COLLATE_SCRIPT" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

tmp_json="$(mktemp "$OUTPUT_DIR/latest-open-all-repos.XXXXXX.json")"
tmp_md="$(mktemp "$OUTPUT_DIR/latest-open-all-repos.XXXXXX.md")"
cleanup() {
  rm -f "$tmp_json" "$tmp_md"
}
trap cleanup EXIT

# Prefer already-injected env vars. Mirror whichever token is present so both
# gh-based tooling and the Bun collator can see a standard name.
if [[ -n "${GH_TOKEN:-}" ]]; then
  export GITHUB_TOKEN="$GH_TOKEN"
elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
  export GH_TOKEN="$GITHUB_TOKEN"
elif [[ -n "${GITHUB_PICLAW_BOT_PAT:-}" ]]; then
  export GH_TOKEN="$GITHUB_PICLAW_BOT_PAT"
  export GITHUB_TOKEN="$GITHUB_PICLAW_BOT_PAT"
else
  gh_token="$(gh auth token 2>/dev/null || true)"
  if [[ -n "$gh_token" ]]; then
    export GH_TOKEN="$gh_token"
    export GITHUB_TOKEN="$gh_token"
  fi
fi

if [[ -z "${GH_TOKEN:-}" && -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Missing GitHub token. Expected GH_TOKEN, GITHUB_TOKEN, GITHUB_PICLAW_BOT_PAT, or persisted gh auth." >&2
  exit 1
fi

bun "$COLLATE_SCRIPT" \
  --state open \
  --active-within-hours 24 \
  --include-private \
  --output-json "$tmp_json" \
  --output-markdown "$tmp_md" \
  >/dev/null

mv "$tmp_json" "$LATEST_JSON"
mv "$tmp_md" "$LATEST_MD"
chmod 0644 "$LATEST_JSON" "$LATEST_MD"
trap - EXIT

total_items="$(jq -r '.totals.total_items // 0' "$LATEST_JSON")"
if [[ "$total_items" == "0" ]]; then
  exit 0
fi

POST_CONTENT="$(cat "$LATEST_MD")"
/usr/local/bin/piclaw --post "$TARGET_CHAT_JID" "$POST_CONTENT" >/dev/null
