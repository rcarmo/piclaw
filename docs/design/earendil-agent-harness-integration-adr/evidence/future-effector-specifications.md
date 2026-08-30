# Future effector specifications

Status: proposed contracts that Piclaw can implement and test now. This document specifies interfaces and tests only. It does not start a runtime migration or select an unfinished Harness v3 implementation.

These specifications define Piclaw-owned effects that a future service coordinator will need around Earendil. Each contract can be implemented over Piclaw's existing SQLite, messaging, media, scheduler, delivery, SSH and process internals. Current orchestration can remain unchanged. Later convergence changes callers while retaining these contracts and contract tests.

## Selection rule

A Piclaw effector belongs in this specification only when:

- Piclaw will still own the effect after Earendil runs agent execution;
- one method performs one explicit query or mutation and does not choose the next lifecycle state;
- current Piclaw mechanics can implement it;
- an independent deterministic fake can implement the same observable semantics;
- idempotency, ambiguity, owner fencing and redaction can be tested without a real harness.

Earendil-owned execution gets no Piclaw interface. Piclaw will use the selected version's `AgentHarness`, `AgentLane`, `Storage`, `SessionRepo`, `Models`, `CredentialStore`, `AgentHarnessTool<TContext>`, `Resources`, hooks, events and telemetry types directly.

## Proposed interface set

| ID | Interface | Piclaw responsibility | Current implementation source |
|---|---|---|---|
| EF-S01 | `ServiceWorkStore` | Accepted source order, service operation owner/version, cancellation and harness correlation | SQLite connection/migrations, messages, cursor and branch behaviour |
| EF-S02 | `TerminalSettlementStore` | One terminal disposition/timeline/media/frontier/outbox transaction | Message/media statements and terminal-message behaviour |
| EF-S03 | `TimelineDraftStore` | Non-terminal drafts and service notices | Message persistence and content-block validation |
| EF-S04 | `OperationMediaStore` | Media storage and durable operation binding | Media database and upload service |
| EF-S05 | `ServiceOutboxStore` | Durable post-commit intents and worker leases | New additive SQLite table using current DB mechanics |
| EF-S06 | `DeliveryDriver` | One external broadcast, channel send, push, Pushover or wake attempt | Existing transport implementations |
| EF-S07 | `ScheduledRunStore` | One scheduled occurrence, lease, run result and next occurrence | Task tables, scheduler and next-run calculation |
| EF-S08 | `AgentProjectionSink` | Publish already narrowed/redacted web DTOs | Existing SSE/status transport |
| EF-H01 | `ExecutionContextResolver` | Resolve one immutable Piclaw tool context containing direct Earendil `ExecutionEnv` values | SSH, tracked shell, process tracker and keychain-backed environment mechanics |

Models, credentials, tools, resources, hooks, storage, sessions, harness events and telemetry use Earendil types directly. They need compatibility assertions and behavioural specifications, not Piclaw wrapper interfaces.

## Relative implementation effort

The estimates compare these specifications with one another. They are planning sizes, not schedules or commitments.

| Contract | Adapter effort | Main reason | Prepare first? |
|---|---:|---|---:|
| EF-S08 projection sink | XS | Thin typed/redacted façade over existing transport | Yes |
| EF-S06 delivery drivers | S | Existing sends already have clear call boundaries; certainty mapping is new | Yes |
| EF-S03 timeline draft store | S | Low-level message writes exist; persistence must be separated from broadcast | Yes |
| EF-H01 context resolver | S–M | Mechanics exist, but exact `ExecutionEnv` semantics and immutable routing need care | Yes |
| EF-S04 operation media store | M | Existing media storage is reusable; durable operation binding is new | Yes |
| EF-S05 outbox store | M | Small new state machine, leases and indexes | After common vocabulary |
| EF-S07 scheduled run store | M | Existing task storage exists; occurrence identity and leases are new | After outbox vocabulary |
| EF-S01 service work store | L | New accepted-source/owner model and transition constraints | After simple contracts validate conventions |
| EF-S02 terminal settlement store | L | Cross-table atomic transaction depends on EF-S01, EF-S04 and EF-S05 | Last of the service contracts |

`XS` means one narrow adapter and contract suite. `S` means a small extraction with limited new state. `M` means an additive state model or several current primitives. `L` means a new durable aggregate or multi-table transaction. The lowest-effort first set is EF-S08, EF-S06, EF-S03 and the specification-level part of EF-H01.

## Suggested source layout

This layout is illustrative and may be adapted to repository conventions.

```text
runtime/src/service-effects/
├── contracts/
│   ├── service-work-store.ts
│   ├── terminal-settlement-store.ts
│   ├── timeline-draft-store.ts
│   ├── media-store.ts
│   ├── outbox-store.ts
│   ├── delivery-driver.ts
│   ├── scheduled-run-store.ts
│   ├── projection-sink.ts
│   └── execution-context-resolver.ts
├── current-piclaw/
│   └── ...current-internal adapters...
└── testing/
    ├── fakes/
    ├── fault-plan.ts
    ├── trace.ts
    └── contract-suites/
```

## Common types and rules

The examples use Earendil's exported generic `Result<T, TError>`. Service error tags remain Piclaw types because Earendil does not own these effects.

```typescript
import type {
  ExecutionEnv,
  Result,
} from "@earendil-works/pi-agent-core";

interface EffectIdentity {
  idempotencyKey: string;
  requestHash: string;
  operationId: string | null;
  sourceSeq: number | null;
  provenanceRef: string;
  redactionClass: "public" | "private" | "secret";
}

type EffectCertainty = "not_applied" | "applied" | "unknown";

interface PiclawEffectError {
  readonly _tag: string;
  readonly certainty: EffectCertainty;
  readonly retryable: boolean;
}

interface PayloadReference {
  ref: string;
  sha256: string;
  byteLength: number;
  mediaType: string;
  redactionClass: EffectIdentity["redactionClass"];
}
```

A `payloadRef` resolves through an existing Piclaw-owned content store or a later content-addressed store. It is immutable: every successful resolution of one reference returns the same digest, byte length, media type, redaction class and bytes. A reference may be temporarily unavailable, but it never resolves to another payload. Consumers verify the tuple and take a defensive byte snapshot before later awaits or persistence because TypeScript's `readonly Uint8Array` does not prevent element mutation. Effector tables store references and hashes, not duplicate protected bodies. Small public DTOs may remain inline when the interface says so explicitly.

All mutating methods follow these rules:

1. `idempotencyKey` names the semantic effect, not a worker attempt.
2. The adapter stores `requestHash` with the key. Reuse with another hash returns a conflict.
3. A method with `expectedVersion` performs no mutation when that version is stale.
4. An error reports whether the effect was absent, present or unknown.
5. A duplicate equal request returns the original result.
6. Protected values do not appear in traces, telemetry or public projection.
7. Tests inject clock and ID sources.
8. Fakes implement the specified state transitions independently; they do not import adapter implementation code.

`requestHash` is the SHA-256 digest of canonical JSON for the semantic request after omitting `requestHash`, lease tokens, attempt numbers and tracing metadata. Object keys sort lexically; array order remains significant. Implementations may use another canonical encoding only if fake and adapter contract tests share fixed cross-implementation vectors.

## Contract data model

The examples below complete the interface vocabulary. They specify required fields and state distinctions; file/module placement is illustrative.

### Source, operation and correlation

```typescript
type AcceptedSourceKind =
  | "message"
  | "steer"
  | "follow_up"
  | "continuation"
  | "control"
  | "cancellation"
  | "scheduled_agent"
  | "internal";

type AcceptedSourceState =
  | "pending"
  | "claimed"
  | "queued"
  | "consumed"
  | "disposed";

interface AcceptedSourceSnapshot {
  chatJid: string;
  sourceSeq: number;
  sourceId: string;
  kind: AcceptedSourceKind;
  state: AcceptedSourceState;
  payloadRef: string;
  targetOperationId: string | null;
  parentSourceSeq: number | null;
  acceptedAt: string;
  dispositionReason: string | null;
  provenanceRef: string;
}

type PiclawOperationPhase =
  | "accepted"
  | "claimed"
  | "starting_harness"
  | "executing"
  | "suspended"
  | "cancelling"
  | "settling"
  | "terminal";

type PiclawDisposition =
  | "completed"
  | "cancelled"
  | "failed"
  | "skipped"
  | "superseded";

interface HarnessCorrelation {
  sessionId: string;
  lane: string;
  harnessOperationId: string | null;
  state: "not_started" | "running" | "suspended" | "aborting" | "finished";
  watchGeneration: number;
}

interface CancellationSnapshot {
  sourceSeq: number;
  cause: string;
  requestedAt: string;
}

interface TerminalSnapshot {
  disposition: PiclawDisposition;
  messageRowId: number | null;
  errorCode: string | null;
  committedAt: string;
}

interface OperationSnapshot {
  operationId: string;
  chatJid: string;
  version: number;
  phase: PiclawOperationPhase;
  primarySourceSeq: number;
  claimedSourceSeqs: readonly number[];
  cancellation: CancellationSnapshot | null;
  harness: HarnessCorrelation | null;
  terminal: TerminalSnapshot | null;
}

interface ChatFrontierSnapshot {
  chatJid: string;
  consumedThroughSourceSeq: number;
  activeOperationId: string | null;
  nextPendingSourceSeq: number | null;
}

interface ClaimedOperation {
  source: AcceptedSourceSnapshot;
  operation: OperationSnapshot;
}
```

### Service-work requests

