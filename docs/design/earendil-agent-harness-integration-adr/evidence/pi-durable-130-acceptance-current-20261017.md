# #1650 acceptance: bounded native Delegate over 175032611 — 17 October 2026

The default application now selects the public durable engine in source; fleet/live acceptance and existing-chat migration are incomplete. The 45 requirements below retain their original IDs and titles. None is an unconditional fleet acceptance claim.

## Source and evidence boundary

- Worktree: `/workspace/tmp/durable-1650`; HEAD `175032611` contains native parallel feasibility after published scheduler `a89afe02f`. Native Delegate adoption is dirty source over that HEAD; the final serial candidate passes 480 tests and the inner root gate passes 7,312 tests plus 25 feature and 9 build tests. Earlier context, summary and Plan receipts retain their own source boundaries.
- The old stashed Delegate/Code Review implementation and its refusal checkpoints do not qualify this implementation. The current default factory now admits the bounded installed Delegate profile below; Code Review has no qualified native default path.
- `runtime/src/runtime.ts` acquires strict ownership. `runtime/src/runtime/bootstrap.ts` supplies `prepareApplicationBackend` by default and loads the fixed `runtime/durable-engine/src/default-application-runtime.ts` entry before AgentPool/WebChannel. Missing candidate dependencies fail explicitly; there is no production legacy fallback. Statements that production registration or default selection are absent are obsolete.
- The private engine still owns isolated Pi/Chord 1.3.0 pins and its lock. The root package still uses Pi 1.2.0 host definitions/model services. Source default adoption does not establish distributed-package installation or live activation. No fleet rollout, installed-package replacement, live provider acceptance or service restart is recorded here.
- The default supports Linux/single-user policy, fresh durable history and validated durable reopen. Legacy session files, old message history and unverified storage provenance fail preflight before model/SDK construction. Existing chats must retain their original chat/branch/session identities; fresh-chat success does not meet that migration obligation.
- Requirements: [original 25 HC / 20 PC crosswalk](earendil-100-durable-crosswalk.md) and [acceptance plan](../06-acceptance-plan.md). Historical Lane/Drive/Gate contracts are semantic obligations, not available 1.3.0 APIs.

Paths in the table are repository-relative: `E/` = `runtime/durable-engine/src/`; `A/` = `runtime/src/agent-pool/`; `Q/` = `qualification/pi-durable-130/`; `RT/` = `runtime/test/`; `SE/` = `RT/service-effects/`. Each filename is an exact path under that prefix. Local receipt/checkpoint filenames in later sections are under `/workspace/reviews/durable-1650/`.

| Status | Scope | Rows |
| --- | --- | ---: |
| source-qualified | Application source composes the named path; existing tests qualify only the stated subset. Wider assertions and live acceptance still need evidence. | 22 |
| fixture-only | Selected semantic/component fixtures exist; the full requirement has no qualified application path or matrix. An explicit missing case is not a pass. | 17 |
| blocked-publicAPI | The selected public API lacks exact conditional running-task cancellation. | 3 |
| migration/perf-unverified | Copied recovery/import/backend evidence does not qualify existing-chat cutover, general compatibility or resource bounds. | 3 |

## Current 45-requirement assessment

This is the single current HC/PC table. The [earlier acceptance report](pi-durable-130-current-acceptance.md) retains historical evidence only.

