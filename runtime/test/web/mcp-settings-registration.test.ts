import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dir,'../..'),text=(path:string)=>readFileSync(resolve(root,path),'utf8');
test('Classic registers native MCP in the existing lazy Settings pane, with no optimiser settings',()=>{
 const classic=text('web/src/components/settings-dialog.ts');
 expect(classic).toContain("id: 'mcp', label: 'MCP'");expect(classic).toContain("import('./settings/mcp.js').then(mod => mod.McpSection)");expect(classic).toContain("case 'mcp': return html`<${Comp} />`");
 expect(classic).not.toMatch(/Settings\/optimizer|id: 'optimizer'|case 'optimizer'/i);
 const mcp=text('web/src/components/settings/mcp.ts');
 for(const legacy of ['Engine to preview','Preview compatibility','Apply MCP settings','acknowledgeInterruptions','createMcpSettingsController','/servers/preview'])expect(mcp).not.toContain(legacy);
 expect(mcp).toContain('/agent/settings/mcp');expect(mcp).toContain('expectedRevision:');expect(mcp).toContain('approveCredentialReuse: false');expect(mcp).toContain('hasSavedCredentials');
 const locales=text('web/src/utils/i18n.ts');expect((locales.match(/'settings\.section\.mcp': 'MCP'/g)||[]).length).toBe(3);expect(locales).not.toContain('settings.section.optimizer');
});