```typescript
interface AcceptSourceRequest {
  effect: EffectIdentity;
  chatJid: string;
  sourceId: string;
  kind: AcceptedSourceKind;
  payloadRef: string;
  targetOperationId: string | null;
  parentSourceSeq: number | null;
  acceptedAt: string;
  createWakeIntent: boolean;
}

interface ClaimNextSourceRequest {
  effect: EffectIdentity;
  chatJid: string;
  expectedFrontier: number;
  newOperationId: string;
  claimedAt: string;
}

type OperationIntentKind =
  | "open_harness"
  | "prompt"
  | "queue_input"
  | "abort"
  | "resume"
  | "settle"
  | "maintenance";

interface AppendOperationIntentRequest {
  effect: EffectIdentity & { operationId: string };
  expectedVersion: number;
  intentId: string;
  kind: OperationIntentKind;
  payloadRef: string;
  createdAt: string;
}

interface AcceptCancellationRequest {
  effect: EffectIdentity & { operationId: string };
  expectedVersion: number;
  sourceId: string;
  sourceSeq: number;
  cause: string;
  requestedAt: string;
}

interface BindHarnessRequest {
  effect: EffectIdentity & { operationId: string };
  expectedVersion: number;
  sessionId: string;
  lane: string;
  harnessOperationId: string | null;
  state: HarnessCorrelation["state"];
  watchGeneration: number;
}

interface RecordQueuedInputRequest {
  effect: EffectIdentity & { operationId: string };
  expectedVersion: number;
  sourceSeq: number;
  queueKind: "steer" | "follow_up" | "next_run";
  harnessEntryId: string | null;
  state: "accepted" | "queued" | "consumed" | "disposed";
}

interface ListOpenOperationsRequest {
  chatJid?: string;
  limit?: number;
  afterOperationId?: string;
}
```

The coordinator supplies IDs and canonical UTC timestamps. The store validates them and never invents lifecycle identity, so EF-S01 has no clock or ID-generation runtime seam. `claimNext` selects the lowest pending sequence after `expectedFrontier`; all other eligibility decisions belong to the caller and must already be represented in persisted source state.

### Errors

```typescript
type ServiceWorkErrorTag =
  | "idempotency_conflict"
  | "frontier_mismatch"
  | "version_mismatch"
  | "owner_conflict"
  | "invalid_transition"
  | "not_found"
  | "corrupt_state"
  | "storage_unavailable";

interface ServiceWorkError extends PiclawEffectError {
  readonly _tag: ServiceWorkErrorTag;
  readonly observedVersion?: number;
  readonly observedFrontier?: number;
  readonly conflictingOperationId?: string;
}
```

Equivalent interface-specific errors use a bounded `_tag` union and the common certainty/retry fields. Expected compare-and-set and not-found outcomes have `certainty: "not_applied"` and `retryable: false`. A storage interruption after commit has `certainty: "unknown"`; the caller reconciles by idempotency key.

### Remaining bounded errors and shared records

```typescript
interface TimelineStoreError extends PiclawEffectError {
  readonly _tag:
    | "idempotency_conflict"
    | "stale_revision"
    | "row_not_found"
    | "row_owner_conflict"
    | "invalid_content_blocks"
    | "missing_media"
    | "storage_unavailable";
}

interface MediaStoreError extends PiclawEffectError {
  readonly _tag:
    | "idempotency_conflict"
    | "digest_mismatch"
    | "unsupported_media"
    | "media_not_found"
    | "binding_conflict"
    | "still_referenced"
    | "storage_unavailable";
}

interface OutboxStoreError extends PiclawEffectError {
  readonly _tag:
    | "invalid_request"
    | "idempotency_conflict"
    | "not_found"
    | "invalid_transition"
    | "corrupt_state"
    | "storage_unavailable";
}

interface ScheduledRunStoreError extends PiclawEffectError {
  readonly _tag:
    | "idempotency_conflict"
    | "task_not_found"
    | "task_inactive"
    | "task_revision_mismatch"
    | "lease_conflict"
    | "lease_expired"
    | "invalid_transition"
    | "storage_unavailable";
}

interface ProjectionSinkError extends PiclawEffectError {
  readonly _tag:
    | "stale_generation"
    | "stale_sequence"
    | "owner_conflict"
    | "terminal_not_committed"
    | "protected_payload"
    | "transport_unavailable";
}

interface StoredMediaRecord {
  ref: MediaRef;
  filename: string;
  contentType: string;
  byteLength: number;
  dataRef: string;
  thumbnailRef: string | null;
  metadataRef: string | null;
  createdAt: string;
}

interface ScheduledTaskSnapshot {
  taskId: string;
  revision: number;
  chatJid: string;
  kind: "agent" | "shell" | "internal";
  payloadRef: string;
  modelLabel: string | null;
  scheduleType: "once" | "interval" | "cron";
  scheduleValue: string;
  scheduledFor: string;
  notify: boolean;
}
```

An adapter may attach non-sensitive diagnostic fields to an error, but contract logic matches only the bounded `_tag`, certainty and documented version/frontier/lease values.

### Idempotency-key catalogue

| Method/effect | Key form | Equality input |
|---|---|---|
| Accept source | `source:<chatJid>:<sourceId>` | Kind, payload reference, target, parent and provenance |
| Claim source | `claim:<chatJid>:<expectedFrontier>:<newOperationId>` | Selected source and operation ID |
| Append intent | `intent:<operationId>:<intentId>` | Kind and payload reference |
| Accept cancellation | `cancel:<operationId>:<sourceId>` | Source sequence and cause |
| Bind harness | `harness:<operationId>:<sessionId>:<lane>:<harnessOperationId-or-pending>` | Complete correlation value |
| Queue input state | `queue:<operationId>:<sourceSeq>:<state>` | Queue kind, entry ID and state |
| Terminal settlement | `terminal:<operationId>` | Owner, disposition, timeline, source dispositions and outbox intents |
| Draft | `draft:<operationId>:<draftKind>:<revision>` | Complete draft payload reference and media list |
| Service notice | `notice:<noticeKind>:<sourceId>` | Chat, content and content blocks |
| Media creation | `media:<uploadId>` | Digest, filename, type and metadata digest |
| Media binding | `media-bind:<operationId>:<mediaId>:<role>` | Complete binding value |
| Outbox intent | `<kind>:<semantic-owner-id>` | Payload reference and destination |
| Scheduled occurrence | `scheduled:<taskId>:<scheduledFor>` | Task revision and occurrence time |
| Scheduled completion | `scheduled-complete:<runId>` | Result, next occurrence and delivery intents |

## EF-S01 — service work store

### Purpose

Persist accepted Piclaw sources, source order, service operations, exact cancellation, operation intents and Piclaw-to-Earendil correlation. It never calls Earendil, formats output, broadcasts or sends a notification.

This is one aggregate contract because acceptance, claims, owner versions and correlation require one compare-and-set transaction. Splitting it into repositories would add cross-repository transactions without creating independent effect boundaries.

### Interface

```typescript
interface ServiceWorkStore {
  acceptSource(
    request: AcceptSourceRequest,
  ): Promise<Result<AcceptedSourceSnapshot, ServiceWorkError>>;

  claimNext(
    request: ClaimNextSourceRequest,
  ): Promise<Result<ClaimedOperation | null, ServiceWorkError>>;

  appendIntent(
    request: AppendOperationIntentRequest,
  ): Promise<Result<OperationSnapshot, ServiceWorkError>>;

  acceptCancellation(
    request: AcceptCancellationRequest,
  ): Promise<Result<OperationSnapshot, ServiceWorkError>>;

  bindHarness(
    request: BindHarnessRequest,
  ): Promise<Result<OperationSnapshot, ServiceWorkError>>;

  recordQueuedInput(
    request: RecordQueuedInputRequest,
  ): Promise<Result<OperationSnapshot, ServiceWorkError>>;

  getOperation(
    operationId: string,
  ): Promise<Result<OperationSnapshot | null, ServiceWorkError>>;

  getChatFrontier(
    chatJid: string,
  ): Promise<Result<ChatFrontierSnapshot, ServiceWorkError>>;

  listOpenOperations(
    request?: ListOpenOperationsRequest,
  ): Promise<Result<readonly OperationSnapshot[], ServiceWorkError>>;
}
```

### Required semantics

| Method | Durable effect |
|---|---|
| `acceptSource` | Allocate one monotonic per-chat `sourceSeq`; store source identity, payload reference, provenance and target; optionally create one wake intent |
| `claimNext` | Compare the expected frontier; claim the first eligible source once; create or return one service operation; increment its version |
| `appendIntent` | Verify exact operation/version and append one immutable service intent; update the rebuildable current projection |
| `acceptCancellation` | Persist the first exact-operation cancellation and increment the operation version; repeated equal cancellation returns it; wrong owner is a no-op |
| `bindHarness` | Store exact `sessionId`, lane, returned Earendil `runId` in `harnessOperationId`, and caller-supplied nonnegative `watchGeneration`; any changed binding component is an owner conflict |
| `recordQueuedInput` | Distinguish accepted-but-undelivered, queued in Earendil and consumed/disposed source states |

`acceptCancellation` records Piclaw authority only. A future coordinator calls direct `lane.abort()` after this mutation succeeds.

### Adapter over current Piclaw internals

Use:

- `runtime/src/db/connection.ts` and `runtime/src/db/migrations.ts` for SQLite and transactions;
- `runtime/src/db/chat-cursors.ts` as behavioural evidence for frontier, inflight, deferred-follow-up and protected-continuation semantics;
- `runtime/src/db/messages.ts` for accepted message references;
- `runtime/src/db/chat-branches.ts` for chat/branch identity;
- `runtime/src/queue.ts` only as a wake mechanism after a durable record exists;
- `runtime/src/runtime/restart-handoff.ts` as evidence for continuation inputs.

Do not implement this adapter by calling composite cursor helpers. Small additive service tables provide clear constraints. The first implementation need not connect current ingress to these tables.

### Fake and contract tests

`FakeServiceWorkStore` consumes caller-supplied clock/ID values, provides a call/result trace and commit fault boundaries, and reconstructs only durable fake state on crash/restore; transient fault scripts are not restored.

Required cases:

- concurrent acceptance produces consecutive source sequences;
- duplicate source ID with equal and unequal request hashes;
- crash before commit and after commit before acknowledgement;
- stale frontier and stale operation version;
- two claimers see one owner;
- exact, duplicate and wrong-owner cancellation;
- another harness run cannot replace a binding;
- queued input survives accepted, delivered and consumed transitions;
- restart lists every non-terminal operation;
- dropped or duplicate wakes do not alter durable state.

## EF-S02 — terminal settlement store

### Purpose

Commit the one Piclaw terminal transaction. This is the only contract that can make a Piclaw service operation terminal.

### Interface