| ID | Original requirement | Status | Exact source / existing test evidence | What remains |
| --- | --- | --- | --- | --- |
| HC-001 | Simple prompt | source-qualified | `E/default-application-runtime.ts`, `E/application-bootstrap.ts`; `Q/default-application-runtime.test.ts`, `Q/application-web.test.ts` | Actual default synthetic HTTP acceptance→answer→EF-S02/reopen works; live authenticated providers and rollout are unverified. |
| HC-002 | Tool prompt | source-qualified | `E/host-builtins.ts`, `E/host-plan-tool.ts`; `Q/host-builtins.test.ts`, `Q/host-grep.test.ts`, `Q/default-application-runtime.test.ts` | Seven Linux host builtins, approved Plan and bounded native Delegate are admitted; see the Delegate section. General SSH/MCP/add-on tools, family policy and full installed parity are unqualified. |
| HC-003 | Parallel tools | fixture-only | `Q/tools.test.ts`; ordering obligation in `earendil-100-durable-crosswalk.md` | Preparation/results do not prove completion-order raw commits versus call-order context/projection. No dedicated candidate ordering oracle. |
| HC-004 | Safe replay | fixture-only | `E/host-tools.ts`; `Q/tools.test.ts` | Explicit safe-policy tests do not supply crash/redeclaration/idempotency/replay-authorisation matrix. Default host builtins remain unsafe. |
| HC-005 | Never replay | fixture-only | `Q/sqlite.test.ts`, `Q/bash-port.test.ts` | Selected executing unsafe calls do not rerun on reopen; arbitrary external mutation/unknown-outcome reconciliation needs per-effect policy. |
| HC-006 | Steer | source-qualified | `A/durable-queued-steering.ts`, `E/host-recovery.ts`; `Q/accepted-steer-recovery.test.ts`, `RT/channels/web/input-source-admission.test.ts` | Exact host operation/source and selected recovery work; exact physical-generation steering and arbitrary crash placement are unproved. |
| HC-007 | Follow-up | source-qualified | `A/durable-queue-dispatch.ts`, `E/application-bootstrap.ts`; `RT/channels/web/runtime/queued-followup-lifecycle-service.test.ts`, `Q/application-web.test.ts` | Existing queue/UUID/FIFO/worker wiring is present; complete successor authorisation/FIFO across every route and restart is unqualified. |
| HC-008 | Next run | source-qualified | `A/durable-queue-dispatch.ts`; `SE/service-work-store-contracts.test.ts`, `Q/worker-recovery.test.ts` | Host settlement/worker barrier replaces the absent public `nextRun`; all producer/restart barrier cases and full replacement-contract acceptance are unproved. |
| HC-009 | Abort | blocked-publicAPI | `E/host-runtime.ts` `cancelInput`; `Q/runtime.test.ts` | No atomic public conditional exact running abort; placed input returns `already_placed`. Host cancellation fences publication but does not stop that task. |
| HC-010 | Compaction | source-qualified | `E/host-runtime.ts` `compactSession`; `Q/compact.test.ts`, `Q/application-web.test.ts` | Idle-only manual maintenance owns/joins its actual task and waits accepted work; threshold/background/overflow/stale-summary/budget/cancellation matrix is incomplete. |
| HC-011 | Retry | fixture-only | `E/default-application-runtime.ts` disables retry; `Q/models.test.ts`, `Q/src/fixture.ts` | No full captured-options/live-policy/restart-deadline/budget matrix; historical captured retry-policy guarantee changed. |
| HC-012 | Suspension | fixture-only | `E/host-runtime.ts` `wait`/`reconcile`; `Q/runtime.test.ts`, `Q/models.test.ts` | Detached observation and selected deferred cases do not qualify all missing definitions, task migrations or background scopes. |
| HC-013 | Restore | migration/perf-unverified | `E/host-controller.ts`, `E/host-recovery.ts`; `Q/single-database.test.ts`, `Q/cross-store.test.ts`, `Q/accepted-steer-recovery.test.ts` | Selected disk/process recovery works; bounded 100/1,000/2,000-entry read measurements exist below. Production-history costs and arbitrary recovery graphs are unqualified. |
| HC-014 | Corruption | fixture-only | `Q/migration.test.ts`, `Q/copied-upgrade.test.ts`, `Q/sqlite.test.ts` | Import/public-document/facade rejection tests do not cover the full durable reference/version/torn-tail/corruption matrix. |
| HC-015 | Session/Branch/lane isolation | source-qualified | `E/default-application-runtime.ts`, `E/session-tree.ts`; `Q/db-tree.test.ts`, `Q/default-application-runtime.test.ts` | Canonical public routing/identity and copied forks are bounded; full installed multi-chat authority-domain/branch mutation parity is unqualified. Root ID 1 is store-local. |
| HC-016 | Close | source-qualified | `E/application-bootstrap.ts`, `runtime/src/runtime/shutdown.ts`; `Q/host-controller.test.ts`, `RT/runtime/queue-backstop-ownership.test.ts` | Stop/join/close and uncertain-cleanup ownership are wired; non-cooperative callbacks can prevent completion indefinitely. Process death is separate from power loss. |
| HC-017 | Deterministic drive | fixture-only | `Q/src/fixture.ts`, `Q/accepted-steer-recovery.test.ts` | Controlled barriers qualify fixed schedules only; no public manual Drive, exhaustive scheduler or arbitrary crash oracle. |
| HC-018 | Hooks/events | source-qualified | `E/host-plan-prompt.ts`, `E/host-projection.ts`; `Q/default-application-runtime.test.ts`, `Q/projection.test.ts` | Native Plan request hook and bounded watches work; general extension reload/hooks and browser delivery acknowledgement are unqualified. |
| HC-019 | Usage | fixture-only | `Q/models.test.ts`, `Q/src/fixture.ts` | Synthetic usage/model projection does not qualify aggregate retry/error/abort/compaction accounting or full budget reconciliation. |
| HC-020 | Deferred provider | fixture-only | `E/host-models.ts`; `Q/models.test.ts` | Selected synthetic handle/fetch/cancel/recreated-bridge cases do not prove persistent live-provider handle authority, polling/deadlines/lineage. One poll per resume is no public guarantee. |
| HC-021 | Effect admission | source-qualified | `E/host-builtins.ts`, `A/host-grep.ts`, `A/host-tool-process.ts`; `Q/host-builtins.test.ts`, `Q/host-grep.test.ts`, `Q/bash-port.test.ts`, `Q/models.test.ts` | Actual filesystem/spawn boundaries are guarded for selected ports. No general Gate/zero-effect guarantee; accepted provider microtask race is separate from exact-abort API gap. |
| HC-022 | Effect-start crash | fixture-only | `Q/cross-store.test.ts`, `Q/accepted-steer-recovery.test.ts`, `Q/bash-port.test.ts` | Fixed post-boundary SIGKILL/unsafe reopen evidence does not resolve arbitrary surviving children or external unknown outcomes. |
| HC-023 | Drive/host ownership | source-qualified | `runtime/src/runtime.ts`, `runtime/src/runtime/single-instance.ts`, `E/application-bootstrap.ts`; `RT/runtime/queue-backstop-ownership.test.ts`, `Q/ownership.test.ts` | Strict Linux owner precedes storage and uncertified exits retain lock. Fleet takeover/operator reconciliation, other OSes and arbitrary external effects are unqualified. SQLite locks alone do not own effects. |
| HC-024 | Storage migration | migration/perf-unverified | `E/copied-upgrade.ts`, `E/runtime-upgrade-workflow.ts`, `E/host-cutover.ts`; `Q/runtime-upgrade-workflow.test.ts`, `Q/copied-upgrade.test.ts`, `Q/rehearsal.test.ts` | Copied/offline guarded workflows exist; automatic existing-chat migration is absent. General add-on/task/doc/schema compatibility, live identity-preserving cutover and post-new-work reverse conversion are unqualified. |
| HC-025 | Backend/fork parity | migration/perf-unverified | `Q/test.ts`, `Q/sqlite.test.ts`, `Q/migration.test.ts`, `Q/single-database.test.ts` | Memory/SQLite/copied forks do not establish full JSONL parity, streaming-fork equivalence, writable-fleet ownership or production performance/resource bounds. |
| PC-001 | Ordinary accepted message | source-qualified | `E/application-bootstrap.ts`, `A/durable-queue-dispatch.ts`; `Q/default-application-runtime.test.ts`, `Q/application-web.test.ts` | Default SQL admission/worker dispatch/settlement and fresh chat creation are present; every non-web ingress and live deployment need qualification. |
| PC-002 | Exact steer | source-qualified | `A/durable-queued-steering.ts`; `SE/service-work-queued-steer.test.ts`, `Q/accepted-steer-recovery.test.ts` | Exact host target/source/version attach/materialise/consume works; no exact physical-generation or arbitrary cross-session guarantee. |
| PC-003 | Stale steer | source-qualified | `A/durable-queued-steering.ts`; `RT/channels/web/input-source-admission.test.ts`, `SE/service-work-queued-steer.test.ts` | Selected finished/version/harness mismatch and rollback cases reject; general producer/successor race coverage is incomplete. |
| PC-004 | Exact cancellation | blocked-publicAPI | `E/host-runtime.ts` `cancelInput`; `Q/runtime.test.ts` | Missing atomic conditional running abort; no read-then-abort, raw task mutation or conversation-wide substitute is admitted. |
| PC-005 | Stale cancellation | fixture-only | `Q/runtime.test.ts` | Wrong submission/repeated cancellation leave selected successor intact; full running cancellation depends on PC-004. |
| PC-006 | Late completion after cancellation | source-qualified | `E/host-runtime.ts`; `Q/host-handoff.test.ts`, `Q/cutover-runtime.test.ts`, `Q/runtime.test.ts` | Host cancellation suppresses late success/settlement publication in selected races; no provider/task interruption claim. |
| PC-007 | Terminal commit fault matrix | source-qualified | `E/application-bootstrap.ts`; `SE/terminal-settlement-atomicity-races.test.ts`, `SE/terminal-settlement-payload-redaction.test.ts`, `Q/host-handoff.test.ts` | Actual EF-S02 owner/atomic settlement is composed; arbitrary cross-file fault placement and live delivery matrix are unqualified. |
| PC-008 | Restart with open run | source-qualified | `E/host-controller.ts`, `E/host-recovery.ts`, `A/durable-recovery-dispatch.ts`; `Q/host-controller.test.ts`, `Q/worker-recovery.test.ts`, `Q/single-database.test.ts`, native scheduler scenario in `Q/default-application-runtime.test.ts` | Bounded identity discovery, paused authorisation and completed-schedule reopen work. Unknown/background work fails closed; automatic accepted-agent takeover, arbitrary scheduled crash recovery and external exactly-once acceptance are unqualified. |
| PC-009 | Pending steer restart | source-qualified | `E/host-recovery.ts`, `E/application-bootstrap.ts`; `Q/accepted-steer-recovery.test.ts`, `Q/host-recovery.test.ts`, `Q/worker-recovery.test.ts` | Clean reopen and both SIGKILL windows are existing evidence; application recovery reads real host records. Arbitrary windows/all-ingress FIFO are unqualified; fixture-only identity table is no longer the sole source implementation. |
| PC-010 | Protected hand-off | fixture-only | `SE/service-work-store-contracts.test.ts`, `RT/channels/web/messaging/starting-turn-steering.test.ts`, `Q/plan.test.ts` | Host/selected Plan lifecycle evidence does not qualify candidate reset/protected hand-off→exactly one successor end to end. |
| PC-011 | Mutation containment | fixture-only | `E/host-tools.ts`, `E/host-builtins.ts`; `Q/tools.test.ts`, `Q/bash-port.test.ts`, `Q/host-builtins.test.ts` | Selected effect fencing works; unsafe interrupted effects, all installed ports and reload containment/reconciliation remain incomplete. |
| PC-012 | Scheduler agent task | source-qualified | `runtime/src/task-scheduler.ts` `executeScheduledTask`, `runtime/src/agent-pool.ts` `dispatchScheduledAgent`, `E/application-bootstrap.ts`, `E/host-bindings.ts`; `Q/default-application-runtime.test.ts` selector `native-scheduler`, `Q/scheduled.test.ts` | Actual default native consumer uses public forks, preserves empty/dynamic/nonempty main history, reopens and accepts subsequent ordinary input; EF-S07 alone logs/delivers scheduled results. Model overrides reject; enabled caps deny allocation, with bounded mid-run/post-auth rechecks but no request budget accounting. Cancellation, automatic accepted-agent takeover, arbitrary crash and complete stale-delivery parity are unqualified. Allocation-only fake `runAgent` tests are not actual consumer proof. |
| PC-013 | Scheduler shell task | fixture-only | `Q/scheduled.test.ts`, `runtime/src/task-scheduler.ts` | Candidate agent dispatch rejects shell; retained shell regression path does not establish candidate-mode Pushover/delivery equivalence. |
| PC-014 | Stale SSE generation | source-qualified | `E/host-projection.ts`; `Q/projection.test.ts` | Actual EF-S08 owner/generation/receipt filtering drops stale observations; full browser SSE/reconnect remains unqualified. |
| PC-015 | Mobile Abort | blocked-publicAPI | `E/host-runtime.ts`; `Q/runtime.test.ts` | No candidate mobile→exact running-task abort proof; same API gap as PC-004. Legacy mobile tests cannot fill it. |
| PC-016 | Protected evidence | source-qualified | `E/host-projection.ts`, `E/host-tools.ts`; `Q/projection.test.ts`, `Q/tools.test.ts`, `Q/models.test.ts`, `Q/application-web.test.ts` | Selected sanitised DTOs/results/private reasoning/materialisation work; persisted logs/exports/telemetry need a complete secret audit. |
| PC-017 | Maintenance failure | source-qualified | `E/host-runtime.ts` `compactSession`/`reconcileMaintenance`; `Q/compact.test.ts`, `Q/application-web.test.ts`, `SE/terminal-settlement-atomicity-races.test.ts` | Same-task uncertain maintenance retains command/owner and accepted work; full compaction/watch/cleanup-after-terminal/no-redelivery matrix is incomplete. |
| PC-018 | Trusted internal input | fixture-only | `A/durable-runtime-adapter.ts`; `Q/scheduled.test.ts`, `Q/runtime.test.ts`, `RT/channels/web/alternate-ingress-guards.test.ts` | Selected claimed/scheduler ports and admission seals exist; every internal ingress still needs acceptance/budget/owner proof. |
| PC-019 | Cross-session steer | fixture-only | `A/durable-queued-steering.ts`; `SE/service-work-queued-steer.test.ts` | Local accepted steer is chat-bound; no complete cross-session acknowledgement/retry/dedup/offline acceptance proof. |
| PC-020 | Goal/checkpoint race | fixture-only | `Q/runtime.test.ts`, `Q/accepted-steer-recovery.test.ts` | Selected all-input settlement/checkpoint races pass; general goal/cross-session producer and carry/disposal races are unqualified. |

