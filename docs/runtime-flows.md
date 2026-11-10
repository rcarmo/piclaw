# Runtime flows

Piclaw uses the following web-first authentication, message, agent, media, and lifecycle flows. [whatsapp.md](whatsapp.md) describes the WhatsApp channel.

The flows below describe single-user operation. Native runtime ownership, accepted sources and operations remain durable across restart. Older diagrams referring to direct `AgentSession.prompt()`, `runAgent()` or mutable session-tree navigation are retained historical descriptions of the retired Core execution path. Current execution follows [native web dispatch](development/native-web-execution.md), [native caller ownership](development/native-prompt-retirement.md) and [immutable routing](development/native-routing-identity.md).

## Authentication flow (single-user TOTP + passkeys)

The web UI can be gated behind TOTP with optional WebAuthn passkeys. Passkeys are enrolled in Settings → Authentication after a recent TOTP or passkey sign-in. The login page loads public method flags from `/auth/options`, offers conditional mediation and an explicit passkey button when enabled, and shows the code form only when TOTP is enabled. Failed policy loading does not expose a guessed fallback.

- **Initial TOTP setup**: `/totp` → single card with QR + manual code + confirmation input → secret is committed only after successful confirmation
- **Secondary-device setup**: `/totp` with an existing secret re-displays the same secret in the same single-card flow so another authenticator can be validated without rotating the secret
- **Reset**: `/totp reset <current-code>` → verify current code → single card with new QR/manual code + confirmation input → new secret is committed only after successful confirmation, then existing web sessions are invalidated
- **Passkey enrolment**: Settings → Authentication → Add passkey → native prompt → session-bound server verification. Legacy single-user bearer enrolment links are retired.
- **Login**: optional conditional passkey mediation or explicit passkey button; enabled TOTP is a separate form. Explicit passkey/code actions cancel competing passkey work.
- **Multiple passkeys**: list, name, rename and remove in Settings. Writes require a login no older than five minutes. Removal must leave an accepted sign-in factor and does not revoke existing sessions. `/passkey list` remains read-only; enrol/delete redirect to Settings.
- Every TOTP card submission returns explicit feedback describing validation success/failure and any changes performed

## Web UI → Agent → Web UI

The web UI supports steering mid‑response by queuing follow‑ups while streaming.

```mermaid
sequenceDiagram
  participant User
  participant Web as Web UI
  participant API as WebChannel (HTTP/SSE)
  participant Router
  participant DB as SQLite
  participant Pool as AgentPool
  participant Pi as Pi SDK

  User->>Web: Prompt
  Web->>API: POST /agent
  API->>DB: Store message
  API->>Router: Route message
  Router->>Pool: runAgent()
  Pool->>Pi: prompt()
  Pi-->>Pool: streaming updates
  Pool-->>API: events
  API-->>Web: SSE updates
  Pool->>DB: Store assistant reply
```

### Follow‑up queueing and steering

Queued follow-ups have one storage owner: `QueuedFollowupLifecycleService` persists them in `chat_cursors.queued_followups_json`. Newly allocated negative row IDs identify queue actions; host-generated `source_id` values identify durable input. Existing positive-row records remain readable. Reading queue state does not adopt a source or rewrite historical timeline rows.

Materialisation reads the persisted head, writes its user timeline row and consumes the queued record in the same SQL transaction. Accepted sources keep their native binding and payload identity. Deferred controls settle before later ordinary input is admitted. There is no parallel in-memory placeholder queue or placeholder replacement API.

The compose-area queue keeps its existing controls:

- **Cancel (×)** calls `removeAgentQueueItem(rowId)`. Accepted sources require the host withdrawal callback in the removal transaction; successful removal publishes `agent_followup_removed`.
- **Steer (→)** calls `steerAgentQueueItem(rowId)` through the captured native intent port. Unaccepted historical/manual items return409 without changing queue state or timeline rows.
- **Move up / move down** calls `POST /agent/queue-reorder` with `from_index` and `to_index`. The persisted order and accepted-source priority survive subsequent execution; protected continuations keep their ordering constraints.

### Turn state machine

Each chat JID has a cursor tracked in `chat_cursors`:

```
IDLE → (beginChatRun) → IN‑FLIGHT → (endChatRun) → IDLE
                                   → (endChatRunWithError) → FAILED
FAILED → (clearFailedRun / next success) → IDLE
```

All state transitions are single SQL statements — crash‑safe under SQLite WAL mode:

- `beginChatRun(chatJid, messageId)` — saves current cursor as `inflight_prev_ts`, records `inflight_message_id` and `inflight_started_at`
- `endChatRun(chatJid, newCursorTs)` — advances cursor, clears inflight + failed markers
- `endChatRunWithError(chatJid, ...)` — records failure metadata, clears inflight marker
- `rollbackInflightRun(chatJid)` — restores cursor from `inflight_prev_ts`, clears inflight marker

If piclaw restarts mid-turn, startup recovery now happens in two phases:
1. inflight web runs are rolled back/cleared immediately on startup
2. once workers and channels are online, piclaw writes a self-addressed `resume_pending` IPC task and resumes any remaining pending chats through the normal IPC path

Recovery logic (`recoverInflightRuns`):
- Finds all `chat_cursors` rows with a non‑null `inflight_message_id`
- If a terminal agent reply already exists past the inflight message → clears the inflight marker (the turn actually completed before the crash)
- If the inflight marker is older than 30 minutes (`MAX_INFLIGHT_AGE_MS`) → clears without rollback (prevents infinite retry of permanently failing messages)
- Otherwise → rolls back the cursor, deletes non‑terminal bot messages after the inflight point, and enqueues a retry through the normal processing path

That keeps restart recovery on the same code path as an explicit reload instead of depending on a lucky post-reboot user action.

### Recovery, timeout, and status breadcrumbs in the web UI

When a turn is recovered and eventually completes, the stored assistant message can carry a `recovery_marker` content block.

The web timeline renders that as a compact `recovered` chip on the post metadata row, with the classifier exposed in the tooltip when available.

When a turn stalls badly enough that the client has to publish a salvaged local fallback, the fallback message can carry a `timeout_marker` content block.

The web timeline renders that as a compact `timeout` chip on the same metadata row, and the fallback body can include the last visible tool action plus the salvaged partial draft.

Separately, the live status surface now keeps more operator-useful context visible:

- active `tool_call` / `tool_status` rows are preserved during silence probing instead of being replaced immediately by generic waiting copy
- recent-activity restore preserves the last meaningful status payload when possible
- tool status rows can show an `x ago` hint in the lower metadata row, alongside git/status metadata, once the row has been active for at least 10 seconds
- intent panels can show an elapsed timer once the intent has been active for at least 10 seconds

That means the user-facing surface is no longer a silent binary of “worked” vs “mysteriously resumed somehow” — successful recovery leaves a visible breadcrumb, timed-out salvage leaves an explicit breadcrumb, and live status keeps the most recent tool context visible for longer.

## Adaptive Card actions

The web UI can render `adaptive_card` content blocks inline in timeline posts and route card actions back through the normal web channel.

- `Action.OpenUrl` is handled client-side with URL validation and an explicit secondary action button pattern.
- `Action.Submit` posts to `POST /agent/card-action`.
- Submissions are persisted as `adaptive_card_submission` content blocks on the follow-up message.
- The timeline renders those submission blocks as compact receipt-style UI instead of relying on raw fallback text.
- Card lifecycle is tracked on the original card block:
  - default submit behavior: `active → completed`
  - explicit terminal variants can resolve to `cancelled` or `failed`
  - cards with `submit_behavior: "keep_active"` remain interactive after submit
- Completed/cancelled/failed cards are re-rendered from the original card payload with the last submitted values hydrated back into the inputs.
- Finished cards then lock those inputs read-only, hide action buttons, and show a concise theme-consistent status banner rather than echoing the full submission in banner text.
- Validation cards can be posted through the internal `send_adaptive_card` tool, including cases that exercise bad URL handling, submit errors, keep-active cards, and terminal-state transitions.

## Side prompts and early `/btw` UI

Piclaw has a side-prompt primitive for work that should reuse the chat's current model and thinking level without touching the main session tree.

- Backend primitive: `AgentPool.runSidePrompt(chatJid, prompt, options)`
- Web endpoints:
  - `POST /agent/side-prompt` for a one-shot JSON result
  - `POST /agent/side-prompt/stream` for SSE-style `side_prompt_*` events with live thinking/text deltas
- Uses the current chat model + thinking level
- Does not append to the main agent session tree
- Intended as the substrate for future `/btw` / side-conversation UI work

The first web UI consumer is the thin `/btw <question>` flow:

- `/btw <question>` is handled locally in the web compose box
- it opens a lightweight side-conversation panel
- the panel streams thinking/text deltas from `POST /agent/side-prompt/stream`
- each BTW run is reseeded from the **current main session tree context** before prompting, so it starts from the active Pi conversation state rather than a cold empty context
- the side run uses a separate side session so it can stay isolated from the main visible conversation while still inheriting current context and model/thinking state
- `Inject into chat` sends the final BTW answer back through the normal message path, so it respects the same queue/follow-up rules as any other user submission