```typescript
interface TerminalSettlementStore {
  commitTerminal(
    request: CommitTerminalRequest,
  ): Promise<Result<TerminalCommit, TerminalSettlementError>>;

  getTerminal(
    operationId: string,
  ): Promise<Result<TerminalCommit | null, TerminalSettlementError>>;

  getTerminalByKey(
    idempotencyKey: string,
  ): Promise<Result<TerminalCommit | null, TerminalSettlementError>>;
}

interface CommitTerminalRequest {
  effect: EffectIdentity & { operationId: string };
  expectedChatJid: string;
  expectedVersion: number;
  expectedHarness: HarnessCorrelation | null;
  disposition: PiclawDisposition;
  errorCode: string | null;
  terminalAuthorityRef: string | null;
  timeline: TerminalTimelineWrite;
  sourceDispositions: readonly SourceDisposition[];
  outboxIntents: readonly EnqueueOutboxRequest[];
  committedAt: string;
}

type TerminalTimelineWrite =
  | {
      mode: "insert";
      placeholderRowId: null;
      chatJid: string;
      contentRef: string;
      threadId: number | null;
      mediaIds: readonly number[];
      contentBlocksRef: string | null;
    }
  | {
      mode: "replace_placeholder";
      placeholderRowId: number;
      chatJid: string;
      contentRef: string;
      threadId: number | null;
      mediaIds: readonly number[];
      contentBlocksRef: string | null;
    }
  | {
      mode: "none";
      placeholderRowId: null;
      chatJid: string;
      contentRef: null;
      threadId: null;
      mediaIds: readonly [];
      contentBlocksRef: null;
    };

interface SourceDisposition {
  sourceSeq: number;
  state: "consumed" | "disposed";
  reason: string;
}

interface TerminalCommit {
  operationId: string;
  operationVersion: number;
  disposition: PiclawDisposition;
  messageRowId: number | null;
  consumedThroughSourceSeq: number;
  outboxIds: readonly string[];
  committedAt: string;
}

type TerminalSettlementErrorTag =
  | "invalid_request"
  | "not_found"
  | "idempotency_conflict"
  | "version_mismatch"
  | "owner_conflict"
  | "already_terminal_conflict"
  | "invalid_source_disposition"
  | "missing_media"
  | "corrupt_state"
  | "storage_unavailable";

interface TerminalSettlementError extends PiclawEffectError {
  readonly _tag: TerminalSettlementErrorTag;
  readonly existing?: TerminalCommit;
}
```

`mode: "none"` is valid for a service terminal disposition that intentionally has no assistant timeline row. `replace_placeholder` requires an operation-owned placeholder. The request cannot target an arbitrary message row.

### Required semantics

One SQLite transaction:

1. verifies operation ID, expected version, non-terminal state and harness correlation;
2. inserts one immutable disposition;
3. inserts or replaces the designated terminal timeline row and binds media;
4. consumes or disposes claimed sources with reasons;
5. advances the per-chat frontier through consecutive closed (`consumed` or `disposed`) sources only, stopping at pending or claimed work; a missing row below `next_source_seq` is corruption;
6. releases service ownership;
7. inserts delivery, notification, wake and maintenance outbox rows;
8. records immutable terminal-commit visibility and commits; no projection is emitted by EF-S02.

A duplicate equal request returns the original `TerminalCommit`. Another disposition, chat, complete harness owner, terminal authority, timeline payload, source disposition or outbox set returns `already_terminal_conflict` with the original closed commit. Terminalisation increments the Piclaw operation version exactly once. Broadcast and notification are never part of this transaction.

The operation fence compares the exact expected chat, active owner, version and complete nullable harness correlation: session, lane, Earendil run (`harnessOperationId`), state and watch generation. `terminalAuthorityRef` is required only for `skipped` and `superseded`; it is null for other dispositions and is retained only in the protected terminal decision ledger.

Disposition authority is closed: `completed` requires `settling` with no cancellation and no error; `cancelled` requires an accepted cancellation and `cancelling` or `settling`; `failed` requires `executing`, `suspended`, `cancelling` or `settling`, a bounded error code and no accepted cancellation; `skipped` requires `claimed` or `starting_harness`, no started harness run and no cancellation; `superseded` requires `claimed`, `starting_harness` or `suspended` and no cancellation.

Every operation-source membership must be open and settled exactly once in the request; a pre-closed membership or a targeted queued follow-up without its queue row is corruption. Matching queued-input rows move to the same `consumed` or `disposed` state. Each outbox intent is a complete `EnqueueOutboxRequest`; its operation and source authority must match the settlement. EF-S02 must itself insert both the S05 outbox row and enqueue decision inside the outer transaction; a pre-existing row, even byte-equal, is an `idempotency_conflict` rather than evidence that this transaction inserted it.

`committedAt` is at or after every accepted source and accepted cancellation time used by the disposition. Every outbox `enqueuedAt` equals `committedAt`, and `availableAt` is not earlier. Non-null timeline `threadId` identifies an existing root in the same chat. Content and content-block references are resolved and verified for exact reference, digest, byte length, media type and redaction class before persistence, and their bytes are defensively snapshotted. Equal durable replay and altered closed-operation candidates are decided before payload resolution.

`invalid_request` denotes a malformed public request or lookup, while `not_found` denotes a valid settlement candidate for an absent operation. Valid read lookups return `null` when no terminal decision exists and do not emit effect traces. Persisted decision reads strictly decode the terminal operation, timeline row, complete ordered outbox link count and S05 enqueue rows; malformed scalars, ordinals or edges return `corrupt_state` without exposing stored values.

### Adapter over current Piclaw internals

Implement a private latent transaction-compatible statement layer, preserving the supported SQL semantics from:

- `runtime/src/db/messages.ts` for message insert/replace, terminal flags, thread association and FTS rows;
- `runtime/src/db/media.ts` for message/media binding and media-text FTS maintenance;
- `runtime/src/channels/web/messaging/agent-message-store.ts` for existing terminal-message behaviour;
- `runtime/src/channels/web/messaging/message-write-flows.ts` for replacement and thread behaviour;
- `runtime/src/router.ts:formatOutbound` for presentation before the request is built.

The adapter must not call `storeAgentTurn()`: it also consumes placeholders, catches auxiliary write failures, broadcasts and triggers Web Push. Those are separate effects.

The first implementation may be exercised only by contract tests. It proves that the existing message/media schema can participate in the future transaction without transferring runtime authority.

### Fake and contract tests

Required cases:

- rollback after every statement leaves no partial terminal state;
- commit followed by lost acknowledgement returns the original result on retry;
- accepted cancellation authority authorises cancellation, and separately valid terminal candidates race to one disposition;
- stale Piclaw version and stale Earendil operation ID are no-ops;
- missing or duplicate media cannot create two terminal rows;
- placeholder replacement and new-row paths preserve one terminal message;
- outbox insertion failure rolls back disposition and timeline changes;
- frontier cannot cross pending or claimed work;
- no projection or delivery occurs before commit.

## EF-S03 — timeline draft store

### Purpose

Persist non-terminal assistant drafts and Piclaw service notices. These writes do not settle an operation, consume a source or advance a frontier.

### Interface

```typescript
interface TimelineDraftStore {
  commitDraft(
    request: CommitDraftRequest,
  ): Promise<Result<TimelineWrite, TimelineStoreError>>;

  commitServiceNotice(
    request: CommitServiceNoticeRequest,
  ): Promise<Result<TimelineWrite, TimelineStoreError>>;

  getOperationArtifacts(
    operationId: string,
  ): Promise<Result<OperationArtifacts, TimelineStoreError>>;
}

interface CommitDraftRequest {
  effect: EffectIdentity & { operationId: string };
  chatJid: string;
  draftKind: "assistant_progress" | "tool_progress" | "recovery";
  revision: number;
  mode: "insert" | "replace";
  existingRowId: number | null;
  contentRef: string;
  threadId: number | null;
  mediaIds: readonly number[];
  contentBlocksRef: string | null;
  writtenAt: string;
}

interface CommitServiceNoticeRequest {
  effect: EffectIdentity;
  chatJid: string;
  sourceId: string;
  noticeKind: "restart" | "maintenance" | "operator";
  contentRef: string;
  contentBlocksRef: string | null;
  writtenAt: string;
}

interface TimelineWrite {
  rowId: number;
  chatJid: string;
  operationId: string | null;
  revision: number | null;
  terminal: false;
  writtenAt: string;
}

interface OperationArtifacts {
  operationId: string;
  draftRows: readonly TimelineWrite[];
  mediaIds: readonly number[];
}
```

A draft is idempotent by `(operationId, draftKind, revision)`. Revisions increase within one draft kind. Immutable per-revision request/result metadata is retained while the operation-owned current message row is updated in place. Replaying a known revision returns its original `TimelineWrite` without rewriting the current row; an unseen revision below the current one returns `stale_revision`, never a new row. A notice is idempotent by its service source, such as a restart request ID. Both are explicitly non-terminal.

`contentRef` and `contentBlocksRef` are resolved through an injected payload lookup. The resolved reference identity, digest and byte length are verified before persistence. Content blocks must be an array of non-null, non-array objects; a reserved internal block type is rejected rather than silently removed. The adapter receives a caller-supplied `bun:sqlite` database and uses only low-level persistence statements: it does not broadcast, settle an operation, consume a source or advance a frontier.

### Adapter and tests

Use low-level message writes in `runtime/src/db/messages.ts`, content-block validation in `runtime/src/channels/web/messaging/content-block-safety.ts`, and pure formatting in messaging/router modules. Do not broadcast inside the adapter.

Contract cases cover duplicate revisions, replacement, thread association, restart notices, invalid content blocks and proof that drafts cannot become terminal rows.

## EF-S04 — media store

### Purpose

Store media and bind it to a Piclaw operation before a terminal or draft timeline transaction refers to it.

### Interface

```typescript
interface OperationMediaStore {
  create(
    request: CreateMediaRequest,
  ): Promise<Result<MediaRef, MediaStoreError>>;

  bindToOperation(
    request: BindOperationMediaRequest,
  ): Promise<Result<OperationMediaBinding, MediaStoreError>>;

  get(
    ref: MediaRef,
  ): Promise<Result<StoredMediaRecord | null, MediaStoreError>>;

  listForOperation(
    operationId: string,
  ): Promise<Result<readonly MediaRef[], MediaStoreError>>;

  deleteIfUnreferenced(
    request: DeleteMediaIfUnreferencedRequest,
  ): Promise<Result<boolean, MediaStoreError>>;
}

interface CreateMediaRequest {
  effect: EffectIdentity;
  uploadId: string;
  filename: string;
  contentType: string;
  byteLength: number;
  sha256: string;
  dataRef: string;
  thumbnailRef: string | null;
  metadataRef: string | null;
  createdAt: string;
}

interface MediaRef {
  mediaId: number;
  sha256: string;
}

interface BindOperationMediaRequest {
  effect: EffectIdentity & { operationId: string };
  mediaId: number;
  role: "input" | "draft" | "terminal" | "tool_artifact";
  boundAt: string;
}

interface OperationMediaBinding {
  operationId: string;
  mediaId: number;
  role: BindOperationMediaRequest["role"];
  boundAt: string;
}

interface DeleteMediaIfUnreferencedRequest {
  effect: EffectIdentity;
  mediaId: number;
  expectedSha256: string;
}
```

