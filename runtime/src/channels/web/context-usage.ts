/** Public context fields only; runtime authority hints stay inside the agent facade. */
export function publicContextUsage(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const context = value as Record<string, unknown>;
  return {
    tokens: context.tokens,
    contextWindow: context.contextWindow,
    percent: context.percent,
    sessionGeneration: context.sessionGeneration,
  };
}
