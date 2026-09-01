# Alternatives, migration and rollback

Status: proposed decision and implementation sequence.

## Decision drivers

The design must:

- reuse no Piclaw agent orchestration code;
- preserve Piclaw's service acceptance, operation ownership, timeline, scheduler and delivery responsibilities;
- adopt the selected Harness v3 public types, runtime, session backend and effects model directly, removing Piclaw compatibility glue instead of recreating them;
- support deterministic direct drive, replay and fault injection;
- prevent the 26 catalogued regressions;
- allow rollback without rewriting or deleting stable Piclaw data;
- avoid a flag day while the installed Earendil harness remains incomplete.

## Alternatives

### A — Keep Piclaw's loop and wrap it as a harness

Piclaw would retain `AgentPool`, `runAgentPrompt`, recovery, compaction and `processChat`, exposing a harness-like facade.

| Criterion | Assessment |
|---|---|
| Earendil alignment | Low; Earendil would be forced to resemble Piclaw callbacks and cursor state |
| Existing behaviour | High initially |
| Replay | Low; mutable callbacks/timers remain authoritative |
| Defect prevention | Low; exact-owner and split-settlement defects remain structural |
| Migration cost | Low initially, high later |
| Constraint compliance | Fails: reuses all existing orchestration |

**Decision:** reject.

### B — Refactor Piclaw's loop into a local reducer, then adapt Earendil

The earlier state-machine assessment proposed a Piclaw-owned reducer and effect executors around the current loop.

| Criterion | Assessment |
|---|---|
| Earendil alignment | Medium-low; duplicates Earendil's execution state machine (v2 reducer or v3 total-state interpreter) |
| Existing behaviour | Medium-high |
| Replay | High if completed |
| Defect prevention | Medium-high |
| Migration cost | High; two state machines must later converge |
| Constraint compliance | Fails: starts from current orchestration and duplicates future execution ownership |

**Decision:** reject as target. Retain the earlier assessment as a behaviour/hazard inventory.

### C — Build a Piclaw-specific replacement reducer over effectors

A new clean-room reducer would own both service and execution state and call provider/tool effectors directly.

| Criterion | Assessment |
|---|---|
| Earendil alignment | Medium; can copy terminology but still competes with Earendil |
| Existing behaviour | Requires full reimplementation |
| Replay | High |
| Defect prevention | High with sufficient testing |
| Migration cost | High |
| Constraint compliance | Meets no-old-code rule, misses maximal Earendil alignment |

**Decision:** reject. Piclaw should not become a second agent harness.

### D — Adopt the installed Earendil `AgentHarness` directly

Piclaw would replace its loop with `AgentHarness` now.

| Criterion | Assessment |
|---|---|
| Earendil alignment | Highest |
| Existing behaviour | Cannot execute |
| Replay | Declared manual surface is promising |
| Defect prevention | Target v3 total-state validation/effect boundaries cover execution corruption |
| Migration cost | Blocked |
| Constraint compliance | Meets architectural constraint |

The installed `0.84.1` JavaScript throws `HarnessNotImplemented` for prompt, queue, abort, compact, lane, watcher, manual drive and restore.

**Decision:** infeasible at the pinned baseline.

### E — Selected-version Earendil fixture now, real harness under the same semantic suite later

Piclaw builds only its service-plane operation model and service effectors. Tests implement the selected Harness v3 public types over instrumented Memory storage and deterministic effects until a coherent real runtime is available. A real exported `AgentHarnessConstructor` replaces the fixture constructor when execution becomes available; semantic cases continue to call Earendil types and methods directly.

| Criterion | Assessment |
|---|---|
| Earendil alignment | High; Harness v3 public types, values/lists, operation results, direct drive and effects are adopted early |
| Existing behaviour | Captured by capability/regression traceability and contracts |
| Replay | High; fixture uses deterministic gated storage/effects around direct drive |
| Defect prevention | High; service and execution owners are explicit |
| Migration cost | Staged and reversible |
| Constraint compliance | Meets no-old-orchestration and fixture requirements |

**Decision:** select.

## Selected architecture

