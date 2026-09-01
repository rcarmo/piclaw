# Piclaw v2.13.2 capability matrix

Baseline: Piclaw `v2.13.2` at `0afd3ae645c423bed82deef80c343bcaa6f31d4d`.

This matrix records material agent-lifecycle behaviour. Source paths are baseline-relative. Post-release fixes are bug evidence and do not change the baseline rows.

Confidence values follow [the assessment method](../01-assessment-method.md).

## Ingress and acceptance

| ID | Capability and trigger | Preconditions and current path | State and effects | Terminal condition and evidence | Known defect | Target owner / disposition | Confidence |
|---|---|---|---|---|---|---|---|
| CAP-001 | Accept an ordinary web message | `POST /agent/:id/message`; `channels/web/handlers/agent.ts:handleAgentMessage` | Validates payload, stores user timeline row, broadcasts `new_post`, enqueues `processChat` on `chat:<jid>` | HTTP 201 after durable message row; handler and integration tests | Baseline acceptance is a message row plus cursor model, not a unified operation ledger | Piclaw; preserve acceptance and add one accepted-source sequence | Proven |
| CAP-002 | Accept a compose steer during streaming | `mode=steer`, `agentPool.isStreaming(jid)` | Calls `queueStreamingMessage`; stores/publishes steering metadata and tracks timestamp in memory on web paths | HTTP 201 when SDK queue accepts; queue/runtime tests | In-memory pending-steer accounting can be lost at restart and lacks exact operation ownership | Piclaw accepts; Earendil executes `steer()` on correlated run; replace accounting | Proven |
| CAP-003 | Accept a queued follow-up | Active session or explicit `/queue`; handler and queued-followup lifecycle | Persists deferred item in `chat_cursors.queued_followups_json`; some command paths use timeline placeholders | HTTP 201 and SSE queue event | Two storage layers and synthetic IDs complicate restart and deduplication | Piclaw; preserve user-visible durable FIFO, map delivery explicitly | Proven |
| CAP-004 | Reorder or remove queued follow-up | Queue control-plane endpoint with row ID | Mutates deferred JSON or placeholder store; may delete backing timeline row; broadcasts queue event | JSON response reports result | Cross-store identity and transaction boundaries are bespoke | Piclaw; preserve as accepted-source mutation, simplify storage | Source-only |
| CAP-005 | Convert queued follow-up to steer | `/agent/queue-steer` | Removes queue item, stores steer row, injects into active SDK session if streaming | Queued steer or ordinary message fallback | Removal, message persistence and SDK injection span separate owners | Piclaw accepts atomically; Earendil delivery follows owner fence | Proven |
| CAP-006 | Accept control command | Parsed in web handler or polled channel message loop | Some commands execute inline, some become deferred control messages, some mutate session/model/tree | Command result or queued work | Command durability and owner vary by command/path | Piclaw authorises and records; harness executes only execution-plane controls | Source-only |
| CAP-007 | Accept scheduled agent task | Scheduler polls durable task rows and enqueues task lane | Saves tree/model, calls `runAgent`, restores state, writes run log and optional delivery | Task status and run log updated | Post-release incident found duplicate agent output delivery | Piclaw scheduler and delivery; harness executes one correlated run | Proven |
| CAP-008 | Accept scheduled shell task | Durable task row; `runScheduledTask` | Executes validated shell command, logs output, applies notification policy | Task status and run log updated | No harness migration required except shared scheduler boundary | Piclaw; preserve unchanged | Proven |
| CAP-009 | Run Dream/AutoDream | Manual command, IPC or scheduled task on `dream:<jid>` lane | Creates temporary chat/session, applies tool ceiling, calls `runAgent`, refreshes memory index and cleans up | Dream result and workspace changes | Uses same orchestration with special timeout/tool policy | Piclaw schedules; harness executes isolated lane with explicit resources | Source-only |
| CAP-010 | Run side prompt | BTW/card/internal side-prompt endpoint | Seeds side session from main, streams model result without appending to main tree | JSON/SSE side-prompt result | Separate execution primitive overlaps Earendil lane semantics | Selected-version `AgentLane` or dedicated Earendil session; preserve isolation | Proven |
| CAP-011 | Accept non-web channel input | `runtime/message-loop.ts` polls router messages by chat | Stores/reads channel state, executes commands, calls `runAgent`, sends channel response | Channel cursor updated and response delivered | Different persistence/finalisation path from web | Piclaw service plane; unify accepted-source contract before harness call | Source-only |
| CAP-012 | Accept trusted/add-on initiated work | Runtime public surface, card actions, IPC and add-on handlers | Routes into message/control/side-prompt surfaces with varying persistence | Endpoint/tool-specific | Trusted paths can bypass ordinary acceptance assumptions | Piclaw; require a named acceptance class and owner for every path | Source-only |

