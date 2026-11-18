import { expect, test } from "bun:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createLifecycle, driftedConfirms, injectable, score, updateEnvironmentLifecycle, updateLifecycle, LifecycleSchema, EnvironmentLifecycleSchema, type EnvironmentLifecycle } from "../src/core/microskills/lifecycle.ts";
import { emptyEnvelope, envelope, learnedThresholds, pythonRound, recordTurn } from "../src/core/loopguard/envelope.ts";
import { assess, gateForJudge, isStuck, scaledThresholds } from "../src/core/loopguard/rules.ts";
import { compareCodePoints } from "../src/core/ordering.ts";
import lifecycles from "./fixtures/lifecycle.json";
import envfacts from "./fixtures/environment-lifecycle.json";
import envelopes from "./fixtures/envelope.json";
import rules from "./fixtures/rules.json";
const verdictSchema = Type.Union([Type.Enum(["confirm", "contradict"]), Type.Null()]);
const levelSchema = Type.Enum(["default", "aggressive", "conservative"]);
for (const fixture of lifecycles.cases) test(`upstream fact lifecycle ${fixture.input.high}/${fixture.input.drift}/${lifecycles.cases.indexOf(fixture)}`, () => {
  let state = createLifecycle("fixture", fixture.input.high, fixture.input.drift);
  for (const [index, step] of fixture.input.steps.entries()) {
    Value.Assert(verdictSchema, step.verdict);
    const prior = structuredClone(state);
    state = updateLifecycle(state, step.now, step.verdict, step.fired, step.exercised, step.files);
    expect(prior).not.toBe(state);
    const expectedLife = fixture.expected[index].life;
    Value.Assert(LifecycleSchema, expectedLife);
    expect(state).toEqual(expectedLife);
    expect(score(state, step.now)).toBeCloseTo(fixture.expected[index].score, 12);
    expect(injectable(state)).toBe(fixture.expected[index].injectable);
    expect(driftedConfirms(state)).toBe(fixture.expected[index].drifted);
  }
});
for (const fixture of envfacts.cases) test(`upstream environment lifecycle ${envfacts.cases.indexOf(fixture)}`, () => {
  let state: EnvironmentLifecycle = { life: createLifecycle("fixture", fixture.input.high, false), family: fixture.input.family, contradictionStreak: 0 };
  for (const [index, step] of fixture.input.steps.entries()) {
    Value.Assert(verdictSchema, step.verdict);
    state = updateEnvironmentLifecycle(state, step.now, step.verdict, step.fired, step.exercised, step.files);
    const expectedState = fixture.expected[index];
    Value.Assert(EnvironmentLifecycleSchema, expectedState);
    expect(state).toEqual(expectedState);
  }
});
for (const fixture of envelopes.cases) test(`upstream live envelope ${envelopes.cases.indexOf(fixture)}`, () => {
  const { level, history, overrides } = fixture.input;
  Value.Assert(levelSchema, level);
  expect(envelope(history, level, overrides)).toEqual(fixture.expected.envelope);
  expect(learnedThresholds(history, level, overrides)).toEqual(fixture.expected.thresholds);
});
for (const fixture of rules.cases) test(`upstream loop rules ${rules.cases.indexOf(fixture)}`, () => {
  const { level, state, envelope, judge } = fixture.input;
  Value.Assert(levelSchema, level);
  const thresholds = scaledThresholds(level);
  expect(gateForJudge(state, thresholds)).toBe(fixture.expected.gate);
  expect(isStuck(state, thresholds)).toBe(fixture.expected.stuck);
  expect(assess(state, envelope, thresholds, judge)).toEqual({ redirect: fixture.expected.redirect, reason: fixture.expected.reason });
});
test("reference rounding includes exact binary ties, rather than Math.round or decimal scaling", () => {
  for (const [input, digits, expected] of [[2.5,0,2], [3.5,0,4], [-2.5,0,-2], [2.675,2,2.67], [.0625,3,.062], [.8125,3,.812]]) expect(pythonRound(input,digits)).toBe(expected);
  expect(["😀", "\ue000"].sort(compareCodePoints)).toEqual(["\ue000", "😀"]);
});
test("only ended-green turns update bounded envelope history", () => {
  const snapshot = { turns: 10, edit_churn: 1, distinct_edit_files: 1, error_outputs: 0, stagnation: 0, repeated_fail_sigs: 0, test_runs: 1 };
  let state = emptyEnvelope();
  expect(recordTurn(state, 10, false, snapshot)).toEqual(state);
  expect(recordTurn(state, 0, true, snapshot)).toEqual(state);
  for (let i = 0; i < 501; i++) state = recordTurn(state, i+1, true, snapshot);
  expect(state.resolved_turns).toHaveLength(500);
  expect(state.resolved_turns[0]).toBe(2);
  expect(state.resolved_snaps).toHaveLength(500);
});
