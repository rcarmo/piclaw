# Native Delegate adoption — bounded dirty source over `175032611`

The actual default factory now admits the approved installed Delegate 0.2.20
schema and policy through `createHostDelegateTool` in
`runtime/durable-engine/src/host-delegate-tool.ts`. It creates SDK task-owned
public child conversations in the existing application SQLite database. The
installed legacy `execute` and lifecycle handlers never run on this durable path;
there is no CLI child or SessionManager/ExtensionContext emulation. Earlier parked
Delegate refusal checkpoints describe a different implementation.

## Authority and supported profile

`HostConversationRuntime.captureToolSource` checks the exact public running MODEL
tool slot/call. For a child, public task ownership leads to the live, unaborted
parent `pi.tool` task and committed assistant `delegate` call. It rejects recursive
task-owned parents. Accepted input records resolve to EF-S01 bindings and the
current executing, claimed, uncancelled source/operation and exact running harness.
A busy parent or conversation ancestry alone grants no authority.

The child inherits only the parent's exact provider/model and thinking level.
The actual installed `buildModelCandidates` applies Settings approval, ordered
classification and exclusions; current host model/provider availability also
applies. Checks run before child creation and after settlement. Generation source
capture carries the guard through model authorisation and post-credential
`transformHeaders`; child reader effects recheck captured source and model policy.

- Readers: `read`, `grep`, `find`, `ls`, including explicit subsets. No recursive
  Delegate, parent history or Plan prompt enters the fresh self-contained child.
- Omitted model or the exact parent provider/model is supported. Other models,
  `standard`/`full` tools, nonempty `files` and every `timeout_sec` reject explicitly.
- Supported `task_category`: `quick`, `summarize`, `code`, `analyze`, `reason`.
  `judge` and unknown options reject. Categories do not select a different model.
- Any enabled cap in the root `budget_caps` table denies before child creation
  and at each source/model effect guard, including zero and positive amounts.
  This conservative profile also denies unrelated caps. It supplies no native
  child request reservation, attribution or accounting proof.
- Parallel Delegate tool calls create independent task-owned children. No numeric
  global concurrency setting or additional queue is introduced.

`host-extension-catalog.ts` binds approval to canonical installed paths, version,
content hashes, module resolution and exact registered definition/handler objects.
Changed source or registration rejects; process-local cache poisoning prevents
restored bytes from blessing an uncertain previously cached factory. Source
admission now covers Delegate at startup. The generation hook's historical name
`app.host-scheduled-source` now covers all sources; renaming it is cleanup, not a
functional prerequisite. Shared profile types still carrying Plan names could be
simplified separately.

The parent CLI implementation remains available on the separate legacy path.
The durable implementation never calls it. Removing the add-on package or old
runner requires fleet legacy migration; this change does not remove them.

## Existing receipts and unfinished gates

Receipts live under `/workspace/reviews/durable-1650/`; none was rerun for this
refresh. The actual-default synthetic two-child scenario passes 31 assertions
(`native-delegate-effect-test.log`); provider-denied admission passes 25
(`native-delegate-denied-effect-test.log`). Current cap/provider revocation cases
have 38 assertions each in the supplied follow-up receipt. Earlier individual
revocation logs failed overbroad error-string assertions and are historical
failures, not passing receipts. Source/factory tests pass 7 / 55 assertions
(`native-delegate-owned-tests.log`); installed Delegate catalogue tests have seven
cases. The current combined factory/catalogue scope has 30 cases including Plan;
the final `native-delegate-effect-factory-catalog-regressions.log` records 30 pass, 0 fail. Earlier failed receipts remain historical.

`native-delegate-final-candidate.log` records 480 cases: 478 pass and two disk-test
5,000 ms timeouts, exit 1. Focused disk repeat
`native-delegate-disk-repeat.log` passes 42 / 329 assertions. A second full candidate (`native-delegate-repeat-candidate.log`) timed out in one different existing disk test: 479 pass, 1 fail. Final serial candidate `native-delegate-serial-candidate.log` passes 480 tests / 7,163 assertions across 41 files, `EXIT_CODE=0`. Inner root gate `native-delegate-root-independent.log` completes normally with 7,312 pass, 74 baseline skips, 0 fail, plus 25 feature and 9 build tests. The interrupted outer wrapper did not record an exit code; none is inferred. All three scoped typechecks
pass (`native-delegate-effect-{root,engine,qualification}-types.log`).

Published scheduler `a89afe02f` has candidate 458 and root 7,294 + 25 feature +
9 build passes; native-parallel parent `175032611` has candidate 462 passes.
Those receipts predate dirty native Delegate adoption. Latest hosted status is
unknown and was not queried. The 45 assessment stays 22 source-qualified,
17 fixture-only, 3 blocked-publicAPI and 3 migration/perf-unverified; HC-002 was
already bounded source-qualified. Public SDK `abortTask` exists, but lacks an
atomic condition against the exact current running task. HC-009/PC-004/PC-015
still lack that guarantee; owning and aborting a known child task does not fill it.
No activation, migration, network, tests, service changes, pins, commits or pushes
occurred during this documentation refresh.

# Native parallel Delegate feasibility — 17 October 2026

`native-delegate-parallel.test.ts` uses the public SDK foreground-subagent pattern
with two task-owned conversations. Both synthetic providers enter before either
is released. Four cases pass: concurrent execution with clean close/reopen and
stable child/request identities, cancellation of one child without stopping its
sibling, parent cancellation draining children, and model denial without creating
children. Child thinking and private prompts do not enter the parent tool result.

The focused proof passes 4 tests / 85 assertions. The registered candidate suite
passes 462 tests / 7,075 assertions across 39 files (`native-parallel-full-candidate.log`),
and all three scoped typechecks pass. The bundle-local allocation method is typed
locally; the removed public backend allocation API stays removed.

This is a synthetic one-SDK-SQLite proof, not installed Delegate adoption. Clean
reopen replays physical provider calls; it does not establish exactly-once billing.
Production integration still needs parent-call provenance, model/credential policy,
per-request accounting, and bounded concurrent admission through the existing host.
No CLI child is launched. No live activation or migration occurred.

# Native scheduler adoption — bounded source follow-up over `31dd88ebd`

The default backend now routes agent schedules through real AgentPool
`dispatchScheduledAgent` and `executeScheduledTask` into the public SDK fork
allocator. The allocator checks the actual EF-S07 lease/revision/source, persists
correlation in the existing binding table and uses the same physical application
database. EF-S07 owns scheduled task logs and result delivery; scheduled settlement
creates no EF-S02 timeline answer. Ordinary main-chat execution is unchanged.

`default-application-runtime.test.ts`, selected with
`PICLAW_DEFAULT_FACTORY_CASE=native-scheduler`, exercises real default bootstrap,
AgentPool and `pollScheduledRunsOnce` with a keyless synthetic provider. Its
registered test title is `default factory prepares and reopens real startup-known
public conversations; refuses legacy before models`. It covers an empty main,
a dynamically added chat root and a nonempty main, with unchanged main position
and history, three successful scheduled logs/results, close/reopen and a subsequent
ordinary message producing exactly one further ordinary answer. Spies reject any
legacy `runAgent`, save/restore, model-label lookup or SessionManager construction.
The test selector identifies this scenario; the shared title alone does not.

`scheduled-allocation.test.ts` is separately titled `allocation-only helper (fake
runAgent): source-bound lease, rollback, public fork, forged route denied`. It uses
a fake `runAgent` and qualifies allocation only. It is not actual scheduler
consumer proof.

## Admission and side-effect limits

- Scheduled model overrides explicitly reject with `Scheduled model override
  unavailable`; fork-local override validation is incomplete.
- Applicable enabled instance/provider or matching scheduled-task caps, including
  zero and positive amounts, reject before fork allocation with `Native scheduled
  budget admission unavailable`. Task-work caps do not authorise a new occurrence;
  other scheduled tasks' caps do not apply. There is no qualified native
  per-request scheduled budget attribution, reservation or accounting.
- Exact scheduled binding resolution and captured-source guards reread current
  authority/caps during execution. All seven host builtins capture actual public
  run/tool-slot provenance and recheck at their filesystem/process effects.
  `GenerationHooks.beforeRequest` captures actual run provenance against the SDK
  hook abort signal; the host bridge retains its request guard through the
  post-credential `transformHeaders` check. Failure denies that request without
  permanently aborting the shared model lifetime.
- The native scenario enables a cap after the first synthetic provider response:
  the returned write never reaches the filesystem, a second provider invocation
  does not occur, the run logs an error and no result is delivered. Its separate
  asynchronous credential-resolution barrier enables a cap after capture and
  verifies zero provider invocations and no delivery. These are current-source
  checks, not per-request budget accounting or atomic provider-send cancellation.
  The existing accepted microtask gap after awaited `transformHeaders` is
  unchanged. Host fencing does not cancel an exact running SDK task.
- Reopen validates persisted source/operation/fork provenance, including completed
  scheduled bindings. Only an exact persisted terminal receipt permits ignoring a
  stale inspected task. Unknown/background authority still fails closed; automatic
  accepted-agent takeover and arbitrary scheduled process-crash recovery are
  unqualified.

## Existing receipts and running gates

Receipts are under `/workspace/reviews/durable-1650/`; no tests or network requests
were made for this documentation refresh.

- `scheduled-midrun-focused.log`: 95 pass, 0 fail, 2,474 assertions across
  `default-application-runtime.test.ts` (native-scheduler selector), `models.test.ts`
  and `scheduled-allocation.test.ts`. This mixed focused total is not the full
  default suite or 95 actual-native scenarios. The final native source contains
  both mid-run and asynchronous credential-boundary assertions.
- `scheduled-midrun-effect-final.log`: 117 pass, 0 fail, 2,565 assertions across
  bash, builtin and model bridge tests; component effect-fence evidence, separate
  from actual native consumer proof. Overlapping counts are not additive.
- Parent `31dd88ebd`: candidate 456 pass; root 7,311 pass, 74 baseline skips,
  0 fail, plus 25 feature and 9 build tests (`context-window-final-candidate.log`,
  `context-window-final-root.log`). Exact-head hosted run `39061392219` succeeded
  according to the supplied verified receipt. These results predate this scheduler
  source follow-up.
- Final simplified scheduler tree: 458 candidate tests / 6,990 assertions pass
  (`scheduler-simplified-candidate.log`); root 7,294 pass, 74 baseline skips,
  0 fail, plus 25 feature and 9 build tests, `EXIT_CODE=0`
  (`scheduler-simplified-root.log`). All three scoped typechecks pass.
- Removed the unused public allocation API. Backend selection uses the actual
  dispatch result; native work is joined before returning after revocation.
  Legacy branch restoration and native isolation regressions pass.

PC-012 is now bounded source-qualified: the production consumer exists and the
actual native scenario exercises it. Full scheduler parity/acceptance still needs
model overrides, native request budgets, cancellation and recovery qualification.
The [45-requirement assessment](../../docs/design/earendil-agent-harness-integration-adr/evidence/pi-durable-130-acceptance-current-20261017.md)
now counts 22 source-qualified, 17 fixture-only, 3 blocked-publicAPI and
3 migration/perf-unverified rows. HC-019 usage and PC-018 general internal ingress
stay fixture-only; PC-008 does not qualify arbitrary scheduled crash recovery.

`stash@{0}` (`scheduler-allocation-current`) is an older allocation snapshot already
applied to this dirty tree; it is not a complete snapshot of current scheduler work.
`stash@{1}` preserves incomplete native Delegate/Code Review work, excluded here.
Stale module comments saying inactive/unregistered are superseded by the actual
default call graph; source comments were not edited during frozen-code gates.
No activation, migration, deployment, restart or live-state change occurred.

# Native context metadata follow-up — 17 October 2026

The async context reader captures the bound session before awaiting the existing
public persisted-model reader. It resolves that physical provider/model through
the owned synchronous host model runtime, without provider IO or catalog warming.
Only positive finite registered context windows are reported; missing model or
metadata means `contextWindow: null`. Native `tokens` and `percent` remain null:
cumulative public usage/history is not a current-context estimate.

An internal optional `tokensAreAuthoritative: true` marks these known-unknown
counts so the context endpoint cannot revive stale same-generation stored
estimates after compaction. Public context/status, family GET/PATCH model-control,
branches and widget state JSON/SSE projections omit the hint and other private
fields; the shared public projection allowlists public fields only. Legacy stored
fallback remains unchanged. Unbound chats, unavailable readers and stale owners
fail without constructing legacy sessions. No new state, tables or ports.

This source follow-up builds on published summary HEAD `8dcf4dd73`. Receipts under
`/workspace/reviews/durable-1650/`:

- Candidate: 456 pass, 0 fail, 6,974 assertions
  (`context-window-final-candidate.log`).
- Focused root: 60 pass, 0 fail, 325 assertions
  (`context-window-root-tests.log`).
- HTTP projection P2 fix: 24 pass, 0 fail, 411 assertions
  (`context-window-public-projection-tests.log`); bounded review READY after fix.