## Selection, ordering and ownership

| ID | Capability and trigger | Preconditions and current path | State and effects | Terminal condition and evidence | Known defect | Target owner / disposition | Confidence |
|---|---|---|---|---|---|---|---|
| CAP-013 | Serialise queued work by lane | `AgentQueue.enqueue(fn,id,laneKey)` | Per-lane FIFO, key dedupe, bounded retry/backoff | Task resolves or exhausts retry | Queue task identity is not durable acceptance identity | Piclaw dispatch; keep as wake mechanism only, not source of truth | Proven |
| CAP-014 | Select next web message | `processChat` reads after `chat_cursors.cursor_ts` | Selects earliest message, resolves thread root and failed-run state | One message selected or no work | Timestamp cursor is an indirect ownership frontier | Piclaw; replace with accepted-source sequence/frontier | Proven |
| CAP-015 | Mark preflight/inflight | `runProcessChatPreflight`; `beginChatPreflight`, promote or `beginChatRun` | Advances cursor and stores preflight/inflight metadata in one cursor row | Promoted to prompt or deferred/failed | State is split across cursor columns and session activity | Piclaw; preserve durable claim with exact operation ID | Proven |
| CAP-016 | Hold failed turn | `endChatRunWithError` | Clears inflight, records failed message/thread/cursor metadata | Explicit retry, skip or later success | Failed marker is chat-scoped, not a first-class immutable disposition | Piclaw; model as operation disposition plus blocked frontier | Proven |
| CAP-017 | Track active SDK state | `AgentPool`/runtime facade maps chat to warm session | Reads `isStreaming`, `isCompacting`, `isRetrying`, bash state | Cleared when session settles/evicts | In-memory activity can diverge from durable work | Earendil reports execution state; Piclaw never uses it as acceptance proof | Proven |
| CAP-018 | Maintain session tree position | Session manager and runtime facade | Saves/restores leaf; scheduler and branches navigate tree | Leaf restored or navigation fails | Piclaw and SDK both own pieces of session/tree lifecycle | Earendil `Session`/lanes; Piclaw stores correlation only | Proven |
| CAP-019 | Correlate web turn for UI | `turnId`, chat ID, session leaf in run options/status events | Emits transient status, thought and draft buffers | Done/error status or disconnect | No durable exact operation ID on baseline UI path | Piclaw operation ID projected through Earendil run correlation | Source-only |

## Harness execution

