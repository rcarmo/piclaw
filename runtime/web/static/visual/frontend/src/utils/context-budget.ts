/** Context window safety margins — mirrors runtime/src/utils/context-window-budget.ts */

const SYSTEM_PROMPT_OVERHEAD = 4_000;
const SAFETY_MULTIPLIER = 1.1;
const UNKNOWN_MODEL_CONTEXT = 64_000;

export function getEffectiveContextWindow(contextWindow: number | null | undefined): number {
  const window = contextWindow || UNKNOWN_MODEL_CONTEXT;
  return Math.max(0, window - SYSTEM_PROMPT_OVERHEAD);
}

export function getSafetyAdjustedTokens(tokens: number): number {
  return Math.ceil(tokens * SAFETY_MULTIPLIER);
}

export function getContextUsagePercent(tokens: number, contextWindow: number | null | undefined): number {
  const effective = getEffectiveContextWindow(contextWindow);
  if (effective <= 0) return 0;
  return Math.min(100, (getSafetyAdjustedTokens(tokens) / effective) * 100);
}