Piclaw implements a new service-plane operation coordinator over reviewed service effectors. It imports no current agent-pool, process-chat, recovery or compaction orchestration. For execution it stores and calls the exported `AgentHarness`/`AgentLane` objects directly; it does not insert a Piclaw-shaped execution interface.

Harness v3 `dev`/draft PR #8963 now has a concrete public constructor and complete public lane drive; only `watchSession()` remains stubbed. It remains an unselected development branch with active WP08 fork/storage work. Production stays on the stable loop with published `0.84.4`; latent positive tests may target an approved exact source, while Harness cutover waits for source/package selection and the shared suite.

The selected architecture has three independently replaceable components:

1. Piclaw operation store/coordinator and delivery outbox;
2. Earendil `AgentHarness`/`AgentLane` plus direct session/model/tool/environment resources;
3. Piclaw service-plane delivery and projection effectors.

## Migration sequence

Each phase is one or more focused PRs after ADR approval. No phase combines dependency upgrade, database cutover and execution cutover.

### M0 — Approve contracts and pin the selected Earendil source

Deliver:

- approved ADR;
- selected Earendil package/source commit;
- version-migration report template;
- explicit capability requirements for the selected Earendil version;
- a Piclaw migration plan for any selected-version type or semantic changes.

Gate:

- Rui approves the responsibility boundary and alternatives decision;
- no unresolved assumption can affect data ownership or cancellation safety.

Rollback: documentation only.

### M1 — Add Harness v3 fixture and semantic runner in tests

Deliver:

- test implementation of pinned Harness v3 public contracts over instrumented Memory storage;
- deterministic model/tools/fault plan and selected transaction traces;
- 25 harness and 20 Piclaw boundary contract cases;
- all 26 golden regression fixtures;
- no production imports.

Gate:

- fixture compiles against pinned public declarations;
- selected Harness v3 Memory/backend conformance suite passes unchanged, with open-operation migration and concurrent rewrite cases; fixture tests remain clearly non-production before then;
- dependency-boundary check proves no Piclaw orchestration import.

Rollback: remove test-only files.

### M2 — Add Piclaw operation schema and shadow coordinator

Deliver:

- accepted-source, operation, immutable disposition, correlation and outbox tables;
- pure service reference reducer and SQLite adapter;
- source acceptance shadow writes alongside existing paths;
- reconciliation/read-only status tooling;
- no execution or delivery authority.

Rules:

- current runtime remains authoritative;
- shadow data cannot block, retry, abort, deliver or advance cursor;
- every shadow failure logs bounded metadata and disables shadow for that chat rather than affecting users.

Gate:

- migration/backup/restore tests;
- fault matrix for acceptance and settlement tables;
- existing messages/cursors remain unchanged;
- shadow source order matches current observable order for a defined canary window.

Rollback: disable feature flag; leave additive tables for inspection or drop only in a later approved migration.

### M3 — Extract Piclaw effectors without changing execution

Deliver:

- operation-aware timeline port;
- delivery outbox port;
- scheduler task claim/log/delivery ports;
- projection port;
- direct Earendil `HarnessTool` definitions with replay/redaction metadata;
- direct selected `SessionRepo`/`Storage`, `ExecutionEnv` and `Resources` implementations.

Current orchestration may call the new Piclaw service-plane ports during migration. The new Earendil path uses direct Earendil contracts and does not preserve legacy execution interfaces.

Gate:

- behaviour parity tests;
- exactly-once delivery tests;
- no timeline/SSE payload leakage;
- shell and Pushover semantics unchanged;
- `git grep`/import-boundary rules keep new coordinator independent.

Rollback: switch wrappers back to existing implementations; schemas are additive.

### M4 — Integrate real Harness v3 in shadow execution

Prerequisite: the required Harness v3 runtime/storage slices are available and a real harness/backend passes the shared HC cases.

Deliver:

- real public `AgentHarnessConstructor` selection;
- direct `Resources`, `HarnessTool`, `Models` and `ExecutionEnv` construction;
- run correlation and redacted event projection in shadow;
- fixture-vs-real semantic migration report.

