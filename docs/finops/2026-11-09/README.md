# Claude Fable 5.2 and Mythos 5.2 — complete pricing check

Checked 9 November 2026. USD before tax. Native rates below apply equally to both models; Mythos requires verified-organisation access. They are usage tariffs, not an unlimited subscription entitlement. The token-cost estimator includes native Standard and explicit Fast-selector rates. No live model registry, defaults, deployment or billing configuration changes are made.

## Claude API rates

Rates per million tokens, with global inference:

- **Standard:** $8 fresh input; $0.20 cache read; $10 cache write with 5-minute retention; $16 cache write with 1-hour retention; $40 output.
- **Batch:** $4 fresh input; $0.10 cache read; $5 5-minute write; $8 1-hour write; $20 output. Cache rates are calculated from the published 50% Batch discount stacked with prompt-cache multipliers. Actual Batch cache hits are best effort; asynchronous ordering can reduce reuse.
- **Fast:** $16 fresh input; $0.40 cache read; $20 5-minute write; $32 1-hour write; $80 output. Cache rates follow the published caching multipliers applied to Fast input pricing. Advertised output generation is up to 2.5× faster; end-to-end speed is workload-dependent.

Fast and Batch cannot be combined. Fast has separate capacity/rate limits. Neither model supports Priority Tier. No published committed-throughput or negotiated-discount rate is inferred.

**US-only inference adds 10% to every token category**, stacking with Standard, Batch or Fast. For example Standard US-only is $8.80 input / $0.22 read / $11 5m write / $17.60 1h write / $44 output. `native-rates.csv` contains all 12 model/tier/geography combinations.

**No long-context surcharge:** Standard rates apply across the full 1M-token context window; max output is 128K. Minimum cacheable prefix is 512 tokens on the documented supported platforms. Cache writes are the total rate for those write tokens, not an extra input surcharge. Fresh input, cache reads and cache writes are separate usage categories: do not bill the same token twice.

## Subscription costs and actual Fable entitlement

- **Pro:** $20/month, or $200 billed annually. Fable normally uses separately paid usage credits; Pro does not normally include it in its subscription allowance. No included API-credit benefit.
- **Max:** $100/month. Fable included for up to 50% of the shared weekly allowance; also $100/month in claimable Claude API credits. Overall included allowance advertised as 5× Pro.
- **Ultra:** $200/month. Fable included for up to 50% of the shared weekly allowance; also $200/month in claimable Claude API credits. Overall weekly allowance advertised as 10× Pro. No five-hour limit applies only to verified Ultra accounts.
- **Team Standard:** $25/seat/month, or $20/seat/month billed annually. Fable normally uses usage credits. $20/month API credit per seat.
- **Team Premium:** $125/seat/month, or $100/seat/month billed annually. Fable included for up to half of the shared weekly allowance. $100/month API credit per seat.
- **Team API-credit pool:** combined cap of $500/month per organisation. Team is advertised for 2–150 users; seat entitlements and administrator enablement still apply.
- **Current self-serve Enterprise:** $20/seat/month billed annually, 20-seat minimum, **plus API-rated usage**. Legacy seat-based Enterprise contracts differ; do not assume the same included Fable allowance. No included monthly API-credit benefit is advertised for Enterprise in the cited benefit guide.

API credits must be claimed by linking an eligible plan to a Claude Console organisation. New subscribers wait seven days. Credits expire each billing cycle (monthly for annual plans), do not roll over, and do not increase app/Claude Code limits. They cover the Claude API, Managed Agents, Agent SDK and playground; **not interactive Claude Code, extra app usage, or AWS/GCP/Azure charges**. API keys in the linked organisation share the balance. Purchased credits or ordinary invoicing can continue billing after the included benefit is exhausted, depending on configuration.

### Launch offer

From 9 November through **16 November 2026, 11:59 pm Pacific**, Pro and Team Standard can use Fable for up to 50% of their weekly allowance. It reverts to usage-credit billing afterwards. Eligible subscribers billed before 9 November at 10 am Pacific receive a Fable reset; the Pro/Standard reset expires with the launch window. Max/Ultra and eligible premium seats receive one to three resets based on subscription tenure, expiring 8 March 2027 at 11:59 pm Pacific. Resets restore spent usage; they do not raise limits or provide cash/API credits.

## Cloud and routed platforms

### Anthropic-operated marketplace platforms

Claude Platform on AWS and Anthropic-hosted Microsoft Foundry use the documented native token tariffs and feature pricing. They meter in Claude Consumption Units (CCUs): **1 CCU = $0.01; 100 CCU = $1**. The unit conversion is not a discount. Negotiated private offers may change the result. US-pinned geography adds 10% where applicable.

Claude Models on Google Cloud (Anthropic managed) also bills through marketplace CCUs at $0.01 each. Keep this route distinct from Google-managed Claude; no independent 5.2 numerical marketplace row beyond the captured documentation is claimed here.

### Amazon Bedrock-operated models

Audited the official **AmazonBedrockFoundationModels** price feed across all **35 listed regions**, not the older AmazonBedrock feed. There are 490 model-specific 5.2 rows:

- **Global Standard, where listed:** same $8 input / $0.20 read / $10 5m write / $16 1h write / $40 output.
- **Commercial non-global Standard SKUs, where listed:** $8.80 / $0.22 / $11 / $17.60 / $44 respectively — 10% above global.
- **GovCloud Standard:** $9.60 / $0.24 / $12 / $19.20 / $48 respectively — 20% above global. GovCloud entries do not list global 5.2 SKUs.

The commercial non-global Standard SKUs were found in ca-central-1, ca-west-1, eu-central-1, eu-central-2, eu-north-1, eu-south-1, eu-south-2, eu-west-1, eu-west-2, eu-west-3, us-east-1, us-east-2, us-west-1 and us-west-2. Other audited commercial regions list global 5.2 SKUs only. Detailed region, model, SKU description, unit, price and effective date are in `aws-regional-rates.csv`. A SKU is not access permission or a capacity guarantee. Price-file effective dates are not model release dates. No Bedrock Fast, Batch or provisioned-throughput price is invented from the native rates.

### Gaps as checked

- **Google-managed Claude:** model documentation confirms the route, but the public pricing links redirected to generic pricing pages without independently retrievable 5.2 rows. Exact rates remain unverified; native or AWS tariffs must not silently be copied into this route.
- **GitHub Copilot:** no Fable 5.2 or Mythos 5.2 entry in the captured billing table; do not substitute the 5.1 price.
- **OpenRouter:** neither 5.2 model listed in the captured public catalogue.
- **Local model picker:** no Fable/Mythos 5.2 result at the time checked. General launch availability does not establish access through each account or provider.

## Additional usage charges

- **Client-side tools, Bash, editor, computer/browser tools:** ordinary model tokens, plus your own infrastructure/provider costs. Tool definitions, results, images and thinking can increase billable token volume; autonomous subagents multiply it.
- **Anthropic web search:** $10 per 1,000 successful searches, plus model tokens for search content. Failed searches are not charged.
- **Web fetch:** no separate service fee; fetched content costs ordinary input tokens.
- **Hosted code execution:** no extra execution charge when supported web-search/web-fetch tool versions are included. Otherwise 1,550 free container-hours per organisation/month, then $0.05/container-hour; minimum five minutes. File preloading can start execution billing even without a tool call.
- **Claude Managed Agents:** tokens plus $0.08 per active session-hour. Runtime accrues in `running`, not idle/rescheduling/terminated. This replaces separate container-hour charges; do not add both. Fast/US-only token modifiers still apply; Batch does not apply to stateful Managed Agents.
- **Sales discounts, taxes and third-party gateway/infrastructure charges:** separate, account/contract-dependent. No public enterprise discount percentage is assumed.

## Comparison and example

Relative to Fable/Mythos 5.1, **every Standard token category is 20% cheaper**. Fable 5.2 costs 2× Opus 5.5 for fresh input, writes and output, but cache reads are identical at $0.20/M. Against native GPT-6.1 Sol's short-context base tariff it is 4× for fresh input/output/short writes and 2× for reads; the cache TTLs and long-context pricing differ, so that is not a whole-workload multiplier.

Illustrative same-token request: 100K prompt tokens, consisting of 90K reads, 5K 5m writes, 5K fresh input, plus 10K output. No tool/runtime/tax charges:

- Fable/Mythos 5.2 Standard: **$0.508**; Batch **$0.254**; Fast **$1.016**.
- Fable/Mythos 5.1 Standard: **$0.635**.
- Opus 5.5 Standard: **$0.263**.
- Sonnet 5.5 Standard: **$0.1315**.

These are equal-token illustrations, not observed fleet bills or proof of equal task success. Anthropic's reported lower cost per solved task at lower effort is a separate benchmark claim. Preserved-thinking prefix mismatches and model/account switching can discard reasoning and increase regenerated output; Fable 5.2 enforces the prefix check for all accounts. Qualify harness compatibility and measure successful-task cost before switching fleet defaults.

## Sources and reproducibility

- [Announcement](https://www.anthropic.com/claude-fable-and-mythos-5-2)
- [Native API pricing, caching, Fast, Batch, residency and tool fees](https://platform.claude.com/docs/en/about-claude/pricing)
- [Plans](https://claude.com/pricing)
- [Fable plan entitlements](https://support.claude.com/en/articles/15424964)
- [Launch offer](https://support.claude.com/en/articles/17506494)
- [Included API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)
- [AWS foundation-model regional price-list index](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/region_index.json)
- [Copilot pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)
- [OpenRouter catalogue](https://openrouter.ai/api/v1/models)

`sources/manifest.json` stores source URLs, retrieval timestamps and SHA-256 hashes of uncompressed bytes. Larger captures are gzip-compressed, including all 35 official AWS regional catalogues. `complete-pricing.json` retains all 12 native model/tier/geography cards, 490 AWS prices and platform/subscription caveats. Run `bun docs/finops/2026-11-09/verify.ts` to check the captured sources, extracted prices, multipliers, CSV files and runtime estimator records without network or browser access. Native Batch cache and Fast cache rates are explicitly derived from published multipliers, not mislabelled as independent quotations. No browser rendering, paid inference, subscription purchase, model change or runtime configuration update was performed.