## Application adoption and internal simplification

The production source call path is `runtime.main` → strict runtime lock → default bootstrap preparation → `createDefaultApplicationRuntime` → public Harness root routing/identity documents → `createApplicationBootstrapBundle` → existing AgentPool/WebChannel/AgentQueue. The bundle uses EF-S01 acceptance, bound source hashes, EF-S02 settlement and the same physical application SQLite file. It does not create a second accepted-work queue.

`E/host-controller.ts` opens paused under ownership, reconstructs actual accepted primary/attached identities through `E/host-recovery.ts`, and checks all live submissions/tasks before progress. Unknown, independent and background work cannot inherit blanket authority. Recovery dispatch supplies worker wake-ups; events request fenced SQL reads and do not themselves release callbacks. Shutdown stops producers, joins the queue and closes borrowed storage before safe owner-release certification. Existing tests qualify bounded paths; source comments still saying “inactive”, “unregistered” or “not imported by default” on these reusable modules are stale against the actual bootstrap call graph.

Application readers now use adapter-captured public engine ports: persisted model, public position and fork-aware session tree. `E/host-runtime.ts` and `E/session-tree.ts`, with `Q/db-tree.test.ts`, `Q/single-database.test.ts` and `RT/agent-pool/runtime-facade.test.ts`, cover selected imported/native/tool/compaction projections, protected reasoning exclusion and no JSONL fallback. Navigation/history mutations and complete legacy REST/context/usage parity are unqualified. Bounded measurements below exercise 100/1,000/2,000 entries and the 100-entry pagination boundary; production-scale resource acceptance is still missing.

