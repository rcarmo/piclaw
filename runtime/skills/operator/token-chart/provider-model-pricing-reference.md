# Provider/model pricing reference

_Reference tag: 2026-11-09_

This file records the sources and assumptions behind the token chart's **estimated API-equivalent** costs. The executable resolver is `provider-model-pricing-reference.ts`. Dated additions take precedence only for their exact provider/model rows: Fable/Mythos 5.2 on November 9, Terra 6.1 on November 4, native Mistral Large 4 on October 6 and native GPT-6.1 Sol on September 29. Older snapshots and rules remain explicitly dated fallbacks.

## 9 November 2026 — Claude Fable 5.2 and Mythos 5.2

- Native Anthropic Standard prices per million tokens: **$8 input, $0.20 cache read, $10 5m write, $40 output**. One-hour writes cost $16 and are retained in the dossier, not represented by the estimator's single write meter. Both models have the same prices and no long-context premium across 1M context; Mythos requires verified-organisation access.
- Explicit local `-fast` pricing selectors use **$16 input, $0.40 read, $20 5m write, $80 output**; 1h writes are $32. These selectors describe request pricing, not upstream model IDs. The estimator does not infer Fast, Batch or US-only geography from an ordinary model ID.
- `claude-fable-5-2` / `claude-mythos-5-2` API IDs and dotted/Graphite spellings normalise to the same native rows. Provider matching remains exact. No 5.2 Copilot, OpenRouter, Azure or Google quote is inferred.
- [Complete rate card and source evidence](../../../../docs/finops/2026-11-09/README.md) retain all 12 native Standard/Batch/Fast/global/US-only cards, subscription and API-credit terms, and 490 AWS prices across 35 regions. AWS global, commercial non-global and GovCloud tariffs stay distinct and are not flattened into a context-free estimator row. Unverified routes remain labelled.
- Standard rates are 20% below 5.1. Equal-token pricing is not equal successful-task cost; thinking, cache misses and subagents can change the bill. This data update changes no model availability, authentication, default selection or historical usage.

## 6 October 2026 — Mistral Large 4

