import {expect,test} from 'bun:test';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {isModelType} from '@earendil-works/pi-ai';
import {getBuiltinModels} from '@earendil-works/pi-ai/providers/all';
import {createMcpExtension,createToolSearchExtension,createCodemodeExtension} from '@earendil-works/pi-coding-agent';
import historicalHarnessEvidence from '../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-harness-compatibility-schema6.json';
const root=resolve(import.meta.dir,'../../..'),pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')),lock=readFileSync(resolve(root,'bun.lock'),'utf8');
test.skipIf(pkg.dependencies['@earendil-works/pi-coding-agent']!=='1.0.3')('exact 1.0.3 package and lock closure retains adapter ownership',()=>{
 for(const name of ['@earendil-works/pi-agent-core','@earendil-works/pi-ai','@earendil-works/pi-coding-agent'])expect(pkg.dependencies[name]).toBe('1.0.3');
 // Parse Bun's JSON-with-trailing-delimiters lock and inspect package values.
 const parsed=JSON.parse(lock.replace(/,\s*([}\]])/g,'$1'));
 const family=['chord','pi-agent-core','pi-ai','pi-codemode','pi-coding-agent','pi-mcp','pi-telemetry','pi-tui'].map(name=>'@earendil-works/'+name);
 const resolved=Object.values(parsed.packages).map((entry:any)=>entry[0] as string).filter(id=>family.some(name=>id.startsWith(name+'@')));
 expect(resolved.sort()).toEqual(family.map(name=>name+'@1.0.3').sort());
 expect(parsed.workspaces[''].dependencies['@earendil-works/chord']).toBe('1.0.3');
 expect(pkg.dependencies['pi-mcp-adapter']).toBe('github:piclaw-bot/pi-mcp-adapter#dddfcf630508f42c169889c11dee94e69b746e7c');
 const session=readFileSync(resolve(root,'runtime/src/agent-pool/session.ts'),'utf8');expect(session).toContain('initializeOnLoad: false');expect(session).toContain('resolveRuntimeEnv');
 for(const factory of ['createMcpExtension','createToolSearchExtension','createCodemodeExtension'])expect(session).not.toContain(factory);
 expect(typeof createMcpExtension).toBe('function');expect(typeof createToolSearchExtension).toBe('function');expect(typeof createCodemodeExtension).toBe('function');
});
test('GPT-6.1 Sol is present only in the admitted provider catalogue entries',()=>{
 // Measured from the SDK1.5.1 public built-in catalogue.
 for(const [provider,contextWindow] of [['openai',272000],['azure',1050000],['openai-codex',500000]] as const){
  const model=getBuiltinModels(provider).find(entry=>entry.id==='gpt-6.1-sol');expect(model,`${provider}/gpt-6.1-sol`).toBeDefined();expect(isModelType(model!,'chat')).toBe(true);expect(model).toMatchObject({reasoning:true,contextWindow,maxTokens:128000,input:['text','image']});
 }
 expect(getBuiltinModels('anthropic').some(model=>model.id==='gpt-6.1-sol')).toBe(false);
});
test('published OAuth bundle contains the repaired ChatGPT module',async()=>{
 const oauth=resolve(root,'node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-chatgpt.js');expect(existsSync(oauth)).toBe(true);expect(readFileSync(resolve(root,'node_modules/@earendil-works/pi-ai/dist/bun-oauth.js'),'utf8')).toContain('./auth/oauth/openai-chatgpt.js');
 const bundled=await import('@earendil-works/pi-ai/bun-oauth');expect(()=>bundled.registerBunOAuthFlows()).not.toThrow();
});
test('Harness/Pico3 activation and Piclaw service-effect ownership remain unchanged',()=>{
 expect(historicalHarnessEvidence.authority.currentRuntimeVersion).toBe('0.99.1'); // Frozen as-of evidence, not installed target.
 expect(historicalHarnessEvidence.authority.harnessActivation).toBe('latent_only');
 expect(historicalHarnessEvidence.experimentalPico3.productionImport).toBe(false);expect(historicalHarnessEvidence.experimentalPico3.productionActivation).toBe(false);
 expect(historicalHarnessEvidence.currentRuntime.productionImport).toBe(false);expect(historicalHarnessEvidence.currentRuntime.productionActivation).toBe(false);
 const session=readFileSync(resolve(root,'runtime/src/agent-pool/session.ts'),'utf8');expect(session).not.toMatch(/AgentHarness|Pico3/);
});
