# Observation after expense-policy removal

#1882 retains token metrics, model-selection prices and provider-reported costs while #1875 deletes expense policy. Usage reports must work without caps, reservations, charges, financial work IDs or financial readiness. Keep the existing outcome, reporting and small valuation functions; do not build a replacement accounting service.

Source contract: Core `8b11d32cd477c621fd9da55fc1a0e523ceb03943`, add-ons `6a6aa9e3f9d6e12defcb5b93e7900d0dfe065c5f`. Implementation and financial-free native acceptance remain open. See [the caller/ownership map](expense-removal-inventory-1876.md).

## Retained facts and readers

| Observation | Existing producer or owner | Actual consumer |
|---|---|---|
| Input/output/reasoning/cache/total tokens, source/time | `agent-pool/usage.ts`, SDK committed entries, `db/token-usage.ts` | `channel-endpoint-context-factory.ts`, `agent-status.ts`, context/status and token charts |
| Goal token progress | `host-goal-usage.ts:accountCommittedGoalEntry/accountCommittedGoalBatch` | Installed Goal `accountGoalProgress`, scoped committed-entry cursor and lifecycle; preserve explicitly requested token ceilings |
| Provider actual cost, including supplied zero | Original SDK/provider outcome; `model-request-accounting.ts:prepareUsage`, recorder | `provider_cost_total`, cost provenance, latest/provider/model/totals reporting |
| Catalogue estimate, partial/unknown valuation | `valueApiEquivalentCost` and SDK category cost data | Existing usage producers and report columns; retain known subtotal/unknown categories/cache fallback/source |
| Model-selection price indication | Host catalogue model cost metadata | `web/src/components/model-picker.ts`, `web/src/ui/model-catalogue.ts` price labels and input/output price sorting |
| Provider quota/usage availability | `agent-pool/provider-usage.ts`; existing runtime-facade warm/peek callers | Current provider/model/status observation with source, units, staleness and availability |
| Original terminal and invocation | SDK task/entries, `host-terminal-outcome.ts`, current mixed retained receipts | Exact outcome/recovery, source/incarnation/route identity and uncertain-effect non-replay |
| Historical usage/provenance | `token_usage`, canonical payloads currently in financial usage events | Existing historical reports/charts/retention/export consumers |

`budget/provider-evidence.ts` converts observations into cap evidence. Retire that financial adapter while keeping the independent provider observer. `readBudgetUsageTotal` serves cap evaluator/settings; public token/provider reporting already has separate readers.

## Data meaning

- Preserve all reported token categories and original total. SDK `Usage.reasoning` is a subset of output; do not add it again. Preserve available cache-presence flags and reasoning/cache breakdown without fabricating absent fields.
- Keep requested/concrete model, provider/API, usage source, time and stable invocation/event identity. Report identity grants no execution or replay authority.
- A supplied provider actual `0` remains known provider-reported zero. Missing actual cost remains unknown. A positive catalogue estimate remains an estimate; catalogue zero alone does not prove free service.
- Explicit documented-free valuation remains known zero. Partial valuation retains its known subtotal and unknown categories; it cannot become a complete actual bill.
- Available actual terminal facts remain available on error/cancel/reopen. Zero telemetry on an unsuccessful outcome does not prove no external effect or free service.
- A real terminal invocation with zero tokens and explicitly supplied provider cost zero retains that fact. Anonymous all-zero placeholders may be skipped without inventing an invocation. The existing recorder zero-cost test has nonzero tokens; it does not cover this boundary.
- Preserve original SDK outcomes and privacy boundaries. Do not mutate outcomes to repair reporting, retain unrestricted diagnostics/secrets or trust caller-supplied repair bytes.
- Preserve source currency/units and distinguish estimates from provider amounts. Current `pricing_currency='USD'` labels API-equivalent valuation. It does not independently establish the unit of every arbitrary provider-native cost extension. Stock SDK 1.4.0 `Usage` exposes category cost and optional `reasoning`, with no generic provider-actual currency field. Verify each supported producer's unit; label unknown units and never silently sum unlike currencies, credits or percentages as USD. No generic FX/accounting subsystem is required.

