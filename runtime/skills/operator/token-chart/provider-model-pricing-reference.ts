/**
 * SCRIPT_JDOC:
 * {
 *   "summary": "Provider and model pricing reference data for token cost estimation.",
 *   "role": "module"
 * }
 */
import claude52Pricing from "./pricing-2026-11-09.json";
import terraPricing from "./pricing-2026-11-04.json";
import latestPricing from "./pricing-2026-10-06.json";
import september29Pricing from "./pricing-2026-09-29.json";
import refreshedPricing from "./pricing-2026-09-22.json";
import previousPricing from "./pricing-2026-09-05.json";

export interface ProviderModelPricingReference {
  canonicalModel: string;
  basis: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
  notes?: string;
}

interface ProviderModelPricingRule extends ProviderModelPricingReference {
  id: string;
  models: string[];
  /** Optional provider IDs for route-specific pricing when model IDs overlap. */
  providers?: string[];
}

// Tag this reference snapshot with the commit date that introduced it so future
// updates can track pricing provenance without guessing.
export const PROVIDER_MODEL_PRICING_REFERENCE_TAG = "2026-11-09";

const ANTHROPIC_PRICING_SOURCE = "https://docs.anthropic.com/en/docs/about-claude/pricing";
const OPENAI_PRICING_SOURCE = "https://developers.openai.com/api/docs/pricing";
const KIMI_K3_PRICING_SOURCE = "https://platform.kimi.ai/docs/pricing/chat-k3";
const OPENROUTER_MODELS_SOURCE = "https://openrouter.ai/api/v1/models";

