# Agent-turn state-machine assessment

Piclaw should adopt a typed turn state model with a pure transition reducer and explicit effect commands. A single large finite-state enum would hide important parallel facts, so the recommended model combines a small stage machine with orthogonal typed state fields.

No redesign is implemented by this audit.

## Current execution path

A normal web turn crosses these owners:

1. `handleAgentMessage()` validates and stores the user message.
2. `processChat()` selects one pending message and resolves its thread root.
3. `runProcessChatPreflight()` records preflight state, runs bounded pre-prompt compaction, and may defer or emergency-rotate.
4. `createProcessChatStreamingRuntime()` creates the turn ID, status stream, draft/thought buffers and progress metadata.
5. `runAgentPrompt()` creates or rotates the session, applies tool controls, starts watchdog tracking and calls recovery orchestration.
6. `runAgentRecoveryPhase()` runs one or more prompt attempts and decides retry, compact-and-retry, tools-disabled finalisation, rotation or terminal failure.
7. `runPromptAttempt()` subscribes to SDK events, tracks model output and tools, enforces budgets and timeouts, then finalises one attempt.
8. `finalizePromptAttemptOutput()` converts event facts into one `AgentOutput` and one recovery snapshot.
9. `processChat()` persists an intermediate turn, final reply, recovered draft, tool-complete marker or failure marker.
10. `finalizeSuccessfulProcessChatRun()` ends inflight state, advances the cursor, publishes status and materialises the next queued follow-up.

Several modules mutate the same conceptual turn through callbacks, database rows, maps and session object patches. Correctness depends on ordering between them.

## Tracked turn aspects

A deterministic design must track these fields explicitly.

| Aspect | Valid values |
|---|---|
| Stage | `selected`, `preflight`, `ready`, `attempting`, `classifying`, `recovering`, `persisting`, `terminal` |
| Message ownership | message ID, row ID, thread root row ID, chat cursor before run |
| Session ownership | session leaf ID, session generation/epoch, runtime reference |
| Attempt | ordinal, prompt kind, start time, deadline, finalisation deadline |
| Provider | `not_started`, `waiting_first_event`, `streaming`, `ended`, `threw` |
| Output | no text, commentary, intermediate text, final text, attachments, usage |
| Tool admission | active tool-set fingerprint, ceiling, completed count, reserved IDs, blocked IDs |
| Tool execution | per-call `admitted`, `running`, `succeeded`, `failed`, `blocked`, `orphaned` |
| Compaction | `not_needed`, `running`, `succeeded`, `failed`, `suppressed`, `timed_out` |
| Rotation | `not_requested`, `running`, `succeeded`, `failed` |
| Recovery | classifier, strategy, attempt count, budget used, tools policy, loop signature |
| Cancellation | cause, operation, requested time, settled time, owning attempt |
| Persistence | user durable, intermediate durable, terminal durable, cursor committed |
| Queue | none, reserved, enqueued, materialised, consumed, retrying, dropped |
| Watchdog | phase, last progress sequence, deadline, abort requested |
| Terminal outcome | `success`, `tool_complete`, `interrupted`, `retryable_failure`, `terminal_failure` |

Fields should use discriminated unions. Invalid combinations such as `provider=not_started` with `final_text`, or `cursor_committed=true` with `terminal_durable=false`, should not compile or should fail reducer validation.

## Stages and required outputs

### 1. Selected

Input:

- chat ID;
- pending message;
- previous cursor;
- optional requested thread root.

Required output:

- `TurnSelected` with stable `turnId`, message row ID and resolved lineage;
- or `NoWork`;
- or `StaleFailedRunCleared`.

No provider or tool effect is allowed.

### 2. Preflight

Inputs are `TurnSelected` and a session snapshot.

Required output is one of:

- `PreflightReady`;
- `PreflightDeferred` with a durable resume command;
- `PreflightRotated` with a new session epoch;
- `PreflightFailed` with no inflight promotion.

Promotion to inflight must be one explicit effect after `PreflightReady`.

### 3. Attempting

Inputs are the session epoch, prompt, attempt budget and tool policy.

The reducer consumes ordered events:

- provider start/update/end;
- tool requested/admitted/start/update/end;
- timeout or watchdog signal;
- compaction event;
- external cancellation.

Required output is `AttemptSnapshot`. It contains facts only. It does not decide recovery and does not write terminal web output.

### 4. Classifying

A pure function maps `AttemptSnapshot` and policy to:

- `CompleteSuccess`;
- `CompleteViaTool`;
- `Retry`;
- `CompactThenRetry`;
- `RotateThenContinue`;
- `FinaliseWithoutTools`;
- `Stop`.

The output includes a stable classifier and reason code. Text for logs and UI is rendered from the reason code later.

### 5. Recovering

Recovery executes the command emitted by classification. Every command returns a typed result:

- retry delay elapsed or cancelled;
- compaction succeeded, failed or timed out;
- rotation succeeded with a new epoch or failed;
- tool policy installed or unavailable.

Recovery returns to `Attempting` only with an explicit next prompt, session epoch, attempt deadline and tool policy.