## Remove the financial dependency

`storeTokenUsage` currently verifies native reports against a reservation and inserts through `insertBudgetUsageEvent`. Projection/retention also consult financial request/work/window state. Preserve canonical historical values and source evidence before retiring those owners.

`modelRequestAccounting`, `reserveHostRequest` and runtime accounting callbacks combine observation, exact outcome recovery and financial admission/settlement/readiness. `RetainedAccountingPending` inherits financial denial. Remove pricing/reporting debt from execution authority; no always-allow callback or renamed request ledger may remain.

Keep only reproduced nonfinancial source/SQL/result-integrity obligations in the existing SDK/effect owners. A valid stored terminal must remain recoverable once without provider/auth/tool replay. An uncertain prior send must never be adopted or resent. Source revocation still forbids new effects; preserving passive facts grants no execution permission.

Optional observer/reporting failure cannot erase a known result, convert it to failed execution, suppress its publication or block independent fresh work. Genuine failed source/owner checks, corrupt execution outcomes and failed execution-storage transactions retain their existing failure semantics. Price availability and telemetry repair cannot become readiness gates.

Historical schema/source transitions need explicit proof and separately authorised live handling. Do not drop the only canonical report/terminal evidence, then rely on mutable reporting rows to reconstruct it.

## Current gaps to test

- Native `prepareUsage` reads extra `reasoningTokens/reasoning_tokens`; stock SDK `Usage.reasoning` and retained receipt decoding need an explicit native preservation case. Recorder coverage alone is insufficient.
- All-zero tokens with a supplied actual zero need an attributed terminal case; current tests intentionally ignore anonymous zero payloads.
- Provider cost units/currency must follow actual producer evidence. Existing valuation currency is insufficient to certify arbitrary provider actual units.
- Direct financial request/work/event dependencies remain in current source. Running with caps disabled does not qualify their removal.

## Focused acceptance matrix

| Case | Required witness |
|---|---|
| Fresh supported action with no financial schema/config/work/cap | Executes under current nonfinancial authority; tokens/prices/provider facts remain available |
| Missing/changing price, unavailable quota observation or reporting backlog | No expense denial, delay or model fallback; physical model/source/context/output integrity remains |
| Known success plus observer/report failure | Original result publishes once; no tool/provider replay or fabricated outcome |
| Normal/error/aborted/tool/maintenance/compaction | Available original token/cost/source facts survive with truthful provenance |
| Positive/zero actual, estimate-only, unknown, documented free, partial valuation | Values, known/unknown distinctions and units remain separate |
| Crash/reopen at before-receipt, after-receipt and after-local-commit windows | Preserve #1820's original source/ACK/task/checkpoint/outcome; exact known recovery once and zero uncertain-send replay |
| Cancellation/revocation/contention/lost ACK | Existing source/owner/SQL-only/acquisition-only/commit certainty survives independently of finance |
| Historical reports and retention | Preserve original payload/provenance and bounded atomic retention proofs; no live prune or schedule change |
| Goal/context/charts/model picker/provider observation | Existing actual readers, coverage, labels, units and keyboard/accessibility/both-skin behavior remain |

The initial reporting baseline is 62 passing tests/290 assertions across five files: DB token usage, usage projection, usage retention, agent-pool usage and budget-accounting. It includes financial expectations. Retire the deliberate expense contract while preserving independent reliability assertions. Native financial-free and affected package/type/browser checks remain delivery requirements.

## Delivery

#1882 owns useful usage/valuation/report decoupling and observation tests. #1877 owns financial SDK/runtime gate/lifecycle removal; #1880 owns add-on/grant consumers; #1879 owns scheduled financial blockage; #1881 owns management surfaces; #1878 removes financial schema/API owners after retained consumers are independent. #1883 audits the exact integrated source and genuine handwritten owner/layer reduction. Merge and operational permission remain separate.
