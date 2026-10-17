> Superseded on 17 October 2026 by [#1650 acceptance at 7315c221e](pi-durable-130-acceptance-current-20261017.md), which contains the single current 45-row assessment. The body below preserves the historical `87efd0342` assessment and subsequent dated follow-ups. Its missing-registration/default-selection/controller statements do not describe current source.

# Historical #1650 acceptance gaps at 87efd0342

Pi durable 1.3.0 has bounded candidate-fixture evidence; the 25 HC and 20 PC requirements are **not all accepted**. The published source head is `87efd03424a715ad2ce122f6242f22ec137ea3f7`. Production ownership, bootstrap/recovery, compatibility and in-place cutover remain incomplete. Existing chats must continue under their original host chat/branch identities; a new-chats-only rollout does not meet the requirement.

This map retains the exact IDs and intents from [earendil-100-durable-crosswalk.md](earendil-100-durable-crosswalk.md), unchanged. [06-acceptance-plan.md](../06-acceptance-plan.md) supplies the wider acceptance obligations; its historical Lane/Drive/Gate API statements are not 1.3.0 APIs. The [qualification README](../../../../qualification/pi-durable-130/README.md) records incremental receipts and limits; its early counts and proposed-next sections are historical.

## Evidence scope and status vocabulary

Each row gives the strongest bounded evidence and the outstanding gap. Status applies to the scope stated in that row, not acceptance of every original assertion or production readiness.

| Status | Meaning |
| --- | --- |
| candidate-fixture-qualified | The named candidate-graph fixture exercises the stated subset. Wider cases and production wiring still need qualification. |
| host-binding-unqualified | Source seams or component tests exist, but the required host lifecycle/composition is not qualified end to end. |
| blocked-publicAPI | The required exact operation cannot be implemented safely through the selected public API. |
| production-unverified | No production proof; the row also states where candidate semantic evidence is absent. |

Paths below are repository-relative: `Q/` = `qualification/pi-durable-130/`; `E/` = `runtime/durable-engine/src/`; `A/` = `runtime/src/agent-pool/`; `RT/` = `runtime/test/`; `SE/` = `RT/service-effects/`. Receipt filenames are under `/workspace/reviews/durable-1650/` and are local, external to the repository.

Existing receipts, inspected without rerunning completed tests:

- `accepted-steer-crash-full.log`: **353 pass, 0 fail, 5,630 assertions, 21 files**. `accepted-steer-crash-types.log` records qualification types; `accepted-steer-engine-types.log` records engine types.
- `root-accepted-steer-final.log`: **7,142 pass, 74 baseline skips, 0 fail**, plus **25 feature and 9 build tests**, `EXIT_CODE=0`. This root regression gate is not 45 durable acceptance passes.
- `accepted-steer-checkpoint.md`, `accepted-steer-recovery-checkpoint.md`, `accepted-steer-crash-checkpoint.md`: bounded independent source-review clearance. Clean-close/reopen and two genuine child SIGKILL windows are complete fixture work. `accepted-steer-crash-repeat-{1,2,3}.log`: recovery/ownership **10 pass / 197 assertions** each. An earlier unchanged contender case admitted zero contenders once; its cause is unknown.
- The two new kill windows are **attachment committed before intent submit** and **submission committed before acknowledgement**. They preserve accepted identity and any committed submission ID, open paused under replacement ownership after confirmed death, and settle one host answer/terminal. They do not prove arbitrary mid-commit recovery, paid-provider exactly-once execution, power-loss durability or an installed recovery controller.

## HC-001–HC-025

| Exact ID | Original requirement | Existing artifact/test | Status and remaining limit |
| --- | --- | --- | --- |
| HC-001 | Simple prompt | `Q/test.ts` submit/dedup/answer; `Q/runtime.test.ts` accepted input and EF-S02 once; `RT/channels/web/input-source-admission.test.ts` actual HTTP→worker→engine | candidate-fixture-qualified — acceptance precedes synthetic execution and one terminal; production controller absent. |
| HC-002 | Tool prompt | `Q/tools.test.ts` public Harness preparation/validation; `Q/vertical.test.ts`; `Q/bash-port.test.ts` actual local spawn | candidate-fixture-qualified — selected tools/results and settlement; arbitrary filesystem/SSH/MCP effects and installed-tool parity absent. |
| HC-003 | Parallel tools | Original crosswalk specifies completion-order raw commits versus call-order context; `Q/tools.test.ts` covers preparation/results only | production-unverified — no dedicated candidate parallel completion/context/projection-order oracle. Old source-order raw-commit assertion has no equivalent. |
| HC-004 | Safe replay | `Q/tools.test.ts` explicit safe decision versus read-only annotation; `E/host-tools.ts` | production-unverified — no admitted safe-tool crash/redeclaration/replay-authorisation matrix; annotation tests do not establish replay. |
| HC-005 | Never replay | `Q/sqlite.test.ts` executing unsafe tool close/reopen; `Q/bash-port.test.ts` unsafe actual bash reopen | candidate-fixture-qualified — unsafe selected calls do not rerun; arbitrary external mutation containment/uncertain outcomes need per-effect policy. |
| HC-006 | Steer | `Q/runtime.test.ts` runtime intents; `Q/accepted-steer-recovery.test.ts`; `SE/service-work-queued-steer.test.ts`; `RT/channels/web/input-source-admission.test.ts` | candidate-fixture-qualified — same host operation, immutable source and all-input settlement; exact physical-generation steering and installed recovery not proved. |
| HC-007 | Follow-up | `RT/channels/web/input-source-admission.test.ts` accepted queued materialisation/worker; `RT/channels/web/runtime/queued-followup-lifecycle-service.test.ts` | host-binding-unqualified — existing queue/UUID/FIFO and atomic withdrawal have tests; no installed restart controller or complete successor-authorisation proof. |
| HC-008 | Next run | `A/durable-queue-dispatch.ts`; `SE/service-work-store-contracts.test.ts`; original crosswalk's host-withholding proposal | host-binding-unqualified — no public `nextRun`; host queue must withhold successor until EF-S02. Ordinary queue evidence does not complete that barrier across all routes/restarts. |
| HC-009 | Abort | `Q/runtime.test.ts` public transaction/exact-run negative proof; `E/host-runtime.ts` `cancelInput` | blocked-publicAPI — public transactions cannot conditionally mark exact running-task abort; placed input returns `already_placed`. Host cancellation suppresses late publication, but does not stop that running task. |
| HC-010 | Compaction | `Q/migration.test.ts` copied compaction checkpoints and exact context; `E/legacy-import.ts` | production-unverified — importing summaries is qualified narrowly; manual/threshold/background/overflow execution, stale summaries, budget and cancellation are not a candidate compaction matrix. |
| HC-011 | Retry | `Q/src/fixture.ts` disables retry; `Q/models.test.ts` rejects retry widening | production-unverified — no candidate captured-options/live-policy/restart-deadline/budget matrix. Historical captured-policy guarantee changed. |
| HC-012 | Suspension | `Q/runtime.test.ts` detached wait and passive reopen; `E/host-runtime.ts` `wait`/`reconcile` | production-unverified — cancelling observation is tested; missing definitions, task migrations, suspension/deferred task recovery and background scopes are not fully qualified. |
| HC-013 | Restore | `Q/sqlite.test.ts` committed answer reopen; `Q/cross-store.test.ts`; `Q/accepted-steer-recovery.test.ts` | candidate-fixture-qualified — selected disk recovery/identity cases; no bounded production-history read-cost measurement or arbitrary recovery graph proof. |
| HC-014 | Corruption | `Q/migration.test.ts` malformed source/tree rejection; `Q/sqlite.test.ts` facade rollback/failure tests | production-unverified — these test import/facade faults, not the full durable malformed-reference/version/torn-tail/corruption matrix. |
| HC-015 | Session/Branch/lane isolation | `Q/migration.test.ts` public forks, distinct contexts and typed bindings; `Q/plan.test.ts` cross-chat denial/fork KV | candidate-fixture-qualified — copied tree/store-local identity cases; no installed multi-chat authority-domain qualification. Lazy root is not a global chat identity. |
| HC-016 | Close | `Q/runtime.test.ts` abort observations before cleanup, failed cleanup retains owner; `Q/sqlite.test.ts` active unsafe close/reopen | candidate-fixture-qualified — cooperative selected paths and fresh handles; non-cooperative code may prevent close indefinitely and callbacks need host disposal. |
| HC-017 | Deterministic drive | `Q/src/fixture.ts` controlled provider/tool barriers; `Q/accepted-steer-recovery.test.ts` fixed windows | candidate-fixture-qualified — reproducible bounded schedules only; no manual Drive API, exhaustive scheduler oracle or arbitrary crash-placement proof. |
| HC-018 | Hooks/events | `Q/projection.test.ts` real watch, >100 batches/resnapshot, stale generation and forged assistant write; `Q/plan.test.ts` hidden lifecycle | candidate-fixture-qualified — selected hooks/observation only; not complete hooks/reload, rich browser transport, terminal authority or delivery acknowledgement. |
| HC-019 | Usage | `Q/src/fixture.ts` synthetic zero usage; `Q/models.test.ts` model cost/result projection | production-unverified — no candidate aggregate retry/error/abort/compaction accounting or full budget reconciliation; immutable legacy UsageRow has changed. |
| HC-020 | Deferred provider | `Q/models.test.ts` host-issued references, fetch/cancel and recreated bridge; `E/host-models.ts` | host-binding-unqualified — bridge calls qualified with synthetic providers; persistent host-handle authority, task polling/deadline/lineage/crash semantics absent. One poll per resume is not a public guarantee. |
| HC-021 | Effect admission | `Q/models.test.ts` accepted `transformHeaders` negative control; `Q/tools.test.ts` actual-effect checks; `Q/bash-port.test.ts` tracked `validateSpawn` | host-binding-unqualified — selected host gates only; no public Gate or general zero-effect guarantee. Operator accepted the narrow provider microtask race; do not wait upstream or patch dependencies for that race. |
| HC-022 | Effect-start crash | `Q/cross-store.test.ts` post-boundary kills; `Q/accepted-steer-recovery.test.ts`; unsafe bash reopen cases | candidate-fixture-qualified — fixed windows and selected unsafe recovery only; external effect outcome uncertainty and arbitrary surviving child tools require reconciliation. |
| HC-023 | Drive/host ownership | `Q/ownership.test.ts`; `Q/src/ownership.ts`; `Q/cross-store.test.ts`; `E/host-runtime.ts` owner-before-storage | host-binding-unqualified — Linux test owner and real process-death fixtures exist; application owner acquisition/registration is not installed. SQLite locks alone do not own Harness effects. |
| HC-024 | Storage migration | `E/legacy-import.ts`, `E/host-cutover.ts`; `Q/migration.test.ts`, `Q/cutover-runtime.test.ts`, `Q/rehearsal.test.ts` | host-binding-unqualified — bounded copied linear/tree import and offline cutover work; live in-place identity preservation, general add-on state, task/doc/schema migrations and post-new-work reverse conversion are incomplete. Missing host baseline fails closed. |
| HC-025 | Backend/fork parity | `Q/sqlite.test.ts` public SQLite conformance; `Q/test.ts` Memory; `Q/migration.test.ts` public fork contexts | production-unverified — no full JSONL/Memory/SQLite parity, streaming-fork equivalent or production writable-owner/performance receipt. Historical requirements remain partial. |

## PC-001–PC-020

| Exact ID | Original requirement | Existing artifact/test | Status and remaining limit |
| --- | --- | --- | --- |
| PC-001 | Ordinary accepted message | `RT/channels/web/input-source-admission.test.ts`; `Q/host-handoff.test.ts`; `Q/bindings.test.ts`; `A/durable-queue-dispatch.ts` | candidate-fixture-qualified — real HTTP/SQL acceptance, host hashes, dispatch and lost-ACK repair with explicit fixture ports; default application wiring absent. |
| PC-002 | Exact steer | `A/durable-queued-steering.ts`; `SE/service-work-queued-steer.test.ts`; HTTP accepted-steer tests; `Q/runtime.test.ts` | candidate-fixture-qualified — exact active host operation/source/version, transactional attach/materialise/consume; not exact physical generation or arbitrary cross-session steering. |
| PC-003 | Stale steer | Same HTTP/EF tests: finished target, version/harness mismatch, rollback; `Q/runtime.test.ts` initial-version settlement fence | candidate-fixture-qualified — stale attachment/progress rejected in bounded cases; production coordinator absent. |
| PC-004 | Exact cancellation | `Q/runtime.test.ts` exact-run transaction proof and queued-successor survival; `E/host-runtime.ts` `cancelInput` | blocked-publicAPI — no atomic public conditional running abort; no read-then-abort, raw task mutation or conversation-wide fallback. |
| PC-005 | Stale cancellation | `Q/runtime.test.ts` wrong submission rejects before acceptance; public exact-run negative control | candidate-fixture-qualified — wrong submission and repeated cancellation leave successor intact; full running cancellation remains PC-004's API gap. |
| PC-006 | Late completion after cancellation | `Q/host-handoff.test.ts`; `Q/cutover-runtime.test.ts`; `Q/runtime.test.ts` materialisation races | candidate-fixture-qualified — host cancellation beats late answer with no success publication; this is not proof of provider/task interruption. |
| PC-007 | Terminal commit fault matrix | `SE/terminal-settlement-atomicity-races.test.ts`, `terminal-settlement-payload-redaction.test.ts`; `Q/host-handoff.test.ts` actual resolver takeover | candidate-fixture-qualified — real EF-S02 faults/guard plus selected candidate settlement. Production ownership registration and arbitrary cross-file fault placement unqualified. |
| PC-008 | Restart with open run | `Q/cross-store.test.ts`; `Q/runtime.test.ts` passive reopen; `Q/accepted-steer-recovery.test.ts` | host-binding-unqualified — real fixed process-death cases pass; host startup still needs persisted identity discovery, whole-domain authorisation and event/callback composition. No exactly-once external-effect claim. |
| PC-009 | Pending steer restart | `Q/accepted-steer-recovery.test.ts`; `Q/src/accepted-steer-recovery-fixture.ts`; crash checkpoint/receipts above | candidate-fixture-qualified — both clean-close and both SIGKILL variants complete; fixture-only `recovery_fixture_identity` captures the intent. General installed restart discovery/FIFO not proved. |
| PC-010 | Protected hand-off | `SE/service-work-store-contracts.test.ts`; `RT/channels/web/messaging/starting-turn-steering.test.ts`; original crosswalk | host-binding-unqualified — host/legacy control evidence exists; no candidate protected reset/handoff→one successor end-to-end fixture. |
| PC-011 | Mutation containment | `Q/tools.test.ts` uncooperative-callback negative control; `Q/bash-port.test.ts` unsafe reopen; `E/host-tools.ts` | host-binding-unqualified — selected local effect fencing works; unsafe interrupted effects, reload and all real tool ports need containment/reconciliation policy. |
| PC-012 | Scheduler agent task | `E/host-scheduled-run.ts`; `Q/scheduled.test.ts` real EF-S07 occurrence, revision/pause/renewal probes | candidate-fixture-qualified — explicit agent handoff and existing settlement owner; no registered production scheduler, main-chat save/restore or complete stale delivery proof. |
| PC-013 | Scheduler shell task | `Q/scheduled.test.ts` rejects shell/non-agent dispatch; root scheduler path retained; qualification README scheduler limits | production-unverified — no shell migration intended; legacy regression coverage does not prove candidate-mode Pushover/delivery equivalence. |
| PC-014 | Stale SSE generation | `E/host-projection.ts`; `Q/projection.test.ts` actual EF-S08 owner/generation/receipt filtering | candidate-fixture-qualified — stale observations dropped, bounded snapshots; browser SSE/reconnect integration still unqualified. |
| PC-015 | Mobile Abort | `Q/runtime.test.ts` backend cancellation limits; existing root control-plane tests | blocked-publicAPI — no candidate mobile→exact running abort proof; same missing conditional running-abort API as PC-004. Existing mobile legacy tests cannot fill it. |
| PC-016 | Protected evidence | `Q/projection.test.ts`, `Q/tools.test.ts`, `Q/models.test.ts`, `Q/runtime.test.ts` private reasoning/materialisation | candidate-fixture-qualified — selected sanitisation, bounded DTOs/static failures and media bindings; no exhaustive persisted-log/export/telemetry secret audit or production materialiser. |
| PC-017 | Maintenance failure | `Q/runtime.test.ts` failed cleanup retains owner, terminal replay; `SE/terminal-settlement-atomicity-races.test.ts` | host-binding-unqualified — component close/terminal evidence exists; candidate compaction/watch/cleanup failure after terminal and no repeated delivery need composed qualification. |
| PC-018 | Trusted internal input | `Q/scheduled.test.ts`; `A/durable-runtime-adapter.ts` claimed-source checks; `Q/runtime.test.ts` hash/provenance rejection | host-binding-unqualified — selected scheduler/claimed ports enforce EF identity; not every internal ingress path is bound to acceptance, budget and owner policy. |
| PC-019 | Cross-session steer | `A/durable-queued-steering.ts` explicitly chat-bound; `SE/service-work-queued-steer.test.ts` exact target checks | host-binding-unqualified — local accepted queue-steer is implemented; no candidate cross-session acknowledgement/retry/offline acceptance proof. |
| PC-020 | Goal/checkpoint race | `Q/runtime.test.ts` all claimed intents done before settlement, latest-answer/initial-version race; accepted-steer recovery fixtures | candidate-fixture-qualified — selected attach/checkpoint/settlement races; general goal/cross-session producer integration and all carry/disposal races unqualified. |

## Candidate graph, legacy tests and running providers

`runtime/durable-engine/package.json` and its lock own the isolated 1.3.0 graph. Qualification imports engine public re-exports; `Q/test.ts` checks physical graph/type identity. Root still uses Pi 1.2.0. The private source package is excluded from the current root distribution and has no production engine registration.

Actual Plan, Delegate, Code Review and Remote Peer factories run through selected candidate tools in `Q/plan.test.ts`, `delegate.test.ts` and `addon-host-services.test.ts`. `Q/vertical.test.ts` composes copied history, host models, Plan, guarded bash and real EF settlement. These are candidate integration evidence. Root Pi 1.2.0 tool/SDK/MCP/add-on tests alone are legacy regression evidence; they do not qualify all installed tools/add-ons on the candidate graph. Remote networking, general extension reload/state, SSH/read/write/MCP effects and real Delegate authentication are not qualified by the selected factory fixtures.

Providers are synthetic/keyless here. Public host `transformHeaders` awaits before provider invocation: revocation in that microtask interval can invoke the provider with an aborted signal. The operator accepted this limitation; it is neither a proven send/charge nor a reason to wait upstream. Exact running-task cancellation is a separate **blocked-publicAPI** requirement and has not been waived.

## Single next source slice: default-off host recovery composition

Implement one application-owned, explicitly constructed **host recovery/controller factory** for an already imported authority domain. Do not activate it. It should compose existing runtime, SQL bindings and worker ports, replacing the recovery fixture's manual composition; do not add another queue, polling timer or general orchestration framework.

The missing code is concrete:

1. Capture the supplied manifest, immutable scope and bound callbacks before any await, following `E/host-runtime.ts` and `A/durable-runtime-adapter.ts`. Require identical chat/branch/conversation/store-incarnation mappings across bindings, runtime and worker. Acquire exclusive host ownership before storage construction; open paused. Accept a supplied owner backend; do not promote `Q/src/ownership.ts` into an assumed production owner service.
2. Recover committed primary and attached-source identities from existing EF-S01/message/binding records, including attached-but-not-yet-bound intents. Fail closed on unknown/mismatched content or authority. Remove dependence on fixture-only `recovery_fixture_identity`; do not reconstruct acceptance from requestId alone or restore consumed queue rows.
3. Reconcile passively, then require explicit authorisation of **all** recovered work before progress. Reuse `submitIntent` evidence/ACK repair and all-input EF-S02 settlement. Wire captured `onPendingIntent`, race-free `waitForReconciliation`, running correlation and shutdown ports into the existing per-chat worker callback. A terminal event requests fenced SQL reads; only matching terminal/source/frontier evidence releases the original callback. Close/drain before owner release; uncertain cleanup keeps ownership/pending identity.

Add only new composition tests: matching-manifest bootstrap and owner-before-open, mismatches/unknown recovered authority with zero dispatch, attached-but-unbound discovery, callback replacement during await, lost wake-up and shutdown/late event behaviour. Reuse the completed before-submit/ACK-lost recovery fixtures as existing evidence; do not rerun their matrix merely to restate it. The controller is useful source implementation, but does not make a production owner, live cutover or all PC rows accepted.

Keep every selector/registration absent by default. No production dependency/pin, schema installation, services, live accounts/history, network, deployment or activation changes belong to this slice. Existing chats retain their host identities; broader offline migration compatibility, performance/resource budgets, production packaging, real ownership policy and post-new-work rollback/reverse conversion require separate bounded work. The missing public conditional-abort API stays explicit; no unsafe cancellation substitute is part of the controller.

### Controller implementation follow-up

The explicit, unregistered owner-first factory now exists in
`runtime/durable-engine/src/host-controller.ts`. Actual-engine tests in
`qualification/pi-durable-130/host-controller.test.ts` cover paused discovery,
whole-domain rejection, unbound retry, owner-before-open and failure cleanup.
Candidate verification: 361 tests / 5,792 assertions; engine/qualification types
and root fast CI pass. Independent review cleared this bounded composition.
This advances the factory portion of the next slice above, not production status
of any row. Existing-worker wake-up/retry wiring and production adapter selection
remain absent; migration, cutover and rollback acceptance are still open.

### Copied-input preflight follow-up (after bce403058)

Inspection of the current README, rehearsal, importer and cutover implementation
found that persisted checkpoint/retry already exists. The missing HC-024 source
precondition was an executable binding from actual copied history + host-manifest
bytes to that checkpoint, rather than hand-assembled request hashes/callbacks.
`E/copied-upgrade.ts` now creates that immutable, exact-SHA-validated plan and
connects it to the existing journal and public import/context verification APIs.
It does not install an automatic migrator or duplicate the checkpoint framework.

`Q/copied-upgrade.test.ts` qualifies copied disk input, lost import acknowledgement,
public storage and journal-connection reopen, identical IDs/contexts on retry,
changed-manifest checkpoint refusal and rollback preservation. Related tests pass
15 / 294 assertions; both private package types pass. HC-024 remains
**host-binding-unqualified**: live owner/fence policy, production selection,
general compatibility and post-new-work reconciliation are still incomplete.
HC-009/PC-004/PC-015 remain **blocked-publicAPI**; no cancellation workaround.

### Copied-upgrade P2 verification correction (uncommitted follow-up)

`E/copied-upgrade.ts` now checks distinct branch conversation IDs, root/conversation
receipt agreement, complete ordered source mappings, and actual public visible
entry history against the privately prepared import plan. Audit JSON, model
records, compaction heads, metadata-only mappings and inherited ancestor IDs are
checked without private SQL. Identical leaf contexts cannot hide aliased branches
or forged mappings, even when both receipt documents agree.

Four public-document corruption tests reject missing root mappings, missing branch
mappings, aliased conversations and matching forged root/conversation mappings.
Each preserves the cutover journal, keeps rollback available and creates no extra
conversation. The positive disk-reopen/lost-ACK case includes image, display-only
metadata and compaction, retaining shared ancestor IDs and exactly two branches.

Latest focused run: **68 pass, 0 fail, 774 assertions / 3 files**
(`copied-upgrade.test.ts`, `migration.test.ts`, `host-controller.test.ts`);
**6 copied-upgrade tests** pass. Engine and qualification typechecks pass;
`git diff --check` passes. These are focused counts, not a full-suite receipt.
Source/manifest byte handling, legacy 1.2 projection and importer writes are
unchanged. No services, live state, network, pins, commit or push were touched;
parent retains integration/commit ownership. HC-024 remains unqualified for
production as stated above.
