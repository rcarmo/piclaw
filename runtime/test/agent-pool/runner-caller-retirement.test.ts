import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AgentPool } from '../../src/agent-pool.js';
import { createOperationHost } from '../../src/addons/operation-host.js';
import { initDatabase,getDb } from '../../src/db.js';
import { runDreamAgentTurn } from '../../src/dream.js';
import * as scheduler from '../../src/task-scheduler.js';
import { existsSync,readdirSync } from 'node:fs';
import { DATA_DIR,WORKSPACE_DIR } from '../../src/core/config.js';
import '../helpers.js';

const source=resolve(import.meta.dir,'../../src');
test('no direct runner API/options or fallback caller remains',()=>{
  expect('runAgent' in AgentPool.prototype).toBe(false);
  expect('restoreSessionPosition' in AgentPool.prototype).toBe(false);
  expect(readFileSync(resolve(source,'agent-pool/contracts.ts'),'utf8')).not.toContain('interface RunAgentOptions');
  for(const path of ['dream.ts','addons/operation-host.ts','task-scheduler.ts','runtime/message-loop.ts'])
    expect(readFileSync(resolve(source,path),'utf8')).not.toContain('.runAgent(');
});
for(const native of [false,undefined]) test(`add-on host cannot execute without native authority (${native})`,async()=>{
  let calls=0;
  const host=createOperationHost({isDurableRuntime:()=>native,runAgent:async()=>{calls++;return{status:'success',result:'forbidden'};}} as any);
  await expect(host.execute({operationId:'unadmitted',chatJid:'operation:unadmitted',workId:'operation:unadmitted',text:'not execution authority',principal:{addonId:'example',principalId:'client'},grant:{target:'echo',revision:'r1',allowedTools:['read'],timeoutMs:1000,maxToolCalls:1,parentWorkId:null},signal:new AbortController().signal})).rejects.toThrow('Native add-on execution unavailable');
  expect(calls).toBe(0);
});

for(const native of [false,true])test(`unadmitted Dream and scheduled AI cannot mutate files/models/cursors (native=${native})`,async()=>{
  initDatabase();let calls=0;
  const forbidden=()=>{calls++;throw Error('Legacy caller entered');};
  const pool={isDurableRuntime:()=>native,runAgent:forbidden,saveSessionPosition:forbidden,restoreSessionPosition:forbidden,applyControlCommand:forbidden};
  const paths=()=>[DATA_DIR,resolve(WORKSPACE_DIR,'notes')].map(path=>existsSync(path)?readdirSync(path,{recursive:true}).sort():[]);
  const before=getDb().serialize(),files=paths();
  await expect(runDreamAgentTurn({chatJid:'web:unadmitted',mode:'manual',agentPool:pool as any})).rejects.toThrow('Native Dream dispatcher unavailable');
  expect(scheduler).not.toHaveProperty('runScheduledTask');
  expect(typeof scheduler.pollScheduledRunsOnce).toBe('function');
  expect(getDb().serialize()).toEqual(before);expect(paths()).toEqual(files);expect(calls).toBe(0);
});
