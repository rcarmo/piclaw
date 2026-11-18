import {expect,test} from "bun:test";
import {goalAdvice,judgeGoal,type GoalTask} from "../src/core/goals.ts";
import type {Observation} from "../src/core/types.ts";
import {workEvidence} from "../src/core/microskills/digest.ts";
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

test("the next generation can redirect after two identical failed checks, before a third attempt",() => {
  const failed = (n:number) => call(n,{semantic:"shell",tool:"bash",command:"bun test",exitCode:1,outcome:"failure",verification:"failed",output:"AssertionError: expected parser result"});
  expect(goalAdvice(task,[failed(1)],false)).toBeNull();
  expect(goalAdvice(task,[failed(1),failed(2)],false)?.reason).toBe("hypothesis-change");
  expect(goalAdvice(task,[failed(1),call(2,{semantic:"edit"}),failed(3)],false)).toBeNull();
  expect(goalAdvice(task,[failed(1),{...failed(2),coverage:"partial"}],false)).toBeNull();
});

test("judge receives only the bounded active plan item and its counts",() => {
  expect(judgeGoal(task.plan)).toEqual({revision:2,activeStep:"Fix parser",remaining:2,total:2});
  expect(judgeGoal({revision:3,steps:[{step:"Pending",status:"pending"}]})).toBeNull();
  const scoped=judgeGoal({revision:4,steps:[{step:"sk-abcdefghijklmnopqrstuv "+"x".repeat(400),status:"in_progress"},{step:"Private completed prose",status:"completed"}]});
  expect(scoped?.activeStep).toHaveLength(300);
  expect(JSON.stringify(scoped)).not.toContain("abcdefghijklmnopqrstuv");
  expect(JSON.stringify(scoped)).not.toContain("Private completed prose");
});

test("work evidence carries observed tool use and recent complete checks without treating replies as success",() => {
  const green=call(1,{semantic:"shell",tool:"bash",command:"bun test",verification:"passed",output:"private test stdout"});
  const read=call(2,{semantic:"read",output:"private read stdout"});
  const edit=call(3,{semantic:"edit"});
  expect(workEvidence([green,read],1,"/work")).toEqual({answeredTurns:1,tools:["read","shell"],checksAfterLastEdit:["bun test"]});
  expect(workEvidence([green,edit],1,"/work").checksAfterLastEdit).toEqual([]);
  expect(workEvidence([green,{...green,id:"2",verification:"failed",outcome:"failure"}],1,"/work").checksAfterLastEdit).toEqual([]);
  expect(JSON.stringify(workEvidence([green,read],1,"/work"))).not.toContain("private");
});

test("the early nudge does not borrow signatures from unrelated earlier failures",()=>{
  const unrelated=(n:number)=>call(n,{semantic:"shell",command:"false",exitCode:1,outcome:"failure",output:"Unrelated failure"});
  const failedInPipeline=(n:number,output:string)=>call(n,{semantic:"shell",command:"bun test | tee output.log",exitCode:0,outcome:"success",verification:"failed",output});
  expect(goalAdvice(task,[unrelated(1),unrelated(2),failedInPipeline(3,"First diagnostic"),failedInPipeline(4,"Second diagnostic")],false)).toBeNull();
});