- Runtime, engine and qualification types pass (`context-window-{root,engine,qualification}-types.log`);
  projection runtime types pass (`context-window-public-projection-types.log`).
- Final root gate: 7,311 pass, 74 baseline skips, 0 fail; 25 feature and
  9 build tests pass, `EXIT_CODE=0` (`context-window-final-root.log`).

Bounded existing performance evidence covers 100/1,000/2,000 synthetic native
entries through actual SDK SQLite, borrowed root, HostConversationRuntime and the
facade, without default application bootstrap or provider execution. Warm tree
medians are 0.475/2.574/7.430 ms; native model/window metadata medians are
0.077/0.053/0.043 ms. These five-sample observations do not establish production
performance acceptance. See the [persistent method, raw samples and digests](../../docs/evidence/pi-durable-130-tree-read-performance-20261017.md);
the harness is external to the repository and clone-only reproduction is missing.
At that context-only checkpoint all 45 acceptance statuses were unchanged; the
scheduler section above records the subsequent bounded PC-012 change.

# Session-tree summary follow-up — 17 October 2026

The application summary now awaits the existing public tree reader, preserves the
exact raw head, and counts visible nodes. Startup/session-control callers await
the result; GET `/agent/context` includes it without changing active turn status.
The separate legacy summary calculation and durable null placeholder are removed.

The isolated summary source over Plan `7315c221e` is now published as
`8dcf4dd73`. Existing source receipts:

- Candidate suite: 456 pass, 0 fail, 6,974 assertions, 37 files
  (`tree-summary-isolated-candidate.log`).
- Root gate: 7,289 pass, 74 baseline skips, 0 fail; 25 feature and 9 build tests
  pass (`root-tree-summary-final.log`). Inner make completed normally; the
  interrupted outer wrapper supplied no exit-code receipt.
- Runtime, engine and qualification typechecks pass; bounded independent source
  review found no P1/P2 issues. The actual application/DB tests cover the context
  endpoint, hidden raw head, visible count and unsupported-entry refusal.

Receipts are under `/workspace/reviews/durable-1650/`. Unfinished native Delegate
and Code Review work is parked separately, excluded from this tree and these
results. Summary exact-head hosted CI run `39059477545` completed successfully
for `8dcf4dd73`. No live activation or migration occurred. The
[45-requirement assessment](../../docs/design/earendil-agent-harness-integration-adr/evidence/pi-durable-130-acceptance-current-20261017.md)
separates source qualification from fixture-only and unresolved acceptance work.

# #1650: isolated Pi durable 1.3.0, first qualification slice

**Candidate in-place prototype qualification, not production integration or completion of #1650.**
Base: Piclaw `4e08281bb6d3942e7560edabca8581acf556b138`; root still targets Pi 1.2.0.
The inactive source-only engine owns the candidate manifest, lock and node_modules
under `runtime/durable-engine`. This qualification package has only test/tooling
dependencies. Its public re-export files in the engine's `qualification/` directory
share the engine's physical candidate graph, including types; they contain no
compatibility or wrapper logic. Do not mix handles, contexts or TypeBox objects
with the root Pi 1.2.0 graph. The candidate API may
change without notice; exact 1.3.0 byte evidence does not qualify future versions.

## Run

From the worktree root, install the engine first, then the qualification tooling:

```sh
cd runtime/durable-engine
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
cd ../../qualification/pi-durable-130
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run test # isolated launcher: test.ts sqlite.test.ts host-handoff.test.ts migration.test.ts
```

Installation may access npm; normal tests are offline. The preload requires the
existing disposable-filesystem launcher and isolated HOME/workspace/store/agent
paths; direct `bun test` fails closed. Fetch/WebSocket and credential lookups
throw; environment credentials are sanitized. These are JS regression guards,
**not an OS security sandbox**. Only a keyless synthetic provider/local stream and
synthetic tools run; no real providers, accounts, filesystem or shell tools.
Typecheck uses TypeScript 7.0.2, @types/bun 1.3.14 (bun-types 1.4.2), and
`skipLibCheck` for external declarations; no bunx download/root dependency symlink.

## Exact candidate identity and provenance

Public registry: `https://registry.npmjs.org`. All five packages below are
**1.3.0**. Tarball URLs are exactly
`https://registry.npmjs.org/@earendil-works/NAME/-/NAME-1.3.0.tgz`, substituting
the package basename for both occurrences of NAME.

| Package basename | Published files | Registry SHA1 (actual archive verified) |
| --- | ---: | --- |
| chord | 131 | `845bb52ed65ffcdfa28f115dbec4862e90170dd3` |
| pi-ai | 837 | `fe720249f828642bcb66b5b6a0e49c1e5f2f8954` |
| pi-codemode | 66 | `f8fd528ac57a326ae7a692d3f5cf6ddbe7d35001` |
| pi-durable | 327 | `e0d25c2b885d1df15f29fa88f51bf07c36a881d8` |
| pi-telemetry | 26 | `1dd6f59e65c4eb067ff96f51148e59a2069b9d8d` |

Registry SHA512 SRI values (actual archive verified):

```text
chord:        sha512-qqYhjALZ193atpBzmmS+M5pHQoiI4Aynetc1jXpv+5O2crXH3Y8wbFEy33orU2nmFrlw1U36rsdgUjaW4b3m/w==
pi-ai:        sha512-KaBI8x7q7sPoFUXICNGD9efHzDG+oRNwVvkA9jdIsSQWH1RjFssOlEGsbLtewUPPgCrvmz0l2KTgSLXTyj3acw==
pi-codemode:  sha512-2G9tmbsPhgzwfz7cmzJpbLSLqOx3eu22Gbzm+Wc3HqeZMjLQS4F3KfAabozVhv7uEjq3k2O1dZTHmhhWr2xbfQ==
pi-durable:   sha512-2aD0xead1LH0BBwUBxex28in/PpUJEwyaEiW/nLoTFUcZ/lDYEl6LHX6mGZKJG8tUHzERwJyysDgy0ruidt84w==
pi-telemetry: sha512-ERGZr+aXjNJzoUbB7ZzHVH3g5otzMHjHLs2Fyizm12By5X+gBEhod9cJXFOk13S7M8a29Am+Mq21zm73mRJFLg==
```

`provenance.json` records acquisition time, exact URLs, both registry digests and
SHA256 of **all 1,387 published files**, including README, package metadata and
all dist JS/declarations/maps. `src/provenance.ts --record` explicitly downloads
metadata and archives, verifies SHA1 and SHA512, extracts to a disposable temp
directory, compares every extracted file with the installed payload and cleans
up. Its tar subprocess receives only PATH, not inherited credentials. This
explicit acquisition command is never called by tests:

```sh
bun src/provenance.ts --record
```

The offline provenance test checks the five-package set, 1.3.0 identities, lock
SRI values, exact installed file sets and every file hash against that recorded
extraction. It does not need the archives or registry at test time. Evidence
establishes equality with npm's bytes at acquisition, not independent publisher
identity/authenticity. Third-party dependency payloads are locked but not part
of the five-package byte comparison.

Installed family closure: durable depends on chord, ai and codemode at 1.3.0;
ai additionally depends on telemetry 1.3.0. No coding-agent package is installed
in the engine. The full third-party dependency/version/SRI closure is in
`runtime/durable-engine/bun.lock`; engine overrides pin all five family members.
No candidate-family dependency is installed by the qualification manifest/lock;
its fixtures reach public APIs through engine-owned re-export files. Notable
direct edges are typebox 1.3.27, quickjs-wasi 3.6.2, photon 0.3.3 and
diff 8.0.4, plus ai's provider SDKs. Their presence is not a claim of execution
or provider/QuickJS qualification.

## Public API boundary

Only public chord/context, pi-ai (including utils/event-stream), pi-durable,
storage/sqlite and testing APIs are imported; no private dist imports. Instantiate
AssistantMessageEventStream from its value subpath, not the root type export.
Version checks read package.json by file URL, not an unexported package subpath.
Host imports resolve to this worktree's `runtime/`: canonical request hashing,
EffectIdentity, real service-work/terminal adapters and InMemoryEffectPayloadResolver.
Host and candidate graphs remain separate; only JSON data crosses that boundary.
The engine is source-only and inactive, not shipped by the root package's file list.
Importing its entrypoint may read host configuration, but does not open storage,
spawn processes, register an engine or access the network. The root terminal runtime has the
optional guard described below; no schema, root dependency/pin, production flag
or production registration changes.

## Verified evidence and limits

`/workspace/reviews/durable-1650/candidate-final.log`: **79 pass, 0 fail,
577 assertions / 4 files**: Memory/safety/provenance **13**, SQLite **33**,
host handoff **7**, migration **26**. Counts are tests, not parent acceptance gates.
Root EF-S02: **85 pass / 1,173 assertions** (`commit-fence-root-tests.log`). Root
full run: **6,960 pass, 74 skip, 1 fail**, unrelated note-retrieval release fixture
`limit_exceeded` (`root-ci.log`); focused rerun **1 pass / 94 assertions**
(`note-rerun.log`). Parent will repeat the full run; this is not a green full-suite claim.

- Memory coverage: synthetic owner check before allocation; paused open and
  read-only observers execute nothing; abort, scheduling, dispatch-time model/tool
  permission and synthetic effect gates. Host hashing rejects changed-content
  requestId reuse; upstream dedup alone does not. Cancelling wait leaves placed
  work alive; submission.abort withdraws queued, not already-placed work.
- SQLite: public storage conformance, async facade isolation/rollback/close, disk
  Harness answer/requestId/cancellation persistence and no unsafe-tool replay.
  Real host EF-S01/EF-S02 cover acceptance before submit, lost acknowledgements,
  dedup, one reply/frontier consumption, and cancellation beating a late answer.
  Held operation reads reject stale claim/bind after takeover.
- **Qualified narrow commit guard:** optional root
  `TerminalSettlementAdapterRuntime.validateOwnership` is synchronous before and
  after apply inside `BEGIN IMMEDIATE`; only exact `true` permits commit.
  False/nonboolean/throw yields owner_conflict and rollback. No-hook existing
  callers are unchanged; committed replay bypasses the guard as observational.
  Held **actual InMemoryEffectPayloadResolver** takeover with the guard has no
  SQL effects. Root tests cover rollback, throw/nonboolean and committed replay.
  This is an available adapter hook, **not production ownership registration**.
- **NOT ADMITTED negative controls:** bare and entry-`before_effect`-hook cases
  deliberately publish stale output during payload await; the entry hook runs
  before that await. A post-return fence cannot undo committed SQL. Passing these
  regressions is expected, not proof of production ownership safety.

## Bounded copied-history evidence

`migration.test.ts` uses copied public Pi 1.2.0 legacy JSONL and actual public
Pi 1.3.0 `Conversation.context().messages`, with **8 model-message equality
comparisons**: known baseline, compaction, two forks before/after continuation,
reset/replacement baseline and SQLite reopen. The original lane tests narrow
atomic import/retry/replay and fail-closed rejection; advanced support is a
separate selected-path fixture, not a general importer. Bounds are fixed small
fixtures (**1..10 records**), not full history. No add-on restore, arbitrary-depth
or multi-checkpoint tree, general context-edit/custom-message/extension-state
migration is qualified. Missing host-only baseline is explicitly **BLOCKED**;
JSONL-only equality must not invent or claim recovery of host instructions.

## Review decision

**Partial foundation only; D2 ownership remains NOT ADMITTED.** A persisted real
owner/lease must be acquired **before open** and gate all effectful progress,
including submit/wait and automatic scheduler dispatch. Current ownership is a
fixture: open precedes its generation row, same-generation callers both pass,
and generation takeover does not revoke the old synthetic dispatch boolean.
The commit hook does not supply that missing ownership framework.

Host DB disk reopen uses an actual new connection in the **original process**;
the payload resolver Map survives. Candidate hash Maps/counters are also in
memory. Reopen is graceful close/reopen, **not SIGKILL**, power-loss or
multi-process crash qualification; no exactly-once external-effect guarantee.
For verified 1.3.0 source, read-only `Conversation.commit` returns at
`writes.length === 0` before storage commit/publication: it neither publishes,
notifies listeners nor wakes the scheduler. Serialized status/answer reads are
not an atomic snapshot; Memory-only evidence is not host EF-S02.

No production registration, real owner-before-open lease, schema/pin changes,
live provider/effect, service restart, commit or push. No all-45-qualified or
goal-complete claim. Parent publication should explicitly scope a **partial
foundation**, use **Refs #1650**, not **Fixes #1650**; full implementation and
production migration approval remain open.

## Next slice: Linux owner-before-open prerequisite (separate scope)

The preceding first-slice verdict and evidence are retained unchanged. New
`ownership.test.ts`, `src/ownership.ts`, and `src/ownership-child.ts` qualify a
**disposable one-chat/file test backend**, not production ownership. The package
script now includes this fifth test file.

