# Expense-removal delivery — pre-merge acceptance

This delivery removes expense enforcement and displaced host execution/financial owners. It preserves actual cost tracking, token/reasoning/cache telemetry, catalogue prices and opaque history. Public pi-durable owns execution, results and durable cancellation. Cheapskate is explicitly deferred and unchanged.

## Source and publication

- Core base: `34516cabd8e56f61bd1b7150e0c87c244694533e`. Root/private SDK graphs target public Pi1.5.2; older frozen graphs and historical receipts remain unchanged.
- Approved add-ons#236 merged as `b12c0cc1a04854719565702bf08069034243db14`; documentation follow-up#237 merged and published as `609dc7bda3a47252481f3d8da1b838ec723798ad`. Its merge tree equals the qualified head, and actual merged-source documentation/chart checks pass5tests/29assertions.
- All23public approved add-on archives match their manifests and approved runtime file hashes. The seven bundled Core archives cover50approved source hashes. Observability0.1.22 and optional Regrets0.3.1 include the corrected guidance. Public archive SHA256/SRI values are measured from actual bytes; unchanged-version archives that repack differently receive fresh measured integrities. Third-party lock entries are unchanged.
- [Original-path census](receipts/expense-final-census-1875.json) and [current retention witness](receipts/expense-final-retention-1875.json) cover105original paths:36deleted and69retained with explicit purposes, hashes and direct lexical callers. Lexical evidence alone does not establish semantic or dynamic absence.

## Removed ownership

- Financial request/admission/reservation/lifecycle modules, expense Settings panes, monetary management routes and financial startup/backfill ownership are removed across the accepted deliveries.
- Caller-free `UsageProjectionEvent`, `UsageReportOrigin`, `encodeUsageReport`, `decodeUsageReport` and `readUsageProjectionEvent` are removed. A small passive row normaliser and structural historical-reference predicate remain for token append, chat cleanup and retention.
- Native scheduled agents bypass host AgentQueue placement and the inactive dispatch facade. S07 owns recurrence, occurrence leases and history; S01 supplies exact authenticated source correlation. AgentQueue still places non-agent work, including shell tasks.
- Token-only charts no longer accumulate unused raw monetary totals or require monetary columns. Estimated-cost charts preserve unknown prices/gaps, documented-free zero, separate known subtotals and the requested time range. Quoted model-price references remain.

## Preserved observations and integrity

SDK `Usage.cost.totalFromProvider` and actual billed zero survive successful and failed outcomes. Provider totals retain explicit unit/provenance independently of catalogue estimates. Mixed or unknown units yield unknown aggregate cost while raw individual facts and token counts remain available. No legacy currency backfill or fabricated financial certainty is introduced.

Reporting is passive. A write failure cannot decide execution. Historical payload/hash bytes, monetary rows, receipts, foreign keys, missing/duplicate outcomes and opaque uncertainty remain protected. No live cleanup, hold clearing, automatic financial resume, database restore, schedule/configuration change or deployment belongs to this delivery.

Goal token budgets, physical context/output bounds, source/model/auth checks, provider-imposed quotas/errors, SQL commit certainty and operational resource limits remain.

| Retained adapter | Current nonfinancial consumer | Required controls |
| --- | --- | --- |
| Single task-source/cancellation registry adapter | Per-task model/tool identity and cancellation while the durable abort mark is blocked | Original SDK commit Context/method binding/abort definition, sibling isolation and cleanup joins |
| Guarded Codemode commit | Source/owner checks inside the SDK effect transaction | Checks under the same writer lock, rollback and uncertain-result handling |
| Pre-open synchronous document reader | Configuration validation before recovery and repeated under its write lock | Supported versions, same-version deltas, future-version refusal; no configuration write |
| Model-selection context preview | Side-effect-free current loadout/output sizing | Actual SDK wire-cap parity, framing, overflow and auth isolation |
| Passive usage row/reference projection | Token append, chat cleanup and retention | Idempotent identity, opaque old bytes and foreign keys |
| S07 scheduling and narrow S01 binding | Recurrence/leases/history and authenticated source correlation | SDK execution/results authority; no host-exclusive native-agent slot or monetary readiness layer |

## Qualification and accounting

- Current public1.5.2 package payloads, decoded provenance, native CLI/auth controls and private/root types have measured receipts. Historical1.5.1 evidence is labelled historical.
- The real cache-inclusive reserve regression was fixed with its original failing control unchanged. Transport framing and actual output bounds remain separate. Renewal fixtures now prove every original run's safe acquisition failure, one successful renewal and byte-identical requests across retries. Original acquisition/expiry clocks, writer outage, deadlines, remaining-lease threshold and no-execution assertions remain.
- Prior full runs remain separate:2263host7157pass/71skip, features25pass, webbuild17pass, accepted-source88pass and native151/152files; b4423host7162pass/71skip, features/build and private types passed, then accepted-source87pass/1timeout. Neither is a full pass.
- The accepted-source timeout came from line-scanning large non-runner data. A negative-only whole-source prefilter keeps the same inventory, patterns, per-line comment/launcher exclusions and findings. The unchanged repository audit fell from over9seconds to about120ms; no deadline increased. Regression coverage includes late-file findings and cross-line/comment handling.
- Actual-source component parity passes14Chromium cases: both skins retain reasoning/cache counts, actual zero, explicit/unknown units, positive actual cost and separate estimates; unknown-price models remain keyboard-selectable. The full existing retirement matrix also passes8cases/84assertions across both skins, Chromium/WebKit, desktop keyboard and phone touch. Chromium uses software rendering in the headless container; case/hook deadlines are unchanged. Earlier startup/rendering failures remain recorded.
- Full lint still has222baseline diagnostics and no new normalized diagnostic. Import-boundary failure output equals the base. No rules or unrelated diagnostics were changed to manufacture a pass.
- The current new Core handwritten production slice is net positive and is charged in full. Only explicitly attributed accepted retirements are credited once in the retention receipt. Tests, docs, generated files, moves and qualification tooling earn no backend-deletion credit.

A fresh complete exact-head gate, independent boundary review and actual merged-source acceptance still determine completion. Child issues and#1875 remain open until that evidence is recorded. This branch is not installed in the running service.
