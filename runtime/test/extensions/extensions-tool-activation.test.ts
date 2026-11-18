import '../helpers.js';
import {expect,test} from 'bun:test';
import {existsSync,readFileSync} from 'node:fs';
import {createBuiltinExtensionFactories} from '../../src/extensions/index.js';
import {TOOLSETS,getToolsetsForTool,getToolCapability} from '../../src/extensions/tool-capabilities.js';
import {TOOL_PREPARATION_MANIFEST} from '../../src/service-effects/tool-preparation/manifest.js';
import {createFakeExtensionApi} from './fake-extension-api.js';

const retired=['activate_tools','reset_active_tools'];
test('manual activation has no implementation, declaration, preparation policy or default-list config',()=>{
 expect(existsSync(new URL('../../src/extensions/tool-activation.ts',import.meta.url))).toBe(false);
 const config=readFileSync(new URL('../../src/core/config-tools.ts',import.meta.url),'utf8');
 for(const name of ['getToolActivationConfig','TOOL_ACTIVATION_CONFIG','additionalDefaultTools','additional_default_tools','PICLAW_ADDITIONAL_DEFAULT_TOOLS'])expect(config).not.toContain(name);
 for(const name of retired){expect(TOOLSETS.flatMap(group=>group.toolNames)).not.toContain(name);expect(TOOL_PREPARATION_MANIFEST.map(row=>row.toolName)).not.toContain(name);expect(getToolsetsForTool(name)).toEqual([]);expect(getToolCapability(name)).toEqual(getToolCapability('unregistered-tool'));}
});
test('built-in registration and discovery leave the SDK tool filter unchanged',async()=>{
 const baseline=['read','plan'],fake=createFakeExtensionApi({activeTools:baseline});let mutations=0;
 fake.api.setActiveTools=()=>{mutations++;throw Error('Retired host selector attempted to override SDK restrictions');};
 for(const factory of createBuiltinExtensionFactories())factory(fake.api);
 for(const name of retired)expect(fake.tools.has(name)).toBe(false);
 const profile=readFileSync(new URL('../../src/extensions/local-lite-prompt-profile.ts',import.meta.url),'utf8');
 expect(profile).not.toContain('setActiveTools');expect(profile).not.toContain('previousActiveTools');
 expect(fake.api.getActiveTools()).toEqual(baseline);expect(mutations).toBe(0);
 const discovery=fake.tools.get('list_tools');expect(discovery).toBeDefined();
 const result=await discovery.execute('catalogue',{});expect(JSON.stringify(result)).not.toContain('"activation":');expect(fake.api.getActiveTools()).toEqual(baseline);expect(mutations).toBe(0);
});
