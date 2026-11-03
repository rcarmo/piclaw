# Web API endpoint inventory

_Access/auth documentation reviewed: 2026-09-06_

This document inventories the main single-user web-channel routes. Family account, invitation and migration endpoints are removed. Dynamically registered add-on routes are not exhaustively enumerated.

## Guard model

For `src/channels/web/request-router-service.ts`, route order depends on access mode:

1. Unsupported isolated mode returns 503; removed access modes fail configuration validation before startup.
2. Public `/auth/options` returns only mode/method flags (GET/HEAD, no-store; isolated 503). Single-user `/auth/me` resolves identity directly. `/api/addons/*` and widget-state routes use their own early guards.
3. Remaining single-user requests pass auth/enrolment rate limits, optional authentication, CSRF checks and covered data limits.
4. Auth dispatch runs before the origin is remembered and built-in content/workspace/agent/media/extension handlers run.
5. Responses receive security and request-timing headers.

### Separate entry points

- `/api/addons/<id>/*` uses package-owned registrations and protocol-specific authentication. Remote pairing/messaging lives in the [Remote Peer add-on](https://rcarmo.github.io/piclaw-addons/addons/remote-peer/); the old core `/api/remote/*` inventory is obsolete.
- GET `/api/state` and `/api/state/events` use widget Bearer-token authentication, not browser cookies.
- Terminal and VNC WebSocket upgrades run through `server-lifecycle-gateway-service.ts` before ordinary HTTP dispatch. They retain single-user authentication/Origin checks and explicitly reject unsupported access modes before target resolution or upgrade; owner-scoped remote sessions are not enabled.


The route tables below describe single-user guards. “Authenticated” means the configured single-user authentication gate; auth-disabled single-user instances remain possible.

## Public and shell-adjacent routes

| Method | Path | Source | Auth | Notes |
|---|---|---|---|---|
| GET/HEAD | `/`, `/index.html` | `dispatch-shell.ts` | yes when auth enabled | Authenticated app shell; unauthenticated users are redirected/login-gated. |
| GET/HEAD | `/login`, `/login.html` | request guards | public when auth enabled | Login page only; returns 404 when auth is disabled. |
| GET/HEAD | `/manifest.json` | `dispatch-shell.ts` | public | PWA manifest. |
| GET/HEAD | `/favicon.ico` | `dispatch-shell.ts` | public | Agent avatar fallback or static favicon. |
| GET/HEAD | `/apple-touch-icon*.png` | `dispatch-shell.ts` | public | Agent avatar fallback or static icon. |
| GET/HEAD | `/static/...` | `dispatch-shell.ts` | mixed | Login bundle/fonts/images may be public; app bundles remain auth-gated. |
| GET/HEAD | `/docs/...` | `dispatch-shell.ts` | authenticated | Authenticated docs/static docs assets. |
| GET/HEAD | `/avatar/agent` | `dispatch-shell.ts` | public | Agent avatar endpoint. |
| GET/HEAD | `/avatar/user` | `dispatch-shell.ts` | authenticated | Current user avatar endpoint. |
| GET | `/agent/roster` | `dispatch-agent.ts` | authenticated | Current agent roster endpoint. |
| GET | `/api/extension-routes` | `extension-routes.ts` | authenticated | JSON route introspection for registered extension-route prefixes. |
| GET | `/sse/stream` | `dispatch-shell.ts` | authenticated | SSE stream endpoint; accepts optional `chat_jid` subscription scope. |
| GET | `/terminal/session` | `dispatch-shell.ts` | authenticated | Web terminal session metadata/bootstrap endpoint. |
| WS upgrade | `/terminal/ws` | `web.ts` `handleFetch()` | authenticated + same-origin | WebSocket terminal transport; checked outside the normal request router. |

## Auth routes

| Method | Path | Source | Auth model | Rate limit | Response style |
|---|---|---|---|---|---|
| GET/HEAD | `/auth/options` | `auth/login-options.ts` | public mode/method flags only | none | `{mode,auth_enabled,totp,passkey,username_required}`, no-store; HEAD empty, unsupported methods 405 |
| GET/HEAD | `/auth/me` | `request-router-service.ts` / `auth/principal.ts` | Principal or 401; local default when single-user auth is disabled | none | private/no-store identity/capabilities, no bearer material |
| POST | `/auth/verify` | request guards / auth endpoints | public login verification | auth bucket | compatibility success envelope with session cookie on success: `{ status: "ok", ok: true }` |
| POST | `/auth/webauthn/login/start` | `dispatch-auth.ts` | public login bootstrap | auth bucket | bootstrap payload `{ token, options }` |
| POST | `/auth/webauthn/login/finish` | `dispatch-auth.ts` | public login completion | auth bucket | compatibility success envelope with session cookie on success: `{ status: "ok", ok: true }` |
| POST | `/auth/webauthn/register/start` | `dispatch-auth.ts` | retired for single-user | enrol bucket | 410, use Settings |
| POST | `/auth/webauthn/register/finish` | `dispatch-auth.ts` | retired for single-user | enrol bucket | 410, use Settings |
| GET/HEAD | `/auth/webauthn/enrol` | `dispatch-auth.ts` | retired for single-user | enrol bucket | 410, use Settings |
| GET | `/agent/passkeys` | `auth/single-user-passkeys.ts` | enabled default-owner session with an accepted factor; no internal/no-auth bypass | none | no-store list, RP, recent-auth and action eligibility |
| POST | `/agent/passkeys` | same | same-origin owner login no older than five minutes; `rename` or `remove` | 20/five-minute management bucket | `{ok:true}`; atomic last-usable-factor guard, no session revocation |
| POST | `/agent/passkeys/register/start` | same | same recent session; `{name}`; secure origin | same bucket | `{token,options}` bound to session, RP and origin for five minutes |
| POST | `/agent/passkeys/register/finish` | same | same session and single-use token; verified credential; rechecked before commit | same bucket | `{ok:true}`; duplicate credentials rejected |

## Content/timeline routes

| Method | Path | Source | Auth | CSRF | Data rate limit | Response style |
|---|---|---|---|---|---|---|
| GET | `/timeline` | `dispatch-content.ts` | authenticated | n/a | none | JSON timeline page |
| GET | `/hashtag/:tag` | `dispatch-content.ts` | authenticated | n/a | none | JSON list |
| GET | `/search` | `dispatch-content.ts` | authenticated | n/a | none | JSON search result payload |
| GET | `/thread/:id` | `dispatch-content.ts` | authenticated | n/a | none | JSON thread payload |
| POST | `/post` | `dispatch-content.ts` | authenticated | yes | `data/post` | created interaction |
| POST | `/post/reply` | `dispatch-content.ts` | authenticated | yes | `data/reply` | reply-creation route; created interaction |
| PATCH | `/post/:id` | `dispatch-content.ts` | authenticated | yes | `data/post_update` | updated interaction / status JSON |
| DELETE | `/post/:id` | `dispatch-content.ts` | authenticated | yes | `data/delete_post` | status JSON |
| POST | `/internal/post` | `dispatch-content.ts` | internal secret, not cookie auth | internal-only | no normal data bucket | internal bridge route |

## Agent routes

| Method | Path | Source | Auth | CSRF | Data rate limit | Response style |
|---|---|---|---|---|---|---|
| GET | `/agent/thought` | `dispatch-agent.ts` | authenticated | n/a | none | JSON thought/draft payload |
| POST | `/agent/thought/visibility` | `dispatch-agent.ts` | authenticated | yes | `data/agent_ui` | `{ status: "ok", ... }` |
| POST | `/agent/:id/message` | `dispatch-agent.ts` | authenticated | yes | `data/agent_message` | status / queued / created payload; slash-model commands can also resolve held failed runs |
| GET | `/agent/status` | `dispatch-agent.ts` | authenticated | n/a | none | JSON status payload |
| GET | `/agent/context` | `dispatch-agent.ts` | authenticated | n/a | none | JSON context usage |
| GET | `/agent/queue-state` | `dispatch-agent.ts` | authenticated | n/a | none | JSON queue state |
| GET | `/agent/scheduled-tasks` | `dispatch-agent.ts` / `handlers/scheduled-tasks-management.ts` | authenticated single-user owner | n/a | none | Task inspection including optional per-run `budget_usd` and cap revision |
| POST | `/agent/scheduled-tasks/action` | `dispatch-agent.ts` / `handlers/scheduled-tasks-management.ts` | authenticated single-user owner | yes | covered agent-data bucket | Pause/resume/delete and revision-confirmed per-run budget set/disable; shell budgets denied |
| POST | `/agent/queue-remove` | `dispatch-agent.ts` | authenticated | yes | `data/agent_queue` | status JSON |
| POST | `/agent/queue-steer` | `dispatch-agent.ts` | authenticated | yes | `data/agent_queue` | status JSON |
| GET | `/agent/models` | `dispatch-agent.ts` | authenticated | n/a | none | JSON model list/state, per-model thinking levels, provider usage, and non-secret `provider_diagnostics` |
| GET | `/agent/active-chats` | `dispatch-agent.ts` | authenticated | n/a | none | JSON list |
| GET | `/agent/branches` | `dispatch-agent.ts` | authenticated | n/a | none | JSON list |
| POST | `/agent/branch-fork` | `dispatch-agent.ts` | authenticated | yes | `data/agent_branch` | branch metadata JSON |
| POST | `/agent/branch-rename` | `dispatch-agent.ts` | authenticated | yes | `data/agent_branch` | branch metadata/status JSON |
| POST | `/agent/branch-prune` | `dispatch-agent.ts` | authenticated | yes | `data/agent_branch` | status JSON |
| POST | `/agent/peer-message` | `dispatch-agent.ts` | authenticated | yes | `data/agent_peer` | status/queued JSON |
| POST | `/agent/respond` | `dispatch-agent.ts` | authenticated | yes | `data/agent_ui` | `{ status: "ok" }` |
| POST | `/agent/card-action` | `dispatch-agent.ts` | authenticated | yes | `data/agent_ui` | card action result JSON; recovery cards can resolve held failed runs before forwarding the follow-up prompt |
| POST | `/agent/side-prompt` | `dispatch-agent.ts` | authenticated | yes | `data/agent_side_prompt` | JSON side-prompt result |
| POST | `/agent/side-prompt/stream` | `dispatch-agent.ts` | authenticated | yes | `data/agent_side_prompt` | SSE-like streamed response |
| POST | `/agent/whitelist` | `dispatch-agent.ts` | authenticated | yes | none | deprecated stub returning 404 |
| GET | `/agent/debug` | `dispatch-agent.ts` | authenticated | n/a | none | JSON extension/tool/command/skill provenance snapshot |
| GET | `/agent/commands` | `agent-commands.ts` | authenticated | n/a | none | JSON command registry (powers compose slash-command autocomplete) |

## Workspace routes

| Method | Path | Source | Auth | CSRF | Data rate limit | Response style |
|---|---|---|---|---|---|---|
| GET | `/workspace/tree` | `dispatch-workspace.ts` | authenticated | n/a | none | JSON tree |
| GET | `/workspace/file` | `dispatch-workspace.ts` | authenticated | n/a | none | text/binary content |
| GET | `/workspace/branch` | `dispatch-workspace.ts` | authenticated | n/a | none | JSON branch metadata |
| PUT | `/workspace/file` | `dispatch-workspace.ts` | authenticated | yes | `data/write` | status JSON |
| DELETE | `/workspace/file` | `dispatch-workspace.ts` | authenticated | yes | `data/write` | status JSON |
| GET | `/workspace/raw` | `dispatch-workspace.ts` | authenticated | n/a | none | raw file response |
| GET | `/workspace/download` | `dispatch-workspace.ts` | authenticated | n/a | none | attachment download |
| POST | `/workspace/attach` | `dispatch-workspace.ts` | authenticated | yes | `data/workspace_attach` | attachment/media JSON |
| POST | `/workspace/upload` | `dispatch-workspace.ts` | authenticated | yes | `data/workspace_upload` | status/attachment JSON |
| POST | `/workspace/file` | `dispatch-workspace.ts` | authenticated | yes | `data/write` | status JSON |
| POST | `/workspace/rename` | `dispatch-workspace.ts` | authenticated | yes | `data/write` | status JSON |
| POST | `/workspace/move` | `dispatch-workspace.ts` | authenticated | yes | `data/write` | status JSON |
| POST | `/workspace/visibility` | `dispatch-workspace.ts` | authenticated | yes | `data/workspace_ui` | `{ status: "ok", visible, show_hidden }` |
| GET | `/workspace/stat` | `dispatch-workspace.ts` | authenticated | n/a | none | Lightweight mtime-only check `{ mtime, size }` — used by file conflict monitor |

## Extension routes

Extension routes are registered dynamically through `src/channels/web/http/extension-routes.ts` and are dispatched after the built-in workspace/media routes but before the final 404.

| Method | Path | Source | Auth | Notes |
|---|---|---|---|---|
| GET | `/api/extension-routes` | `extension-routes.ts` | authenticated | Lists currently registered route prefixes and extension paths. |
| GET/HEAD | `/office-viewer/*` | workspace extension | authenticated | Lightweight JS Office viewer assets (docx/xlsx/pptx libs + `viewer.html`) with no-cache serving for rapid updates. |
| GET/HEAD | `/editor-vendor/*` | built-in route registration | authenticated | CodeMirror vendor asset route used by the lazy editor bundle. |
| GET/HEAD | `/csv-viewer/*` | built-in route registration | authenticated | Same-origin CSV/TSV viewer that fetches file contents from `/workspace/raw`. |

See [extension routes](extension-routes.md) for the author-facing registration API and security notes. Family HTTP currently denies these dynamically dispatched routes.

## Media routes

| Method | Path | Source | Auth | CSRF | Data rate limit | Response style |
|---|---|---|---|---|---|---|
| POST | `/media/upload` | `dispatch-media.ts` | authenticated | yes | `data/media_upload` | database media JSON; capped at 32 MiB or shared limit, whichever is lower |
| POST | `/media/upload-chunk` | `dispatch-media.ts` | authenticated; single-user only | yes | `data/media_upload_chunk` | raw bounded chunks; completion returns workspace path and size, no media ID |
| GET | `/media/:id/thumbnail` | `dispatch-media.ts` | authenticated | n/a | none | image/binary |
| GET | `/media/:id/info` | `dispatch-media.ts` | authenticated | n/a | none | JSON metadata |
| GET | `/media/:id` | `dispatch-media.ts` | authenticated | n/a | none | binary/media response |

## Add-on and widget-state routes

| Method | Path | Guard / availability |
|---|---|---|
| GET/POST (registered methods only) | `/api/addons/<id>/*` | Package-owned external routes with add-on protocol authentication; family HTTP denies |
| GET | `/api/state`, `/api/state/events` | Widget Bearer token; family HTTP denies |

Pairing and remote peer messaging belong to the installed Remote Peer add-on, not a core `/api/remote/*` implementation. See the [add-on runtime API](../../docs/addon-runtime-api.md#external-routes-api-v1) for registration, limits and ownership boundaries.

## Failure and replay semantics

The web agent surface now follows a stricter rule:

- a turn is only treated as **successful** once a terminal assistant artifact is persisted
- blank / no-terminal-output turns are **not** consumed as success
- automatic recovery still runs first (compaction / retry / blank-turn recovery)
- if recovery is exhausted and no terminal reply exists:
  - the cursor is rewound to the failed turn's `prevTs`
  - the run is recorded in `failed_*`
  - later processing pauses on that unresolved failed run until it is explicitly retried or skipped

### Route-level implications

- `POST /agent/:id/message`
  - normal messages may leave a held failed run when recovery is exhausted and no terminal reply is persisted
  - successful `/model ...` commands sent through this same route now **retry** a held failed run by rewinding to `prevTs` and resuming the chat
- `POST /agent/card-action`
  - recovery-card actions such as **Continue** and **Retry cleanly** first **skip** the held failed run so the recovery follow-up prompt is not blocked behind the unresolved failure marker
- `GET /agent/status`
  - remains the live in-memory status surface; the held failed-run state itself is durable DB state rather than a separate new endpoint family
  - family mode resolves an owned target, returns the shared core status and thought/draft previews, rechecks authority after collection, and omits instance diagnostics, extension working state/status hints and process-generation metadata
- `GET /agent/context`
  - family mode resolves an owned target and returns its context plus latest-run token/cost summary after a final authority check

This keeps the HTTP surface small while making the message-consumption semantics truthful.

## Response format observations

### Response families

The existing routes use these formats:

- errors are usually JSON shaped as `{ error: string }`
- simple mutations usually return a small JSON status payload
- read endpoints usually return raw resource payloads rather than a heavy envelope
- binary/static/media endpoints return direct file/binary responses
- SSE and terminal WebSocket endpoints intentionally use streaming protocols

A small standardisation step is now landed in shared helpers:

- `jsonResponse(data, status)`
- `okJson(extra?, status)` → `{ status: "ok", ...extra }`
- `errorJson(message, status)` → `{ error: message }`

Those helpers are now used by the shared response service plus the first low-risk
web endpoint helpers (`ui-endpoints.ts`, `handlers/workspace.ts`).

### Current rough response families

1. **resource reads**
   - plain JSON object/list payloads
   - examples: `/timeline`, `/agent/status`, `/workspace/tree`
2. **simple mutations**
   - `{ status: "ok" }` or `{ status: "ok", ...extraFields }`
   - examples: `/agent/respond`, `/workspace/visibility`
3. **compatibility simple mutations**
   - legacy callers may still expect `ok: true`, but the preferred envelope now also includes `status: "ok"`
   - examples: `PATCH /post/:id`, `POST /internal/post`, auth completion endpoints such as `/auth/verify` and `/auth/webauthn/login/finish`
4. **bootstrap/setup payloads**
   - mutation-like endpoints that return structured bootstrap data rather than a status envelope
   - examples: `/auth/webauthn/login/start`, `/auth/webauthn/register/start`
5. **resource-creating mutations**
   - created entity / richer payload rather than a bare status
   - examples: `/post`, `/post/reply`, `/media/upload`, `/agent/branch-fork`
6. **binary/streaming**
   - raw file/media/SSE/WebSocket

### Response-shape differences

The active response families differ in these visible places:

- `/workspace/file` multiplexes create/read/update/delete by method, while posts use separate resource/action paths.
- Some mutations return `{ status: "ok" }`, some return `{ status: "ok", ok: true, ... }` for compatibility, and others return full resource payloads.

### Working policy emerging from the audit

The response-shape direction is now:

- **simple UI/control mutations** → prefer `{ status: "ok", ... }`
  - examples: `/agent/respond`, `/workspace/visibility`, queue and branch-control mutations
- **compatibility mutations with older callers** → prefer `{ status: "ok", ok: true, ... }`
  - examples: `PATCH /post/:id`, `POST /internal/post`, auth completion endpoints that previously returned only `{ ok: true }`
- **bootstrap/setup mutations** → keep the structured bootstrap payload rather than wrapping it in a status envelope
  - examples: `/auth/webauthn/login/start`, `/auth/webauthn/register/start`
- **resource-creating / richer workflow mutations** → keep the richer payload, but include `status: "ok"` when feasible
  - examples: peer relay, queue-steer/send, branch fork/rename/prune
- **resource reads** → keep direct JSON resources rather than wrapping everything in a success envelope

### Endpoint-family policy snapshot

- **auth completion endpoints** (`/auth/verify`, `/auth/webauthn/login/finish`, `/auth/webauthn/register/finish`)
  - use compatibility success envelopes because the response is a success/failure acknowledgement, not the resource itself
  - keep `ok: true` where compatibility is cheap, but add `status: "ok"`
  - preserve `Set-Cookie` on login/session-establishing completions
- **auth bootstrap endpoints** (`/auth/webauthn/login/start`, `/auth/webauthn/register/start`)
  - keep direct bootstrap payloads (`token`, `options`)
  - do not wrap those in `{ status: "ok" }`
- **read endpoints**
  - keep returning direct resources
- **simple web UI control endpoints**
  - standardize on `{ status: "ok", ... }`
- **resource-creating mutations**
  - keep richer created-resource payloads rather than forcing a generic status envelope

## Security observations

### Main router controls

The main router uses these controls:

- auth-gated app/API surface by default
- CSRF Origin checks on mutating browser requests
- explicit data rate limiting for the mutating route families audited so far
- SSE chat scoping enforced at the broadcast layer
- terminal websocket upgrade separately auth/origin-checked

### Separate-entry-point caveat

Add-on external routes and widget-state endpoints have their own authentication in single-user operation. Direct WebSocket upgrades are outside ordinary HTTP dispatch and reject multi-user mode explicitly. Family HTTP and direct card/side-prompt services deny unsupported routes; complete owner-aware replacements and enforcement across tools, queues and transports remain release prerequisites.

## Follow-up candidates

1. Continue evolving the `extension_ui_*` browser-event bridge into a richer first-class extension UI surface if needed.
   - Track remaining work in [GitHub Issues](https://github.com/rcarmo/piclaw/issues), not the archived file-based board.
2. Keep route inventory coverage in tests so newly added mutating endpoints do not skip classification.

## Authenticated add-on sockets

`GET /agent/addons/<owner>/<path>` upgrades only a registered owner-bound route.
It requires enabled user-session authentication, exact HTTP(S) Origin and
single-user access mode. Core resolves chat/workspace scope; internal-secret and
anonymous access do not substitute for a user session. Finite frame, queue,
connection and duration limits cover preparation/opening; capacity stays reserved
through awaited cleanup. See `docs/addon-runtime-api.md` and the public declaration
entry `piclaw/runtime/public/addon-hooks`.
