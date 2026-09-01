# Piclaw effector inventory

Baseline: Piclaw `v2.13.2` at `0afd3ae645c423bed82deef80c343bcaa6f31d4d`.

An effector performs one external query or mutation from an explicit request. It does not choose the next lifecycle state, retry policy, owner or terminal outcome. See [the assessment method](../01-assessment-method.md).

## Classification

| ID | Current module/surface | Classification | Reason | Target action |
|---|---|---|---|---|
| EF-001 | `db/messages.ts`, media accessors and low-level message write helpers | Reusable behind Piclaw service port | SQLite persistence is an external effect; low-level calls do not need to decide harness state | Compose into operation-aware timeline transaction/idempotency contract |
| EF-002 | `channels/web/messaging/agent-message-store.ts:storeAgentTurn` | Reject as effector | Mixes placeholder consumption, formatting, message persistence, auxiliary callback, SSE, Web Push and terminal policy | Split into timeline transaction, projection broadcast and notification effectors |
| EF-003 | `db/chat-cursors.ts` cursor/preflight/inflight/failed helpers | Replace | Encodes current state machine and recovery policy in cursor fields and composite helpers | New Piclaw accepted-source/operation store; retain low-level SQLite connection/migration utilities |
| EF-004 | `get/setDeferredQueuedFollowups` JSON queue helpers | Replace | Full-list JSON writes and synthetic row IDs are the current queue model | Accepted-source rows and ordered successor/steer intents |
| EF-005 | `db/connection.ts:getDb`, migration and transaction mechanism | Reusable | Storage mechanism, no agent lifecycle decision required | Use for Piclaw operation ledger/outbox migrations |
| EF-006 | `AgentQueue` | Reusable only as dispatcher | Serialises and retries closures but is not durable acceptance and contains generic retry policy | Keep as idempotent wake/worker mechanism; derive tasks from durable pending work |
| EF-007 | `AgentPool` | Reject | Central current orchestrator: session cache, run/recovery, controls, tools, branches and status | Replace with Piclaw service coordinator plus Earendil harness registry |
| EF-008 | `run-agent-orchestrator.ts` | Reject | Implements prompt lifecycle, timers, tool policy, compaction, retries, status and cleanup | Harness v3 interpreter, lane-owned Drive and `Gate.admit()` own execution/admission; Piclaw supplies service policy and projects events |
| EF-009 | `run-agent-recovery-phase.ts` | Reject | Decides recovery strategy, budgets, compaction, rotation, tool suppression and terminal outcome | Adopt Harness v3 flat operation state, intent/effect/settlement and public resume semantics; retain only Piclaw service policy |
| EF-010 | `run-agent-attempt-finalization.ts` | Reject | Classifies provider/tool facts into terminal/recovery outcomes | Harness contract returns typed outcome; Piclaw maps to service disposition without prose classification |
| EF-011 | `agent-pool/compaction.ts` | Split | Estimation and product thresholds may be policy; execution, timeout, single-flight and recovery are orchestration | Earendil compaction operation; Piclaw may provide threshold settings and UI projection |
| EF-012 | `session-rotation.ts`, branch seeding | Replace with direct Harness v3 session operations | Mixes archive/session creation with fallback and recovery policy | Use selected v3 `SessionRepo`, lanes, navigation/fork; keep only Piclaw chat correlation/archive policy |
| EF-013 | `agent-pool/session-manager.ts` | Reject | Cache, creation, branch realization, model restore, side session sync, eviction and shutdown policy | Harness v3 registry/session lifetime and selected backend own execution resources; Piclaw retains service correlation/cache policy only where needed |
| EF-014 | `agent-pool/session-persistence.ts` and JSONL bridge | Replace with coherent Harness v3 backend | Targets legacy `SessionManager`/v2 shape | Adopt selected v3 `Storage`/`SessionRepo`; require unchanged conformance, selected migration, host ownership and fork tests |
| EF-015 | `agent-pool/sqlite-session-store.ts` prototype | Evidence only | Non-shipping schema is incompatible with Harness v3's planned per-session storage/register model | Do not adopt; use benchmark/fault evidence when selecting the v3 SQLite slice |
| EF-016 | `createTrackedBashOperations` | Replace with direct Harness v3 environment/tool composition | Legacy `BashOperations` overlaps Earendil `ExecutionEnv`, `createBashTool` and built-in truncation/update semantics | Implement Piclaw requirements in `ExecutionEnv`; supply it through v3 `toolContext`; use public `createBashTool`; set `replay: "never"` |
| EF-017 | read/write/edit tools | Replace legacy definitions with public Earendil tools | Earendil already implements contextual tools, `ExecutionEnv`, path handling, mutation queue, truncation and result details | Use selected Harness v3 `AgentHarnessTool<PiclawToolContext>` definitions directly with explicit replay metadata |
| EF-018 | image/browser/integration/add-on tools | Direct Harness v3 tool implementations after review | These remain application capabilities but must use Earendil's exact selected tool types and semantics | Implement/satisfy `AgentHarnessTool<PiclawToolContext,...>` directly; no Piclaw tool interface |
| EF-019 | `extensions/ssh-core.ts` | Reimplement as `ExecutionEnv` backend | Remote filesystem/shell routing overlaps Earendil `FileSystem`/`Shell`; live profile mutation remains service policy | Provide local/SSH `ExecutionEnv` instances with exact no-throw `Result` errors; Harness v3 resolves selected context once per tool batch |
| EF-020 | `ModelRuntime`, model registry and credential store | Reuse directly, subject to selected v3 API | `ModelRuntime implements Models`; `FileCredentialStore implements CredentialStore` | Pass concrete `ModelRuntime` through v3 options; adopt any selected `Models` changes directly; no model effector wrapper |
| EF-021 | coding-agent resource loader/extensions | Split; use Earendil resources/tools/hooks directly | Skills/templates/tools have public contracts; legacy extension commands/hooks target AgentSession | Supply selected Harness v3 `Resources`, `Skill`, `PromptTemplate`, generic tools and typed hooks; retain Piclaw commands in service plane |
| EF-022 | `task-scheduler.ts` | Split | Polling and schedule computation are service effects; task execution and delivery are mixed in one function | Piclaw scheduler accepts/claims task; call `AgentLane.prompt` directly; separate timeline, log, Pushover and shell effects |
| EF-023 | scheduled task DB accessors | Reusable behind Piclaw service contract | Durable schedule/run-log persistence remains outside Earendil | Add claim/idempotency semantics and explicit delivery IDs |
| EF-024 | `runtime/progress-watchdog.ts` | Split | Timer/monitor mechanism is reusable; chat-scoped phase policy is current orchestration | Observe Earendil events/watchers and exact run; invoke `AgentLane.abort` after Piclaw cancellation fence |
| EF-025 | `utils/process-tracker.ts` | Fold into `ExecutionEnv`/cleanup | Earendil environment owns process execution/cleanup and AbortSignal semantics | Implement required tracking inside Piclaw `ExecutionEnv`; do not expose a second process port to harness |
| EF-026 | web SSE broadcaster/status store | Split | Transport is reusable; current status producers and merge rules are policy | Project narrowed/redacted Earendil events/snapshots into Piclaw DTOs; transport remains Piclaw |
| EF-027 | Web Push/Pushover delivery | Reusable | Named delivery effect independent of harness execution | Trigger from Piclaw delivery outbox with per-effect idempotency key |
| EF-028 | channel `sendMessage` | Reusable behind Piclaw delivery contract | External delivery action; must not decide whether execution owns output | Piclaw outbox calls exactly once according to task/channel policy |
| EF-029 | attachment registry/media creation | Reusable | Storage/correlation effect outside harness transcript | Associate media with Piclaw operation and terminal message transaction |
| EF-030 | keychain providers | Service/tool-context input | Provider credentials already use direct Earendil `CredentialStore`; shell/tool secrets belong in environment preparation | Keep direct `CredentialStore`; resolve non-provider secrets inside Piclaw `ExecutionEnv`/tool context; never journal values |
| EF-031 | structured logger/telemetry | Use Earendil telemetry directly plus Piclaw parent spans | Earendil exports harness/AI schemas and `TelemetryContext` | Pass `AgentHarnessOptions.context`; add only Piclaw service-plane acceptance/settlement spans |
| EF-032 | `runtime/restart-handoff.ts` | Replace protocol, reuse storage primitives | Implements a separate continuation lifecycle | Model reload continuation as accepted source and operation outbox |
| EF-033 | side-prompt runner | Replace with `AgentLane` | Implements parallel mini execution loop/session sync | Use named/ephemeral Earendil lane and direct `Session` context/branch operations |
| EF-034 | branch manager/chat registry | Split | Chat identity/archive are Piclaw service concerns; session tree mechanics belong Earendil | Keep chat registry; map branches to direct `SessionRepo`/lane operations |
| EF-035 | agent-control handlers | Split | Authentication/parsing is service policy; handlers mutate legacy session runtime | Retain command registry/authorisation; call exact `AgentHarness`/`AgentLane` methods and preserve their result types |
| EF-036 | `formatOutbound` and UI content-block render helpers | Reusable projection | Pure formatting/presentation where it does not infer lifecycle state | Apply after Earendil typed outcome and Piclaw disposition; no prose classification |

