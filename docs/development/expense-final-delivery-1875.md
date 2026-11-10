# Expense-removal final delivery — in progress

The final delivery of #1875 is not qualified or merged yet. Current source has no expense-policy modules under `runtime/src/budget`, financial request owners, expense Settings panes or budget management routes. This pass removes the remaining inactive financial-report protocol and repairs actual SDK billing observations without adding an accounting service.

## Source boundaries

- Main before this work: `34516cabd8e56f61bd1b7150e0c87c244694533e`.
- Source includes the separately authorised Pi 1.5.1 compatibility changes. Root/private graphs remain separate and exact-pinned. No installed runtime, live database, profile, credentials or schedules are changed by this delivery branch.
- Add-on baseline: `2d4341f9ac604b674b16f7a90b6f19dcd4a82fe5`; canonical add-on checkout is older and is not modified.
- [Current baseline-path census](receipts/expense-final-census-1875.json): 105 original inventory entries, 36 removed paths and 69 present paths. This is a path/hash drift witness, not a grep-only claim of absence or completion. Actual callers, dynamic profiles, package archives and retained invariants still need final reconciliation.

## Current owned changes

- Remove `UsageProjectionEvent`, `UsageReportOrigin`, `encodeUsageReport`, `decodeUsageReport` and `readUsageProjectionEvent` from runtime. They have no current shipped caller. Keep the small report-column/row normaliser and structural historical-reference predicate used by token recording, chat cleanup and retention.
- Historical payload bytes, hashes, source rows, foreign keys and receipts remain opaque and unchanged. Tests keep duplicate/changed-key, missing-report/event, malformed hash/schema, reopen, Dream/orphan cleanup and retention guarantees without an executable financial protocol or repair owner.
- Preserve SDK `Usage.cost.totalFromProvider` on failed outcomes and recognise billed totals, including actual zero, independently of catalogue category estimates. Valuation still uses category estimates and cannot gate execution.
- Add plain observational provider-currency metadata. Do not infer the unit of arbitrary legacy native cost fields from the API-equivalent valuation currency. Aggregate only one explicitly known currency; unknown or mixed monetary totals are NULL while token counts, source facts and individual raw amounts remain available.
- Share the aggregate SQL projection instead of retaining four duplicated query bodies. Keep context polling on a covering index; replace only the exact old owned index, preserve unknown declarations and historical rows.
- Both skins label unknown provider units explicitly and preserve supplied zero. Every model selection shows its catalogue price indication or `Price unknown`; no new panel or interaction paradigm.
- Observability supports separate explicit-currency provider totals while preserving unknown-unit latest observations without summing them. Catalogue USD valuation remains a separate metric family.

## Retained consumers and obligations

`recordMessageUsage` consumes actual SDK terminal/provider facts; `storeTokenUsage` appends an idempotent passive row. Reporting write failure is observed and cannot decide execution. The existing model/source/auth/post-auth, task/lease, SQL, cancellation, outcome certainty and resource-lifetime checks survive.

Goal token budgets, context/output ceilings, provider-imposed quotas/errors and operational limits are nonfinancial. Historical table/reference declarations and bounded retention protect data; they do not create or interpret a financial execution lifecycle. Pricing references on main, including #1983, are observational and remain shipped.

## Qualification checkpoint