### Adapter and tests

Reuse compression, decompression, metadata and safe reads from `runtime/src/db/media.ts`, plus validation and thumbnail preparation from `runtime/src/channels/web/media/media-service.ts`. Add durable operation/media bindings. The volatile `runtime/src/agent-pool/attachments.ts` registry remains a legacy caller detail and is not the future owner.

Payload bytes, optional thumbnail and optional metadata JSON are materialised through injected lookups. Reference identity, digest, byte length and immutable media type are verified before creation; metadata references require `application/json`. An upload ID identifies the existing replay candidate: digest or length mismatch returns `digest_mismatch`; otherwise replay requires full canonical request-hash equality and every other semantic change returns `idempotency_conflict`. Bindings are unique per `(operationId, mediaId, role)` and likewise require full canonical request-hash equality for replay; changed binding semantics return `binding_conflict`. Deletion is allowed only when no operation, message or outbox reference exists. The current-internal adapter receives a caller-supplied `bun:sqlite` database; its additive binding/idempotency schema is private to temporary or in-memory contract tests and is not a global migration or startup dependency.

Contract cases cover equal upload IDs/content digests, operation-binding uniqueness, missing media, compressed round trips, text-index maintenance and orphan deletion while any operation/message/outbox reference exists.

## EF-S05 — service outbox store

### Purpose

Persist post-commit Piclaw work. The store owns intents and leases; it does not choose retry policy or perform delivery.

### Interface

```typescript
type OutboxKind =
  | "wake_chat"
  | "timeline_broadcast"
  | "channel_delivery"
  | "notification"
  | "scheduler_run_log"
  | "maintenance";

interface ServiceOutboxStore {
  enqueue(request: EnqueueOutboxRequest): Promise<Result<OutboxEnqueueDecision, OutboxStoreError>>;
  claimNext(request: ClaimOutboxRequest): Promise<Result<OutboxClaimDecision, OutboxStoreError>>;
  reclaim(request: ReclaimOutboxRequest): Promise<Result<OutboxMutationDecision, OutboxStoreError>>;
  complete(request: CompleteOutboxRequest): Promise<Result<OutboxMutationDecision, OutboxStoreError>>;
  fail(request: FailOutboxRequest): Promise<Result<OutboxMutationDecision, OutboxStoreError>>;
  markUnknown(request: MarkOutboxUnknownRequest): Promise<Result<OutboxMutationDecision, OutboxStoreError>>;
  resolveUnknown(request: ResolveUnknownOutboxRequest): Promise<Result<OutboxMutationDecision, OutboxStoreError>>;
  get(outboxId: string): Promise<Result<OutboxRecord | null, OutboxStoreError>>;
  listUnknown(request: ListUnknownOutboxRequest): Promise<Result<ListUnknownOutboxResult, OutboxStoreError>>;
  cleanupTerminal(request: CleanupTerminalOutboxRequest): Promise<Result<OutboxCleanupDecision, OutboxStoreError>>;
}

The closed contract is implemented in `runtime/src/service-effects/contracts/service-outbox-store.ts`. The record retains immutable effect provenance, caller-owned enqueue and result timestamps, repeatability, exact worker/lease/attempt ownership, external-effect certainty, retry/receipt diagnostics and reconciliation history. Attempt starts at zero and increments once per successful claim or reclaim. Worker, lease, state, attempt, and time fences return typed `stale`; `invalid_transition` is reserved for caller-owned enqueue inserter misuse outside a transaction. The public error set is otherwise closed to malformed requests, idempotency conflicts, absent exact rows, corrupt durable state, and bounded storage unavailability.

Mutation decisions distinguish `applied`, exact `replayed` results and expected `stale` no-ops. A claim is identified by its globally unique lease token and returns `empty` when no due row exists. Exact-row mutation of an absent outbox returns bounded `not_found`; wrong owner, token, attempt or state is `stale`; `get` alone returns `null` for absence. Worker results require the exact unexpired worker, token and attempt. Competing result methods share durable authority for one outbox attempt.

`reclaim` addresses one expired started row and accepts either immutable repeatable authority or a caller-supplied reconciled-absent reference. Expiry alone grants no authority. `resolveUnknown` accepts only applied, not-applied or cancelled reconciliation. There is no pre-attempt cancellation method. Ordinary claim never selects unknown work.

`listUnknown` and `cleanupTerminal` use a bounded exclusive `(stateChangedAt, outboxId)` cursor. Cleanup may delete only fatal failed rows and cancelled rows older than its caller cutoff; it retains pending, started, retryable failed, unknown and completed rows. Cleanup removes row-linked decisions atomically, retains its own replay decision, and never removes permanent hashed lease-token authority.

Replay ledgers contain only bounded method/hash/outcome/row/attempt/token-hash metadata (plus bounded cleanup IDs/cursor data). They never contain payload, destination, provenance, receipt, reconciliation, plaintext token, secret, or raw cause values. Applied worker outcomes and unknown resolutions have separate minimal per-attempt authority, so later state cannot change an original result replay.

Reads are intentionally not traced: they perform no durable effect and return only closed bounded data/errors. Mutations emit closed call/result traces with method, outbox/effect identity, operation/source sequence, expected attempt, result tag and certainty; protected request or authority values are never traced.

Authoritative stores use a transaction-compatible enqueue inserter that requires an active caller transaction and performs no transaction control. Independent work uses `enqueue()`. All IDs, timestamps, worker identities, lease tokens, retry instants, receipts and reconciliation references are caller-owned; the store generates none.
```

### Required semantics

- Unique `(kind, idempotencyKey)` plus the exact closed semantic request hash identifies one intent; `outboxId` is globally unique.
- A claim has a caller-owned worker, globally unique lease token, expiry and attempt number. Due work orders by effective availability instant and then `outboxId`.
- Completion, failure and unknown results require the exact current worker, lease token and attempt, with result time at or after claim and strictly before lease expiry. Stale results are typed no-ops.
- Expired `started` work can be reclaimed only through exact-row repeatable or reconciled-absent authority.
- `unknown` blocks automatic retry until an explicit reconciliation resolves it.
- Reclaim time is at or after the previous claim and expiry; reconciliation time is at or after the unknown result; every non-null retry time is strictly later than its failure/reconciliation time.
- Fatal failed and cancelled rows alone are eligible for bounded cleanup. Completed and unknown rows retain effect evidence, and lease-token uniqueness survives cleanup.
- Authoritative stores can insert rows using shared transaction statements; independent work uses `enqueue()`.

### Adapter and tests

Specify an additive SQLite table using `runtime/src/db/connection.ts` and migration conventions. Initial implementation and tests need no worker or current caller.

Contract cases cover concurrent workers, lease expiry, stale completion, duplicate equal/conflicting intent, crash before effect, effect before acknowledgement, poison payload and bounded cleanup.

## EF-S06 — delivery drivers

### Purpose

Perform one claimed external delivery. Drivers report certainty; they do not persist retry counters or decide the next attempt.

### Interface

```typescript
interface DeliveryAttempt {
  outboxId: string;
  idempotencyKey: string;
  payloadRef: string;
  destinationRef: string | null;
  deliveryIdentity: string;
  attempt: number;
  signal: AbortSignal;
}

type DeliveryProviderDetail =
  | { kind: "timeline_broadcast"; providerMessageId: null; eventId: string }
  | { kind: "channel_delivery"; providerMessageId: string | null }
  | { kind: "web_push"; providerMessageId: null; counts: Readonly<{ attempted: number; sent: number; removed: number; failed: number }> }
  | { kind: "pushover"; providerMessageId: string | null }
  | { kind: "wake_chat"; providerMessageId: null; wakeId: string };

interface DeliveryOutcome {
  certainty: EffectCertainty;
  acceptedAt: string;
  receiptRef: string | null;
  detail: DeliveryProviderDetail;
}

interface DeliveryDriverError extends PiclawEffectError {
  readonly _tag:
    | "invalid_payload"
    | "destination_missing"
    | "rejected"
    | "rate_limited"
    | "timeout"
    | "transport_unavailable"
    | "aborted";
  readonly retryAfter?: string;
}

interface DeliveryDriver {
  readonly kind: OutboxKind;

  deliver(
    request: DeliveryAttempt,
  ): Promise<Result<DeliveryOutcome, DeliveryDriverError>>;

  reconcile?(
    request: Omit<DeliveryAttempt, "signal">,
  ): Promise<Result<DeliveryOutcome | null, DeliveryDriverError>>;
}
```

### Adapters over current Piclaw internals

| Driver | Existing mechanics | Certainty rule |
|---|---|---|
| Timeline broadcast | Web SSE broadcaster and messaging broadcaster | A completed chat-scoped broadcast is `applied` to the transport boundary, including zero connected clients; caller supplies event identity |
| Channel delivery | Channel `sendMessage` and router | Resolved current `Promise<void>` is `applied`; generic throw is `unknown` unless an injected typed classifier proves pre-send rejection |
| Web Push | `runtime/src/channels/web/push/web-push-service.ts` | Preserve aggregate `{attempted,sent,removed,failed}` exactly; zero attempted is `not_applied`, any failure is `unknown`, otherwise `applied` |
| Pushover | `runtime/src/channels/pushover.ts` | Success is `applied`; typed pre-acceptance rejection is `not_applied`; timeout/disconnect after dispatch is `unknown` |
| Wake | `runtime/src/queue.ts` | Callback completion means wake invocation accepted (`applied`), not durable work completion; caller supplies wake identity |

