# Expense-removal caller and ownership map

Expense policy removal belongs to #1875. The source map and reporting contract precede mixed implementation. This checkpoint leaves #1876 and #1882 open: historical seed distribution and native decoupling qualification remain incomplete.

Core source: `8b11d32cd477c621fd9da55fc1a0e523ceb03943`. Add-on source: `6a6aa9e3f9d6e12defcb5b93e7900d0dfe065c5f`. Stock Root/private SDK 1.4.0 graphs remain separate. Production delta: **zero**.

## Manifest and scope

[The removal manifest](receipts/expense-removal-inventory-1876.csv) records 105 entries: path, source SHA256, disposition, delivery child, full-file size, exported symbols, resolved direct import callers, removed responsibility and surviving invariant. All 42 direct Core financial source modules have a disposition. Full-file sizes of mixed modules measure exposure; they are not removable LOC.

The scan covers 2,180 Core and 685 add-on tracked text files, including root configuration, docs, package/build/release files and source. Tests, qualification fixtures, vendored/build outputs and historical reports/artifacts are excluded from production counts. Syntax inventory has 6,364 edges and a 296-file reverse-import closure. Expanded lexical pricing/cost/budget leads produce 791 candidate files. Reverse closure and word matches require semantic classification; they do not establish execution or deletion.

The42-module direct set comprises `runtime/src/budget/*`, `db/budget-*`, `host-request-accounting.ts` and their resolved direct import/re-export consumers. The wider manifest adds financial DTO/config/route/registration/retention consumers and named observation readers. Type-only imports remain visible; a resolved import is not proof that every export executes.

| Budget module disposition | Files | Physical LOC |
|---|---:|---:|
| Financial DELETE candidates | 11 | 977 |
| Mixed DECOUPLE | 4 | 388 |
| Useful valuation RETAIN | 1 | 100 |
| Total | 16 | 1,465 |

The total has 1,373 nonblank lines. The initial six policy/settings/status/scheduled modules are a 664-line subset. No removal credit applies before delivery. Moves, generated profiles/schema inventories, tests/docs and another owner's changes receive no production deletion credit.

## Financial call stages and owners

Native preparation currently crosses:

`default-application-runtime.prepareRequest` → `reserveHostRequest` → `modelRequestAccounting.reserve` → `admitBudgetRequest` → `reserveBudgetRequest` → financial `admission` → `evaluateBudget`.

Dispatch repeats admission through its dispatch counterparts. This chain crosses six source modules. The generic `admitSqliteWrite` owner remains responsible for SQL-only synchronous bodies, acquisition-only retry, cancellation and authority checks.

| Responsibility | Current owner | Delivery |
|---|---|---|
| SDK admission and cap/price availability | `default-application-runtime`, `host-models`, `host-bindings` | #1877; scheduled availability #1879 |
| Financial request/work/closure/readiness | `host-request-accounting`, `model-request-accounting`, `host-runtime`, application bootstrap | #1877; useful observation preparation #1882 |
| Caps/windows/allowances/overrides/decisions/provider evidence | `budget-limits`, evaluator and financial schema | #1878 |
| Immutable invocation/terminal evidence and usage payloads currently inside financial tables | Request reservation and usage projection modules | #1877 preserves execution evidence; #1882 preserves usage; #1878 retires the financial schema afterwards |
| Add-on grants/outbound/background ancestry | Operation host/service/DB, config, native background payload/policy | #1880 |
| Financial scheduled readiness/blockage/notifications | Scheduler, scheduled tools/query/management, interrupted-run store | #1879 |
| Management tools/routes/Settings/prompts/registrations | Budget extension, route handlers, frontend and tool-preparation metadata | #1881 |
| Tokens/pricing/provider cost/history | Existing SDK outcome/usage, valuation and reporting readers | #1882 |
| Final absence/parity/package/owner reduction audit | Exact integrated source | #1883 |

The CSV gives one primary delivery child per entry. Shared files retain field-level boundaries: #1881 owns budget Settings API functions; #1879 owns scheduled financial options in `web/src/api.ts`. #1881 owns expense extension registration; concurrent #1892 owns legacy compaction retirement. Coordinate those hunks without restoring foreign deletions.

## Mixed dependencies requiring explicit separation

