import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { createHostGoalTerminalFence } from "../../runtime/durable-engine/src/host-goal-terminal.js";
import { value, effect, sealed, at } from "./src/host-handoff.js";
import { context } from "./src/fixture.js";

for (const status of ["complete", "budget_limited"] as const) for (const change of ["none", "replace", "generation", "status", "delete"] as const) test(`Goal terminal tool fence rechecks lifecycle after proof: ${status}:${change}`, async () => {
  initDatabase(); const db = getDb(); installTerminalSettlementCompositionSchema(db);
  const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {} }));
  const chatJid = `web:goal-race-${change}`;
  const source = value(await work.acceptSource(sealed({ effect: effect(`goal-race:${change}:accept`), chatJid, sourceId: "race", kind: "message", payloadRef: "race", targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  const claimed = value(await work.claimNext(sealed({ effect: effect(`goal-race:${change}:claim`), chatJid, expectedFrontier: 0, newOperationId: `goal-race:${change}:op`, claimedAt: at })))!;
  const operation = value(await work.bindHarness(sealed({ effect: effect(`goal-race:${change}:bind`, claimed.operation.operationId, source.sourceSeq), expectedVersion: claimed.operation.version, sessionId: "race-session", harnessOperationId: "42" })));
  const captured = { operation, inputs: [{ incarnation: "race-copy", conversationId: 2 as never, chatJid, branchId: "main", operationId: operation.operationId,
    sourceSeq: source.sourceSeq, sourceId: source.sourceId, payloadRef: source.payloadRef, requestId: "race", requestHash: "a".repeat(64), submissionId: 42 as never }], runTaskId: 9 as never };
  let goal: { goal_id: string; lifecycle_generation: number; status: string } | null = { goal_id: "original", lifecycle_generation: 2, status };
  const afterRead = async () => {
    await Promise.resolve();
    if (change === "replace") goal!.goal_id = "replacement";
    if (change === "generation") goal!.lifecycle_generation++;
    if (change === "status") goal!.status = "active";
    if (change === "delete") goal = null;
  };
  const extension = createHostGoalTerminalFence({ loadThreadGoal() { return goal && { ...goal }; }, goalInputIdentity() { return {}; } }, { root: db, assertOwner() {}, runtime: () => ({
    async capturePendingToolSource() { return captured; },
    async readCapturedInputText() { await afterRead(); return ["Goal input"]; },
    async hasGoalTerminalResult() {
      await afterRead();
      return false; // Old operation may not block a later turn, unless lifecycle changed during proof.
    },
  }) });
  try {
    const hook = extension.hooks![0]!.handlers.beforeTool!;
    const invoke = () => hook({ id: "pending", name: "get_goal", arguments: {} }, { conversationId: 2, taskId: 10 } as never, context);
    if (change === "none") {
      if (status === "budget_limited") expect(await invoke()).toMatchObject({ block: "Goal token budget reached; provide the final wrap-up without further tools." });
      else expect(await invoke()).toBeUndefined();
    }
    else await expect(invoke()).rejects.toThrow("Goal tool lifecycle changed");
  } finally { await closeDatabase(); }
});

for(const inputKind of ['message','scheduled'] as const)for(const lostPlacement of [false,true])test(`Goal queue withdrawal preserves current Goal and human inputs; kind=${inputKind}, placement race=${lostPlacement}`,async()=>{
  const {createHostGoalPrompt}=await import('../../runtime/durable-engine/src/host-goal-prompt.js');
  const {Database}=await import('bun:sqlite');
  const root=new Database(':memory:');let allowed=true;
  const removed:number[]=[],denied:unknown[]=[];
  const captured={native:{assertCurrent(){if(!allowed)throw Error('source revoked');}},operation:{chatJid:'web:goal-queue'},inputs:[{incarnation:'queue-test',chatJid:'web:goal-queue',branchId:'main',conversationId:2,sourceSeq:1,operationId:inputKind==='message'?'native-message:2:1':'native-scheduled:scheduled_run:'+ 'a'.repeat(64)}]};
  const extension=createHostGoalPrompt({loadThreadGoal:()=>null,buildGoalSystemPrompt:()=>'',buildGoalBudgetLimitPrompt:()=>'',claimGoalBudgetWrapup(){},isGoalBudgetInput:()=>false,
    goalInputIdentity:text=>text==='human'?null:{goalId:text,generation:1},resolveGoalInput:text=>({action:text==='stale'?'handled':'continue'}),accountGoalProgress(){},accountTerminalGoalProgress(){}},
    {root,assertOwner(){},failClosed:error=>{denied.push(error);},runtime:()=>({
      async captureRunSource(){return captured;},async readCapturedInputText(){return ['human'];},
      async readMessageInbox(){if(inputKind==='scheduled')throw Error('Scheduled generation cannot read the public inbox');return [{content:'stale',submissionId:10},{content:'current',submissionId:11},{content:'human',submissionId:12}];},
      async removeQueuedMessage(_binding:unknown,id:number){removed.push(id);return !lostPlacement;},
    } as never)});
  try{
    const hook=extension.hooks![0]!.handlers.beforeRequest!;
    const request={messages:[]};expect(await hook(request,{conversationId:2,taskId:20} as never,context)).toBe(request);
    expect(removed).toEqual(inputKind==='message'?[10]:[]);expect(denied).toEqual([]);
    // A source revoked during the inbox await cannot authorize any withdrawal.
    allowed=false;removed.length=0;
    await expect(hook(request,{conversationId:2,taskId:20} as never,context)).rejects.toThrow('Goal request authority unavailable');
    expect(removed).toEqual([]);expect(denied).toHaveLength(1);
  }finally{root.close();}
});