## Required target contracts

The detailed direct-import design is in [`earendil-native-effector-contracts.md`](earendil-native-effector-contracts.md).

### Piclaw service-plane ports

Piclaw-specific ports exist only for responsibilities outside Earendil. They use Earendil's exported generic `Result` and `TaggedError` utilities rather than a second result convention.

The implementable interface set is specified in [`future-effector-specifications.md`](future-effector-specifications.md):

| ID | Interface | Responsibility |
|---|---|---|
| EF-S01 | `ServiceWorkStore` | Accepted sources, owner/version, cancellation and harness correlation |
| EF-S02 | `TerminalSettlementStore` | Atomic service terminal transaction |
| EF-S03 | `TimelineDraftStore` | Non-terminal drafts and service notices |
| EF-S04 | `OperationMediaStore` | Media storage and operation binding |
| EF-S05 | `ServiceOutboxStore` | Durable post-commit intent and lease state |
| EF-S06 | `DeliveryDriver` | One external delivery attempt and certainty result |
| EF-S07 | `ScheduledRunStore` | Scheduled occurrence, lease, result and next occurrence |
| EF-S08 | `AgentProjectionSink` | Already narrowed/redacted web projection transport |
| EF-H01 | `ExecutionContextResolver` | Piclaw routing to direct Earendil `ExecutionEnv` values |