Published `8dcf4dd73` makes `getSessionTreeSummaryForChat` uniformly async, reuses the existing public tree reader, awaits startup/session-control/scheduler consumers and adds awaited `sessionTree` to GET `/agent/context`. The total counts visible nodes; the leaf retains the exact raw public head. It introduces no new state/port/table and does not claim or clear native turn status. `db-tree-summary-replacement-checkpoint.md` records focused 70/373 and application/DB 10/130 receipts plus typechecks; overlapping counts are not additive.

The native context follow-up captures the bound session before awaiting the existing public persisted-model reader. The owned synchronous host ModelRuntime resolves positive finite physical model windows without provider IO or catalogue warming; absent model/metadata yields `contextWindow: null`. Native `tokens` and `percent` stay null: historical cumulative usage cannot estimate current context. Internal `tokensAreAuthoritative: true` prevents stale same-generation stored counts from replacing those nulls after compaction; legacy fallback is unchanged. Public context, status, family GET/PATCH model-control, branches and widget state JSON/SSE projections expose only public fields. The shared public projection removes the hint and future private fields. Unbound/missing-reader/stale-owner cases fail without legacy construction. No new table, port or stored state is added. Bounded review was READY after the HTTP projection P2 fix; the final root gate passes with `EXIT_CODE=0`.

