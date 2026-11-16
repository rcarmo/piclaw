import { expect, test, spyOn } from "bun:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { AgentPool } from "../../src/agent-pool.js";
import { initDatabase, getDb } from "../../src/db.js";
import { createAgentPoolModelOptions,createLegacyCapturePoolOptions } from "../model-services-fixture.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const native of [true, false]) test(`retired direct prompt boundary cannot execute or bookkeep (native=${native})`, async () => {
  initDatabase(); let factoryCalls=0, optionReads=0;
  if (!native) {
    expect(() => new AgentPool({...createLegacyCapturePoolOptions(), createSession:async()=>{factoryCalls++;throw Error("Retired legacy factory reached");}})).toThrow('Resident legacy capture was removed');
    expect(factoryCalls).toBe(0); return;
  }
  const pool=new AgentPool({...createAgentPoolModelOptions(),
    createSession:async()=>{factoryCalls++;throw Error("Retired legacy factory reached");}});
  try {
    const before=getDb().serialize();
    expect('runAgent' in pool).toBe(false);
    expect(optionReads).toBe(0);expect(factoryCalls).toBe(0);
    expect(getDb().serialize()).toEqual(before);
  } finally {await pool.shutdown();}
});

test("retired prompt-owner modules and both composition imports are absent", () => {
  const source=resolve(import.meta.dir,"../../src"), retired=["run-agent-orchestrator","run-agent-recovery-phase","run-agent-attempt-budget","run-agent-attempt-context","run-agent-attempt-finalization","turn-coordinator","protected-recovery-handoff","run-operation-boundary","run-tool-ceiling","active-tool-subset-memory","tool-state-transitions","model-call-timing","blank-turn-detection","recovery-decision","recovery-decision-types","logging"];
  for(const name of retired){
    expect(existsSync(resolve(source,"agent-pool",name+".ts"))).toBe(false);
    for(const entry of ["agent-pool.ts","agent-pool/service-factory.ts"])
      expect(readFileSync(resolve(source,entry),"utf8")).not.toContain(name+".js");
  }
});

test("native host construction cannot impose a legacy request-retry floor", async () => {
  initDatabase();
  const settings=SettingsManager.inMemory({retry:{enabled:false,maxRetries:1,baseDelayMs:7}});
  const before=settings.getRetrySettings(),getter=settings.getRetrySettings;
  const create=spyOn(SettingsManager,"create").mockReturnValue(settings);
  let pool:AgentPool|undefined;
  try {
    pool=new AgentPool({...createAgentPoolModelOptions(),getDurableSession:()=>undefined});
    expect(settings.getRetrySettings).toBe(getter);
    expect(settings.getRetrySettings()).toEqual(before);
    expect(pool.getMemoryInstrumentationSnapshot()).not.toHaveProperty("recovery");
  } finally {await pool?.shutdown();create.mockRestore();}
});
