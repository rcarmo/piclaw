# Historical Core seed source and callers — #1876

All seven original Core seed archives were already vendored at the original inventory source `8b11d32cd477c621fd9da55fc1a0e523ceb03943`. Their bytes match the release lock and remain unchanged at `b22b771c78412b8f825bb893c02bf5e8794b7f65`. The earlier six HTTP404 results describe public URL availability; they did not prevent inspection of shipped bytes.

This read-only follow-up completes the bounded historical-seed source/caller census. #1876 and #1882 remain open for their broader acceptance. Production, package, lock and test-source deltas are zero. No archive was rebuilt, replaced, installed into a live profile or republished.

## Coverage and receipts

- [130 file/member hashes and dispositions](receipts/expense-shipped-seeds-1876-members.csv).
- [285 import/re-export references and two execution references](receipts/expense-shipped-seeds-1876-callers.csv).

| Seed | Version | Text files | Code modules | Metadata entry modules | Runtime-referenced code |
|---|---|---:|---:|---:|---:|
| code-review | 0.1.8 | 20 | 17 | 3 | 17 |
| delegate | 0.2.20 | 36 | 18 | 2 | 5 |
| goal | 0.1.49 | 14 | 10 | 3 | 7 |
| observability | 0.1.18 | 24 | 18 | 2 | 11 |
| plan-sidebar | 0.1.25 | 8 | 5 | 2 | 4 |
| restic | 0.1.5 | 18 | 15 | 3 | 14 |
| session-dashboard | 0.2.4 | 6 | 3 | 2 | 2 |
| Total | | 126 | 86 | 17 | 60 |

Four static documentation images bring the file total to 130. Twenty-one explicit directory entries account for the remaining archive members. The initial 116-file filter covered code/docs/JSON/HTML/CSS; this census also covers ten text fixtures, logs and TOML configurations. Images have byte hashes; no pixel-level interpretation was performed.

Babel 8.0.7 parses all 86 code modules. Independent Bun 1.4.4 runtime literal-import scanning adds zero unmatched imports. Bun's actual resolver agrees with every archive-local import and the two execution targets in disposable copies, without loading those modules. Metadata roots include `main`, extension, startup and web declarations, with duplicate references to the same entry module counted once. Runtime-referenced local imports resolve within each archive; explicit test-only gaps follow below. External builtins, SDK and library dependencies remain named boundaries. Import closure bounds module reachability and does not establish execution of every exported function or runtime compatibility.

## Callers that imports miss

- Restic `staging.ts:119` invokes `sqlite-snapshot.ts` through `runRestic`, using `process.execPath` and an argument containing the helper path. Its regular-file/inode/symlink checks, page-batched SQLite backup, implicit row IDs, committed WAL and snapshot verification must survive. The helper has no import caller.
- Observability `skills/usage-telemetry-chart/SKILL.md:12` documents `bun ./usage-telemetry-chart.ts`. The chart is a supported script surface despite having no module-import caller.

These two reviewed references expand the metadata import closure from 58 to 60 code modules. Restic `contracts.ts` has five type-only consumers. Observability's historical `compat/config.ts` export has no caller in these declared surfaces; no deletion or runtime-use inference follows from that observation.

All ten computed imports are fixed in-archive filenames followed by test-only query nonces. None is reachable from a declared runtime surface. The shipped Delegate browser test refers to an omitted monorepo helper, `../../scripts/lib/settings-pane-browser.js`. Seven shipped `bunfig.toml` files also refer to outside-archive test preloads. These are explicit test-distribution gaps; they are not silently resolved or run against a live workspace. All 24 bundled test-code modules stay outside runtime closure.

## Semantic dispositions

| Seed | Reviewed responsibility | Treatment |
|---|---|---|
| code-review | Source/review identity, SQL, diff computation and capture deadlines | Retain. `render-source.ts:197` and `source.ts:364,440,527,534` use computation/time budgets. Generic skill prose grants no financial authority. |
| delegate | Approved model/executable policy, one total timeout, cancellation, subprocess result and usage/cost aggregation | Retain nonfinancial controls and observation. `remainingBudget` measures milliseconds. Cost presence needs separate reporting work. |
| goal | `token_budget`, `tokens_used`, elapsed time, explicit user controls, lifecycle and wrap-up | Retain. `index.ts:937` compares token counts; `budget_limited` is a token state, not an expense hold. |
| observability | Token dimensions, timings, usage export/checkpoints and chart command | Retain. Price source/units labels need correction, without making telemetry an execution prerequisite. |
| plan-sidebar | Checklist state and existing UI | Retain. No expense-management caller or monetary threshold was identified. |
| restic | Backup transport, permissions, resource deadlines, SQLite consistency and retention | Retain. Storage/time/retention safeguards are nonfinancial. |
| session-dashboard | Session/context/status projection and existing UI | Retain. No expense-management caller or monetary threshold was identified. |

No direct consumer of `budget_status`, the general budget Settings routes, `resolveBudgetProviderAccountRef` or `createBudgetLimitsExtension` was found in these archive bodies. Reviewed budget/cost leads identify nonfinancial controls or observations. Financial policy in the external Core host remains assigned to #1877/#1880; this census does not qualify its removal.

## Reproduced reporting gaps — #1882

Two isolated characterisation tests invoke hash-verified original reader code, without registering tools, launching a model or starting telemetry transport:

1. Delegate 0.2.20 `parseDelegateJsonOutput` returns the same zero-cost summary for an otherwise successful assistant result with absent usage and one with supplied `usage.cost.total=0`. `emptyDelegateUsage` and `numeric` erase cost presence. This is historical parser evidence; active native Delegate transport requires its own acceptance.
2. Core stores a synthetic `provider_reported` row with actual 2, catalogue 3 and displayed `cost_total=2`. The archived Observability `collectUsage` emits `cost.estimated_usd=2`, omitting source provenance. That reader's SHA256, `1714e4f6b24450315940d960e0d971ca2c66c27453b399427b677d1fb807b705`, also matches current add-on source `6a6aa9e3f9d6e12defcb5b93e7900d0dfe065c5f`. An actual amount is not thereby a catalogue estimate or proven USD amount.

The tests preserve the observed counterexamples; passing characterisation does not satisfy truthful-reporting acceptance. Do not remove useful observations or patch immutable old releases to hide these gaps. The earlier Core reasoning/supplied-zero preservation in PR1927 remains accepted and concerns a different producer boundary.

## Validation and limits

- Eighteen isolated audit/characterisation/publication tests pass 1,225 assertions. They verify all 130 file hashes, roots/closure, type/test boundaries and the two actual readers. Hostile mutations reject archive corruption, missing roots, runtime-unresolved loads, unresolved dynamic expressions and loss of the Restic process edge.
- Existing Core seed preparation and package-hygiene tests pass 10 tests/24 assertions, including positive offline seed preparation and tamper rejection. Both runs use the central Nice19 launcher and mandatory filesystem isolation.
- All seven archive hashes also match the original 8b11 inventory commit. No newer version substitutes for a missing URL. The archived test suites and extension startup hooks were not executed.
- Financial-free native execution, optional reporting-failure publication, current producer units/currency, mixed-history retention and final integrated absence remain open. No full-suite, current add-on runtime compatibility, zero-telemetry/free-service or full #1876/#1882 acceptance is established.
- No production reduction credit applies to this documentation/data audit. No live database, schema, provider, credentials, configuration, model, profile, schedule or service changed. The separate #1857 staged rollout remains untouched.