Exactly-once applies to Piclaw's durable outbox intent and terminal timeline row. A provider without deduplication or reconciliation cannot promise exactly-once delivery. `deliver()` reads the unknown runtime request through one guarded normalization pass, rejects hostile or changing getters and whitespace-only identities, and creates a plain immutable scalar snapshot retaining identity bytes exactly while trimming the destination and retaining only a full AbortSignal-compatible reference (`aborted`, `addEventListener`, and `removeEventListener`). It then verifies the safe positive attempt, resolved payload reference, byte length and digest, takes a defensive byte snapshot, and executes one attempt only. It owns no claim, retry, sleep, persistence, dedupe or lifecycle policy. `deliveryIdentity` is caller-owned trace/correlation identity and must match timeline event or wake detail without creating driver dedupe state. Current timeline, channel, Web Push, Pushover and wake mechanics expose no stable receipt query, so their drivers omit `reconcile()` rather than synthesize one. Drivers are stateless: after provider acceptance with a lost response, reconstruction creates a fresh driver with empty local attempt/script state, while an injected observer retains the one external attempt. It starts no automatic retry or reconciliation; the durable outbox owns the persisted `unknown` outcome and every later decision.

Payload validators must return exactly `true` or `false`; non-booleans and throws become pre-effect `invalid_payload/not_applied`. Injected typed classifier output is accepted only under these rules: `aborted`, `invalid_payload`, `destination_missing`, and definite `rejected` are `not_applied` and non-retryable; `rate_limited` is `not_applied`, retryable, and carries a valid `retryAfter` instant; timeout/transport failures may be `not_applied` or `unknown`, carry no `retryAfter`, and expose their explicit retryable flag. Every other combination becomes a bounded `transport_unavailable/unknown` result. Success timestamps, receipts, provider detail and identities are validated, and certainty is derived rather than trusted.

Each driver gets a scripted fake with before-send failure, accepted-then-disconnected, delayed receipt, abort, malformed boundary/classifier, and crash/restore controls. Latent current-Piclaw boundary factories receive injected callbacks only for timeline/SSE, channel, Web Push, Pushover, and wake; they do not import configured singletons or perform live effects. Compatibility tests invoke the real SSE broadcaster, stored Web Push service with injected send/presence seams, and Pushover channel with stub fetch, plus typed current channel/wake signatures. Timeline uses a typed envelope whose `chat_jid` equals the destination and whose `delivery_id` equals caller-owned `deliveryIdentity`; mapper throw or identity mismatch is pre-effect `invalid_payload/not_applied`. Web Push mappers require string `title`/`body` and string optional fields before service invocation; channel/Pushover use fatal UTF-8 decoding. The current wake/resume callback receives only the destination chat (and no dedupe identity); `wakeId` is result trace/correlation only. Formatting/truncation tests remain driver-specific.

## EF-S07 — scheduled run store

### Purpose

Persist one occurrence of a scheduled task, its lease, result, next occurrence and references to accepted Piclaw work or delivery. It does not execute an agent or shell command.

### Interface

The compile-checked concrete interface is
`runtime/src/service-effects/contracts/scheduled-run-store.ts`. It defines the
five lifecycle methods (`claimDue`, `renew`, `bindAcceptedSource`, `complete`
and `abandon`), bounded `get`/`listRuns` reads, and the bounded
`cleanupTerminal` retention mutation. The WP-3A corrections are:

- `(taskId, scheduledFor)` is unique and `runId` is
  `scheduled_run:` plus lowercase SHA-256 of that canonical tuple. A caller
  never supplies a run ID while claiming.
- `ScheduledTaskSnapshot` is an immutable private task revision containing
  only body-free configuration: chat/kind, opaque `payloadRef`, model,
  schedule/timezone, notify/mute, shell/internal settings, redaction and
  execution-repeatability policy. Prompt and command bodies do not enter S07.
- Every lease mutation carries `workerId`, `expectedAttempt`,
  `expectedTaskRevision`, raw token and canonical `now`. Only the token hash is
  stored. Renewal appends durable before/after expiry evidence and updates the
  effective lease in the same transaction. Claim and renewal replay return raw
  tokens only while the exact worker/token/attempt remains active; terminal,
  retained or superseded-attempt replay returns `invalid_transition` and never
  fabricates an executable lease.
- `complete` carries an explicit closed success/error shape, duration, bounded
  result references and complete `EnqueueOutboxRequest` values. Success requires
  `resultRef` and forbids `errorCode`; error does the inverse. Agent evidence must
  equal its EF-S01 binding, service-owned shell/internal evidence carries no
  source identity, and internal or notify-disabled snapshots reject notification
  intents. The store computes recurrence; callers cannot provide `nextRunAt`.
- `abandon` is terminal, writes no execution log, and makes exactly one
  recurrence decision. An explicit future `retryAt` creates a new occurrence
  time.
- Records expose the immutable occurrence decision as `nextRunAt`, distinguish
  `advanced`, `paused`, `deleted` and `superseded` task-head outcomes, and use
  `retained: true` for closed tombstone summaries after bounded cleanup.

The concrete error set adds `invalid_request`, `not_found` and
`corrupt_state` to the task/revision/lease/transition/storage tags. Every public
request and nested shape is normalized once as an exact closed object; sparse
arrays, duplicate outbox IDs, hostile accessors, non-finite arithmetic,
non-canonical instants and non-canonical run IDs fail before effect. Durable
occurrences, lease/renewal history, decisions, source bindings, outbox links,
results and tombstones are decoded as equally closed projections. Reads are
bounded, stable by `(scheduledFor, runId)`, immutable and intentionally
untraced.

### Private authority and state rules

WP-3A uses latent `service_effect_s07_tasks` heads and immutable task revisions.
An explicit setup authority creates, revises, pauses, resumes and soft-deletes
them in isolated tests. It does not mirror or dual-write production
`scheduled_tasks`; task-management convergence remains a future issue.

`claimDue` serialises claim/reclaim under SQLite write authority and orders all
candidates by `(scheduledFor, taskId)`. Active occurrences move through
`claimed`, optional agent-only `source_bound`, then terminal `completed` or
`abandoned`. Attempt, worker, token hash, revision and expiry are one CAS
fence. A later pause does not revoke started work and holds the computed next
run until resume. Delete settles with no successor. A newer revision settles
the old snapshot without overwriting the new head.

Agent binding requires stable `sourceId=runId`, EF-S01 kind
`scheduled_agent`, exact chat/source and primary operation ownership. These
source/operation projections are revalidated on durable reads. Shell and
internal runs never bind EF-S01. An expired agent run requires explicit
`agent_reconciled_absent` authority for that run/attempt plus an opaque evidence
reference; stable source identity is only the reconciliation key, not proof of
absence. Expired shell/internal runs require explicit `repeatable` or
`reconciled_absent` reclaim authority. Every reclaim authority and evidence
reference is retained in lease history; lease expiry alone authorizes nothing.

### Recurrence, completion and retention

One-shot task heads are valid only when `nextRunAt === scheduleValue`; they close after execution. Intervals advance from completion/abandonment time. Cron
uses the current pure `computeNextRun` anchored at `scheduledFor` with the
frozen IANA timezone. Fixed vectors pin current `cron-parser` behaviour:
spring gaps advance to its next valid local instant and fall overlaps emit the
first match only before the next schedule.

Completion inserts one immutable run log, one next-occurrence decision, ordered
EF-S05 intents, the exact task-head CAS and the terminal occurrence in one
transaction. It uses `createServiceOutboxEnqueueInserter`; no worker or delivery
runs in S07. Durable reads revalidate every dense link against the EF-S05 enqueue
decision, kind/idempotency/request identity and the frozen run's operation/source
ownership. Existing EF-S05 IDs, changed binding/outbox identity under one
idempotency key, and cross-method terminal-key reuse are rejected. A later
EF-S05 `unknown` delivery is durable but cannot make a completed occurrence
reclaimable.

Bounded cleanup first writes a minimal terminal tombstone, then deletes
occurrence detail, logs and per-run decisions atomically. The tombstone retains
occurrence uniqueness and protected-data-free exact terminal replay. Nonterminal
and recent runs are never cleaned.

### Adapter evidence and boundary

Current `getDueTasks()`, process-local queue deduplication, `logTaskRun()` and
`updateTaskAfterRun()` remain behaviour evidence only: they have no durable
claim and their writes are separate. WP-3A reuses only the reviewed pure
recurrence utility and the EF-S01/EF-S05 private composition schema. It does
not import, edit, register or call the live scheduler, queue, task database,
management/query API, worker, timer or executor.

The exact shared C01-C08 catalogue remains the normative acceptance list. Its
21 shared C/S/R cases run unchanged against an independently parsed map-based fake and
the isolated SQLite adapter. R01/R02 plus SQLite supplementary cases cover every
mutation checkpoint, post-commit lost acknowledgement and fresh restore after
claim/bind/renew/terminal/retention, pause/delete/revision, explicit reclaim
and stale-attempt fencing, completion-kind matrices, recurrence/DST and overflow,
hostile closed-shape inputs, durable corruption, pagination/retention, trace
redaction/observer failure, two-connection claim/reclaim/terminal races, and the
static latent-import boundary.

## EF-S08 — projection sink

### Purpose

Publish an already narrowed Piclaw status or event DTO to web clients. The sink is transport only and cannot infer lifecycle authority from presentation state.

### Interface

```typescript
interface AgentProjectionSink {
  publishSnapshot(
    snapshot: PublicAgentSnapshot,
  ): Promise<Result<void, ProjectionSinkError>>;

  publishEvent(
    event: PublicAgentEvent,
  ): Promise<Result<void, ProjectionSinkError>>;

  publishTerminal(
    terminal: PublicTerminalProjection,
  ): Promise<Result<void, ProjectionSinkError>>;
}

interface ProjectionIdentity {
  chatJid: string;
  operationId: string;
  harnessOperationId: string | null;
  watchGeneration: number;
  receiptSeq: number;
}

interface PublicAgentSnapshot extends ProjectionIdentity {
  type: "agent_snapshot";
  phase: "idle" | "accepted" | "running" | "waiting" | "suspended" | "cancelling";
  modelLabel: string | null;
  activeToolNames: readonly string[];
  cancellationRequested: boolean;
}

type PublicAgentEvent =
  | (ProjectionIdentity & { type: "phase_changed"; phase: PublicAgentSnapshot["phase"] })
  | (ProjectionIdentity & { type: "assistant_delta"; textDelta: string })
  | (ProjectionIdentity & { type: "tool_started"; toolCallId: string; toolName: string })
  | (ProjectionIdentity & { type: "tool_updated"; toolCallId: string; publicSummary: string | null })
  | (ProjectionIdentity & { type: "tool_finished"; toolCallId: string; outcome: "completed" | "failed" | "cancelled" })
  | (ProjectionIdentity & { type: "usage_updated"; inputTokens: number; outputTokens: number });

interface PublicTerminalProjection extends ProjectionIdentity {
  type: "agent_terminal";
  terminalCommitRef: string;
  disposition: PiclawDisposition;
  messageRowId: number | null;
  errorCode: string | null;
}
```

