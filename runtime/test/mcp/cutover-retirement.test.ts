import {expect,test} from 'bun:test';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dir,'../../..');
test('outbound MCP has one SDK composition and no obsolete engine, ambient hydration or hidden fallback',()=>{
 const retired=[
  'runtime/durable-engine/src/host-mcp.ts',
  ...['bridge-owner','codemode-runtime','engine-plan','engine-policy','engine-switch','native-header-policy','native-http','native-owner','native-stdio','native-transport'].map(name=>'runtime/src/agent-pool/mcp-'+name+'.ts'),
  'runtime/src/secure/mcp-keychain.ts','runtime/src/secure/mcp-server-edits.ts','runtime/src/core/config-mcp.ts',
  ...['runtime-policy','status-hint-adapter','timeout-patch'].map(name=>'runtime/src/extensions/mcp-'+name+'.ts'),
  'runtime/src/channels/web/handlers/mcp-settings.ts','runtime/web/src/components/settings/mcp-servers.ts',
  ...['mcp-server-form','mcp-server-settings-model','mcp-settings-model'].map(name=>'runtime/web/src/ui/'+name+'.ts'),
 ];
 for(const path of retired)expect(existsSync(resolve(root,path)),path).toBe(false);
 const source=(path:string)=>readFileSync(resolve(root,path),'utf8');
 const application=source('runtime/durable-engine/src/default-application-runtime.ts');expect(application).toContain('createApplicationOptimizerMcp');expect(application).toContain('createOptimizerCodemodeTool');
 for(const path of ['runtime/src/runtime/bootstrap.ts','runtime/src/runtime/startup.ts','runtime/src/agent-pool/service-factory.ts','runtime/src/agent-pool.ts'])expect(source(path)).not.toMatch(/hydrateMcp|clearMcpCredentials|McpCodemodeController|createHostMcp|applyMcpSettings/);
 expect(source('runtime/src/channels/web/agent/agent-status.ts')).not.toContain('secure/mcp-keychain');
 expect(source('runtime/durable-engine/src/mcp/legacy-config.ts')).toContain('Read-only, one-shot migration parser');
 // Historical fixtures and as-of SDK receipts are evidence, not execution fallbacks.
 expect(existsSync(resolve(root,'runtime/test/fixtures/retired-session-composition.json'))).toBe(true);
 expect(existsSync(resolve(root,'docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-harness-compatibility-schema6.json'))).toBe(true);
});
