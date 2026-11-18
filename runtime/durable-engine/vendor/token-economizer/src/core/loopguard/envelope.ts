// SPDX-License-Identifier: Apache-2.0
// Modified TypeScript port of Microsoft TokenEconomizer, revision 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
// Ported from TokenEconomizer loopguard/envelope.py (Apache-2.0), live path only.
import { scaledThresholds, type Level, type SpiralSnapshot, type Thresholds } from "./rules.ts";
export type EnvelopeHistory = { resolved_turns: number[]; resolved_snaps: SpiralSnapshot[] };
export function emptyEnvelope(): EnvelopeHistory { return { resolved_turns: [], resolved_snaps: [] }; }
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b), i = p / 100 * (sorted.length-1), low = Math.floor(i);
  return low + 1 >= sorted.length ? sorted.at(-1)! : sorted[low] + (i-low) * (sorted[low+1]-sorted[low]);
}
/** Python's round uses the exact IEEE-754 value, not a rounded decimal product. */
export function pythonRound(value: number, digits = 0): number {
  if (!Number.isFinite(value) || !Number.isInteger(digits) || digits < 0 || digits > 6) throw new Error("Invalid rounding input");
  if (value === 0) return value;
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, Math.abs(value));
  const bits = view.getBigUint64(0), exponent = Number(bits >> 52n & 2047n), fraction = bits & ((1n << 52n)-1n);
  const significand = exponent ? fraction + (1n << 52n) : fraction, shift = (exponent ? exponent-1023 : -1022)-52;
  let numerator = significand * 10n ** BigInt(digits), denominator = 1n;
  if (shift >= 0) numerator <<= BigInt(shift); else denominator <<= BigInt(-shift);
  let whole = numerator / denominator;
  const remainder = numerator % denominator;
  if (2n * remainder > denominator || 2n * remainder === denominator && whole % 2n !== 0n) whole++;
  return Math.sign(value) * Number(whole) / 10 ** digits;
}
export function envelope(history: EnvelopeHistory, level: Level, overrides: Partial<Thresholds> = {}): number | null {
  const t = { ...scaledThresholds(level), ...overrides };
  return history.resolved_turns.length < t.envelope_min_samples ? null : percentile(history.resolved_turns, t.envelope_pct)! * t.envelope_margin;
}
/** No benchmark frozen-envelope or turn-cap clamp belongs in this live reducer. */
export function learnedThresholds(history: EnvelopeHistory, level: Level, overrides: Partial<Thresholds> = {}): Thresholds {
  const base = scaledThresholds(level), thr = { ...base }, env = envelope(history, level, overrides);
  if (env !== null) thr.backstop_turns = env * thr.backstop_mult;
  if (history.resolved_turns.length >= (overrides.envelope_min_samples ?? base.envelope_min_samples)) {
    const p90 = percentile(history.resolved_turns, 90) ?? 0;
    thr.gate_min_turns = Math.max(6, Math.min(base.gate_min_turns, pythonRound(.6 * p90)));
    thr.min_turns = Math.max(8, Math.min(base.min_turns, pythonRound(.6 * p90)));
    if (history.resolved_snaps.length) {
      const signal = (key: keyof SpiralSnapshot) => percentile(history.resolved_snaps.map(s => s[key]), 90) ?? 0;
      thr.edit_churn = Math.max(base.edit_churn, Math.ceil(signal("edit_churn") + 1));
      thr.distinct_edit_files = Math.max(base.distinct_edit_files, Math.ceil(signal("distinct_edit_files") + 1));
      thr.error_outputs = Math.max(base.error_outputs, Math.ceil(signal("error_outputs") + 1));
      thr.gate_error_outputs = Math.max(base.gate_error_outputs, thr.error_outputs);
      thr.stagnation = Math.max(base.stagnation, pythonRound(signal("stagnation"), 3));
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!["envelope_margin", "envelope_pct", "envelope_min_samples"].includes(key)) Object.assign(thr, { [key]: value });
  }
  if (overrides.backstop_mult !== undefined && env !== null) thr.backstop_turns = env * overrides.backstop_mult;
  return thr;
}
export function recordTurn(prior: EnvelopeHistory, turns: number, endedGreen: boolean, snapshot: SpiralSnapshot): EnvelopeHistory {
  if (!endedGreen || !turns) return structuredClone(prior);
  return { resolved_turns: [...prior.resolved_turns, turns].slice(-500), resolved_snaps: [...prior.resolved_snaps, structuredClone(snapshot)].slice(-500) };
}
