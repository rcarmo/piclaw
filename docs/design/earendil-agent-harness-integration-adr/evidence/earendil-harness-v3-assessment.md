# Earendil Harness v3 assessment

## Pinned evidence

Evidence was refreshed on **2026-09-01 at 18:30 UTC**. Moving branches, pull requests and issues are described only at the exact revisions below.

| Item | Pin and observed state |
|---|---|
| Earendil repository | [`earendil-works/pi`](https://github.com/earendil-works/pi) |
| Reviewed `main` | [`b8b873b9872db04a938fb4357b5e8e824ddc051c`](https://github.com/earendil-works/pi/commit/b8b873b9872db04a938fb4357b5e8e824ddc051c) |
| Latest release | [`v0.84.4`](https://github.com/earendil-works/pi/releases/tag/v0.84.4), tag commit [`b79e4cc834970cca69daebffab7df1da7d1e52c4`](https://github.com/earendil-works/pi/commit/b79e4cc834970cca69daebffab7df1da7d1e52c4), published 2026-08-28 |
| Released Harness evidence | The four packaged `dist/harness/agent-harness.{js,d.ts,js.map,d.ts.map}` files are byte-identical between `0.84.2` and `0.84.4` |
| Current implementation branch | `dev` at [`d14d6b22327d545d6a253f932165b63e48d7f9c8`](https://github.com/earendil-works/pi/commit/d14d6b22327d545d6a253f932165b63e48d7f9c8) |
| Current integration PR | Draft PR [#8963](https://github.com/earendil-works/pi/pull/8963), **DRAFT: dev branch**, at the same head; predecessor [#8232](https://github.com/earendil-works/pi/pull/8232) closed as the branch moved |
| Candidate specification | `dev` [`packages/agent/docs/harness.md`](https://github.com/earendil-works/pi/blob/d14d6b22327d545d6a253f932165b63e48d7f9c8/packages/agent/docs/harness.md), blob `c7c18c74730d4971f8ca004924e44c7fbe236f25`, SHA-256 `1b200eb7b4255d5afd71e17bb4cf54f82e2c5d1d1e24ae87ba97363838251785` |
| Direct-drive handoff | `dev` [`packages/agent/docs/work-packages/05-direct-durable-drive.md`](https://github.com/earendil-works/pi/blob/d14d6b22327d545d6a253f932165b63e48d7f9c8/packages/agent/docs/work-packages/05-direct-durable-drive.md), blob `b1deaffa78f442ae149473af7e04c66745a685e3`, SHA-256 `d774bd5e92d2db41d254b82175432d2a57bf4ea3ad38130f0d0f1ed7895e3dc8`; complete through public drive |
| SQLite ownership | WP07 implemented on `dev`: host/worker lifecycle owns writable authority; storage-layer writer leases were removed |
| Fork work | WP08 named-branch and streaming forks is in progress; part of its contract/classifier work is merged into `dev` |
| Piclaw runtime selection | Piclaw now pins coherent `0.84.4`; issue [#1070](https://github.com/rcarmo/piclaw/issues/1070) is complete |
| Piclaw UI-prompt compatibility | Issue [#1071](https://github.com/rcarmo/piclaw/issues/1071) is complete; stale-progress suspension uses extension-runner UI events without selecting Harness |

### Released Harness fingerprint

Independent extraction of the published `@earendil-works/pi-agent-core` tarballs produced these SHA-256 values for both `0.84.2` and `0.84.4`:

| Packaged file | SHA-256 |
|---|---|
| `dist/harness/agent-harness.js` | `21fdb3355adafd53c26337617a73918ba49e9832c42cde8b71c469abeecb5916` |
| `dist/harness/agent-harness.d.ts` | `3ceafcd72816bc8312f3f851625c082ae0b9099821fb3329e6ff9df165033472` |
| `dist/harness/agent-harness.js.map` | `8cc842acad1ffabbb32ca09be449e22c70f1516d1b46788798af2e40b239369b` |
| `dist/harness/agent-harness.d.ts.map` | `43182c5a9fa7149b82ef09cce483676f6d166522609014b7854ccb98331e248c` |

The `0.84.4` package retains the same released-v2 Harness scaffold and the same 25 direct `HarnessNotImplemented` outcomes in Piclaw's compatibility suite. The package upgrade is runtime maintenance, not Harness selection or activation.

### Current `dev` integration evidence

Draft PR #8963 reported 385 commits, 557 changed files, 89,658 additions and 23,752 deletions against current `main` at the observation time. GitHub classified it as open, draft, mergeable and clean.

Exact-head CI [run 33530830225](https://github.com/earendil-works/pi/actions/runs/33530830225) passed `build-check-test` at `d14d6b22327d545d6a253f932165b63e48d7f9c8`. Reported suites included:

- agent: 661 pass, 1 skip;
- AI: 987 pass, 833 skip;
- coding-agent: 2,066 pass, 50 skip;
- SQLite: 133 pass;
- protocol/client/server/telemetry/TUI shown suites: pass.

This is green source-branch integration evidence. It is not a published package or a Piclaw-runtime acceptance result.

## Assessment result

Harness v3 on `dev` has a complete public lane drive and a total 13-leaf execution graph. Only `AgentHarness.watchSession()` remains deliberately `SliceNotImplemented` in the runtime source.

This closes the runtime-completeness blocker from the August assessment. Production selection still waits for a coherent package/source candidate, Piclaw's direct compatibility refresh, shared HC/PC suites, selected storage/fork semantics and explicit activation approval.

## Implemented at the pinned `dev` tip

### Direct public contracts

The candidate exports:

- generic `AgentHarness<TContext>` and `AgentHarnessOptions<TContext>`;
- public `AgentHarness.create` satisfying `AgentHarnessConstructor`;
- direct `AgentLane` admission, drive, queue, abort, compaction, navigation, result, watch and configuration surfaces;
- generic `AgentHarnessTool<TContext>` with stable `AgentHarnessToolInvocation`;
- typed `HarnessEvent`, `HookMap`, lane snapshot reducer, `Context` and telemetry propagation;
- `Storage`, `Session`, `Branch`, `SessionRepo`, `OperationResultRecord`, `UsageRow`, values/lists and backend test contracts;
- direct `Models`, `CredentialStore`, `ExecutionEnv`, resources and built-in tool factories.

The constructor attaches without starting provider/tool effects, restores configured lanes and reports open operations. A fresh Session has no implicit main Branch or AgentLane; callers acquire one explicitly through `harness.lane(name, context)`.

### Session, Branch, lane and Harness ownership

| Concept | Responsibility |
|---|---|
| `Session` | Global entries, usage, values/lists, metadata, Branches, one mutation line and one backend lifecycle |
| `Branch` | One named immutable-entry path plus mutable tip and direct data appends |
| `AgentLane` | A Branch plus configuration, lane-owned tagged inbox, operation state, Drive and observation |
| `AgentHarness` | Lane manager, global resources/options, hooks/events and lifecycle; it is not a lane |

One keyless Session mutation line serialises read-decide-commit-publication work. Ordinary reads bypass it and observe complete backend commits. Provider calls, tools, hooks, timers and asynchronous event delivery stay outside mutation callbacks.

### Durable state and results

The candidate uses:

- immutable entries;
- typed scalar `Value<T>` and append-only `ValueList<T>` addresses;
- append-only usage rows;
- one flat 13-leaf `OperationState` union;
- one lane-owned tagged inbox for steer, follow-up, next-run and deferred writes;
- orthogonal cancellation control;
- immutable per-operation `OperationResultRecord` values under `pi.result`;
- operation-owned values/lists for arguments, frames, memos, checkpoints, preparations and staged results.

`Lane.state` is authoritative while one Harness owns a Session. Procedures read storage only to dereference content or enumerate cleanup addresses. Process loss reconstructs the projection from durable values.

`drive({ operationId, ... })` installs or joins the current operation or returns its immutable result record. Terminal observation no longer hydrates transcript entries.

### Provider, retry and deferred execution

Implemented procedures cover:

- atomic prompt/skill/template acceptance with optional caller-supplied operation ID;
- checkpoint planning and lane-inbox consumption;
- durable provider intent with reserved response/usage IDs;
- admitted streaming under the operation gate;
- burst-safe durable assistant frames;
- atomic assistant entry, usage and next-state settlement;
- unknown-outcome provider recovery from committed frame prefixes;
- durable retry waits and direct wait policy;
- deferred suspension, poll permits and fresh-ID unknown-poll recovery;
- in-band model/tool configuration failures.

### Durable tools

Implemented sequential and parallel tool procedures cover:

- deterministic lookup, argument preparation and typed hooks;
- persisted arguments and `safe | never` replay before execution;
- stable invocation identity (`invocationId`, `operationId`, `turnId`);
- invocation-scoped durable memos and bounded output checkpoints;
- safe replay only when persisted and current declarations both say `safe`;
- synthetic interruption for `never`, unavailable or no-longer-safe calls;
- completion-order staging with source-order transcript placement;
- usage rows, `addedToolNames`, termination and cancellation;
- direct contextual tool and invocation `Context` propagation.

The later `dev` work also added bounded shell-output capture and integration. Piclaw should adopt the selected direct tool contract rather than preserving its current large-output wrapper shape.

### Structural execution and navigation

The public drive implements:

- threshold and overflow compaction;
- standalone compaction;
- summarized and unsummarized navigation;
- structural decision hooks;
- one durable intent and usage row per nested summary request;
- attempt-level retry/recovery;
- atomic compaction/navigation result publication;
- threshold deduplication derived from the transcript;
- family-neutral summary leaves and closed result-boundary handling.

### Cancellation, total dispatch and public surfaces

The candidate implements:

- exact-ID `requestAbort()`;
- durable cancellation before signal pull;
- atomic drain-and-return of steer/follow-up input while preserving next-run/write items;
- cancellation reconciliation for every execution leaf;
- one total direct `state.at` dispatcher;
- lane-owned Drive install/join/observation;
- public prompt, resume, queue, abort, compaction and navigation methods;
- convenience composition from public primitive operations;
- immutable old-operation result lookup;
- lane snapshot/event replication via `reduceLaneSnapshot()` and `resnapshot()`.

Caller invocation cancellation affects only that observer after Drive installation. Durable operation cancellation uses `requestAbort()`.

### Lane projection

Typed lane watches are snapshot-first and buffered. `LaneSnapshot` carries configuration, operation state, tagged queue projection, stats and the latest operation result. `reduceLaneSnapshot()` is the event fold; navigation requests a rebase through `resnapshot()`.

`watchSession()` remains unimplemented. Piclaw's first integration can use per-chat/lane projection. Session-wide dashboards must wait or compose from lane inventory and watches.

### SQLite host ownership

WP07 replaced an incomplete storage-layer writer lease with an explicit host/worker ownership model:

- exactly one host-assigned process owns writable Session authority;
- server/worker replacement closes the old owner before opening the new one;
- same-repository active-source forks retain commit-queue ordering;
- external/live-worker sources fork through independent read-only WAL snapshots;
- non-creation paths use no-create modes;
- active storage identity includes canonical container path plus Session ID;
- IDs are path-safe;
- repository close waits for all cleanup attempts.

The storage layer does not protect against a trusted host opening two writable processes. Piclaw's selected runtime boundary must enforce worker ownership and test transfer/replacement explicitly.

### Named-branch and streaming forks

WP08 is in progress. `dev` already requires explicit named branches for branch forks, validates ancestry/configured lanes, centralises scalar namespace policy and merges part of the streaming-fork work. The final WP08 contract still covers bounded-memory Memory/JSONL/SQLite copies, application value/list policy, source non-mutation, sequence preservation and backend equivalence.

Do not treat current draft format-4 fork/storage shapes as a compatibility promise. Select and test one coherent source/release.

## Released `0.84.4` compatibility boundaries

### Extension UI prompt lifecycle

`0.84.4` adds blocking extension-runner events `ui_prompt_start` and `ui_prompt_end`. They are registered through `ExtensionAPI.on(...)`; they are not `AgentSessionEvent` values and do not arrive through `session.subscribe(...)`.

Piclaw issue #1071 implemented a current-runtime extension listener that suspends stale-progress supervision with `reason: "ui_prompt"`, restores the previous phase and keeps the absolute turn deadline running. Duplicate/nested events and terminal cleanup are current-loop compatibility concerns, independent of Harness adoption.

A future Harness projection represents an actual blocking user wait as public phase `waiting`, owned by the exact operation/lane. Response, timeout, rejection, abort and teardown clear it idempotently. Public waiting projection and watchdog suspension are separate contracts.

### Terminal bookkeeping

`0.84.4` changes low-level loop semantics so `prepareNextTurn` and `prepareNextTurnWithContext` run only when stop/queue decisions start another assistant turn. Terminal bookkeeping belongs in durable operation settlement or the selected terminal event (`agent_end` in the current loop), never in `prepareNextTurn`.

Piclaw must not add compensating hooks that later conflict with Harness terminal ownership.

### Current-loop boundaries preserved during convergence

- Piclaw keeps upstream automatic compaction disabled and retains current safe-boundary compaction until the Harness path owns compaction end to end.
- Current coding-agent session creation omits `tools`; passing it is an allowlist that can silently suppress extension tools.
- Encrypted reasoning from `0.84.4` remains an empty thinking block with `thinkingSignature`; Piclaw must not convert it back to tool-call `thoughtSignature`.
- Current-runtime UI-prompt suspension is not a Harness dependency or activation gate.

### Usage and telemetry preservation

Released `0.84.4` still lacks Piclaw's compatibility fields:

- `cacheReadReported`;
- `cacheWriteReported`;
- validated finite non-negative `providerCost`.

Issue #1070 rebased and preserved the versioned `pi-ai` patch. A future Harness usage/telemetry adapter must carry these values through direct usage ingestion. It must not infer cache-hit reporting from token counts or recompute provider cost.

## Remaining blockers

### Released packages remain unusable for Harness execution

The published `0.84.4` Harness is byte-identical to `0.84.2`. Piclaw's 25 unsupported outcomes remain authoritative until a v3 implementation is released or separately selected from source.

### No selected package/source candidate

`dev` has green exact-head CI and complete public lane drive, but it remains an open draft integration branch with ongoing storage/fork and Chord work. Piclaw has not approved a reproducible source pin or package family for Harness execution.

### Session-wide watch is incomplete

`watchSession()` is the sole remaining runtime `SliceNotImplemented` method. This does not block lane-scoped canaries if explicitly excluded, but it blocks claiming complete session-wide observation.

### Fork/storage contract is still moving

WP08 remains in progress. Format 4 is work in progress and Earendil changes draft schemas/contracts in place. Piclaw must select a coherent storage version and test migration from that selected version; it should not persist production sessions using an arbitrary `dev` snapshot.

### Host ownership needs Piclaw integration proof

WP07 deliberately places writable ownership above the SQLite storage layer. A selected Piclaw host/worker boundary must prove old-owner close, new-owner open, live read-only fork snapshots, deletion ordering, process replacement and no duplicate writable authority.

## Exact evidence and verification

### Published `0.84.4`

Piclaw now pins `@earendil-works/pi-agent-core`, `pi-ai` and `pi-coding-agent` to exact `0.84.4`. The latent compatibility manifest records:

- historical `0.84.1` baseline;
- current runtime/candidate release `0.84.4` at `b79e4cc834970cca69daebffab7df1da7d1e52c4`;
- `rejected_evidence_only` Harness classification;
- 30-case Memory and JSONL conformance;
- unsupported-is-not-pass semantics;
- no Harness activation.

### Earlier local `dev` probes

At `0e77e57d96e99b49f710c652d3f5985ac0c66f8f`, bounded local Bun probes produced:

| Probe | Result |
|---|---|
| Agent TypeScript build | Pass |
| Runtime/provider/deferred/tool/event/hook focus | 138 pass, 0 fail |
| Session/Memory/JSONL focus | 125 pass, 0 fail |
| Full agent Harness suite | 439 pass, 1 skip, 1 Bun return-value failure |
| SQLite suite | 86 pass, 1 Bun return-value failure |

Both failures were Bun/Node `fs.promises.access()` return-value assertions, not durable-state failures.

### Current `dev` CI

Exact-head CI at `d14d6b22327d545d6a253f932165b63e48d7f9c8` passed. Reported package counts are listed in the pinned-evidence section. These are upstream Node CI results, not Piclaw installed-service proof.

## Mapping to Piclaw's prepared boundaries

All latent work packages #970–#980 are merged and remain useful.

| Piclaw boundary | Effect of current `dev` |
|---|---|
| EF-S01 service work | Piclaw ownership unchanged; caller-supplied Earendil operation IDs may simplify correlation |
| EF-S02 terminal settlement | Piclaw ownership unchanged; immutable `OperationResultRecord` supplies typed execution evidence |
| EF-S03–EF-S07 | No ownership transfer |
| EF-S08 projection | Strong alignment with typed lane events, snapshot reducer and resnapshot; session watch remains deferred |
| EF-H01 context resolver | Must adopt trailing `Context` and selected direct `ExecutionEnv` signatures |
| EB-01 models/credentials | Direct `Models` and `CredentialStore` adoption remains valid; deferred streaming is implemented |
| EB-02 tools/context | Strong source-level contract; update to stable invocation identity, memos/checkpoints, bounded output and trailing `Context` |
| EB-03 resources/hooks | Typed resources/hooks/events and runtime registries exist |
| EB-04 telemetry | `Context.telemetryContext` is direct parentage; preserve Piclaw cache-reporting/provider-cost fields |
| EB-05 harness/session/storage/events | Public lane drive and SQLite host-ownership work exist; source selection, session watch scope, WP08 stability and Piclaw validation remain |

## Contract-suite corrections

Retain HC-001–HC-025 with these current interpretations:

- HC-006–HC-008 cover one lane-owned tagged inbox and public queue methods;
- HC-009 covers exact-ID abort, drain-and-return and terminal-control invariants;
- HC-010 covers structural compaction/navigation and one intent/usage row per nested request;
- HC-012 covers deferred suspension and process-loss recovery; missing identities fail in band;
- HC-013 restores current values/lists and exact referenced content without a fixed read count;
- HC-015 covers explicit Session/Branch/AgentLane isolation and no implicit main lane;
- HC-017 covers deterministic direct drive under gated storage/effects, not manual actions;
- HC-021 names `Gate.admit()` and proves abort-first versus admission-first;
- HC-023 tests one lane-owned Drive and same-operation observers, not in-process Drive replacement;
- HC-024 covers selected storage migration only;
- HC-025 covers selected backend parity, host ownership and exclusive offline administration;
- current-loop `ui_prompt_start`/`ui_prompt_end` tests remain outside Harness events; Harness waiting uses selected lane events/state;
- terminal bookkeeping does not depend on `prepareNextTurn`;
- usage/telemetry cases preserve cache reporting and provider cost;
- encrypted reasoning remains selected Earendil content rather than rewritten signatures.

## Adoption gates

Harness v3 is not selectable for production until:

1. one coherent release candidate or approved exact source contains compatible agent, AI, coding-agent, telemetry and selected backend packages;
2. every Piclaw-required public lane method is implemented; `watchSession` is implemented or explicitly excluded from approved Piclaw scope;
3. Memory and JSONL conformance pass unchanged; any selected SQLite boundary passes host-ownership and live-fork tests under its approved runtime;
4. HC-001–HC-025 pass against the exact real public constructor and direct Context-last APIs;
5. every provider/tool/structural intent-admission-settlement crash boundary passes after process replacement;
6. selected storage migration of open operations is total and crash-resumable;
7. Piclaw's PC/golden suites pass with exact operation correlation, terminal settlement, waiting projection and telemetry preservation;
8. installed scheduler, mobile Abort, SSE reconnect, backup and rollback gates pass;
9. a separate decision authorises activation of the already latent Piclaw service-effect packages.

## Assessment decision

Keep Harness activation disabled and the current Piclaw session backend authoritative. Released `0.84.4` adds no Harness readiness despite being the current runtime family.

Earendil `dev` is now suitable for a **latent positive compatibility refresh and HC dry run**, because public lane drive exists and exact-head CI is green. That work must use a separately approved source pin, no production importer and no activation path. Production selection waits for WP08/storage contract stability, explicit `watchSession` scope, host-ownership proof and successful Piclaw HC/PC suites.
