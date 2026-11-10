/** Shared report payload. Keep this module free of database/runtime imports. */
export interface TokenUsageRecord {
  /** Chat JID the agent run belonged to. */
  chat_jid: string;
  /** ISO-8601 timestamp of the agent run. */
  run_at: string;
  /** Number of input (prompt) tokens consumed. */
  input_tokens: number;
  /** Number of output (completion) tokens generated. */
  output_tokens: number;
  /** Reasoning tokens reported by providers when available. Included in output tokens by OpenAI-compatible usage. */
  reasoning_tokens?: number;
  /** Tokens served from the provider's prompt cache. */
  cache_read_tokens: number;
  /** Tokens written into the provider's prompt cache. */
  cache_write_tokens: number;
  /** Whether the provider explicitly reported cache-read tokens. Null means legacy/unknown. */
  cache_read_reported?: boolean | null;
  /** Whether the provider explicitly reported cache-write tokens. Null means legacy/unknown. */
  cache_write_reported?: boolean | null;
  /** Sum of all token categories. */
  total_tokens: number;
  /** Dollar cost attributed to input tokens. */
  cost_input: number;
  /** Dollar cost attributed to output tokens. */
  cost_output: number;
  /** Dollar cost attributed to cache-read tokens. */
  cost_cache_read: number;
  /** Dollar cost attributed to cache-write tokens. */
  cost_cache_write: number;
  /** Effective provider amount or USD catalogue estimate; consult provenance/currency. */
  cost_total: number;
  /** Provider-reported total cost, when available. */
  provider_cost_total?: number | null;
  /** Observational currency for provider_cost_total; null means legacy/unknown. */
  provider_cost_currency?: string | null;
  /** Catalogue-calculated total cost, when available. */
  catalogue_cost_total?: number | null;
  /** Provenance for cost_total. Null means a legacy row. */
  cost_provenance?: TokenUsageCostProvenance | null;
  /** Requested model identifier (e.g. "auto" or "claude-sonnet-4-20250514"). */
  model?: string | null;
  /** Concrete upstream model returned by a router/gateway when it differs from the requested model. */
  response_model?: string | null;
  /** Provider name (e.g. "anthropic"). */
  provider?: string | null;
  /** API variant used (e.g. "messages", "chat"). */
  api?: string | null;
  /** Usage source category, such as assistant turn, tool execution, or compaction summary. */
  usage_source?: TokenUsageSource | string | null;
  /** Number of conversational turns in the run. */
  turns?: number | null;
  /** Historical correlation only; never an execution or financial admission owner. */
  work_id?: string | null;
  /** Billable provider invocation identity when available. */
  invocation_id?: string | null;
  /** Stable event identity used to make recovery replay idempotent. */
  usage_event_id?: string | null;
  /** API-equivalent catalogue valuation in millionths of one US dollar. */
  api_equivalent_cost_microusd?: number | null;
  /** Whether the API-equivalent valuation is complete, including documented zero. */
  api_equivalent_cost_known?: boolean | null;
  valuation_provenance?: "catalogue_estimate" | "documented_free" | "unavailable" | null;
  api_equivalent_known_subtotal_microusd?: number | null;
  api_equivalent_unknown_categories?: string | null;
  pricing_currency?: string | null;
  pricing_source?: string | null;
  pricing_version?: string | null;
  pricing_context_tier?: string | null;
  pricing_cache_fallbacks?: string | null;
  execution_kind?: "interactive" | "goal" | "scheduled" | "background" | "delegate" | "side_prompt" | null;
}

export type TokenUsageSource = "assistant" | "tool" | "compaction" | "branch_summary" | "unknown";

export type TokenUsageCostProvenance = "provider_reported" | "catalogue_estimate" | "unavailable";