Shadow modes:

1. **dry action replay:** feed captured accepted inputs to deterministic/fake providers only;
2. **provider shadow:** optional non-side-effecting/read-only tools and bounded provider calls on test/canary chats;
3. **outcome parity:** compare classifiers, tool sequence, usage, compaction and terminal candidates without delivery.

Never execute general mutation tools twice. Shadow tool policy defaults to read-only and uses isolated workspace/storage fixtures.

Gate:

- all HC cases pass or approved unsupported list is empty for production-required capabilities;
- real harness restore/restart cases pass, including live-task loss and crash after effect admission;
- no private deep import is used; composition uses public lower-level agent-core contracts;
- resource and RSS impact is measured.

Rollback: disable shadow harness construction; stable loop unchanged.

### M5 — Canary service-plane authority with stable execution

Piclaw operation ledger becomes authoritative for acceptance/frontier/settlement while the old AgentSession loop remains as the temporary execution implementation. This phase validates service semantics independently before harness cutover.

Deliver:

- all ingress paths use accepted-source store;
- exact operation IDs projected to status/UI;
- terminal persistence and outbox transaction authoritative;
- cursor state becomes compatibility projection, not source of truth;
- exact cancellation is fenced at service layer before invoking old loop.

Gate:

- restart/fault boundary suite;
- no duplicate/lost source over canary observation;
- scheduler single-delivery proof;
- installed mobile Abort E2E;
- operator reconciliation tooling;
- reversible cursor projection is verified.

Rollback: switch reads/claims back to legacy cursor authority using the maintained projection. Do not delete operation records.

### M6 — Canary Earendil execution for selected chats

Deliver:

- per-chat execution backend flag (`legacy` or `earendil`);
- Earendil session/lane creation and correlation;
- exact steer/follow-up/abort routing;
- compaction/recovery through harness;
- no old orchestration imports in the Earendil path.

Start with disposable/test chats, then one non-critical persistent canary.

Gate:

- complete HC/PC/golden suite on exact commit;
- restart during prompt/tool/compaction/cancellation;
- unresolved `never` tool containment;
- session backend conformance, total migration, precise-rewrite concurrency and backup/restore;
- transcript/context parity sufficient for product acceptance;
- no continuous memory growth and agreed latency budget.

Rollback per chat:

- stop new claims;
- settle or suspend current Earendil operation;
- export/retain Earendil session state;
- set backend to legacy only at a terminal frontier;
- project the last committed Piclaw frontier into legacy cursor state;
- never replay an uncertain mutation.

### M7 — Default Earendil execution

Deliver:

- Earendil becomes default for new chats;
- existing chats migrate only at terminal frontier after dry-run/session checks;
- legacy path remains selectable for rollback during soak;
- production dashboards report backend, operation/run IDs, unresolved tools and delivery cardinality.

Gate:

- installed-service canary and restart evidence;
- defined soak with no invariant breach;
- backup and rollback drill;
- independent exact-head review;
- explicit deployment permission and no active sessions at restart.

Rollback: change default and per-chat backend flags; preserve Earendil permanent entries, values/lists, operation results and usage.

### M8 — Remove legacy orchestration

Prerequisite: every supported chat uses Earendil, rollback window has elapsed and Rui approves removal.

Deliver:

- delete AgentPool run orchestration, recovery loop, compaction patches and process-chat lifecycle policy;
- retain effectors and compatibility data readers needed for old sessions;
- remove cursor-as-authority migrations only after archive/restore policy is approved.

Gate:

- import-boundary test proves no production dependency on retired orchestration;
- all traceability rows point to current owner/test;
- release rollback uses previous complete release, not mixed old/new code.

Rollback: deploy previous release and preserve additive data; no destructive downgrade migration.

## Shadow parity metrics

Compare semantic, not textual, behaviour:

- accepted source order and target owner;
- run/tool/compaction action sequence;
- tool names and replay classes, with args hashed;
- terminal kind and error code;
- cancellation winner;
- usage totals within provider tolerance;
- delivery intent cardinality;
- context/compaction threshold decisions;
- recovery attempts and bounds;
- public status phase sequence.

