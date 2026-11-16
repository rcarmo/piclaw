# Native qualification

The active suite is `qualification/native`. Its provenance checks and current gate target SDK **1.5.2**; the former `pi-durable-130` directory name is retired. Historical receipts retain their original paths and versions and do not qualify current source. Moving the suite earns no runtime-reduction credit.

## Current Core Plan ownership (#1991)

Plan now uses the existing application Harness and a session-scoped `app.plan` document family keyed by exact chat/branch JID. Native tool and hook APIs replace the installed Plan declaration, KV writer and qualification. Existing current-native KV records are retained as read-only seeds; no v3 importer or mirror is used.

`plan.test.ts` exercises actual fresh/existing default applications, ignored legacy modules, prompt/tool execution, authenticated Core HTTP, stale writes and reopen. The `native-plan-*` tests cover SDK document/commit/rollback/alias/concurrency/cancellation boundaries; `native-goal-plan.test.ts` verifies actual native Goal finalization uses the SDK checklist even with a poisoned legacy global. Existing hidden-context and source/SQL boundary tests remain required. See [the current contract](../../docs/native-plan-context.md).

Older dated receipts below describe their original source and do not establish current ownership.


`make ci-native` runs the required offline native gate; `make ci-full` requires both host and native qualification. See [Native validation](../../docs/native-validation.md) for exact preparation and all five required exports.

The shared [gate contract](../../scripts/native-gate-contract.json) pins SDK **1.5.2**, two add-on checkouts and the complete native file inventory, including Goal. ADDONS/CORE/GOAL use one native checkout; CONTRACT uses separate historical source. Catalogue dependencies come from frozen `qualification/native/node_modules`, never a live profile. Root Pi 1.5.2 and the private engine’s Pi Durable 1.5.2 graph stay physically isolated. Preflight checks the contract against both manifest pins, the installed root SDK and the recorded private package bytes. The runner verifies existing provenance, runs both private type projects and required accepted-source integration, then requires terminal Bun reports for the complete native inventory. No skip, filter, empty run or missing fixture can qualify this gate. It performs no source acquisition or dependency installation.

## Historical checkpoints

