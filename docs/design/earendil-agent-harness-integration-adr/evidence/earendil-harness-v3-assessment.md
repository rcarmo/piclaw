# Earendil Harness v3 assessment

## Pinned evidence

Evidence was refreshed on **2026-08-14 at 07:35 UTC**. Moving branches and pull requests are described only at the exact revisions below.

| Item | Pin and observed state |
|---|---|
| Earendil repository | [`earendil-works/pi`](https://github.com/earendil-works/pi) |
| Reviewed `main` | [`5f7195c51eac43cdf329f813a7ef020d7bd74527`](https://github.com/earendil-works/pi/commit/5f7195c51eac43cdf329f813a7ef020d7bd74527) |
| Authoritative `main` specification | [`packages/agent/docs/harness.md`](https://github.com/earendil-works/pi/blob/5f7195c51eac43cdf329f813a7ef020d7bd74527/packages/agent/docs/harness.md), blob `9e38c1fab7ed77107952c1de850cdba987fff82c`, SHA-256 `bbbebf7f74c5773bb675c5b00f2b71e359f85dc15c416d1217b249a63051d85b` |
| Last specification commit on `main` | [`40a3d8556ab7fb4a6b4da20ffe1f5dfc08ec121d`](https://github.com/earendil-works/pi/commit/40a3d8556ab7fb4a6b4da20ffe1f5dfc08ec121d) |
| Current implementation candidate | Draft PR [#8076](https://github.com/earendil-works/pi/pull/8076), head [`fd389abc4677b4e0fa5dc9b2bbd2e63418f079b4`](https://github.com/earendil-works/pi/commit/fd389abc4677b4e0fa5dc9b2bbd2e63418f079b4) |
| Candidate specification | PR-head `packages/agent/docs/harness.md`, blob `80858b5eed97eb44e3d459217c58049e34759ce0`, SHA-256 `b14c390c474191b0546babe06fca9d452c49991ee755c50c3b54fa8a79ecdc7b` |
| Superseded implementation PR | [#7976](https://github.com/earendil-works/pi/pull/7976), closed without merge; do not use as current implementation evidence |
| Released packages | The current Piclaw loop selects coherent `0.84.4`; that release retains the unsupported released-v2 Harness scaffold |

The specification at reviewed `main` is byte-identical to the specification originally audited by this ADR. PR #8076 changes that candidate specification by 743 insertions and 495 deletions. The PR-head document is therefore useful development evidence, but it is not yet the merged authoritative specification.

At the observation time, PR #8076 was draft, open and mergeable, with 70 commits, 207 changed files, 12,969 additions and 19,024 deletions. Its `generate` job had passed, `publish` was skipped and `build-check-test` was pending at the pinned head. The immediately preceding head `b01c21e5e621d9e01a19e9c38530e57a0e61456f` failed `build-check-test` in the Cloudflare model-runtime compatibility test (`expected undefined to be defined`), while the root and SQLite backend suites shown in that run passed. This is evidence of draft instability, not evidence that the harness-specific changes failed.

Two older open PRs remain relevant only as separate evidence:

- [#7784](https://github.com/earendil-works/pi/pull/7784), head `3fed85d9473dcbb47ec2444c61781fcc1200bc41`, proposes bounded generic `findRecords()` queries for the released-v2 record model. It is currently conflicting and is not a Harness v3 recovery dependency.
- [#7751](https://github.com/earendil-works/pi/pull/7751), head `f3e5cc82a44c0970d3e6935417b6fb4079dc3d2a`, serialises current coding-agent compaction/navigation rewrites and adds issue-7738 race tests. It is current-loop regression evidence, not a v3 implementation slice.

## Implementation status

Harness v3 remains unreleased and is not yet a usable execution plane. PR #8076 has advanced far beyond the type-only #7976 branch. It has not completed the public runtime.

### Implemented or substantially implemented at the pinned candidate

- the v3 public type surface: entries, registers, usage rows, total operation state, results, typed events/hooks/snapshots, generic contextual tools and `AgentHarnessConstructor`;
- `Session`, `SessionTree`, callback-scoped `SessionMutator` and per-lane mutation serialisation;
- Memory storage/repository and shared session/storage conformance suites;
- format-4 JSONL storage, replay and torn-tail handling;
- a SQLite session backend with transaction, migration/repository/storage tests;
- branch queries, context projection, lane creation, facts, forks, storage instrumentation and benchmarks;
- low-level assistant and tool execution helpers plus an `EffectGate` contract.

### Still absent at the pinned candidate

`packages/agent/src/harness/agent-harness.ts` exports interfaces and tagged result/error types, but no concrete `AgentHarness` value or public runtime constructor/factory. `AgentHarnessConstructor.create()` is an interface contract only. The public lane methods — prompt, queue, abort, resume, compaction, navigation, manual drive and watches — therefore cannot yet be exercised as one real v3 harness at this head.

The candidate should not be described as implementation-ready merely because storage and execution primitives exist. Runtime composition, complete operation procedures, restoration, cancellation reconciliation, manual drive, snapshots/watches, migrations across operation-state versions and backend parity still need one coherent implementation and passing acceptance evidence.

Piclaw must consume public lower-level Earendil contracts. It must not depend on coding-agent's private `dist/server/create-harness` or preserve that helper's shape in a Piclaw wrapper.

## Core durable model

Harness v3 uses three durable stores:

| Store | Semantics |
|---|---|
| Entries | Immutable conversation tree; write once |
| Registers | Current mutable typed state; overwrite or delete |
| Usage ledger | Append-only cost/usage rows |

The principal registers are:

- `lane.leaf/{lane}`;
- `lane.config/{lane}`;
- `lane.state/{lane}`;
- `lane.lastResult/{lane}`;
- `op.meta/{operationId}`;
- `op.state/{operationId}`;
- `op.tool_args/{operationId}:{stepId}:{sourceIndex}`;
- `op.preparation/{operationId}:{taskId}`;
- `pending.entry/{entryId}`.

`op.state` is the durable restart point, not a live JavaScript instruction pointer. Terminal transactions delete operation registers and operation-owned pending entries, clear the lane's current operation and write one bounded `lane.lastResult`. Permanent entries and usage rows remain.

This remains strongly aligned with Piclaw's requirements: explicit operation identity, first-class cancellation, total current state, replay classification, bounded restore, deterministic manual barriers, typed projection and atomic terminal publication. It does not absorb Piclaw's external service responsibilities.

## Process-local execution and `EffectGate`

PR #8076's candidate specification makes one important distinction explicit. A durable open operation may exist without a **live operation task**. The live task is only the process-local async continuation for one lane and contains:

- its completion promise;
- its process-local `EffectGate` and cooperative `AbortSignal`;
- procedure-local provider/tool promises, settled values and streaming display state.

This task is not another durable state machine. A restart loses it and activates from the total durable `op.state` instead.

`EffectGate` arbitrates abort versus the start of ordinary hooks, provider operations, tools and retry timers. Preparation completes first; `assertOpen()` and invocation must then be adjacent synchronous statements with no `await` between them. Abort-first starts nothing. Admission-first gives the complete admitted operation the gate's signal.

The gate does **not** persist an `effect_started` marker and cannot remove the external-effect crash window. The durable sequence remains:

1. commit an `effect_pending` intent;
2. pass the process-local gate and start the external effect;
3. commit its result and next total state.

A process loss after step 2 but before step 3 leaves the effect's outcome unknown. Activation recovery must treat that state according to the selected harness semantics: provider work may be retried or classified under its captured policy; a tool may replay only when both persisted and current declarations are `safe`; unresolved `never` work must not be repeated. Piclaw's own service effectors retain their separate `not_applied | applied | unknown` certainty and outbox reconciliation rules.

Required Piclaw tests therefore cover both abort/admission orders and crashes at all four useful points: before intent, after intent before admission, after admission before external acknowledgement, and after external acknowledgement before settlement.

## Session mutation, transactions and concurrency

The candidate `Session.mutate(lane, callback)` serialises state-dependent mutations on one lane. The callback receives a scoped `SessionMutator`, may perform reads and may commit exactly once. `Storage.commit(Transaction)` remains the atomic write boundary. Session creation, lane creation and fact/tree updates have separate conformance cases.

Piclaw service locks must be released before awaiting model or tool effects. Harness effects start only after the relevant intent transaction and outside `Session.mutate`; Piclaw's accepted-source and terminal SQLite transactions remain in `messages.db` and do not share a distributed transaction with Earendil storage.

Current-loop PR #7751 demonstrates the danger of overlapping compaction and navigation rewrites. Harness v3 addresses ordinary lane mutations through its lane mutation line and a backend writer lease, while the **precise rewrite** is an administrative snapshot-copy-and-atomic-swap operation above the harness. Adoption must still test:

- prompt, compaction, navigation and close racing a live or queued mutation;
- two processes contending for one session writer lease;
- a precise rewrite racing a live writer, reader, index cursor and Piclaw backup;
- process death before and after the swap;
- no stale session object continuing to write the replaced generation.

The selected backend must define these semantics. PR #7751's current `AgentSession.isCompacting` fix is regression evidence, not an implementation to copy into v3.

## Recovery queries

Harness v3 recovery is point-read based: lane state identifies the current operation, and restore reads current `op.meta`, `op.state` and the bounded referenced entries/registers. It does not fold history and must not depend on a dedicated Piclaw recovery-query API.

PR #7784's generic `findRecords()` is useful evidence that a bounded query is preferable to proliferating one-off v2 record lookups. It does not apply directly to v3, whose selected `SessionReader` exposes `getEntries`, `getRegister` and `listRegisters`. Piclaw should use the exact selected public reader/harness surface and should not add a private `findOpenOperation` or deep-import a recovery helper.

## Storage versions, migrations and backend conformance

Harness storage has a `storageVersion` gate. Candidate migrations are intended to run on open under the writer lease and must map every register, including open `op.meta` and `op.state`. A newer unsupported version is refused. JSONL migration additionally requires lenient old-shape replay followed by compaction so superseded bytes are retired.

The precise rewrite is the only sanctioned path that removes permanent entries or usage rows. It copies a coherent retained snapshot into a fresh store and atomically swaps it, while changing the store generation used by search/index cursors. It is administrative tooling, not a lane method.

Selection requires the upstream conformance suites unchanged, plus Piclaw-specific coverage for:

- transaction rollback, write order, strictly increasing sequence and no partial visibility;
- register set/delete/recreate and delete-of-absent-key behaviour;
- Memory, JSONL and SQLite logical parity;
- JSONL torn transaction tails and conversion/compaction;
- SQLite `BEGIN IMMEDIATE`, fencing, lease expiry/repair and query-plan guards;
- total, crash-resumable migration of an open operation;
- precise-rewrite generation changes and concurrent access;
- backup/restore and Bun compatibility.

Passing backend conformance proves Earendil session semantics only. It does not prove Piclaw accepted-source ordering, terminal settlement or external delivery.

## Ownership boundary

Harness v3 is a library, not Piclaw's authenticated service. Piclaw continues to own:

- channel authentication and routing;
- durable accepted-source ordering and acknowledgement;
- Piclaw operation identity and correlation to session/lane/harness operation;
- exact service cancellation authority;
- timeline/media persistence;
- scheduler intent, run logs, notifications and delivery policy;
- immutable Piclaw terminal disposition and frontier;
- reconciliation between Piclaw state and Earendil open state/`lane.lastResult`;
- web/SSE projection generation and receipt ordering.

Earendil owns transcript execution, provider/tool lifecycle, compaction/navigation, total execution state, execution recovery, session transactions and harness cancellation signalling. No responsibility above is jointly owned.

## Contract-suite changes

Keep the existing HC/PC cases and add or strengthen these assertions:

- `EffectGate.assertOpen()` covers exactly the selected hook/provider/tool/timer catalogue, with abort-first and admission-first cases;
- close is a controlled process loss, not abort, and writes no cancellation marker;
- a live lane task and a restored orphaned `effect_pending` state are never mistaken for each other;
- crashes after effect admission are classified without claiming the effect did not happen;
- external finalisation stops a live task without duplicate writes or terminal events;
- restore uses bounded current-state reads and does not require v2 `findRecords()`;
- migration maps an open operation across every selected state-machine schema change;
- Memory, JSONL and SQLite pass the same backend cases;
- precise rewrite, session writer leases and PR-#7751-style rewrite races have deterministic outcomes;
- snapshot-first buffered watch and Piclaw receipt sequencing close different gaps and both remain tested.

## Adoption gates

Harness v3 is not selectable for production until:

1. one coherent tagged release contains compatible `pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-tui` and the selected session backend;
2. the public lower-level constructor/factory and all required lane methods are implemented without private coding-agent imports;
3. Memory conformance and at least one durable backend conformance suite pass;
4. prompt, tools, queues, abort, resume, compaction, navigation, manual drive, watch and close pass HC-001–HC-025;
5. every effect-intent/admission/settlement crash boundary passes under restart;
6. schema migration of open operations and precise-rewrite concurrency are proven;
7. Piclaw PC/golden suites pass under Bun, or an approved runtime boundary is documented;
8. installed scheduler, mobile Abort, SSE reconnect, backup and rollback gates pass.

## Assessment decision

Keep the current Piclaw loop on released `0.84.4` and retain `0.84.1` as historical baseline evidence. Use the specification on Earendil `main` as the authoritative design and PR #8076 only as pinned draft implementation evidence. The current-loop dependency update does not start Harness migration; one coherent tagged Harness-v3 implementation must pass every gate above before activation.