The caller narrows and semantically redacts future Earendil events before invoking the sink. Allowed public strings such as assistant deltas and summaries are trusted already-redacted values; the sink enforces their type plus closed DTO keys/shape and does not attempt semantic secret detection inside allowed strings. Unknown runtime DTOs pass through one guarded normalization: every field is copied into locals and checked against changing/throwing getters, arrays are independently copied, and the result is a plain deeply frozen DTO. Only that normalized DTO reaches trace, authority, cursor, and transport. Authority predicates must return exact booleans; non-booleans and throws become `transport_unavailable/not_applied`. A caller-owned authority predicate validates exact `(chatJid, operationId, harnessOperationId)` ownership, and a second predicate validates the committed Piclaw terminal reference. The sink owns only an in-memory per-owner projection cursor: an authorized snapshot establishes or resets generation, events and terminal require that generation plus a strictly increasing receipt sequence, and terminal permanently closes the exact generation. Different owners never share cursor state. Unknown keys outside the closed DTO union are rejected before transport. Existing SSE publication is a synchronous boundary, so authority, cursor validation and publish occur without an async replacement race. After process restart the cursor is empty and the watcher must publish a fresh authorized snapshot before events.

### Adapter and tests

Reuse the web SSE broadcaster and public status DTO transport. Current status merge/orchestration rules stay outside the adapter. The fake captures public DTOs and rejects protected keys.

Contract cases cover snapshot then buffered events, reconnect generation, stale callbacks, duplicate receipt sequence, cross-chat identity and terminal projection before/after a committed terminal reference.

## EF-H01 — execution context resolver

### Purpose

Resolve Piclaw identity and environment mechanics for a future Earendil contextual tool batch. The returned environments are Earendil's direct `ExecutionEnv`; Piclaw defines no filesystem or shell substitute.

### Interface

```typescript
interface PiclawToolContext {
  readonly chatJid: string;
  readonly operationId: string;
  readonly env: ExecutionEnv;
  readonly localEnv: ExecutionEnv;
}

interface ResolveExecutionContextRequest {
  chatJid: string;
  operationId: string;
  expectedOperationVersion: number;
  requestedRoute: "current" | "local";
}

interface ExecutionContextResolver {
  resolve(
    request: ResolveExecutionContextRequest,
  ): Promise<Result<PiclawToolContext, ExecutionContextError>>;
}

interface ExecutionContextError extends PiclawEffectError {
  readonly _tag:
    | "operation_not_found"
    | "version_mismatch"
    | "route_unavailable"
    | "invalid_ssh_profile"
    | "credential_unavailable"
    | "environment_unavailable";
}
```

Resolution takes a snapshot. A later SSH profile change does not redirect an already executing tool batch. Secrets are injected into the environment implementation and never returned in context metadata. Every resolver failure occurs before an external effect and therefore has `certainty: "not_applied"`; this includes missing/stale operation authority, routing/profile/credential lookup, environment construction, and malformed or throwing injected callbacks. SSH execution certainty is not a resolver error: a disconnect proved before command submission is a bounded Earendil execution failure, while a disconnect after submission is returned directly as Earendil `ExecutionError("unknown")` and carries no retry claim.

### Adapter over current Piclaw internals

Extract mechanics from:

- `runtime/src/extensions/ssh-core.ts` for remote path and process transport;
- `runtime/src/tools/tracked-bash.ts` for shell execution, timeout, updates and output limits;
- `runtime/src/utils/process-tracker.ts` for process ownership and cleanup;
- keychain-backed environment injection for shell secrets;
- public `NodeExecutionEnv` where it meets local requirements.

The future adapter implements exact selected `ExecutionEnv` error and no-throw semantics. The resolver is Piclaw-owned because it selects local/SSH context from authenticated service state. Tool execution remains Earendil-owned.

The fake provides deterministic filesystem/shell results, abort barriers, disconnect ambiguity and cleanup traces. Contract cases cover local/SSH selection, immutable resolution, relative/canonical paths, symlinks, timeout, abort, process-group cleanup, remote disconnect and secret redaction.

## Direct Earendil boundary specifications

These boundaries need compatibility assertions and behavioural cases, not Piclaw interfaces.

### EB-01 — models and credentials

Illustrative assignment checks:

```typescript
const models: Models = modelRuntime;
const credentials: CredentialStore = fileCredentialStore;
```

Current evidence sources:

- `runtime/src/agent-pool/model-services.ts`;
- `runtime/src/agent-pool/credential-store.ts`.

Required selected-version assertions:

| Area | Required behaviour |
|---|---|
| Model catalogue | Stable provider/model identity; missing model is an Earendil-typed expected failure |
| Streaming | Exact selected `Models.streamSimple` input, events, final message and abort semantics |
| Deferred work | Exact `DeferredHandle`, one fetch per resume step and direct cancellation result |
| Usage | Earendil `Usage` values preserved without Piclaw reinterpretation |
| Credentials | `CredentialStore.modify()` is the serialized mutation path; concurrent writers do not lose updates |
| Refresh | Transient OAuth refresh failures retain current classification and do not expose tokens |
| Redaction | Credential values never enter service state, traces, telemetry or projection |

Piclaw updates concrete implementations when selected types change. It does not add `ModelEffector`, stream-result or credential wrapper types.

### EB-02 — tools

Do not preserve `AgentToolFactory` or define `PiclawToolEffect`. Each future tool manifest row has this documentation shape:

```typescript
interface ToolPreparationSpec {
  toolName: string;
  currentSource: string;
  effectClass: "query" | "mutation" | "mixed";
  replay: "safe" | "never";
  contextFields: readonly (keyof PiclawToolContext)[];
  serviceEffector: "EF-S01" | "EF-S03" | "EF-S04" | "EF-S05" | "EF-S07" | null;
  abortExpectation: "must_stop" | "may_finish_late";
  protectedFields: readonly string[];
}
```

Required family rules:

| Family | Selected Earendil contract | Replay | Preparation evidence |
|---|---|---|---|
| Read | Root-exported `@earendil-works/pi-agent-core` `createReadTool` | `safe` | Path, image, truncation, abort and redaction cases |
| Write/edit | Root-exported `@earendil-works/pi-agent-core` `createWriteTool` / `createEditTool` | `never` | Mutation serialization, exact edit diagnostics and ambiguous crash cases |
| Bash/PowerShell | Root-exported `@earendil-works/pi-agent-core` `createBashTool` or direct `AgentHarnessTool<PiclawToolContext>` | `never` | Streaming updates, output cap/full-output reference, process group, timeout and abort |
| Pure discovery | Direct `AgentHarnessTool<PiclawToolContext>` | `safe` | Snapshot consistency and no credentials |
| Piclaw mutation | Direct selected tool calling one EF-S contract | `never` unless exact-key reconciliation proves safety | Service idempotency key and effect certainty |
| Infrastructure/add-on | Direct selected tool | `never` by default | Query/mutation split before any `safe` classification |
| Unknown extension | Direct selected tool only after review | `never` | Manifest completeness and protected-data check |

Harness v3 resolves one `PiclawToolContext` per live or restored tool batch. A safe replay receives a fresh context. Piclaw does not retain the released-v2 closure binder once v3 generic tools are selected.

WP-3C accepted preparation corrections (2026-08-16):

- the manifest reuses the merged four-field `PiclawToolContext` (`chatJid`, `operationId`, `env`, `localEnv`) and does not widen or duplicate it;
- exact rows cover repository-owned core, Piclaw and bundled optional families, including effective `grep`, `find` and `ls` source gaps; arbitrary add-on and MCP-direct families use conservative `mixed`/`never` templates that cannot satisfy exact-name coverage;
- `messages` is `mixed`/`never` with `serviceEffector: null` and is activation-blocked: `add`/`post` are future EF-S03 candidates, while arbitrary-history `delete`/`move` require a separately approved fenced authority or retirement;
- non-service filesystem, process, model, credential, add-on-owned and external effects use `serviceEffector: null`; a non-null value identifies exactly one existing Piclaw service-operation contract;
- output persistence is post-result composition over one Earendil execution, preserving native update, truncation and full-output details and failing open without reinvocation;
- exact inventory is derived as source data from production composition roots, forwarded factories, optional platform/environment entries and the service factory; SDK families come from the installed package's literal `allToolNames`; the hermetic graph resolver consumes supplied `tsconfig` `baseUrl`/`paths`, package imports/exports, and ESM/TypeScript/CommonJS/dynamic forms instead of hard-coded Piclaw aliases;
- current add-on discovery parity is pinned separately to `getInstalledAddonExtensionPaths()` (`join` + `existsSync` + `statSync().isFile()`): it reads only declared `manifest.pi.extensions`, preserves duplicates and lexical paths, and does not enforce containment; the future direct package loader is activation-blocked until its distinct hardened policy rejects lexical/realpath escapes, duplicate real targets, unreadable targets and non-files;
- MCP-direct preparation preserves global, per-server and `MCP_DIRECT_TOOLS` precedence while descriptor-closing booleans, filters, names and selectors; cache evidence uses the installed authority's stable SHA-256 identity field set, version-1 server-map envelope, exact TTL boundary, and immutable typed skip evidence rather than caller-supplied definition hashes;
- every repository row separates `currentIntegration: "existing-production-wiring"` and a closed `currentAuthorityKind`/`currentAuthorityPath` from latent activation metadata: repository paths must exist, SDK/external paths use explicit package markers, and `messages` names `messages-crud.ts`; frozen future context/effector fields remain separate;
- validation rejects unknown shapes, accessors, symbols, sparse arrays, proxies, non-canonical context order, unsafe selector grammar and post-input mutation before returning frozen normalized data;
- source-derived repository schemas plus direct `pi-agent-core` read/write/edit/bash and effective SDK grep/find/ls schemas classify every top-level field as protected or as a rationale-bearing safe control; only five imported/spread factories retain explicit file/factory/rationale evidence, and unresolved fingerprints fail the suite;
- inventory, protected-observer and behaviour evidence is hermetic and static; future direct root exports from `@earendil-works/pi-agent-core` cover read pre/mid abort, canonical write/edit queueing, bash pending-update abort and native result behavior; the decision oracle snapshots/restores in-progress grants as non-executable unknown outcomes and reconciles all certainties without importing live stores.

