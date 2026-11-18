import { expect, test } from "bun:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { defaultPolicy } from "../src/core/config.ts";
import { compareCodePoints } from "../src/core/ordering.ts";
import { emptyEvidence, foldEvidence } from "../src/core/toolprune/evidence.ts";
import type { ToolInfo } from "../src/core/types.ts";
import fixtures from "./fixtures/catalogue.json";
import {toolJudgePrompt} from "../src/core/toolprune/judge.ts";
const tool = (name: string, description: string): ToolInfo => ({ name, description, revision: "1", protected: false, highRisk: false, exposed: true });
for (const fixture of fixtures.cases) test(`upstream retained catalogue ${fixtures.cases.indexOf(fixture)}`, () => {
  const prior = emptyEvidence();
  prior.catalogue = [tool("rare", "Rare tool"), tool("prior", "Prior tool")];
  prior.streaks = { rare: 3, prior: 1 };
  prior.applied = fixture.input.mask;
  const policy = { ...defaultPolicy(), enabled: true, mode: "active" as const, pruning: "propose" as const };
  const incoming = Object.entries(fixture.input.incoming).map(([name, description]) => tool(name, description));
  const next = foldEvidence(prior, fixture.input.used, incoming, 1, policy, 0);
  Value.Assert(Type.Record(Type.String(), Type.String()), fixture.expected.descriptions);
  Value.Assert(Type.Record(Type.String(), Type.Number()), fixture.expected.streaks);
  expect(next.catalogue.map(t => t.name).sort(compareCodePoints)).toEqual(fixture.expected.catalogue);
  expect(Object.fromEntries(next.catalogue.map(t => [t.name,t.description]))).toEqual(fixture.expected.descriptions);
  expect(next.used).toEqual(fixture.expected.used);
  expect(next.streaks).toEqual(fixture.expected.streaks);
});
test("master Off cannot advance evidence even when pruning is configured Auto", () => {
  const prior = emptyEvidence(), policy = defaultPolicy();
  policy.pruning = "auto";
  expect(foldEvidence(prior, [], [tool("rare", "Rare")], 10, policy, 100)).toEqual(prior);
});

test("tool selection puts the reusable catalogue before variable task text",()=>{
  const tools=[tool("rare","Reusable catalogue description"),tool("other","Another helper")];
  const first=toolJudgePrompt("Fix the parser",tools),second=toolJudgePrompt("Review the tests",tools);
  expect(first.split("\n\nTASK:\n")[0]).toBe(second.split("\n\nTASK:\n")[0]);
  expect(first.indexOf("Reusable catalogue description")).toBeLessThan(first.indexOf("Fix the parser"));
  expect(second).toContain("Review the tests");expect(second).not.toContain("Fix the parser");
});
