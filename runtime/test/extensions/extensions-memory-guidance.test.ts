import '../helpers.js';
import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {createFakeExtensionApi} from './fake-extension-api.js';
import {createMemorySearchExtension} from '../../src/extensions/memory-search.js';

test('recall guidance is opt-in tool metadata, not a preflight or bootstrap hook',()=>{
 const fake=createFakeExtensionApi();createMemorySearchExtension('web:guidance')(fake.api);
 expect([...fake.tools.keys()]).toEqual(['memory_query','memory_get']);
 expect(fake.handlers.map(h=>h.event)).toEqual(['session_start','session_shutdown']);
 expect(fake.handlers.some(h=>h.event==='before_agent_start')).toBe(false);
 const query=fake.tools.get('memory_query').promptGuidelines.join('\n');
 const get=fake.tools.get('memory_get').promptGuidelines.join('\n');
 for(const token of ['MEMORY.md','notes/index.md','search_workspace','chunk_id','source_revision','line range','parent','untrusted','partial','contradicted','unrecorded','no','single-user'])expect(query.toLowerCase()).toContain(token.toLowerCase());
 for(const token of ['source_stale','not_found','access_denied','index_unavailable','source_unavailable','limit_exceeded','cancelled','not a no-answer','untrusted'])expect(get).toContain(token);
});

test('existing startup maps and generic workspace search retain their independent entrypoints',()=>{
 const bootstrap=readFileSync(new URL('../../src/extensions/workspace-memory-bootstrap.ts',import.meta.url),'utf8');
 expect(bootstrap).toContain('"notes/memory/MEMORY.md"');expect(bootstrap).toContain('"notes/index.md"');
 expect(bootstrap).not.toContain('memory_query');expect(bootstrap).not.toContain('memory_get');
 const generic=readFileSync(new URL('../../src/extensions/workspace-search.ts',import.meta.url),'utf8');
 expect(generic).toContain('name: "search_workspace"');expect(generic).not.toContain('memory_query');
});

test('calling a tool without admitted session refuses before executing note instructions or selectors',async()=>{
 const fake=createFakeExtensionApi({activeTools:['memory_query','memory_get']});createMemorySearchExtension('web:guidance')(fake.api);
 let touched=false;const params=new Proxy({}, {get(){touched=true;throw Error('read selector');},ownKeys(){touched=true;throw Error('inspect selector');}});
 for(const name of ['memory_query','memory_get']){
  const r=await fake.tools.get(name).execute('test',params,undefined,undefined,undefined);
  expect(JSON.parse(r.content[0].text)).toEqual({status:'access_denied'});
 }
 expect(touched).toBe(false);
});