### 6. Persisting

Persistence receives one terminal decision and emits:

- `TerminalStored(rowId)`;
- `TerminalStoreFailed`;
- optional `ContinuationReserved` and `ContinuationStored` after terminal storage;
- `CursorCommitted` only after terminal storage.

The queue ledger and queued row should be written in one SQLite transaction where possible.

### 7. Terminal

The terminal record contains:

- outcome kind;
- durable row ID or explicit persistence failure;
- recovery metadata;
- abort provenance;
- cursor result;
- next-work command.

No stale callback may change a terminal turn.

## Transition matrix

| Current stage | Event or condition | Next stage | Required command or output |
|---|---|---|---|
| selected | introspection unavailable | ready | begin inflight run |
| selected | compaction needed | preflight | start bounded compaction |
| preflight | foreground budget elapsed | preflight | persist deferred resume |
| preflight | compaction success | ready | promote preflight to inflight |
| preflight | compaction failure | recovering | emergency rotation |
| ready | session epoch acquired | attempting | prompt provider |
| attempting | tool request below budget | attempting | admit call and record ID |
| attempting | tool request at budget | attempting | block call, require closing reply |
| attempting | completed count reaches budget | attempting | close tool admission |
| attempting | provider terminal text | classifying | build attempt snapshot |
| attempting | timeout/watchdog/abort | classifying | settle or mark unresolved calls |
| classifying | valid terminal text | persisting | store success |
| classifying | successful terminal side-effect only | persisting | store tool-complete marker |
| classifying | context pressure | recovering | compact then retry |
| classifying | resolved tools, no closing prose | recovering | one tools-disabled finalisation |
| classifying | transient safe failure | recovering | bounded retry |
| classifying | tool-history budget | persisting | durable terminal warning, optional one-shot continuation |
| recovering | compaction fails | recovering | rotate once |
| recovering | rotation succeeds | attempting | use new epoch and neutral continuation |
| recovering | budget/loop guard exhausted | persisting | store terminal failure |
| persisting | terminal write succeeds | persisting | reserve/enqueue optional continuation |
| persisting | queue write fails | persisting | release reservation; keep terminal output |
| persisting | cursor commit succeeds | terminal | publish done/error status |
| any non-terminal | event epoch differs | unchanged | ignore stale event and log it |

## Race and determinism hazards

### Session replacement

Closures currently capture mutable `session`, `sessionCtrl` and `modelLabel`. Rotation updates them, but an old callback can still run. A session epoch on every event and effect would let the reducer reject stale events.

### Timers and callbacks

Prompt timeout, finalisation reserve, progress watchdog and external compaction timeout can fire near provider completion. Boolean refs reduce some races but do not impose a total order. Each timer event should carry an attempt epoch and a monotonic sequence. The reducer should accept only the first terminal event for that attempt.

### Tool-set patching

Recovery and ceilings replace `setActiveToolsByName` on a mutable SDK object. Nested patches can restore in the wrong order. A lease stack with owner IDs is safer:

- acquire tool policy lease;
- compute the effective intersection of all leases;
- release only the caller's lease;
- never restore a saved array over a newer owner.

### Tool execution accounting

Parallel calls need separate reservation and completion counts. A ledger keyed by call ID is safer than deriving state from message counts. Every call moves through one monotonic state sequence. Duplicate end events become idempotent.

### Abort provenance

A chat-scoped map was already shown to leak across turns. Cancellation belongs in `TurnState` and carries turn ID plus attempt epoch. External control should target that identity.

### Persistence and queueing

Terminal output, one-shot reservation and deferred follow-up currently cross separate writes. They should use one SQLite transaction or an outbox record. Cursor commit follows terminal persistence. Materialisation is an idempotent consumer of the outbox.

### Recovery text classifiers

Regular expressions over rendered error text are brittle. Provider and internal errors should first map to typed reason codes. Text remains a fallback at adapter boundaries.

### Progress events

Several producers heartbeat the same chat. A stale event can make a newer attempt look active. Heartbeats need turn ID, attempt ID and sequence. Watchdog state should advance only for the current owner.

## High-reliability techniques

### Typed algebraic data types

Use discriminated unions for stages, commands and outcomes. This removes impossible field combinations and makes missing transition handling a compile-time error.

### Pure reducer plus effect commands

Use `reduce(state, event) -> { state, commands }`. The reducer performs no I/O. Command executors call the provider, tools, database and session APIs, then return events. This permits deterministic replay and table-driven tests.

### Immutable snapshots

Store a new state value for each accepted event. Do not let callbacks mutate shared booleans. A bounded diagnostic ring can retain the last state hashes and reason codes.

### Monotonic sequence and ownership epochs

Give each turn, session generation, attempt and command a stable ID. Events with an old epoch are ignored. Per-turn event sequence numbers expose missing or duplicate delivery.

### Idempotency ledgers

Use ledgers for tool calls, terminal persistence, queue reservations and external commands. A repeated event returns the existing result instead of applying the effect twice.

### Transactional outbox

