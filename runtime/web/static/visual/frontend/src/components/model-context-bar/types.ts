import type { ModelCatalogueEntry } from "../../../../../../src/ui/model-catalogue";

export interface AddonApiStatus {
  healthy: boolean;
  degraded_addons?: string[];
}

export interface AgentStatus {
  status: "active" | "idle";
  addon_api?: AddonApiStatus;
  data?: {
    model?: string;
    thinking_level?: string;
    tier?: string;
    chat_percent?: number;
    premium_percent?: number;
  };
}

export interface TokenUsageSummary {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheReadReported?: boolean | null;
  totalTokens?: number;
  costTotal?: number;
  costProvenance?: string | null;
  provider?: string | null;
  model?: string | null;
  responseModel?: string | null;
}

export interface AgentContext {
  contextUpdate?: "replace";
  sessionGeneration?: string | null;
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  cacheUsage?: { latest?: TokenUsageSummary | null } | null;
}

export interface OobeStatus {
  provider_ready_completed_instance?: boolean;
  [key: string]: unknown;
}

export interface ModelInfo {
  current: string | null;
  models: string[];
  model_options: {
    id: string;
    label?: string;
    provider?: string;
    name?: string | null;
    context_window?: number | null;
    reasoning?: boolean;
    pricing?: ModelPricing | null;
  }[];
  thinking_level: string | null;
  thinking_level_label: string | null;
  supports_thinking: boolean;
  available_thinking_levels: string[];
  available_thinking_level_labels?: string[];
  provider_usage?: ProviderUsage;
  oobe?: OobeStatus;
}

export interface ProviderUsage {
  provider?: string;
  plan?: string;
  availability?: string;
  stale?: boolean;
  refresh_failure?: string | null;
  hint_short?: string;
  primary?: { label: string; used_percent: number; remaining_percent: number; resets_at?: string; reset_description?: string };
  secondary?: { label: string; used_percent: number; remaining_percent: number; resets_at?: string; reset_description?: string };
  credits_remaining?: number | null;
  credits_unlimited?: boolean;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  key_usage_usd?: number | null;
  key_limit_usd?: number | null;
  key_limit_remaining_usd?: number | null;
  key_limit_configured?: boolean | null;
  key_limit_unlimited?: boolean;
}

export interface ModelPricing {
  input_per_million?: number | null;
  output_per_million?: number | null;
  cache_read_per_million?: number | null;
  cache_write_per_million?: number | null;
}

export interface ModelEntry {
  id: string;
  current?: boolean;
  name?: string | null;
  context_window?: number | null;
  reasoning?: boolean;
  pricing?: ModelPricing | null;
}

export type VisualModelEntry = ModelCatalogueEntry & { reasoningKnown: boolean };


export const fmtTokens = (n: number) =>
  n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : `${(n / 1000).toFixed(0)}k`;
