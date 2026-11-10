---
title: Pricing
url: https://platform.claude.com/docs/en/about-claude/pricing
description: Learn about Anthropic's pricing structure for models and features
---

This page provides detailed pricing information for Anthropic’s models and features. All prices are in USD.

For the most current pricing information, visit [claude.com/pricing](https://claude.com/pricing).

## Model pricing

The following table shows pricing for all Claude models:

| Model                                                                                                                                                                  | Base input tokens     | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens          |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------- | :-------------- | :-------------- | :----------------------- | :--------------------- |
| Claude Fable 5.2                                                                                                                                                       | $8 / MTok             | $10 / MTok      | $16 / MTok      | $0.20 / MTok<sup>1</sup> | $40 / MTok             |
| Claude Mythos 5.2 ([limited availability](https://support.claude.com/en/articles/14604842))                                                                            | $8 / MTok             | $10 / MTok      | $16 / MTok      | $0.20 / MTok<sup>1</sup> | $40 / MTok             |
| Claude Fable 5.1                                                                                                                                                       | $10 / MTok            | $12.50 / MTok   | $20 / MTok      | $0.25 / MTok<sup>1</sup> | $50 / MTok             |
| Claude Mythos 5.1 ([limited availability](https://support.claude.com/en/articles/14604842))                                                                            | $10 / MTok            | $12.50 / MTok   | $20 / MTok      | $0.25 / MTok<sup>1</sup> | $50 / MTok             |
| Claude Fable 5                                                                                                                                                         | $10 / MTok            | $12.50 / MTok   | $20 / MTok      | $1 / MTok                | $50 / MTok             |
| Claude Mythos 5 ([limited availability](https://support.claude.com/en/articles/14604842))                                                                              | $10 / MTok            | $12.50 / MTok   | $20 / MTok      | $1 / MTok                | $50 / MTok             |
| Claude Opus 5.5                                                                                                                                                        | $4 / MTok             | $5 / MTok       | $8 / MTok       | $0.20 / MTok<sup>2</sup> | $20 / MTok             |
| Claude Opus 5                                                                                                                                                          | $5 / MTok             | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok             | $25 / MTok             |
| Claude Opus 4.8                                                                                                                                                        | $5 / MTok             | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok             | $25 / MTok             |
| Claude Opus 4.7                                                                                                                                                        | $5 / MTok             | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok             | $25 / MTok             |
| Claude Opus 4.6                                                                                                                                                        | $5 / MTok             | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok             | $25 / MTok             |
| Claude Opus 4.5                                                                                                                                                        | $5 / MTok             | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok             | $25 / MTok             |
| Claude Opus 4.1 ([retired, except on Claude Models on Google Cloud (Google managed) and Bedrock](https://platform.claude.com/docs/en/about-claude/model-deprecations)) | $15 / MTok            | $18.75 / MTok   | $30 / MTok      | $1.50 / MTok             | $75 / MTok             |
| Claude Opus 4 ([retired, except on Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/about-claude/model-deprecations))               | $15 / MTok            | $18.75 / MTok   | $30 / MTok      | $1.50 / MTok             | $75 / MTok             |
| Claude Sonnet 5.5                                                                                                                                                      | $2 / MTok             | $2.50 / MTok    | $4 / MTok       | $0.10 / MTok<sup>2</sup> | $10 / MTok             |
| Claude Sonnet 5                                                                                                                                                        | $2 / MTok<sup>3</sup> | $2.50 / MTok    | $4 / MTok       | $0.20 / MTok             | $10 / MTok<sup>3</sup> |
| Claude Sonnet 4.6                                                                                                                                                      | $3 / MTok             | $3.75 / MTok    | $6 / MTok       | $0.30 / MTok             | $15 / MTok             |
| Claude Sonnet 4.5                                                                                                                                                      | $3 / MTok             | $3.75 / MTok    | $6 / MTok       | $0.30 / MTok             | $15 / MTok             |
| Claude Sonnet 4 ([retired, except on Claude Models on Google Cloud (Google managed) and Bedrock](https://platform.claude.com/docs/en/about-claude/model-deprecations)) | $3 / MTok             | $3.75 / MTok    | $6 / MTok       | $0.30 / MTok             | $15 / MTok             |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens)                                                                                                                    | $0.10 / MTok          | $0.125 / MTok   | $0.20 / MTok    | $0.01 / MTok             | $0.50 / MTok           |
| Claude Haiku 5.5 (for prompts over 100,000 tokens)                                                                                                                     | $0.50 / MTok          | $0.625 / MTok   | $1 / MTok       | $0.05 / MTok             | $2.50 / MTok           |
| Claude Haiku 4.5                                                                                                                                                       | $1 / MTok             | $1.25 / MTok    | $2 / MTok       | $0.10 / MTok             | $5 / MTok              |

*<sup>1 Cache hits and refreshes on Claude Fable 5.2, Claude Mythos 5.2, Claude Fable 5.1, and Claude Mythos 5.1 are priced at 0.025x the base input price.</sup>*

*<sup>2 Cache hits and refreshes on Claude Opus 5.5 and Claude Sonnet 5.5 are priced at 0.05x the base input price.</sup>*

*<sup>All other models use the standard 0.1x multiplier.</sup>*

*<sup>3 The $2/$10 per million input/output token pricing for Claude Sonnet 5, announced at launch as introductory pricing through August 31, 2026, is now the standard price. The previously scheduled increase to $3/$15 per million input/output tokens on September 1, 2026 will not occur.</sup>*

* **MTok:** Million tokens. $5 / MTok is $5 for every million tokens.
* **5m cache writes:** Writing a prompt prefix to the 5-minute prompt cache.
* **1h cache writes:** Writing a prompt prefix to the 1-hour prompt cache.
* **Cache hits and refreshes:** Reading a prompt prefix from the prompt cache, which also refreshes it.
* **Limited access:** Available only to organizations verified through Anthropic’s verification programs, such as the [Cyber Verification Program](https://support.claude.com/en/articles/14604842). To request access, apply to the program that covers your use case.
* **Retired:** May still be available on other cloud platforms. See [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations) for more.

Claude 4.7 and later models and Claude Mythos Preview use a newer tokenizer that contributes to their improved performance on a wide range of tasks. This tokenizer produces approximately 30% more tokens for the same text. The exact increase depends on the content and workload shape. Claude Sonnet 4.6 and earlier models use the previous tokenizer.

## Cloud platform pricing

This section covers partner-operated cloud platforms, where the cloud provider invoices you. For Anthropic-operated cloud platforms billed through a marketplace, see [Claude Platform on AWS pricing](https://platform.claude.com/docs/en/about-claude/pricing#claude-platform-on-aws-pricing), [Claude Models on Google Cloud (Anthropic managed) billing](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#billing), and [Claude in Microsoft Foundry pricing](https://platform.claude.com/docs/en/about-claude/pricing#claude-in-microsoft-foundry-pricing).

For official pricing on [Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed) and [Amazon Bedrock](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock), visit:

* [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
* [Google Cloud pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing#claude-models)

<Note>
  **Regional and multi-region endpoint pricing for Claude 4.5 models and beyond**

  Starting with Claude Sonnet 4.5, Haiku 4.5, and Opus 4.5:

  * **Bedrock** offers two endpoint types: global endpoints (dynamic routing for maximum availability) and regional endpoints (guaranteed data routing through specific geographic regions).
  * **Claude Models on Google Cloud (Google managed)** offers global endpoints and multi-region endpoints (dynamic routing within a geographic area) for these models, and regional endpoints for Claude Sonnet 4.6 and earlier models.

  Regional and multi-region endpoints include a 10 percent premium over global endpoints. The Claude API (first-party) is global by default; for first-party data residency options and pricing, see [Data residency pricing](https://platform.claude.com/docs/en/about-claude/pricing#data-residency-pricing).

  **Scope:** This pricing structure applies to Claude Sonnet 4.5 (deprecated), Haiku 4.5, Opus 4.5, and later models. It doesn’t apply to earlier models (Claude Opus 4.1 and prior releases).

  For implementation details and code examples:

  * [Amazon Bedrock global versus regional endpoints](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock#regions) for Opus 4.7, Haiku 4.5, and later models, or the [legacy integration](https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy#global-vs-regional-endpoints) for all other models on Bedrock
  * [Claude Models on Google Cloud (Google managed) global, multi-region, and regional endpoints](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed#global-multi-region-and-regional-endpoints)
</Note>

## Claude Platform on AWS pricing

[Claude Platform on AWS](https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws) bills through AWS Marketplace using Claude Consumption Units (CCUs). Anthropic rates your token usage in USD at standard per-model, per-feature rates, applies any negotiated discount, converts the result to CCUs at $0.01 USD per CCU, and reports the CCU quantity to AWS Marketplace hourly. Your AWS bill shows a single CCU line item.

| Concept             | Details                                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Billing unit**    | Claude Consumption Unit (CCU)                                                                                                                                                                                         |
| **CCU price**       | $0.01 USD per CCU (fixed; discounts apply at token-to-CCU conversion, not to the CCU price)                                                                                                                           |
| **Conversion**      | Token usage rated in USD at standard per-model, per-feature rates (same as [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing#model-pricing)), then converted to CCUs at $0.01 USD per CCU |
| **Billing cadence** | Hourly metering to AWS Marketplace; monthly invoices                                                                                                                                                                  |
| **Payment model**   | Arrears only (postpaid); no prepaid credits                                                                                                                                                                           |
| **Discounts**       | Applied as fewer CCUs metered                                                                                                                                                                                         |
| **Tax**             | Pre-tax metering; AWS Marketplace handles tax                                                                                                                                                                         |
| **Cost visibility** | Real-time breakdown in the Claude Console (access through the AWS Console); AWS Cost Explorer shows aggregated CCU                                                                                                    |

**CCU:** Claude Consumption Unit. A CCU is a unit of measure used solely for Marketplace Platform invoicing. If Customer accesses the Services through certain Marketplace Platforms (e.g., Claude Platform on AWS), usage will be invoiced in Claude Consumption Units (“CCU”) rather than per MTok. One hundred (100) CCU represents $1.00 USD of fees owed for the Services, calculated at the applicable prices on [claude.com/pricing#api](https://claude.com/pricing#api), after application of any discounts.

### Inference geography

For Claude 4.6 and later models, using `inference_geo: "us"` applies a 1.1x pricing multiplier. `inference_geo: "global"` (default) uses standard pricing. See [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency) for details.

### Private offers

When you sign up on the AWS Console **Claude Platform on AWS** service page, the AWS Console looks up any private offer associated with your account and prompts you to accept it in AWS Marketplace. Contact your Anthropic account representative for private offer terms.

<Note>
  If you have an existing Amazon Bedrock private offer, contact your Anthropic or AWS account representative before getting started with Claude Platform on AWS to ensure your discounts are applied correctly. Discounts cannot be applied retroactively to usage incurred before your private offer is accepted.
</Note>

## Claude in Microsoft Foundry pricing

[Claude in Microsoft Foundry](https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry) bills through the Azure Marketplace using Claude Consumption Units (CCUs). Anthropic rates your token usage in USD at standard per-model, per-feature rates, applies any negotiated discount, converts the result to CCUs at $0.01 USD per CCU, and reports the CCU quantity to the Azure Marketplace hourly. Your Azure bill shows a single CCU line item.

| Concept             | Details                                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Billing unit**    | Claude Consumption Unit (CCU)                                                                                                                                                                                         |
| **CCU price**       | $0.01 USD per CCU (fixed; discounts apply at token-to-CCU conversion, not to the CCU price)                                                                                                                           |
| **Conversion**      | Token usage rated in USD at standard per-model, per-feature rates (same as [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing#model-pricing)), then converted to CCUs at $0.01 USD per CCU |
| **Billing cadence** | Hourly metering to the Azure Marketplace; monthly invoices                                                                                                                                                            |
| **Payment model**   | Arrears only (postpaid); no prepaid credits                                                                                                                                                                           |
| **Discounts**       | Applied as fewer CCUs metered                                                                                                                                                                                         |
| **Tax**             | Pre-tax metering; Azure Marketplace handles tax                                                                                                                                                                       |
| **Cost visibility** | Azure Cost Management shows aggregated CCU                                                                                                                                                                            |

**CCU:** Claude Consumption Unit. A CCU is a unit of measure used solely for Marketplace Platform invoicing. If Customer accesses the Services through certain Marketplace Platforms (e.g., Claude Platform on AWS, Claude in Microsoft Foundry), usage will be invoiced in Claude Consumption Units (“CCU”) rather than per MTok. One hundred (100) CCU represents $1.00 USD of fees owed for the Services, calculated at the applicable prices on [claude.com/pricing#api](https://claude.com/pricing#api), after application of any discounts.

### Inference geography

Deployments hosted on Azure can use the US Data Zone Standard deployment type, which keeps inference within the United States. This is equivalent to `inference_geo: "us"` on the Claude API and applies the same 1.1x pricing multiplier. See [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency) for details.

## Feature-specific pricing

### Prompt caching

Prompt caching reduces costs and latency by reusing previously processed portions of your prompt across API calls. Instead of reprocessing the same large system prompt, document, or conversation history on every request, the API reads from cache at a fraction of the standard input price.

There are two ways to enable prompt caching:

* **Automatic caching:** Add a single `cache_control` field at the top level of your request. The system automatically manages cache breakpoints as conversations grow. This is the recommended starting point for most use cases.
* **Explicit cache breakpoints:** Place `cache_control` directly on individual content blocks for fine-grained control over exactly what gets cached.

Prompt caching uses the following pricing multipliers relative to base input token rates:

| Cache operation      | Multiplier                                                                                                                                                     | Duration                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 5-minute cache write | 1.25x base input price                                                                                                                                         | Cache valid for 5 minutes            |
| 1-hour cache write   | 2x base input price                                                                                                                                            | Cache valid for 1 hour               |
| Cache read (hit)     | 0.1x base input price (0.025x on Claude Fable 5.2, Claude Mythos 5.2, Claude Fable 5.1, and Claude Mythos 5.1; 0.05x on Claude Opus 5.5 and Claude Sonnet 5.5) | Same duration as the preceding write |

Cache write tokens are charged when content is first stored. Cache read tokens are charged when a subsequent request retrieves the cached content. A cache hit costs 10 percent of the standard input price, which means caching pays off after one cache read for the 5-minute duration (1.25x write), or after two cache reads for the 1-hour duration (2x write). On Claude Fable 5.2, Claude Mythos 5.2, Claude Fable 5.1, and Claude Mythos 5.1, a cache hit costs 2.5 percent of the standard input price ($0.20 USD per million tokens on Claude Fable 5.2 and Claude Mythos 5.2, $0.25 USD on Claude Fable 5.1 and Claude Mythos 5.1). On Claude Opus 5.5 and Claude Sonnet 5.5, a cache hit costs 5 percent of the standard input price ($0.20 USD per million tokens on Claude Opus 5.5, $0.10 USD on Claude Sonnet 5.5).

These multipliers stack with other pricing modifiers, including the Batch API discount and data residency.

For implementation details, supported models, and code examples, see [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

### Data residency pricing

For Claude 4.6 and later models, specifying US-only inference through the `inference_geo` parameter incurs a 1.1x multiplier on all token pricing categories, including input tokens, output tokens, cache writes, and cache reads. On Claude Haiku 5.5, the multiplier also applies to the higher prices for prompts over 100,000 tokens (see [Long context pricing](https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing)). Global routing (the default) uses standard pricing.

This applies to the Claude API (first-party), Claude Platform on AWS, and Claude Models on Google Cloud (Anthropic managed). On Claude in Microsoft Foundry, the same 1.1x multiplier applies to deployments that use the US Data Zone Standard deployment type (see [Inference geography](https://platform.claude.com/docs/en/about-claude/pricing#foundry-inference-geography)). Partner-operated platforms, Claude Models on Google Cloud (Google managed) and Bedrock, have independent regional pricing. See [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) and [Google Cloud pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing#claude-models) for details. Earlier models do not support the `inference_geo` parameter and always use standard pricing; requests that include the parameter on these models return a 400 error.

For more information, see [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency).

### Fast mode pricing

[Fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode) provides significantly faster output for Claude Fable 5.2, Claude Opus 5.5, Claude Opus 5, and Claude Opus 4.8 at premium pricing. Fast mode for Claude Opus 5 and Claude Opus 4.8 is in research preview. Fast mode pricing applies across the full context window, including requests over 200k input tokens. Fast mode is available on the Claude API (first-party). For Claude Opus 5.5, it is also available on [Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#billing) and on [Claude in Microsoft Foundry](https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry) for deployments hosted on Azure.

Fast mode for Claude Fable 5.2 is also available on [Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#billing).

Fast mode for Claude Fable 5.2 is also available on [Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed). Google Cloud sets its prices there. See [Cloud platform pricing](https://platform.claude.com/docs/en/about-claude/pricing#cloud-platform-pricing).

Fast mode is also available for Claude Mythos 5.2 on the Claude API. [Availability of fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode#feature-availability) lists every platform where Claude Mythos 5.2 has fast mode.

| Model                           | Input          | Output         |
| ------------------------------- | -------------- | -------------- |
| Claude Fable 5.2                | $16 USD / MTok | $80 USD / MTok |
| Claude Mythos 5.2               | $16 USD / MTok | $80 USD / MTok |
| Claude Opus 5.5                 | $8 USD / MTok  | $40 USD / MTok |
| Claude Opus 5 / Claude Opus 4.8 | $10 USD / MTok | $50 USD / MTok |

Fast mode pricing stacks with other pricing modifiers:

* [Prompt caching multipliers](https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching) apply on top of fast mode pricing.
* [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency) multipliers apply on top of fast mode pricing.

Fast mode is not available with the [Batch API](https://platform.claude.com/docs/en/about-claude/pricing#batch-processing).

For more information, see [Fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode).

### Batch processing

The Batch API allows asynchronous processing of large volumes of requests with a 50 percent discount on both input and output tokens.

| Model                                                                                                                                                                  | Batch input  | Batch output  |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------- | :------------ |
| Claude Fable 5.2                                                                                                                                                       | $4 / MTok    | $20 / MTok    |
| Claude Mythos 5.2 ([limited availability](https://support.claude.com/en/articles/14604842))                                                                            | $4 / MTok    | $20 / MTok    |
| Claude Fable 5.1                                                                                                                                                       | $5 / MTok    | $25 / MTok    |
| Claude Mythos 5.1 ([limited availability](https://support.claude.com/en/articles/14604842))                                                                            | $5 / MTok    | $25 / MTok    |
| Claude Fable 5                                                                                                                                                         | $5 / MTok    | $25 / MTok    |
| Claude Mythos 5 ([limited availability](https://support.claude.com/en/articles/14604842))                                                                              | $5 / MTok    | $25 / MTok    |
| Claude Opus 5.5                                                                                                                                                        | $2 / MTok    | $10 / MTok    |
| Claude Opus 5                                                                                                                                                          | $2.50 / MTok | $12.50 / MTok |
| Claude Opus 4.8                                                                                                                                                        | $2.50 / MTok | $12.50 / MTok |
| Claude Opus 4.7                                                                                                                                                        | $2.50 / MTok | $12.50 / MTok |
| Claude Opus 4.6                                                                                                                                                        | $2.50 / MTok | $12.50 / MTok |
| Claude Opus 4.5                                                                                                                                                        | $2.50 / MTok | $12.50 / MTok |
| Claude Opus 4.1 ([retired, except on Claude Models on Google Cloud (Google managed) and Bedrock](https://platform.claude.com/docs/en/about-claude/model-deprecations)) | $7.50 / MTok | $37.50 / MTok |
| Claude Opus 4 ([retired, except on Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/about-claude/model-deprecations))               | $7.50 / MTok | $37.50 / MTok |
| Claude Sonnet 5.5                                                                                                                                                      | $1 / MTok    | $5 / MTok     |
| Claude Sonnet 5                                                                                                                                                        | $1 / MTok    | $5 / MTok     |
| Claude Sonnet 4.6                                                                                                                                                      | $1.50 / MTok | $7.50 / MTok  |
| Claude Sonnet 4.5                                                                                                                                                      | $1.50 / MTok | $7.50 / MTok  |
| Claude Sonnet 4 ([retired, except on Claude Models on Google Cloud (Google managed) and Bedrock](https://platform.claude.com/docs/en/about-claude/model-deprecations)) | $1.50 / MTok | $7.50 / MTok  |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens)                                                                                                                    | $0.05 / MTok | $0.25 / MTok  |
| Claude Haiku 5.5 (for prompts over 100,000 tokens)                                                                                                                     | $0.25 / MTok | $1.25 / MTok  |
| Claude Haiku 4.5                                                                                                                                                       | $0.50 / MTok | $2.50 / MTok  |

* **MTok:** Million tokens. $5 / MTok is $5 for every million tokens.
* **Limited access:** Available only to organizations verified through Anthropic’s verification programs, such as the [Cyber Verification Program](https://support.claude.com/en/articles/14604842). To request access, apply to the program that covers your use case.
* **Retired:** May still be available on other cloud platforms. See [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations) for more.

For more information about batch processing, see [Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing).

### Long context pricing

Claude 4.6 and later models (except Claude Haiku 5.5) and [Claude Mythos Preview](https://anthropic.com/glasswing) include the full [1M token context window](https://platform.claude.com/docs/en/build-with-claude/context-windows) at standard pricing. (A 900k-token request is billed at the same per-token rate as a 9k-token request.) Prompt caching and batch processing discounts apply at standard rates across the full context window.

Claude Haiku 5.5 is priced by prompt length: a request whose prompt is over 100,000 tokens pays higher prices. A request’s prompt length counts all of its input tokens, including cache reads and cache writes. Each request is priced on its own: a request over the threshold pays the higher prices even when part of its prompt is a cache hit, and earlier requests keep the prices they were billed at. The [model pricing](https://platform.claude.com/docs/en/about-claude/pricing#model-pricing) and [batch processing pricing](https://platform.claude.com/docs/en/about-claude/pricing#batch-processing) sections list both sets of prices.

### Tool use pricing

Tool use requests are priced based on:

1. The total number of input tokens sent to the model (including in the `tools` parameter).
2. The number of output tokens generated.
3. For server-side tools, additional usage-based pricing (for example, web search charges per search performed).

Client-side tools are priced the same as any other Claude API request, although server-side tools can incur additional charges based on their specific usage.

The additional tokens from tool use come from:

* The `tools` parameter in API requests (tool names, descriptions, and schemas)
* `tool_use` content blocks in API requests and responses
* `tool_result` content blocks in API requests

When you use `tools`, the API also automatically includes a special system prompt for the model that enables tool use. The following table lists the number of tool use tokens that each model requires (excluding the additional tokens listed earlier). The table assumes that you provide at least one tool. If you provide no `tools`, a tool choice of `none` uses 0 additional system prompt tokens.

| Model                                                                                                                                                                  | Tool use system prompt tokens: auto, none | Tool use system prompt tokens: any, tool |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------- | :--------------------------------------- |
| Claude Opus 5.5                                                                                                                                                        | 286 tokens                                |                                          |
| Claude Opus 5                                                                                                                                                          | 286 tokens                                | 406 tokens                               |
| Claude Opus 4.8                                                                                                                                                        | 290 tokens                                | 410 tokens                               |
| Claude Opus 4.7                                                                                                                                                        | 675 tokens                                | 804 tokens                               |
| Claude Opus 4.6                                                                                                                                                        | 497 tokens                                | 589 tokens                               |
| Claude Opus 4.5                                                                                                                                                        | 496 tokens                                | 588 tokens                               |
| Claude Opus 4.1 ([retired, except on Claude Models on Google Cloud (Google managed) and Bedrock](https://platform.claude.com/docs/en/about-claude/model-deprecations)) | 313 tokens                                | 315 tokens                               |
| Claude Opus 4 ([retired, except on Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/about-claude/model-deprecations))               | 313 tokens                                | 315 tokens                               |
| Claude Sonnet 5.5                                                                                                                                                      | 286 tokens                                |                                          |
| Claude Sonnet 5                                                                                                                                                        | 354 tokens                                | 474 tokens                               |
| Claude Sonnet 4.6                                                                                                                                                      | 497 tokens                                | 589 tokens                               |
| Claude Sonnet 4.5                                                                                                                                                      | 496 tokens                                | 588 tokens                               |
| Claude Sonnet 4 ([retired, except on Claude Models on Google Cloud (Google managed) and Bedrock](https://platform.claude.com/docs/en/about-claude/model-deprecations)) | 313 tokens                                | 315 tokens                               |
| Claude Haiku 5.5                                                                                                                                                       | 286 tokens                                | 406 tokens                               |
| Claude Haiku 4.5                                                                                                                                                       | 496 tokens                                | 588 tokens                               |

* **auto, none:** The count when tool\_choice is auto or none.
* **any, tool:** The count when tool\_choice is any or tool.
* **Retired:** May still be available on other cloud platforms. See [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations) for more.

These token counts are added to your normal input and output tokens to calculate the total cost of a request.

For current per-model prices, refer to the [model pricing](https://platform.claude.com/docs/en/about-claude/pricing#model-pricing) section.

For more information about tool use implementation and best practices, see [Tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview).

### Specific tool pricing

#### Bash tool

The bash tool definition adds the following input tokens to your request. This is in addition to the per-model [tool use system prompt](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview#pricing) that applies whenever any tool is present.

| Model                                                 | Additional input tokens |
| ----------------------------------------------------- | ----------------------- |
| Claude 4.7 and later models and Claude Mythos Preview | 325 tokens              |
| Claude 4.6 and earlier models                         | 244 tokens              |

Additional tokens are consumed by:

* Command outputs (stdout/stderr)
* Error messages
* Large file contents

See [tool use pricing](https://platform.claude.com/docs/en/about-claude/pricing#tool-use-pricing) for complete pricing details.

#### Code execution tool

**Code execution is free when used with web search or web fetch.** When `web_search_20260209` (or later) or `web_fetch_20260209` (or later) is included in your API request, there are no additional charges for code execution tool calls beyond the standard input and output token costs.

When used without these tools, code execution is billed by execution time, tracked separately from token usage:

* Execution time has a minimum of 5 minutes.
* Each organization receives **1,550 free hours** of usage per month.
* Additional usage beyond 1,550 hours is billed at **$0.05 USD per hour, per container**.
* If files are included in the request, execution time is billed even if the tool is not called, because files are preloaded onto the container.

Code execution usage is tracked in the response:

```json
{
  "usage": {
    "input_tokens": 105,
    "output_tokens": 239,
    "server_tool_use": {
      "code_execution_requests": 1
    }
  }
}
```

#### Text editor tool

The text editor tool uses the same pricing structure as other tools used with Claude. It follows the standard input and output token pricing based on the Claude model you’re using.

In addition to the base tokens, the following additional input tokens are needed for the text editor tool:

| Tool                                                                           | Additional input tokens |
| ------------------------------------------------------------------------------ | ----------------------- |
| `text_editor_20250728` (Claude 4.7 and later models and Claude Mythos Preview) | 974 tokens              |
| `text_editor_20250728` (Claude 4.6 and earlier models)                         | 745 tokens              |

See [tool use pricing](https://platform.claude.com/docs/en/about-claude/pricing#tool-use-pricing) for complete pricing details.

#### Web search tool

Web search usage is charged in addition to token usage:

```json
{
  "usage": {
    "input_tokens": 105,
    "output_tokens": 6039,
    "cache_read_input_tokens": 7123,
    "cache_creation_input_tokens": 7345,
    "server_tool_use": {
      "web_search_requests": 1
    }
  }
}
```

Web search is available on the Claude API for **$10 USD per 1,000 searches**, plus standard token costs for search-generated content. Web search results retrieved throughout a conversation are counted as input tokens, in search iterations run during a single turn and in subsequent conversation turns.

Each web search counts as one use, regardless of the number of results returned. A web search that fails with an error is not billed.

#### Web fetch tool

Web fetch usage has **no additional charges** beyond standard token costs:

```json
{
  "usage": {
    "input_tokens": 25039,
    "output_tokens": 931,
    "cache_read_input_tokens": 0,
    "cache_creation_input_tokens": 0,
    "server_tool_use": {
      "web_fetch_requests": 1
    }
  }
}
```

The web fetch tool is available on the Claude API at **no additional cost**. You only pay standard token costs for the fetched content that becomes part of your conversation context.

To protect against inadvertently fetching large content that would consume excessive tokens, use the `max_content_tokens` parameter to set appropriate limits based on your use case and budget considerations.

Example token usage for typical content:

* Average webpage (10 kB): \~2,500 tokens
* Large documentation page (100 kB): \~25,000 tokens
* Research paper PDF (500 kB): \~125,000 tokens

#### Computer use tool

Computer use follows the standard [tool use pricing](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview#pricing). When using the computer use tool:

**Toolset definition overhead:** Declaring `computer_toolset_20260801` with its default members adds about 4,500 input tokens to a request (about 4,590 on Claude Sonnet 5 and about 4,520 on the other supported models), which covers the member tool definitions and the tool use system prompt. Disabling `zoom` with `configs` removes about 410 of those tokens. The exact count for a request is reported in the response `usage`, and you can estimate it in advance with the [token counting endpoint](https://platform.claude.com/docs/en/build-with-claude/token-counting).

**Earlier tool versions:** The following figures apply to the `computer_20251124` and `computer_20250124` tool versions, not to `computer_toolset_20260801`:

* System prompt overhead: 466–499 tokens added to the system prompt
* Tool definition: about 735 input tokens per tool definition (measured with `computer_20250124`)

**Additional token consumption:**

* Screenshot and zoom images returned in tool results, billed as image input (see [Vision pricing](https://platform.claude.com/docs/en/build-with-claude/vision#evaluate-image-size))
* Tool execution results returned to Claude

<Note>
  If you’re also using bash or text editor tools alongside computer use, those tools have their own token costs as documented in their respective pages.
</Note>

#### Browser use tool

Browser use follows the standard [tool use pricing](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview#pricing). When using the browser use tool:

**Toolset definition overhead:** Declaring `browser_toolset_20260801` with its default members adds about 6,600 input tokens to a request (about 6,670 on Claude Sonnet 5 and about 6,610 on the other supported models), which covers the member tool definitions and the tool use system prompt. Enabling all four optional members adds about 880 tokens, and disabling members with `configs` reduces the count. The exact count for a request is reported in the response `usage`, and you can estimate it in advance with the [token counting endpoint](https://platform.claude.com/docs/en/build-with-claude/token-counting).

**Additional token consumption:**

* Screenshot and zoom images returned in tool results, billed as image input (see [Vision pricing](https://platform.claude.com/docs/en/build-with-claude/vision#evaluate-image-size))
* Text tool results returned to Claude, such as accessibility trees, page text, and console or network entries

<Note>
  If you also use the computer use tool, bash tool, text editor tool, or your own tools alongside browser use, those tools have their own token costs as documented on their respective pages.
</Note>

## Claude Managed Agents pricing

[Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) is billed on two dimensions: tokens and session runtime.

### Tokens

All tokens consumed by a Claude Managed Agents session are billed at the rates shown in [Model pricing](https://platform.claude.com/docs/en/about-claude/pricing#model-pricing). [Prompt caching multipliers](https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching) apply identically. Web search triggered inside a session incurs the standard $10 USD per 1,000 searches. On Claude Platform on AWS, session token and runtime charges convert to Claude Consumption Units at the standard rate (see [Claude Platform on AWS pricing](https://platform.claude.com/docs/en/about-claude/pricing#claude-platform-on-aws-pricing)). [Fast mode premium pricing](https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing) applies when an agent’s `model.speed` is set to `"fast"`.

The [data residency multiplier](https://platform.claude.com/docs/en/about-claude/pricing#data-residency-pricing) also applies: when an agent’s `model.inference_geo` is pinned to `"us"`, tokens consumed by sessions running that agent are billed at 1.1x the standard rates, the same multiplier that applies to US-only inference on the Messages API.

The following Messages API modifiers do **not** apply to Claude Managed Agents sessions:

| Modifier                                                                                                  | Why it doesn’t apply                                           |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [Batch API discount](https://platform.claude.com/docs/en/about-claude/pricing#batch-processing)           | Sessions are stateful and interactive. There is no batch mode. |
| [Cloud platform pricing](https://platform.claude.com/docs/en/about-claude/pricing#cloud-platform-pricing) | Not available on partner-operated cloud platforms.             |

### Session runtime

| SKU             | Rate                       | Metering                  |
| --------------- | -------------------------- | ------------------------- |
| Session runtime | $0.08 USD per session-hour | `running` status duration |

Runtime is measured to the millisecond and accrues only while the session’s status is `running`. Time spent `idle` (waiting for your next message or a tool confirmation), `rescheduling`, or `terminated` does not count toward runtime.

<Note>
  Session runtime replaces the [code execution](https://platform.claude.com/docs/en/about-claude/pricing#code-execution-tool) container-hour billing model when using Claude Managed Agents. You are not separately billed for container hours on top of session runtime.
</Note>

### Worked example

A 1-hour coding session using Claude Opus 5.5 that consumes 50,000 input tokens and 15,000 output tokens:

| Line item       | Calculation              | Cost          |
| --------------- | ------------------------ | ------------- |
| Input tokens    | 50,000 × $4 / 1,000,000  | $0.20 USD     |
| Output tokens   | 15,000 × $20 / 1,000,000 | $0.30 USD     |
| Session runtime | 1.0 hour × $0.08         | $0.08 USD     |
| **Total**       |                          | **$0.58 USD** |

If prompt caching is active and 40,000 of the input tokens are cache reads:

| Line item             | Calculation                    | Cost           |
| --------------------- | ------------------------------ | -------------- |
| Uncached input tokens | 10,000 × $4 / 1,000,000        | $0.04 USD      |
| Cache read tokens     | 40,000 × $4 × 0.05 / 1,000,000 | $0.008 USD     |
| Output tokens         | 15,000 × $20 / 1,000,000       | $0.30 USD      |
| Session runtime       | 1.0 hour × $0.08               | $0.08 USD      |
| **Total**             |                                | **$0.428 USD** |

## Additional pricing considerations

### Cost optimization strategies

When building agents with Claude:

1. **Use appropriate models:** Choose Haiku for simple tasks, Sonnet for most production workloads, and Opus for the most complex reasoning.
2. **Implement prompt caching:** Reduce costs for repeated context.
3. **Batch operations:** Use the Batch API for non-time-sensitive tasks.
4. **Monitor usage patterns:** Track token consumption to identify optimization opportunities.

<Tip>
  For high-volume agent applications, contact the [enterprise sales team](https://claude.com/contact-sales) for custom pricing arrangements.
</Tip>

### Rate limits

Rate limits vary by usage tier and affect how many requests you can make:

* **Start tier:** Entry-level limits for getting started
* **Build tier:** Increased limits for growing applications
* **Scale tier:** Highest standard limits for production workloads

For detailed rate limit information, see [Rate limits](https://platform.claude.com/docs/en/api/rate-limits).

For limits beyond the Scale tier or custom pricing arrangements, [contact the sales team](https://claude.com/contact-sales).

### Volume discounts

Volume discounts might be available for high-volume users. These are negotiated on a case-by-case basis.

* Standard usage tiers use the pricing shown in [Model pricing](https://platform.claude.com/docs/en/about-claude/pricing#model-pricing).
* Enterprise customers can [contact sales](mailto:sales@anthropic.com) for custom pricing.
* Academic and research discounts might be available.

### Enterprise pricing

For enterprise customers with specific needs:

* Custom rate limits
* Volume discounts
* Dedicated support
* Custom terms

Contact the sales team at [sales@anthropic.com](mailto:sales@anthropic.com) or through the [Claude Console](https://platform.claude.com/usage/limits) to discuss enterprise pricing options.

## Billing and payment

* Billing is based on actual monthly usage.
* All payments are in USD.
* Credit card and invoicing options are available.
* Usage tracking is available in the Claude Console at [platform.claude.com](https://platform.claude.com/).

## Frequently asked questions

### How is token usage calculated?

Tokens are pieces of text that models process. How many tokens the same text produces depends on the model’s tokenizer, the language, and the type of content. Claude 4.7 and later models and Claude Mythos Preview (`claude-mythos-preview`) use a newer tokenizer that produces approximately 30 percent more tokens for the same text than earlier models. To see how many tokens a request uses on a specific model, count it with [Token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting) and that model’s ID.

### Are there free tiers or trials?

New users receive a small amount of free credits to test the API. [Contact sales](mailto:sales@anthropic.com) for information about extended trials for enterprise evaluation.

### How do discounts stack?

Batch API and prompt caching discounts can be combined. For example, using both features together provides significant cost savings compared to standard API calls. See [prompt caching pricing](https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching) for how the multipliers interact.

### What payment methods are accepted?

Major credit cards are accepted for standard accounts. To buy credits or manage your payment methods, go to the [Billing](https://platform.claude.com/settings/billing) page (`platform.claude.com/settings/billing`) in the Claude Console. Enterprise customers can arrange invoicing and other payment methods.

For additional questions about pricing, contact [support@anthropic.com](mailto:support@anthropic.com).