Core and Piclaw-specific tool cases can be specified against current behaviour now. The provisional WP-3B suite compiles direct assignments for current package-root exports and pins one negative expectation for each known v3 gap. Positive assignments to the missing v3 contracts wait for a coherent selected type surface.

### EB-03 — resources and hooks

Selected-version contracts:

- skills use direct `Skill` values;
- prompt templates use direct `PromptTemplate` values;
- the harness receives direct `Resources`;
- selected public loaders retain Piclaw provenance through their generic source type;
- slash commands stay in Piclaw's authenticated service plane;
- extension callbacks map to exact selected `HookMap` names and payloads.

Preparation matrix:

| Current category | Future contract | Specification required now |
|---|---|---|
| Skill discovery | `Resources.skills` / selected loader | Precedence, provenance, duplicate-name and refresh cases |
| Prompt templates | `Resources.promptTemplates` / selected loader | Arguments, provenance, duplicate-name and missing-template cases |
| Tool registration | `AgentHarnessTool<PiclawToolContext>` | EB-02 manifest row |
| Slash command | Piclaw service command | Authorization, parse and exact service/harness call |
| Tool pre/post callback | Selected `before_tool` / `after_tool` hook | Ordering, patch limits, error and redaction cases |
| Provider callback | Selected request hooks or concrete `Models` configuration | Header/credential isolation and retry ownership |
| Compaction callback | Selected compaction hook/settings | Entry mutation rules and no second compaction lifecycle |
| Navigation/session callback | Selected navigation hook or Piclaw service command | Exact session/lane identity and rejection semantics |
| UI-only callback | Piclaw projection coordinator | No harness authority |
| Unsupported callback | None | Explicit unsupported record; no parallel hook bus |

Resource discovery/provenance cases can be independent of current `AgentSession`. Selected hook compile checks wait for a coherent v3 source.

### EB-04 — telemetry

Use Earendil's selected `TelemetryContext` and harness/AI schemas directly. Piclaw may create the parent context but needs no telemetry port.

| Span owner | Required span boundary | Required identity |
|---|---|---|
| Piclaw | Source acceptance and claim | `chatJid`, Piclaw operation ID, source sequence |
| Piclaw | Cancellation fence | Piclaw operation ID and cancellation source sequence |
| Piclaw | Terminal transaction | Piclaw operation ID, disposition and terminal commit reference |
| Piclaw | Outbox attempt | Outbox ID, kind, attempt and certainty |
| Piclaw | Scheduled occurrence | Task ID and scheduled run ID |
| Piclaw | Reconciliation | Piclaw and Earendil operation IDs plus decision code |
| Earendil | Run, step, provider, tool, compaction, hook, storage and usage | Exact selected schema; `pi.operation.id` keeps Earendil meaning |

Prompts, tool arguments/results, media bytes and secret values are prohibited attributes. Contract cases inspect exported spans after ordinary, failed, cancelled, duplicate and restored effects.

### EB-05 — harness, session, storage and events

Harness production implementation against historical `0.84.1`, current-loop `0.84.4` or draft PR #8076 is forbidden. The latent WP-3B suite invokes the public `0.84.4` scaffold only to record exact unsupported outcomes. PR #8076 is storage/primitives evidence and has no selected runtime. The first coherent tagged Harness-v3 implementation must provide:

| Surface | Selection requirement | Piclaw preparation |
|---|---|---|
| `AgentHarness` / `AgentLane` | Exported concrete `AgentHarnessConstructor` plus implemented prompt, queue, abort, resume, compact, navigation and close | HC semantic cases and exact service correlation expectations |
| `Storage` / `SessionRepo` | Memory conformance plus one durable backend, total migrations and precise-rewrite fencing | Backend fault, rewrite race, backup, corruption and Bun acceptance cases |
| Restore | Total open-operation state, process-local task loss and `lane.lastResult` | PC reconciliation table and every intent/admission/settlement crash case |
| Tools/context | Generic contextual tools and persisted `safe`/`never` semantics | EB-02 and EF-H01 specifications |
| Hooks/events | Typed hooks/events and snapshot-first buffered watch | EB-03 and EF-S08 projection cases |
| Manual drive | One selected action/effect at a time | HC manual/automatic equivalence cases |
| Errors/results | Exported tagged expected errors and thrown fault boundary | No Piclaw renaming or second taxonomy |

When these gates pass, Piclaw calls the selected contracts directly. EF-S01–EF-S08 and EF-H01 supply the Piclaw side of boundary tests.

### WP-3B provisional compatibility evidence (2026-08-18)

Piclaw's existing coding-agent loop selects tagged `v0.84.4` at `b79e4cc834970cca69daebffab7df1da7d1e52c4` as a coherent current runtime family. That release retains the released-v2 Harness scaffold and remains rejected/evidence-only for Harness v3. Tagged `v0.84.1` at `53fa77ccd8a279eb87e92294ef3687b03ff80112` remains the historical Harness baseline.

`runtime/src/service-effects/earendil-harness-v3-compatibility/` contains two files with no production importer or barrel:

- `manifest.ts` holds exact release coordinates, package integrities, declaration/runtime fingerprints, EB/HC outcomes and future promotion criteria. Descriptor-safe normalisation accepts only the closed evidence, rejects accessors, symbols, cycles, corruption and drift, and returns deeply frozen data.
- `direct-assignments.ts` uses package-root public types to compile direct assignments for models, credentials, execution environment, contextual tool factories, resources, lanes, sessions, hooks, events, telemetry and results. It emits no runtime code.

The compatibility matrix is provisional:

| Boundary | Compile | Runtime |
|---|---|---|
| EB-01 models and credentials | Pass | Unsupported |
| EB-02 tools and context | Fail | Unsupported |
| EB-03 resources and hooks | Fail | Unsupported |
| EB-04 telemetry | Pass | Unsupported |
| EB-05 harness, session, storage and events | Fail | Unsupported |

The compile fixture pins seven gaps: missing `AgentHarnessConstructor`, `HarnessEventBus`, `Storage`, `Transaction` and `UsageRow`; non-generic `AgentHarnessOptions`; and the incompatible `AgentHarnessTool<PiclawToolContext>`/released-v2 `HarnessTool` boundary. Package-root `createReadTool`, `createWriteTool`, `createEditTool` and `createBashTool` assignments compile directly.

HC-001–HC-020 all have status `unsupported`. The direct public `0.84.4` probe observes 25 exact `HarnessNotImplemented.operation` values. Wrong operation names, arbitrary throws and unexpected success are failures. No fixture supplies Harness execution semantics, storage, usage, manual driving or an event bus.

The exported `0.84.4` backend catalogue passes 30 cases on Memory and 30 on JSONL; the JSONL fixture supplies the backend-required `cwd` to `create()` and `fork()`. The suite computes the current catalogue digest from executed case IDs and retains the independently audited result digest. SQLite remains unsupported under Bun because the backend requires unavailable `node:sqlite`; the SQLite package is not installed. Historical `0.84.1` coordinates, fingerprints and 29-case catalogue/result evidence remain pinned without executing that release.

Harness promotion requires direct positive v3 assignments, HC-001–HC-020 semantic passes, durable-backend and migration evidence, EF-S01/EF-S02/EF-S05/EF-S08 authority preservation, the existing production gates and separate activation approval. Selecting `0.84.4` for the current loop does not select a Harness implementation or activate production Harness callers.

### Forbidden boundary abstractions

The future implementation must not add:

- `HarnessExecutionPort`, `AgentHarnessLike` or renamed lane methods;
- a Piclaw provider stream/result abstraction over `Models`;
- `PiclawToolEffect`, custom tool result/update types or a third replay state;
- Piclaw filesystem/shell results instead of `ExecutionEnv`;
- a transcript repository around Earendil `Storage`/`SessionRepo`;
- a duplicate harness event union used as execution authority;
- a parallel hook bus for callbacks the selected harness does not support;
- Piclaw-named copies of Earendil telemetry spans or errors.

## Contract-suite shape

Every effector suite runs against an independent fake and a current-Piclaw adapter:

```typescript
interface EffectorFactory<T> {
  readonly name: string;
  create(faults?: FaultPlan): Promise<T>;
  crashAndRestore(): Promise<T>;
  inspectTrace(): readonly NormalisedEffectTrace[];
}

function defineServiceWorkStoreContract(
  factory: EffectorFactory<ServiceWorkStore>,
): void;
```

The fake and adapter share request/result types and test cases only. Their storage and transition code differ.

Standard fault points:

- fail before effect;
- effect then lose acknowledgement;
- acknowledge then simulate process crash before the caller records the result;
- duplicate equal and conflicting requests;
- delayed result after owner/version replacement;
- cancellation concurrent with completion;
- lease expiry and stale worker result;
- malformed persisted row;
- protected payload presented to a trace or projection sink.

A normalised trace includes contract name, method, symbolic IDs, versions, certainty and result tag. It excludes raw message bodies, media bytes, tool arguments/results and secrets.

## Per-interface acceptance matrix

