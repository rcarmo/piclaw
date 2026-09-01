# Earendil 0.84.1 harness surface

Historical evidence baseline: `@earendil-works/pi-agent-core@0.84.1` and `@earendil-works/pi-coding-agent@0.84.1` as installed in Piclaw `v2.13.2`. Piclaw's current loop now selects `0.84.4`; this file preserves the original baseline survey.

Confidence: source inspection of published declarations and JavaScript in the installed packages.

## Package exports

`@earendil-works/pi-agent-core` exports the harness from its package root. It also exports the session contracts and a backend-neutral conformance suite at `@earendil-works/pi-agent-core/session/testing`.

The installed coding-agent files contain `dist/server/create-harness`, which demonstrates composition of `ExecutionEnv`, public agent-core tools and system-prompt construction over `AgentHarnessOptions`. The coding-agent package export map does **not** expose this path, so Piclaw must not import it directly. At this version, compose from public lower-level agent-core exports for fixture evidence only. The private helper's availability or shape is not an adoption requirement.

The package metadata declares Node `>=22.19.0`. Piclaw runs under Bun. Any adoption needs a Bun compatibility test even when the TypeScript surface compiles.

## Public execution model

`AgentHarness` is the main lane and can expose named `AgentLane` instances. The declarations define:

- `prompt`, `skill` and `promptFromTemplate`;
- `compact` and `navigateTree`;
- `resume` and `abort`;
- `steer`, `followUp` and `nextRun`;
- queued-item cancellation;
- usage recording;
- `waitForIdle`, `runWhenIdle`, manual action driving and watchers;
- model, thinking level, active tools, resources, retry, compaction and queue-mode configuration;
- lane creation, lookup and enumeration;
- explicit `close()`.

Every run-like operation returns a tagged `Result` rather than throwing for expected rejection. Expected errors include lane busy, no active run/operation, missing identities, invalid messages, unknown resources and a closed harness.

### Operation identity

The harness creates a `runId` for prompt, compaction and navigation operations. `LaneInfo.operation` exposes the operation ID, kind and `running`, `suspended` or `aborting` status.

Piclaw uses `operation_id` for durable acceptance and exact cancellation. The identifiers serve different ownership domains:

- Piclaw `operation_id`: accepted service-plane work and terminal disposition;
- Earendil `runId`: one harness execution operation.

The boundary must persist a correlation from one Piclaw operation to each harness run it starts. It must not substitute `runId` for durable acceptance identity.

## Durable session protocol

The harness receives a `Session`, which wraps a `SessionStorage`. The storage contract is append-oriented:

- entries hold transcript and configuration state;
- records hold operation intent, attempts, tool starts, queue intent, deferred writes, usage and operation finish;
- lane pointers identify each lane's leaf;
- facts hold session name and entry labels.

Each entry and record has a monotonic `seq` and timestamp. The storage interface exposes bounded entry, branch, record, open-operation and log queries.

### Record types

The installed version defines:

- `operation_started` with run, compaction or navigation intent;
- `abort_requested`;
- `operation_finished` with completed, aborted, failed or declined outcome;
- `step_attempt` for assistant, compaction or branch-summary work;
- `tool_started`, including effective arguments, result entry ID and replay policy;
- `queue_enqueued` for steer, follow-up or next-run input;
- `queue_cancelled`;
- `write_deferred`;
- `usage`.

This is close to the event-log structure required by the ADR. It does not record Piclaw's service-plane input acceptance, timeline persistence, notification delivery or terminal frontier.

## Pure recovery reducer

`reduceLaneState()` is a pure function in the installed package files. It is exported from its module but **not** through the package export map/root, so Piclaw production code cannot import it under the direct-adoption policy. Its implementation remains evidence for the selected-version fixture and for choosing a later version with a public recovery surface. It accepts a bounded recovery slice and reconstructs:

- current leaf and open operation;
- operation intent and aborting state;
- active step and attempt number;
- tool batch and unresolved results;
- missing initial messages;
- pending steer, follow-up and writes;
- pending next-run messages;
- deferred handle;
- effective model, thinking level and active tools;
- a terminal failure candidate.

`validateRecordLog()` rejects durable contradictions such as:

- multiple open operations;
- records for unknown or finished operations;
- non-consecutive attempts;
- invalid compaction reasons;
- queueing after abort;
- invalid queue cancellation;
- duplicate tool invocation;
- tool-call/result mismatch;
- provisioned-entry mismatch;
- invalid deferred handles.

The semantics are Earendil-owned. Piclaw should not duplicate them in a parallel execution reducer or deep-import this private module. Production uses the selected version's public recovery surface.

## Replay semantics

A `HarnessTool` declares `replay: "never" | "safe"`. A durable `tool_started` record captures the effective arguments and result entry ID before result persistence. The reducer detects whether a result exists and whether a call remains unresolved.

The ADR's contract suite should exercise both replay modes:

- `safe`: an unresolved invocation may be executed again under Earendil's recovery protocol;
- `never`: an unresolved invocation requires a terminal or operator-controlled reconciliation path and must not be repeated automatically.

Tool arguments and results are sensitive. Piclaw diagnostics should retain identifiers, replay policy and bounded hashes unless the existing secure session backend is the intended payload store.