- Qualification types pass with SDK1.5.1. Storage fault wrappers forward complete batches, the receiver and the original commit context; direct seeding uses public `commitWrites`. The owner-fenced SQLite adapter implements `runCounted` through its existing transaction.
- Fresh isolated full scheduler fixture passes, including the actual60s expiry case. The fixture now uses the real default-factory lifetime contention policy; the initial12pass/1failure remains recorded. Production deadlines and resource policies are unchanged.
- Fresh SQLite admission workload and75SQLite checks pass. Lost-return/storage ACK and vertical execution tests pass with their original uncertainty, cancellation and non-replay assertions. Public package smoke and portable document-version1/2 migration,99forward-version refusal and factory reopen checks pass.
- Default-factory preparation retains the plain registry. The executing `HostConversationRuntime` installs the single task-source/cancellation adapter. The SDK still lacks the task-bound model callback required to remove that adapter; source identity and blocked-writer cancellation are current consumers.
- Add-on candidate46c1af7 has Delegate0.2.22 and Observability0.1.21;65tests/404assertions pass. Their public package URLs are not published yet. Core's old release seed remains unchanged pending publication; this branch is not ready for distribution.
- First full canonical native attempt at7df1dcb79 completed all152files:135passed,17failed. Both private type projects and accepted-source integration passed. The receipt is incomplete; focused reruns do not convert it to a full pass.
- Findings exposed SDK-upgrade gaps: conditional output margin, supported LiveDoc versions, streamed grep formatting, old Delegate fixture hashes/version, tagged watch fixtures, a ModelRuntime disposal stub and obsolete-index ownership. Corrected source/fixtures retain overflow, future-version refusal, process cleanup and non-replay controls. Pi1.5.1 recovery now proves the interrupted original attempt and exactly one provider invocation instead of requiring a second abort.
- `make build-web` passes, including17web build checks/67assertions. Both skins' generated assets are rebuilt in this owned tree; canonical assets and the installed runtime are untouched.
- Add-on source is draft PR236. Candidate archives import with provisioned tooling dependencies and match source bytes; public-URL and fresh dependency installation checks remain separate. The expanded standalone attempt failed dependency acquisition and has no complete suite receipt. Independent production review timed out after240s and supplies no review clearance.
- Full host attempt at7cd585aca completed7212tests/978files:7082passed,71skipped,59failed. Features/build did not run after that failure. Current-target1.4.0 guards and several queue-based fixtures were stale after the upgrade; their surviving contracts are now ported and pass focused runs. Historical receipts remain unchanged.
- Fresh published1.5.1 admission checks all nine Root package payloads, including SDK-owned `pi-schema`, against public archives and decoded provenance. Current metadata records43provider definitions. Synthetic CLI/auth measurements cover10CLI outcomes,22Copilot/Kimi device cases,6Codex device cases and20browser cases plus17copy-code cases. No real credentials or inference were used. See the [historical Pi1.5.1 qualification](pi-1.5.1-qualification.md) and [current Pi1.5.2 qualification](pi-1.5.2-qualification.md).
- The Copilot overlay now supplies the public all-model catalogue while retaining inherited classifier models, and requests credential-bearing refresh for the account catalogue. Both public1.5.1 contracts are tested through the real ModelRuntime;18checks pass without bypassing upstream auth/filtering.
- Generic task editing proves explicit fresh revisions after both a known successful and an unsettled old occurrence. User pauses/cancellation and all old occurrence/monetary bytes remain unchanged; old work is never reclaimed without its existing authority. No financial pause interpreter or automatic resume mechanism was added.
- Add-on candidate is nowe65c9f8. Its affected suite passes136tests/857assertions across17files, with7pre-existing opt-in skips. Independent bounded reviews withdrew initial signal-separation/dedup/zero-provenance concerns after complete context and controls were supplied. Those reviews are not full epic clearance.
- Root/build and both private type projects pass. Full exact-head canonical reruns, UI/shipped-package acceptance and merged-source evidence remain outstanding. Current handwritten Core source delta against34516cabd is+519/−464, net+55; this final slice has no net-deletion claim. Qualification tooling, generated data/assets and historical deliveries are accounted separately and cannot earn duplicate backend-deletion credit.

## Later reporting and qualification checkpoint

- User deferred Cheapskate; it remains unchanged and is excluded from this delivery for now.
- Add-ons PR236 merged asb12c0cc1 with the exact qualified tree. Fresh merged-source affected tests pass136/857assertions with7pre-existing opt-in skips; the Core default factory's three installed-add-on billing cases pass. Publication succeeded on the unchanged second attempt after the first cancelled during browser-dependency installation. All seven public Core archives now match their catalogue manifests and50approved source-profile file fingerprints. No live installation or restart occurred.
- Full host run at07b634b6c finished7156passed/71skipped/1failed. The only failure was an obsolete1.4.0 expected SDK label in the real MCP settings runtime test; the current1.5.1 expectation now passes. Features/native did not run after that failure.
- Removed unused raw-cost accumulation and cost-column dependencies from token-only charts. Separate API-equivalent pricing references and all quoted rates are retained.
- Unknown pricing now returns unavailable instead of synthetic zero rates. Cost charts preserve the known USD subtotal, keep full/day totals unknown where pricing is missing, retain observed documented-free zero, emit blank unknown CSV amounts and exclude records after the requested instant. Missing databases no longer fabricate zero observations. The same chart mode/layout is retained.
- Fresh chart/reference/token-only/MCP controls pass35tests/205assertions; Root and script types pass. A bounded independent review found no concrete regression in this reporting/deletion diff. Full exact-head delivery gates remain outstanding.