| ID | Capability and trigger | Preconditions and current path | State and effects | Terminal condition and evidence | Known defect | Target owner / disposition | Confidence |
|---|---|---|---|---|---|---|---|
| CAP-020 | Create/reuse warm main session | `AgentPool.sessionManager.getOrCreate` | Loads resources, model, JSONL tree, tools and extension hooks; caches per chat | Runtime available or creation fails | Warm mutable session is also orchestration state | Direct selected `AgentHarnessConstructor`/`SessionRepo`; Piclaw supplies exact `AgentHarnessOptions` | Proven |
| CAP-021 | Prompt model | `runAgentPrompt` → `runPromptAttempt` → `session.prompt` | Subscribes to SDK events, starts timeout/watchdog, streams model/tool activity | Attempt snapshot and `AgentOutput` | Large callback-owned mutable state and timer races | Earendil harness; replace Piclaw loop | Proven |
| CAP-022 | Stream thoughts/drafts/final text | Turn coordinator and web streaming runtime | Buffers deltas, emits SSE, commits intermediate completed turns | Final text/attachments, tool-only result or error | Streamed and final message authority can disagree | Earendil events plus Piclaw redacted projector; final result from harness outcome | Proven |
| CAP-023 | Execute tools | SDK AgentSession with Piclaw tool registry | Validates/adopts tools, emits lifecycle, runs local/remote effects | Tool result appended or error | Piclaw patches tool admission and tracks parallel calls externally | Earendil tool lifecycle, stable invocation identity and `Gate.admit()`; Piclaw supplies direct tools/context, never duplicate execution | Proven |
| CAP-024 | Enforce active tool set | Tool activation extension, ceilings and recovery patches | Mutates `setActiveToolsByName`, remembers prior subset | Set restored after turn/recovery | Nested mutable patches can restore stale policy | Harness v3 total `lane.config` plus direct owner-fenced setters | Proven |
| CAP-025 | Enforce tool budget | Attempt tool-budget controller and optional max call cap | Wraps `beforeToolCall`, reserves IDs, blocks/aborts at limits | Closing reply, tool-budget terminal error or abort | Message counts and executions need careful parallel accounting | Harness v3 typed hooks/tool state with Piclaw policy; semantic contract required | Proven |
| CAP-026 | Detect repeated mutation | Baseline has repetition/tool controls but no accepted durable quarantine protocol | Tracks tool names/results in attempt-level state | Blocks or errors according to policy | Post-release containment work regressed and was rolled back | Policy at harness hook; durable containment owner must be specified | Source-only |
| CAP-027 | Record usage | SDK events, context estimator and token-usage DB | Stores model usage and projects context percentage | Usage available or unknown | Several estimates and nullable sources | Harness v3 usage ledger; Piclaw persists billing/UI projection | Proven |
| CAP-028 | Change model/thinking/tools | Control commands and runtime facade | Mutates warm session and persists some state in session tree/config | Command success/error | Control can race active execution and session replacement | Piclaw authorises; Harness v3 atomically replaces total `lane.config` | Proven |
| CAP-029 | Execute extension hooks/resources | Coding-agent resource loader and extension runner | Loads tools, commands, skills, prompt templates and hooks | Hook result or error | Existing extensions target AgentSession APIs | Direct Earendil `Resources`, `HarnessTool` and `Hooks`; Piclaw commands remain service-side | Source-only |

## Compaction, timeout and recovery