## Queue semantics

The harness distinguishes:

- `steer`: belongs to the active run;
- `followUp`: belongs to the active run but executes after its current work;
- `nextRun`: remains lane-level input and is captured by the next run.

Queue records are durable in the harness session protocol. Abort reconstruction suppresses pending steer and follow-up items for the aborting run. `nextRun` survives as lane-level pending input unless captured by a run.

Piclaw also owns user-visible acceptance, ordering and timeline persistence. The integration needs one explicit mapping:

| Piclaw accepted source | Earendil delivery |
|---|---|
| New ordinary operation | `prompt()` or accepted `nextRun` captured into a new prompt operation |
| Steer accepted for an active Piclaw operation | `steer()` on the correlated Earendil run |
| Follow-up accepted while a run is active | Piclaw durable follow-up, later delivered as `followUp()` or a new Piclaw operation according to product semantics |
| Control | Direct harness configuration/operation only after Piclaw authorises and records it |
| Cancellation | Piclaw exact-owner fence followed by `abort()` on the correlated run |

The harness queue cannot become the sole proof that Piclaw accepted user input because timeline, acknowledgement and service restart semantics remain Piclaw responsibilities.

## Compaction and recovery

The declarations model compaction as a first-class operation with a `runId`, outcome and durable result entry. Compaction attempts preserve a reason: manual, threshold or overflow. Suspended operations report missing model/tool identities and can be resumed.

`AgentHarness.create()` returns suspended operations. Piclaw must reconcile them against its operation ledger before calling `AgentLane.resume()`. It must not resume an Earendil operation whose Piclaw owner has terminally settled or been cancelled.

## Events, hooks and watchers

The declared API includes:

- string-keyed `events.on()`;
- named hooks from `before_run` through `before_navigation`;
- lane and session watchers;
- manual `peekAction()` and `executeAction()` for deterministic driving.

These are useful selected-version fixture targets, but they are not implemented in the installed JavaScript.

## Installed implementation status

The published `0.84.1` JavaScript contains a structural preview, not a usable execution harness:

- `AgentHarness.create()` rejects restore when any record exists;
- `prompt`, compact, navigation, resume, abort and all queue methods throw `HarnessNotImplemented`;
- hooks, events and watchers throw `HarnessNotImplemented`;
- lane creation and lookup are unavailable;
- manual action driving is unavailable;
- configuration getters/setters and `close()` work;
- the pure reducer and session contracts are implemented.

Piclaw cannot integrate the installed `AgentHarness` as its execution plane. A test implementation is required for the `0.84.1` assessment and must use the declared public shape plus the implemented session/reducer semantics. A later selected version can change that shape; Piclaw updates accordingly.

## Session backend conformance

The exported session-testing module provides `createSessionBackendConformance(factory)`. A fixture supplies an isolated `SessionRepo` and disposes it after each runner-neutral case.

A future Piclaw-backed or dedicated session backend must pass this upstream conformance suite before use. Passing it does not prove Piclaw operation acceptance or terminal settlement; those remain separate service-plane contracts.

## Historical adoption boundary

This was the direct-adoption boundary derived from released `0.84.1`. Harness v3 now supersedes its storage/reducer/event/tool-context details; see [`earendil-harness-v3-assessment.md`](earendil-harness-v3-assessment.md). Retain only concepts that remain in the selected v3 public surface.

Adopt early:

- `AgentHarness`, `AgentLane` and their exact result/error semantics;
- `Session`, `SessionStorage`, `SessionRepo` and lane terminology;
- `ExecutionEnv`, `FileSystem`, `Shell`, `Result`, `FileError` and `ExecutionError`;
- `Models`, `HarnessTool`/`AgentHarnessTool`, `Resources` and `TelemetryContext`;
- durable operation/tool/queue semantics, mapped to Harness v3 values/lists and flat operation state rather than v2 record shapes;
- the selected version's public Harness v3 restore/current-state surface; `0.84.1` reducer code is historical evidence only;
- tagged `Result` outcomes;
- durable operation-ID correlation;
- replay policy;
- suspended-operation and missing-identity concepts;
- the selected Harness v3 backend conformance suite;
- deterministic direct-drive boundaries as the fixture target.

Keep in Piclaw:

- authenticated acceptance and response acknowledgement;
- the canonical accepted-source sequence;
- Piclaw `operation_id` and exact owner fence;
- timeline/media persistence;
- scheduler delivery policy;
- notifications;
- terminal disposition and frontier;
- reconciliation between Piclaw operations and Earendil runs;
- redacted web/SSE projection.

Do not build production against released `0.84.1`:

- its v2 record-log/reducer/session format;
- its untyped hook/event/watcher payloads;
- restore/resume behaviour limited to private reducer evidence;
- its contextual-tool widening workaround;
- installed `AgentHarness` methods that throw.

Harness v3 `dev`/draft PR #8963 at `d14d6b22327d545d6a253f932165b63e48d7f9c8` now contains a concrete constructor and complete public lane drive; only session watch remains stubbed, while WP08 fork/storage work continues. Use only one coherent selected source/package family after its direct contracts and backends pass the documented gates.
