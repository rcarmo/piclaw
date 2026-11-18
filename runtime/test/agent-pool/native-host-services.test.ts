import { expect,test } from 'bun:test';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAgentPoolServices } from '../../src/agent-pool/service-factory.js';
import { createAgentPoolModelOptions } from '../model-services-fixture.js';
import { initDatabase,getDb } from '../../src/db.js';
import { spyOn } from 'bun:test';
import { AgentPool } from '../../src/agent-pool.js';
import '../helpers.js';

test('native host services contain no binder/tool/session lifecycle placeholders',()=>{
  const model=createAgentPoolModelOptions();
  const services=createAgentPoolServices({pool:new Map(),authStorage:model.credentialStore!,modelRuntime:model.modelRuntime!,modelRegistry:{} as any,
    settingsManager:SettingsManager.inMemory(),workspaceDir:process.env.PICLAW_WORKSPACE!,getDurableSession:()=>undefined});
  for(const name of ['sessionBinder','toolFactory','sessionManager'])expect(services).not.toHaveProperty(name);
});

test('no implicit legacy selection, mixed authority, native GC timer or fabricated capture proof',async()=>{
  initDatabase();
  const model=createAgentPoolModelOptions();
  const missing={...model,getDurableSession:undefined};
  expect(()=>new AgentPool(missing)).toThrow('Native host requires a durable session lookup');
  expect(()=>new AgentPool({...model,legacyCapture:true})).toThrow('Resident legacy capture was removed');
  const intervals=spyOn(globalThis,'setInterval');
  let pool:AgentPool|undefined;
  try{
    pool=new AgentPool(model);
    expect(intervals).not.toHaveBeenCalled();
    expect(pool.getMemoryInstrumentationSnapshot()).not.toHaveProperty('sessionManager');
    expect(pool).not.toHaveProperty('assertLegacyCaptureIdle');
    expect(pool).not.toHaveProperty('setSessionBinder');
    for(const name of ['scheduleChatWarmup','scheduleRecentChatWarmup'])expect(pool).not.toHaveProperty(name);
  }finally{await pool?.shutdown();intervals.mockRestore();}
});

test('native host services and public facade expose no obsolete MCP engine/apply owner',async()=>{
  initDatabase();const model=createAgentPoolModelOptions();
  const services=createAgentPoolServices({pool:new Map(),authStorage:model.credentialStore!,modelRuntime:model.modelRuntime!,modelRegistry:{} as any,
    settingsManager:SettingsManager.inMemory(),workspaceDir:process.env.PICLAW_WORKSPACE!,getDurableSession:()=>undefined});
  const database=getDb().serialize();expect(services).not.toHaveProperty('mcpSettings');
  for(const name of ['inspectMcpSettings','applyMcpSettings','inspectMcpServers','applyMcpServers'])expect(AgentPool.prototype).not.toHaveProperty(name);
  expect(getDb().serialize()).toEqual(database);
});