Seven guarded Linux builtins (`read`, `bash`, `edit`, `write`, `find`, `ls`, `grep`) are now the source default. Root and durable grep share `A/host-grep.ts`; find/grep share `A/host-tool-process.ts`. Guards execute at selected actual filesystem/spawn boundaries; recognised previous defaults converge only under idle/owner checks. Custom subsets and model/history identity survive. This is single-user policy, without a new filesystem sandbox or general add-on grant.

Approved installed Plan uses `E/host-extension-catalog.ts`, `E/host-plan-tool.ts` and native `E/host-plan-prompt.ts` `GenerationHooks.beforeRequest`. Public task/tool/source evidence bounds invocation-local chat KV authority. The hook refreshes request-only Plan state on each provider request; it does not emulate legacy SessionManager/ExtensionContext or persist invented hidden entries. Shared `runtime/src/db/register-extension-kv.ts` and the existing authority router replace duplicate registration. Canonical version/content/object checks and process-local path poisoning reject unsupported or stale SDK-cached factories. Approved Plan and the bounded installed Delegate profile below have native default paths; other installed lifecycle/tool contributions fail startup explicitly. Historical Delegate/Code Review fixtures in `Q/delegate.test.ts` and `Q/addon-host-services.test.ts` do not qualify the new default Delegate path.

## Bounded native Delegate consumer

The actual default factory loads the canonical installed Delegate 0.2.20 declaration
and `buildModelCandidates` policy, then installs `E/host-delegate-tool.ts`.
It never calls legacy `execute`, lifecycle handlers, CLI children or a fabricated
SessionManager/ExtensionContext. Public SDK task-owned child conversations use the
same physical application database. Legacy CLI code and the add-on package stay
for the separate legacy path until fleet legacy migration permits removal.

`E/host-runtime.ts` captures the exact public running MODEL tool slot and call.
Child public ownership resolves to its live, unaborted parent `pi.tool` task and
committed assistant `delegate` call; task-owned parents cannot recurse. Public
accepted records resolve to EF-S01 bindings, current executing claimed uncancelled
source/operation and exact running harness. Busy-chat lookup grants no authority.
Captured-source checks run at child admission, generation/model boundaries and
reader effects. Current provider availability, Settings approval and the installed
ordered classification/exclusion policy apply before creation and after settlement,
and through model post-auth `transformHeaders` and tool-effect guards.