- `storeTokenUsage` validates native observations against dispatched/unresolved reservations and writes canonical payloads through `insertBudgetUsageEvent`. Reporting must become independent of that financial owner without losing existing history.
- `RetainedAccountingPending` inherits `BudgetRequestError('budget_denied')`. Scope-wide readiness can delay later effects or publication while reports/settlement need repair. Remove the financial barrier; retain original invocation/outcome and uncertain-effect non-replay guarantees.
- `prepareRequest`, side-prompt retry and Dream/add-on ancestry use financial work IDs as correlation. Existing source/operation/task/prompt/model identity must survive their removal.
- `OperationGrant.parentWorkId` and background `workId/parentWorkId` also enter persisted policy hashes and continuation checks. They are financial dependencies despite their ordinary names. Preserve immutable historical policy/source evidence without constructing a renamed financial ancestry service.
- `requestCeilingFrame` combines price with context/output ceilings. Remove price-based execution permission while preserving genuine model/API/reasoning/image/context/output validation.
- Native exit, branch policy and interrupted scheduled-run reconciliation consult financial state. Retain their independent terminal/nonce/idle/source/lease/task/outbox proofs; financial holds cannot remain readiness prerequisites.
- `host-regrets-model.ts` has a real default-factory caller. Its mandatory reservation/account/price path must be decoupled while preserving the supported decision request, approval/source/cancellation and original terminal facts. It is not an unused adapter.
- `getBudgetSettingsState` can create cap windows during projection. Delete this cap-management reader with its actions; use existing independent observation readers.

## Static, dynamic and distributed callers

The broad scan has 35 nonliteral module-load expressions. Reviewed resolver families cover fixed Core/Azure bootstrap URLs; installed `pi.extensions`, `pi.runtime.entries` and `pi.web` declarations; native profile exports; editor/xterm assets; office document dependencies; and offline harnesses. Arbitrary user-supplied third-party module bodies remain outside this first-party source map.

The initial list incorrectly included 34 calls to locally declared assertion helpers named `require`. These calls are excluded after source inspection. Babel retains an existing `UnexpectedReadonly` diagnostic at editor `live-preview.ts:305`; its three runtime imports agree with Bun after excluding type-only imports. The AssemblyScript framebuffer decoder uses a separate grammar, with no imports or financial leads. Neither exception was repaired during this audit.

The package roster contains 50 add-on manifests, 14 generated native profiles plus specialised installed-source qualification, 7 Core seed entries and current public catalog install references. Native export filenames occur in their profile-pinned file lists. Generated profile data earns no handwritten reduction credit.

Current distributed A2A 0.4.1 has two `budget_blocked` consumers. Its handler is imported by `server.ts`; task-store is consumed by handler, push worker, runtime API, server and service. #1880 removes the financial branches while preserving approval-required/input/result/cancellation and operation identity. Token-budget uses in Goal/Regrets/compaction and page/computation/time/resource limits remain outside monetary deletion.

## Historical seed availability

Read-only public downloads on 2 November 2026 produced:

| Core seed | Version | Result |
|---|---|---|
| code-review | 0.1.8 | HTTP404 |
| delegate | 0.2.20 | HTTP404 |
| goal | 0.1.49 | HTTP404 |
| observability | 0.1.18 | HTTP404 |
| plan-sidebar | 0.1.25 | HTTP404 |
| restic | 0.1.5 | Available; SHA256 equals the release lock; 18 text files inspected |
| session-dashboard | 0.2.4 | HTTP404 |

The URLs and expected hashes are in [`release/core-addons.lock.json`](../../release/core-addons.lock.json). The available Restic seed and current A2A archive have no differences among compared first-party JS/TS source files. Their inspection does not establish bytes or behaviour for the missing seeds. No replacement version, catalog/seed change, install or source restoration was performed. #1880 must reconcile this packaging gap; fresh-workspace shipping qualification remains incomplete.

## Shared reliability scope

[#1825](https://github.com/rcarmo/piclaw/issues/1825) assigns financial removal to #1875/#1877/#1880 and reporting to #1882. Its earlier budget-admission implementation is superseded. Retain only reproduced nonfinancial SQL/source/outcome defects using the accepted admission contracts; do not build another budget admission port.

#1820 and #1814 are closed. Their original-source/terminal/cancellation/transaction/non-replay guarantees survive. Financial clauses are superseded by #1875; do not reopen accepted reviews to consolidate financial code. Current #1817 work explicitly excludes financial-owner changes. The preserved dirty terminal worktree and active queue/compaction worktrees remain foreign.

## Qualification and next delivery

The five selected reporting files pass 62 tests/290 assertions on the starting audit source. This baseline includes financial expectations and does not qualify financial-free execution. The current-base rerun and audit checks are recorded in the PR receipt.

[The reporting contract](expense-reporting-contract-1882.md) defines the retained producers/readers and required absence/native failure/reopen cases. Before mixed implementation, review the exact preservation boundary, shared ownership and historical source transition. Historical seed availability and actual financial-free native parity stay open. Source changes require focused exact-candidate validation; merges and live data/installation/restart remain separately authorised.