| Contract | Fake oracle | Current-adapter oracle | Minimum deterministic cases | Required crash/restart case |
|---|---|---|---|---|
| EF-S01 | Source/order/owner state projection | SQLite rows and constraints | 10 listed cases plus transition table coverage | Lost acknowledgement after accept, claim, cancellation and bind |
| EF-S02 | Atomic terminal reference state | One SQLite transaction and visible rows | 9 listed cases | Commit succeeds; process dies before result reaches caller |
| EF-S03 | Revision map and notice set | Message rows without terminal flag | Draft/notice idempotency and stale revision | Replacement commits; caller loses result |
| EF-S04 | Blob digest and binding sets | Media/message/operation references | Digest, compression, binding, deletion | Blob inserted before operation bind |
| EF-S05 | Intent/lease state machine | Outbox rows and compare-and-set updates | Every state edge and stale lease | Worker dies after claim and after external effect |
| EF-S06 | Scripted provider | Stubbed transport boundary | Certainty mapping per driver | Provider accepted; response lost |
| EF-S07 | Occurrence/lease state machine | Task, occurrence and run-log rows | Multi-worker, recurrence and completion | Death after claim, source bind and completion |
| EF-S08 | Captured public DTO sequence | SSE/status emission capture | Generation/sequence/redaction | Reconnect between snapshot and buffered events |
| EF-H01 | Deterministic filesystem/shell | Local/SSH environment test doubles | Routing, path, abort, cleanup, redaction | SSH disconnect during effect and process cleanup after restore |

An adapter passes only when the same contract-suite assertions pass against its fake. Existing tests can supply additional compatibility evidence; they do not replace these cases.

## Documentation-only specification slices

The slices below organise future implementation detail. They do not authorise code or migration.

### Dependency order

```text
S0 common contract vocabulary
 |
 +--> S1 existing-mechanics adapter specifications
 |
 +--> S2 durable-store and transaction specifications
 |
 +--> S3 scheduler and direct-Earendil preparation specifications

S1 + S2 + S3 --> implementation-ready specification set
```

S1 and S2 depend only on S0 and can be reviewed independently. S3 uses the common vocabulary and references all service contracts, but it does not require their implementation.

### S0 — interface package specification

Specify:

- the common request identity, error, certainty, canonical-hash and trace vocabulary;
- complete request/result/error types for EF-S01–EF-S08 and EF-H01;
- fake state machines and fault controls;
- parameterised contract-suite structure.

Future implementation boundary: no database migration, caller change or Earendil dependency update.

### S1 — adapters over existing mechanics

Specify adapter extraction and compatibility cases for:

- EF-S03 timeline drafts;
- EF-S04 media;
- EF-S06 delivery drivers;
- EF-S08 projection transport;
- EF-H01 local/SSH execution contexts.

Future implementation boundary: tests invoke adapters directly; production callers remain unchanged.

### S2 — additive durable adapters

Specify schema constraints, transaction statements and contract cases for:

- EF-S01 service work;
- EF-S02 terminal settlement;
- EF-S05 outbox.

Future implementation boundary: additive tables and direct contract tests only; no dual writes or authority change.

### S3 — scheduled occurrence and direct-contract preparation

Specify:

- EF-S07 occurrence/lease/run-log constraints;
- direct `Models` and `CredentialStore` compatibility assertions;
- resource/telemetry behavioural cases;
- a complete tool migration manifest and implementation-independent tool cases.

Future implementation boundary: the live scheduler and harness remain unchanged.

A future implementation PR should cover one interface plus its fake, current adapter and shared contract suite when review size warrants it.

### Specification work packages

| Package | Documents/results | Entry condition | Exit condition | Explicit exclusion |
|---|---|---|---|---|
| WP-0A | Common canonical-hash, error-certainty, clock/ID and trace specification | E-026 approved for refinement | Fixed vectors and bounded error tags documented | No TypeScript module |
| WP-0B | Generic deterministic test controls, contract-runner lifecycle and typed case catalogue | WP-0A vocabulary stable | Every interface maps to named cases, fault points, prerequisites and a crash oracle | No concrete interface or fake factory |
| WP-1A | EF-S03/EF-S04 adapter extraction map | Existing source evidence pinned | Each method maps to current persistence primitive and compatibility case | No source extraction |
| WP-1B | EF-S06/EF-S08 adapter extraction map | Transport evidence pinned | Certainty/redaction/generation rules complete | No transport change |
| WP-1C | EF-H01 environment map | Selected `ExecutionEnv` contract rechecked | Local/SSH method, error, abort and cleanup mapping complete | No environment implementation |
| WP-2A | EF-S01 logical schema and transaction specification | Source/operation types stable | Keys, constraints, transitions, reconciliation queries and migration assumptions documented | No migration file |
| WP-2B | EF-S02 message/media transaction specification | WP-2A terminal owner stable | Statement order, constraints, rollback and FTS handling documented | No database change |
| WP-2C | EF-S05 outbox logical schema specification | Error certainty stable | Lease state machine, indexes, reclaim and retention rules documented | No worker or table |
| WP-3A | EF-S07 occurrence model | Scheduler behaviour evidence pinned | Occurrence identity, lease, completion and recurrence rules documented | No scheduler change |
| WP-3B | EB-01–EB-05 compatibility matrix | Coherent Earendil source available for recheck | Exact exports/signatures and pass/unsupported report pinned | No dependency update |
| WP-3C | Tool manifest | Current tool inventory available | Every tool family has replay/context/service/redaction classification | No tool rewrite |

WP-0B implementation clarification (2026-08-12): WP-0A landed only the common
compile-checked vocabulary, while the per-interface signatures in this evidence
remain illustrative. WP-0B therefore supplies reusable deterministic controls
and the typed EF-S01–EF-S08/EF-H01 case catalogue without freezing those
signatures. Each later adapter/store issue owns its concrete interface and
independent fake factory.

### Interface dependencies

| Consumer/specification | Depends on | Reason |
|---|---|---|
| EF-S02 terminal settlement | EF-S01 logical operation/source rows; EF-S04 media references; EF-S05 insertable outbox intents | One atomic service terminal owner |
| EF-S03 timeline drafts | EF-S04 media references | Drafts may attach operation-owned media |
| EF-S05 outbox | None beyond common identity/error vocabulary | Independent durable intent store |
| EF-S06 delivery | EF-S05 lease/result concepts | Driver executes one claimed intent |
| EF-S07 scheduled runs | EF-S01 source binding and EF-S05 outbox intents | Agent occurrence becomes one accepted source; completion emits deliveries |
| EF-S08 projection | EF-S01 operation/correlation identity and EF-S02 terminal commit reference | Projection cannot invent authority |
| EF-H01 context resolver | EF-S01 exact operation/version | Environment resolves only for a current owner |
| EB-02 tools | EF-H01 and whichever EF-S contract a Piclaw tool mutates | Direct Earendil tool execution over Piclaw-owned effects |
| EB-05 harness boundary | EF-S01, EF-S02 and EF-S08 | Correlation, settlement and public projection surround direct lane calls |

### Specification review gates

| Gate | Required evidence |
|---|---|
| G-SHAPE | All request/result/error names resolve within the documentation; each method has one effect and bounded output |
| G-OWNER | Every durable row and lifecycle decision has one named owner; no Earendil execution state appears in Piclaw stores beyond correlation |
| G-IDEMPOTENCY | Every mutation has a key form, canonical equality input and conflicting-request outcome |
| G-FAULT | Every external mutation defines `not_applied`, `applied` or `unknown`; crash cases specify reconciliation |
| G-FAKE | Fake state and adapter state have independent oracles and the same case catalogue |
| G-REDACTION | Protected inputs/outputs are excluded from traces, telemetry and projection by named rule |
| G-CURRENT | Each adapter maps to existing Piclaw mechanics or is explicitly an additive future store |
| G-EARENDIL | Earendil-owned surfaces use selected exports directly and every prohibited wrapper remains absent from the design |
| G-SCOPE | Repository diff contains Markdown under this ADR only; fenced TypeScript is illustrative |

## Later convergence

No date or immediate cutover sequence is implied. The eventual caller changes are:

| Current mixed surface | Eventual caller change | Prepared contract |
|---|---|---|
| Cursor/deferred/inflight helpers | Service coordinator records accepted work and exact owner | EF-S01 |
| `storeAgentTurn()` | Coordinator commits terminal state, then delivery workers publish it | EF-S02, EF-S05, EF-S06 |
| Ad hoc drafts/notices | Projection/message callers persist without terminal authority | EF-S03 |
| Chat-scoped attachment registry | Tools/coordinator bind media to operation | EF-S04 |
| Direct Web Push/Pushover/channel calls | Outbox worker invokes one driver | EF-S05, EF-S06 |
| Scheduler poll plus closure queue | Scheduler claims one durable occurrence and accepts one source | EF-S07, EF-S01 |
| Status merge and direct SSE calls | Projection coordinator publishes narrowed DTOs | EF-S08 |
| Mutable SSH tool re-registration and tracked-bash wrappers | Earendil resolves one contextual batch | EF-H01 plus direct Earendil tools |
| `AgentPool` execution/recovery | Future service coordinator calls direct `AgentLane` methods | No Piclaw execution interface |

Convergence is ready only after current-Piclaw adapters and fakes pass the same contract suites. Earendil selection affects direct execution types, not the Piclaw-owned contracts in this document.

## Inventory coverage

| Inventory rows | Prepared contract or direct owner |
|---|---|
| EF-001, EF-002, EF-005, EF-029, EF-036 | EF-S02, EF-S03, EF-S04 |
| EF-003, EF-004, EF-006, EF-032, EF-034, EF-035 | EF-S01, EF-S05 |
| EF-022, EF-023 | EF-S07 plus EF-S01, EF-S05 and EF-S06 |
| EF-024, EF-026, EF-027, EF-028 | EF-S05, EF-S06 and EF-S08 |
| EF-016, EF-019, EF-025 and part of EF-030 | EF-H01 returning direct `ExecutionEnv` |
| EF-017, EF-018 | Direct selected Earendil tools; prepare manifests and tests |
| EF-020 and provider part of EF-030 | Direct `Models` and `CredentialStore`; prepare compatibility checks |
| EF-021, EF-031 | Direct Earendil resources, hooks and telemetry; prepare source-independent tests |
| EF-007–EF-015, EF-033 | Earendil execution, session and storage ownership; no Piclaw effector |

## Ready-to-implement checklist

An eventual implementation issue is ready when it names:

- one interface and one current adapter source;
- method-level idempotency key and expected-version rule;
- error certainty for every external mutation;
- the independent fake and standard fault points;
- the shared contract suite and interface-specific cases;
- protected fields and trace/projection redaction;
- whether it needs additive schema or only extraction;
- explicit confirmation that the PR does not change current runtime authority or callers.

S0 is the smallest preparatory implementation. It supplies compile-checked interfaces and executable contracts without binding Piclaw to an unfinished Harness v3 surface.