`TestOwner.acquire` uses a raw Bun SQLite connection and `BEGIN IMMEDIATE` to
acquire an owner row in the same candidate file **before** constructing public
storage/Harness. Identity includes Linux boot ID, PID, `/proc/PID/stat` start ID,
fresh nonce and generation. A live process (including SIGSTOP) is never stolen;
there is no TTL. Replacement requires explicit release after close/drain or
verified missing/reused PID/previous boot. Inaccessible `/proc` fails closed;
a zombie remains busy until reaped. This assumes one trusted Linux PID namespace,
local SQLite and no path aliases/untrusted raw owner-table mutation. It does not
choose production chat/store granularity.

`OwnedSqlite` reuses the existing facade queue. All SQL operations check the
owner in the same SQLite transaction before callback and before commit. A
read-locked snapshot cannot be replaced by a competing writer and still commit
stale writes; SQLite lock/snapshot conflicts fail rather than authorize takeover.
The end check also rolls back an owner-token change made inside the callback.
The prior `BunSqliteDatabase` and boolean fixture implementation are unchanged;
this backend supplies an authoritative getter to the existing dispatch gates.

Tests cover two actual child contenders (only one allocates/opens Harness),
SIGSTOP refusal, SIGKILL/reap recovery of an actual pending request, paused reopen
before explicit model resume, same-process duplicate rejection, exact-token
revocation, stale public storage open before migration/normalization, SQL rollback,
and held old synthetic model/tool denial at actual dispatch. Raw live revocation
is fault injection, **not** an admitted living-writer replacement API. Child
processes have a small environment allowlist, isolated path/argument guards and
only keyless synthetic provider/tool code; no real provider or environment tools.

Inspected existing user/session ownership, process-local MCP admission epochs,
EF-S05 outbox deadline leases and EF-S02 commit guard. None supplies exclusive
candidate storage ownership before open. Existing queue and dispatch gates are
reused; outbox scheduling is not replaced. The actual host EF-S02 optional guard
is still not registered in production, and this slice does **not** prove an owner
read in one file atomic with settlement in another. The transaction rollback test
uses a synthetic settlement table, not the actual EF-S02 publication path.

`/proc` must faithfully expose the same trusted PID namespace. Under hidepid,
mismatched proc mounts or namespace visibility restrictions, ENOENT cannot be
trusted as evidence of death; this fixture must not be used in those conditions.
Release remains a caller-enforced close/drain contract. Parent death is not proof
that arbitrary external tool children have exited.

**Partial prerequisite only: production D2 remains NOT ADMITTED.** Synthetic
synchronous dispatch checks do not make external model/tool effects atomic and
do not qualify arbitrary surviving child tools. Explicit release requires the
caller to close/drain Harness/storage first. No public protocol, native package,
platform abstraction, production schema/pins, root source, services or profile
changes. Detailed receipt: `/workspace/reviews/durable-1650/ownership-checkpoint.md`.

## Cross-store process-death qualification

`cross-store.test.ts` adds five cases. The combined package receipt is 90 tests,
698 assertions, zero failures across six files; strict typecheck passes.
Separate disposable host/candidate SQLite files survive SIGKILL after accepted,
submitted, answered and terminal/lost-ack boundaries. Recovery acquires the host
owner and binds the incarnation before opening the paused candidate. It verifies
one real EF-S02 terminal commit, one transcript answer, one outbox intent and no
re-execution of a committed synthetic answer. Revocation during held payload
resolution is checked inside the actual host settlement transaction.

These are post-boundary kill windows, not arbitrary mid-commit crash coverage.
The file counter records synthetic model admission, not paid-provider effects.
The outbox test proves intent persistence, not delivery. Host ownership is not
an atomic cross-file write fence: recovery refuses live-owner takeover and waits
for confirmed/reaped child death. Arbitrary surviving external tools, general
migration and production admission remain unqualified. Independent source review
cleared this increment within those boundaries; #1650 remains incomplete.

## Host model and tool policy ports (qualification only)

The combined candidate suite now passes 145 tests, 1,036 assertions across nine
files, plus strict TypeScript checks. These counts supersede earlier totals.

`host-models.ts` adapts only approved physical chat models through the actual
1.2 host ModelRuntime. Credentials, provider URLs/headers and auth mutations stay
with the host; the 1.3 catalog receives JSON metadata and static errors. Tests
exercise successful streaming/tool/thinking data, denied approval/budget, held
authentication revocation, logout and no alternative-account fallback. Deferred,
image/classifier and login-control operations deliberately reject. **Accepted
limitation (operator decision, 2026-10-16):** public `transformHeaders` is awaited
before provider invocation. The negative test demonstrates that revocation in
this narrow interval can still invoke a provider with an aborted signal. This
is not proof of a sent request or charge. Keep approval/budget checks and abort
signals; do not wait for upstream or add a dependency patch for this race alone.
The strict zero-provider-call guarantee remains unproved. This decision does not
waive other ownership, effect-fencing or migration requirements.

`host-tools.ts` preserves prepared arguments, text/images, details, explicit
errors and progress acknowledgements. Throwing callbacks produce static errors
without private causes. Registration snapshots the schema and approved callbacks.
Replay defaults to unsafe; structured/nested tool definitions remain unsupported.
The host effect port must recheck authority at every actual effect after awaits;
a pre-tool check alone is not a security boundary.

The opt-in root tracked-bash `validateSpawn` check runs after asynchronous cwd,
environment/keychain work and immediately before each spawn, including fallback
candidates. Only synchronous literal true authorizes; invalid async results are
observed but never authorize. Existing callers are unchanged. `host-bash.ts`
uses invocation-local tracked operations; progress failures abort the owned child,
suppress later updates and expose only static errors. Tests use actual disposable
local shell effects, child cancellation and unsafe replay/reopen boundaries.
This does not qualify SSH, filesystem tools, MCP effects, arbitrary child trees
or provider dispatch. The untouched SDK local runner's late-spawn limitation is
retained as a negative control. No production port is registered.

## Actual Plan factory and hidden context lifecycle

Set `DURABLE_ADDONS_ROOT` to the pinned piclaw-addons source (commit
`de92bc95b5b3bb1505beec9617d3b8a5e4fa92d3`). CI checks out that source separately
without persisted credentials. `plan.test.ts` verifies Plan 0.1.25 and executable
source hashes; absent or mismatched source fails rather than silently skipping.

The combined suite now passes 148 tests, 1,146 assertions across ten files,
plus strict types. Actual Plan registration/preparation, existing-chat KV,
cross-chat denial, fork storage separation and fresh context are exercised.
A real Pi 1.2 SDK baseline demonstrates why request-local projection alone is not
hidden-message persistence, and why committing a hidden message after request
capture alone misses that request. The positive public-API path commits and
projects once per explicitly accepted run: two immutable snapshots across four
provider user-message histories match the SDK fixture; tool rounds do not
refresh snapshots. Persisted requestId-to-entry bookkeeping survives cooperative
interrupted-hook reopen using an externally retained submissionId. Fork and
SQLite reopen retain the snapshots.

This is a serial, explicitly correlated qualification fixture, not a generic
ExtensionAPI runtime. It does not discover unknown recovered operations, prove
concurrent admission, preserve every system/tool context, qualify SIGKILL in the
Plan hook, or support general add-on lifecycle migration. The narrow model-provider admission race is an accepted limitation; the other
activation requirements above remain open. No production Plan adapter is
registered.

## Composed copied-chat fixture

`vertical.test.ts` composes the real host 1.2 ModelRuntime, candidate model bridge,
actual pinned Plan tool, guarded local tracked bash and real EF source/claim/
terminal stores. Two copied legacy messages and existing host branch/timeline
rows remain intact; the Plan snapshot stays fixed during tool rounds and changes
for the next accepted operation. Cancellation during held authentication admits
no additional synthetic model or tool effects. Terminal replay is idempotent.

The combined suite has passed 149 tests / 1,360 assertions; after strict type
integration and admission-contention normalization, the final focused owner +
vertical run passed seven tests / 241 assertions and types. A SQLite busy timeout
on contender admission is a fail-closed `owner busy` result, not permission to
allocate or steal. The contender's zero-allocation invariant is unchanged.

This is one serial fixture, not the production importer or extension bootstrap.
Its fake provider checks authority cooperatively, so the real provider admission
gap remains. No exhaustive database/log secret audit or cross-file transaction
fence is claimed. Original chat/branch retention is tested on copied synthetic
data only. Independent review cleared this bounded composition.

## Reusable copied linear-history importer

`src/legacy-import.ts` exposes `prepareLegacyImport` and `importCopiedLegacy` for
copied, quiescent linear v3 histories, explicit persisted baselines and stable
host chat/incarnation/branch bindings. Defaults are 1,000 entries and 8 MiB;
limits are caller-overridable and reject the entire input without truncation.
Entries, original audit records, source hash and manifest commit atomically.
Repeated identical input is idempotent; changed source or binding is rejected.
A 100-record public-SDK context-equivalence case extends the small fixtures.
Non-finite JSON numbers are rejected before cloning/projection. Scalar inputs and
limits are snapshotted once, so callbacks or delayed commits cannot change the
identity associated with the hash. The projection callback is a trusted host
bridge, not an authentication boundary. Hash identity is intentionally sensitive
to the exact copied source bytes, including newline changes.

The combined suite now passes 162 tests with types. Independent judges cleared
the importer after overflow and input-mutation regressions. This module still
requires caller drain/ownership and final storage fencing. It rejects nonlinear
full-tree histories, unsupported record semantics and missing baselines; large
transaction performance and general migration are not qualified. No production
importer is registered or allowed to touch existing live history.

## Restartable copied branch-tree import

`importCopiedLegacyTree` validates an entire rooted single-file v3 tree before
writing: all source entries and leaves, explicit host bindings/baselines, bounds,
cycles, missing parents and unsupported semantics. Default limits are 16 leaves,
1,000 entries and 8 MiB. Shared ancestry is imported once, with original IDs and
public durable fork checkpoints retained, including the positional baseline
following compaction. Source and detached binding hashes reject changed retries.

Public `Tx.forkConversation` cannot fork entries appended in the same transaction.
Each branch therefore commits fork, suffix, binding and root progress atomically;
repeated import resumes from that manifest. A real post-commit lost-ack test
reopens and verifies no duplicate forks. Partial destinations stay offline until
complete: this is per-branch atomicity, not whole-migration atomic visibility.

The full isolated suite passes 179 tests / 1,831 assertions across eleven files,
plus strict types. The tree module has 17 new cases and independent source-review
approval. This remains quiescent copied-history qualification with caller-owned
drain and final fencing, not live upgrade, production importer registration,
add-on-state conversion, or rollout approval.

## Observation-only host projection

`host-projection.ts` maps public durable observations through the actual EF-S08
sink to existing bounded `agent_draft` payloads. Explicit accepted submission and
host operation bindings, owner/watch-generation checks, ordered receipts and a
required sanitizer remain authoritative. Snapshots reset drafts; text is accepted
only from public generation snapshots or live text deltas. Ambiguous appended
assistant `message_start`/`message_end` text is ignored. Final-only text remains
settlement-owned. No invented thinking phase, terminal commit or delivery intent
is produced by this observer. Serialized publications are limited to 65,536 UTF-8
bytes, including escaping and metadata.

The complete candidate suite passes 188 tests / 1,865 assertions across twelve
files plus strict types. Nine projection tests include real public watch events,
actual host sink, a forged assistant-bearing write during a held tool round,
matched/unmatched/overflow snapshots, stale identities and UTF-8/escaping bounds.
The source judge cleared the corrected bounded adapter. This is not a browser
transport proof or complete thinking/tool/rich-message projection, and it does
not grant settlement authority to a watch or complete #1650.

## Actual host-service add-on round trip

`addon-host-services.test.ts` hash-pins the actual Code Review 0.1.8 and Remote
Peer 0.3.6 factory closures, copies them below the isolated candidate without the
companion checkout's node_modules, and verifies dependency resolution. Public
durable Harness calls the actual registered `code_review.dispatches` and
`remote_peer.status`, persists results, and reopens without repeating tool or
model execution. Host ALS supplies the invocation-local capability; wrong-chat
and nonowner mutations are denied without changing the inspected service tables.
The combined suite passes 189 tests / 1,928 assertions across thirteen files and
types. Independent source review cleared this bounded path.

The private test package pins Iroh 1.1.0 and its Linux x64 GNU binary explicitly;
Bun did not materialize that transitive optional package from the upstream parent
lock entry. This is a Linux qualification prerequisite, not a production change.
Remote transport remains disabled: no paired permissions, network send, live
accounts or authorized review execution is qualified. JSON projection removes
undefined metadata and is not a lossless preservation claim. This is not complete
compatibility for either add-on or all installed add-ons.

## Actual Delegate host-context qualification

`delegate.test.ts` hash-pins the real Delegate 0.2.20 factory and runs its registered
tool through the host bridge and public durable Harness. Private fixture SQLite
approval starts deny-all; only the named fixture model is approved. A synthetic
child executable exercises actual Delegate selection, JSON output parsing,
thinking inheritance, `--no-session`, `--no-extensions`, read-only tool flags,
persisted result/reopen without replay, pre-abort, setup deadline and owned POSIX
process-group cancellation. No real provider, credential or MCP server is called.
Late-update coverage explicitly invokes a retained callback after completion.
The dead process cleanup target is removed after confirmed termination.

