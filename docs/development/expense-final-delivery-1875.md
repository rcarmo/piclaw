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
- Full exact-head canonical reruns, independent review and merged-source acceptance remain outstanding. Current handwritten Core source delta against34516cabd is+517/−464, net+53; this final slice has no net-deletion claim. Historical deliveries are accounted separately and cannot be credited again.

## Completion work

- Complete current caller/dynamic/shipped inventory, safe generic transition proof for historical budget-paused schedules, current add-on and fresh-workspace package checks.
- Reassess the preserved scheduled execution work against Pi 1.5.1; remove the inactive test-only dispatch facade and redundant host execution/settlement layers without losing actual cancellation or source authority.
- Qualify actual report/UI/provider/Goal/error/cancel/reopen parity, all required exact-head gates, real workloads and independent review. Failed, interrupted and filtered runs remain distinct.
- Measure genuine handwritten source/module/owner/layer reductions once per owner, charging replacements and SDK compatibility. Historical #1881/#1878/#1966 deletions are not credited again.
- Publish PRs for explicit merge approval, verify merged-source absence and retained reporting, reconcile all eight children, then close #1875 only when every criterion has evidence.