Only the exact parent model is inherited. Children have fresh self-contained
history, parent thinking level and `read`/`grep`/`find`/`ls` or explicit subsets;
no recursion or Plan prompt. Categories `quick`, `summarize`, `code`, `analyze`,
`reason` are accepted without model reselection; `judge`, other models/options,
nonempty files and explicit deadlines reject. Any enabled root budget cap denies
before creation and at each source/model guard. This conservative profile also
denies unrelated caps; per-request child accounting is unqualified. Parallel tool
calls use independent owned children, with no numeric global concurrency setting
or second queue.

Catalogue approval checks canonical paths, content hashes, module resolution and
registered definition/handler objects. Changed source rejects; process-local path
poisoning blocks uncertain cached factories even after bytes are restored. Startup
source admission includes Delegate. `app.host-scheduled-source` is now an all-source
generation hook despite its stale name; renaming it and Plan-named shared profile
types is separate cleanup, not required for these guards.

Existing receipts: actual default two-child scenario 31 assertions; denied provider
25; supplied current cap/provider revocation follow-ups 38 each; source/factory
7 tests / 55 assertions; Delegate catalogue seven cases. The combined factory/
catalogue scope passes 30 cases including Plan; earlier failed logs are historical.
Earlier individual revocation logs failed overbroad error-string assertions.
The initial full candidate has 480 cases, 478 pass and two disk-test 5,000 ms
timeouts (`native-delegate-final-candidate.log`, exit 1). Focused disk repeat passes
42 / 329 (`native-delegate-disk-repeat.log`). The second full candidate has
479 pass and one different disk timeout. Final serial candidate
`native-delegate-serial-candidate.log` passes 480 tests / 7,163 assertions,
`EXIT_CODE=0`. Inner root gate `native-delegate-root-independent.log` completes
normally: 7,312 pass, 74 baseline skips, 0 fail, plus 25 feature and 9 build tests.
Its interrupted outer wrapper supplied no exit-code receipt. All three scoped
typechecks pass. Published native Delegate adoption is `ea2d1416e`; its hosted
result is not recorded here. Published scheduler
`a89afe02f` has 458 candidate and 7,294 root + 25 feature + 9 build passes;
`175032611` native-parallel has 462 candidate passes. Those older results retain
their own source boundaries.

The 45 row statuses stay 22 source-qualified, 17 fixture-only, 3 blocked-publicAPI
and 3 migration/perf-unverified. HC-002 already had bounded source qualification.
The public SDK exposes `abortTask` for a known task. It lacks an atomic condition
against the exact current running task; read-then-abort cannot provide that
condition. HC-009/PC-004/PC-015 retain their exact-running cancellation gap.
Foreground child cancellation and host publication fencing do not fill it.

## Bounded native scheduler consumer

The default source path is EF-S07 polling → `executeScheduledTask` → real AgentPool
`dispatchScheduledAgent` → application bootstrap dispatch → public SDK fork
allocation/submission. The allocator rechecks the actual lease, task revision,
claimed source and operation, then writes correlation to the existing binding table
in the same physical application database. Main-chat execution/history is preserved;
no legacy save/restore or model-label lookup runs. EF-S07 owns scheduled logs and
result delivery. Scheduled terminal settlement emits no EF-S02 timeline answer.

The actual `Q/default-application-runtime.test.ts` selector
`PICLAW_DEFAULT_FACTORY_CASE=native-scheduler` uses real default bootstrap,
AgentPool and `pollScheduledRunsOnce` with a synthetic keyless provider. Its shared
title is `default factory prepares and reopens real startup-known public
conversations; refuses legacy before models`. Assertions cover empty main,
dynamically added root, nonempty main, unchanged main position/history, three
successful logs/results, reopen and a subsequent ordinary message with exactly one
further ordinary answer. Legacy `runAgent`/save/restore/model-label and SessionManager
spies remain unused. `Q/scheduled-allocation.test.ts` explicitly uses fake `runAgent`;
its lease/rollback/public-fork/forged-route checks qualify allocation only.

`Scheduled model override unavailable` explicitly rejects overrides before dispatch.
Applicable enabled instance/provider or matching scheduled-task caps reject before
fork allocation with `Native scheduled budget admission unavailable`, including
zero and positive allowances. Task-work caps do not grant a new occurrence authority;
other scheduled tasks' caps do not apply. Per-request native scheduled budget
attribution, reservation and accounting are incomplete.