Do not require identical prose, timestamps, generated IDs or provider sampling.

A parity divergence stores a bounded fixture candidate with payload hashes. It does not copy private content into issue comments or logs.

## Validation matrix

| Layer | Required validation |
|---|---|
| Pure service model | Table/property/model tests for all transitions and invariants |
| Harness v3 fixture | HC contract suite, instrumented storage transactions and golden replay |
| Real Harness v3 | Same HC semantic suite, backend conformance and version-migration diff |
| Piclaw boundary | PC suite with fake and real harness factories |
| SQLite | migration, integrity, transaction crash, busy lock, backup/restore |
| Tools | safe/never replay, abort/process-group, redaction, ambiguous effect |
| Scheduler | one run, timeline, log and notification; shell parity |
| Restart | crash at every durable command boundary |
| Web | exact status authority, SSE generations, timeline cardinality |
| Installed mobile | iPhone PWA silence-watchdog Abort path |
| Installed service | systemd lifecycle, PID/HTTP, database integrity, restart and rollback |
| Resources | cold RSS, per-session memory, startup/prompt latency, entry/value/list/usage growth and backend compaction behaviour |

## Installed-service acceptance

Before production default changes:

1. take and verify SQLite and Earendil session backups;
2. record exact Piclaw and Earendil commits/package versions;
3. verify no other active sessions before restart;
4. install and restart through the local user-systemd service only with explicit permission;
5. verify PID change, HTTP, status and model/tool resource loading;
6. run bounded simple, tool, steer, compaction, cancellation and scheduler tasks;
7. restart during an intentionally suspended test operation;
8. run installed iPhone Abort and SSE reconnect tests;
9. verify one terminal disposition, timeline response, run log and notification per test;
10. verify database integrity and counts;
11. execute the per-chat/default rollback drill;
12. observe RSS, latency, unresolved operations and outbox backlog for the agreed window.

## Data compatibility

- Piclaw operation tables are additive and remain readable across rollback.
- Existing timeline/media/task tables remain Piclaw-owned.
- Legacy cursor fields are maintained as a projection until M8.
- Earendil sessions use a coherent Harness v3 backend that passes its conformance suite; no harness schema is placed into `messages.db` unless separately approved.
- Existing JSONL source is preserved during migration/soak; current unfinished v2 format 4 is not selected as the target v3 backend.
- No downgrade deletes Earendil permanent entries, values/lists, operation results or usage, or rewrites uncertain tool results; durable state follows selected-version migration policy.

## Earendil version-selection gates

Before M4/M6, Piclaw must select an Earendil version whose direct public contracts support:

- implemented prompt/queue/abort/compact/resume and direct drive methods;
- restore from open durable operations;
- typed snapshot-first buffered lane watch behaviour sufficient for Piclaw projection, plus exact `getResult(operationId)` reconciliation;
- explicit tool replay semantics and unresolved-tool recovery;
- session backend operation under Bun or an approved runtime boundary;
- disposal/resource ownership;
- a public lower-level `AgentHarnessConstructor` implementation from the coherent package set.

Released-version constraints are recorded in [`earendil-0.84.1-constraints.md`](earendil-0.84.1-constraints.md); Harness v3 target semantics and implementation progress are in [`earendil-harness-v3-assessment.md`](earendil-harness-v3-assessment.md). Version adoption follows [`earendil-version-selection.md`](earendil-version-selection.md): Piclaw accepts local breakage and updates to the selected Earendil public types rather than requiring upstream compatibility.

## Selected decision

Select alternative E: build the Piclaw service-plane operation model and deterministic tests against direct Harness v3 contracts first; integrate a selected real v3 Harness/backend only after it satisfies the same semantic suite. Track `dev`/draft PR #8963 as exact development evidence without selecting or activating it in production. Accept Piclaw migration churn when selecting or upgrading Earendil. Keep production on the stable loop with published `0.84.4` until one coherent release candidate or approved source and the M5/M6 gates pass. Remove the legacy loop only in M8 after an approved soak and rollback window.
