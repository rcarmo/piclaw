export const USD_MICROS = 1_000_000;

export interface TokenCategoryCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
}

export interface TokenCategoryCosts {
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  total?: number | null;
}

export interface ApiEquivalentValuation {
  known: boolean;
  amountMicros: number | null;
  amountUsd: number | null;
  knownSubtotalMicros: number;
  unknownCategories: Array<"input" | "output" | "cacheRead" | "cacheWrite">;
  categoryMicros: Partial<Record<"input" | "output" | "cacheRead" | "cacheWrite", number>>;
  provenance: "catalogue_estimate" | "documented_free" | "unavailable";
  fallbackCategories: Array<"cacheRead" | "cacheWrite">;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Normalise an SDK catalogue valuation for passive usage reporting.
 *
 * The SDK supplies category costs, not tariffs. A zero total is therefore
 * evidence only when the route is independently documented as free. Missing
 * cache costs may fall back to the ordinary input category only when requested
 * explicitly by the pricing resolver that owns that evidence.
 */
export function valueApiEquivalentCost(input: {
  tokens: TokenCategoryCounts;
  costs: TokenCategoryCosts;
  documentedFree?: boolean;
  cacheReadInputFallback?: number | null;
  cacheWriteInputFallback?: number | null;
}): ApiEquivalentValuation {
  const categories = ["input", "output", "cacheRead", "cacheWrite"] as const;
  const fallbackCategories: ApiEquivalentValuation["fallbackCategories"] = [];
  const unknownCategories: ApiEquivalentValuation["unknownCategories"] = [];
  const categoryMicros: ApiEquivalentValuation["categoryMicros"] = {};
  let total = 0;
  let sawPositiveCost = false;

  for (const category of categories) {
    const count = input.tokens[category];
    if (!finiteNonNegative(count)) {
      unknownCategories.push(category);
      continue;
    }
    if (count === 0) continue;

    let cost = input.costs[category];
    if (!finiteNonNegative(cost)) {
      const fallback = category === "cacheRead"
        ? input.cacheReadInputFallback
        : category === "cacheWrite"
          ? input.cacheWriteInputFallback
          : null;
      if (!finiteNonNegative(fallback)) {
        unknownCategories.push(category);
        continue;
      }
      cost = fallback;
      if (category === "cacheRead" || category === "cacheWrite") fallbackCategories.push(category);
    }
    total += cost;
    categoryMicros[category] = Math.round(cost * USD_MICROS);
    sawPositiveCost = sawPositiveCost || cost > 0;
  }

  const knownSubtotalMicros = Math.round(total * USD_MICROS);
  const known = unknownCategories.length === 0 && (sawPositiveCost || input.documentedFree === true);
  const amountMicros = known ? knownSubtotalMicros : null;
  return {
    known,
    amountMicros,
    amountUsd: amountMicros == null ? null : amountMicros / USD_MICROS,
    knownSubtotalMicros,
    unknownCategories,
    categoryMicros,
    provenance: !known
      ? "unavailable"
      : input.documentedFree && amountMicros === 0
        ? "documented_free"
        : "catalogue_estimate",
    fallbackCategories,
  };
}