The [#1650 acceptance checkpoint — 22 October 2026](../../docs/design/earendil-agent-harness-integration-adr/evidence/pi-durable-130-acceptance-current-20261022.md) records native controls, family retirement, qualification repairs and remaining acceptance at that date. The receipts below retain their original dates, source revisions and scope. References to an inactive or source-only engine, older fixture roots and partial file inventories describe historical checkpoints; the application-owned native engine now has a required gate. These counts do not qualify a later revision.

## Historical Native MCP transport close admission — targeted hardening

The existing constrained Native MCP transport now rejects start/send admission
as soon as close begins, before calling the raw transport. Closure stays sealed
after completion or failure. Raw policy-denial cleanup replies, pending-tail joins
and cached close failures retain their existing path. Already-admitted work is
not undone; no atomic network-cancellation claim is added.

Selected close/shutdown tests pass4/28 assertions; runtime types and bounded
review pass. No full suites or live MCP requests ran. This hardens the existing
Native transport only: durable default MCP admission remains unqualified and
blocked. Checkpoint:
/workspace/reviews/durable-1650/mcp-transport-close-admission.md.

# Native codemode can create/open Draw.io diagrams

The existing Draw.io adapter now permits nested-tool callers. Exact native
codemode ownership and all operation/source/harness/branch checks remain.
The same guarded exclusive creation, original shared factory and acknowledged
workspace UI opener run; no replacement implementation or wider grant.

Three selected actual-runtime scenarios pass (140 assertions): nested creation
and existing-file open, cancellation, and the unchanged direct tool. New XML
matches the default, existing bytes stay unchanged, and two real UI responses
acknowledge opens. Cancellation blocks file/UI/store/delivery effects. Current
asset handler serves prepared fixtures then returns503 after stop. Three strict
typechecks and bounded review pass. No full suites, browser-asset qualification
or exactly-once filesystem claim.
Checkpoint: /workspace/reviews/durable-1650/codemode-drawio-compatibility.md.

# Native codemode can open editable tables

The qualified editable_table adapter now accepts nested-tool callers. Exact
registered codemode ownership, foreground web source/operation/harness/branch
checks and synchronous publication fences remain unchanged. No second widget
implementation, new ingress or broader grant.

Three selected actual-runtime cases pass: nested table49 assertions, post-capture
cancellation38, existing direct table29 (116 total). Success verifies real
in-process SSE delivery and edited Markdown admitted through the normal message
endpoint. Cancellation leaves no widget, guest-store sentinel or acknowledgement.
Three configured typechecks and bounded review pass. No full suites or browser
editor interaction ran. Checkpoint:
/workspace/reviews/durable-1650/codemode-editable-table-compatibility.md.

# Native codemode can open qualified Office files

The existing Office Viewer adapter now accepts nested-tool callers. Exact native
codemode ownership, foreground accepted-source/harness checks and workspace file
validation remain unchanged. No second viewer implementation or UI context.

Three selected actual-runtime cases pass: nested viewer46 assertions, cancellation
after nested capture34, existing direct viewer33 (113 total). The returned viewer
URL resolves through the real raw-file handler; CSV bytes remain unchanged and
are not inserted into model output. Cancellation denies the URL/result and guest
store commit, preserving pending source ownership. Three configured typechecks
and bounded review pass. No full suites or browser-decoding qualification ran.
Checkpoint: /workspace/reviews/durable-1650/codemode-office-viewer-compatibility.md.

# Native codemode can call assigned Code Review

The existing Code Review adapter now accepts nested-tool callers alongside model
callers. The caller flag grants no review scope: capture still requires the exact
registered native codemode executor and live MODEL parent. The accepted local
dispatch proof, current branch/workspace/assignment checks and operation-owned
IMMEDIATE transaction remain unchanged. No second review implementation or store.

Three targeted actual-runtime checks pass: codemode read/reply plus other-chat
denial54 assertions; post-capture cancellation47; existing direct review59.
Total3tests/160assertions. Cancellation leaves no reply, guest-store sentinel or
delivered acknowledgement. All three configured typechecks and bounded review
pass. No full suites, live services, dependency changes or migration.
Checkpoint: /workspace/reviews/durable-1650/codemode-code-review-compatibility.md.

# Native codemode can call the qualified Plan tool

The existing Plan adapter now accepts model and nested-tool callers. Nested
execution still requires the exact registered native codemode executor and live
SDK ownership chain. The same accepted-source/version/harness checks and chat KV
IMMEDIATE transaction apply; no second Plan implementation or broader grant.

Targeted actual-runtime checks pass: codemode→Plan 57 assertions, cancellation
after nested capture 45, existing direct Plan 50 (3 tests / 152 assertions).
Strict qualification, engine and runtime types pass. Bounded review is READY.
No full suites or live changes ran. Checkpoint:
/workspace/reviews/durable-1650/codemode-plan-compatibility.md.

# Default-runtime fixture included in strict types

The main default-application-runtime.test.ts fixture is now explicitly included
in the strict qualification TypeScript project. Fourteen existing diagnostics
were fixed at the fixture source: JSON-compatible adversarial values, the real
in-memory test credential store, asserted admission callbacks, and generic
transaction spies. Existing runtime assertions and strictness are unchanged;
no production file or source hash was changed.

All three configured typechecks pass with zero diagnostics. Targeted runtime
checks pass: codemode reopen 1/38 assertions; malformed explicit model 1/25.
An initial malformed-model invocation used unpublished dirty add-on source and
correctly failed its hash guard; the final run uses the exact historical source.
Bounded review is READY. No full suites, retries of broad batches, live services,
dependency changes or migration. Checkpoint:
/workspace/reviews/durable-1650/default-fixture-type-cleanup.md.

# Native codemode default-backend reopen — targeted coverage

The native-codemode-reopen scenario uses the actual default backend, guarded
read/bash tools, strict root ownership and a single disk application database.
It completes a read, holds an unsafe shell child, then stops/closes the runtime
and physically reopens SQLite. The same accepted row/message and durable binding
are resumed. The read and shell marker remain single effects; the original child
is dead, source is consumed, and one public answer/terminal commit is recorded.

Targeted receipt: 1 pass / 38 assertions (~1.99 s), no full suite. Bounded static
review is READY. A direct affected-file typecheck retains 14 existing diagnostics
with zero additions versus exact HEAD; this is not a clean typecheck.
Checkpoint: /workspace/reviews/durable-1650/native-codemode-reopen-checkpoint.md.

Scope is controlled close/reopen through the default backend dispatcher, not
SIGKILL, power loss, provider-payment exactly-once, private SDK interruption
classification or a separate HTTP/processChat recovery scenario. No production
code, services, dependencies, activation or migration changed.

# Native codemode enabled — targeted qualification

Codemode is installed by default through the public durable createCodemodeTool
API and a 128 MiB QuickJS sandbox. It is offered alongside host builtins, with
search/description support from the native tool. Internal model APIs are disabled
(models:false). No legacy AgentSession or dynamic prompt-section adapter is used.
New chats and idle recognized previous defaults gain codemode; explicit custom
subsets remain unchanged. MCP/provider registrations still require separate ports.

Nested builtin calls must belong to the exact registered native codemode executor
and its current live MODEL parent slot. Captured operation/source/harness checks
run at filesystem effects. Native public api.commit callbacks are decorated with
those checks before/after the callback inside the SDK SQL transaction; unrelated
parent finalization is not globally blocked. Revoked guest store writes roll back.
The sandbox closes before bundle ownership can be released.

Final targeted actual-runtime receipts: public-conversations1/146 assertions;
native-codemode-cancel1/22; native-codemode-harness1/22. The latter two require
pending work, no file, no sentinel store revision and no delivered result after
revocation. Earlier cancellation fence was red/green verified. Host builtin/tool
checks pass28/157; three configured typechecks and bounded review pass.
Receipts: /workspace/reviews/durable-1650/codemode-final-*.log and
codemode-publish-*-types.log. No full suites or live configuration changes ran.

Restart during scripts, private memo bookkeeping, store fork semantics and full
MCP codemode are not newly qualified. Existing exact-running cancellation and
selected-auth budget gaps remain. This source enables codemode, without asserting
full acceptance, deployment, restart, migration or merged changes.

# Native Draw.io — targeted application port

The default runtime uses the shared Draw.io factory with explicit workspace and
operation-owned file/UI ports. Missing diagrams use guarded exclusive creation;
existing documents are preserved. The narrow workspace opener reuses the actual
UiBridge request/response registry, tab target and 15-second acknowledgement wait.
No ExtensionContext is fabricated and no duplicate tool body is introduced.
An unanswered request is an explicit failure, never a successful Opened result.

Startup binds and prepares vendor assets before model construction. Native asset
fetches are read-only and fail closed while unprepared, revoked or stopped. Stop
seals the binding; close joins preparation/cleanup. Uncertain staging cleanup
retains ownership and propagates RuntimeStartupCleanupError rather than releasing
a replacement grant. Exact reviewed add-on source:
8eb776fd9989addaa7d110c3d253c20f0cc22d58 (PR #211).

Targeted receipts under /workspace/reviews/durable-1650/:
- Actual default SSE/request/respond roundtrip: 1 pass / 31 assertions.
- Cancellation: 1 / 28; missing opener fallback: 1 / 30; held preparation,
  model-startup failure and successful replacement: 1 / 38.
- Staging cleanup fault: 1 / 11; narrow UI timeout acknowledgement: 1 / 15.
- Final source catalog: 2 / 10; three configured typechecks and workflow check pass.
- Bounded source reviews cleared both cleanup and false-open P2 findings.

No full suites were run. Browser/vendor assets and archive bytes remain trusted
installation content, not integrity-qualified. Staging writes may finish after
revocation but cannot publish; close joins cleanup. These tests establish neither
power-loss resilience, a general filesystem sandbox nor exactly-once file/UI
effects. No deployment, restart, merge or migration occurred.

# Shared host-operation authority — targeted refactor

Plan, Code Review, editable tables and Office Viewer now use one operation
authority implementation. Plan alone adds its chat-scoped extension-KV metadata.
The other adapters no longer depend on a Plan KV capability for unrelated work.
The four SQL queries and current version/source/harness predicates are unchanged;
readonly writes still reject before callbacks, and writes retain IMMEDIATE
transactions with pre/post checks and rollback. No new grants or registry.

Targeted receipts: 8 passing tests / 286 assertions across direct authority tests,
four actual tool paths and installed Plan KV. Runtime, engine and qualification
types pass; the new direct test is explicitly included in qualification types.
Independent bounded review is READY. Only Plan-specific diagnostic text became
generic. No full suites, dependency changes, services, migration or activation.
Details: /workspace/reviews/durable-1650/host-operation-authority-refactor.md.

# Office viewer vendor containment — targeted hardening

Native Office qualification now selects add-on source
2f32f17ebc70ff1d0e2ad1892382813d29ccbd16 through DURABLE_OFFICE_VIEWER_ROOT,
separate from historical fixture pins. The static route rejects escaping
canonical vendor symlinks before serving; normal/contained GET and HEAD, headers,
missing assets and traversal behavior are preserved. Two selected route tests
pass 37 assertions, scoped types and source review pass. Updated core catalog
5/15 and actual default-runtime viewer1/33 pass; workflow contract passes.
No full suites were run. Browser decoding/vendor integrity beyond this path
check and parent-directory replacement races are not qualified. No live changes.

# Native Office Viewer — targeted execution port

The default application reuses the exact registered open_office_viewer execute
from approved 0.1.3 source. No replacement factory, fabricated ExtensionContext,
or process-wide cwd change is introduced. The operation-owned adapter accepts
only canonical workspace-contained regular files from current foreground web
message sources, passes an absolute path to the original synchronous tool, and
rechecks source, branch, cancellation, lifetime and single-user authority.

Targeted receipts in /workspace/reviews/durable-1650/:
- Catalog: 5 pass / 15 assertions (approved/tamper/shadow/execute/schema).
- Actual default-runtime happy case: 1 pass / 33 assertions, including viewer URL,
  raw-file handler response, unchanged bytes and invalid/outside-workspace paths.
- Post-capture cancellation: 1 pass / 20 assertions, no successful viewer result.
- Three configured typechecks and diff checks pass. Bounded review is READY.

Exact manifest/index source is qualified; vendor assets are trusted installation
content, not integrity-qualified. Browser document decoding, vendor-asset responses
and status-hint rendering were not tested. The reviewed route hardening at add-on commit 2f32f17 rejects vendor symlinks
whose canonical targets escape the vendor root before stat or Bun.file. No full candidate/root
suite was run, per operator direction. No deployment, restart, merge or migration.

# Native Delegate caller image attachments — targeted qualification

The guarded reader accepts JPEG, PNG, GIF and WebP only for an exact approved
physical model with explicit image input support. Text remains supported. The
existing 0–10 path and 100,000 aggregate actual-byte limits are unchanged. Sharp
validates all frames with a 4MP input limit and five-second processing timeout;
no dependency was added. Public SDK image blocks retain the original bytes.

Current physical model identity/API and image capability are rechecked after
authorization and after real credential resolution, before dispatch. A reopened
conversation retaining committed image history cannot continue through a now
text-only physical model. Accepted attachment replay still avoids file rereads.
This is caller input, not generated-media authority or exactly-once billing.

Targeted receipts under /workspace/reviews/durable-1650/:
- image-final-default-scenario.log: 1 pass / 45 assertions; image goes only to
  the selected capable child, not its text-only peer or parent.
- image-capability-final-focused.log: 1 pass / 32 assertions; user/tool-result
  revocation during authorization/post-auth, text compatibility and persisted
  image-history reopen/continuation denial.
- images-reader-final-targeted.log: existing text reader passes 1 / 53 assertions.
- image-final-{engine,qualification,root}-types.log: configured types pass.

Bounded source review cleared the dispatch-capability P2 after its fix. Earlier
held-admission test deadlock was replaced with committed-history recovery; no
queued-unsent recovery claim. No full candidate/root suite was run. Standard
tool permissions, capped accounting refusal and the accepted post-transform
microtask gap remain unchanged. No activation, restart, merge or migration.

# Native editable-table port — targeted qualification

The default application uses the installed editable-table public factory through
an invocation-owned widget port. Legacy registration calls the same factory; its
duplicate execute body is removed. Existing `extension_ui_widget` events and normal
Markdown message submission are unchanged. No ExtensionContext is fabricated.

Publication requires an exact foreground web source, current operation/harness,
active branch and live attached channel. Root and branch request-handler SSE tests
include an edited-Markdown roundtrip. Missing/closed channel, nonweb source,
revocation, archival and stale harness generation emit no widget. Application
routing now rechecks active real branch IDs, retaining the existing synthetic
`main` fixture contract. Archived work cannot settle through a stale route.

Reviewed add-on source: `554d61cf495b8aba317964b8ae400fb52b0f91e3`.
Targeted final checks: root/branch 29 assertions each; archival/stale harness 26
each; synthetic-main compaction compatibility 1 pass / 209 assertions. Existing
catalog coverage has 13 source/metadata/cache cases. Add-on tests pass 9 / 20
assertions. All three configured typechecks and the workflow contract check pass.
Receipts are under `/workspace/reviews/durable-1650/` (`resume-native-editable-table*`,
`editable-final-synthetic-main.log`, `editable-final-*-types.log`).

No full candidate/root suite was rerun for this slice, per operator direction.
Interrupted broad batches are not qualification receipts. These are in-process
HTTP request-handler/SSE-stream tests, not listening-socket/browser acceptance,
durable widget delivery, or exactly-once publication. No live installation,
restart, merge or migration occurred. The 45-requirement acceptance gaps remain.

# Native Delegate standard-tool recovery follow-up

Two additional actual-factory tests hold the real unsafe host write before and
after its filesystem effect. Cooperative close/reopen retains the same owned
child and one accepted child input. The write syscall count stays zero or one;
unsafe execution is not replayed and the tool reports an interrupted error.
The host recovery gate first rejects the unknown pending child; the subsequent
explicit public SDK recovery does not qualify automatic production recovery.
These are separate candidate-file fixtures, not a one-root-DB or SIGKILL claim.

The complete candidate suite passes 527 tests / 7,546 assertions, exit 0
(`delegate-standard-recovery-candidate.log`). Focused factory tests pass 27 /
321 assertions; qualification types and bounded independent review pass. No
production source changes are part of this follow-up.

# Native Delegate standard tools — source candidate over `1241cdde0`

The actual default factory accepts explicit `tools: "standard"` with exactly seven
existing guarded Linux host tools: `read`, `bash`, `edit`, `write`, `find`, `ls`,
`grep`. It snapshots their registrations before appending add-ons. Omitted tools
and `read_only` keep exactly four readers: `read`, `grep`, `find`, `ls`. Explicit
comma-separated exact names select subsets of the seven. `full`, unknown names,
recursive Delegate, Plan, Code Review and MCP/add-on tools are not qualified and
reject; children receive none of those registrations.

Child extensions have no hooks or sections and contain only approved tool objects
by membership check. The public child `AgentDoc` configures `tools`, `modelTools`
and the selected extensions atomically. Existing owner, source, selected-model,
availability and cap checks apply per request and at effects. This reuses the
parent's single-user host policy, including approved absolute filesystem paths;
it adds no sandbox, permission framework or root ToolContext emulator.
Cancellation cannot undo already-admitted writes. Child tools retain unsafe replay
handling in the SDK; exactly-once writes and standard-specific crash/reopen are
unqualified. Existing native/deadline recovery tests retain their narrower scopes.

Existing evidence in `/workspace/reviews/durable-1650/delegate-standard-tools-checkpoint.md`:

- Actual factory: `native-delegate-standard`, 43 assertions with writes/readback;
  `native-delegate-readonly-deny`, 43 with unchanged bytes after attempted writes;
  `native-delegate-standard-revoke`, 38 with no filesystem write after cap
  revocation following child source capture.
- Retained `native-delegate`: 33 assertions; reader cap/provider revocation:
  48 each. Focused tests: 25 pass / 276 assertions; three scoped typechecks pass.
- `delegate-standard-full-candidate.log`: 525 pass / 7,501 assertions, exit 0.
  `delegate-standard-full-root.log`: 7,312 pass, 74 baseline skips, 0 fail;
  25 feature + 9 build tests pass, `EXIT_CODE=0`.

All 45 statuses stay 22 source-qualified / 17 fixture-only / 3 blocked-publicAPI /
3 migration/perf-unverified. Images/renderable binary attachments, full MCP/add-on
profiles, numeric global parallelism and native capped accounting are unqualified;
enabled caps still deny. Selected-auth/live-provider and public root SDK limits
retain their existing boundaries, including exact-running abort gaps. All-nine
Code Review stays core `4e1ffe2fe` / add-on `d1ce8c6f` (PR #208), without a new
worker. Migration stays last; no live activation or version/pin change. This
refresh changes documentation only; no code, test, CI, network, service or commit
operation ran.

## Published text attachments and fixture WAL policy — `1241cdde0`

The preceding attachment/WAL slice is published at `1241cdde0`; its local receipts
below predate the standard-tools candidate. Native Delegate accepts 0..10 explicit
workspace text files, including empty `files: []` without attachment IO, under the
approved attachment reader policy. Images/renderable binary attachments remain
unsupported. No future source hash is assigned.

## Measured fixture-policy repair

Two external instrumented runs measured 20 body COMMIT calls at 1.959 / 2.442
seconds: 99.4% / 99.5% of the corresponding public adapter transaction time,
not total test time. Both timed out at the unchanged 5,000 ms limit. No syscall
trace or fsync attribution exists. The fresh separate candidate used the default
DELETE journal policy by source/default inference; the observer did not measure
PRAGMAs. Production initialises its shared file root with WAL. Measurements and
instrumentation limits: `/workspace/reviews/durable-1650/baseline-sqlite-timing.md`.

Qualification-only `src/sqlite-fixture-policy.ts` aligns the historical fixture
files to WAL. The copied native host uses existing `enableSqliteWal`, retaining
its busy timeout. The standalone candidate uses public adapter SQL. Both require
`synchronous=FULL` (2) before setup, explicitly set FULL and verify 2 afterwards,
including every reopen. Production constructors and journal helpers are unchanged.
No NORMAL/OFF setting, tmpfs substitution, timeout increase or assertion reduction
was used. These legacy two-database component fixtures remain separate; they do
not qualify shared-schema atomicity. Actual one-database application behaviour
has separate existing tests.

Receipts under `/workspace/reviews/durable-1650/`:

- `wal-policy-test.log`: 2 pass / 18 assertions, covering WAL sidecars, FULL,
  busy-timeout preservation, rollback and physical reopen.
- `wal-runtime-test.log`: 54 pass / 477 assertions; largest case 2.89 seconds.
  `wal-bindings-test.log`: 9 pass / 74 assertions, run sequentially afterwards.
- `wal-sqlite-conformance.log`: unchanged rollback-journal `sqlite.test.ts` plus
  the new policy tests, 35 pass / 273 assertions. No conformance test changed.
- `wal-addon-graph-focused.log`: 4 pass / 150 assertions across 3 files. The
  actual add-on graph now uses `openWalFixtureDatabase` too.
- FULL fixture-policy source review is READY. These results establish neither
  power-loss durability nor additional SIGKILL coverage or production performance.
- `attachments-final-candidate.log`: 517 pass, 0 fail, 7,427 assertions across
  44 files, 266.49 seconds, `EXIT_CODE=0`.
- `attachments-final-root.log`: 7,312 pass / 74 skip / 0 fail, plus 25 feature
  and 9 build tests; normal `make` completion. The outer wrapper was interrupted;
  no exit-code receipt exists, so root `EXIT_CODE=0` is not established.
- `attachments-final-{engine,qualification,root}-types.log`: all three pass.

The failed pristine-host-image optimisation was reverted. Its old checkpoint
records an abandoned experiment, not additional unpublished setup code. Full
policy details: `/workspace/reviews/durable-1650/wal-fixture-policy-checkpoint.md`.

## Bounded text attachment source

`host-delegate-files.ts` reads canonical regular files within the captured workspace
root. Lexical and canonical containment checks preserve the legacy workspace
policy. Nonblocking descriptor opens use `O_NOFOLLOW` on the final component.
Canonical parent-directory replacement races are not prevented; this reader is
not a general filesystem sandbox. Bounded descriptor reads count actual aggregate
bytes, up to 100,000 across all files, with an overflow probe. Overflow rejects
without truncation. Invalid UTF-8, NUL, disallowed controls and recognised
binary/image signatures reject. UTF-8 SVG enters as text, without image rendering.

The default factory captures the host-owned reader callback and workspace root.
Source, owner, lifetime, cap, selected-model and deadline guards run at actual
open/read boundaries and after reading. Validation and materialisation precede
the first new child creation. No legacy CLI `execute` or fabricated ToolContext
runs. Logical path labels mark contents as untrusted data. Failures return
`Delegate attachment unavailable` without raw filesystem errors. Normal SDK child
input persists contents; no new content logging is added.

Replay reconciles public owned child/request state before attachment IO. Accepted
input stays authoritative after source-file mutation and is reused without rereading.
Public SDK request-ID deduplication checks submission type, not content equality,
including queued input. No 100 KB memo, new ledger or parallel queue is introduced.

Existing receipts under `/workspace/reviews/durable-1650/`:

- `delegate-files-final-focused.log`: 21 pass, 0 fail, 257 assertions across helper
  and consumer/deadline/source tests, including the empty-list regression. The
  previous 20 / 238 receipt predates that regression.
- `delegate-text-attachments-checkpoint.md`: actual-default `native-delegate-files`,
  1 pass / 38 assertions. One of two isolated children receives the attachment;
  the other does not, and the parent model is unchanged.
- All three scoped types pass (`delegate-files-{engine,qualification,root}-types.log`).
  Source review and the empty-list follow-up are READY within their stated scope.
- Historical pre-policy full candidate: 512 pass / 3 timeouts. Later pre-policy candidate
  `delegate-files-quiet-candidate.log`: 510 pass / 5 timeouts, exit 1. Historical root
  `delegate-files-serial-root.log`: 7,311 pass / 74 skip / 1 note-indexing failure,
  exit 2; that note workflow passes its focused rerun. These failed attempts are
  historical; final qualification receipts above supersede their publication hold.
- Baseline comparison: `delegate-files-baseline-intents.log` reproduces a timeout
  on unchanged published source. The unsuccessful host-fixture-copy experiment
  was fully reverted. HISTORICAL hold: `/workspace/reviews/durable-1650/delegate-text-qualification-hold.md`;
  final qualification above supersedes it.

Images, tools beyond the bounded standard profile, native capped accounting and
numeric global concurrency are unqualified. All 45 statuses stay 22 source-qualified / 17
fixture-only / 3 blocked-publicAPI / 3 migration/perf-unverified. The 17 fixture-only
requirements need acceptance; production performance is unverified and migration
stays last. All-nine Code Review scope stays core `4e1ffe2fe` / add-on `d1ce8c6f`
(PR #208), with one application database and no JSONL. Documentation-only refresh:
no code, tests, CI, network, services, pins, migration, commit or push operations.

# Historical native Delegate explicit-model checkpoint — published `b258ff3a2`

Native Delegate accepts an explicit exact approved `provider/model` choice.
This follow-up over `98e0676af` is published at `b258ff3a2`. Its completed
qualification receipts predate the text-attachment source above.

Explicit selection matches the captured approved available physical catalogue and
rechecks current host policy. The installed actual `buildModelCandidates` supplies
approved-provider, ordered classification and exclusion checks; no new policy map
was added. Automatic selection still inherits the parent. Explicit selection uses
the existing CLI `validateExplicit` semantics: it can override the automatic
parent-tier restriction, including a higher-tier model, but grants no additional
approval. IDs split at the first slash, preserving slashes within model IDs.
Short, fuzzy, virtual, empty, non-string, unavailable, unclassified and excluded
provider/model choices fail without a fallback child.

Public `api.memo("model", …)` pins the choice on replay. Current source/model
assertions run before creation and after settlement. Child generation,
post-authentication `transformHeaders` and filesystem-effect guards check the
actual selected child model. A different physical child model leaves the parent
on its root model. Existing absolute persisted deadlines and ownership scopes
are unchanged.

Existing receipts under `/workspace/reviews/durable-1650/`:

- `delegate-explicit-current-tests.log`: 43 pass, 0 fail, 167 assertions across
  two files. Thirteen actual-default explicit cases cover parent, smaller,
  higher-tier and slash-bearing IDs, plus unavailable, unclassified, excluded
  provider/model, non-string, empty, short, fuzzy and virtual rejection. Invalid
  cases create no child and do not fall back. Cap/provider revocation scenarios
  now use explicit different-model child B and check policy against B.
- `delegate-explicit-{root,engine,qualification}-types.log`: all three scoped
  typechecks pass after correcting the fixture's `unknown` JSON type. Earlier
  initial test failure used the wrong `DURABLE_CODE_REVIEW_ROOT` source hash;
  no assertion or policy was weakened.
- `delegate-explicit-full-candidate.log`: 510 pass / 7,292 assertions, 42 files.
  `delegate-explicit-simplified-root.log`: 7,312 pass, 74 baseline skips,
  0 fail, plus 25 feature and 9 build tests. Both inner runs completed normally;
  interrupted outer wrappers supplied no exit-code receipts.
- Two earlier full-root attempts timed out in scheduled-store/retention tests.
  Their focused rerun passed 38 tests. The ordering-only retention fixture now
  derives 100 valid receipt pairs from one real failed run, preserving parser,
  assertions and 15-second budget; no production durability setting changed.

Published CI fix `98e0676af` separates historical add-on fixtures
(`DURABLE_ADDONS_ROOT`, `de92bc95b5b3bb1505beec9617d3b8a5e4fa92d3`) from native
Code Review source (`DURABLE_CODE_REVIEW_ROOT`,
`d1ce8c6f2e5ea6d5330728aa8a6a3684bf5c3d4f`) in separate checkouts. Previous hosted
core failures came from the source-hash mismatch. Exact-head hosted status is
green for `98e0676af` (run `39086238913`). The supplied exact-head check for
`b258ff3a2` returned PR `statusCheckRollup: []`; no hosted run is established for
that head. The older green run cannot qualify a later head. No hosted query ran
for this documentation refresh.

All 45 statuses stay 22 source-qualified / 17 fixture-only / 3 blocked-publicAPI /
3 migration/perf-unverified. At this historical checkpoint, attachments,
wider-than-read-only tools and any enabled Delegate cap still deny; numeric global concurrency and native capped request
accounting are unqualified. Scheduler model overrides are implemented at
`e3d248a01`, with candidate 493 / 7,255 and root 7,312 + 25 + 9 passing, exit 0.
Deadlines are published at `e5ca1b67d`; all-nine Code Review source stays core
`4e1ffe2fe` / add-on `d1ce8c6f`. The 17 fixture-only requirements, three exact
atomic running-abort gaps and production performance still need acceptance.
Migration stays last. This refresh changes documentation only: no code, test, CI,
pin, network, service, live-state, migration, commit or push operation ran.

# Historical scheduled model-override checkpoint — published `e3d248a01`

Native EF-S07 schedules now resolve captured `model_label` values from the canonical
task revision to an approved, currently available physical model through the root
ModelRuntime. Resolution performs no LLM request or credential lookup. The source
guard rechecks source and model approval before the public fork commit. The
scheduler change is published at `e3d248a01`; its completed full-gate receipts are
below. The later published attachment/WAL slice and current standard-tools candidate
have separate evidence above.

The allocator captures an immutable choice, checks the inherited context, copies
the parent's `AgentDoc` and configures the fork model in the same public SDK commit
as the host binding. The main conversation is never temporarily mutated. Only the
separate legacy path uses switch/restore. A shared conservative context-fit helper
replaces duplicated logic in the existing idle model SET path. Missing metadata,
images and dynamic prompt sections fail closed; they are not supported context-fit
cases. This bound does not establish that every future host prompt fits.

Existing receipts under `/workspace/reviews/durable-1650/`:

- `scheduler-model-actual.log`: actual native-scheduler consumer, 1 pass / 73
  assertions. Empty, dynamically added and nonempty main roots retain their
  history/model; the nonempty A100k main uses a B200k fork whose model ID contains
  a slash. Invalid/unavailable labels allocate no fork, invoke no provider and
  produce error receipts. Ordinary main A still works after physical reopen.
  Existing cap-revocation guards are retained.
- `scheduler-model-focused-final.log`: 96 pass, 0 fail, 2,477 assertions across
  three files. Missing resolver, tiny/unavailable models and immutable choice
  capture are covered alongside the existing idle-model and public model bridges.
  This mixed total is separate from the actual-native scenario above.
- `scheduler-model-{root,engine,qualification}-types.log`: all three scoped types
  pass. Bounded source review is READY. No direct approval-revocation-during-await
  test was supplied; a complete revocation matrix is unqualified.
- `scheduler-override-full-candidate.log`: 493 pass / 7,255 assertions, exit 0.
  `scheduler-override-full-root.log`: 7,312 pass, 74 baseline skips, 0 fail;
  25 feature + 9 build tests pass, exit 0.

PC-012 gains bounded model-override coverage. All 45 statuses stay 22
source-qualified / 17 fixture-only / 3 blocked-publicAPI /
3 migration/perf-unverified. Enabled applicable scheduler caps and all enabled
Delegate caps still deny; native capped request accounting is unqualified.
Delegate explicit different-model selection now has the bounded source coverage
above; attachments rejected at this historical checkpoint. Other add-ons, the 17 fixture-only requirements
and production performance need
acceptance. Migration stays last. No code, test, CI, pin, network, service,
migration, commit or push operation ran for this documentation refresh.

# Historical native Delegate deadline checkpoint — published `e5ca1b67d`

The current native Delegate accepts `timeout_sec`: default 120 seconds, integer
10..300. Validation precedes child allocation. Public `api.memo("deadline", …)`
persists an absolute operation-entry expiry before source capture or model approval
awaits; replay cannot renew it. The deadline change over core `4e1ffe2fe` is
published in `e5ca1b67d`; it precedes the published scheduler model overrides and
current Delegate explicit-model follow-up above.

The child wait races the remaining deadline. Cleanup clears the timer on success,
error, cancellation and timeout. Timeout calls the invocation-bound owned
`child.abort` and joins its work; the parent and siblings retain their own scopes.
Provider abort is cooperative; a non-cooperative provider can prevent the join
from completing. There is no force-kill guarantee.

Expired replay creates no new child or input. It aborts and joins an existing
owned child unless its submission already has a committed `done` answer; that
answer is reused after expiry, preserving its result. SDK recovery can restart an
already-owned provider before the parent replays, after which the expired parent
aborts that child. The reopen test permits 3..4 physical provider requests and
checks one durable input per child; it does not establish exactly-once execution
or billing. It explicitly reads public `TaskRecord.memos.deadline` for both child
owner tasks before and after physical database close/open and compares the values
unchanged.

Existing receipts under `/workspace/reviews/durable-1650/`:

- `deadline-memo-final.log`: 17 pass, 0 fail, 202 assertions across two files.
- `native-delegate-deadline-checkpoint.md`: actual-default
  `native-delegate-timeout` scenario, 1 pass / 35 assertions, including an explicit
  valid 10-second deadline, manually fired timer, cooperative provider abort,
  successful sibling and completed parent. This is a prior receipt, separate
  from the 17-test focused run.
- All three scoped typechecks pass. Final `deadline-quiet-candidate.log`: 492 pass,
  0 fail, 7,245 assertions, `EXIT_CODE=0`. `deadline-quiet-root.log`: 7,312 pass,
  74 baseline skips, 0 fail, plus 25 feature and 9 build tests, `EXIT_CODE=0`.
- The timer-registration race in the original test is fixed with a registration
  barrier (`deadline-actual-synchronized.log`: 1 pass / 34 assertions). Earlier
  disk/rollback and note-retrieval timeout failures remain in their logs; no
  assertion, timeout or resource limit was weakened.
- Historical hosted core failures were traced to add-on source-hash mismatch;
  published `98e0676af` separates those checkouts. Its exact-head hosted status
  is awaited; no hosted query ran for this refresh.

At this historical checkpoint, attachments and read/write or full Delegate tools reject. Explicit exact
model selection has the bounded source coverage above. Any enabled budget cap
denies; native request accounting is unqualified. Numeric global concurrency is not implemented. All 45 statuses stay
22 source-qualified / 17 fixture-only / 3 blocked-publicAPI /
3 migration/perf-unverified. Child deadlines do not fix the atomic exact-running
parent cancellation gap in HC-009/PC-004/PC-015. No activation or migration ran.
This documentation refresh runs no tests, network requests or service operations
and changes no code, tests, CI, source pins, commits or pushes.

# Historical native Code Review: all nine model-tool actions — published `4e1ffe2fe`

The actual default factory admits all nine registered Code Review actions:
`dispatches`, `dispatch`, `thread`, `threads`, `reply`, `edit`, `deleteMessage`,
`resolve` and `work`. The native profile reuses the original registered declaration
and description; its custom description was removed. No parallel UX was added.

`work` synchronously changes assigned-item state through `updateWork`. It creates
no provider request, job, worker or delivery. Legacy `reviewAction` and the native
factory use the same `runCodeReviewMutation` helper; the old duplicate `work` case
was removed. The add-on source delta is 30 lines in / 30 out. The existing root
`IMMEDIATE` transaction checks current accepted source/harness and trusted dispatch
authority before and after mutation. Assignment epoch, current dispatch, item and
thread versions bound the state change. Idempotent receipts recheck authority;
revocation before root commit rolls back the mutation and receipt.

All-nine Code Review source was published at core `4e1ffe2fe`. Current worktree
HEAD is `1241cdde0`; its uncommitted source/test changes belong to the separate
Delegate standard-tools candidate above. Scheduler overrides are published at
`e3d248a01`.
Add-on PR #208 and the core qualification CI checkout select
`d1ce8c6f2e5ea6d5330728aa8a6a3684bf5c3d4f`. This qualifies source only; installed
package pins and versions are unchanged. No live installation or hosted success
is established by these receipts.

Exact previous Code Review receipts under `/workspace/reviews/durable-1650/`
(historical receipts, separate from the final attachment/WAL qualification above):

- `code-review-work-actual.log`: actual-default 1 pass / 59 assertions, including
  `work` → `in_progress`, stale-item and cross-chat denial, `completed` after the
  agent's own resolution, physical database close/reopen and a fresh native read.
- `code-review-work-addon.log`: focused add-on 44 pass / 405 assertions.
- `code-review-work-addon-full.log`: 206 pass, 3 skip, 0 fail, 2,602 assertions,
  60 files, 86.35 seconds, `EXIT_CODE=0`.
- `code-review-work-{root,engine,qualification}-types.log` and
  `code-review-work-addon-scoped-types.log`: three core typechecks and scoped
  add-on types pass. Bounded scope review is READY.
- `code-review-work-final-candidate.log`: 485 pass / 7,182 assertions; inner
  candidate run completed normally without an outer exit-code receipt.
  `code-review-work-final-root.log`: 7,294 pass, 74 baseline skips, 0 fail;
  25 feature + 9 build tests pass; `EXIT_CODE=0`.

All 45 IDs/statuses stay unchanged: 22 source-qualified, 17 fixture-only,
3 blocked-publicAPI and 3 migration/perf-unverified. Full API/tool source adoption
does not qualify every PC row. Operator/browser dispatch queue and delivery through
durable ingress still need representative acceptance. Earlier root direct-API tests
and the actual new shared read establish bounded core behaviour without a provider;
they do not establish that ingress/delivery path. No missing `work` worker is required.
Delegate explicit different-model selection and deadlines use the bounded profiles
above; attachments rejected at this historical checkpoint; enabled budget caps still reject. Scheduler model overrides
have the bounded source coverage above; native capped accounting, other add-ons/events, exact atomic current-task cancellation, the 17
fixture-only requirements and production performance
still need acceptance. Migration stays last: preserve the old `reviews.db`; no copy
or conversion ran. This refresh changes documentation only, with no code/test/network,
CI/service/pin/version, commit or live-state changes and no test reruns.

# Historical native Code Review local writes — source over `2641f073f`, add-on `10e8580`

The following eight-action receipts predate the current all-nine source above;
`work` refusal and proposed worker requirements below describe that older checkpoint.

The actual default factory admits `dispatches`, `dispatch`, `threads`, `thread`,
`reply`, `edit`, `deleteMessage` and `resolve`. The public add-on factory and legacy
`reviewAction` call the same synchronous `runCodeReviewMutation` helper and service
methods. The helper replaces 72 lines of duplicate legacy mutation cases. Native
writes use the existing borrowed application root; no extra queue or job ledger
was added. `work` still refuses before service lookup.

## Mutation authority and rollback

The adapter captures the exact accepted EF-S01 source, running public tool call,
claimed operation, current harness/version and original trusted local-dispatch
marker. Caller fields cannot replace the dispatch-bound identity. Arguments are
cloned before awaiting policy resolution; the returned authority and nested
identity/reference are frozen. The existing `createPlanKvAuthority` write wrapper
opens a root `IMMEDIATE` transaction. Current source/harness and trusted dispatch
scope checks run inside it before and after the synchronous mutation. A revoked
owner or stale source denies the write; post-callback revocation rolls back nested
store transactions, including messages, versions, events and request receipts.
An existing request receipt cannot bypass renewed authority checks.

## Historical source and supplied receipts

Core HEAD is `2641f073f` with native-write WIP. Add-on PR #208 source and the
qualification CI checkout select
`10e8580ca42f0f9b94006598f642d72c70be8420`. Source hashes are frozen while gates run.
This checkout qualifies source; it does not change the installed dependency or
establish deployment, migration or hosted CI success.

Existing receipts under `/workspace/reviews/durable-1650/`:

- `code-review-write-actual.log`: 1 actual-default scenario passes 52 assertions:
  reply, idempotent replay, stale/cross-chat denial, edit, delete, resolve and
  refused `work`; persisted reads still work after physical close/reopen.
- `native-tool-mutation.test.ts`: four real-backend cases cover revocation after
  asynchronous policy resolution, revocation before root commit with nested-store
  rollback, revoked request-receipt replay and caller identity override denial.
  The supplied focused add-on scope passes 28 tests / 262 assertions.
- `code-review-write-addon-final.log`: 202 pass, 3 skip, 0 fail, 2,568 assertions
  across 60 files in 86.19 seconds, `EXIT_CODE=0`. Add-on types pass.
- `code-review-write-{root,engine,qualification}-types.log`: all three core
  typechecks pass. Independent bounded local-mutation review is READY with no
  P1/P2 findings; it does not qualify budgets or new LLM execution.
- `code-review-write-final-candidate.log`: 485 pass, 0 fail, 7,182 assertions,
  `EXIT_CODE=0`. `code-review-write-final-root.log`: 7,312 pass, 74 baseline
  skips, 0 fail; 25 feature + 9 build tests pass; `EXIT_CODE=0`.

All 45 statuses stay 22 source-qualified, 17 fixture-only, 3 blocked-publicAPI and
3 migration/perf-unverified. HC-002 expands its bounded source scope to local
review mutations. At this older profile `work` was refused. Published all-nine
source above
implements it as a synchronous assigned-item mutation, without a worker, provider
request or job. Durable ingress/delivery acceptance and request budgets remain
separate obligations. Scheduler model overrides/request caps and generic exact-running abort gaps also remain.
Existing `reviews.db` migration stays last; the store is preserved. No tests,
network, service operations, CI/pin edits, deployment, migration, commits or pushes
ran for this documentation refresh.

# Native Code Review reads — historical source at `2641f073f`

The following receipts qualify the older read-only profile at add-on `a1a165c`;
the write-source receipts above have a separate boundary.

The actual default factory now admits bounded installed Code Review reads through
`runtime/durable-engine/src/host-code-review-tool.ts`. The add-on public
`createCodeReviewTool` factory owns the declaration and read execution; extraction
removed the duplicate declaration/execution from its old index. Native reads and
the direct operator add-on API use the same backend and borrowed application root
connection. No second database is opened. Fifteen `addon_code_review_` data tables
and `addon_code_review_schema` isolate its schema; the borrowed path neither reads
nor writes host `PRAGMA user_version`, changes host PRAGMAs nor closes the root.
The standalone `reviews.db` path stays available for legacy compatibility and is
unused by this native source path. No existing review store was converted.

## Read authority and lifecycle

At this read-only checkpoint, only `dispatches`, `dispatch`, `threads` and `thread`
were admitted. Writes and caller-supplied authority fields refused before source
capture or service lookup.
The root adapter captures the exact public running tool call, accepted source,
current claimed operation and running harness. It reads the original accepted
message's single `addon_local_dispatch` marker and verifies its content hash,
chat/incarnation and intent against `addon_local_dispatch_authorities`. Current
source/assignment SQL and the add-on's dispatch/thread scope checks bound reads.
Model-supplied IDs select data within that grant; they cannot grant access.
Unscoped and peer-message sources reject.

The database binding captures the original owner callback. Backend close releases
and revokes that binding before joining closure. Old services and awaited enqueue
continuations retain their old grant and fail closed after release; a later
backend cannot lend them its new authority. The add-on public factory rechecks
invocation-local authority around awaited reads; no fabricated legacy session or
ExtensionContext runs. Supplied bounded source reviews are READY after the callback
capture fix and missing-case coverage.

## Exact source and existing receipts

At this historical checkpoint, CI used one merged add-ons snapshot, `08746aa3f114d49f954c1dff712d9f74acca460f`,
through `DURABLE_ADDONS_ROOT` for every fixture. It replaces the five earlier
checkout sources and per-feature root variables described in historical receipts
below. Code Review, editable table, Office Viewer and Draw.io directories are
byte-for-byte identical to their previously qualified feature commits; all source
hash guards are unchanged. Plan and other add-ons use this same checkout.

The catalogue checks 13 backend source files, canonical resolution, declaration
and registered objects against public add-on source
`a1a165c0ba9ea051584f828392c5061cda91dd2a`, branch
`implement/durable-code-review-1650`. The qualification CI checkout selects that
exact source and supplies `DURABLE_CODE_REVIEW_ROOT`; this is source qualification,
with no dependency upgrade, live installation or version release. The add-on
package version stays 0.1.8. No future core commit is assigned to this source
follow-up over `7150dd6a2`.

Existing receipts under `/workspace/reviews/durable-1650/`:

- `code-review-physical-reopen.log`: actual default native scenario, 1 pass /
  44 assertions. All old runtime objects close, the physical root closes and
  reopens, and a fresh backend reads a newly scoped dispatch. A real existing
  other-chat thread/dispatch is denied and its secret stays out of results,
  provider transcripts, entries and bot messages. Refused writes leave saved
  review messages unchanged; the fixture creates no `reviews.db`.
- Catalogue: 4 pass / 18 assertions in `/tmp/review-catalog-debug.log`.
- `code-review-extracted-final-addon.log`: 198 pass, 3 skip, 0 fail,
  2,525 assertions across 59 files, 84.08 seconds, `EXIT_CODE=0`.
  `code-review-extracted-final-types.log` records passing add-on types after
  factory extraction. These add-on results are separate from native job acceptance.
- `code-review-final-{root,engine,qualification}-types.log`: all three scoped
  core typechecks passed according to the supplied receipts.
- `code-review-final-candidate.log`: 485 pass, 0 fail, 7,182 assertions across
  42 files. The interrupted wrapper supplied no exit-code receipt.
- `code-review-final-root.log`: 7,312 pass, 74 baseline skips, 0 fail, plus
  25 feature and 9 build tests; `EXIT_CODE=0`.

The 45 statuses stay 22 source-qualified, 17 fixture-only, 3 blocked-publicAPI
and 3 migration/perf-unverified. HC-002 already had bounded source qualification
and now includes native Code Review reads. These read-only receipts did not qualify native review writes, dispatch workers,
request budgets or delivery. The local-write follow-up above qualifies only its
stated mutation scope.
Existing `reviews.db` migration stays last. No migration or live activation ran.

Published native Delegate is `ea2d1416e`; its receipt documentation is
`7150dd6a2`, with supplied exact-head hosted run `39073316535` green. Older
uncommitted Delegate WIP is separate and unapproved. Stale inactive comments in
modules were left untouched during code gates. No code, tests, CI, network,
services, pins, live state, migration, commits or pushes changed in this refresh.

# Built-in Delegate source migration — 15 November 2026

Core now owns the native Delegate declaration, model policy, existing config
namespace, model-catalogue API, Settings pane and default registration. Individual
and aggregate legacy backend/config/web entries are excluded before evaluation;
there is no installed-source qualifier or default Delegate archive dependency.
The published0.2.22 add-on is externally deprecated, with immutable release bytes.
Its subprocess-only adapter qualification is removed from the native gate and
replaced by actual Core fresh/no-addon and throwing-package scenarios. The original
seven source variants now prove pre-import exclusion instead of qualifying retired
execution. Other installed add-on/source assertions retain their original contracts.

Current-native config reads leave saved rows untouched. Authenticated writes reuse
the existing global KV admission/SQL/request-lifetime owner; held-writer cancellation,
revocation and late known-commit cases are tested. Native reopen preserves config
and does not dispatch a model. Model metadata comes from the current physical,
approved runtime catalogue; no CLI discovery, credential copying, auto-approval,
new store or execution lane is introduced. Native `judge`, `full`/MCP, recursive
children and non-model/nested calls retain explicit unsupported boundaries.

The established Settings list/editor, provider radios, filtering, exclusions,
Refresh, bounded model lists and accessibility remain. The pane loads as a separate
Core asset using the existing loader/registry and host Preact/hooks; the initial
bundle guard is unchanged. Save failures restore the prior values and use an
explicit alert state; success-message timers cannot erase later errors. Chromium
and WebKit each pass phone/desktop and light/dark scenarios (8 cases/232 assertions).
Raw frontend compilation retains281 existing out-of-seam diagnostics.

Exact-source full qualification and review are recorded separately. Earlier timed
all-installed results and UI failure receipts are retained; no deadlines/assertions
or source guards are waived. No installation, restart, live import or account/MCP
probe is performed. #2017 now requires an explicit read-only offline session importer
into a fresh separate v4 destination; in-place migrations and schema cleanup on
existing stores are forbidden. That independent work remains under #1650.

# Core Delegate declaration/policy checkpoint — 15 November 2026 (historical slice)

Under #1650 (including the consolidated #1455 acceptance), Core now supplies the
Delegate schema/description and pure approval/classification policy. The native
factory no longer accepts an installed `ToolDefinition`, and runtime approval no
longer imports the add-on's `buildModelCandidates`. Frozen0.2.22 schema/description
and nine policy configurations match the Core values exactly. SDK execution,
source/model fences, request deduplication, deadline/reopen and progress remain.

The real public schema exposed SDK coercion of fractional/string deadlines in two
existing negative cases. A public `prepareArguments` guard rejects these before
conversion/child admission. The original assertions and10-second test deadlines
remain unchanged. The initial failures and final passing runs are separate.

This is a local ownership checkpoint. The default factory still requires the
qualified installed package for configuration/Settings and registration identity.
It is not a complete no-addon delivery. Config/model discovery/Settings/guidance,
default wiring and pre-import backend/web/aggregate retirement remain owned by
this #1650 work. No new subprocess lane, state store or credential broker exists;
`judge`, `full`/MCP and recursive-child behavior retain their explicit native limits.
No relocation/type/test/generated-code reduction credit is assigned.

Focused checks:17 host tests/225 assertions;56 native cases across seven files,
including the actual all-installed factory; both private type projects and five
configured Root type gates pass. Compose retains281 existing out-of-seam diagnostics;
raw frontend compilation is not clean. No full-suite/browser/port acceptance,
installation, restart, live account operation or publication follows from this slice.

# Native Delegate adoption — historical source follow-up over `175032611`

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
  `standard`/`full` tools and nonempty `files` reject explicitly. Every `timeout_sec`
  rejected in this prior profile; the current deadline follow-up above accepts
  integer 10..300 with default 120.
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
Those receipts predate native Delegate adoption. Its later publication and
supplied hosted receipt are recorded in the Code Review source section above;
no network query ran for this refresh. The 45 assessment stays 22 source-qualified,
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

- This historical scheduler profile rejected model overrides with `Scheduled model
  override unavailable`. The current source follow-up above adds bounded fork-local
  resolution and validation.
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
wider model-override acceptance, native request budgets, cancellation and recovery
qualification; the current bounded override receipts are recorded at the top.
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
At this historical checkpoint, the source-only engine owned the candidate manifest, lock and node_modules
under `runtime/durable-engine`. This qualification package has only test/tooling
dependencies. Its public re-export files in the engine's `qualification/` directory
share the engine's physical candidate graph, including types; they contain no
compatibility or wrapper logic. Do not mix handles, contexts or TypeBox objects
with the root Pi 1.2.0 graph. The candidate API may
change without notice; exact 1.3.0 byte evidence does not qualify future versions.

## Historical execution setup

This first slice installed and typechecked the private engine before qualification tooling and ran a four-file candidate inventory. Use the [native gate runbook](../../docs/native-validation.md) for the complete required inventory and offline preparation. The original fixture preload used disposable HOME/workspace/store/agent paths and rejected direct test execution, network requests and credential lookups. Those JavaScript regression guards did not provide an OS security sandbox.

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
At this historical checkpoint, the engine was source-only, inactive and absent from the root package's file list.
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

## Historical observation-only host projection — retired

The unselected EF-S08 prototype below is retired under #1835. Its original
source and qualification results remain at
[`ed0e58042`](https://github.com/rcarmo/piclaw/tree/ed0e58042e99dac27f79bb15f685ff2b351d47d8).
Current native observation uses public SDK conversation watches/views and the
existing committed-terminal path; it never selected this prototype. The counts
and limits below are historical receipts, not current gate or runtime claims.
See [retirement evidence](../../docs/development/durable-projection-retirement-1835.md).

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

## Historical controlled cutover

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

## Historical application-owned engine extraction

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

### Historical application session-position map binding without JSONL

The isolated `AgentRuntimeFacadeOptions.durableSessions` map input in this
historical receipt is retired under #1837 (29 October 2026). Current routing already
uses the backend-owned `getDurableSession` callback; it does not accept a map
through `AgentPoolOptions`. Surviving fixtures now use that same lookup and
immutable backend-produced ports. The original counts and results below remain
historical; see [retirement evidence](../../docs/development/durable-session-map-retirement-1837.md).

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

## Native controls and terminal publication — 22 October 2026

[Native session controls](NATIVE-CONTROLS.md) records command routing, explicit unsupported controls, owned provider authentication and terminal-message provenance. Source tests, installation and live verification are separate gates; the historical receipts above do not qualify these changes.
