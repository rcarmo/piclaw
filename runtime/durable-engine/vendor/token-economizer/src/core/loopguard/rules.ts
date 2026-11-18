// SPDX-License-Identifier: Apache-2.0
// Modified TypeScript port of Microsoft TokenEconomizer, revision 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
// Ported from TokenEconomizer loopguard/rules.py (Apache-2.0).
export type Level = "default" | "conservative" | "aggressive";
export type Thresholds = {
  min_turns: number; edit_churn: number; distinct_edit_files: number; error_outputs: number; stagnation: number;
  envelope_margin: number; envelope_pct: number; envelope_min_samples: number; judge_confidence: number;
  backstop_mult: number; gate_min_turns: number; gate_error_outputs: number;
  backstop_turns?: number; gate_over_envelope?: boolean; nudge_on_ambiguous?: boolean;
};
export type SpiralSnapshot = {
  turns: number; edit_churn: number; distinct_edit_files: number; error_outputs: number;
  stagnation: number; repeated_fail_sigs: number; test_runs: number;
};
export function scaledThresholds(level: Level): Thresholds {
  const base: Thresholds = { min_turns: 20, edit_churn: 4, distinct_edit_files: 3, error_outputs: 6, stagnation: .2,
    envelope_margin: 1.25, envelope_pct: 90, envelope_min_samples: 5, judge_confidence: .7, backstop_mult: 2.5, gate_min_turns: 18, gate_error_outputs: 8 };
  if (level === "conservative") return { ...base, judge_confidence: .85, envelope_margin: 1.5, backstop_mult: 3.5, stagnation: .3, gate_min_turns: 24, min_turns: 28, edit_churn: 5, error_outputs: 8, envelope_min_samples: 7 };
  if (level === "aggressive") return { ...base, judge_confidence: .55, envelope_margin: 1, backstop_mult: 1.8, stagnation: .12, gate_min_turns: 12, min_turns: 14, edit_churn: 3, error_outputs: 4, envelope_min_samples: 3, nudge_on_ambiguous: true };
  return base;
}
export function gateForJudge(state: SpiralSnapshot, thr: Thresholds): boolean {
  return state.turns >= thr.gate_min_turns && (state.repeated_fail_sigs >= 1 || state.error_outputs >= thr.gate_error_outputs);
}
export function isStuck(state: SpiralSnapshot, thr: Thresholds): boolean {
  return state.turns >= thr.min_turns && (state.edit_churn >= thr.edit_churn || state.distinct_edit_files >= thr.distinct_edit_files)
    && state.error_outputs >= thr.error_outputs && state.stagnation >= thr.stagnation;
}
export function atBackstop(state: SpiralSnapshot, envelope: number | null, thr: Thresholds): boolean {
  const limit = thr.backstop_turns ?? (envelope === null ? null : envelope * thr.backstop_mult);
  return limit !== null && state.turns >= limit && isStuck(state, thr);
}
export type JudgeVerdict = { stuck: boolean | null; confidence: number; reason: string };
export type Assessment = { redirect: boolean; reason: string };
/** A null verdict means a wired judge has no result, not that rule-only mode was selected. */
export function assess(state: SpiralSnapshot, envelope: number | null, thr: Thresholds, judge: { verdict: JudgeVerdict | null } | null): Assessment {
  if (atBackstop(state, envelope, thr)) return { redirect: true, reason: "backstop" };
  if (judge !== null) {
    if (!gateForJudge(state, thr) && !(envelope !== null && state.turns >= envelope && thr.gate_over_envelope !== false)) return { redirect: false, reason: "gate-closed" };
    if (!judge.verdict) return { redirect: false, reason: "judge-throttled" };
    if (judge.verdict.stuck && judge.verdict.confidence >= thr.judge_confidence) return { redirect: true, reason: "judge-stuck" };
    return { redirect: false, reason: judge.verdict.stuck === false ? "judge-productive" : "judge-ambiguous-spared" };
  }
  if (!isStuck(state, thr)) return { redirect: false, reason: "not-stuck" };
  return envelope !== null && state.turns >= envelope ? { redirect: true, reason: "envelope" } : { redirect: false, reason: "stuck-but-within-envelope" };
}
export function nudgeText(state: SpiralSnapshot, editCounts: Record<string, number>, editOrder: string[]): string {
  const ordered = [...new Set(editOrder)];
  let busiest = "one file", best = -1;
  for (const file of ordered) if (editCounts[file] > best) { best = editCounts[file]; busiest = file; }
  return "Process check (automated): so far you've made " + Object.values(editCounts).reduce((a,b) => a+b, 0) + " edits across "
    + state.distinct_edit_files + " file(s) (most to `" + busiest + "`) and run " + state.test_runs + " verification(s), and the same failure has recurred "
    + state.repeated_fail_sigs + " time(s) without the tests going green. This looks like a repetitive loop. Do NOT stop — instead step back and try a "
    + "MATERIALLY DIFFERENT hypothesis: re-read the failing test's expectation, consider a different file or root cause than the ones you've been editing, "
    + "and verify the new hypothesis directly before editing again.";
}