## Public seed qualification

- Refresh the bundled catalogue, SHA256 pins and archives from merged add-ons commitb12c0cc1. The frozen Bun lock changes only the six updated first-party archive integrities; third-party versions stay unchanged. Initial plain install reused old cached file-URL packages, so the acquisition stage used targeted `bun update` and verified installed versions before publishing any seed.
- Fresh offline preparation/first-workspace/retired-A2A controls pass14tests/71assertions.
- A supplementary fixture seeds only the seven actual public packages through the existing first-workspace installer, then exercises the real SDK1.5.1 default factory. Estimate, billed-zero and billed-positive cases each pass with one provider call, immutable historical monetary rows and reopen/no-replay checks. Optional image/conversion tooling is outside this seven-package fixture; the original all23installed cases remain unchanged and passing.
- Full exact-head host/features/native and final delivery review remain outstanding. Prior supplemental and failed runs remain separate receipts.

## Cache-input regression correction

The full3497cd806 run passed7157host checks,25feature checks,17web-build checks, both private type projects and88accepted-source checks. Canonical native completed152files with151passing and one real failure: the context guard let an underreported cache component borrow the SDK's safety reserve.

The correction keeps that reserve on the cache-inclusive measured estimate. Transport framing still has its separate actual-output-cap check, avoiding double charging. The original failing control is unchanged; all five isolated context/output/admission files and engine types pass after the fix. No deadline, provider/context limit or test assertion was relaxed. A fresh exact-head full gate is still required.

## Current1.5.2 delivery alignment

The installed runtime is now Pi1.5.2. The delivery branch uses separately qualified1.5.2 graphs; frozen1.5.1/1.4graphs remain unchanged. Current public package/type/auth probes moved to152, and new152receipts were measured from published archives; historical151receipts were not relabelled. Package manifests, archive bytes, decoded provenance and private installed payloads match the exact target.

The100-lease workload's fixed count of100failed attempts was an invalid assumption: an occurrence may require more than one safe acquisition retry. Its unchanged control passed on a quiet rerun. The strengthened fixture now identifies every original occurrence's safe failure, exactly one successful renewal and an identical request across retries. The single manually invoked renewal round is kept separate from later cadence callbacks; acquisition/expiry clocks, six-second writer outage,45-second test bound, remaining-lease threshold, identities, no-execution assertions and exactly100durable renewal rows are unchanged. No production policy or deadline changed.

## Remaining adapters and their current consumers

| Adapter | Current nonfinancial consumer | Controls retained |
| --- | --- | --- |
| Single task-source/cancellation registry adapter | Model/tool source identity and per-occurrence cancellation before a blocked durable abort mark | Original SDK commit context/method binding/abort definition; held-writer sibling isolation and cleanup joins |
| Guarded Codemode commit | Source/owner checks inside the SDK-owned effect transaction | Pre/post-body checks under the same writer lock; rollback and uncertain-result controls |
| Pre-open synchronous document reader | Validate configuration before SDK recovery and repeat the check under its write lock | Supported version bounds, same-version deltas and future-version refusal; no configuration writes |
| Model-selection context preview | Side-effect-free current loadout/output sizing where the SDK has no selection preview | Real root/private SDK wire-cap parity; input/output overflow, framing and auth isolation |
| Passive usage row projection/reference predicate | Token append, chat cleanup and retention | Idempotent identity, opaque old bytes, foreign keys and no reporting-based execution decision |
| S07 scheduling and narrow S01 correlation | Recurrence, occurrence leases, immutable history and authenticated source correlation | SDK owns execution/results; no host-exclusive native-agent slot or monetary readiness layer |

## Completion work

- Complete current caller/dynamic/shipped inventory, safe generic transition proof for historical budget-paused schedules, current add-on and fresh-workspace package checks.
- Reassess the preserved scheduled execution work against Pi 1.5.1; remove the inactive test-only dispatch facade and redundant host execution/settlement layers without losing actual cancellation or source authority.
- Qualify actual report/UI/provider/Goal/error/cancel/reopen parity, all required exact-head gates, real workloads and independent review. Failed, interrupted and filtered runs remain distinct.
- Measure genuine handwritten source/module/owner/layer reductions once per owner, charging replacements and SDK compatibility. Historical #1881/#1878/#1966 deletions are not credited again.
- Publish PRs for explicit merge approval, verify merged-source absence and retained reporting, reconcile all eight children, then close #1875 only when every criterion has evidence.