| ID | Capability and trigger | Preconditions and current path | State and effects | Terminal condition and evidence | Known defect | Target owner / disposition | Confidence |
|---|---|---|---|---|---|---|---|
| CAP-030 | Pre-prompt auto-compaction | Context estimate before prompt | Runs bounded compaction; may defer, rotate or refuse prompt | Ready, deferred or failed | Piclaw suppresses private upstream compaction methods | Earendil compaction operation and policy; remove private patches | Proven |
| CAP-031 | In-turn/context-pressure recovery | Attempt classifier detects pressure | Compacts, may rotate, then neutral continuation with bounded budget | Recovered output or terminal failure | Complex budget and continuation semantics live outside SDK | Earendil compaction/resume; Piclaw only sets product policy and settlement | Proven |
| CAP-032 | Manual compaction | Slash/session control | Calls SDK compact with timeout/backoff and UI status | Command result and context update | Can race prompt/session ownership | Piclaw control fence; Earendil `compact()` exact run | Proven |
| CAP-033 | Rotate oversized/corrupt session | Size/line/compaction threshold or recovery failure | Compacts or archives/replaces JSONL session, refreshes runtime | New session or failure | Rotation changes mutable session captured by callbacks; Earendil PR #7751 demonstrates concurrent rewrite races | Earendil Session/Branch/fork/navigation plus host-owned writable authority; selected migration/fork proof required | Proven |
| CAP-034 | Retry transient provider failure | Recovery classifier and policy | Delays, continues persisted context, limits attempts and total budget | Recovered or exhausted | Text classification remains compatibility fallback | Harness v3 captured generation/retry state; Piclaw maps product-facing reason | Proven |
| CAP-035 | Finalise after tool-only stop | No closing assistant text after resolved tools | Temporarily disables tools and requests closing prose, or reports tool-complete | Success, protected hand-off or error | Authority of tools-disabled prose is fragile | Earendil harness outcome/terminate semantics; contract scenario | Proven |
| CAP-036 | Prompt timeout | Turn coordinator timer | Aborts session, records cause, classifies attempt | Recovery or timeout terminal | Timer can race provider/tool completion | Piclaw deadline triggers exact abort; Earendil durable control plus process-local gate orders later admission, while admitted-effect outcomes still require reconciliation | Proven |
| CAP-037 | Progress watchdog | Runtime phase heartbeat and aborter | Tracks last progress across prompt/tool/compaction and aborts stale run | Recovery/stalled-work error | Chat-scoped heartbeats can receive stale events | Harness v3 typed operation events/snapshot; Piclaw watchdog keyed by correlation | Proven |
| CAP-038 | Tool execution heartbeat | Attempt-level active tool map and timer | Emits watchdog/UI heartbeat during quiet tools | Tool end or attempt cleanup | Anonymous/missing IDs weaken ownership | Harness v3 typed tool events/runningTools snapshot; preserve UI heartbeat projector | Proven |
| CAP-039 | Recovery loop guard | Chat-scoped recent failure signatures | Suppresses repeated classifier/strategy within time window | Terminal recovery-suppressed error | In-memory guard does not survive restart | Earendil/Piclaw policy state must be explicit and bounded | Proven |
| CAP-040 | Protected recovery hand-off | Recovery cannot authoritatively complete without tools | Returns `requiresToolEnabledContinuation`; web queues protected continuation | Later ordinary turn or terminal error | Split ownership across recovery and web queue | Piclaw accepts continuation; Earendil executes new correlated run | Proven |

## Persistence, settlement and restart

| ID | Capability and trigger | Preconditions and current path | State and effects | Terminal condition and evidence | Known defect | Target owner / disposition | Confidence |
|---|---|---|---|---|---|---|---|
| CAP-041 | Persist completed assistant turn | `onTurnComplete` and final output in `processChat` | Stores timeline row, attachments, thread relation and markers; broadcasts response | Row ID or storage failure | Intermediate and terminal writes occur through callbacks before final run outcome | Piclaw timeline effector with operation/run owner and idempotency key | Proven |
| CAP-042 | Persist draft fallback | Error/empty final with usable streamed draft | Stores salvaged terminal response and timeout/recovery markers | Row persisted or failure held | Client and server salvage paths can overlap | Piclaw settlement policy; one terminal disposition | Proven |
| CAP-043 | Finalise successful web run | Terminal row persisted; `finalizeSuccessfulProcessChatRun` | Clears inflight/failed, advances pending steer cursor, wakes persisted and queued work | Chat returns idle or next work queued | Writes and wake-up span separate state mechanisms | Piclaw atomic settlement/outbox | Proven |
| CAP-044 | Finalise failed web run | No acceptable terminal artifact | Rolls cursor back or writes failed marker and visible failure state | Held for explicit action | Error paths vary by failure class | Piclaw immutable failed disposition and blocked frontier | Proven |
| CAP-045 | Recover inflight run at startup | Cursor has preflight/inflight marker | Inspects replies, compaction and draft state; transactionally clears/rolls back; enqueues resume | Run classified and wake queued | Heuristics infer completion from multiple stores | Piclaw reconciles operation ledger with Earendil suspended runs | Proven |
| CAP-046 | Resume pending chats | Startup IPC or operator request | Reads all cursors/messages and enqueues `processChat` per chat | Queue wake accepted | Wake dedupe is not durable source ownership | Piclaw; retain as idempotent dispatcher only | Proven |
| CAP-047 | Persist SDK transcript | AgentSession JSONL/session manager | Appends user, assistant, tool, compaction and branch entries | Session flush/close | Piclaw has no Harness v3 `SessionRepo` implementation in baseline | Earendil `SessionRepo`/`Storage`; select a conformant tagged backend with total migrations and rewrite fencing | Proven |
| CAP-048 | Evict/shutdown sessions | Idle timer, memory pressure or service shutdown | Waits/disposes sessions, clears maps and tool/process resources | Session closed | Active ownership inferred from mutable flags | Earendil `close`/lane state plus Piclaw service shutdown fence | Proven |
| CAP-049 | Persist restart hand-off | Explicit reload with optional continuation | Writes restart record and recovers it after startup into visible post/turn | Completion and optional continuation | Separate from normal accepted-source lifecycle | Piclaw; unify as accepted continuation class | Proven |

