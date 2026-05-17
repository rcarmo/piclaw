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

export interface AgentContext {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface OobeStatus {
  provider_ready_completed_instance?: boolean;
  [key: string]: unknown;
}

export interface ModelInfo {
  current: string | null;
  models: string[];
  model_options: { id: string; label?: string; provider?: string; context_window?: number }[];
  thinking_level: string | null;
  thinking_level_label: string | null;
  supports_thinking: boolean;
  available_thinking_levels: string[];
  provider_usage?: ProviderUsage;
  oobe?: OobeStatus;
}

export interface ProviderUsage {
  provider?: string;
  plan?: string;
  hint_short?: string;
  primary?: { label: string; used_percent: number; remaining_percent: number; resets_at?: string; reset_description?: string };
  secondary?: { label: string; used_percent: number; remaining_percent: number; resets_at?: string; reset_description?: string };
  credits_remaining?: number | null;
  credits_unlimited?: boolean;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface ModelEntry { id: string; context_window?: number }

export const FALLBACK_MODELS: ModelEntry[] = [
  { id: "github-copilot/claude-sonnet-4.6", context_window: 200000 },
  { id: "github-copilot/claude-opus-4.6", context_window: 1000000 },
  { id: "github-copilot/gpt-5.3-codex", context_window: 1000000 },
  { id: "github-copilot/o4-mini", context_window: 200000 },
  { id: "github-copilot/gemini-2.5-pro", context_window: 1048576 },
];

export const FALLBACK_THINKING_LEVELS = ["none", "low", "medium", "high", "max"];

export const fmtTokens = (n: number) =>
  n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : `${(n / 1000).toFixed(0)}k`;
