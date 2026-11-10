# Native usage reports

Usage reporting is passive. The public SDK owns model/tool execution, durable outcomes and history. No cap, reservation, financial work owner, accounting barrier or valuation prerequisite admits execution or withholds a known result.

## Current facts and readers

`recordMessageUsage` observes actual terminal/provider facts; `storeTokenUsage` appends an idempotent `token_usage` row. Existing event/session/invocation identities prevent duplicate observations. Input/output/reasoning/cache/total counts and provider/model/response-model/source attribution remain available. Goal token accounting reads SDK evidence through its existing domain path. Reasoning remains a subset of output and is never added twice.

SDK1.5.2 cost values have the SDK's documented USD unit. `cost.totalFromProvider:true` identifies billed total, including supplied zero. Category rates are catalogue valuation inputs; an unmarked zero placeholder does not prove a provider bill or a documented free rate. Arbitrary legacy native amounts acquire a currency only from an explicit supported currency field; current catalogue prices never supply that missing unit.

Provider actual totals, catalogue estimates and API-equivalent valuation have separate fields/provenance. Aggregate monetary totals require one explicitly known compatible currency. Mixed or unknown units produce an unknown total; token counters and individual raw amounts remain available. Both skins and context/status DTOs retain unknown/zero distinctions. Model selection shows a price indication or `Price unknown`.

The token chart no longer reads or accumulates unused monetary columns. Its separate estimated-cost mode uses quoted pricing references, retains documented zero, exposes a known subtotal and coverage, and leaves incomplete full/day estimates unknown. It never labels these estimates a provider bill.

## Historical records

Old financial tables, payload/hash bytes, receipts, constraints and foreign keys remain untouched. They are not an execution lifecycle. Fresh roots create no financial tables or financial migration receipts. Missing/corrupt historical payloads are not decoded, repaired, backfilled or used to reconstruct reports. The old payload codec/reconciliation API has no current caller and is removed.

Cleanup and retention inspect optional structural event/request references only when their original tables exist. Referenced observations and recognised legacy windows remain protected. Preview/apply use the existing consistent transaction and exact-row proof; no financial state is settled or hold released. SDK entries, original outcomes and uncertain execution are never replayed to repair a report.

## Failure and delivery boundaries

An unavailable price, old cap, unresolved monetary record or observation-write failure cannot block fresh supported work or conceal an already known SDK result. Genuine source/auth/owner, storage certainty, context/output limits, cancellation and cleanup failures remain explicit. No failure is converted into fabricated zero usage or a guessed bill.

The previous request-ledger design and measurements remain in Git history at Core commit1f4149440. They are historical evidence, not a supported current financial API. Live table/history deletion, hold clearing, restore, configuration, scheduling or deployment requires separate approval.
