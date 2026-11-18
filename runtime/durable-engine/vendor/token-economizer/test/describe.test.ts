import { expect, test } from "bun:test";
import { describeKnowledge } from "../src/core/describe.ts";
import { emptyEnvironment, type EnvironmentFact } from "../src/core/microskills/envfacts.ts";
import { emptyDistiller } from "../src/core/microskills/distiller.ts";
import { createLifecycle } from "../src/core/microskills/lifecycle.ts";
test("learned facts are summarised by visibility without advancing their lifecycles", () => {
  const environment = emptyEnvironment(), distiller = emptyDistiller();
  const life = (state: "CANDIDATE" | "ACTIVE" | "RETIRED", fired: number, seen: number) => ({ ...createLifecycle("fact", false, false), state, fire_num: fired, fire_den: seen, confirms: Array.from({ length: seen }, (_, i): [number, string[]] => [i, []]) });
  const boundary = (id: string, state: "CANDIDATE" | "ACTIVE" | "RETIRED", fired: number, seen: number): EnvironmentFact => ({ id, family: "boundary", params: { hosts: { [`${id}.example`]: 1 } }, life: life(state, fired, seen) });
  environment.facts = [boundary("checking", "CANDIDATE", 0, 1), boundary("quiet", "ACTIVE", 0, 5), boundary("shown", "ACTIVE", 4, 5), boundary("old", "RETIRED", 0, 2)];
  distiller.facts = [{ spec: { id: "manual", claim: "Run bun test from the repository root.", detector: { scope: "commands", fired: "bun test" } }, life: life("ACTIVE", 5, 5) }];
  const before = structuredClone(environment), summary = describeKnowledge(environment, distiller);
  expect(summary.retired).toBe(1);
  expect(summary.facts.map(fact => [fact.id, fact.status, fact.source])).toEqual([["shown", "in-use", "environment"], ["manual", "in-use", "distilled"], ["checking", "checking", "environment"], ["quiet", "quiet", "environment"], ["old", "retired", "environment"]]);
  expect(summary.facts.find(fact => fact.id === "shown")?.claim).toContain("shown.example");
  expect(environment).toEqual(before);
});
