/**
 * First sentence of a prompt's first non-empty line, without Markdown
 * heading/list/quote markers. A sentence ends at . ! or ? before a capital.
 */
function firstPromptLine(prompt: string): string | null {
  for (const line of prompt.split("\n")) {
    const text = line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)/, "").trim();
    if (text) return text.match(/^.+?[.!?](?=\s+[A-Z])/)?.[0] ?? text;
  }
  return null;
}

export function summariseDelegateCall(input: unknown): string | null {
  const prompt = input && typeof input === "object" ? (input as Record<string, unknown>).prompt : undefined;
  return typeof prompt === "string" ? firstPromptLine(prompt) : null;
}