All mutations carry Piclaw `operationId` where applicable, accepted-source sequence, expected operation version, idempotency key, request hash, redaction class and provenance.

`TerminalSettlementStore.commitTerminal()` is the only Piclaw terminal mutation. In one SQLite transaction it persists the immutable disposition and terminal timeline/media row, consumes or disposes claimed sources, advances the frontier, releases ownership and appends successor, delivery and maintenance outbox records. Intermediate timeline writes cannot settle an operation.

### Earendil harness contract

Piclaw calls the exported `AgentHarness` and `AgentLane` directly. It does not define a narrower execution port with renamed methods or results.

```typescript
import type {
  AgentHarness,
  AgentLane,
  RunResult,
  QueueResult,
  CompactionResult,
  AbortResult,
  ResumeResult,
} from "@earendil-works/pi-agent-core";

const run: RunResult = await lane.prompt(prompt);
const steer: QueueResult = await lane.steer(message);
const compaction: CompactionResult = await lane.compact();
const abort: AbortResult = await lane.abort();
const resumed: ResumeResult = await lane.resume();
```

Piclaw stores correlation beside the actual harness/lane objects and verifies the expected Piclaw and Earendil operation IDs before calling them. Expected rejection remains Earendil's tagged error union.

### Earendil tool and environment contracts

Target tools are Harness v3 `AgentHarnessTool<TContext>` directly, with `AgentTool.replay: "safe" | "never"` (omission defaults to `never`). Filesystem and shell operations implement `ExecutionEnv` and return Earendil `Result<T, FileError | ExecutionError>` semantics. Do not add a `PiclawToolEffect`, custom filesystem result or duplicate tool-result type.

Prefer Earendil's public `createReadTool`, `createWriteTool`, `createEditTool` and `createBashTool`. Piclaw-specific tools retain Earendil's execute signature, `AgentToolResult`, update callback, execution mode and terminate semantics.

### Projection boundary

A future projection coordinator narrows selected Earendil snapshots/events, verifies `(chatJid, piclawOperationId, harnessOperationId, generation, receiptSeq)`, and builds allowlisted Piclaw DTOs. The Piclaw-owned `AgentProjectionSink` only transports those DTOs. Raw tool arguments/results are excluded by default.

## Fake requirements

Each port gets an in-memory deterministic fake with:

- injected monotonic clock and ID source;
- append-only call/result trace;
- configurable fault point before effect, after effect and after acknowledgement;
- duplicate call handling by idempotency key;
- delayed/late completion controls;
- crash snapshot and restore;
- payload redaction assertions.

The fake accepted-source and terminal-settlement stores must implement the same semantic model as the SQLite adapters without sharing their implementation code. The selected-version Harness v3 fixture should use that version's public Memory `Storage`/`Session` and instrumented commit decorator; it must not import Piclaw's existing agent orchestration.

## Tool replay policy

Initial classes:

| Tool/effect class | Replay policy | Examples |
|---|---|---|
| Pure read/query | `safe` | read, search, list, status, bounded introspection |
| Idempotent write with explicit key/version | `safe` after reconciliation | outbox delivery with unique ID, compare-and-set state |
| General mutation | `never` | edit, write, delete, shell, remote workflow, send message |
| Terminal UI/process action | `never` | send card/widget, exit/restart, notification |
| Unknown add-on tool | `never` by default | dynamically installed tools without reviewed metadata |

A restored Harness v3 tool in `effect_pending` is replayed only when both persisted and current declarations are `safe`; otherwise Earendil settles an interrupted result under the reserved ID. `Gate.admit()` is process-local and does not prove whether the external effect happened. Piclaw does not replay it independently.

## Preparation rule

No current module is selected merely because it has tests. An adapter specification requires a narrow target port, explicit owner identity, deterministic fake and fault-boundary contract. Current orchestration modules remain behavioural evidence; these specifications do not change their callers or authority.