The combined suite passes 190 tests / 1,997 assertions across fourteen files and
strict types; source judge cleared this bounded path. Focused Delegate/model
regressions also pass after the cleanup correction and accepted-risk relabel.
This is not full Delegate activation or child authentication/MCP/fallback parity.
The operator accepted the narrow provider-microtask race on 2026-10-16; retain
its negative test and existing cancellation checks rather than patching the SDK
or waiting for upstream. No other migration or effect guarantees are waived.

## Scheduled agent occurrence handoff

`host-scheduled-run.ts` reuses the real scheduler/EF-S07 occurrence, source,
lease and settlement authority. Duplicate dispatch calls share one promise;
non-agent/shell tasks are rejected rather than moved onto a new path. Required
live task-head reads reject revision changes and pause before dispatch and after
results, even while the original occurrence lease remains valid. Nine scheduled
tests cover the real root path plus six explicit revision/pause probes. The
combined candidate suite passes 199 tests and types; source review cleared this
bounded increment.

These are observational checks, not atomic dispatch authorization. Pending-edit
probes explicitly call `check()`; they do not prove automatic cancellation on
every edit before renewal. The new probes isolate bridge rejection, not the
legacy runner's error-log catch path or all delivery fencing. An old occurrence
may retain an accurately attributed failure audit; it must not be described as
proof of no stale logs. Root EF-S07 remains responsible for atomic completion
and successor advancement. Dedicated-conversation fixtures do not qualify the
production main-chat save/restore or a registered durable scheduler adapter.

## Host image and classifier operations

The model bridge now supports explicitly approved image/classifier models through
the host's public `getModelOfType`, `generateImages` and `classify` methods. Catalog
keys include model kind, so shared IDs do not cross operation boundaries. Host
credentials remain host-owned; catalog/results expose only selected JSON fields.
Public and direct-provider calls reject callbacks, auth overrides, invalid JSON
options and retry widening before host dispatch. Held-auth policy/budget/cancel
cases use actual host ModelRuntime with synthetic providers. The accepted
post-auth microtask limitation remains; deferred and login-control paths still
reject. This supersedes the earlier chat-only description for these two paths.

The complete candidate suite passes 225 tests / 2,436 assertions across fifteen
files and strict types. Independent source review cleared the corrected public
preflight and option-isolation boundaries. No live image/classifier accounts,
paid operations, production registration or whole-migration acceptance is claimed.

## Host deferred-operation references

Deferred requests are opt-in through required host reference authority. Raw
provider handles and conversion data remain host-owned; only sanitized public
references cross into candidate state. Fetch and cancel validate exact model,
provider, handle scope and current authority before host credential resolution.
Cleanup cancellation has a separate explicit owner grant and can remain allowed
when spending permission is withdrawn. Missing authority fails closed.

The bridge delegates stream/fetch/cancel to actual host public ModelRuntime APIs.
Public preflight snapshots model/handle/options before factory authentication;
all subsequent checks use the immutable approved catalog model. Regression tests
mutate caller objects during authorization/auth pauses and verify no substituted
model dispatch. Private handles, callbacks, auth overrides and non-JSON options
are rejected; failures remain static and no alternate account is selected.

The combined candidate suite passes 273 tests / 4,464 assertions across fifteen
files, with 93 focused model cases and strict types. Source review cleared the
model-mutation fix. Bridge recreation uses the same retained host authority;
production/process-persistent handle authority and whole durable recovery remain
unqualified. The accepted provider-call microtask limitation is unchanged.

## Inactive host conversation runtime

`host-runtime.ts` exposes explicit open/submit/cancel/reconcile/settle/close over
public Harness APIs and real host acceptance/settlement ports. It opens only
manifest-listed conversations after ownership assertion, with injected models,
registry and fenced storage; it does not create a default chat, queue or engine
registration. Host-owned durable bindings are required. Passive reconciliation
never starts work. Any progress permission must cover all recovered work in the
ownership domain, not just one task.

Input and cancellation identities, nested effects, manifest and port/callback
references are captured before awaits. Host policy remains live behind captured
callbacks. EF-S01 owns cancellation version checks and replay, so a lost
acknowledgement or denied progress can retry the same sealed request after reopen.
Queued work can be withdrawn; already placed work reports `already_placed` and
is not escalated to conversation-wide abort. Successful close precedes release;
non-cooperative providers/tools do not have a bounded-close guarantee.

The candidate suite passes 283 tests / 4,587 assertions across sixteen files and
strict types; ten runtime regressions cover immutable bindings, cancellation
recovery, passive reopen and cleanup. Source judges cleared the corrected code.
Production schema/correlation setup, exact running-task cancellation, general
multimedia settlement and engine bootstrap remain inactive/unqualified. This is
an implemented reusable integration seam, not completion or deployment of #1650.

## Controlled inactive cutover

`host-cutover.ts` records one explicit writer choice in a caller-owned manifest.
Initialization is separate; no production schema, engine bootstrap or admission
hook is installed. Preparation persists intent before idempotent copied import;
verification and writer switching require matching owner/revision, source digest
and zero accepted-pending/inflight work, rechecked in the SQL transaction. Partial
candidate data stays offline. Exact retries after lost acknowledgement do not
create duplicate branches.

Rollback before new candidate work can select the source again. Once new accepted
work is recorded, rollback is blocked and its records are preserved pending real
reconciliation/reverse conversion. There is no silent discard or promise of zero
downtime. The caller must enforce the manifest at actual admission/effects; a
stored marker alone does not enforce a single writer.

Six cutover cases use actual copied SessionManager tree import, rollback/reopen,
mutation, competing revisions and final drain/digest checks. The combined suite
passes 289 tests / 4,717 assertions across seventeen files and strict types.
Independent source review cleared this inactive boundary. General cutover wiring,
post-new-work rollback and production activation remain incomplete.

## Cutover/runtime admission composition

`cutover-runtime.test.ts` combines the actual copied importer, controller,
inactive runtime and real EF stores. New source admission uses the optional
EF-S01 `validateAcceptance` seam inside its SQL transaction before and after
mutation; old committed request replay remains observational. A stale caller
cannot cross the writer flip after awaiting. Candidate admission records a
conservative work intent before async acceptance, preventing unsafe rollback
through an acknowledgement gap. Pending/inflight work blocks flipping, rollback
denies candidate scheduling, and accepted cancellation suppresses a late answer.

Both EF-S01 acceptance and EF-S02 settlement hooks require exact synchronous true.
Invalid promises/thenables are observed but never awaited or authorized; errors
are sanitized and rollback includes decision/counter writes. Focused root boundary
verification passes 118 tests; the candidate suite passes 293 tests and types.
Source review cleared the corrected composition. This is still an inactive
caller-enforced writer contract, not production ingress wiring or a cross-file
transaction. Arbitrary external effects and reverse conversion remain outside it.

## Exact running cancellation boundary

Public 1.3.0 transactions can inspect submission/run/task association atomically,
but cannot mark task abort in that same transaction. A separate `abortTask` call
leaves a window for steers to join the run; calling it inside a transaction would
deadlock the mutation line. The runtime therefore does not use a read-then-abort,
raw task write or conversation-wide fallback. Placed input remains `already_placed`.
An additional public-API regression proves repeated cancellation of A neither
aborts its task nor withdraws queued successor B; EF-S01 cancellation replay does
not increment its version, and a late answer is suppressed at host settlement.
Eleven runtime tests / 146 assertions and types pass. This explicitly remains
missing running-cancellation support, not successful cancellation qualification.

## Host-private reasoning and authorized media settlement

Final text may include thinking blocks in the underlying assistant message.
Reconciliation retains that immutable message as host-private evidence but
extracts only visible text by default. The optional captured `materializeAnswer`
port may provide host-authorized content, content-block references and media IDs;
actual EF-S02 validates those payload/media bindings. The port is trusted output
authorization, not a generic redactor. Its exceptions are static, returned refs
are detached, and owner/version/cancellation are rechecked after preparation and
again by the transactional settlement boundary. Cancellation retry publishes no
answer. Orphan material cleanup remains the host materializer's responsibility.

Public final image/tool-call message shapes not supported by the assistant API
are rejected, not silently flattened. The combined suite passes 314 tests / 4,931
assertions across eighteen files plus strict types. Source review cleared this
inactive rich-output path; no production materializer is registered.

## Application-owned inactive engine package

Reusable modules now live in `runtime/durable-engine`, not the qualification
fixture directory. That private package owns the exact 1.3.0 dependency graph.
Qualification imports engine-scoped public re-exports; it does not install a
second candidate graph. Clean frozen installation, transitive ESM realpaths and
export object identity are checked. Install/typecheck the engine package first,
then install and run qualification. Root Pi 1.2 dependencies remain unchanged.

The extracted candidate suite passes 315 tests / 5,133 assertions and both package
typechecks. The full root gate passes after staging moved-file deletions so its
Git-based entrypoint audit sees the final tree. Source review cleared the move.
Importing the entrypoint does not open the execution store or register an engine;
root configuration modules may still read settings during import. This package
is source-only and excluded from the current root distribution: it is not yet a
production packaging, installation or activation claim.

## Concrete host correlation adapter and safe acknowledgement repair

The application package now exports an explicitly initialized SQL binding adapter.
It records immutable host/store/chat/branch/operation/source/request/conversation
identity and payload references, not another prompt-content store. Ownership is
checked in its transactions; submission IDs use unique compare-and-set rules.
Runtime and cutover fixtures use the concrete adapter.

Request ID alone is not evidence of the submitted content. Runtime adoption reads
public queued inbox or placed-entry evidence in a transaction and verifies both
the original content hash and complete `host.accepted` metadata before recording
an ID. New inputs carry that metadata separately from unchanged model-visible
content. Unknown/legacy submissions, including same-content collisions, cannot be
automatically adopted. Withdrawn records lacking input evidence require an already
verified immutable host binding. This correlation metadata assumes an exclusively
host-owned Harness; it is not authentication against arbitrary writers.

The combined suite passes 336 tests / 5,312 assertions across nineteen files;
focused binding/runtime/cutover tests pass 56 / 516 and both package typechecks
pass. Source review cleared the collision correction and concrete adapter.
General migration must resolve or reject unknown legacy pending ownership; this
is not production schema initialization or admission registration.

## Runnable copied-store rehearsal

The application package provides a source-only rehearsal command; see
`runtime/durable-engine/REHEARSAL.md`. It accepts an explicit copied JSONL file,
strict hash/binding/baseline/quiescence manifest and a new destination. All
preflight checks precede storage creation. Import stays paused and is closed and
publicly reopened for verification. No provider, tools, production store or writer
switch is activated. Private receipt/manifest artifacts distinguish incomplete
from complete rehearsals. Source-copy truth and filesystem trust remain caller
preconditions, not a hostile-filesystem sandbox.

Three subprocess CLI tests exercise four-leaf context/identity preservation and
fail-closed input/path/non-quiescence rejection. The full candidate suite passes
339 tests / 5,377 assertions across twenty files and both typechecks; independent
source review cleared the bounded command. This does not qualify installed
production packaging or a live cutover.

## Existing queue dispatch and observation cleanup

An internal default-off worker hook maps the committed ordinary message row to
its accepted source and claimed operation before dispatching through the host
adapter. It uses the existing per-chat queue and never falls back to legacy after
selecting accepted work. No public engine flag or production registration exists.
Commands, follow-ups and steers are not silently redirected.

Uncertain completion retains the existing inflight identity. A captured host
reconciliation-event port requests fresh fenced SQL reads; only matching terminal
operation/source/frontier evidence releases the original callback. Shutdown
releases observation without clearing pending identity. The host must connect its
shutdown signal and race-free outcome events; no second queue or timer is added.

Runtime wait cancellation covers authorization and lookup as well as the public
submission wait. Close aborts observations before draining and closing resources;
late continuations cannot schedule, and failed cleanup does not release ownership.
The candidate suite passes 343 tests and types. Hosted CI explicitly reruns the
real HTTP-to-engine integration after installing the private engine; a missing
prerequisite fails rather than silently skipping. This is ordinary-input inactive
integration, not full steering, running cancellation or activation acceptance.

## Accepted queued follow-up identity and materialization

Host-only, default-off callbacks can atomically bind queued ordinary input and
its EF source using the existing SQL admission transaction. A private persisted
source UUID—not the reusable numeric UI row ID—identifies that input. Accepted
materialization preserves it as the timeline message ID and retains the same
source sequence/reference through existing worker dispatch. Payload/collision
checks and callback failures roll back queue consumption, message/media writes
and source effects; accepted work is not discarded at the legacy retry limit.

