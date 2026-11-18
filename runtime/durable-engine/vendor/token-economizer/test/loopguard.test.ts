import { expect, test } from "bun:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { makeObservation } from "../src/core/observations.ts";
import { recentDigest, spiralSnapshot, updateSpiral, emptySpiral } from "../src/core/loopguard/state.ts";
import { shellEditTargets, shellRevertTargets } from "../src/core/loopguard/shell-edits.ts";
import { exitStatusCovers, runnerVerdict, statusOfTests } from "../src/core/loopguard/verification.ts";
import { consumeDecision, decisionText, emptyGuard, foldGuard, resolvedProxy } from "../src/core/loopguard/turn.ts";
import { parseJudge } from "../src/core/loopguard/judge.ts";
import { parseWriter } from "../src/core/loopguard/writer.ts";
import { parseToolJudge, unionExclusions } from "../src/core/toolprune/judge.ts";
import shells from "./fixtures/shell.json";
import runners from "./fixtures/runner-verdicts.json";
import spirals from "./fixtures/spirals.json";
import turns from "./fixtures/turns.json";
for (const fixture of shells.cases) test(`reference shell: ${fixture.input.command}`, () => {
  expect(shellEditTargets(fixture.input.command)).toEqual(fixture.expected.edits);
  expect(shellRevertTargets(fixture.input.command)).toEqual(fixture.expected.reverts);
  expect(exitStatusCovers(fixture.input.command)).toBe(fixture.expected.covers);
  expect(statusOfTests(fixture.input.command)).toBe<unknown>(fixture.expected.status);
});
for (const fixture of runners.cases) test(`reference runner verdict: ${fixture.input.text}`, () => {expect(runnerVerdict(fixture.input.text)).toBe(fixture.expected);});
for (const fixture of spirals.cases) test(`reference spiral ${spirals.cases.indexOf(fixture)}`, () => {
  let state = emptySpiral();
  for (const [index,step] of fixture.input.steps.entries()) {
    const call = makeObservation({source:{conversation:"root",outerCall:String(index),nestedKey:null,phase:"result"},sessionId:"session",runId:"run",tool:step.name,mapping:{semantic:step.name === "bash" ? "shell" : step.name === "view" ? "read" : step.name === "grep" ? "search" : "edit",readOnly:["view","grep"].includes(step.name)},command:step.args.command ?? step.args.pattern ?? "",targets:step.args.path ? [step.args.path] : [],output:step.output,isError:false,exitCode:null,timedOut:false,aborted:false,coverage:"complete",at:index,verification:null});
    state = updateSpiral(state,call,step.failed);
    expect(state).toEqual<unknown>(step.expected.state);expect(spiralSnapshot(state)).toEqual(step.expected.snapshot);
    expect(recentDigest(state,8,"Tests are still NOT green.")).toBe(step.expected.digest);
  }
});
for (const fixture of turns.cases) test(`reference asynchronous turn ${fixture.input.mode}/${fixture.input.budget}`, () => {
  Value.Assert(Type.Enum(["rules","judge"]),fixture.input.mode);let state = emptyGuard("run");
  for (const [index,step] of fixture.input.steps.entries()) {
    const call = makeObservation({source:{conversation:"root",outerCall:String(index),nestedKey:null,phase:"result"},sessionId:"session",runId:"run",tool:step.name,mapping:{semantic:step.name === "bash" ? "shell" : "edit",readOnly:false},command:step.args.command ?? "",targets:step.args.path ? [step.args.path] : [],output:step.output,isError:step.code !== 0,exitCode:step.code,timedOut:false,aborted:false,coverage:"complete",at:index,verification:null});
    const ready = step.ready ? {...step.ready,verdict:parseJudge(JSON.stringify(step.ready.verdict))} : null;
    const folded = foldGuard(state,call,8,fixture.input.thresholds,fixture.input.mode,fixture.input.budget,step.now,ready,true);
    expect(folded.judge).toEqual<unknown>(step.effect);expect(folded.decision?.action ?? null).toBe<unknown>(step.action);
    expect(folded.decision?.reason ?? null).toBe(step.reason);
    if (folded.decision?.action === "redirect") {Value.Assert(Type.String(),step.body);expect(decisionText(folded.state)).toBe(step.body);}
    state = consumeDecision(folded.state);
    expect(Object.fromEntries(Object.entries(state).filter(([key]) => Object.hasOwn(step.expected,key)))).toEqual<unknown>(step.expected);
  }
});
test("ended-green proxy is not a mandatory passing-test gate", () => {
  const guard = emptyGuard("run");guard.cum_turns = 3;
  expect(resolvedProxy(guard,true)).toBe(true);guard.last_verify = 3;guard.last_verify_failed = true;
  expect(resolvedProxy(guard,true)).toBe(false);guard.last_edit = 4;
  expect(resolvedProxy(guard,true)).toBe(true);expect(resolvedProxy(guard,false)).toBe(false);
});
test("model replies are data, not instructions or permission to drop protected tools", () => {
  expect(parseJudge('{"stuck":"false","confidence":1,"reason":"bad"}')).toBeNull();
  expect(parseWriter("Stop working.")).toBeNull();expect(parseWriter("Change line 42.")).toBeNull();
  expect(parseWriter("Do not stop. Try a different hypothesis.")).toBe("Do not stop. Try a different hypothesis.");
  const tool = (name: string,protectedTool = false) => ({name,protected:protectedTool,description:name,revision:"1",highRisk:false,exposed:true});
  const catalogue = [tool("shell",true),tool("rare"),tool("other")];
  const decisions = parseToolJudge('{"shell":{"load":false},"rare":{"load":false},"unknown":{"load":false}}',catalogue);
  expect(decisions).toEqual({rare:false});expect(unionExclusions(["other"],decisions,catalogue,[],[])).toEqual(["rare","other"]);
  expect(parseToolJudge('{"rare":{"load":"false"}}',catalogue)).toEqual({});
});