Core provides the reusable side-prompt and side-session substrate. The current `/btw` panel is an early consumer, not the final side-conversation system.

## Summarization retry status

Earendil `0.81.1` emits summarization retry lifecycle events when compaction or branch-summary generation hits a retryable provider failure. Piclaw forwards those events as `agent_status` payloads so the web UI shows the retry instead of appearing idle.

| Upstream event | Web status title |
|---|---|
| `summarization_retry_scheduled` | `Retrying compaction summary (...)` or `Retrying branch summary (...)` |
| `summarization_retry_attempt_start` | `Retrying compaction summary now` or `Retrying branch summary now` |
| `summarization_retry_finished` | `Summary retry finished` |

The status payload includes `intent_key: "summarization_retry"`, `source`, `reason`, `attempt`, `maxAttempts`, and `delayMs` when the upstream event supplies those fields.

## Context usage / compaction affordance restore

The compose footer exposes current context-window usage through the `ContextPie` indicator, backed by `GET /agent/context`.

The web client refreshes this state on:
- initial connect
- SSE reconnect
- window focus
- `pageshow`
- `visibilitychange` when the document becomes visible again
- successful manual `/compact`, through an immediate `context_usage` status event

Native reset (`/new-session`) and manual/automatic compaction retain conversation identity. Fresh native estimates remain valid; unavailable counts are `null`, never a fabricated zero or a revived stored/report estimate. Direct/deferred command events and completed-turn snapshots can clear same-session meters. Failed native display reads also clear counts when the current identity remains known. Context endpoints never fall back to a host-persisted estimate.

`GET /agent/context` returns a full snapshot with `contextUpdate: "replace"`. This public marker replaces `tokens`, `contextWindow` and `percent`, including nulls. Runtime authority hints stay private. Without the marker, partial/cache-only telemetry retains omitted meters. Cache accounting remains independent. Both skins retain generation/revision guards and bounded page-local observations; late polls cannot undo a newer accepted boundary. Same-identity reconnect and authoritative unbound snapshots clear stale meters.

Ordinary context requests perform **zero full-tree summary reads** and omit `sessionTree`. Clients needing the historical summary field must request `GET /agent/context?include_tree=1` (and their usual `chat_jid`). Each opt-in request reads the existing exact public tree: `{ sessionTree: { leafId, total } }`. `/tree`, session pickers, imported-history redaction and head/count semantics are unchanged. The repository consumer audit found no Classic/Visual meter consumer for that field; the qualification consumer now requests it explicitly. Arbitrary external clients were not observable in this audit. No latency improvement has been measured.

Together, those paths keep the context compaction affordance in sync immediately after compaction and when returning to the tab or reopening the webapp, without requiring another agent turn or waiting for the slower backstop poller.

The SSE reconnect handler also refreshes queue state (`refreshQueueState()`) so queued follow-ups submitted before a connection gap are restored in the compose stack immediately, rather than waiting for the next 60-second poll cycle.

The persistence model is intentionally split:
- backend truth decides whether the compaction-related affordance is currently warranted
- browser-local state is reserved for lightweight local UI memory such as dismissal/seen state

Context usage is never read from or written to `localStorage`. Classic can reuse a value accepted by the current page revision; Visual keeps the active chat's signals. A fresh page starts without a historical meter estimate and reads the bound SDK context. Old browser/router snapshot bytes remain opaque and inert. See [native UI observations](development/native-ui-projections.md) for cache bounds, unsent composer text, preferences and OOBE ownership.

## Request timing / perf tracing

Hot web paths now emit correlated backend timing and browser-visible request traces.

Backend side:
- request-router and selected web surfaces append `Server-Timing` headers using the `appendServerTiming()` helpers
- the main router also emits an `x-request-id` header so a browser-visible request can be correlated with backend logs or server-side timing spans
- instrumentation is intentionally lightweight: bounded timing metrics attached to normal HTTP responses rather than a full tracing stack

Browser side:
- `runtime/web/src/api.ts` records `x-request-id`, `Server-Timing`, duration, method, URL, and success/failure into `window.__PICLAW_PERF__`
- `runtime/web/src/ui/app-perf-tracing.ts` keeps bounded in-memory trace/request buffers for live inspection in the browser
- failed requests that never receive a response are still recorded as failed-before-response entries so the client-side picture does not quietly omit them

