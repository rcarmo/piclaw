/**
 * context-window-budget.ts – Shared helpers for conservative context-window budgeting.
 *
 * Model context windows include more than conversation messages: system prompt,
 * tools, memory, skills, UI state, and provider framing also consume tokens.
 * These helpers keep compaction triggers, smart-compaction prompts, and model
 * fit checks aligned on an effective usable window.
 */

import { parsePositiveIntStrict } from "./strict-int.js";

const DEFAULT_SYSTEM_PROMPT_OVERHEAD_TOKENS = 4_000;
const DEFAULT_COMPACTION_REQUEST_OVERHEAD_TOKENS = 1_000;
const DEFAULT_UNKNOWN_MODEL_CONTEXT_WINDOW = 64_000;
const DEFAULT_TOKEN_ESTIMATE_SAFETY_MULTIPLIER = 1.1;

function parsePositiveInt(value: unknown, fallback: number): number {
  return parsePositiveIntStrict(value, fallback);
}

export function getSystemPromptOverheadTokens(): number {
  return parsePositiveInt(process.env.PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS, DEFAULT_SYSTEM_PROMPT_OVERHEAD_TOKENS);
}

/**
 * Overhead for the isolated compaction side request (its system instruction and
 * provider framing). This is deliberately separate from the full agent-system
 * overhead used to validate the context that will remain after compaction.
 */
export function getCompactionRequestOverheadTokens(): number {
  return parsePositiveInt(
    process.env.PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS,
    DEFAULT_COMPACTION_REQUEST_OVERHEAD_TOKENS,
  );
}

export function getUnknownModelContextWindow(): number {
  return parsePositiveInt(process.env.PICLAW_UNKNOWN_MODEL_CONTEXT_WINDOW, DEFAULT_UNKNOWN_MODEL_CONTEXT_WINDOW);
}

export function getTokenEstimateSafetyMultiplier(): number {
  const parsed = Number.parseFloat(String(process.env.PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER || "").trim());
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_TOKEN_ESTIMATE_SAFETY_MULTIPLIER;
}

export function applyTokenEstimateSafetyMultiplier(tokens: number, multiplier = getTokenEstimateSafetyMultiplier()): number {
  const normalizedTokens = Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
  const normalizedMultiplier = Number.isFinite(multiplier) && multiplier >= 1 ? multiplier : 1;
  return Math.ceil((normalizedTokens * normalizedMultiplier) - 1e-9);
}

export function getContextWindowFromModel(model: unknown): number | null {
  const anyModel = model as { contextWindow?: unknown; contextLength?: unknown } | null | undefined;
  const raw = typeof anyModel?.contextWindow === "number"
    ? anyModel.contextWindow
    : typeof anyModel?.contextLength === "number"
      ? anyModel.contextLength
      : null;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : null;
}

export function getEffectiveContextWindow(contextWindow: number, overheadTokens = getSystemPromptOverheadTokens()): number {
  const normalizedWindow = Number.isFinite(contextWindow) && contextWindow > 0
    ? Math.trunc(contextWindow)
    : getUnknownModelContextWindow();
  const normalizedOverhead = Number.isFinite(overheadTokens) && overheadTokens > 0
    ? Math.trunc(overheadTokens)
    : 0;
  return Math.max(0, normalizedWindow - normalizedOverhead);
}

export function getContextThresholdTokens(
  contextWindow: number,
  thresholdPercent: number,
  overheadTokens = getSystemPromptOverheadTokens(),
): number {
  const normalizedPercent = Number.isFinite(thresholdPercent) && thresholdPercent > 0
    ? Math.min(100, Math.max(1, thresholdPercent))
    : 75;
  return Math.floor(getEffectiveContextWindow(contextWindow, overheadTokens) * (normalizedPercent / 100));
}
