---
name: remote-peer
description: Send prompts to paired remote piclaw peers, list peers, and manage incoming proposals (pending/accept/reject). Uses Ed25519 signing to authenticate requests over HTTP. Use when asked to message, query, or manage remote agents.
distribution: public
---

# Remote Peer

Send signed prompts to paired remote piclaw peers and manage incoming proposals.

## Helper script

All operations go through `peer.ts` (auto-resolved relative to this skill directory).

```bash
bun /workspace/piclaw/runtime/skills/builtin/remote-peer/peer.ts <command> [args]
```

### CLI overrides

| Flag | Purpose |
|------|---------|
| `--store-dir <dir>` | Override `PICLAW_STORE` for DB location |
| `--data-dir <dir>`  | Override `PICLAW_DATA` for identity/IPC location |

---

## Commands

### List all peers

```bash
bun peer.ts list
```

Output: `<name> | <fingerprint> | <status>/<mode>/<profile> | <base_url>`

---

### Send a prompt to a peer

```bash
bun peer.ts send <peer> "<prompt>"
```

`<peer>` can be:
- fingerprint: `cad6It-SMYlIb-mIdw8c`
- display name: `product-manager`
- instance_id prefix

**Routing is automatic:**
- `full / short-circuit` peers → `/api/remote/execute` (synchronous, returns result)
- all others → `/api/remote/proposal` (queued, requires human approval on their side)

**Permission profiles** (set via `/pair permissions`):
- `read-only` — ping/status only; proposals and execution are rejected
- `non-mutating` — all read-only tools (no side-effects); mutating tools blocked
- `restricted` (default) — denylist-based; shell, file-write, keychain, etc. blocked
- `full` — unrestricted tool access

Examples:
```bash
bun peer.ts send product-manager "What is your current task?"
bun peer.ts send cad6It-SMYlIb-mIdw8c "Summarise the agenda-inovar repo"
```

---

### Show pending incoming proposals

```bash
bun peer.ts pending
```

---

### Decide on a single proposal

```bash
bun peer.ts decide <request-id> accept
bun peer.ts decide <request-id> reject
```

- **accept**: writes an IPC task file that triggers the runtime to execute the proposal through the agent pool. The runtime handles execution, stores the result, and pushes a signed result callback to the requesting peer. Equivalent to `/pair approve <id>`.
- **reject**: writes an IPC task file that triggers the runtime to reject the proposal. The runtime handles the DB update and pushes a signed rejection callback (`decision: "deny"`) to the requesting peer's `/api/remote/result` endpoint. Equivalent to `/pair reject <id>`.

---

### Bulk-decide all pending proposals

```bash
bun peer.ts decide-all accept
bun peer.ts decide-all reject
```

Same semantics as `decide` but applied to every pending proposal at once.
- **accept**: queues all pending proposals for execution via IPC task files.
- **reject**: queues all for rejection via IPC task files; the runtime pushes rejection callbacks to each requesting peer.

---

## Environment

The script reads these env vars (all have sensible defaults, overridable via CLI flags):

| Var | Default | Purpose |
|-----|---------|---------|
| `PICLAW_DATA`  | `/workspace/.piclaw/data`  | Identity key location |
| `PICLAW_STORE` | `/workspace/.piclaw/store` | SQLite DB location |

piclaw's bash tool injects these automatically when available.

---

## How it works

1. Loads identity from `$PICLAW_DATA/interop/identity.json`
2. Looks up the peer's `base_url`, `mode`, `profile`, and `trust_epoch` from the SQLite DB
3. Builds a canonical request string and signs it with the local Ed25519 private key
4. POSTs to `/api/remote/execute` (short-circuit peers) or `/api/remote/proposal` (mediated peers)
5. Returns the peer's response inline

This mirrors exactly what piclaw's `/ask` slash command does internally.