Write terminal outcome, cursor advance and queued continuation intent under one SQLite transaction. A separate bounded worker materialises outbox items. This prevents the split-write defect found in Phase 1.

### Append-only journal and selective replay

A compact event journal can support post-mortem replay. It need not contain model text or tool payloads. Store event type, IDs, reason code, sequence, timestamps, state hash and command outcome. Retain full payloads only in existing session/message stores.

### Monotonic deadlines

Calculate absolute deadlines once with a monotonic clock. Attempts, recovery and finalisation receive deadlines rather than recomputing elapsed budget from several wall-clock anchors.

### Typed cancellation causes

Cancellation is a value in turn state, not a global side channel. The first accepted cancellation wins. Later abort fallout records observation without replacing the cause.

### Version checks

Database and in-memory writes should include expected turn version or state sequence. A stale writer fails without overwriting newer state.

### Compensation

Rotation and compaction are small sagas. Their commands should define success, retry-safe failure and compensation. For example, a failed rotation must leave the old session explicitly quarantined or reusable, never ambiguous.

### Deterministic tests

Use:

- table-driven transition tests for every matrix row;
- property tests for invariants;
- model-based random event sequences;
- a fake monotonic scheduler for timer races;
- fault injection at each command boundary;
- replay tests from recorded event traces;
- lightweight model checking for bounded attempts, two concurrent tools and competing timeout/completion events.

## Architecture options

### Keep the current orchestration

This has the lowest migration cost. More booleans, maps and focused tests can fix known cases. The repeated defects around lineage, provenance, tool restoration and timeout ordering show that local guards do not provide a complete correctness argument.

### One monolithic finite-state machine

A single enum makes the main path visible, but tool calls, provider state, persistence and recovery evolve partly in parallel. The state count becomes a Cartesian product or pushes hidden booleans back into the implementation.

### Hierarchical statecharts

A statechart can represent nested attempt and recovery phases and parallel regions. It gives good visual tooling. It adds a runtime framework and still requires explicit effect idempotency and durable persistence rules.

### Typed reducer with orthogonal state fields

This gives deterministic transitions without a statechart dependency. The small stage enum describes ownership. Typed sub-states describe provider, tools, persistence and recovery. Commands isolate side effects. Existing modules can migrate one boundary at a time.

## Recommendation

Adopt the typed reducer model in stages. Keep the existing SDK session and web persistence APIs behind command executors.

### Target modules

- `turn-state.ts`: state and invariant types;
- `turn-events.ts`: accepted external and command-result events;
- `turn-reducer.ts`: pure exhaustive transition function;
- `turn-commands.ts`: typed effect descriptions;
- `turn-executor.ts`: provider, tool, session, compaction and persistence adapters;
- `turn-journal.ts`: bounded structured diagnostic journal;
- `turn-store.ts`: SQLite snapshot, version and outbox operations.

### Migration

1. Define types and encode the current stage/output matrix without changing runtime behaviour.
2. Put attempt classification behind a pure reducer event. Reuse current recovery policy functions.
3. Replace mutable tool counters with a call-ID ledger and tool-policy leases.
4. Move abort cause, watchdog ownership and deadlines into turn state.
5. Move terminal persistence and continuation queueing into a transaction plus outbox.
6. Add session epochs and reject stale callbacks.
7. Route preflight and recovery commands through the reducer.
8. Remove old maps and boolean refs only after trace parity tests pass.

Each step should be a separate reviewed change. Existing persisted message and session formats remain compatible.

## Verification plan

### Reducer invariants

For every reachable state:

- one current session epoch exists;
- at most one terminal decision exists;
- cursor commit implies terminal persistence;
- a continuation reservation implies terminal persistence;
- completed tool count never falls;
- each tool call has one monotonic lifecycle;
- cancellation cause does not change after acceptance;
- recovery attempts and deadlines do not increase beyond policy;
- events from old epochs do not change state.

### Model-based scenarios

Generate bounded sequences containing:

- zero to three tool calls, including parallel completion;
- provider text before and after tools;
- timeout simultaneous with provider end;
- watchdog simultaneous with tool end;
- compaction success, truncation, timeout and failure;
- rotation success and failure;
- queue write and terminal write failures;
- duplicate and reordered SDK events;
- planned restart and user abort.

Compare the reducer terminal outcome and command list with an explicit reference model.

### Fault injection

Every command executor must be tested for throw-before-effect, effect-then-throw, duplicate result and late result. SQLite transaction tests should crash between terminal insert, outbox insert and cursor update.

### Trace parity

During migration, run the current orchestrator and the reducer classifier in shadow mode. Compare stage, classifier, tool counts, recovery strategy and terminal outcome. Do not emit shadow commands.

### Acceptance

The redesign is ready only when:

- the transition matrix has direct tests;
- property and model-based tests find no invariant violation under the bounded model;
- all current turn/recovery/web tests pass;
- shadow traces match for a defined fleet window;
- injected failures produce one durable terminal outcome and no duplicate side effect;
- performance and journal storage stay within agreed limits.

Rui must approve the architecture before implementation begins.