const PRICING_RULES: ProviderModelPricingRule[] = [
  {
    id: "claude-opus-5-openrouter",
    models: ["anthropic/claude-opus-5"],
    providers: ["openrouter"],
    canonicalModel: "Claude Opus 5 (OpenRouter)",
    basis: `Live OpenRouter API pricing (${OPENROUTER_MODELS_SOURCE}), verified 2026-08-03`,
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    notes: "OpenRouter route mirrors Anthropic standard Opus 5 pricing; 1h cache-write route field is $10/MTok, but the local single cache-write field stores the 5-minute rate.",
  },
  {
    id: "claude-opus-5-fast-openrouter",
    models: ["anthropic/claude-opus-5-fast"],
    providers: ["openrouter"],
    canonicalModel: "Claude Opus 5 Fast (OpenRouter)",
    basis: `Live OpenRouter API pricing (${OPENROUTER_MODELS_SOURCE}), verified 2026-08-03`,
    inputPerMTok: 10,
    outputPerMTok: 50,
    cacheReadPerMTok: 1,
    cacheWritePerMTok: 12.5,
    notes: "OpenRouter route mirrors Anthropic Fast mode pricing; 1h cache-write route field is $20/MTok, but the local single cache-write field stores the 5-minute rate.",
  },
  {
    id: "claude-opus-5",
    models: ["claude-opus-5"],
    canonicalModel: "Claude Opus 5",
    basis: `Anthropic standard API pricing (${ANTHROPIC_PRICING_SOURCE}), verified 2026-08-03`,
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    notes: "Same standard rates as Opus 4.8; 5m cache writes $6.25, 1h cache writes $10. Model ID: claude-opus-5.",
  },
  {
    id: "claude-opus-5-fast",
    models: ["claude-opus-5-fast"],
    canonicalModel: "Claude Opus 5 Fast",
    basis: `Anthropic Fast mode pricing (${ANTHROPIC_PRICING_SOURCE}), verified 2026-08-03`,
    inputPerMTok: 10,
    outputPerMTok: 50,
    cacheReadPerMTok: 1,
    cacheWritePerMTok: 12.5,
    notes: "Fast mode is a research preview at 2x Opus 5 base pricing; prompt caching multipliers stack, so 5m cache writes are $12.50/MTok and 1h writes are $20/MTok.",
  },
  {
    id: "claude-opus-4.5",
    models: ["claude-opus-4.5"],
    canonicalModel: "Claude Opus 4.5",
    basis: `Anthropic standard API pricing (${ANTHROPIC_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    notes: "Anthropic's current standard Opus rate.",
  },
  {
    id: "claude-opus-4.6",
    models: ["claude-opus-4.6"],
    canonicalModel: "Claude Opus 4.6",
    basis: `Anthropic standard API pricing (${ANTHROPIC_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
  },
  {
    id: "claude-opus-4.6-1m",
    models: ["claude-opus-4.6-1m"],
    canonicalModel: "Claude Opus 4.6 (1M)",
    basis: `Anthropic standard API pricing (${ANTHROPIC_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    notes: "Uses standard Opus pricing; long-context premium/meters for 1M context are not modeled.",
  },
  {
    id: "claude-opus-4.7",
    models: ["claude-opus-4.7"],
    canonicalModel: "Claude Opus 4.7",
    basis: `Anthropic standard API pricing (${ANTHROPIC_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    notes: "Anthropic's current standard Opus rate.",
  },
  {
    id: "claude-opus-4.8",
    models: ["claude-opus-4.8"],
    canonicalModel: "Claude Opus 4.8",
    basis: `Anthropic standard API pricing (${ANTHROPIC_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    notes: "Same standard rates as Opus 4.7; 5m cache writes $6.25, 1h cache writes $10; Fast mode (research preview) at $10/$50.",
  },
  {
    id: "claude-sonnet-4.6",
    models: ["claude-sonnet-4.6"],
    canonicalModel: "Claude Sonnet 4.6",
    basis: `Anthropic standard API pricing (${ANTHROPIC_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
  },
  {
    id: "gpt-5.4",
    models: ["gpt-5.4"],
    canonicalModel: "GPT-5.4",
    basis: `OpenAI standard API pricing (${OPENAI_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 2.5,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.25,
    cacheWritePerMTok: 2.5,
    notes: "Standard <=272K-input tier. OpenAI publishes no separate cache-write rate; ordinary input is an explicit fallback only when telemetry separates cache writes from input.",
  },
  {
    id: "gpt-5.4-mini",
    models: ["gpt-5.4-mini"],
    canonicalModel: "GPT-5.4 Mini",
    basis: `OpenAI standard API pricing (${OPENAI_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 0.75,
    outputPerMTok: 4.5,
    cacheReadPerMTok: 0.075,
    cacheWritePerMTok: 0.75,
    notes: "OpenAI publishes no separate cache-write rate; ordinary input is an explicit estimator fallback.",
  },
  {
    id: "gpt-5.5",
    models: ["gpt-5.5"],
    canonicalModel: "GPT-5.5",
    basis: `OpenAI standard API pricing (${OPENAI_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 5,
    outputPerMTok: 30,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 5,
    notes: "Standard <=272K-input tier. OpenAI displays '-' for cache writes; $5/MTok is an explicit fallback when telemetry reports cache-write tokens separately, not a published cache-write rate.",
  },
  {
    id: "gpt-5.6-sol",
    models: ["gpt-5.6-sol", "gpt-5.6"],
    canonicalModel: "GPT-5.6 Sol",
    basis: `OpenAI standard API pricing (${OPENAI_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 5,
    outputPerMTok: 30,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    notes: "Standard <=272K-input tier; the higher long-context tier is not modeled.",
  },
  {
    id: "gpt-5.6-terra",
    models: ["gpt-5.6-terra"],
    canonicalModel: "GPT-5.6 Terra",
    basis: `OpenAI standard API pricing (${OPENAI_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 2.5,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.25,
    cacheWritePerMTok: 3.125,
    notes: "Standard <=272K-input tier; the higher long-context tier is not modeled.",
  },
  {
    id: "gpt-5.6-luna",
    models: ["gpt-5.6-luna"],
    canonicalModel: "GPT-5.6 Luna",
    basis: `OpenAI standard API pricing (${OPENAI_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 1,
    outputPerMTok: 6,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 1.25,
    notes: "Standard <=272K-input tier; the higher long-context tier is not modeled.",
  },
  {
    id: "gpt-5.4-pro",
    models: ["gpt-5.4-pro"],
    canonicalModel: "GPT-5.4 Pro",
    basis: `OpenAI standard API pricing (${OPENAI_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 30,
    outputPerMTok: 180,
    cacheReadPerMTok: 0,
    cacheWritePerMTok: 30,
    notes: "No cached-input or cache-write rate is published; ordinary input is an explicit cache-write fallback.",
  },
  {
    id: "gpt-5-mini",
    models: ["gpt-5-mini"],
    canonicalModel: "GPT-5 Mini",
    basis: `OpenAI API pricing (${OPENAI_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 0.25,
    outputPerMTok: 2,
    cacheReadPerMTok: 0.025,
    cacheWritePerMTok: 0.25,
    notes: "Legacy GPT-5 Mini row; do not use as a proxy for GPT-5.4 Mini or Codex-mini models.",
  },
  {
    id: "gpt-5.1-codex",
    models: ["gpt-5.1-codex"],
    canonicalModel: "GPT-5.1 Codex",
    basis: `OpenAI API pricing (${OPENAI_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 1.25,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.125,
    cacheWritePerMTok: 1.25,
    notes: "Cache write uses ordinary input as an explicit estimator fallback.",
  },
  {
    id: "gpt-5.1-codex-mini",
    models: ["gpt-5.1-codex-mini"],
    canonicalModel: "GPT-5.1 Codex Mini",
    basis: `OpenAI API pricing (${OPENAI_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 0.25,
    outputPerMTok: 2,
    cacheReadPerMTok: 0.025,
    cacheWritePerMTok: 0.25,
    notes: "Cache write uses ordinary input as an explicit estimator fallback.",
  },
  {
    id: "gpt-5.2-codex",
    models: ["gpt-5.2-codex"],
    canonicalModel: "GPT-5.2 Codex",
    basis: `OpenAI API pricing (${OPENAI_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 1.75,
    outputPerMTok: 14,
    cacheReadPerMTok: 0.175,
    cacheWritePerMTok: 1.75,
    notes: "Cache write uses ordinary input as an explicit estimator fallback.",
  },
  {
    id: "gpt-5.3-codex",
    models: ["gpt-5.3-codex"],
    canonicalModel: "GPT-5.3 Codex",
    basis: `OpenAI API pricing (${OPENAI_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 1.75,
    outputPerMTok: 14,
    cacheReadPerMTok: 0.175,
    cacheWritePerMTok: 1.75,
    notes: "Cache write uses ordinary input as an explicit estimator fallback.",
  },
  {
    id: "gpt-4o",
    models: ["gpt-4o"],
    canonicalModel: "GPT-4o",
    basis: `OpenAI API pricing (${OPENAI_PRICING_SOURCE}), accessed 2026-07-14`,
    inputPerMTok: 2.5,
    outputPerMTok: 10,
    cacheReadPerMTok: 1.25,
    cacheWritePerMTok: 2.5,
    notes: "Cache write uses ordinary input as an explicit estimator fallback.",
  },
  {
    id: "mistral-large-3-azure",
    models: ["mistral-large-3"],
    providers: ["azure-foundry"],
    canonicalModel: "Mistral Large 3 (Azure Foundry)",
    basis: "Azure Foundry Mistral pricing (https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/mistral-ai/), accessed 2026-07-14",
    inputPerMTok: 0.5,
    outputPerMTok: 1.5,
    cacheReadPerMTok: 0,
    cacheWritePerMTok: 0.5,
    notes: "Azure PAYG row; cache write uses ordinary input as an explicit estimator fallback.",
  },
  {
    id: "gpt-oss-120b-cerebras",
    models: ["gpt-oss-120b"],
    providers: ["cerebras"],
    canonicalModel: "GPT-OSS 120B (Cerebras)",
    basis: "Cerebras official model pricing (https://inference-docs.cerebras.ai/models/openai-oss), accessed 2026-07-14",
    inputPerMTok: 0.35,
    outputPerMTok: 0.75,
    cacheReadPerMTok: 0,
    cacheWritePerMTok: 0.35,
    notes: "Cache write uses ordinary input as an explicit estimator fallback.",
  },
  {
    id: "minimax-m2.7",
    models: ["minimax-m2.7", "minimax-m2p7"],
    canonicalModel: "MiniMax M2.7",
    basis: "MiniMax official PAYG pricing (https://platform.minimax.io/docs/guides/pricing-paygo), accessed 2026-07-14",
    inputPerMTok: 0.3,
    outputPerMTok: 1.2,
    cacheReadPerMTok: 0.06,
    cacheWritePerMTok: 0.375,
    notes: "Native MiniMax/Fireworks standard row; high-speed pricing is separate.",
  },
  {
    id: "minimax-m2.7-openrouter",
    models: ["minimax/minimax-m2.7"],
    providers: ["openrouter"],
    canonicalModel: "MiniMax M2.7 (OpenRouter)",
    basis: "Live OpenRouter API pricing, accessed 2026-07-14",
    inputPerMTok: 0.24,
    outputPerMTok: 0.96,
    cacheReadPerMTok: 0,
    cacheWritePerMTok: 0.24,
    notes: "OpenRouter does not publish a cached-input rate for this route; cache write uses ordinary routed input as an explicit fallback.",
  },
  {
    id: "minimax-m2.7-highspeed",
    models: ["minimax-m2.7-highspeed", "minimax/minimax-m2.7-highspeed"],
    canonicalModel: "MiniMax M2.7 Highspeed",
    basis: "MiniMax official PAYG pricing (https://platform.minimax.io/docs/guides/pricing-paygo), accessed 2026-07-14",
    inputPerMTok: 0.6,
    outputPerMTok: 2.4,
    cacheReadPerMTok: 0.06,
    cacheWritePerMTok: 0.375,
    notes: "High-speed MiniMax M2.7 row; prompt-cache read/write rates match the standard M2.7 row in the official pricing table.",
  },
  {
    id: "minimax-m2.5",
    models: ["minimax-m2.5", "minimax-m2p5"],
    canonicalModel: "MiniMax M2.5",
    basis: "MiniMax official PAYG pricing (https://platform.minimax.io/docs/guides/pricing-paygo), accessed 2026-07-14",
    inputPerMTok: 0.3,
    outputPerMTok: 1.2,
    cacheReadPerMTok: 0.03,
    cacheWritePerMTok: 0.375,
    notes: "Official MiniMax M2.5 row; OpenRouter also lists a cheaper routed M2.5 row separately.",
  },
  {
    id: "minimax-m2.5-openrouter",
    models: ["minimax/minimax-m2.5"],
    providers: ["openrouter"],
    canonicalModel: "MiniMax M2.5 (OpenRouter)",
    basis: "Live OpenRouter API pricing, accessed 2026-07-14",
    inputPerMTok: 0.15,
    outputPerMTok: 0.9,
    cacheReadPerMTok: 0.05,
    cacheWritePerMTok: 0.15,
    notes: "Cache write uses ordinary routed input as an explicit fallback.",
  },
  {
    id: "minimax-m2-openrouter",
    models: ["minimax/minimax-m2"],
    providers: ["openrouter"],
    canonicalModel: "MiniMax M2 (OpenRouter)",
    basis: "Live OpenRouter API pricing, accessed 2026-07-14",
    inputPerMTok: 0.255,
    outputPerMTok: 1.02,
    cacheReadPerMTok: 0,
    cacheWritePerMTok: 0.255,
    notes: "No cached-input rate is published; cache write uses ordinary routed input as an explicit fallback.",
  },
  {
    id: "minimax-m2.1-openrouter",
    models: ["minimax/minimax-m2.1"],
    providers: ["openrouter"],
    canonicalModel: "MiniMax M2.1 (OpenRouter)",
    basis: "Live OpenRouter API pricing, accessed 2026-07-14",
    inputPerMTok: 0.3,
    outputPerMTok: 1.2,
    cacheReadPerMTok: 0.03,
    cacheWritePerMTok: 0.3,
    notes: "Cache write uses ordinary routed input as an explicit fallback.",
  },
  {
    id: "kimi-k3-openrouter",
    models: ["moonshotai/kimi-k3"],
    providers: ["openrouter"],
    canonicalModel: "Kimi K3 (OpenRouter)",
    basis: `Live OpenRouter API pricing (${OPENROUTER_MODELS_SOURCE}), verified 2026-08-03`,
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3,
    notes: "OpenRouter route publishes prompt/output/cache-read rates, but no separate cache-write rate; cache writes use ordinary routed input as an explicit fallback.",
  },
  {
    id: "kimi-k3",
    models: ["kimi-k3"],
    canonicalModel: "Kimi K3",
    basis: `Moonshot/Kimi first-party pricing (${KIMI_K3_PRICING_SOURCE}), verified 2026-08-03`,
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3,
    notes: "Moonshot publishes cache-miss input ($3/MTok), cache-hit input ($0.30/MTok), and output ($15/MTok), but no separate cache-write tariff; cache writes use ordinary cache-miss input as an explicit fallback.",
  },
  {
    id: "kimi-k2.6-fireworks-router",
    models: ["kimi-k2p6-turbo", "kimi-k2p6-fast"],
    providers: ["fireworks-ai"],
    canonicalModel: "Kimi K2.6 (Fireworks fast/turbo router)",
    basis: "Fireworks PAYG model pricing, accessed 2026-07-14",
    inputPerMTok: 2,
    outputPerMTok: 8,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 2,
    notes: "Fire Pass may cover these routes with no per-token charge, but subscription coverage is account-specific and is not assumed by this PAYG reference. Cache write uses ordinary input as an explicit fallback.",
  },
  {
    id: "kimi-k2.6-openrouter",
    models: ["moonshotai/kimi-k2.6"],
    providers: ["openrouter"],
    canonicalModel: "Kimi K2.6 (OpenRouter)",
    basis: "Live OpenRouter API pricing, accessed 2026-07-14",
    inputPerMTok: 0.66,
    outputPerMTok: 3.41,
    cacheReadPerMTok: 0.15,
    cacheWritePerMTok: 0.66,
    notes: "Cache write uses ordinary routed input as an explicit fallback.",
  },
  {
    id: "kimi-k2.6",
    models: ["kimi-k2.6", "kimi-k2p6"],
    canonicalModel: "Kimi K2.6",
    basis: "Moonshot/Fireworks standard PAYG pricing, accessed 2026-07-14",
    inputPerMTok: 0.95,
    outputPerMTok: 4,
    cacheReadPerMTok: 0.16,
    cacheWritePerMTok: 0.95,
    notes: "Native/Fireworks PAYG row; published fields are input/cached-input/output, so cache writes are treated as normal input.",
  },
  {
    id: "kimi-k2.5",
    models: ["kimi-k2.5", "kimi-k2p5"],
    canonicalModel: "Kimi K2.5 (legacy/deprecated)",
    basis: "Fireworks model page + provider registry rows, accessed 2026-05-25",
    inputPerMTok: 0.6,
    outputPerMTok: 3,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 0.6,
    notes: "Legacy K2.5 row retained for historical charts; prefer Kimi K2.6, Kimi K2.6 Turbo under Fire Pass, or MiniMax M2.7 for new routing.",
  },
  {
    id: "minimax-m1-openrouter",
    models: ["minimax/minimax-m1"],
    providers: ["openrouter"],
    canonicalModel: "MiniMax M1 (OpenRouter)",
    basis: "Live OpenRouter API pricing, accessed 2026-07-14",
    inputPerMTok: 0.4,
    outputPerMTok: 2.2,
    cacheReadPerMTok: 0,
    cacheWritePerMTok: 0.4,
    notes: "Older 1M-context MiniMax row retained for historical/router usage; M2.7 is the preferred MiniMax row for new coding comparisons.",
  },
  {
    id: "glm-5.2",
    models: ["glm-5.2", "glm-5p2"],
    canonicalModel: "GLM 5.2",
    basis: "Z.AI official pricing (https://docs.z.ai/guides/overview/pricing), accessed 2026-07-14",
    inputPerMTok: 1.4,
    outputPerMTok: 4.4,
    cacheReadPerMTok: 0.26,
    cacheWritePerMTok: 1.4,
    notes: "Z.AI native PAYG pricing; cached input storage is limited-time free; cache write modeled at standard input rate.",
  },
  {
    id: "glm-5.2-openrouter",
    models: ["z-ai/glm-5.2"],
    providers: ["openrouter"],
    canonicalModel: "GLM 5.2 (OpenRouter)",
    basis: "Live OpenRouter API pricing, accessed 2026-07-14",
    inputPerMTok: 0.9282,
    outputPerMTok: 2.9172,
    cacheReadPerMTok: 0.17238,
    cacheWritePerMTok: 0.9282,
    notes: "Live routed rate; cache write uses ordinary routed input as an explicit fallback because OpenRouter publishes no separate cache-write rate.",
  },
  {
    id: "deepseek-v4-flash-azure",
    models: ["deepseek-v4-flash"],
    providers: ["azure-foundry"],
    canonicalModel: "DeepSeek V4 Flash (Azure Foundry)",
    basis: "Azure Foundry pricing (https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/deepseek/), accessed 2026-07-14",
    inputPerMTok: 0.19,
    outputPerMTok: 0.51,
    cacheReadPerMTok: 0.19,
    cacheWritePerMTok: 0.19,
    notes: "Azure publishes only Global PAYG input/output rates for this model. Cache-read and cache-write telemetry is conservatively modeled at ordinary input price; these are estimator fallbacks, not published Azure cache tariffs.",
  },
  {
    id: "deepseek-v4-flash-native",
    models: ["deepseek-v4-flash"],
    providers: ["deepseek"],
    canonicalModel: "DeepSeek V4 Flash (native)",
    basis: "DeepSeek official pricing (https://api-docs.deepseek.com/quick_start/pricing), accessed 2026-07-14",
    inputPerMTok: 0.14,
    outputPerMTok: 0.28,
    cacheReadPerMTok: 0.0028,
    cacheWritePerMTok: 0.14,
    notes: "Cache-miss input rate; cache write uses ordinary input as an explicit fallback.",
  },
  {
    id: "deepseek-v4-flash-openrouter",
    models: ["deepseek/deepseek-v4-flash"],
    providers: ["openrouter"],
    canonicalModel: "DeepSeek V4 Flash (OpenRouter)",
    basis: "Live OpenRouter API pricing, accessed 2026-07-14",
    inputPerMTok: 0.09,
    outputPerMTok: 0.18,
    cacheReadPerMTok: 0.018,
    cacheWritePerMTok: 0.09,
    notes: "Cache write uses ordinary routed input as an explicit fallback.",
  },
  {
    id: "gemma4-e4b-local",
    models: ["gemma4-e4b-qat-mtp"],
    providers: ["milkv-local"],
    canonicalModel: "Gemma 4 E4B QAT MTP (local)",
    basis: "Local inference: no metered API token charge",
    inputPerMTok: 0,
    outputPerMTok: 0,
    cacheReadPerMTok: 0,
    cacheWritePerMTok: 0,
    notes: "Marginal API cost only; electricity, hardware depreciation, and operations are excluded.",
  },
];

function normalizeModel(model: string): string {
  const trimmed = model.trim().toLowerCase().replace(/_/g, "-");
  const aliasMap: Record<string, string> = {
    "mistral-large-4-0": "mistral-large-4",
    "gpt-5-4": "gpt-5.4",
    "gpt-5-4-mini": "gpt-5.4-mini",
    "gpt-5-4-pro": "gpt-5.4-pro",
    "gpt-5-5": "gpt-5.5",
    "gpt-5-6": "gpt-5.6",
    "gpt-6-1-sol": "gpt-6.1-sol",
    "gpt-6-1-terra": "gpt-6.1-terra",
    "gpt-5-6-sol": "gpt-5.6-sol",
    "gpt-5-6-sol-fast": "gpt-5.6-sol-fast",
    "claude-opus-5-5": "claude-opus-5.5",
    "claude-opus-5-5-fast": "claude-opus-5.5-fast",
    "claude-fable-5-1": "claude-fable-5.1",
    "claude-mythos-5-1": "claude-mythos-5.1",
    "claude-fable-5-2": "claude-fable-5.2",
    "claude-fable-5-2-fast": "claude-fable-5.2-fast",
    "claude-mythos-5-2": "claude-mythos-5.2",
    "claude-mythos-5-2-fast": "claude-mythos-5.2-fast",
    "claude-opus-4-8": "claude-opus-4.8",
    "claude-opus-4-7": "claude-opus-4.7",
    "claude-opus-4-6": "claude-opus-4.6",
    "claude-sonnet-4-6": "claude-sonnet-4.6",
    "claude-haiku-4-5": "claude-haiku-4.5",
    "claude-haiku-4-5-20251001": "claude-haiku-4.5",
    "gpt-5-6-terra": "gpt-5.6-terra",
    "gpt-5-6-luna": "gpt-5.6-luna",
    "gpt-5-3-codex": "gpt-5.3-codex",
    "gpt-5-3-codex-spark": "gpt-5.3-codex-spark",
    "gpt-5-2-codex": "gpt-5.2-codex",
    "gpt-5-1-codex": "gpt-5.1-codex",
    "gpt-5-1-codex-mini": "gpt-5.1-codex-mini",
    "accounts/fireworks/routers/kimi-k2p6-turbo": "kimi-k2p6-turbo",
    "fireworks/kimi-k2p6-turbo": "kimi-k2p6-turbo",
    "accounts/fireworks/routers/kimi-k2p6-fast": "kimi-k2p6-fast",
    "fireworks/kimi-k2p6-fast": "kimi-k2p6-fast",
    "accounts/fireworks/models/kimi-k2p6": "kimi-k2.6",
    "fireworks/kimi-k2p6": "kimi-k2.6",
    "moonshotai/kimi-k3": "moonshotai/kimi-k3",
    "moonshot/kimi-k3": "kimi-k3",
    "moonshotai/kimi-k2.5": "kimi-k2.5",
    "accounts/fireworks/models/kimi-k2p5": "kimi-k2.5",
    "fireworks/kimi-k2p5": "kimi-k2.5",
    "minimax-m2p7": "minimax-m2.7",
    "minimax/m2.7": "minimax-m2.7",
    "accounts/fireworks/models/minimax-m2p7": "minimax-m2.7",
    "fireworks/minimax-m2p7": "minimax-m2.7",
    "minimax-m2p5": "minimax-m2.5",
    "accounts/fireworks/models/minimax-m2p5": "minimax-m2.5",
    "fireworks/minimax-m2p5": "minimax-m2.5",
    "glm-5p2": "glm-5.2",
    "zhipu/glm-5.2": "glm-5.2",
    "z-ai/glm-5.2": "z-ai/glm-5.2",
  };
  return aliasMap[trimmed] || trimmed;
}

const UNPRICED_FALLBACK: ProviderModelPricingReference = {
  canonicalModel: "(unpriced)",
  basis: `Unpriced fallback (${PROVIDER_MODEL_PRICING_REFERENCE_TAG})`,
  inputPerMTok: 0,
  outputPerMTok: 0,
  cacheReadPerMTok: 0,
  cacheWritePerMTok: 0,
};

export function resolveProviderModelPricing(provider: string, model: string): ProviderModelPricingReference {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedModel = normalizeModel(model);
  const rule = PRICING_RULES.find(
    (candidate) =>
      candidate.models.includes(normalizedModel) &&
      (!candidate.providers || candidate.providers.includes(normalizedProvider)),
  );
  const claude52 = claude52Pricing.find((entry) =>
    entry.provider === normalizedProvider && normalizeModel(entry.model) === normalizedModel,
  );
  if (claude52) {
    const { provider: _provider, model: _model, ...reference } = claude52;
    return reference;
  }
  const terra = terraPricing.find((entry) =>
    entry.provider === normalizedProvider && normalizeModel(entry.model) === normalizedModel,
  );
  if (terra) {
    const { provider: _provider, model: _model, ...reference } = terra;
    return reference;
  }
  const latest = latestPricing.find((entry) =>
    entry.provider === normalizedProvider && normalizeModel(entry.model) === normalizedModel,
  );
  if (latest) {
    const { provider: _provider, model: _model, ...reference } = latest;
    return { ...reference, canonicalModel: rule?.canonicalModel ?? reference.canonicalModel };
  }
  const september29 = september29Pricing.find((entry) =>
    entry.provider === normalizedProvider && normalizeModel(entry.model) === normalizedModel,
  );
  if (september29) {
    const { provider: _provider, model: _model, ...reference } = september29;
    return { ...reference, canonicalModel: rule?.canonicalModel ?? reference.canonicalModel };
  }
  const refreshed = refreshedPricing.find((entry) =>
    entry.provider === normalizedProvider && normalizeModel(entry.model) === normalizedModel,
  );
  if (refreshed) {
    const { provider: _provider, model: _model, ...reference } = refreshed;
    return { ...reference, canonicalModel: rule?.canonicalModel ?? reference.canonicalModel };
  }
  const previous = previousPricing.find((entry) =>
    entry.provider === normalizedProvider && normalizeModel(entry.model) === normalizedModel,
  );
  if (previous) {
    const { provider: _provider, model: _model, ...reference } = previous;
    return {
      ...reference,
      notes: `${reference.notes ?? ""} Historical route fallback; not reverified in the ${PROVIDER_MODEL_PRICING_REFERENCE_TAG} refresh.`,
    };
  }
  if (rule) {
    return {
      canonicalModel: rule.canonicalModel,
      basis: rule.basis,
      inputPerMTok: rule.inputPerMTok,
      outputPerMTok: rule.outputPerMTok,
      cacheReadPerMTok: rule.cacheReadPerMTok,
      cacheWritePerMTok: rule.cacheWritePerMTok,
      notes: `${rule.notes ?? ""} Historical fallback; not reverified in the ${PROVIDER_MODEL_PRICING_REFERENCE_TAG} refresh.`,
    };
  }

  return {
    ...UNPRICED_FALLBACK,
    canonicalModel: model,
    notes: `No pricing reference available for ${provider}/${normalizedModel}.`,
  };
}
