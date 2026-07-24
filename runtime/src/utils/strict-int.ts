/**
 * strict-int.ts – strict decimal integer parsing for runtime configuration.
 *
 * Use for environment/config values where malformed suffixes like `12abc`
 * must fall back instead of being partially accepted by parseInt().
 */

const DECIMAL_INTEGER = /^\d+$/;

function parseStrictDecimalInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value) ? value : null;
  }
  const text = String(value ?? "").trim();
  if (!DECIMAL_INTEGER.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parsePositiveIntStrict(value: unknown, fallback: number): number {
  const parsed = parseStrictDecimalInteger(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

export function parseNonNegativeIntStrict(value: unknown, fallback: number): number {
  const parsed = parseStrictDecimalInteger(value);
  return parsed !== null ? parsed : fallback;
}