This provides bounded request correlation in browser and backend logs. It is not a full tracing or telemetry-export system.

## Recent-thread timeline cache / nearby-thread prewarm

The web UI now keeps a bounded cache of recent timeline snapshots and uses nearby-thread prewarming to make thread switches feel less abrupt.

- `app-timeline-cache.ts` stores recent chat timeline payloads with an age limit and a small LRU-style cache cap
- the active chat is excluded from prewarm selection, and recent nearby chats are deduped before background fetches begin
- background prewarm is best-effort: failed fetches are logged at debug level and dropped rather than surfacing as user-facing errors
- prewarm is shutdown-aware: once session-manager shutdown starts, queued prewarms are cleared and new prewarm/create requests are rejected so teardown cannot race with fresh runtime creation
- the cache is used together with the newer refresh-coalescing/warm-session work so thread switches can often render from something fresher than a cold network round-trip

This cache is browser-local performance state, not backend truth. It reduces visible latency when revisiting timelines or nearby threads.

## Branch JID rename behavior (single-user maintenance)

A friendly handle rename preserves the chat JID and native binding. Internal JID maintenance is a separate operation.

The following address-rewrite behaviour belongs to historical compatibility paths. Current native chat JIDs and branch bindings are immutable; native rename/reparent/merge paths refuse before effects. Friendly names remain host metadata under [native routing ownership](development/native-routing-identity.md).

Historical chat JID rename/migration treats descendants as any JID under `oldJid + ":"`, not only legacy `:branch:` forms.

That means renaming a branch like `web:default:research` to `web:default:research-notes` also rewrites descendants such as `web:default:research:analysis` across DB tables and associated session artifacts.

## Model state across reloads

The bound native SDK conversation owns its model/context. The web UI reads current model metadata and context through the existing status snapshot; it does not hydrate a legacy session or restore context estimates from browser storage. Until that read succeeds, the UI keeps unknown values instead of inventing a model/context footprint. Preferences retain their independent owners.

## Scheduled tasks / IPC

Native agent tasks use admitted S07 occurrences and private SDK contexts with exact source/lease bindings. The scheduler reads the canonical versioned definition, dispatches that occurrence and commits result/history through its existing completion owner. It never switches/restores the public chat's model or navigates its session tree. Shell tasks and internal maintenance retain their separate host paths. See [versioned definitions](development/scheduled-task-definitions.md), [result history](development/scheduled-result-history.md) and [native caller decisions](development/native-prompt-retirement.md).

### Historical same-session scheduler (retired)

The following diagram and rationale preserve the former implementation for historical reference; they describe no supported production executor.

Scheduled tasks ran on the same `AgentSession` as normal user messages but are isolated using the **session tree**. Before executing a task, the scheduler saves the current tree position (leaf ID) and the active model. The task's prompt and response are appended to the session as usual, then the scheduler **navigates back** to the saved leaf. This leaves the task's output in a side branch of the session tree — it persists in history but does not pollute the user's conversation context.

If the task specifies a different model (e.g. a cheaper one for periodic summaries), the model is switched before execution and restored afterwards. Because the tree navigation also rewinds the conversation state, the model restore happens on the original branch where it belongs.

```mermaid
sequenceDiagram
  participant Skill
  participant IPC
  participant Scheduler
  participant DB as SQLite
  participant Pool as AgentPool
  participant Tree as Session Tree
  participant Pi as Pi SDK
  participant Web as Web UI

  Skill->>IPC: write schedule_task JSON
  Scheduler->>DB: persist task
  Scheduler->>Tree: save leaf position + model
  Note over Tree: leafId = "abc123"
  opt Task specifies model
    Scheduler->>Pool: switch model
  end
  Scheduler->>Pool: runAgent()
  Pool->>Pi: prompt()
  Pi-->>Pool: result
  Note over Tree: leaf advanced to "xyz789"
  Scheduler->>Tree: navigate back to "abc123"
  Note over Tree: task output in side branch
  opt Model was switched
    Scheduler->>Pool: restore original model
  end
  Scheduler->>DB: log run
  Scheduler-->>Web: post result
```

### Why session tree isolation matters

Without isolation, a scheduled task's prompt and response would appear in the agent's conversation context. The next user message would see the task's output, leading to confused responses. The session tree approach solves this cleanly:

- **No context pollution**: The user's conversation continues from where it left off.
- **Full history**: The task's output is preserved in a side branch and can be inspected via `/tree`.
- **Model safety**: The model is restored to its pre-task state on the correct branch.
- **No session forking**: Unlike `fork()` which creates a new session file, `navigateTree()` stays in the same file and simply moves the branch pointer.

## Session-scoped SSH remote tools

A chat can optionally switch its core file/shell tools to a remote host over SSH.

- Control surface: agent-only `ssh` tool
- Scope: one chat JID at a time
- Persistence: SQLite `ssh_configs`
- Affected tools: `read`, `write`, `edit`, `bash`

The important runtime property is that SSH mode is **live mutable** and **turn scoped**. If a warm session already exists, `ssh set` and `ssh clear` can flip the backend immediately for the next tool/model step without rebuilding the whole session. Piclaw clears live SSH redirection at the end of each agent turn; the stored chat profile remains available for later inspection or re-application.

```mermaid
sequenceDiagram
  participant Agent
  participant ssh as ssh tool
  participant Pool as AgentPool
  participant DB as SQLite
  participant Core as ssh-core wrappers
  participant Host as Local or Remote host

  Agent->>ssh: action=set target+keychain
  ssh->>Pool: setSshConfig(chatJid, config)
  Pool->>DB: upsert ssh_configs
  Pool->>Core: applyLiveSshConfig(chatJid)
  Core-->>Host: next read/write/edit/bash uses SSH
  Pool->>Core: turn-finally clearLiveSshConfig(chatJid)
  Core-->>Host: next turn starts with local core tools

  Agent->>ssh: action=clear
  ssh->>Pool: clearSshConfig(chatJid)
  Pool->>DB: delete ssh_configs row
  Pool->>Core: clearLiveSshConfig(chatJid)
  Core-->>Host: next core tool call runs locally
```

Transport semantics match the packaged SSH extension model:

- multiplexed connection reuse
- `ControlMaster=auto`
- `ControlPersist=600`
- persistent remote shell state
- configured remote cwd/home mapping

## Context conservation and tool discoverability

Several runtime choices are intentionally optimized for low-context turns and progressive discovery:

- small fixed tool baseline, plus automatic default activation for safe read-only tools and message/scheduling/attachment helpers in the current catalog, with explicit same-turn tool activation for everything else
- session-scoped infra profiles so SSH / Proxmox / Portainer state can be reused without restating connection details every turn
- compact `capabilities` output and short `recommend` results before full workflow details
- opt-in examples in `workflow_help` instead of returning bulky example payloads by default
- warm session reuse so model state and scoped tool state stay available without repeated setup

For infrastructure work, the preferred discovery path is:

`discover` → `capabilities` or `recommend` → `workflow_help` → `workflow`

For internal tools, the parallel staged path is:

`list_tools(query)` → compact summaries → on-demand parameters/details → `activate_tools` / use

Only fall back to raw `request` when the curated workflow surface is not the right fit.

## Session lifecycle (summary)

- Messages for a chat JID share a warm `AgentSession`.
- Auto‑compaction runs when the context window is tight.
- Idle sessions are evicted after a short TTL (default: 3 min main, 1 min side).
- Memory pressure mode activates above 512 MB RSS (default), shrinking the main-session pool to 1 and dropping the main idle TTL to 60 s.
- When the agent produces multiple turns in a single response (e.g. tool calls followed by a final answer), each turn’s text and attachments are stored as separate messages. The first becomes the thread root; subsequent turns carry a `thread_id` pointing back to the root. The UI renders these as indented threaded replies.

### Stuck-session escalation

When a session produces **two consecutive empty responses** (0 output chars, `stopReason: stop`) for real user messages, the runtime escalates from a silent no-op cursor advance to a **recovery-stalled card**:

- The first empty response: logged as `process_chat.no_output_noop`, a warning message is stored, and the cursor advances (handles benign restart-replay edge cases).
- The second consecutive empty response for the same chat: escalates to `process_chat.no_output_escalated`. `endChatRunWithError` is called (cursor does **not** advance), and the recovery card is posted offering `/compact` and `/new-session` options.

On the web client, a separate salvage path also exists for stalled in-flight turns with partial draft text:

- keep the last draft visible in the draft panel
- preserve the last visible tool action when available
- append a local fallback timeline post with a visible `timeout` marker

This prevents the infinite loop seen with oversized session files (≥10 MB JSONL) on the Azure Responses API, while also giving the user a more useful failure surface when the model stopped mid-answer.

See [architecture.md](architecture.md) for component layout and [tools-and-skills.md](tools-and-skills.md) for tool/skill details.