Accepted items reject unsupported removal/steering, payload replacement and
reordering before effects. Materialization retry increments remain supported.
Idle-to-busy steering fallback is excluded from ordinary source acceptance. UI
numeric allocation may contain harmless gaps after rollback; durable UUID identity
and committed source sequencing remain correct. No alias table or second queue
is added. Root qualification passes 7,084 tests plus 25 and 9 feature/build tests;
source judge cleared this bounded slice. Actual required-engine tests cover
queued HTTP-to-worker settlement and lost acknowledgement. Queue cancellation,
edit/reorder policy and broader steering are still activation requirements.

## Atomic withdrawal of unclaimed accepted queue input

A host-only optional queue-remove port now disposes the exact pending, unowned
queued source and removes its queue row in the same transaction. The original
source remains as `disposed` / `host_cancelled` audit evidence. The concrete
source-store method requires the owned connection, active transaction, explicit
writer fence and immutable source/hash/reference match. Idempotent decisions are
versioned. Claimed or materialized work cannot use this withdrawal operation.

Contiguous closed-source frontier calculation is shared with terminal settlement:
withdrawal cannot skip an open source, and an active operation retains its
frontier until settlement. Explicit queue removal alone gets withdrawal authority;
steer/drain/edit/reorder do not inherit it. Missing registration still fails closed.
Callback failures roll back both sides and private selector errors are sanitized.
Focused withdrawal/lifecycle/HTTP verification passes 68 tests / 799 assertions;
independent source review cleared the bounded operation. No production callback
is registered or schema initialized by this change.

## Accepted input attached to an existing host operation

The concrete source store can attach an existing queued source to the exact active
host operation in a caller-owned transaction. Source identity/sequence/hash remain
unchanged; version and running harness correlation are checked, and old terminal
attempts become stale. No new source or queue is created.

The inactive runtime has separate immutable intent bindings, submits accepted
intents with public steer placement, and refuses settlement until every claimed
input is bound and done. Idle continuation is still the same host operation—not
an exact physical-generation targeting claim. The host store now has an explicit
versioned finishHarness transition, so successful tests no longer change host
phases using raw SQL. Latest-answer selection cannot refresh the initial operation
version fence: newly attached inputs invalidate that entire settlement attempt.

Candidate qualification passes 349 tests / 5,460 assertions and types. Source
review cleared the corrected version race and bounded lifecycle. The queue-steer route now accepts an optional, host-only coordinator. It is not
registered by default. The coordinator attaches the accepted source, materialises
its timeline row and consumes its queue row in one transaction, then dispatches
the same identity through `submitIntent`. Lost acknowledgements retain claimed
work for explicit host reconciliation, never legacy replay.

Actual HTTP-to-engine tests cover held primary plus queued input, rollback after
attachment, finished-target rejection, duplicates and lost acknowledgement with
explicit reconciliation: 124 focused tests / 1,149 assertions. The root gate passes
7,142 tests (74 baseline skips), plus 25 feature and 9 build tests. Independent
diff review cleared this inactive slice. An installed recovery controller and
pending-intent restart/reopen remain unqualified. This does not qualify exact
running cancellation or complete #1650.

### Pending intent clean-close/reopen rehearsal

Disk-backed tests close both stores, acquire replacement ownership, reopen paused
and reconcile the retained accepted identity. They cover attachment before intent
submission and submission committed before acknowledgement loss. The second case
captures the committed public submission ID before close and requires the same ID
after reopen. A synchronous provider-entry observation runs before the hold, so
paused-open and completed-retry checks cannot hide dispatch behind that hold.
Public request records and binding snapshots remain unchanged on completed replay;
settlement produces one host terminal commit and one answer.

The two tests pass 80 assertions; the full candidate suite passes 351 tests /
5,540 assertions across 21 files, with types and bounded independent review clear.
This is a synthetic, same-process cooperative close/reopen rehearsal. It is not
SIGKILL recovery, provider exactly-once execution, or an installed production
recovery-controller qualification.

The same recovery fixture also covers two real child-process SIGKILL boundaries:
after attachment before submission, and after submission commits before its
acknowledgement. The child retains ownership until killed; replacement ownership
is acquired only after confirmed death and before storage construction. Recovery
preserves the checkpointed identity and, where committed, the submission ID.
These are two fixed post-commit windows, not arbitrary crash placement.

Full candidate verification now passes 353 tests / 5,630 assertions. The combined
recovery/ownership suite passes 10 tests / 197 assertions in each of three final
repeats, and types pass. An earlier unchanged ownership-contender test returned
zero admitted contenders before a passing rerun; the cause remains unknown.
Bounded independent review cleared the crash-window tests. Production controller
integration and general cutover/rollback acceptance remain unqualified.

### Passive accepted-work discovery

`reconstituteAcceptedWork` scans persisted open operations and their claimed
sources under an existing owner while the runtime remains paused. It preserves
bound request IDs and requires exact persisted `queue_input` intent evidence for
both bound and unbound steering inputs. A final await-free check rereads operation,
source and intent snapshots. Missing or altered evidence rejects discovery.

The helper returns identities only: it does not authorise, submit, settle or resume
work. Owner-before-open factory composition, whole-domain authorisation, worker
wake-ups and shutdown wiring remain incomplete. The trusted host reader must load
persisted message bytes and validate accepted payload references.

Review caught missing intent authority in the initial implementation; real-SQL
negative tests now cover missing and altered evidence before and after asynchronous
reads. Candidate verification passes 355 tests / 5,745 assertions across 22 files,
with engine and qualification types passing. Root fast CI completed 7,143 tests
(74 baseline skips), plus 25 feature and 9 build tests. Standalone root typecheck
still reports nine untouched frontend baseline-diagnostic differences; it is not
claimed green. Independent review cleared the bounded passive helper, not a
production controller or permission to resume.

### Explicit owner-first controller

The directly imported `createHostController` factory acquires host ownership before
creating candidate storage and opening the Harness paused. It composes passive
host discovery with public candidate reconciliation, validates the whole pending
submission/task domain and rejects unknown inputs or independent/background tasks.
Recovered unbound intents remain explicit retry work; authorisation reloads their
bindings. It does not automatically dispatch or resume work.

Shutdown seals admissions and joins observations before closing Harness/storage
and releasing ownership. Failed or uncertain storage close retains the owner.
Actual-engine tests cover ownership ordering, paused recovery, retry/deduplication,
unknown input and real background-task refusal, callback capture, failed bootstrap
and close failures during bootstrap/shutdown. Focused tests pass 8 cases / 162
assertions; full candidate verification passes 361 tests / 5,792 assertions across
23 files. Engine/qualification types and root fast CI pass; independent bounded
source and additional-test reviews are clear.

The factory is not registered or activated. Trusted adapters still supply actual
exclusive ownership and accepted message reads. Worker wake-up/retry integration,
production cutover and automatic existing-history migration remain incomplete.

### Explicit retry and existing-worker notification

The opt-in `createDurableRecoveryDispatch` bridge retains uncertain intent
identities and joins concurrent retry calls. It uses the same accepted request ID
through public submission/binding repair; failed attempts retain identity. The
controller's explicit `reconcileRecovered()` rediscovers persisted work before
retrying unbound intents and does not replay primary turns or implicitly resume.
The existing queue observer subscribes before checking terminal SQL evidence and
cancels the observation on completion, avoiding a lost reconciliation wake-up.

Worker integration passes 47 cases and controller qualification passes 6 cases.
Full candidate verification passes 361 tests / 5,796 assertions; root fast CI
passes 7,143 tests (74 baseline skips), plus 25 feature and 9 build tests. Runtime
and private-engine types pass; aggregate typecheck retains the unrelated audited
frontend-baseline failure. Independent review cleared the bounded changes.
The first concurrent full-gate attempt hit two existing materializer tests' five-
second timeouts; the sequential full candidate repeat passed, without changing
those tests or their limits.

Boot-controller and current-worker integration still use separate fixtures. This
is not a combined restart-to-worker qualification, production registration or
activation. No new queue, legacy fallback or restored consumed queue row is used.

### Combined disk reopen through the current queue worker

A combined test now closes and reopens disk stores under replacement ownership,
boots the explicit controller, and runs the actual `AgentQueue`/`processChat`
worker. A test-only fault occurs after candidate submission commits but before
host intent binding is written. The binding remains null across paused reopen;
controller reconciliation repairs the original committed ID without another
provider entry. The worker retains its lane and inflight marker until terminal
SQL/event observation, then releases once. Completed retries retain one answer
and terminal commit; terminal queries are scoped to the operation and chat.

The first published test covered caller acknowledgement loss after binding and
had an unscoped cross-test SQL assertion; it did not prove missing-binding repair.
Both issues are corrected. Full candidate verification passes 362 tests / 5,837
assertions, with types, root static build and independent bounded review clear.
This is cooperative same-process disk close/reopen, not a combined SIGKILL or
production activation qualification. Runtime source is unchanged by this test.

### Copied-byte upgrade preflight (inactive)

`prepareCopiedUpgrade` in `runtime/durable-engine/src/copied-upgrade.ts` binds
actual copied legacy JSONL and the existing rehearsal v1 host-manifest bytes to
independently supplied exact SHA256 digests. It validates the complete tree,
original host identities, persisted baselines and quiescent leaf contexts before
its first possible journal write. It retains immutable input snapshots, not paths
or a caller-mutatable prepared plan. The manifest remains caller-trusted provenance;
this does not infer live source paths, prove copying, or choose new chat IDs.

This fills the concrete copied-input-to-journal gap, not a second checkpoint
framework: it reuses `HostCutoverController.preflight/begin/verify` and the public
restartable tree importer. Existing phases remain source → copying (receipt null
before import acknowledgement, populated afterward) → verified. Exact manifest
bytes participate in the request key, so even a whitespace-only manifest change
cannot silently reuse an existing checkpoint. The helper cannot flip the writer.
Ownership before public storage open, a real source admission fence and authoritative
drain/digest ports remain caller obligations. Public reopen may normalize/write.

`copied-upgrade.test.ts` uses actual copied files and an owned disk store, loses
acknowledgement after public import, closes/reopens candidate storage and opens a
new journal connection. Retry preserves original session/chat/branch/source and
durable IDs with exact public contexts, no duplicate forks, no tasks or effects.
Changed input/digests/provenance/context plans reject; journal/rollback remain
intact. Focused related qualification: 15 pass / 294 assertions across four files;
both private package typechecks pass. No production selector, live profile access,
automatic upgrade activation or post-new-work reverse conversion is added.

Final copied-upgrade verification now passes the full candidate suite: 368 tests /
5,879 assertions across 25 files. Both private-package typechecks pass. Independent
review cleared complete history-derived root/branch mapping verification and the
four committed-storage corruption cases. Standalone root aggregate typecheck
still fails the previously recorded unrelated frontend diagnostic baseline; no
frontend or baseline changes are included in this slice.

### Shared-host rollback frontier guard

The inactive cutover controller records eight shared-host SQL table frontiers at
writer activation. `prepareRollback()` is read-only and reports reconciliation
required when those frontiers change, including accepted work absent from the
optional manual tracker. Missing checkpoint/schema evidence fails closed. The
final rollback transaction repeats frontier, source-digest and drain checks under
the writer fence; denial preserves the active writer and journal.

A real accepted UUID followed by a committed tool result, answer and terminal
settlement blocks rollback before and after completion without manual tracking.
Candidate verification passes 370 tests / 5,936 assertions; focused cutover tests
pass 12 cases / 264 assertions and both private-package types pass. The synthetic
provider fixture now chooses the last dialogue message rather than trailing tool
catalogue metadata, allowing the tool assertion to exercise an actual effect.

Independent review cleared this guard only under the existing complete host drain
and exclusive-owner/runtime authority contract. It does not independently inspect
candidate-only progress or establish candidate-owner quiescence. Unsupported
background activity, incomplete drain adapters or live-owner replacement invalidate
that approval. Production rollback still requires owner-controlled seal/drain and
public candidate progress evidence before writer switching. No activation occurs.

### Explicit candidate-owner quiescence composition (inactive)

The opt-in factory now exposes one-use `controller.rollback(cutover, revision)`.
It seals runtime admissions synchronously, joins host calls, and inspects the whole
public pending task/submission domain. Any live work is refused **before** Harness
close, without aborting accepted work. For an empty domain, the factory now also
requires historical candidate proof **before** Harness/storage close. Because no
qualified proof is available, it refuses the rollback and retains the owner and
open storage; no SQL writer transition or journal mutation occurs. Failed shutdown
retains its cached failure and owner. Ordinary close remains unchanged.

This adds quiescence only, not public historical-progress evidence. In particular,
a completed candidate-only commit absent from the host projection still requires a
trusted persisted activation-frontier comparison, which is not implemented here.
Do not treat this composition as general/production rollback safety. No boolean
approval, proof registry, new journal, migration or activation is introduced.
Factory tests use actual public candidate commits and SQL cutover journals;
the test drain adapter is intentionally bounded, not a production drain proof.

#### Historical-progress fail-closed guard

