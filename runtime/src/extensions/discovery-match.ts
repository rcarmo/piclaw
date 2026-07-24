/**
 * discovery-match – shared low-level text matching helpers for discovery tools.
 *
 * Catalog-specific scoring stays in the owning list_tools/list_scripts modules;
 * this file only owns normalization, tokenization, deduplication, limit
 * clamping, and primitive token/phrase match accumulation.
 */

export interface DiscoveryMatchAccumulator {
  score: number;
  matchedTerms: string[];
  matchedSources: string[];
}

const SHORT_TOKEN_ALLOWLIST = new Set(["ai", "db", "fs", "id", "ip", "mcp", "sql", "ssh", "ui", "vm", "vnc"]);
const STOP_TOKENS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "get", "help", "how", "i", "if", "in", "into", "is", "it", "me", "my", "of", "on", "or", "our", "show", "something", "task", "that", "the", "this", "to", "tool", "tools", "use", "using", "want", "what", "with", "you",
]);

export function clampDiscoveryLimit(value: number | undefined, fallback = 100): number {
  if (!Number.isFinite(value)) return fallback;
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, 1), 200);
}

export function uniqueDiscoveryStrings(values: Iterable<string>): string[] {
  return [...new Set(Array.from(values).map((value) => String(value || "").trim()).filter(Boolean))];
}

export function normalizeDiscoveryText(value: string | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9+.#/\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeDiscoveryText(value: string | undefined): string[] {
  const text = normalizeDiscoveryText(value);
  if (!text) return [];
  return [...new Set(text.split(/\s+/).filter((token) => {
    if (!token) return false;
    if (SHORT_TOKEN_ALLOWLIST.has(token)) return true;
    if (token.length < 3) return false;
    if (STOP_TOKENS.has(token)) return false;
    return true;
  }))];
}

export function addDiscoveryTokenMatches(
  intentTokens: Set<string>,
  terms: string[] | undefined,
  source: string,
  points: number,
  match: DiscoveryMatchAccumulator,
): void {
  if (!terms?.length) return;
  for (const term of uniqueDiscoveryStrings(terms.map((value) => normalizeDiscoveryText(value)))) {
    if (!term) continue;
    for (const token of tokenizeDiscoveryText(term)) {
      if (!intentTokens.has(token)) continue;
      match.score += points;
      match.matchedTerms.push(token);
      match.matchedSources.push(source);
    }
  }
}

export function addDiscoveryExactPhraseMatches(
  haystack: string,
  phrases: string[] | undefined,
  source: string,
  points: number,
  match: DiscoveryMatchAccumulator,
): void {
  if (!phrases?.length) return;
  for (const phrase of uniqueDiscoveryStrings(phrases.map((value) => normalizeDiscoveryText(value)))) {
    if (!phrase || !phrase.includes(" ")) continue;
    if (!haystack.includes(phrase)) continue;
    match.score += points;
    match.matchedTerms.push(phrase);
    match.matchedSources.push(source);
  }
}

export function finalizeDiscoveryMatches<T extends DiscoveryMatchAccumulator>(match: T): T {
  match.matchedTerms = uniqueDiscoveryStrings(match.matchedTerms);
  match.matchedSources = uniqueDiscoveryStrings(match.matchedSources);
  return match;
}