## Cancellation and controls

| ID | Capability and trigger | Preconditions and current path | State and effects | Terminal condition and evidence | Known defect | Target owner / disposition | Confidence |
|---|---|---|---|---|---|---|---|
| CAP-050 | Abort active session | `/abort`, session control or shutdown | Baseline calls generic `applyControlCommand`/session abort using chat activity | SDK abort result and status | No exact durable operation fence; replacement run can be targeted | Piclaw exact owner authorises; Earendil `abort()` correlated run | Proven |
| CAP-051 | Stop process/tool groups | Abort signal, tracked bash/SSH process registry | Sends interrupt/termination and updates tool result | Process exits or escalates | Cancellation must remain associated with original operation | Tool effector and Earendil abort signal; Piclaw records cause | Source-only |
| CAP-052 | Retry or skip held run | Recovery card, model switch or session control | Rewinds/advances cursor, clears failed marker, wakes chat | Run pending or skipped | Chat-scoped marker can be stale | Piclaw operation disposition transition | Proven |
| CAP-053 | Compact/switch/rotate while active | Slash or session-control action | Checks streaming flags; may reject or force control | Control result | Generic active-state checks are not exact owner fences | Piclaw control intent targets operation/run/generation | Source-only |

## Projection and delivery

| ID | Capability and trigger | Preconditions and current path | State and effects | Terminal condition and evidence | Known defect | Target owner / disposition | Confidence |
|---|---|---|---|---|---|---|---|
| CAP-054 | Emit live agent status | SDK events and web streaming runtime | Writes in-memory status store, SSE events and progress metadata | Done/error/idle projection | Multiple producers can overwrite meaningful or newer state | Boundary projector keyed by Piclaw operation and Earendil run/event seq | Proven |
| CAP-055 | Preserve thought/draft buffers | Turn ID plus panel buffers | Stores transient buffers and optional persisted thought content | Final row or cleanup | Reconnect/generation races have caused reset/duplication | Piclaw UI projection; fence by SSE generation and run | Proven |
| CAP-056 | Show context/recovery markers | Context usage and recovery metadata | Persists content blocks/status chips and updates compose UI | Timeline/status visible | Projection relies on bespoke classifiers | Piclaw projector over typed harness/Piclaw outcomes | Proven |
| CAP-057 | Deliver channel response | Web timeline persistence or non-web `sendMessage` | Sends response and advances channel state | Delivery success/failure | Scheduler and run output ownership can duplicate delivery | Piclaw delivery outbox; exactly one owner | Source-only |
| CAP-058 | Send Pushover notification | Task/message completion policy | Enqueues notification independently from timeline/shell delivery | Notification sent or logged failure | Must not be conflated with agent response ownership | Piclaw; preserve semantics | Source-only |
| CAP-059 | Mobile Compose Abort | Stop button while UI says active | Baseline relies on transient agent status without durable exact owner | Abort command result | Operationally failed with missing authority after post-release campaign | Piclaw exact operation status; installed-browser contract test | Proven operational defect |

## Coverage gaps

The inventory is sufficient for architecture ownership, but these rows need stronger evidence before implementation:

- trusted/add-on initiated work (`CAP-012`);
- non-web finalisation parity (`CAP-011`, `CAP-057`);
- tool process-group cancellation (`CAP-051`);
- extension hook compatibility (`CAP-029`);
- durable containment policy (`CAP-026`);
- shell task and Pushover delivery isolation (`CAP-008`, `CAP-058`).

The contract plan assigns explicit scenarios to each gap rather than assuming baseline correctness.
