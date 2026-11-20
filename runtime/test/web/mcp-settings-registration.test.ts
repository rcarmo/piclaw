import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dir,'../..'),text=(path:string)=>readFileSync(resolve(root,path),'utf8');
test('Classic registers native MCP and independent optimisation using existing lazy settings panes',()=>{
 const classic=text('web/src/components/settings-dialog.ts');
 expect(classic).toContain("id: 'mcp', label: 'MCP'");expect(classic).toContain("import('./settings/mcp.js').then(mod => mod.McpSection)");expect(classic).toContain("case 'mcp': return html`<${Comp} />`");
 expect(classic).toContain("id: 'optimizer', label: 'Optimisation'");expect(classic).toContain("import('./settings/optimizer.js').then(mod => mod.OptimizerSection)");expect(classic).toContain('order: 31.5');
 const mcp=text('web/src/components/settings/mcp.ts'),optimizer=text('web/src/components/settings/optimizer.ts');
 for(const legacy of ['Engine to preview','Preview compatibility','Apply MCP settings','acknowledgeInterruptions','createMcpSettingsController','/servers/preview'])expect(mcp).not.toContain(legacy);
 expect(mcp).toContain('/agent/settings/mcp');expect(mcp).toContain('expectedRevision:');expect(mcp).toContain('approveCredentialReuse: false');expect(mcp).toContain('hasSavedCredentials');
 expect(optimizer).toContain('/agent/addons/api/token-optimizer/config');expect(optimizer).toContain('policy.oversightMode');expect(optimizer).toContain('policy.sharePlanWithJudge');
 const locales=text('web/src/utils/i18n.ts');expect((locales.match(/'settings\.section\.mcp': 'MCP'/g)||[]).length).toBe(3);expect((locales.match(/'settings\.section\.optimizer':/g)||[]).length).toBe(3);
});