Current exact scheduled binding resolution rechecks source/operation/revision/lease
and caps. All seven host builtins capture actual public run/tool-slot provenance and
recheck at filesystem/process effects. Native `GenerationHooks.beforeRequest`
captures actual run provenance against the hook abort signal; the model bridge
carries the request guard into post-credential `transformHeaders`. The actual native
scenario enables a cap after one provider response and verifies no write, no second
provider invocation, an error log and no delivery. A separate asynchronous credential
barrier enables a cap after capture and verifies zero provider invocations and no
delivery. Denial fails that request without aborting shared model lifetime. The
accepted microtask gap after awaited `transformHeaders` is unchanged; these checks
do not provide atomic network cancellation or an exact running-task abort.

Startup validates persisted scheduled source/operation/fork provenance, including
completed occurrences. A stale inspected task is ignored only after reading its
exact persisted public terminal receipt. Unknown/background authority still rejects.
Automatic accepted-agent takeover and arbitrary scheduled process-crash recovery
are unqualified. PC-012 meets the bounded source-qualified definition, with incomplete
model/budget/cancellation/recovery acceptance stated above. PC-018 general ingress
and HC-019 usage retain fixture-only status. Stale inactive/unregistered module
comments are superseded by this default call graph; frozen-gate source comments
were left untouched.

## Existing verification receipts

No tests were rerun and no network/CI queries were made for this refresh.

| Tree / scope | Existing receipt | Result and limit |
| --- | --- | --- |
| Published Plan source at `7315c221e` | `native-plan-cache-final-full.log`; qualification README's final Plan section | 456 pass, 0 fail, 6,970 assertions, 37 files. Synthetic/keyless candidate qualification, not 45 acceptance passes. |
| Published Plan source root gate at `7315c221e` | `root-native-plan-final-repeat.log` | 7,287 pass, 74 baseline skips, 0 fail; 25 feature + 9 build tests; `EXIT_CODE=0`. Root regression evidence, with Pi 1.2.0 host graph. |
| Plan exact-head hosted CI | User-provided prior-turn receipt: run `39054197173` | Reported green for `7315c221e`; not re-fetched here. |
| Summary source published as `8dcf4dd73` — candidate | `tree-summary-isolated-candidate.log` | 456 pass, 0 fail, 6,974 assertions, 37 files. Separate from the published Plan receipt. |
| Summary source published as `8dcf4dd73` — root gate | `root-tree-summary-final.log` | 7,289 pass, 74 baseline skips, 0 fail; 25 feature + 9 build tests pass and inner make completes normally. The interrupted outer wrapper did not record an `EXIT_CODE`; none is inferred. |
| Summary exact-head hosted CI | Run `39059477545` | Completed successfully for exact head `8dcf4dd73`; queried after the run completed. |
| Native context candidate over `8dcf4dd73` | `context-window-final-candidate.log` | 456 pass, 0 fail, 6,974 assertions. Separate from the published summary candidate receipt. |
| Native context focused root | `context-window-root-tests.log` | 60 pass, 0 fail, 325 assertions, 3 files. |
| Native context HTTP projection P2 fix | `context-window-public-projection-tests.log`, `context-window-public-projection-types.log` | 24 pass, 0 fail, 411 assertions, 2 files; runtime typecheck passes. Bounded independent review READY after this fix. |
| Native context scoped types | `context-window-root-types.log`, `context-window-engine-types.log`, `context-window-qualification-types.log` | All three pass. Earlier parallel engine exit 137 was followed by a passing rerun. |
| Native context final root gate | `context-window-final-root.log` | 7,311 pass, 74 baseline skips, 0 fail; 25 feature + 9 build tests pass; `EXIT_CODE=0`. |
| Published native context parent `31dd88ebd` — hosted CI | Supplied verified exact-head receipt, run `39061392219` | SUCCESS; not re-fetched during this docs-only refresh. The 456 candidate / 7,311 root + 25 feature + 9 build results above belong to this parent, not the scheduler follow-up. |
| Scheduler mixed focused follow-up over `31dd88ebd` | `scheduled-midrun-focused.log` | 95 pass, 0 fail, 2,474 assertions across 3 files: actual default `native-scheduler` scenario, model tests and allocation-only tests. Not the full default suite or 95 actual-native cases; no additive aggregation. |
| Scheduler component effect fences | `scheduled-midrun-effect-final.log` | 117 pass, 0 fail, 2,565 assertions across bash/builtin/model tests. Separate component evidence; overlapping model counts are not additive. |
| Scheduler final simplified source | `scheduler-simplified-candidate.log`, `scheduler-simplified-root.log` | 458 candidate tests / 6,990 assertions; root 7,294 pass, 74 baseline skips, 0 fail; 25 feature + 9 build tests pass; `EXIT_CODE=0`. All three scoped types pass. |
| Accepted-steer crash matrix | `accepted-steer-crash-checkpoint.md`, `accepted-steer-crash-full.log`, `accepted-steer-crash-repeat-{1,2,3}.log` | Existing attachment-before-submit and submission-before-ACK SIGKILL cases retained. No repeat run. No arbitrary mid-commit, paid-provider exactly-once or power-loss guarantee. |