- Native Mistral API undiscounted prices per million tokens: **$1.36 input, $0.14 cached input and $4.18 output**, from the [model page](https://docs.mistral.ai/models/mistral-large-4-0). The resolver recognises the documented `mistral-large-4` and `mistral-large-4-0` names only on the `mistral` route.
- The two-week 50% launch offer is excluded from the estimate and ranking. Its displayed $0.68/$0.07/$2.09 values remain in the captured evidence.
- No separate cache-write tariff is published. The local write meter uses **$1.36 ordinary input as an explicit estimator fallback**, not a new write surcharge or a free write. Mistral's `prompt_tokens` already includes cached tokens; uncached input is `prompt_tokens - cached_tokens`.
- The model page quotes 1M context and one price schedule; no separate long-context uplift was found. It is a public preview that can receive silent updates. Weights are promised for the end of October, not available in the announcement.
- [Dated evidence, seven-model comparison and verifier](../../../../docs/finops/2026-10-06/README.md). The other six models retain their captured 6 October 06:46 UTC comparison rates; their runtime rows are not refreshed by this addition.

## 29 September 2026 — GPT-6.1 Sol

- Native OpenAI API standard prices per million tokens: **$2 input, $0.10 cache read, $2.50 cache write, $10 output**. The cache-read rate is half GPT-6 Sol's; other short-context rates match.
- Above 272K input tokens, full-request rates are $4 / $0.20 / $5 / $15 respectively. Batch/Flex are 50% of Standard, Fast is 2×; EU data residency cannot use Fast. Request-level modifiers remain outside the chart's base-tier estimator.
- [Evidence and route boundaries](../../../../docs/finops/2026-09-29/README.md). Copilot and OpenRouter did not quote this route at retrieval; other providers stay unpriced. API-equivalent cost is separate from subscription billing.

## 22 September 2026 refresh

- **609 verified route rows** across 12 provider IDs; 195 processing/geography variants remain in the detailed research catalogue.
- GPT-6 Sol: $2 input / $10 output / $0.20 read / $2.50 write. GPT-6 Luna: $0.10 / $0.50 / $0.01 / $0.125.
- Claude Opus 5.5: $4 input / $20 output / $0.20 read / $5 5m write / $8 1h write. Native API ID `claude-opus-5-5` resolves alongside the catalogue alias.
- Sonnet 5's $2/$10 price is permanent. Copilot quotes are independently verified; new OpenAI models are not assumed available there.
- Updates Google promotions, DeepSeek peak/off-peak pricing and alias changes, Z.ai, Fireworks, Kimi, xAI and numeric Groq public routes. Native Grok 4.5 cache reads differ from Copilot ($0.30 versus $0.50).
- [Current tables and evidence](../../../../docs/finops/2026-09-22/README.md), [full price table](../../../../docs/finops/2026-09-22/prices.md), [fixed-scenario comparison](../../../../docs/finops/2026-09-22/scenario-comparison.md).
- Base-tier chart estimates remain distinct from exact request billing. Detailed sources preserve service tiers, long context, TTLs, promotions and time schedules. Unknown tariffs and historical fallbacks are labelled; no ledger records or runtime defaults change.

## 5 September 2026 refresh — historical

- Adds GPT-6 Astra, Claude Fable 5/5.1 and all publicly priced OpenRouter routes in the retrieved snapshot.
- Fable 5.1 cache reads: $0.25/MTok; Fable 5: $1/MTok. Both use $10 input, $50 output and $12.50 5m cache writes.
- Direct OpenAI/Copilot Sol: $4 input/$20 output; OpenRouter Sol: $2/$10 at retrieval. Route identity is preserved.
- Astra: $10 input/$50 output/$1 cached input/$12.50 cache writes in the short-context tier. Long-context charges require request-level estimation outside this chart helper.
- Unknown cache tariffs use ordinary input as a conservative estimate, never free-cache assumptions.
- Copilot now documents token-based AI credits (1 credit = $0.01); allowances and budgets still affect the invoice. Codex uses ChatGPT subscription allowances, so API-equivalent costs are not its bill.
- Sources: [OpenAI](https://developers.openai.com/api/docs/pricing.md), [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing.md), [Copilot](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing.md), [OpenRouter](https://openrouter.ai/api/v1/models).
- The tables below remain historical documentation for fallback rows; consult the snapshot for refreshed routes. No historical ledger rows are rewritten.

## Source hierarchy

1. First-party provider pricing/documentation.
2. The live OpenRouter `/api/v1/models` response for OpenRouter-specific routes.
3. Explicitly labeled estimator fallbacks only when a provider does not publish a meter needed by local telemetry.

Primary sources checked on 2026-07-14, refreshed for Opus 5 / Kimi K3 on 2026-07-25, and route/plan details re-verified on 2026-08-03:

- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [Anthropic API pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)
- [Claude Opus 5 announcement](https://www.anthropic.com/news/claude-opus-5)
- [Kimi K3 pricing](https://platform.kimi.ai/docs/pricing/chat-k3)
- [Z.AI pricing](https://docs.z.ai/guides/overview/pricing)
- [MiniMax PAYG pricing](https://platform.minimax.io/docs/guides/pricing-paygo)
- [Azure Foundry Mistral pricing](https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/mistral-ai/)
- [Cerebras GPT-OSS pricing](https://inference-docs.cerebras.ai/models/openai-oss)
- [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [Azure Foundry DeepSeek pricing](https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/deepseek/)
- [OpenRouter models API](https://openrouter.ai/api/v1/models)

## Interpretation and limitations

- GitHub Copilot, Codex, Claude subscriptions, Fire Pass, and Azure agreements are **not** token-priced invoices. Their rows show underlying public API-equivalent value unless a separate subscription analysis is performed.
- Provider-specific routes are resolved separately where prices differ. A native model ID must not silently inherit an OpenRouter or Azure price.
- A cache value marked `†` is an estimator fallback, not a published provider cache tariff. Because local telemetry can report cache reads/writes outside ordinary input, the estimator explicitly charges those tokens at ordinary input price rather than silently treating them as free.
- GPT-5.6 has a published cache-write price; GPT-5.5, GPT-5.4, and older OpenAI rows do not. GPT-5.5's `$5/MTok` cache-write value is therefore an estimator fallback, not an official cache-write tariff.
- OpenAI rates are the standard `<=272K` input tier. Higher long-context rates are not modeled.
- Anthropic cache-write values are the 5-minute TTL rates. One-hour writes are higher and are not represented by the single local cache-write field. Opus 5 Fast mode is represented separately because it is priced at 2x the standard Opus 5 base rate.
- Claude Opus 4.6 (1M) currently uses the standard Opus row; context-related premiums or geo multipliers are not modeled.
- Fire Pass coverage is account-specific. Fireworks fast/turbo routers use PAYG rates here; a subscription comparison may subtract covered usage separately.
- OpenRouter rows represent credits consumed at the displayed token rates. They exclude OpenRouter's separate 5.5% credit-purchase fee ($0.80 minimum), which cannot be allocated reliably per model or request.
- Azure publishes only input/output prices for DeepSeek V4 Flash. Its cache-read and cache-write fields are conservatively modeled at ordinary input price and are not published Azure cache tariffs.
- Local inference is `$0` only for metered API cost. Electricity, hardware depreciation, and operations are excluded.

## Subscription-plan cross-check (not used by the resolver)

Checked 2026-07-14. Subscription allowances and PAYG token prices are not interchangeable.

| Product | Current individual tiers | Included allowance / reset | After included allowance |
| --- | --- | --- | --- |
| OpenAI Codex | Free $0; Go $8; Plus $20; Pro $100 (5x); Pro $200 (20x) per month | Model-specific usage allowance shared in a 5-hour window, with additional weekly limits. The active Codex usage dashboard is authoritative; static message counts are not stable enough to use as a monthly-capacity estimate. | Eligible Plus/Pro users can buy additional ChatGPT credits after reaching included limits; Codex's token credit card maps to standard API rates. API-key usage is separately billed PAYG. |
| Claude | Pro $20; Max 5x $100; Max 20x $200 per month | Max provides 5x/20x Pro session usage; five-hour session and separate weekly limits apply. Anthropic does not publish a fixed monthly token or dollar allowance. | Optional usage credits continue at standard API rates; otherwise usage pauses until reset. API Console usage remains separate from the subscription. |
| GitHub Copilot | Pro $10; Pro+ $39; Max $100 per month | Current primary table lists $15/$70/$200 in total monthly GitHub AI Credits respectively (base plus variable flex allotment); 1 GitHub AI Credit = $0.01. | Optional paid usage requires a dollar budget; otherwise wait for the monthly reset or use a cheaper model. GitHub's interaction-credit accounting is not the same as raw API-token costing. |
| Z.AI GLM Coding Plan | List prices: Lite $18; Pro $72; Max $160 per month. The subscribe page displayed promotional $12.60/$50.40/$112 prices when checked. | About 80/400/1,600 prompts per 5 hours and 400/2,000/8,000 per week. GLM-5.2 is charged 2x off-peak or 3x peak against plan quota. | Published plan documentation describes quota resets, not automatic PAYG overage; native API PAYG is a separate route. |

Sources: [Codex pricing](https://developers.openai.com/codex/pricing), [OpenAI Pro tiers](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers), [Claude Max](https://support.claude.com/en/articles/11049741-what-is-the-max-plan), [Claude usage credits](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans), [GitHub Copilot plans](https://github.com/features/copilot/plans), [Z.AI Coding Plan](https://docs.z.ai/devpack/overview), and [Z.AI subscribe](https://z.ai/subscribe).

## Reference rows (USD per 1M tokens)

| Model key / route | Input | Output | Cache read | Cache write | Provenance / note |
| --- | ---: | ---: | ---: | ---: | --- |
| `claude-opus-5` | $5.00 | $25.00 | $0.50 | $6.25 | Anthropic standard, verified 2026-08-03; same base rates as Opus 4.8; 1h write is $10, not modeled in the single cache-write field |
| `claude-opus-5-fast` | $10.00 | $50.00 | $1.00 | $12.50 | Anthropic Fast mode research preview, verified 2026-08-03; 1h write is $20, not modeled in the single cache-write field |
| `anthropic/claude-opus-5` on OpenRouter | $5.00 | $25.00 | $0.50 | $6.25 | Live route, verified 2026-08-03; 1h cache-write route field is $10 |
| `anthropic/claude-opus-5-fast` on OpenRouter | $10.00 | $50.00 | $1.00 | $12.50 | Live route, verified 2026-08-03; 1h cache-write route field is $20 |
| `claude-opus-4.5` | $5.00 | $25.00 | $0.50 | $6.25 | Anthropic standard; 5m write |
| `claude-opus-4.6` | $5.00 | $25.00 | $0.50 | $6.25 | Anthropic standard; 5m write |
| `claude-opus-4.6-1m` | $5.00 | $25.00 | $0.50 | $6.25 | Standard row; long-context premium not modeled |
| `claude-opus-4.7` | $5.00 | $25.00 | $0.50 | $6.25 | Anthropic standard; 5m write |
| `claude-opus-4.8` | $5.00 | $25.00 | $0.50 | $6.25 | Anthropic standard; 5m write; Fast mode excluded |
| `claude-sonnet-4.6` | $3.00 | $15.00 | $0.30 | $3.75 | Anthropic standard; 5m write |
| `gpt-5.4` | $2.50 | $15.00 | $0.25 | $2.50† | OpenAI standard tier |
| `gpt-5.4-mini` | $0.75 | $4.50 | $0.075 | $0.75† | OpenAI standard tier; distinct from GPT-5 Mini |
| `gpt-5.5` | $5.00 | $30.00 | $0.50 | $5.00† | Official token rates; cache-write fallback only |
| `gpt-5.6-sol` / `gpt-5.6` | $5.00 | $30.00 | $0.50 | $6.25 | OpenAI published cache-write rate |
| `gpt-5.6-terra` | $2.50 | $15.00 | $0.25 | $3.125 | OpenAI published cache-write rate |
| `gpt-5.6-luna` | $1.00 | $6.00 | $0.10 | $1.25 | OpenAI published cache-write rate |
| `gpt-5.4-pro` | $30.00 | $180.00 | $0.00 | $30.00† | No published cached-input/write rate |
| `gpt-5-mini` | $0.25 | $2.00 | $0.025 | $0.25† | Legacy GPT-5 Mini row; no longer a 5.4-mini proxy |
| `gpt-5.1-codex` | $1.25 | $10.00 | $0.125 | $1.25† | OpenAI row; corrected from 5.3 proxy |
| `gpt-5.1-codex-mini` | $0.25 | $2.00 | $0.025 | $0.25† | OpenAI row; corrected from 5.4-mini proxy |
| `gpt-5.2-codex` | $1.75 | $14.00 | $0.175 | $1.75† | OpenAI row |
| `gpt-5.3-codex` | $1.75 | $14.00 | $0.175 | $1.75† | OpenAI row |
| `gpt-5.3-codex-spark` | — | — | — | — | Research preview; no published API/PAYG rate, so the resolver leaves it unpriced |
| `gpt-4o` | $2.50 | $10.00 | $1.25 | $2.50† | OpenAI row; cached-input price restored |
| `mistral-large-3` on Azure Foundry | $0.50 | $1.50 | $0.00 | $0.50† | Azure Foundry PAYG |
| `gpt-oss-120b` on Cerebras | $0.35 | $0.75 | $0.00 | $0.35† | Cerebras first-party, replacing OpenRouter proxy |
| `minimax-m2.7` | $0.30 | $1.20 | $0.06 | $0.375 | MiniMax native/Fireworks standard |
| `minimax/minimax-m2.7` on OpenRouter | $0.24 | $0.96 | $0.00 | $0.24† | Live OpenRouter route |
| `minimax-m2.7-highspeed` | $0.60 | $2.40 | $0.06 | $0.375 | MiniMax high-speed |
| `minimax-m2.5` | $0.30 | $1.20 | $0.03 | $0.375 | MiniMax native |
| `minimax/minimax-m2.5` on OpenRouter | $0.15 | $0.90 | $0.05 | $0.15† | Live OpenRouter route |
| `minimax/minimax-m2` on OpenRouter | $0.255 | $1.02 | $0.00 | $0.255† | Live OpenRouter route |
| `minimax/minimax-m2.1` on OpenRouter | $0.30 | $1.20 | $0.03 | $0.30† | Live OpenRouter route |
| `minimax/minimax-m1` on OpenRouter | $0.40 | $2.20 | $0.00 | $0.40† | Live OpenRouter historical row |
| `kimi-k3` | $3.00 | $15.00 | $0.30 | $3.00† | Moonshot/Kimi first-party, verified 2026-08-03; published as cache-miss input, cache-hit input, and output; no separate cache-write tariff |
| `moonshotai/kimi-k3` on OpenRouter | $3.00 | $15.00 | $0.30 | $3.00† | Live OpenRouter route, verified 2026-08-03; cache write is ordinary routed input fallback |
| Fireworks `kimi-k2p6-{fast,turbo}` | $2.00 | $8.00 | $0.30 | $2.00† | PAYG; Fire Pass coverage not assumed |
| `moonshotai/kimi-k2.6` on OpenRouter | $0.66 | $3.41 | $0.15 | $0.66† | Live OpenRouter route |
| `kimi-k2.6` / `kimi-k2p6` | $0.95 | $4.00 | $0.16 | $0.95† | Moonshot/Fireworks standard |
| `kimi-k2.5` / `kimi-k2p5` | $0.60 | $3.00 | $0.10 | $0.60† | Legacy historical row |
| `glm-5.2` / `glm-5p2` | $1.40 | $4.40 | $0.26 | $1.40† | Z.AI native; limited-time cache-storage offer excluded |
| `z-ai/glm-5.2` on OpenRouter | $0.9282 | $2.9172 | $0.17238 | $0.9282† | Live OpenRouter route |
| `deepseek-v4-flash` on Azure Foundry | $0.19 | $0.51 | $0.19† | $0.19† | Azure Global PAYG; cache fields are conservative estimator fallbacks |
| `deepseek-v4-flash` native | $0.14 | $0.28 | $0.0028 | $0.14† | DeepSeek native |
| `deepseek/deepseek-v4-flash` on OpenRouter | $0.09 | $0.18 | $0.018 | $0.09† | Live OpenRouter route |
| `gemma4-e4b-qat-mtp` on `milkv-local` | $0.00 | $0.00 | $0.00 | $0.00 | API meter only; infrastructure excluded |
