import { expect,test } from 'bun:test';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAgentPoolServices } from '../../src/agent-pool/service-factory.js';
import { createAgentPoolModelOptions } from '../model-services-fixture.js';
import { initDatabase,getDb } from '../../src/db.js';
import { readMcpInstancePolicy } from '../../src/core/config-mcp.js';
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
  expect(()=>new AgentPool(missing)).toThrow('legacy capture must be explicit');
  expect(()=>new AgentPool({...model,legacyCapture:true})).toThrow('Native host cannot select legacy capture');
  const intervals=spyOn(globalThis,'setInterval');
  let pool:AgentPool|undefined;
  try{
    pool=new AgentPool(model);
    expect(intervals).not.toHaveBeenCalled();
    expect(pool.getMemoryInstrumentationSnapshot()).not.toHaveProperty('sessionManager');
    expect(()=>pool!.assertLegacyCaptureIdle()).toThrow('no resident legacy authority');
    expect(()=>pool!.setSessionBinder(()=>{})).toThrow('does not install a legacy session binder');
    for(const name of ['scheduleChatWarmup','scheduleRecentChatWarmup'])expect(pool).not.toHaveProperty(name);
  }finally{await pool?.shutdown();intervals.mockRestore();}
});

test('native MCP config inspection cannot certify an empty legacy shutdown as live reconfiguration',async()=>{
  initDatabase();const model=createAgentPoolModelOptions();
  const services=createAgentPoolServices({pool:new Map(),authStorage:model.credentialStore!,modelRuntime:model.modelRuntime!,modelRegistry:{} as any,
    settingsManager:SettingsManager.inMemory(),workspaceDir:process.env.PICLAW_WORKSPACE!,getDurableSession:()=>undefined});
  const before=readMcpInstancePolicy(),database=getDb().serialize();
  const preview=services.mcpSettings.inspect();
  expect(preview.applyAvailable).toBe(false);expect(preview.runtime.applyAvailable).toBe(false);
  expect(services.mcpSettings.inspectServers().applyAvailable).toBe(false);
  await expect(services.mcpSettings.apply({policy:before.policy,revision:preview.revision,acknowledgeInterruptions:true},()=>{}))
    .rejects.toThrow('Native MCP live reconfiguration unavailable');
  await expect(services.mcpSettings.applyServers({revision:preview.revision,acknowledgeInterruptions:true},()=>{},new AbortController().signal))
    .rejects.toThrow('Native MCP live reconfiguration unavailable');
  expect(preview.runtime.observedPolicy).toBeNull();
  expect(readMcpInstancePolicy()).toEqual(before);expect(getDb().serialize()).toEqual(database);
});