Historical failed, interrupted and superseded runs remain in their original receipts/README. Early six-tool/grep-blocked, legacy-default and controller-missing checkpoints describe earlier source; the current code and final registered-suite receipts above supersede those implementation statements.

## Bounded tree and native context reads

The existing external run passed 18,716 assertions on synthetic native histories using actual public SDK SQLite storage, a borrowed physical root, real host effect/binding composition, `HostConversationRuntime`, the durable adapter and `AgentRuntimeFacade`. It did not use default application bootstrap/runtimeFactory or providers. These read measurements do not change acceptance statuses. With bounded scheduler source adoption, the 45 rows now total 22 source-qualified, 17 fixture-only, 3 blocked-publicAPI and 3 migration/perf-unverified.

| Native entries | Warm tree median ms | Warm tree p95 ms (n=5) | First tree read after reopen ms | Warm facade context metadata median ms |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 0.475 | 0.585 | 0.504 | 0.077 |
| 1,000 | 2.574 | 2.864 | 2.776 | 0.053 |
| 2,000 | 7.430 | 8.311 | 4.707 | 0.043 |

Original public entry IDs, linear ancestry, parent/child counts, full snapshot equality, public saved position and the reader's 100-entry page boundary passed. Assistant/tool rows are synthetic. Context reads resolve persisted model/window metadata, without assembling full model context or counting tokens. Shared-gate CPU contention was uncontrolled; RSS consists of process snapshots. Reopen retained the warm OS cache. Five samples are descriptive, with nearest-rank p95 equal to the maximum; they do not establish production tail latency or benchmark acceptance.

[Persistent method, raw samples and digests](../../../evidence/pi-durable-130-tree-read-performance-20261017.md) retain the bounded evidence. The original harness lives at `/workspace/reviews/durable-1650/tree-read-performance.ts`; external JSON and report are `/workspace/reviews/durable-1650/tree-read-performance.json` and `/workspace/reviews/durable-1650/tree-read-performance.md`. Those local files persist in this workspace but are outside the repository. The raw JSON copy is portable; a portable repository harness is missing, so a clone alone cannot reproduce this run. No code benchmark is required for this bounded evidence qualification.

## Remaining acceptance work

1. Close the exact-running-abort public API gap for HC-009/PC-004/PC-015 or obtain an explicit requirement decision. Host cancellation/publication fencing is already distinct; no unsafe substitute is proposed.
2. Complete scheduler model overrides and native per-request budget attribution/reservation/accounting, exact cancellation, accepted-agent takeover and arbitrary-crash/stale-delivery qualification. The actual consumer and cap-denial checks above do not complete those requirements. Complete service/terminal-effect (STE) acceptance across general trusted internal and cross-session input, protected hand-offs, mobile cancellation and goal/checkpoint races. EF-S01/02/05/07/08 keep their acceptance, terminal, delivery, scheduler and projection authorities. Task outcomes/watches cannot replace terminal or delivery receipts.
3. Qualify remaining semantic matrices: parallel ordering, safe replay, retry/budgets, corruption, deferred live-provider recovery, reload, usage accounting and automatic/background/overflow compaction. Existing bounded source/component results do not supply those matrices.
4. Extend bounded native Delegate beyond the read-only same-parent-model profile: qualify request budgets/accounting, wider models/tools, attachments/deadlines and recovery. Complete current full gates. Code Review, remote networking/auth, MCP/SSH effects and general lifecycle/state compatibility need separate evidence.
5. Keep migration last. Preserve existing host chat/branch/session identities; qualify compatibility totality, guarded cutover and reverse conversion after new work. `E/host-controller.ts` deliberately rejects checkpoint/rollback proof without public storage identity and historical frontier; copied host-only rollback success does not remove this limitation.
6. Extend the bounded read evidence to production-scale restore/tree reads, storage growth, latency, memory and ownership/resource behaviour; supply a portable harness before clone-only reproduction is possible. Package/install, canary, live providers, fleet activation and rollback execution require separate approval and evidence.

## Evidence navigation

- [Qualification README](../../../../qualification/pi-durable-130/README.md): incremental receipts; read final registered-suite results with their source scope.
- [Historical acceptance report](pi-durable-130-current-acceptance.md): earlier `87efd0342` assessment and controller/copied-upgrade follow-ups, preserved unchanged below its supersession notice.
- Local reviews: `default-backend-factory-checkpoint.md`, `native-plan-adoption-checkpoint.md`, `db-tree-summary-replacement-checkpoint.md`, `db-session-tree-checkpoint.md`, `web-admission-drain-checkpoint.md`, `queue-backstop-ownership-checkpoint.md`. Their old “next steps” and WIP states are dated evidence, not current missing-source declarations.