`controller.checkpointCutover(cutover)` explicitly rejects without changing the
journal. Public pi-durable 1.3.0 Storage has no persistent store-identity getter or
read-only global commit head/history. Entry history excludes generic document
commits; all-task/submission scans expose terminal records but only latest state.
Document scans expose incarnations alive in one exact scope/point, so a newly
created then retired session document disappears from the complete current scan.
Actual public API regression fixtures demonstrate this, plus terminal task outcome
and submission mutations invisible to pending inspection.

`Storage.commit([])` returns a sequence but is itself a durable write, not a
read-only inspection frontier, and supplies no persistent store identity. A barrier
write/identity/crash protocol would need separate qualification. We do not claim
that current snapshots or caller hashes establish historical absence of progress.
Consequently even unchanged factory rollback is denied; host-only controller
fixtures remain unchanged. No optional `candidateProgress` proof is persisted
until its identity, domain and historical coverage can actually be qualified.

Rollback quiescence follow-up: review found that detached wait observers could
finish before an underlying host callback. Rollback now joins raw wait operations
separately; ordinary close retains its observer-detachment semantics. Deterministic
tests cover held callbacks, both close/rollback orderings and actual asynchronous
provider refusal without abort. Focused controller verification passes 8 cases /
190 assertions, full candidate verification passes 372 tests / 6,075 assertions,
and both private-package types pass. Independent review cleared current quiescence
only—not historical candidate progress, production rollback or a shutdown deadline.

## Converged database target

The application target is **one SQLite database and no ongoing JSONL session
files**. JSONL is legacy migration input only. Host admission/lifecycle, queue,
timeline, bindings, cutover state and SDK execution/history keep their respective
authorities within that database; do not add another progress ledger or queue.

`host-schema.ts` now owns the existing host binding/cutover DDL. Its explicit
offline installer verifies FK enforcement, exact supported schema and synchronous
ownership, then installs atomically in one IMMEDIATE transaction. Compatibility
exports remain; incompatible schemas fail closed rather than pretending that
`CREATE IF NOT EXISTS` performs migration. No production auto-install is added.
Root admission/recovery and binding writes share one SDK-free queued-intent proof;
identity, semantic hash and payload membership cannot diverge across those paths.
Cutover work counts are derived from existing work rows.

The single-database qualification opens host and SDK connections to the same
physical file under ownership, exercises primary/intent execution and terminal
commit, then reopens under a new owner preserving IDs and public documents. Both
connections pass FK/integrity checks; file scans reject JSONL and extra database
files. Separate connections do not imply one atomic cross-connection transaction.
Older split-store fixtures remain boundary tests, not the application target.

Factory rollback now refuses unavailable historical progress proof before storage
close/writer transition/owner release. The public API has no qualified persistent
store identity/read-only historical frontier; no incomplete SDK snapshot or new
progress table substitutes for that proof. This remains an implementation gap,
not production rollback acceptance.

Final verification: 378 tests / 6,280 assertions across 27 files and both private-
package types pass. The earlier full run hit six five-second timeouts; sequential
repeat passed unchanged. Root fast CI for the convergence changes passed 7,143
plus 25 feature and 9 build tests (74 baseline skips), before the final test-only
fixture identity/shared-file additions. Independent bounded convergence and shared-
file reviews are clear. No live database, activation or services were changed.

The single-file layout now also has two fixed SIGKILL qualifications: attached
input before submission, and candidate commit before host binding write. The child
holds ownership until killed; replacement ownership follows confirmed death and
precedes host/SDK open. Ordered full SDK entry/submission rows are checkpointed in
the live child and compared exactly after paused reopen, before explicit repair or
resume. Same-ID binding repair adds no SDK records; completion leaves one answer
and terminal commit. Integrity/FK and no-JSONL/no-extra-database checks still pass.

Focused verification passes 7 tests / 387 assertions. Full candidate verification
passes 380 tests / 6,440 assertions across 27 files, both private-package types pass,
and independent bounded review is clear. Initial review caught the post-reopen
baseline blind spot; the pre-kill snapshots close it. This covers two fixed windows,
not arbitrary crash placement or production activation.

Legacy import now has a shared-database rehearsal too: in-memory legacy migration
bytes import into the same `messages.db` holding original host messages, branch
identities, media references, queue/preferences and migration metadata. Lost import
acknowledgement and SDK/host/journal connection reopen preserve those rows and all
import bindings without duplicate conversations or session JSONL files. The same
owner remains held; this is not fresh-owner/process-death evidence. The journal
reaches verified with the legacy writer unchanged, not automatic activation.

The shared-history fixture uses a fresh public SDK root and random host identities,
compares branch mappings by leaf identity, and requires the exact injected lost-ACK
error after a persisted manifest. These corrections prevent random ordering or an
earlier import failure from masquerading as evidence. Final correctly configured
candidate run passes 381 tests / 6,476 assertions across 27 files; types and bounded
independent review are clear.

### Application session-position binding without JSONL

Explicit internal `AgentPoolOptions.durableSessions` now routes the existing
session-position reader through the runtime facade and captured adapter to public
candidate database history. Bound main/side session construction rejects before
legacy factories, including on reader errors. Unsupported restore/navigation fails
closed. Unbound Pi 1.2.0 behaviour remains unchanged; nothing is registered.

The real shared-database/application-facade test preserves position and original
session identity across fresh-owner reopen. Throwing SessionManager factories
remain untouched and the recursive watcher observes no JSONL files. This is not a
fully constructed AgentPool/HTTP end-to-end qualification; legacy list/model/branch
readers remain to be converted. Full candidate verification passes 381 tests /
6,487 assertions, root fast CI passes 7,143 tests (74 baseline skips) plus 25 feature
and 9 build tests, types pass within the stated private/runtime scope, and bounded
independent review is clear.

The existing current-model-label reader now uses the same captured durable-session
port to read persisted public `AgentDoc` state. It returns the stored provider/model
choice (or null), not last-input metadata or a guessed default. Missing bound
capability and reader errors fail closed without legacy session construction.
Single-file reopen preserves the model choice; forbidden SessionManager factories
remain untouched with zero JSONL events. Legacy/facade tests pass 38 cases, full
candidate verification passes 381 tests / 6,490 assertions, typechecks pass within
the stated scope and bounded independent review is clear. Tree/history projection
and branch mutation remain incomplete; no activation or new session file occurs.

### Database-backed session tree

The existing `/tree` reader now routes explicitly bound chats through the same
captured durable-session port before any legacy factory. Public fork-aware history
projects into the existing tree snapshot/widget contract; supported imported
metadata retains provenance, thinking content is excluded and unsupported history
rejects without JSONL fallback. Tree mutations remain unavailable.

Exact public `leafId` remains the persisted position. Derived `visibleLeafId`
highlights its visible ancestor when a hidden system row is at the head. Imported
compaction/baseline pairs are deduplicated only with adjacent exact audit evidence;
independent native compactions remain visible. Review caught both edge cases and
regressions cover them. The shared-file fixture creates a fresh public import root
so earlier histories remain untouched.

Final candidate verification passes 383 tests / 6,538 assertions across 28 files;
root fast CI and engine/runtime/qualification types pass. Focused root tree/handler/
facade tests pass 65 cases. Independent bounded review is clear. This is read-only
projection, not branch mutation, complete UI/browser qualification or activation.

### Combined normal web input and actual application pool

`application-web.test.ts` constructs the real AgentPool and WebChannel, posts a
normal content-only message and runs the actual AgentQueue/processChat worker into
the real candidate runtime sharing host messages.db. It checks one EF terminal
commit/answer, preserved identity, DB model/position/tree reads and `/tree` after
the supplied registration map is cleared. A lost-wait acknowledgement retains the
busy lane/inflight marker without answer publication or legacy runAgent calls.
Throwing SessionManager factories, recursive JSONL observation and same-file checks
cover the combined exercise. HTTP identity and current acceptance timestamps remain
subject to the existing public provenance and EF checks.

Final candidate verification passes 385 tests / 6,607 assertions across 29 files;
focused combined regressions pass 11 tests / 518 assertions, qualification types
pass and independent bounded review is clear. This is synthetic-provider, explicit
fixture-port, in-process HTTP qualification—not production registration or complete
compatibility/performance acceptance. No production runtime source changed.

### Idle-only database model control

Explicitly bound `/model` SET now shares the existing application resolver and
routes through the captured durable-session port. It rejects accepted host work,
public pending tasks/submissions and nonempty inboxes instead of changing the model
of already-accepted input. A temporary runtime admission gate and an owned shared-
file SQLite `BEGIN IMMEDIATE` guard protect public configure; no SDK metadata is
written to obtain a lock. Missing guards and stale ownership fail closed.

Review found that a retained root read transaction could hide earlier acceptance.
Every guard phase now rejects such transactions; WAL and three phase-injection
regressions verify the persisted model remains unchanged. Unknown/ambiguous models,
concurrent changes, busy work and unsupported context estimates reject. Context-fit
evidence is candidate-only, not a complete host prompt-overhead guarantee; dynamic
sections and unqualified image overhead fail closed. No automatic compaction or
history dropping is used.

Final candidate verification passes 386 tests / 6,647 assertions across 30 files;
root fast CI passes 7,163 tests (74 baseline skips), plus 25 feature and 9 build
tests. Private/runtime types and bounded independent review are clear. A concurrent
full candidate attempt hit one existing binding-test timeout; unchanged sequential
repeat passed. Application activation and other session mutations remain separate.

### Existing runtime-lock ownership capability

The application runtime lock now exposes strict exact-token ownership checks using
boot/process-start identity, nonce, original inode and record bytes. No second owner
ledger is added. All enabled acquirers refuse existing paths, including partial,
malformed and stale records: this closes the cooperating-process publication and
stale-cleanup races. Verified release preserves replaced/tampered records and logs
failures. Disabled/legacy handles cannot claim strict durable authority.

This intentionally replaces automatic stale cleanup with offline operator cleanup,
including after SIGKILL or publication failure. It is conservative exclusion, not
unattended restart recovery. A trusted lock directory, updated cooperating binaries
and no concurrent external replacement remain required. The production durable
backend is still unregistered.

Ownership-focused tests pass 32 cases / 193 assertions; CLI integration explicitly
proves stale refusal before disposable offline cleanup. Final root fast CI passes
7,174 tests (74 baseline skips), plus 25 feature and 9 build tests; bounded source
review is clear. Earlier full failures were corrected CLI fixture policy assumptions
and README translation link parity, not ignored. Runtime types pass; aggregate
frontend-baseline typechecking remains separately red as recorded. Candidate runtime
source did not change in this slice; its prior full receipt remains historical.

### Explicit application bootstrap bundle

`application-bootstrap.ts` now composes the existing controller, same-file owned
SQLite bridge, real host effect stores, bindings/recovery, adapter/session readers,
admission and existing queue dispatch into one unregistered bundle. It borrows strict
runtime-lock authority; closing the bundle seals that scope but never releases the
application's global lock or closes its root database. The application must stop
its worker/queue before disposal. Payload materialisation remains an explicit host
port. No selector, automatic import or production schema activation is installed.

Manifest and session chat sets must match exactly before storage or ports are
published. Admission uses the captured manifest; configuration mutation cannot widen
it. Review found and closed the extra-chat orphaning case. The real AgentPool and
WebChannel qualification now uses only bundle outputs, including the retained-lane
lost-ACK case and unbound-chat rejection. All ordinary effect-store mutations use
the supplied owner fence; invalid asynchronous guards roll back.

Final candidate verification passes 386 tests / 6,695 assertions. Root fast CI and
both private-package typechecks pass; the private config includes the existing
web-push declaration rather than requiring external compiler arguments. Independent
bounded review is clear. The first root run hit one image-processing timeout; an
unchanged full repeat passed. This bundle remains default-off and is not automatic
migration, complete compatibility or production activation qualification.

### Verified legacy receipts to application bindings

`prepareCopiedApplicationUpgrade` now preflights existing histories and rejects
unsupported non-main/duplicate-chat routing before checkpoint/import writes. Its
`verifyBindings` derives bootstrap manifests and original session identities only
after complete public receipt/history/context verification. Existing IDs come from
those verified receipts; no manual reconstruction or new-chat-only shortcut is used.

Tests cover lost import acknowledgement, database/journal reopen with identical IDs,
corrupted receipts and unsupported scope. Real AgentPool/WebChannel tests now use
automatically derived imported bindings and continue the same original chat in one
database without JSONL. Final candidate verification passes 388 tests / 6,710
assertions; focused tests pass 11 cases / 197 assertions, both private-package types
pass and bounded independent review is clear.

This is a prerequisite, not guarded cutover: generation-fenced begin/verify/writer
switch, unpublished paused-bootstrap cleanup and safe port publication still need
composition. Production selection remains default-off.

### Guarded explicit application upgrade transition

`upgradeApplication` composes the existing copied plan, generation-fenced cutover
controller and application bootstrap. It validates physical database/scope/request
identity, imports and verifies complete receipts, closes the importer, opens an
unpublished paused bundle and commits the writer transition before returning it.
Active lost-ACK retries verify the same baseline and skip begin/commit. Failure
closes unpublished resources without rolling back candidate commits or releasing
the application's owner/root database.

