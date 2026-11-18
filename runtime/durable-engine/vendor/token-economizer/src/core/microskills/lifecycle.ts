// SPDX-License-Identifier: Apache-2.0
// Modified TypeScript port of Microsoft TokenEconomizer, revision 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
// Ported from TokenEconomizer microskills/lifecycle.py and envfacts.fold (Apache-2.0).
import { Type, type Static } from "typebox";
import { compareCodePoints } from "../ordering.ts";
const nullableClock = Type.Union([Type.Number(), Type.Null()]);
export const LifecycleSchema = Type.Object({
  key: Type.String(), high: Type.Boolean(), drift: Type.Boolean(), state: Type.Enum(["CANDIDATE", "ACTIVE", "RETIRED"]),
  confirms: Type.Array(Type.Tuple([Type.Number(), Type.Array(Type.String())])), contradicts: Type.Array(Type.Number()),
  fire_num: Type.Number(), fire_den: Type.Number(), promoted_at: nullableClock, retired_at: nullableClock,
}, { additionalProperties: false });
export type Lifecycle = Static<typeof LifecycleSchema>;
export type FactState = Lifecycle["state"];
export const EnvironmentLifecycleSchema = Type.Object({ life: LifecycleSchema, contradictionStreak: Type.Number(), family: Type.String() });
export type Verdict = "confirm" | "contradict" | null;
/** Each evidence group's persisted credits allow at most one vote/exercise per fact. */
export type LearningCredits = { confirms: string[]; contradicts: string[]; exercises: string[] };
export function creditLearning(credits: LearningCredits | undefined, key: string, verdict: Verdict, fired: boolean, exercised: boolean){
  if (!credits) return { verdict, fired, exercised };
  if (verdict) {
    const votes = verdict === "confirm" ? credits.confirms : credits.contradicts;
    if (votes.includes(key)) verdict = null;
    else votes.push(key);
  }
  if (exercised) {
    if (credits.exercises.includes(key)) { exercised = false; fired = false; }
    else credits.exercises.push(key);
  }
  return { verdict, fired, exercised };
}
export function createLifecycle(key: string, high: boolean, drift = true): Lifecycle {
  return { key, high, drift, state: "CANDIDATE", confirms: [], contradicts: [], fire_num: 0, fire_den: 0, promoted_at: null, retired_at: null };
}
export function score(life: Lifecycle, now: number): number {
  return life.confirms.reduce((sum, [i]) => sum + .8 ** (now-i), 0) - 5 * life.contradicts.reduce((sum, i) => sum + .8 ** (now-i), 0);
}
export function firingRate(life: Lifecycle): number { return life.fire_den ? life.fire_num / life.fire_den : 0; }
export function injectable(life: Lifecycle): boolean { return life.state === "ACTIVE" && life.fire_den >= 4 && firingRate(life) >= .4; }
export function driftedConfirms(life: Lifecycle): number {
  if (!life.drift) return life.confirms.length;
  const kept: string[][] = [];
  for (const [, files] of life.confirms) if (!files.length || kept.every(previous => !files.some(file => previous.includes(file)))) kept.push(files);
  return kept.length;
}
export function updateLifecycle(prior: Lifecycle, now: number, verdict: Verdict, fired: boolean, exercised: boolean, files: string[]): Lifecycle {
  const life = structuredClone(prior);
  if (exercised) { life.fire_den++; if (fired) life.fire_num++; }
  if (verdict === "confirm") life.confirms.push([now, [...new Set(files)].sort(compareCodePoints)]);
  else if (verdict === "contradict") life.contradicts.push(now);
  if (life.state === "CANDIDATE") {
    if (driftedConfirms(life) >= 3) { life.state = "ACTIVE"; life.promoted_at = now; }
  } else if (life.state === "ACTIVE" && (life.high && verdict === "contradict" || score(life, now) < 0)) {
    life.state = "RETIRED"; life.retired_at = now;
  }
  return life;
}
export type EnvironmentLifecycle = { life: Lifecycle; contradictionStreak: number; family: string };
export function updateEnvironmentLifecycle(prior: EnvironmentLifecycle, now: number, verdict: Verdict, fired: boolean, exercised: boolean, files: string[]): EnvironmentLifecycle {
  let contradictionStreak = prior.contradictionStreak;
  if (prior.family === "form_repair" && exercised) {
    contradictionStreak = verdict === "contradict" ? contradictionStreak + 1 : 0;
    if (verdict === "contradict" && contradictionStreak < 2) verdict = null;
  }
  const life = updateLifecycle(prior.life, now, verdict, fired, exercised, files);
  if (verdict === "contradict" && life.high && life.state === "CANDIDATE") { life.state = "RETIRED"; life.retired_at = now; }
  return { life, contradictionStreak, family: prior.family };
}
