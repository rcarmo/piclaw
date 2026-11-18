import {expect,test} from "bun:test";
import {goalAdvice,type GoalTask} from "../src/core/goals.ts";
import type {Observation} from "../src/core/types.ts";
const task:GoalTask = {id:"user-1",text:"Fix the parser without changing the public API.",plan:{revision:2,steps:[{step:"Fix parser",status:"in_progress"},{step:"Check edge cases",status:"pending"}]}};
const call = (n:number,change:Partial<Observation> = {}):Observation => ({id:String(n),sessionId:"s",runId:"r",tool:"read",semantic:"read",command:"",targets:["parser.ts"],output:"text",outcome:"success",exitCode:0,coverage:"complete",nested:false,parentId:null,readOnly:true,verification:null,at:n,...change});
test("no competing goal, no unconditional or stop-request reminder",() => {
  expect(goalAdvice(task,[],false)).toBeNull();
  expect(goalAdvice({...task,text:""},[],true)).toBeNull();
  expect(goalAdvice({...task,text:"Stop now."},[],true)).toBeNull();
});
test("compaction reminder quotes the actual task and active plan",() => {
  const advice=goalAdvice(task,[],true)!;expect(advice.reason).toBe("goal-reminder");expect(advice.text).toContain(task.text);expect(advice.text).toContain("Fix parser");expect(advice.text).toContain("2 unfinished");expect(advice.text).toContain("grants no permission");
});
test("verification debt is based on observed edits, and a partial or failed check cannot clear it",() => {
  const edits=Array.from({length:4},(_,i)=>call(i,{semantic:"edit",readOnly:false}));
  expect(goalAdvice(task,edits,false)?.reason).toBe("verification-debt");
  expect(goalAdvice(task,[...edits,call(5,{verification:"passed",coverage:"partial"})],false)?.reason).toBe("verification-debt");
  expect(goalAdvice({...task,plan:null},[...edits,call(5,{verification:"passed"})],false)).toBeNull();
  expect(goalAdvice(task,[...edits,call(5,{verification:"failed",outcome:"failure"})],false)?.reason).toBe("verification-debt");
});
test("passed verification invites reconciliation, not an automatic completion claim",() => {
  const advice=goalAdvice(task,[call(1),call(2,{semantic:"edit"}),call(3,{verification:"passed"})],false)!;
  expect(advice.reason).toBe("completion-check");expect(advice.text).toContain("report remaining work and blockers");
});
test("marking the plan done does not erase unverified edits",() => {
  const done={...task,plan:{revision:3,steps:[{step:"Fix",status:"completed" as const}]}};
  expect(goalAdvice(done,[call(1,{semantic:"edit"})],false)?.reason).toBe("verification-debt");
});
test("repeated failure guidance does not survive a subsequent green check",() => {
  const calls=Array.from({length:8},(_,i)=>call(i,{semantic:"shell",tool:"bash",command:"bun test",exitCode:1,outcome:"failure",output:"AssertionError: expected 1 got 2"}));
  expect(goalAdvice(task,calls,false)?.reason).toBe("hypothesis-change");
  expect(goalAdvice({...task,plan:null},[...calls,call(9,{verification:"passed"})],false)).toBeNull();
});