Cleanup preserves the primary error unchanged when it succeeds, or reports it
first with cleanup failures in AggregateError. Tests cover actual writer commit
followed by lost acknowledgement and failed bundle close: journal remains active,
no bundle escapes, owner/root remain held, and real resources are cleaned up.
Importer close is captured and attempted at most once, including when it throws.

Final candidate verification passes 388 tests / 6,843 assertions; focused tests pass
19 cases, broader regressions 38, both private-package types pass and independent
bounded review is clear. An earlier full attempt hit five five-second timeouts;
unchanged sequential repeat passed. This is explicit main-branch-only composition,
not automatic installation discovery, branch-complete migration, production
registration or activation. No new journal, queue, database or session JSONL is used.

### Preserved existing branch routing

Application upgrade and bootstrap now accept original non-main branch identities
for distinct original chat JIDs. Each non-main binding must match the exact existing
unarchived `chat_branches` row before journal/import writes and again before bundle
construction. Dispatch selects its captured manifest branch, not an implicit main.
Multiple source leaves for the same chat remain unsupported and reject before writes;
no branch is discarded, renamed or sent through a new routing interface.

The real AgentPool/WebChannel test imports two original sibling branches and
continues both independently with their original chats, sessions, durable bindings
and shared tree history in one database without JSONL. Wrong persisted bindings
reject. Final candidate verification passes 389 tests / 6,922 assertions; root fast
CI, engine/qualification types and bounded independent review pass. This adds
preserved routing only, not branch mutation, automatic inventory or activation.

### Read-only installation source inventory

The application-owned inventory enumerates persisted chats/branches/message-chat
identities and configured legacy input files under strict ownership. It retains
immutable bytes/hashes, shared-file associations and discovered leaves, confines
paths, and revalidates both database and source frontiers. Active root read
transactions reject; the WAL regression prevents stale snapshots hiding later
acceptance. Valid fork headers, usage and bash records are understood; unsupported
records remain explicit per-file blockers with their bytes preserved.

The actual root schema lacks authoritative persisted session-file, selected-leaf,
incarnation and baseline bindings. Inventory therefore reports BLOCKED/non-preparable
for existing chats, including empty ones. It does not choose recent files, fabricate
summaries or reconstruct history from timeline messages. Completing those source
bindings is still required for automatic migration; this is not readiness evidence.

Focused inventory tests pass 9 cases / 47 assertions; runtime types, root fast CI
and bounded independent review pass. No journal/import writes, JSONL session writes,
new database/ledger, activation or live-state access occurs.

### Resident legacy migration authority capture

`AgentPool.captureLegacyUpgradeBindings` now captures actual resident session/file,
selected leaf, original session and current prompt under strict ownership and a
sealed/drained coordinator capability. It does not open a guessed session, choose
the newest file or create migration authority from filenames. Queue/pool activity,
root autocommit/frontier, live session state, source bytes and canonical resident
filename binding are rechecked after filesystem awaits and on later revalidation.
External alias retargeting rejects; every selected file leaf needs resident authority.

Current prompt capture alone is not an original persisted baseline. The real upgrade
preparation rejects that case; a genuinely persisted-baseline fixture yields a
preparable plan without capture writes. Missing resident authority still fails
closed, so this is not complete offline or automatic installation migration.

Focused verification passes 37 tests / 123 assertions; runtime types/build and
bounded independent review pass. The surviving interrupted root fast gate completed
7,203 tests (74 baseline skips), plus 25 feature and 9 build tests without failures
and with the final build footer. Its interrupted wrapper recorded no exit code.
No importer/journal writes, ongoing JSONL, activation or live-state changes occur.

### Joined producers, web admission and ownership-safe shutdown

Scheduler stop now revokes admission and joins its poll. The message poller has a
stable abort/join handle, abortable sleep and partial-batch cursor preservation.
Web shutdown seals ordinary HTTP/control admission, joins entered handlers and
startup, then tears down transports; runtime drains web admission before queue/pool
disposal. Startup/TLS/bind-retry races and combined cleanup failures are covered.
Primary errors remain observable; independent cleanup is attempted without falsely
certifying success.

Producer completion no longer releases application ownership. Actual queue shutdown
deadlines reject while preserving work; uncertain joins prevent pool disposal.
Strict and legacy runtime locks survive uncertified deadline/process exits. Only
successful full cleanup synchronously authorises exit-time release. Real queue and
disposable child-process tests cover those paths.

A separately reviewed small indexing optimisation skips staged DELETEs only for
new paths, retaining atomic replacement cleanup and every existing access check.
No timing budgets or assertions changed. Earlier full gates repeatedly hit elapsed
limits; profiling and failed receipts remain recorded. Final root fast CI passes
7,253 tests (74 baseline skips), plus 25 feature and 9 build tests, EXIT_CODE=0.
Combined lifecycle regressions pass 99 cases; runtime types and bounded source
reviews pass. The gate also caught a silent startup-error observer, replaced with
diagnostic logging before the successful repeat.

These are real lifecycle prerequisites, not a composed migration admission lease or
complete ingress inventory. No production activation, service restart, live-state
change, additional queue/database or ongoing JSONL persistence is introduced.

### Internal callback admission joins

Real direct chat relay, add-on enqueue and startup-installed session-control callbacks
now enter the same WebChannel admission gate. Every callback owns an expiring
async-local permit; accepted nested work joins the drain even if it outlives its
parent, while detached stale contexts cannot reopen admission after sealing.
No queue/pool shutdown or global migration lease is implied.

Focused verification passes 107 tests / 672 assertions, runtime types and bounded
independent review pass. Full root fast CI passes with EXIT_CODE=0 after updating
an old delegation stub to provide the required guarded gateway method. Real rejection
and nested-drain tests remain enabled; production does not gain an unguarded fallback.
Full producer/ingress inventory and non-destructive accepted-work drain still need
runtime-owned coordinator composition before resident migration capture is safe.

### Queue-local non-destructive migration drain

`AgentQueue.sealAndDrain()` permanently seals new admission and joins already
accepted startup/current/pending/retry work on the same queue. It neither clears
work nor disposes resident sessions. Only retained timer/item identities can re-enter
as retries; arbitrary external enqueue after sealing throws. The stable capability
can be invalidated but cannot reopen or reacquire admission. Errors poison drain
certification while retained work finishes, and shutdown races cannot turn cleared
work into a successful proof.

This is queue-local quiescence only: persisted-source/root drain and stopped producers
must still be proved by the runtime coordinator. Focused queue/capture verification
passes 82 cases, runtime types and bounded independent review pass, and full root
fast CI passes with EXIT_CODE=0. The gate caught a silent rejection observer, replaced
with diagnostic warning before the successful repeat. No new queue, ledger, JSONL
persistence, application activation or live-state change is introduced.

Ownership contender qualification now separates real lease acquisition from SDK
storage initialization. Both children attempt exclusive acquisition; only after the
loser has rolled back/closed does the parent permit opening. Successful admission
still requires actual storage/Harness open and submission, with exactly one lease
and one opener. A deterministic negative case demonstrates the unsupported SQLite
read-to-write upgrade overlap rather than hiding it with retries or longer budgets.
SIGSTOP denial and killed/reaped recovery remain tested.

Ten serial paired runs and the full candidate suite pass: 390 tests / 6,925 assertions
across 30 files, with types and bounded independent review clear. This proves the
fixture's exclusivity and fixed crash recovery, not availability under every startup
interleaving. The historical hosted zero-opener cause cannot be established from its
old missing diagnostics; future failures include phase/error/stderr evidence.

### Runtime-owned inspection migration coordinator

Actual runtime bootstrap now exposes a default-absent migration-inspection context
bound to its acquired strict owner, installed Web/worker handles, queue and resident
pool. It rejects unsupported installed channels/add-ons/transports before sealing,
seals Web admission synchronously, joins producers, then non-destructively drains
accepted queue work. Owner, ingress qualification, root autocommit, source/operation
frontiers, legacy cursors, unread messages and pool idleness are rechecked before
resident capture and across later assertions. Application lifetime remains held;
release invalidates the capability without resuming producers or releasing ownership.

Review caught a missing late local-transport check; preflight and frontier checks
now agree, with during-await and post-preparation mutation regressions. Focused
bootstrap/capture/startup tests pass 50 cases / 198 assertions; runtime types,
independent bounded review and the full root fast gate pass with EXIT_CODE=0.
This is inspection-only base-runtime composition. Installed autonomous add-ons and
unsupported ingress remain refused; automatic selection, full migration activation,
critical compatibility and performance acceptance remain incomplete.

### Resident capture to guarded upgrade workflow

The explicit `upgradeCapturedRuntime` workflow now joins the real bootstrap-owned
migration preparation/capture capability to copied-input preflight and guarded
application upgrade. It supports exactly one captured source session with all its
selected chat branches/leaves. Zero/multiple inputs and any unselected history
reject before importer/journal writes; this is not installation-wide automation.

Original snapshot validation precedes writes. During import, an exact allowlist
permits known SDK/correlation/journal writes while protecting all other host schema
and data, including settings, security, terminal evidence and implicit row identities.
Non-finite REAL values remain distinguishable. Owner/admission checks continue
through async stages and the final writer transaction; original source authority
is revalidated before activation. Failure retains sealed preparation/global ownership.
No new database, queue, ledger or ongoing JSONL persistence is used.

Actual-bootstrap tests continue the original imported chat and sibling through the
returned bundle's real AgentPool/WebChannel HTTP path, and reject changes to source,
capability, routing/preferences/security/terminal state and message row identities.
Focused frontier regressions cover shadowed aliases, WITHOUT ROWID and infinities.
Review caught and closed incomplete host-table coverage and encoder gaps.

Final sequential candidate verification passes 411 tests / 6,957 assertions across
32 files; engine, qualification and root runtime types pass, and bounded independent
review is clear. The surviving root gate completed 7,275 tests (74 baseline skips)
plus 25 feature and 9 build tests with final build footer; its interrupted wrapper
recorded no exit code. An earlier concurrent candidate attempt had one existing
binding-test timeout; unchanged sequential repeat passed. Production selection,
multiple-source installation migration and remaining compatibility are not complete.

### Multiple captured source sessions, one transition

Captured upgrade now supports multiple complete source sessions in the same database.
All inputs, identities and caller-assigned existing roots are validated before the
journal/import stage. Canonically ordered source hashes, manifest hashes and root
assignments are pinned in one optional v2 installation request in the existing
journal; the absent-installation v1 request/hash remains compatible. Roots are not
allocated during retry, and ambiguous/unselected history remains fail-closed.

One paused importer verifies every tree and combines original chat/session bindings
into one bundle before a single writer flip. The real two-source test continues both
original chats through normal HTTP. A lost acknowledgement after the second import
commits preserves both receipts, assigned IDs and first-source history on retry.
Invalid/aliased roots and unsupported later sources reject before journaling.

Final candidate verification passes 414 tests / 6,975 assertions across 32 files;
focused migration/cutover regressions pass 42 cases / 406 assertions. Engine,
qualification and targeted runtime types, full root fast CI and bounded independent
review pass. Aggregate frontend-baseline typechecking remains separately red as
recorded. This closes bounded captured-source coverage, not automatic root discovery,
all historical-file migration, installed add-on compatibility or production activation.

### Idle-only explicit manual compaction

Bound `/compact` now uses public `Conversation.compact`, whole-domain idle and
scheduling checks, shared-file admission fencing and the existing command/result
surfaces. It waits for the public task plus any summary-write submission/entry before
success. No-op is reported truthfully; unknown usage remains null. Model-plus-compact
and automatic compaction remain unavailable in this slice.

Review found accepted input in another chat could strand behind maintenance. Submit
and intent paths now capture immutable identities, wait for actual owned maintenance
outside active-operation tracking, then revalidate through normal idempotent admission.
A cancelled observer cannot release that gate; uncertain maintenance and close remain
fail-closed. The real two-chat HTTP/queue regression proves claimed B waits during A's
compaction, then produces exactly one submission/terminal publication and releases
its worker without restart or legacy fallback.

Final candidate verification passes 415 tests / 7,033 assertions across 33 files;
root fast CI passes 7,275 tests (74 baseline skips), plus 25 feature and 9 build tests,
EXIT_CODE=0. Private types and bounded independent review pass. Deferred-command,
automatic/protected handoff and infrastructure-failure recovery qualification remain
open; this does not complete compaction or production acceptance. No ongoing JSONL,
additional database/queue, activation or live provider operation occurs.

### Deferred compact and uncertain maintenance

Busy bound `/compact` now uses the existing follow-up queue and native compaction
intent/result flow; unbound legacy immediate behaviour is unchanged. Normal deferred
text materialisation admits its durable source inside the existing message/queue-
consumption transaction. Commands and already-accepted sources are excluded.

