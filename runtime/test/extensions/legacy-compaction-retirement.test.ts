import {expect, test} from 'bun:test';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createBuiltinExtensionFactories} from '../../src/extensions/index.js';
import {createFakeExtensionApi} from './fake-extension-api.js';
import {getCompactionRuntimeConfig, getConfigPath, setCompactionRuntimeConfig, resetCompactionRuntimeConfigForTests} from '../../src/core/config.js';
import {withTempWorkspaceEnv} from '../helpers.js';
import {getRegisteredDomainConfigSchemas} from '../../src/core/domain-config.js';

const retired=['smartCompactionMethod','model','compactionModel','remoteCompactionEnabled','remoteCompactionTimeoutMs','timeoutMs','backoffBaseMs','backoffMaxMs','progressiveCompaction','smartCompactionReasoning'];

test('shipped builtin factory graph no longer registers a legacy compaction lifecycle', async()=>{
  const fake=createFakeExtensionApi();
  for(const factory of createBuiltinExtensionFactories())await factory(fake.api);
  expect(fake.handlers.filter(h=>h.event==='session_before_compact')).toHaveLength(0);
  expect(fake.tools.has('list_tools')).toBe(true);expect(fake.tools.has('attach_file')).toBe(true);
  // Payload sanitisation remains; absence of the old lifecycle must not delete unrelated provider hooks.
  expect(fake.handlers.some(h=>h.event==='before_provider_request')).toBe(true);
});

test('legacy execution modules and session stream API are absent while offline session creation remains',async()=>{
  const modules=['orchestrator','progressive','progressive-policy','progressive-checkpoint','model-execution','model-request','stream-complete','pipeline-events','pipeline-policy','pipelined','selective-execution','selective-method','selective-prompt','source','messages','files','noop','retained-context','boundary-policy','safety','summary-validation','status','config','context','compat','provider-timing'];
  expect(await Bun.file(new URL('../../src/extensions/smart-compaction.ts',import.meta.url)).exists()).toBe(false);
  for(const name of modules)expect(await Bun.file(new URL('../../src/extensions/smart-compaction/'+name+'.ts',import.meta.url)).exists()).toBe(false);
  const session=await import('../../src/agent-pool/session.js');
  expect(session).not.toHaveProperty('createCompactionStreamFn');expect(typeof session.createSessionInDir).toBe('function');expect(typeof session.createDefaultSession).toBe('function');
  const remote=await import('../../src/extensions/smart-compaction/remote-compaction.js');
  for(const name of ['attemptRemoteCompaction','injectRemoteCompactionPayload','prependRemoteCompactionPayload','resolveRemoteCompactionCapability'])expect(remote).not.toHaveProperty(name);
  expect(await import('../../src/extensions/smart-compaction/result-details.js')).not.toHaveProperty('createSmartCompactionResultDetails');
  expect(await Bun.file(new URL('../../src/agent-pool/compaction-cancel-reason.ts',import.meta.url)).exists()).toBe(false);
  expect(Object.keys(await import('../../src/agent-pool/compaction-trigger-context.js'))).toEqual([]);
});

test('retired stored execution settings are inert and survive supported native policy writes',async()=>{
  await withTempWorkspaceEnv('legacy-compaction-retired-values-',{PICLAW_AUTO_COMPACTION_ENABLED:'invalid'},async()=>{
    resetCompactionRuntimeConfigForTests();
    // Shared helper enforces a valid alias; use an invalid value inside this isolated scope to exercise persisted policy.
    process.env.PICLAW_AUTO_COMPACTION_ENABLED='invalid';
    const path=getConfigPath(),history=Object.fromEntries(retired.filter(k=>k!=='compactionModel').map(k=>[k,{old:'invalid but preserve'}]));
    mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify({compaction:{model:'keep old alias',remote_compaction_enabled:true},domains:{compaction:{...history,autoCompactionEnabled:true},watchdog:{enabled:false,timeoutMs:123000}}}));
    const config=getCompactionRuntimeConfig();
    expect(config.autoCompactionEnabled).toBe(true);expect(config.progressWatchdogTimeoutMs).toBe(123000);
    for(const key of retired)expect(config).not.toHaveProperty(key);
    const saved=setCompactionRuntimeConfig({autoCompactionEnabled:false});expect(saved.autoCompactionEnabled).toBe(false);
    const stored=JSON.parse(readFileSync(path,'utf8'));
    for(const[key,value]of Object.entries(history))expect(stored.domains.compaction[key]).toEqual(value);
    expect(stored.compaction).toEqual({model:'keep old alias',remote_compaction_enabled:true});
    expect(getRegisteredDomainConfigSchemas().find(s=>s.domain==='compaction')!.fields).not.toHaveProperty('model');
    resetCompactionRuntimeConfigForTests();
  });
});

test('direct stale configuration saves reject before writing the supported auto toggle or historical fields',async()=>{
  await withTempWorkspaceEnv('legacy-compaction-retired-write-',{PICLAW_AUTO_COMPACTION_ENABLED:'invalid'},async()=>{
    resetCompactionRuntimeConfigForTests();
    const path=getConfigPath();mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify({domains:{compaction:{autoCompactionEnabled:true}}}));
    const before=readFileSync(path,'utf8');
    for(const key of retired){expect(()=>setCompactionRuntimeConfig({autoCompactionEnabled:false,[key]:false} as any)).toThrow('Retired compaction configuration fields');expect(readFileSync(path,'utf8')).toBe(before);expect(getCompactionRuntimeConfig().autoCompactionEnabled).toBe(true);}
  });
});
