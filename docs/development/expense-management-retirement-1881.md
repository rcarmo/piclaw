# General expense-management retirement — #1881

General expense management is removed from Core. Scheduled, native and add-on financial enforcement remains assigned to #1879, #1877 and #1880; schema retirement remains #1878. #1881 and #1875 remain open.

The delivery starts at `b22b771c78412b8f825bb893c02bf5e8794b7f65`, including the accepted scheduler/post-edit changes. The [original inventory](expense-removal-inventory-1876.md) retains its historical source pin. The [retirement receipt](receipts/expense-management-retirement-1881.csv) records all 22 changed handwritten production files and their before/after hashes.

## Deleted owners and callers

| Surface | Removed implementation | Current behaviour |
|---|---|---|
| General Settings | Classic `settings/budget.ts`, Visual `settings/BudgetSection.tsx`, shared `budget-settings-model.ts` | Pane, navigation, API client, translations, styles and mock management data absent in both skins |
| Management routes | `budget-settings.ts`: `handleBudgetSettingsRead`, `handleBudgetSettingsAction` | Ordinary unmatched-route handling; no compatibility endpoint or financial parser |
| Agent management | `createBudgetLimitsExtension`, `/budget`, `budget_status`, expense `tool_call` hook | No registration, capability/preparation entry or replacement hook; ordinary unknown-command/tool handling |
| Management projection | `getBudgetSettingsState`, `getBudgetStatus`, `evaluateBudgetStatus`, `formatBudgetStatus` | Deleted, including the read projection's cap-window writes |
| Dead admission presentation | `BUDGET_BLOCKED_PREFIX`, `formatBudgetDecision`, `admitBudgetBoundary` | Deleted after their final management consumers; reduction charged here once, not again to #1877 |
| Forwarding | `AgentPool.resolveBudgetProviderAccountRef` and optional web contract member | Deleted; independent provider-account observation remains |

There is no new limiter, facade, configuration flag, ledger, exported production helper or production module. Native/scheduled monetary state and APIs remain for their later delivery children. This intermediate source must not be deployed as completed expense removal.

## Interface continuity

Unknown initial Settings IDs use General. Unknown open-settings events leave the current valid pane unchanged. Classic checks its own builtin/lazy IDs and registered extension panes; Visual retains its existing pane resolution and highlights that resolved pane. A persisted retired selection therefore has a visible General selection in both skins. No special-case interpreter for old financial inputs is added.

Model-selection prices, provider quota/actual-cost observations, token/reasoning/cache reporting, context/tool-count limits and Scheduled Tasks controls remain. `latestProviderEvidence` keeps its exact function body because scheduled readiness still calls it. Canonical usage, request receipts, SQL triggers, history, deadline/cancellation and uncertain-effect non-replay owners are unchanged.

## Reduction

| Category | Physical-line delta | Nonblank delta | Treatment |
|---|---:|---:|---|
| Handwritten production | −1,257 | −1,167 | Seven modules deleted; zero added |
| Tests | −464 | −412 | Removed-feature tests retired; no reduction credit |
| Generated bundles/maps/HTML | −178 | −170 | Thirteen regenerated files; no reduction credit |

The backend contributes −681 production lines. Both UI panes and their shared DTO are removed in place. Shared API/i18n changes also affect other entrypoints and source maps: the old editor map, for example, contained both retired endpoint strings. Regenerated consumers contain neither. No generated, moved, documentation, test or foreign reduction is credited.

## Qualification

- 226 focused host tests / 2,734 assertions across 19 files: actual builtin registration/hook absence, route fallthrough without channel access/body parsing or report mutation, exact tool metadata, provider/model observations, canonical usage, SQL immutability, scheduled boundaries and protected preparation.
- 102 targeted native tests / 644 assertions across three files: bounded/cancelled tools, exact reporting facts, SDK summary checkpoint and SIGKILL/separate-process receipt recovery. Known results remain single-effect; uncertain pre-receipt work is unreplayed.
- 11 browser tests / 105 assertions: both skins and Chromium/WebKit at desktop keyboard and phone touch, stale selection, active navigation, responsive visible prices, scoped focus and retained scheduled navigation; existing model-catalogue journeys also pass.
- Web build and its 17 tests / 67 assertions pass. Runtime, private engine and qualification strict checks pass; existing configured Settings/panes checks pass. No compiler flag or test deadline changed.
- Standalone Visual strict compilation fails at both exact base and candidate with the same frozen dependencies: 131 versus 122 diagnostics. Normalising only owned worktree names and source positions produces zero new diagnostics; all nine removed diagnostics belong to the deleted DTO. Standalone Visual strict green and full host/native suites are unestablished.
- The manifest's base expectation of 34 builtin roots was already stale: the exact base has 33 after the foreign compaction retirement. This delivery removes one, leaving 32. Exact registration sites 45→44, tool rows 49→48 and rows plus two templates 51→50 remain closed assertions.
- A 25,565-file qualification archive passes the existing package-entry rules. Twenty selected shipped consumers match source bytes exactly; deleted modules and retired endpoint/forwarder/source-map references are absent, while pricing/reporting symbols remain. This archive uses gzip level 1. The ordinary level-9 `make pack` did not complete; its receipt stops after successful build and pinned-seed preparation.

The original absence contracts failed before deletion. Additional failures remain in the receipts: stale manifest counts, browser setup/fixture errors and the missing Visual active-navigation regression. The latter failed with zero selected items before the two-line resolved-pane fix. All current focused tests pass. Three read-only 6.1 delegated reviews timed out; none returned approval. The primary-model source review is bounded to this delivery.

## Remaining archive and operational work

All seven original seed archives exist under `release/core-addons/tarballs/` and match `release/core-addons.lock.json`. Six public URLs still return 404, but vendored bytes are available for the remaining historical source/caller census. No archive was reconstructed, substituted or republished. Broader #1876/#1882 and final #1883 acceptance remains open.

Root/private SDK graphs remain separate stock 1.4.0; qualification dependencies remain SDK-free. No live database/schema, reservation, provider, profile, model, schedule, installed runtime or service changed. The separate staged #1857 rollout remains untouched and restart-gated.