Confirmed provider failure produces a truthful terminal error. Infrastructure
uncertainty instead retains command protection, intent, cursor and worker ownership
until explicit scoped reconciliation observes the same public task/write settlement.
No compaction is resubmitted. Close rejects uncertain maintenance before joining a
blocked reconciliation, retaining ownership; known ongoing maintenance still joins.
The application bundle exposes reconciliation through the same captured binding.

Real web/queue tests cover deferred success, provider failure, following input using
the summary, wait/read uncertainty, cross-domain rejection and close ordering, with
no legacy/JSONL fallback or duplicate input/publication. Final candidate verification
passes 423 tests / 8,002 assertions; all three scoped typechecks and bounded review
pass. The surviving root gate completed 7,275 tests (74 baseline skips), plus 25
feature and 9 build tests with final build footer; the interrupted wrapper recorded
no exit code. Earlier failures and the legacy-immediate regression remain recorded;
no timeouts or assertions were weakened. Automatic/protected compaction remains open.

### Consolidated runtime startup ownership

Existing runtime bootstrap now owns one `RuntimeBackend` lifecycle: prepare before
pool/channel construction, pass its session/bind outputs once, stop observations
before queue join, and close after pool cleanup. The redundant prepared-backend
alias/wrapper is removed. Uncertain startup cleanup propagates one dependency-free
error class so main retains ownership; importing that type no longer loads bootstrap
side effects through the engine. Failed selected-backend preparation never falls
through to legacy session construction.

Actual startup application cases run in fresh process fixtures, matching process-
singleton runtime ownership rather than repeatedly bootstrapping one shared test DB.
Final candidate verification passes 423 tests / 6,781 assertions; root fast CI,
scoped types and bounded independent review pass. A first root attempt discovered
ignored generated JS tests with missing siblings; disposable generated output was
moved outside test discovery before the successful unchanged-source repeat.

This consolidates source wiring, not completed production legacy replacement.
Per user direction, further migration work is parked: next work replaces legacy
runtime/session execution and deletes superseded internals before migration is
finished. Production selector remains unchanged; no live activation occurs.

### Durable selection excludes legacy construction pool-wide

Supplying durable session ports, including an empty map, now selects the whole pool
backend—not a per-chat overlay. Unknown chats reject instead of constructing legacy
sessions. Selected pools skip legacy factory getters, eager default setup, affinity
installation and JSONL sessions-directory creation. Legacy-only constructors load
dynamically on compatibility paths; DB readers/control operations retain captured
ports and cannot fall back to file sessions. Unbound application admission rejects
before message/source acceptance through the existing error surface.

The real application and construction regressions forbid legacy factories and
verify no session-file creation. Final candidate verification passes 423 tests /
6,781 assertions, both private-package types and root fast CI pass, and independent
bounded review is clear. The first run caught an old expected rejection string and
a binding-test timeout; unchanged sequential repeat passes after correcting only
the changed error expectation. Default/no-map startup remains legacy and is the
next replacement target; this is not a fully legacy-free module graph.

Migration work remains parked until mainstream runtime convergence and compatibility
are finished, per user direction. No live activation, database mutation, installation
or dependency-pin change is performed by this source-only replacement.

Local startup/session construction imports are now lazy: filesystem identity helpers
live separately from the legacy session module, and affinity installation occurs
only on actual legacy construction. Fresh-process load fences prove durable pool
construction does not evaluate Piclaw's local legacy session module; a real legacy
construction hits the fence as a positive control. Public SDK root exports still
load SDK session machinery; no SDK-wide exclusion claim is made.

Focused checks pass 80 construction tests and 91 additional regressions. Final
sequential candidate verification passes 423 tests / 6,781 assertions; the full root
gate passes unchanged limits with EXIT_CODE=0. Prior concurrent attempts hit existing
elapsed limits and remain recorded. Runtime types and bounded review pass.
This is local import cleanup, not the default durable backend switch. Migration
remains parked; direct default replacement and legacy deletion remain the priority.

### Source default is the mainstream durable backend

The production default dependency factory now prepares the mainstream durable
application runtime before constructing AgentPool/WebChannel. Main requires strict
ownership. One fixed package-boundary loader lives in bootstrap; the redundant
loader module was removed after the cycle gate caught its bootstrap back-edge.
There is no default legacy-session fallback. Missing engine packages fail with
installation guidance; dependency evaluation errors retain their cause.

Fresh startup-known chats use canonical public SDK routing/identity documents in
the same host database. Reopen validates scope and persisted agent choices against
the captured authenticated host model catalogue, preserving model A when the host
default changes to B. Unapproved persisted choices reject without rewriting them.
The real host model bridge and tracked bash are used. Unknown post-startup chats
and the full host tool/add-on set remain unfinished; no parity is claimed.

Legacy history/files are refused before engine/model construction, without migration
or reset. Initialization cleanup is confirmed before ordinary errors propagate;
uncertain cleanup raises the shared error so actual main retains global ownership.
Actual factory→bootstrap→main fault tests cover that path and ordered error causes.
Factory cases use separate cold-process fixtures rather than polluting other shared-
database recovery tests.

Final candidate verification passes 426 tests / 6,784 assertions; root fast CI passes
7,287 tests (74 baseline skips), plus 25 feature and 9 build tests, EXIT_CODE=0.
All three scoped typechecks, cycle checks and bounded independent review pass.
This is a source-default replacement only: no install, live activation, restart,
existing-history mutation or migration was performed. Migration remains last.

### Normal post-startup conversation creation

The default backend now owns a readonly session lookup rather than copied routing
maps. Validated normal web input prepares a route before host message acceptance.
One public transaction creates/configures the conversation and persists identity
and canonical mapping, then scheduling/recovery scope and routing publish together.
Same-chat preparations are single-flight. Proven pre-transaction failures can retry;
once commit may have occurred, rejection remains fail-closed until reopen recovery.

Actual concurrent first HTTP posts produce one conversation and two separately
consumed inputs/answers. Restored model availability retries without restart. Held
preparation racing stop/close cannot publish a route or write after completed close;
malformed, empty, command and unauthorized requests leave routing unchanged. Reopen
preserves the committed route and original new session identity without JSONL.

Final candidate verification passes 426 tests / 6,784 assertions, root fast CI passes
with EXIT_CODE=0, focused root tests pass 72 cases / 409 assertions, and bounded
independent review is clear. Earlier candidate attempts hit existing elapsed limits;
no timeout/assertion was weakened. This removes startup-known-chat-only routing,
not the remaining full host-tool/add-on compatibility gap. Migration remains last.

### Host builtin convergence: discrepancy closeout (HEAD `6b04df9a9` + WIP)

The actual implementation uses **one guarded public SDK commit**, not an extension
that captures tools before configuration. Read-only preflight identifies the old
factory selection. Under owned same-file `BEGIN IMMEDIATE`, `app.commit` checks
SDK/host idleness, rereads every affected `AgentDoc` via `tx.doc`, and requires its
tools still to be exactly `["bash"]` before any `configure` call. All affected
conversations are then configured through public `configure(tx, id, { tools })`
inside that single transaction. Ownership/idleness are checked again before return;
the storage guard also fences commit. The final root-connection idle check cannot
see uncommitted SDK writes, but scheduling is paused during preparation and this
configuration changes tools only: no model run is scheduled by that loop. It is
not a separate per-conversation write or a private document rewrite.

The canonical v1 factory never offered tool-selection controls. Consequently its
exact old `["bash"]` selection is admitted for convergence, although identical
user-authored bash-only state is semantically indistinguishable. This is a scoped
v1 compatibility decision, not a claim to detect user intent. Other known builtin
subsets (for example `["read"]`) are preserved; unknown/custom/add-on tool names
reject as unavailable rather than being silently stripped. Full add-on parity
remains unqualified.

Two additional real cold-process factory regressions now pass:

- Publicly persist `["read"]` plus thinking/instructions/extensions; change the
  host default model and reopen. Entire public AgentDoc state, model selection,
  history and identity revisions remain unchanged, with original route identities.
- Publicly persist the genuine old bash-only factory state with a real accepted,
  still-pending host source. Factory rejects before any SDK storage transaction
  (therefore before public configure), with an identical serialized SQL byte
  snapshot and separately identical AgentDoc revision/history bytes. No model runs.
  This case has no SDK-open normalization; for a future pending-SDK-work case,
  legitimate open normalization must not be mistaken for an agent-tool mutation.

Final focused receipt: **13 pass, 0 fail across 2 files** (5 isolated factory
cases, 8 host-builtin cases; 49 parent-process assertions, child assertions are not
included in that parent count). Existing genuine bash-only positive convergence
and successful six-tool model-visible chain still pass. Qualification types,
engine types and `make build-ts` all pass. Logs: `artifacts/tool-convergence-tests.log`,
`artifacts/tool-convergence-types.log`, `artifacts/tool-convergence-engine-types.log`,
`artifacts/tool-convergence-runtime-types.log`. Earlier full-suite totals above are
historical, not a claim of a new full-suite run. The initial new test expected the
wrong host-source state label (`accepted`); corrected to actual `pending`, then
rerun green. No implementation source change was needed for this closeout.
No live/network/service/pin/commit/push/migration changes were made.

### Default host built-ins replace bash-only execution

The default runtime now binds `read`, `bash`, `edit`, `write`, `find` and `ls` through
the existing host bridge. Filesystem operations validate invocation authority at
the actual synchronous effect after SDK awaits. Find uses an asynchronous guarded
installed-fd process with abort, bounded output and child/readers joining; it does
not block the event loop or download executables. Bash retains tracked spawn guards.
The actual default-provider test executes the complete six-tool chain.

Known canonical v1 bash-only selections converge through one guarded public commit,
with idle/ownership checks and re-reading the old default before configuring all
affected agents. Persisted model/thinking/history/identity and explicit custom
subsets remain unchanged; pending work rejects without mutation. Grep is still
unavailable because its old SDK implementation lacks effect-time spawn injection;
this is not full seven-tool Linux parity. Replay remains unsafe, PowerShell is
outside Linux policy, and installed add-ons still need qualification.

Final candidate verification passes 436 tests / 6,830 assertions across 35 files;
root fast CI, all three scoped types and bounded independent review pass. Review
caught blocking find and unchanged old selections; both are fixed with regressions.
No SDK-private patch, new queue/database, ongoing JSONL or migration work is added.

### Shared guarded grep completes the Linux built-in set

Root tools and durable built-ins now share one host-owned grep implementation,
retaining public SDK schema/metadata/renderers and exported truncation contracts.
Execution uses installed rg with no shell or download. Find and grep share one
bounded asynchronous process helper with effect-time authority, process-group abort
and joined readers/exit. Scalar arguments are snapshotted before validation/await;
review found and closed caller-mutation drift with an SDK-oracle regression.

The default Linux set now includes read, bash, edit, write, grep, find and ls.
Recognised previous defaults converge using existing guarded configuration; custom
subsets remain intact. Oracle tests cover regex/literal/context/glob/file/no-match,
limits, long lines and errors. Real default-provider execution greps the edited
file; revocation-before-spawn and abort/overflow/stderr cleanup are verified.

Final candidate verification passes 443 tests / 6,867 assertions across 36 files;
all three scoped typechecks, bounded independent review and full root fast CI pass.
The first root run hit the existing image-processing five-second timeout; unchanged
repeat passes without changing limits. Grep tests are explicitly registered in both
qualification test command and types. No SDK-private patch, parallel process manager,
ongoing JSONL, migration, deployment or live-state operation is introduced.

### Installed Plan adopts native durable execution and request hooks

Default runtime now loads the actual installed extension registry, admits the approved
canonical Plan implementation, and executes its registered tool through a verified
public run/tool-slot → accepted-source/operation binding. Root KV reads/writes use
invocation-local authority; writes recheck inside the existing database transaction.
The native public `GenerationHooks.beforeRequest` uses the add-on's exported prompt
builders with readonly authority. No legacy ExtensionContext/AgentSession is emulated;
Plan's legacy before-agent-start callback is replaced on the durable path.

Shared package discovery and root KV registration replace duplicated AgentPool/session
registration code. Unsupported tools/lifecycles remain explicit startup blockers,
not silently omitted or labeled fenced. Qualification binds approved version/content,
canonical paths, exact loaded objects and pre/post-load snapshots. Changed/unsupported
source poisons the path for the process, preventing restored files from blessing a
stale SDK-cached factory; a restart is required. No private cache API is used.

Actual default-provider tests exercise Plan update, persistent chat-scoped KV and
one Plan section per provider request, with public source/operation ownership checks.
Spoofed manifests, unsupported code/version, changed declarations, cross-chat writes,
revocation and same-path cache substitution are denied. Final candidate verification
passes 456 tests / 6,970 assertions across 37 files; root fast CI passes 7,287 tests
(74 baseline skips), plus 25 feature and 9 build tests, EXIT_CODE=0. All three scoped
types and bounded independent reviews pass. Earlier root failures were an oracle
pointing at the removed duplicate discovery code; shared containment checks remain.
This qualifies approved Plan only, not all installed add-ons. Migration stays last;
no live package changes, activation, restart or additional database/queue is introduced.
