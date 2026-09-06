import { beforeAll, afterAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { join } from "node:path";
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import type { SessionSettings } from '../../src/core/session-settings.js';
import type { AdministrationSettings } from '../../src/core/administration-settings.js';
import { FAMILY_WEB_TOOLS, type FamilyWorkspacePolicy } from '../../src/core/family-workspace-policy.js';

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
let browser: Browser, server: ReturnType<typeof Bun.serve>, base: string;
const principal = (name = "alice", login = "login-a") => ({ principal: { kind: "user", mode: "family-shared", role: "member", userId: name, username: name, displayName: name, homeChatJid: `web:${name}`, authentication: { sessionId: login } }, capabilities: { manage_users: false } });
const posts = (content = "Alice private text") => ({ posts: [{ id: 1, timestamp: "today", data: { content, sender_name: "Alice" } }], has_more: false });
async function fixture(page: Page) {
  const state = { identity: principal(), calls: [] as Array<{ path: string; headers: Record<string, string>; body: any }> };
  await page.route("**/auth/me", route => route.fulfill({ json: state.identity }));
  await page.route('**/account/avatar', route => route.fulfill({ json: { user_id: state.identity.principal.userId, revision: 0, present: false, can_edit: true } }));
  await page.route('**/account/model-defaults', route => route.fulfill({ json: modelDefaultsSnapshot() }));
  await page.route('**/account/preferences', route => route.fulfill({ json: { user_id: state.identity.principal.userId, preferences: { revision: 0, theme: 'system', response_guidance: '' }, defaults: { theme: 'system', response_guidance: '' }, can_edit: true } }));
  await page.route("**/agent/message-recovery?**", route => route.fulfill({ json: { state: 'idle' } }));
  await page.route("**/agent/branches", route => route.fulfill({ json: { branches: [{ chat_jid: "web:alice", root_chat_jid: "web:alice", agent_name: "home" }, { chat_jid: "web:alice-two", root_chat_jid: "web:alice-two", agent_name: "second" }] } }));
  await page.route("**/timeline?**", route => { state.calls.push({ path: route.request().url(), headers: route.request().headers(), body: null }); return route.fulfill({ json: posts() }); });
  return state;
}
async function ready(page: Page) { await page.waitForFunction(() => document.getElementById("timeline")?.textContent?.includes("Alice private text")); }
function resultList(items: any[] = [{execution_id:'execution-one',chat_jid:'web:alice-two',created_at:1780000000000,state:'settled',publication_recorded:false}]) {
  return {owner_user_id:'alice',window_size:50,items};
}
function resultDetail(id='execution-one',chat='web:alice-two',text='<img src=x onerror=alert(1)> PRIVATE_RESULT') {
  return {execution_id:id,chat_jid:chat,owner_user_id:'alice',state:'settled',publication_recorded:false,result:{status:'success',text,created_at:1780000000000}};
}
beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/" || path === "/index.html") return new Response(Bun.file(join(import.meta.dir, "../../web/static/family.html")), { headers: { "Content-Type": "text/html" } });
    if (["/static/common/dist/family.bundle.js", "/static/common/dist/family.bundle.css"].includes(path)) return new Response(Bun.file(join(import.meta.dir, "../../web/static", path.slice(8))));
    if (path === "/login" || path === "/blank") return new Response("<!doctype html><p>Sign in</p>", { headers: { "Content-Type": "text/html" } });
    if (path === "/old-sw.js") return new Response("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));", { headers: { "Content-Type": "text/javascript" } });
    return new Response("not found", { status: 404 });
  } }); base = `http://localhost:${server.port}`;
});
afterAll(async () => { await browser?.close(); server?.stop(true); });

async function memoryFixture(page:Page){
  const state=await fixture(page),id='11111111-1111-4111-8111-111111111111',key='22222222-2222-4222-8222-222222222222',time='2026-09-06T00:00:00.000Z';
  const source={chat_jid:'web:alice',message_rowid:1,message_id:'message-one'};
  const preview={...source,source_hash:'a'.repeat(64),text:'Alice private text\n<img src=x onerror=alert(1)> SHARE\nprivate suffix'};
  const detail={publication_id:id,request_id:key,published_at:time,publisher:{user_id:'alice',username:'alice',display_name:'Alice'},source_kind:'message-excerpt',text:'<img src=x onerror=alert(1)> SHARED_COPY',source:{...source,source_hash:preview.source_hash},withdrawn:false};
  const own={owner_user_id:'alice',window_size:100,items:[{publication_id:id,request_id:key,published_at:time,withdrawn:false}]};
  const sent:any[]=[],previews:any[]=[],withdrawals:any[]=[];
  await page.route('**/timeline?**',r=>r.fulfill({json:{posts:[{id:1,data:{content:'Alice private text'},memory_source:source}],has_more:false}}));
  await page.route('**/agent/family-memory/own',r=>r.fulfill({json:own}));
  await page.route('**/agent/family-memory/shared',r=>r.fulfill({json:{window_size:20,items:[detail]}}));
  await page.route('**/agent/family-memory/preview',r=>{previews.push(r.request().postDataJSON());return r.fulfill({json:preview});});
  await page.route('**/agent/family-memory',r=>{sent.push({body:r.request().postDataJSON(),headers:r.request().headers()});return r.fulfill({json:{publication_id:id,request_id:r.request().postDataJSON().request_id,created:true}});});
  await page.route(`**/agent/family-memory/${id}`,r=>r.fulfill({json:detail}));
  await page.route(`**/agent/family-memory/${id}/withdraw`,r=>{withdrawals.push({body:r.request().postDataJSON(),headers:r.request().headers()});detail.withdrawn=true;return r.fulfill({json:{publication_id:id,withdrawn:true,created:true}});});
  return {state,id,key,source,preview,detail,own,sent,previews,withdrawals};
}
async function memoryDraft(page:Page){await page.getByRole('button',{name:'Preview for family memory',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('memory-form')?.hidden);await page.locator('#memory-excerpt').fill('SHARE');}
async function inspectMemory(page:Page){await page.locator('#refresh-memory').click();await page.getByRole('button',{name:'Inspect memory',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('memory-detail')?.hidden);}

browserTest('memory publication previews exact source, requires verbatim confirmed excerpt and renders reference text safely',async()=>{
  const page=await browser.newPage({viewport:{width:375,height:800}});
  try{const f=await memoryFixture(page);await page.goto(base);await ready(page);expect(f.sent).toHaveLength(0);await memoryDraft(page);
    expect(f.previews).toEqual([f.source]);expect(await page.locator('#memory-source-text').textContent()).toContain('<img');expect(await page.locator('#family-memory img').count()).toBe(0);
    expect(await page.locator('#publish-memory').isDisabled()).toBe(true);await page.locator('#confirm-memory-publication').check();await page.locator('#memory-excerpt').fill('generated summary');expect(await page.locator('#publish-memory').isDisabled()).toBe(true);
    await page.locator('#confirm-memory-publication').check();await page.locator('#publish-memory').click();expect(f.sent).toHaveLength(0);expect(await page.locator('#memory-status').textContent()).toContain('verbatim');
    await page.locator('#memory-excerpt').fill('SHARE');await page.locator('#confirm-memory-publication').check();await page.locator('#publish-memory').click();await page.waitForFunction(()=>document.getElementById('memory-status')?.textContent?.includes('Memory published'));
    expect(f.sent).toHaveLength(1);expect(f.sent[0].body).toEqual({...f.source,source_hash:f.preview.source_hash,text:'SHARE',request_id:expect.any(String),confirm:true});expect(f.sent[0].headers).toMatchObject({'content-type':'application/json','x-piclaw-account-id':'alice','x-piclaw-login-id':'login-a'});
    expect(await page.locator('#memory-excerpt').inputValue()).toBe('');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
  }finally{await page.close();}
},20000);

browserTest('memory uncertain retries retain exact identity, lock excerpt and require fresh manual confirmation',async()=>{
  const page=await browser.newPage();try{await memoryFixture(page);const sent:any[]=[];await page.route('**/agent/family-memory',r=>{const p=r.request().postDataJSON();sent.push(p);return r.fulfill(sent.length===1?{status:500,json:{}}:sent.length===2?{json:{request_id:'wrong',publication_id:'wrong',created:true}}:{json:{request_id:p.request_id,publication_id:'11111111-1111-4111-8111-111111111111',created:false}});});
    await page.goto(base);await ready(page);await memoryDraft(page);
    for(let i=1;i<=3;i++){await page.locator('#confirm-memory-publication').check();await page.locator('#publish-memory').click();await page.waitForFunction(()=>!(document.getElementById('send-message') as HTMLButtonElement).disabled);expect(sent).toHaveLength(i);expect(await page.locator('#publish-memory').isDisabled()).toBe(true);
      if(i<3){expect(await page.locator('#memory-excerpt').isDisabled()).toBe(true);expect(await page.locator('#publish-memory').textContent()).toBe('Retry same memory publication');await page.locator('#open-memory').click();}}
    expect(sent[0]).toEqual(sent[1]);expect(sent[1]).toEqual(sent[2]);expect(await page.locator('#memory-status').textContent()).toContain('Publication verified');
  }finally{await page.close();}
},20000);

browserTest('memory receipt and shared copy views are separate and withdrawal is explicit and owner-correlated',async()=>{
  const page=await browser.newPage();try{const f=await memoryFixture(page);await page.goto(base);await ready(page);await page.locator('#open-memory').click();await inspectMemory(page);
    expect(await page.locator('#withdraw-memory').isDisabled()).toBe(true);expect(await page.locator('#memory-detail-text').textContent()).toContain('SHARED_COPY');expect(await page.locator('#family-memory img').count()).toBe(0);
    await page.locator('#confirm-memory-withdrawal').check();await page.locator('#withdraw-memory').click();await page.waitForFunction(()=>document.getElementById('memory-status')?.textContent?.includes('withdrawal verified'));expect(f.withdrawals).toHaveLength(1);expect(f.withdrawals[0].body).toEqual({confirm:true});
    await inspectMemory(page);expect(await page.locator('#confirm-memory-withdrawal').isDisabled()).toBe(true);await page.locator('#shared-memory').click();await page.waitForFunction(()=>document.getElementById('memory-status')?.textContent?.includes('Newest 20'));
    expect(await page.locator('#memory-list').textContent()).toContain('Published by Alice');expect(await page.locator('#memory-list').textContent()).not.toContain('message-one');expect(await page.locator('#memory-form').isVisible()).toBe(false);expect(await page.locator('#memory-detail').isVisible()).toBe(false);expect(f.sent).toHaveLength(0);
  }finally{await page.close();}
},20000);

browserTest('memory drafts confirmations and retry keys clear on discard refresh sharedview inspection close blur session switch and navigation',async()=>{
  const page=await browser.newPage();try{await memoryFixture(page);const sent:any[]=[];await page.route('**/agent/family-memory',r=>{sent.push(r.request().postDataJSON());return r.fulfill({status:500,json:{}});});await page.goto(base);await ready(page);
    for(const action of ['discard','refresh','shared','inspect','close','blur','session','navigation']){
      if(action==='session')await page.locator('#session-select').selectOption('web:alice');await memoryDraft(page);await page.locator('#confirm-memory-publication').check();await page.locator('#publish-memory').click();await page.waitForFunction(()=>!(document.getElementById('send-message') as HTMLButtonElement).disabled);
      if(action==='discard')await page.locator('#discard-memory').click();if(action==='refresh')await page.locator('#refresh-memory').click();if(action==='shared')await page.locator('#shared-memory').click();if(action==='inspect')await inspectMemory(page);
      if(action==='close'){await page.locator('#close-memory').click();await page.locator('#open-memory').click();}
      if(action==='blur'){await page.evaluate(()=>dispatchEvent(new Event('blur')));expect(await page.locator('#memory-excerpt').inputValue()).toBe('');await page.evaluate(()=>dispatchEvent(new Event('focus')));await ready(page);}
      if(action==='session'){await page.locator('#session-select').selectOption('web:alice-two');await ready(page);await page.locator('#session-select').selectOption('web:alice');await ready(page);}
      if(action==='navigation')await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));
      expect(await page.locator('#memory-excerpt').inputValue()).toBe('');expect(await page.locator('#confirm-memory-publication').isChecked()).toBe(false);expect(await page.locator('#publish-memory').textContent()).toBe('Publish memory');
    }expect(new Set(sent.map(v=>v.request_id)).size).toBe(sent.length);
  }finally{await page.close();}
},30000);

browserTest('memory rejects mismatched source/history/receipt responses and clears stale account data',async()=>{
  const page=await browser.newPage();try{const f=await memoryFixture(page);await page.goto(base);await ready(page);f.preview.message_id='wrong';await page.getByRole('button',{name:'Preview for family memory',exact:true}).click();await page.waitForFunction(()=>document.getElementById('memory-status')?.textContent==='Invalid memory source response.');expect(await page.locator('#memory-form').isVisible()).toBe(false);
    f.own.owner_user_id='bob';await page.locator('#refresh-memory').click();await page.waitForFunction(()=>document.getElementById('memory-status')?.textContent==='Invalid memory list.');expect(await page.locator('#memory-list').textContent()).toBe('');
    f.own.owner_user_id='alice';f.detail.publisher.user_id='bob';await page.locator('#refresh-memory').click();await page.getByRole('button',{name:'Inspect memory',exact:true}).click();await page.waitForFunction(()=>document.getElementById('memory-status')?.textContent==='Invalid memory receipt.');expect(await page.locator('#withdraw-memory').isDisabled()).toBe(true);
    f.preview.message_id='message-one';await memoryDraft(page);f.state.identity=principal('bob','login-b');await page.locator('#confirm-memory-publication').check();await page.locator('#publish-memory').click();await page.waitForFunction(()=>document.getElementById('family-status')?.textContent?.includes('no longer bound'));expect(await page.locator('#family-memory').isVisible()).toBe(false);expect(await page.locator('#memory-excerpt').inputValue()).toBe('');
  }finally{await page.close();}
},20000);

browserTest('memory pending publication is single-flight and late response cannot restore a closed panel',async()=>{
  const page=await browser.newPage();let release=()=>{};try{const f=await memoryFixture(page);let entered!:()=>void;const waiting=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);let sends=0;
    await page.route('**/agent/family-memory',async r=>{sends++;entered();await held;await r.fulfill({json:{publication_id:f.id,request_id:r.request().postDataJSON().request_id,created:true}});});await page.goto(base);await ready(page);await memoryDraft(page);await page.locator('#confirm-memory-publication').check();await page.locator('#publish-memory').click();await waiting;
    expect(await page.locator('#send-message').isDisabled()).toBe(true);await page.locator('#refresh-memory').click();expect(sends).toBe(1);await page.locator('#close-memory').click();release();await page.waitForFunction(()=>!(document.getElementById('send-message') as HTMLButtonElement).disabled);expect(await page.locator('#family-memory').isVisible()).toBe(false);expect(await page.locator('#memory-source-text').textContent()).toBe('');
  }finally{release();await page.close();}
},20000);

browserTest('memory withdrawal remains reachable after blur during a held send without releasing its lock',async()=>{
  const page=await browser.newPage();let release=()=>{};try{const f=await memoryFixture(page);let entered!:()=>void;const waiting=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);
    await page.route('**/agent/default/message?**',async r=>{entered();await held;await r.fulfill({json:{ok:true}});});await page.goto(base);await ready(page);await page.locator('#open-memory').click();await inspectMemory(page);
    await page.locator('#message-text').fill('held message');await page.locator('#send-message').click();await waiting;await page.evaluate(()=>dispatchEvent(new Event('blur')));await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.waitForFunction(()=>!document.getElementById('family-memory')?.hidden);
    expect(await page.locator('#memory-detail-text').textContent()).toBe('');await inspectMemory(page);await page.locator('#confirm-memory-withdrawal').check();await page.locator('#withdraw-memory').click();await page.waitForFunction(()=>document.getElementById('memory-status')?.textContent?.includes('withdrawal verified'));expect(f.withdrawals).toHaveLength(1);expect(await page.locator('#send-message').isDisabled()).toBe(true);release();await page.waitForFunction(()=>!(document.getElementById('send-message') as HTMLButtonElement).disabled);
  }finally{release();await page.close();}
},20000);

browserTest('memory rejects oversized preview or excerpts and duplicate shared/history identities without partial rendering',async()=>{
  const page=await browser.newPage();try{const f=await memoryFixture(page);await page.goto(base);await ready(page);f.preview.text='x'.repeat(102401);await page.getByRole('button',{name:'Preview for family memory',exact:true}).click();await page.waitForFunction(()=>document.getElementById('memory-status')?.textContent==='Invalid memory source response.');
    f.preview.text='é'.repeat(8193);await memoryDraft(page);await page.locator('#memory-excerpt').fill(f.preview.text);await page.locator('#confirm-memory-publication').check();await page.locator('#publish-memory').click();expect(f.sent).toHaveLength(0);expect(await page.locator('#memory-status').textContent()).toContain('16 KiB');
    f.own.items.push({...f.own.items[0]!});await page.locator('#refresh-memory').click();await page.waitForFunction(()=>document.getElementById('memory-status')?.textContent==='Invalid memory metadata.');expect(await page.locator('#memory-list').textContent()).toBe('');
    await page.route('**/agent/family-memory/shared',r=>r.fulfill({json:{window_size:20,items:[f.detail,{...f.detail}]}}));await page.locator('#shared-memory').click();await page.waitForFunction(()=>document.getElementById('memory-status')?.textContent==='Invalid memory metadata.');expect(await page.locator('#memory-list').textContent()).toBe('');
  }finally{await page.close();}
},20000);

browserTest('memory armed publication is disarmed by unrelated send and does not become enabled until reconfirmed',async()=>{
  const page=await browser.newPage();let release=()=>{};try{const f=await memoryFixture(page);let entered!:()=>void;const waiting=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);
    await page.route('**/agent/default/message?**',async r=>{entered();await held;await r.fulfill({json:{ok:true}});});await page.goto(base);await ready(page);await memoryDraft(page);await page.locator('#confirm-memory-publication').check();
    await page.locator('#message-text').fill('held');await page.locator('#send-message').click();await waiting;expect(await page.locator('#confirm-memory-publication').isChecked()).toBe(false);expect(await page.locator('#confirm-memory-publication').isDisabled()).toBe(true);expect(f.sent).toHaveLength(0);release();await page.waitForFunction(()=>!(document.getElementById('send-message') as HTMLButtonElement).disabled);
    expect(await page.locator('#publish-memory').isDisabled()).toBe(true);expect(await page.locator('#confirm-memory-publication').isDisabled()).toBe(false);expect(f.sent).toHaveLength(0);
  }finally{release();await page.close();}
},20000);

async function taskFixture(page:Page) {
  const state=await fixture(page),requests:Array<{body:any;headers:Record<string,string>}>=[];
  const item={grant_id:'grant-one',task_id:'task-one',chat_jid:'web:alice-two',created_at:'2026-09-06T00:00:00.000Z',revoked:false};
  const directory={owner_user_id:'alice',window_size:50,activation_available:false,items:[item]};
  const detail={...item,activation_available:false,preparation:{prompt:'<img src=x onerror=alert(1)> PRIVATE_TASK',scheduled_for:'2026-09-07T12:00:00.000Z',allowed_tools:['read'],state:'paused'}};
  await page.route('**/agent/scheduled-tasks',r=>{if(r.request().method()==='POST'){requests.push({body:r.request().postDataJSON(),headers:r.request().headers()});return r.fulfill({json:{request_id:r.request().postDataJSON().request_id,task_id:'task-new',grant_id:'grant-new',created:true,state:'paused'}});}return r.fulfill({json:directory});});
  await page.route('**/agent/scheduled-tasks/grant-one',r=>r.fulfill({json:detail}));
  await page.route('**/account/workspace',r=>r.fulfill({json:{user_id:'alice',tools:{policy:'fixed-family-web-preview',allowed:['read','messages']}}}));
  return {state,requests,directory,detail};
}
async function openTasks(page:Page){await page.goto(base);await ready(page);await page.locator('#open-tasks').click();await page.waitForFunction(()=>!document.getElementById('prepare-task-form')?.hidden);}
async function taskDraft(page:Page){await page.locator('#task-target').selectOption('web:alice-two');await page.locator('#task-prompt').fill('Exact task prompt\nline two ');const due=new Date(Date.now()+86400000).toISOString().slice(0,16);await page.locator('#task-due').fill(due);return due;}

async function runFixture(page:Page){
  const f=await taskFixture(page),runs:any[]=[];f.detail.preparation.scheduled_for=new Date(Date.now()-60000).toISOString();
  await page.route('**/agent/scheduled-tasks/grant-one/run',r=>{const body=r.request().postDataJSON();runs.push({body,headers:r.request().headers()});return r.fulfill({json:{grant_id:'grant-one',execution_id:'execution-one',request_id:body.request_id,state:'admitted',created:true}});});
  return {...f,runs};
}
async function inspectRun(page:Page){await page.getByRole('button',{name:'Inspect task',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('scheduled-task-detail')?.hidden);}

browserTest('due task run requires separate confirmation, exact pinned request and displays admission without success claim',async()=>{
  const page=await browser.newPage({viewport:{width:375,height:740}});
  try{const f=await runFixture(page);await openTasks(page);expect(f.runs).toHaveLength(0);expect(await page.locator('#scheduled-task-run').isVisible()).toBe(false);
    await inspectRun(page);expect(await page.locator('#run-task').isDisabled()).toBe(true);expect(await page.locator('#confirm-task-run').isChecked()).toBe(false);expect(await page.locator('#scheduled-task-text').textContent()).toContain('PRIVATE_TASK');
    await page.locator('#confirm-task-run').check();await page.locator('#run-task').click();await page.waitForFunction(()=>document.getElementById('scheduled-tasks-status')?.textContent?.includes('Execution admitted: execution-one'));
    expect(f.runs).toHaveLength(1);expect(Object.keys(f.runs[0].body).sort()).toEqual(['confirm','request_id']);expect(f.runs[0].body.confirm).toBe(true);expect(f.runs[0].headers).toMatchObject({'x-piclaw-account-id':'alice','x-piclaw-login-id':'login-a','content-type':'application/json'});
    expect(await page.locator('#scheduled-tasks-status').textContent()).toContain('does not confirm model start or success');expect(await page.locator('#confirm-task-run').isDisabled()).toBe(true);expect(await page.locator('#run-task').isDisabled()).toBe(true);
    expect(await page.locator('#session-select').inputValue()).toBe('web:alice');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
  }finally{await page.close();}
},20000);

browserTest('not-due, revoked, malformed and wrong-target details cannot authorise a run',async()=>{
  const page=await browser.newPage();
  try{const f=await runFixture(page);f.detail.preparation.scheduled_for=new Date(Date.now()+86400000).toISOString();await openTasks(page);await inspectRun(page);expect(await page.locator('#scheduled-task-run').isVisible()).toBe(false);
    f.detail.preparation.scheduled_for='invalid';await page.getByRole('button',{name:'Inspect task',exact:true}).click();await page.waitForFunction(()=>document.getElementById('scheduled-tasks-status')?.textContent==='Invalid task detail.');expect(await page.locator('#run-task').isDisabled()).toBe(true);
    f.detail.preparation.scheduled_for=new Date(Date.now()-60000).toISOString();f.detail.chat_jid='web:bob';await page.getByRole('button',{name:'Inspect task',exact:true}).click();await page.waitForFunction(()=>document.getElementById('scheduled-tasks-status')?.textContent==='Invalid task detail.');
    f.detail.chat_jid='web:alice-two';f.detail.revoked=true;f.detail.preparation=null as any;await inspectRun(page);expect(await page.locator('#confirm-task-run').isDisabled()).toBe(true);expect(f.runs).toHaveLength(0);
  }finally{await page.close();}
},20000);

browserTest('uncertain and mismatched run receipts preserve exact retry ID and require manual reconfirmation',async()=>{
  const page=await browser.newPage();
  try{await runFixture(page);const sent:any[]=[];
    await page.route('**/agent/scheduled-tasks/grant-one/run',r=>{const body=r.request().postDataJSON();sent.push(body);return r.fulfill(sent.length===1?{status:500,json:{}}:sent.length===2?{json:{request_id:'different',grant_id:'grant-one',execution_id:'execution-one',created:true,state:'admitted'}}:{json:{request_id:body.request_id,grant_id:'grant-one',execution_id:'execution-one',created:false,state:'admitted'}});});
    await openTasks(page);await inspectRun(page);
    for(let i=1;i<=3;i++){
      await page.locator('#confirm-task-run').check();await page.locator('#run-task').click();await page.waitForFunction(()=>!(document.getElementById('send-message') as HTMLButtonElement).disabled);
      expect(sent).toHaveLength(i);expect(await page.locator('#run-task').isDisabled()).toBe(true);
      if(i<3){expect(await page.locator('#run-task').textContent()).toBe('Retry same run request');expect(await page.locator('#scheduled-tasks-status').textContent()).toContain('Admission may have completed');await page.locator('#open-tasks').click();}
    }
    expect(sent[1]).toEqual(sent[0]);expect(sent[2]).toEqual(sent[0]);expect(await page.locator('#scheduled-tasks-status').textContent()).toContain('Admission verified: execution-one');
  }finally{await page.close();}
},20000);

browserTest('run confirmation and retry clear on inspection, refresh, close, blur, session change and navigation',async()=>{
  const page=await browser.newPage();
  try{await runFixture(page);const sent:any[]=[];await page.route('**/agent/scheduled-tasks/grant-one/run',r=>{sent.push(r.request().postDataJSON());return r.fulfill({status:500,json:{}});});await openTasks(page);await inspectRun(page);
    for(const action of ['inspect','refresh','close','blur','session','navigation']){
      await page.locator('#confirm-task-run').check();await page.locator('#run-task').click();await page.waitForFunction(()=>document.getElementById('run-task')?.textContent==='Retry same run request');await page.waitForFunction(()=>!(document.getElementById('send-message') as HTMLButtonElement).disabled);
      if(action==='inspect')await inspectRun(page);
      if(action==='refresh'){await page.locator('#refresh-tasks').click();await inspectRun(page);}
      if(action==='close'){await page.locator('#close-tasks').click();await page.locator('#open-tasks').click();await inspectRun(page);}
      if(action==='blur'){await page.evaluate(()=>dispatchEvent(new Event('blur')));await page.evaluate(()=>dispatchEvent(new Event('focus')));await ready(page);await inspectRun(page);}
      if(action==='session'){await page.locator('#session-select').selectOption('web:alice-two');await ready(page);await inspectRun(page);}
      if(action==='navigation')await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));
      expect(await page.locator('#confirm-task-run').isChecked()).toBe(false);expect(await page.locator('#run-task').isDisabled()).toBe(true);expect(await page.locator('#run-task').textContent()).toBe('Run once');
    }
    expect(new Set(sent.map(x=>x.request_id)).size).toBe(sent.length);
  }finally{await page.close();}
},20000);

browserTest('pending run is single-flight, respects shell lock and late response cannot restore a closed panel',async()=>{
  const page=await browser.newPage();let release:()=>void=()=>{};
  try{const f=await runFixture(page);let entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);let sends=0;
    await page.route('**/agent/scheduled-tasks/grant-one/run',async r=>{sends++;entered();await held;await r.fulfill({json:{request_id:r.request().postDataJSON().request_id,grant_id:'grant-one',execution_id:'execution-one',created:true,state:'admitted'}});});
    await openTasks(page);await inspectRun(page);await page.locator('#confirm-task-run').check();await page.locator('#run-task').click();await waiting;
    expect(await page.locator('#send-message').isDisabled()).toBe(true);expect(await page.locator('#confirm-task-run').isDisabled()).toBe(true);await page.locator('#refresh-tasks').click();expect(sends).toBe(1);await page.locator('#close-tasks').click();release();
    await page.waitForFunction(()=>!(document.getElementById('send-message') as HTMLButtonElement).disabled);expect(await page.locator('#scheduled-tasks').isVisible()).toBe(false);await page.locator('#open-tasks').click();await inspectRun(page);expect(await page.locator('#confirm-task-run').isChecked()).toBe(false);expect(sends).toBe(1);expect(f.runs).toHaveLength(0);
  }finally{release();await page.close();}
},20000);

browserTest('changed login during run admission invalidates draft/detail and never displays a receipt',async()=>{
  const page=await browser.newPage();let release:()=>void=()=>{};
  try{const f=await runFixture(page);let entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
    await page.route('**/agent/scheduled-tasks/grant-one/run',async r=>{entered();await held;await r.fulfill({json:{request_id:r.request().postDataJSON().request_id,grant_id:'grant-one',execution_id:'private-execution',created:true,state:'admitted'}});});
    await openTasks(page);await inspectRun(page);await page.locator('#confirm-task-run').check();await page.locator('#run-task').click();await waiting;f.state.identity=principal('bob','login-b');release();
    await page.waitForFunction(()=>document.getElementById('family-status')?.textContent?.includes('no longer bound'));expect(await page.locator('#scheduled-task-text').textContent()).toBe('');expect(await page.locator('#scheduled-tasks-status').textContent()).not.toContain('private-execution');expect(await page.locator('#run-task').isDisabled()).toBe(true);
  }finally{release();await page.close();}
},20000);

browserTest('held send disables and disarms run; cancellation also clears an armed run without acquiring the shell lock',async()=>{
  const page=await browser.newPage();let release:()=>void=()=>{};
  try{const f=await runFixture(page);let entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
    await page.route('**/agent/default/message?**',async r=>{entered();await held;await r.fulfill({json:{ok:true}});});
    await page.route('**/agent/scheduled-results',r=>r.fulfill({json:resultList([{execution_id:'other-execution',chat_jid:'web:alice-two',created_at:1780000000000,state:'unsettled',publication_recorded:false}])}));
    await page.route('**/agent/scheduled-results/other-execution',r=>r.fulfill({json:{...resultDetail('other-execution'),state:'unsettled',result:null}}));
    await page.route('**/agent/scheduled-results/other-execution/cancel',r=>r.fulfill({json:{execution_id:'other-execution',cancelled:true,created:true}}));
    await openTasks(page);await inspectRun(page);await page.locator('#confirm-task-run').check();await page.locator('#message-text').fill('held');await page.locator('#send-message').click();await waiting;
    expect(await page.locator('#confirm-task-run').isChecked()).toBe(false);expect(await page.locator('#confirm-task-run').isDisabled()).toBe(true);expect(await page.locator('#run-task').isDisabled()).toBe(true);
    release();await page.waitForFunction(()=>!(document.getElementById('send-message') as HTMLButtonElement).disabled);await page.locator('#confirm-task-run').check();await page.locator('#open-results').click();await page.getByRole('button',{name:'Inspect result',exact:true}).click();await page.locator('#confirm-execution-cancellation').check();await page.locator('#cancel-execution').click();
    await page.waitForFunction(()=>document.getElementById('scheduled-results-status')?.textContent?.includes('Execution authority cancelled'));expect(await page.locator('#confirm-task-run').isChecked()).toBe(false);expect(await page.locator('#run-task').isDisabled()).toBe(true);expect(f.runs).toHaveLength(0);
  }finally{release();await page.close();}
},20000);

async function cancelFixture(page:Page) {
  const state=await fixture(page),detail={...resultDetail(),state:'unsettled',result:null as any},calls:any[]=[];
  await page.route('**/agent/scheduled-results',r=>r.fulfill({json:resultList([{execution_id:'execution-one',chat_jid:'web:alice-two',created_at:1780000000000,state:'unsettled',publication_recorded:false}])}));
  await page.route('**/agent/scheduled-results/execution-one',r=>r.fulfill({json:detail}));
  await page.route('**/agent/scheduled-results/execution-one/cancel',r=>{calls.push({body:r.request().postDataJSON(),headers:r.request().headers()});detail.state='cancelled';return r.fulfill({json:{execution_id:'execution-one',cancelled:true,created:true}});});
  return {state,detail,calls};
}
async function inspectCancellation(page:Page){await page.getByRole('button',{name:'Inspect result',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('scheduled-result-detail')?.hidden);}
async function openCancellation(page:Page){await page.goto(base);await ready(page);await page.locator('#open-results').click();await inspectCancellation(page);}

browserTest('cancellation panel requires fresh detail and explicit confirmation and sends only pinned exact confirmation',async()=>{
  const page=await browser.newPage({viewport:{width:375,height:740}});
  try{const f=await cancelFixture(page);await openCancellation(page);expect(await page.locator('#cancel-execution').isDisabled()).toBe(true);expect(f.calls).toHaveLength(0);
    expect(await page.locator('#scheduled-result-target').textContent()).toContain('web:alice-two');expect(await page.locator('#scheduled-execution-cancellation').textContent()).toContain('cannot undo earlier effects');
    await page.locator('#confirm-execution-cancellation').check();await page.locator('#cancel-execution').click();await page.waitForFunction(()=>document.getElementById('scheduled-results-status')?.textContent?.includes('Execution authority cancelled'));
    expect(f.calls).toHaveLength(1);expect(f.calls[0].body).toEqual({confirm:true});expect(f.calls[0].headers).toMatchObject({'x-piclaw-account-id':'alice','x-piclaw-login-id':'login-a','content-type':'application/json'});
    expect(await page.locator('#session-select').inputValue()).toBe('web:alice');expect(await page.locator('#confirm-execution-cancellation').isChecked()).toBe(false);
    await page.locator('#refresh-results').click();await inspectCancellation(page);expect(await page.locator('#scheduled-execution-cancellation').isVisible()).toBe(false);expect(await page.locator('#publish-result').isDisabled()).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
  }finally{await page.close();}
},20000);

browserTest('terminal and forged result details never enable cancellation',async()=>{
  const page=await browser.newPage();
  try{const f=await cancelFixture(page);await openCancellation(page);
    for(const state of ['settled','expired-unsettled','expired','interrupted','cancelled']){
      f.detail.state=state;f.detail.result=state==='settled'?resultDetail().result:null;await inspectCancellation(page);expect(await page.locator('#cancel-execution').isDisabled()).toBe(true);expect(await page.locator('#scheduled-execution-cancellation').isVisible()).toBe(false);
    }
    f.detail.state='unsettled';f.detail.result=null;f.detail.chat_jid='web:bob';await page.getByRole('button',{name:'Inspect result',exact:true}).click();await page.waitForFunction(()=>document.getElementById('scheduled-results-status')?.textContent?.includes('Invalid result response'));
    expect(await page.locator('#confirm-execution-cancellation').isDisabled()).toBe(true);expect(f.calls).toHaveLength(0);
  }finally{await page.close();}
},20000);

browserTest('uncertain, denied and mismatched cancellations clear confirmation and never replay automatically',async()=>{
  const page=await browser.newPage();
  try{await cancelFixture(page);let sends=0;await page.route('**/agent/scheduled-results/execution-one/cancel',r=>{sends++;return r.fulfill(sends===1?{status:500,json:{}}:sends===2?{status:403,json:{}}:sends===3?{json:{execution_id:'another',cancelled:true,created:true}}:{json:{execution_id:'execution-one',cancelled:true,created:false}});});
    await openCancellation(page);
    for(let i=1;i<=4;i++){
      await page.locator('#confirm-execution-cancellation').check();await page.locator('#cancel-execution').click();await page.waitForFunction(()=>document.getElementById('scheduled-result-detail')?.hidden);
      expect(sends).toBe(i);expect(await page.locator('#confirm-execution-cancellation').isChecked()).toBe(false);expect(await page.locator('#cancel-execution').isDisabled()).toBe(true);
      expect(await page.locator('#scheduled-results-status').textContent()).toContain(i===4?'Cancellation verified':'Cancellation may have completed');
      if(i<4){await page.locator('#refresh-results').click();await inspectCancellation(page);expect(await page.locator('#cancel-execution').isDisabled()).toBe(true);}
    }
  }finally{await page.close();}
},20000);

browserTest('cancellation clears on close, refresh, blur, hidden tab, session switch and navigation',async()=>{
  const page=await browser.newPage();
  try{await cancelFixture(page);await openCancellation(page);
    for(const action of ['refresh','close','blur','hidden','session','navigation']){
      await page.locator('#confirm-execution-cancellation').check();
      if(action==='refresh')await page.locator('#refresh-results').click();
      if(action==='close'){await page.locator('#close-results').click();await page.locator('#open-results').click();}
      if(action==='blur'){await page.evaluate(()=>dispatchEvent(new Event('blur')));await page.evaluate(()=>dispatchEvent(new Event('focus')));await ready(page);}
      if(action==='hidden'){await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await ready(page);}
      if(action==='session'){await page.locator('#session-select').selectOption('web:alice-two');await ready(page);}
      if(action==='navigation')await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));
      expect(await page.locator('#confirm-execution-cancellation').isChecked()).toBe(false);expect(await page.locator('#cancel-execution').isDisabled()).toBe(true);
      if(action!=='navigation')await inspectCancellation(page);
    }
  }finally{await page.close();}
},20000);

browserTest('cancellation can run while a send is pending and cannot release the send lock',async()=>{
  const page=await browser.newPage();let release:()=>void=()=>{};
  try{const f=await cancelFixture(page);let entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
    await page.route('**/agent/default/message?**',async r=>{entered();await held;await r.fulfill({json:{ok:true}});});
    await openCancellation(page);await page.locator('#message-text').fill('held send');await page.locator('#send-message').click();await waiting;
    expect(await page.locator('#send-message').isDisabled()).toBe(true);await page.locator('#confirm-execution-cancellation').check();await page.locator('#cancel-execution').click();await page.waitForFunction(()=>document.getElementById('scheduled-results-status')?.textContent?.includes('Execution authority cancelled'));
    expect(f.calls).toHaveLength(1);expect(await page.locator('#send-message').isDisabled()).toBe(true);expect(await page.locator('#session-select').isDisabled()).toBe(true);
    release();await page.waitForFunction(()=>!(document.getElementById('send-message') as HTMLButtonElement).disabled);
  }finally{release();await page.close();}
},20000);

browserTest('pending cancellation is single-flight and lifecycle return never restores the old confirmation',async()=>{
  for(const action of ['close','blur']){
    const page=await browser.newPage();let release:()=>void=()=>{};
    try{await cancelFixture(page);let sends=0,entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
      await page.route('**/agent/scheduled-results/execution-one/cancel',async r=>{sends++;entered();await held;await r.fulfill({json:{execution_id:'execution-one',cancelled:true,created:true}});});
      await openCancellation(page);await page.locator('#confirm-execution-cancellation').check();await page.locator('#cancel-execution').click();await waiting;
      await page.locator('#refresh-results').click();expect(await page.locator('#cancel-execution').isDisabled()).toBe(true);expect(sends).toBe(1);
      if(action==='close')await page.locator('#close-results').click();else{await page.evaluate(()=>dispatchEvent(new Event('blur')));await page.evaluate(()=>dispatchEvent(new Event('focus')));}
      release();await page.waitForFunction(()=>!(document.getElementById('open-results') as HTMLButtonElement).disabled);
      if(action==='close'){expect(await page.locator('#scheduled-results').isVisible()).toBe(false);await page.locator('#open-results').click();}
      await inspectCancellation(page);expect(await page.locator('#confirm-execution-cancellation').isChecked()).toBe(false);expect(sends).toBe(1);
    }finally{release();await page.close();}
  }
},20000);

browserTest('focus and visibility return during held send independently reverify identity and restore cancellation only',async()=>{
  for(const action of ['blur','hidden']){
    const page=await browser.newPage();let release:()=>void=()=>{};
    try{const f=await cancelFixture(page);let entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
      await page.route('**/agent/default/message?**',async r=>{entered();await held;await r.fulfill({json:{ok:true}});});
      await openCancellation(page);await page.locator('#message-text').fill('held send');await page.locator('#send-message').click();await waiting;
      await page.evaluate(action=>{if(action==='hidden'){Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));}else dispatchEvent(new Event('blur'));},action);
      expect(await page.locator('#scheduled-result-target').textContent()).toBe('');
      await page.evaluate(action=>{if(action==='hidden'){Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));}else dispatchEvent(new Event('focus'));},action);
      await page.waitForFunction(()=>!(document.getElementById('open-results') as HTMLButtonElement).disabled);await inspectCancellation(page);
      expect(await page.locator('#timeline').textContent()).toBe('');expect(await page.locator('#send-message').isDisabled()).toBe(true);expect(await page.locator('#open-tasks').isDisabled()).toBe(true);
      await page.locator('#confirm-execution-cancellation').check();await page.locator('#cancel-execution').click();await page.waitForFunction(()=>document.getElementById('scheduled-results-status')?.textContent?.includes('Execution authority cancelled'));
      expect(f.calls).toHaveLength(1);expect(await page.locator('#send-message').isDisabled()).toBe(true);release();await ready(page);
    }finally{release();await page.close();}
  }
},20000);

browserTest('stale independent focus verification cannot unmask results after another blur or login change',async()=>{
  const page=await browser.newPage();let releaseSend:()=>void=()=>{},releaseIdentity:()=>void=()=>{};
  try{const f=await cancelFixture(page);let sent!:()=>void,checking!:()=>void;const sendHeld=new Promise<void>(r=>releaseSend=r),sentWait=new Promise<void>(r=>sent=r),identityHeld=new Promise<void>(r=>releaseIdentity=r),checkWait=new Promise<void>(r=>checking=r);
    await page.route('**/agent/default/message?**',async r=>{sent();await sendHeld;await r.fulfill({json:{ok:true}});});
    await openCancellation(page);await page.locator('#message-text').fill('held');await page.locator('#send-message').click();await sentWait;
    await page.route('**/auth/me',async r=>{checking();await identityHeld;await r.fulfill({json:f.state.identity});});
    await page.evaluate(()=>{dispatchEvent(new Event('blur'));dispatchEvent(new Event('focus'));});await checkWait;await page.evaluate(()=>dispatchEvent(new Event('blur')));releaseIdentity();
    await page.waitForTimeout(60);expect(await page.locator('#open-results').isDisabled()).toBe(true);expect(await page.locator('#scheduled-results').isVisible()).toBe(false);
    f.state.identity=principal('bob','login-b');await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.getElementById('family-status')?.textContent?.includes('no longer bound'));
    expect(await page.locator('#cancel-execution').isDisabled()).toBe(true);expect(f.calls).toHaveLength(0);
  }finally{releaseIdentity();releaseSend();await page.close();}
},20000);

browserTest('invalid result timestamps fail closed before list actions render',async()=>{
  const page=await browser.newPage();
  try{await cancelFixture(page);await page.route('**/agent/scheduled-results',r=>r.fulfill({json:resultList([{execution_id:'execution-one',chat_jid:'web:alice-two',created_at:Number.MAX_SAFE_INTEGER,state:'unsettled',publication_recorded:false}])}));
    await page.goto(base);await ready(page);await page.locator('#open-results').click();await page.waitForFunction(()=>document.getElementById('scheduled-results-status')?.textContent==='Invalid result metadata.');expect(await page.getByRole('button',{name:'Inspect result',exact:true}).count()).toBe(0);expect(await page.locator('#cancel-execution').isDisabled()).toBe(true);
  }finally{await page.close();}
},20000);

browserTest('changed login during cancellation response invalidates private UI without restoring controls',async()=>{
  const page=await browser.newPage();let release:()=>void=()=>{};
  try{const f=await cancelFixture(page);let entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
    await page.route('**/agent/scheduled-results/execution-one/cancel',async r=>{entered();await held;await r.fulfill({json:{execution_id:'execution-one',cancelled:true,created:true}});});
    await openCancellation(page);await page.locator('#confirm-execution-cancellation').check();await page.locator('#cancel-execution').click();await waiting;f.state.identity=principal('bob','login-b');release();
    await page.waitForFunction(()=>document.getElementById('family-status')?.textContent?.includes('no longer bound'));expect(await page.locator('#scheduled-result-target').textContent()).toBe('');expect(await page.locator('#cancel-execution').isDisabled()).toBe(true);expect(await page.locator('#scheduled-results').isVisible()).toBe(false);
  }finally{release();await page.close();}
},20000);

browserTest('terminal cancelled scheduled result renders without text or publication controls',async()=>{
  const page=await browser.newPage();
  try{await fixture(page);await page.route('**/agent/scheduled-results',r=>r.fulfill({json:resultList([{execution_id:'execution-one',chat_jid:'web:alice-two',created_at:1780000000000,state:'cancelled',publication_recorded:false}])}));
    await page.route('**/agent/scheduled-results/execution-one',r=>r.fulfill({json:{...resultDetail(),state:'cancelled',result:null}}));
    await page.goto(base);await ready(page);await page.locator('#open-results').click();await page.getByRole('button',{name:'Inspect result',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('scheduled-result-state')?.textContent==='cancelled');expect(await page.locator('#scheduled-result-text').textContent()).toBe('');expect(await page.locator('#publish-result').isDisabled()).toBe(true);expect(await page.locator('#confirm-result-publication').isDisabled()).toBe(true);
  }finally{await page.close();}
},20000);

browserTest('terminal interrupted scheduled result renders without text or publication controls',async()=>{
  const page=await browser.newPage();
  try{await fixture(page);await page.route('**/agent/scheduled-results',r=>r.fulfill({json:resultList([{execution_id:'execution-one',chat_jid:'web:alice-two',created_at:1780000000000,state:'interrupted',publication_recorded:false}])}));
    await page.route('**/agent/scheduled-results/execution-one',r=>r.fulfill({json:{...resultDetail(),state:'interrupted',result:null}}));
    await page.goto(base);await ready(page);await page.locator('#open-results').click();await page.getByRole('button',{name:'Inspect result',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('scheduled-result-state')?.textContent==='interrupted');expect(await page.locator('#scheduled-result-text').textContent()).toBe('');expect(await page.locator('#publish-result').isDisabled()).toBe(true);expect(await page.locator('#confirm-result-publication').isDisabled()).toBe(true);
  }finally{await page.close();}
},20000);

browserTest('terminal expired scheduled result renders without text or publication controls',async()=>{
  const page=await browser.newPage();
  try{await fixture(page);await page.route('**/agent/scheduled-results',r=>r.fulfill({json:resultList([{execution_id:'execution-one',chat_jid:'web:alice-two',created_at:1780000000000,state:'expired',publication_recorded:false}])}));
    await page.route('**/agent/scheduled-results/execution-one',r=>r.fulfill({json:{...resultDetail(),state:'expired',result:null}}));
    await page.goto(base);await ready(page);await page.locator('#open-results').click();await page.getByRole('button',{name:'Inspect result',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('scheduled-result-state')?.textContent==='expired');expect(await page.locator('#scheduled-result-text').textContent()).toBe('');expect(await page.locator('#publish-result').isDisabled()).toBe(true);expect(await page.locator('#confirm-result-publication').isDisabled()).toBe(true);
  }finally{await page.close();}
},20000);

browserTest('prepared task editor uses UTC, explicit target and selected tools with pinned paused-only request',async()=>{
  const page=await browser.newPage({viewport:{width:375,height:740},timezoneId:'America/New_York'});
  try{const f=await taskFixture(page);await openTasks(page);expect(await page.locator('#task-target').inputValue()).toBe('');expect(await page.locator('#task-tools input:checked').count()).toBe(0);
    const due=await taskDraft(page);await page.locator('#task-tools input[value=read]').check();expect(await page.locator('#prepare-task').isDisabled()).toBe(true);
    await page.locator('#confirm-task-preparation').check();await page.locator('#prepare-task').click();await page.waitForFunction(()=>document.getElementById('scheduled-tasks-status')?.textContent?.includes('Prepared paused task'));
    expect(f.requests).toHaveLength(1);expect(f.requests[0].body).toMatchObject({chat_jid:'web:alice-two',prompt:'Exact task prompt\nline two ',scheduled_for:due+':00.000Z',allowed_tools:['read'],confirm:true});expect(Object.keys(f.requests[0].body).sort()).toEqual(['allowed_tools','chat_jid','confirm','prompt','request_id','scheduled_for']);expect(f.requests[0].headers['x-piclaw-login-id']).toBe('login-a');
    expect(await page.locator('#session-select').inputValue()).toBe('web:alice');expect(await page.locator('#task-prompt').inputValue()).toBe('');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
  }finally{await page.close();}
},20000);

browserTest('uncertain preparation locks payload and reuses exact request ID only after manual confirmation',async()=>{
  const page=await browser.newPage();
  try{await taskFixture(page);const sent:any[]=[];await page.route('**/agent/scheduled-tasks',r=>{if(r.request().method()==='GET')return r.fulfill({json:{owner_user_id:'alice',window_size:50,activation_available:false,items:[]}});sent.push(r.request().postDataJSON());return r.fulfill(sent.length===1?{status:500,json:{}}:{json:{request_id:r.request().postDataJSON().request_id,task_id:'task-new',grant_id:'grant-new',state:'paused',created:false}});});
    await openTasks(page);await taskDraft(page);await page.locator('#confirm-task-preparation').check();await page.locator('#prepare-task').click();await page.waitForFunction(()=>document.getElementById('scheduled-tasks-status')?.textContent?.includes('may have been prepared'));
    expect(sent).toHaveLength(1);expect(await page.locator('#task-prompt').isDisabled()).toBe(true);expect(await page.locator('#task-due').isDisabled()).toBe(true);expect(await page.locator('#prepare-task').isDisabled()).toBe(true);
    await page.locator('#open-tasks').click();expect(await page.locator('#task-prompt').inputValue()).toBe('Exact task prompt\nline two ');expect(await page.locator('#task-prompt').isDisabled()).toBe(true);
    await page.locator('#confirm-task-preparation').check();await page.locator('#prepare-task').click();await page.waitForFunction(()=>document.getElementById('scheduled-tasks-status')?.textContent?.includes('Preparation verified'));expect(sent).toHaveLength(2);expect(sent[1]).toEqual(sent[0]);
    await taskDraft(page);await page.locator('#confirm-task-preparation').check();await page.locator('#task-prompt').fill('Edited');expect(await page.locator('#confirm-task-preparation').isChecked()).toBe(false);
    await page.locator('#reset-task-draft').click();expect(await page.locator('#task-prompt').inputValue()).toBe('');
  }finally{await page.close();}
},20000);

browserTest('task preparation rejects mismatched receipt IDs and retries only the original payload',async()=>{
  const page=await browser.newPage();
  try{await taskFixture(page);const sent:any[]=[];
    await page.route('**/agent/scheduled-tasks',r=>{if(r.request().method()==='GET')return r.fulfill({json:{owner_user_id:'alice',window_size:50,activation_available:false,items:[]}});const body=r.request().postDataJSON();sent.push(body);return r.fulfill({json:{request_id:sent.length===1?'another-request':body.request_id,task_id:'task-one',grant_id:'grant-one',state:'paused',created:false}});});
    await openTasks(page);await taskDraft(page);await page.locator('#confirm-task-preparation').check();await page.locator('#prepare-task').click();
    await page.waitForFunction(()=>document.getElementById('scheduled-tasks-status')?.textContent?.includes('Invalid task preparation response'));
    expect(await page.locator('#task-prompt').isDisabled()).toBe(true);expect(sent).toHaveLength(1);
    await page.locator('#confirm-task-preparation').check();await page.locator('#prepare-task').click();await page.waitForFunction(()=>document.getElementById('scheduled-tasks-status')?.textContent?.includes('Preparation verified'));
    expect(sent).toHaveLength(2);expect(sent[1]).toEqual(sent[0]);
  }finally{await page.close();}
},20000);

browserTest('task request size counts JSON escaping separately from UTF-8 prompt bytes before sending',async()=>{
  const page=await browser.newPage();
  try{const f=await taskFixture(page);await openTasks(page);await taskDraft(page);
    for(const [prompt,error] of [['é'.repeat(51201),'100 KiB'],['"'.repeat(70000),'encoded request exceeds 128 KiB']]){
      await page.locator('#task-prompt').fill(prompt);await page.locator('#confirm-task-preparation').check();await page.locator('#prepare-task').click();
      await page.waitForFunction(text=>document.getElementById('scheduled-tasks-status')?.textContent?.includes(text),error);expect(f.requests).toHaveLength(0);expect(await page.locator('#task-prompt').isDisabled()).toBe(false);
    }
    await page.locator('#task-prompt').fill('é'.repeat(51200));await page.locator('#confirm-task-preparation').check();await page.locator('#prepare-task').click();await page.waitForFunction(()=>document.getElementById('scheduled-tasks-status')?.textContent?.includes('Prepared paused task'));expect(f.requests).toHaveLength(1);
  }finally{await page.close();}
},20000);

browserTest('task mutation keeps one request through busy reset and cross-panel publication attempts',async()=>{
  const page=await browser.newPage();let release:()=>void=()=>{};
  try{const f=await taskFixture(page);let entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);let sends=0,publishes=0;
    await page.route('**/agent/scheduled-results',r=>r.fulfill({json:resultList()}));await page.route('**/agent/scheduled-results/execution-one',r=>r.fulfill({json:resultDetail()}));
    await page.route('**/agent/scheduled-results/execution-one/publish',r=>{publishes++;return r.fulfill({json:{execution_id:'execution-one',chat_jid:'web:alice-two',message_rowid:99,created:true}});});
    await page.route('**/agent/scheduled-tasks',async r=>{if(r.request().method()==='GET')return r.fulfill({json:f.directory});sends++;entered();await held;await r.fulfill({status:500,json:{}});});
    await openTasks(page);await page.locator('#open-results').click();await page.getByRole('button',{name:'Inspect result',exact:true}).click();await page.locator('#confirm-result-publication').check();
    await taskDraft(page);await page.locator('#confirm-task-preparation').check();await page.locator('#prepare-task').click();await waiting;
    await page.locator('#reset-task-draft').click();await page.locator('#refresh-tasks').click();await page.locator('#open-tasks').click();await page.locator('#publish-result').click();
    expect(await page.locator('#task-prompt').inputValue()).toBe('Exact task prompt\nline two ');expect(await page.locator('#task-prompt').isDisabled()).toBe(true);expect(sends).toBe(1);expect(publishes).toBe(0);
    release();await page.waitForFunction(()=>document.getElementById('scheduled-tasks-status')?.textContent?.includes('may have been prepared'));await page.waitForFunction(()=>!(document.getElementById('send-message') as HTMLButtonElement)?.disabled);
    await page.locator('#publish-result').click();await page.waitForFunction(()=>document.getElementById('scheduled-results-status')?.textContent?.includes('Published'));expect(publishes).toBe(1);expect(sends).toBe(1);expect(await page.locator('#task-prompt').isDisabled()).toBe(true);
  }finally{release();await page.close();}
},20000);

browserTest('hidden or blurred pending preparation clears private state and re-enables panel after identity check',async()=>{
  for(const hidden of [false,true]){
    const page=await browser.newPage();let release:()=>void=()=>{};
    try{const f=await taskFixture(page);let entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);let sends=0;
      await page.route('**/agent/scheduled-tasks',async r=>{if(r.request().method()==='GET')return r.fulfill({json:f.directory});sends++;entered();await held;await r.fulfill({json:{request_id:r.request().postDataJSON().request_id,task_id:'late-task',grant_id:'late-grant',created:true,state:'paused'}});});
      await openTasks(page);await taskDraft(page);await page.locator('#confirm-task-preparation').check();await page.locator('#prepare-task').click();await waiting;
      await page.evaluate(hidden=>{if(hidden){Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));}else dispatchEvent(new Event('blur'));},hidden);
      expect(await page.locator('#task-prompt').inputValue()).toBe('');expect(await page.locator('#scheduled-tasks').isVisible()).toBe(false);expect(await page.locator('#open-tasks').isDisabled()).toBe(true);
      // Return immediately, before the pending server reply: no retry or new task is sent.
      await page.evaluate(hidden=>{if(hidden){Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));}else dispatchEvent(new Event('focus'));},hidden);
      release();await page.waitForFunction(()=>!(document.getElementById('open-tasks') as HTMLButtonElement)?.disabled&&!document.getElementById('prepare-task-form')?.hidden);
      expect(await page.locator('#task-prompt').inputValue()).toBe('');expect(await page.locator('#prepare-task').textContent()).toBe('Prepare paused task');expect(sends).toBe(1);
      await page.locator('#close-tasks').click();await page.locator('#open-tasks').click();await page.waitForFunction(()=>!document.getElementById('prepare-task-form')?.hidden);
    }finally{release();await page.close();}
  }
},20000);

browserTest('uncertain and interrupted revocation require fresh inspection and never replay automatically',async()=>{
  const page=await browser.newPage();let release:()=>void=()=>{};
  try{await taskFixture(page);let sends=0,entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
    await page.route('**/agent/scheduled-tasks/grant-one/revoke',async r=>{sends++;if(sends===1)return r.fulfill({status:500,json:{}});entered();await held;await r.fulfill({json:{grant_id:'grant-one',revoked:true}});});
    await openTasks(page);const inspect=async()=>{await page.getByRole('button',{name:'Inspect task',exact:true}).click();await page.locator('#confirm-task-revocation').check();await page.locator('#revoke-task').click();};
    await inspect();await page.waitForFunction(()=>document.getElementById('scheduled-tasks-status')?.textContent?.includes('Revocation may have completed'));expect(await page.locator('#scheduled-task-text').textContent()).toBe('');expect(await page.locator('#revoke-task').isDisabled()).toBe(true);expect(sends).toBe(1);
    await page.locator('#refresh-tasks').click();await inspect();await waiting;await page.evaluate(()=>dispatchEvent(new Event('blur')));await page.evaluate(()=>dispatchEvent(new Event('focus')));release();
    await page.waitForFunction(()=>!(document.getElementById('open-tasks') as HTMLButtonElement)?.disabled&&!document.getElementById('prepare-task-form')?.hidden);expect(await page.locator('#scheduled-task-text').textContent()).toBe('');expect(await page.locator('#revoke-task').isDisabled()).toBe(true);expect(sends).toBe(2);
  }finally{release();await page.close();}
},20000);

browserTest('task inspection renders plain text and revocation is explicit, pinned and clears details',async()=>{
  const page=await browser.newPage();
  try{const f=await taskFixture(page);const calls:any[]=[];await page.route('**/agent/scheduled-tasks/grant-one/revoke',r=>{calls.push({body:r.request().postDataJSON(),headers:r.request().headers()});return r.fulfill({json:{grant_id:'grant-one',revoked:true}});});
    await openTasks(page);await page.getByRole('button',{name:'Inspect task',exact:true}).click();await page.waitForFunction(()=>document.getElementById('scheduled-task-text')?.textContent?.includes('PRIVATE_TASK'));expect(await page.locator('#scheduled-task-text img').count()).toBe(0);expect(await page.locator('#revoke-task').isDisabled()).toBe(true);
    await page.locator('#confirm-task-revocation').check();await page.locator('#revoke-task').click();await page.waitForFunction(()=>document.getElementById('scheduled-tasks-status')?.textContent?.includes('grant revoked'));expect(calls[0].body).toEqual({confirm:true});expect(calls[0].headers['x-piclaw-account-id']).toBe('alice');expect(await page.locator('#scheduled-task-text').textContent()).toBe('');
    f.detail.revoked=true;f.detail.preparation=null as any;await page.getByRole('button',{name:'Inspect task',exact:true}).click();await page.waitForFunction(()=>document.getElementById('scheduled-task-state')?.textContent?.includes('Grant revoked'));expect(await page.locator('#confirm-task-revocation').isDisabled()).toBe(true);
  }finally{await page.close();}
},20000);

browserTest('task draft and inspection clear on refresh, close, blur, session switch and navigation',async()=>{
  const page=await browser.newPage();
  try{await taskFixture(page);await openTasks(page);const fill=async()=>{await taskDraft(page);await page.getByRole('button',{name:'Inspect task',exact:true}).click();await page.waitForFunction(()=>document.getElementById('scheduled-task-text')?.textContent?.includes('PRIVATE_TASK'));await page.locator('#confirm-task-preparation').check();};
    await fill();await page.locator('#refresh-tasks').click();await page.waitForFunction(()=>!document.getElementById('prepare-task-form')?.hidden);expect(await page.locator('#task-prompt').inputValue()).toBe('');expect(await page.locator('#scheduled-task-text').textContent()).toBe('');
    await fill();await page.locator('#close-tasks').click();expect(await page.locator('#task-prompt').inputValue()).toBe('');await page.locator('#open-tasks').click();await page.waitForFunction(()=>!document.getElementById('prepare-task-form')?.hidden);
    await fill();await page.evaluate(()=>dispatchEvent(new Event('blur')));expect(await page.locator('#scheduled-task-text').textContent()).toBe('');await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.waitForFunction(()=>!document.getElementById('prepare-task-form')?.hidden);
    await fill();await page.locator('#session-select').selectOption('web:alice-two');await page.waitForFunction(()=>!document.getElementById('prepare-task-form')?.hidden);expect(await page.locator('#task-prompt').inputValue()).toBe('');
    await fill();await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));expect(await page.locator('#scheduled-task-text').textContent()).toBe('');expect(await page.locator('#task-prompt').inputValue()).toBe('');
  }finally{await page.close();}
},20000);

browserTest('late preparation response cannot restore closed panel, draft or retry and releases shell lock',async()=>{
  const page=await browser.newPage();
  try{await taskFixture(page);let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
    await page.route('**/agent/scheduled-tasks',async r=>{if(r.request().method()==='GET')return r.fulfill({json:{owner_user_id:'alice',window_size:50,activation_available:false,items:[]}});entered();await held;await r.fulfill({json:{request_id:r.request().postDataJSON().request_id,task_id:'task-late',grant_id:'grant-late',created:true,state:'paused'}});});
    await openTasks(page);await taskDraft(page);await page.locator('#confirm-task-preparation').check();await page.locator('#prepare-task').click();await waiting;expect(await page.locator('#send-message').isDisabled()).toBe(true);await page.locator('#close-tasks').click();release();await page.waitForFunction(()=>!(document.getElementById('send-message') as HTMLButtonElement)?.disabled);
    expect(await page.locator('#scheduled-tasks').isVisible()).toBe(false);await page.locator('#open-tasks').click();await page.waitForFunction(()=>!document.getElementById('prepare-task-form')?.hidden);expect(await page.locator('#task-prompt').inputValue()).toBe('');expect(await page.locator('#prepare-task').textContent()).toBe('Prepare paused task');
  }finally{await page.close();}
},20000);

browserTest('account changes and target substitution fail closed before task content or controls render',async()=>{
  const page=await browser.newPage();
  try{const f=await taskFixture(page);await openTasks(page);f.detail.chat_jid='web:bob';await page.getByRole('button',{name:'Inspect task',exact:true}).click();await page.waitForFunction(()=>document.getElementById('scheduled-tasks-status')?.textContent?.includes('Invalid task detail'));expect(await page.locator('#scheduled-task-text').textContent()).toBe('');
    f.detail.chat_jid='web:alice-two';let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
    await page.route('**/agent/scheduled-tasks/grant-one',async r=>{entered();await held;await r.fulfill({json:f.detail});});await page.getByRole('button',{name:'Inspect task',exact:true}).click();await waiting;f.state.identity=principal('bob','login-b');release();await page.waitForFunction(()=>document.getElementById('family-status')?.textContent?.includes('no longer bound'));expect(await page.locator('#scheduled-task-text').textContent()).toBe('');expect(await page.locator('#task-prompt').inputValue()).toBe('');
  }finally{await page.close();}
},20000);

browserTest('scheduled results load on explicit open, inspect as text and publish once with original target pins',async()=>{
  const page=await browser.newPage({viewport:{width:375,height:740}});
  try{
    await fixture(page);let lists=0,reads=0;const publications:any[]=[];
    await page.route('**/agent/scheduled-results',route=>{lists++;return route.fulfill({json:resultList()});});
    await page.route('**/agent/scheduled-results/execution-one',route=>{reads++;return route.fulfill({json:resultDetail()});});
    await page.route('**/agent/scheduled-results/execution-one/publish',async route=>{publications.push({body:route.request().postDataJSON(),headers:route.request().headers()});await new Promise(resolve=>setTimeout(resolve,50));return route.fulfill({json:{execution_id:'execution-one',chat_jid:'web:alice-two',message_rowid:99,created:true}});});
    await page.goto(base);await ready(page);expect(lists).toBe(0);await page.locator('#open-results').click();await page.getByRole('button',{name:'Inspect result',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('scheduled-result-text')?.textContent?.includes('PRIVATE_RESULT'));
    expect(reads).toBe(1);expect(await page.locator('#scheduled-result-text img').count()).toBe(0);expect(await page.locator('#publish-result').isDisabled()).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('#confirm-result-publication').check();await page.locator('#publish-result').click();
    await page.waitForFunction(()=>document.getElementById('scheduled-results-status')?.textContent?.includes('Published as message 99'));
    expect(publications).toHaveLength(1);expect(publications[0].body).toEqual({confirm:true});expect(publications[0].headers['x-piclaw-account-id']).toBe('alice');expect(publications[0].headers['x-piclaw-login-id']).toBe('login-a');
    expect(await page.locator('#session-select').inputValue()).toBe('web:alice');expect(await page.locator('#scheduled-result-text').textContent()).toBe('');
  }finally{await page.close();}
},20000);

browserTest('result detail and confirmation clear on refresh, close, blur, session switch and navigation',async()=>{
  const page=await browser.newPage();
  try{
    await fixture(page);await page.route('**/agent/scheduled-results',r=>r.fulfill({json:resultList()}));await page.route('**/agent/scheduled-results/execution-one',r=>r.fulfill({json:resultDetail()}));
    await page.goto(base);await ready(page);await page.locator('#open-results').click();
    const inspect=async()=>{await page.getByRole('button',{name:'Inspect result',exact:true}).click();await page.waitForFunction(()=>document.getElementById('scheduled-result-text')?.textContent?.includes('PRIVATE_RESULT'));await page.locator('#confirm-result-publication').check();};
    await inspect();await page.locator('#refresh-results').click();expect(await page.locator('#scheduled-result-text').textContent()).toBe('');expect(await page.locator('#confirm-result-publication').isChecked()).toBe(false);
    await inspect();await page.locator('#close-results').click();expect(await page.locator('#scheduled-result-text').textContent()).toBe('');await page.locator('#open-results').click();
    await inspect();await page.evaluate(()=>dispatchEvent(new Event('blur')));expect(await page.locator('#scheduled-result-text').textContent()).toBe('');await page.evaluate(()=>dispatchEvent(new Event('focus')));await ready(page);
    await inspect();await page.locator('#session-select').selectOption('web:alice-two');await ready(page);expect(await page.locator('#scheduled-result-text').textContent()).toBe('');
    await inspect();await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));expect(await page.locator('#scheduled-result-text').textContent()).toBe('');expect(await page.locator('#publish-result').isDisabled()).toBe(true);
  }finally{await page.close();}
},20000);

browserTest('late result response cannot repopulate a closed panel or changed account',async()=>{
  const page=await browser.newPage();
  try{
    const state=await fixture(page);await page.route('**/agent/scheduled-results',r=>r.fulfill({json:resultList()}));
    let release!:()=>void,entered!:()=>void;let held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
    await page.route('**/agent/scheduled-results/execution-one',async r=>{entered();await held;await r.fulfill({json:resultDetail()});});
    await page.goto(base);await ready(page);await page.locator('#open-results').click();await page.getByRole('button',{name:'Inspect result',exact:true}).click();await waiting;await page.locator('#close-results').click();release();await page.waitForTimeout(100);expect(await page.locator('#scheduled-result-text').textContent()).toBe('');
    held=new Promise<void>(r=>release=r);waiting=new Promise<void>(r=>entered=r);await page.locator('#open-results').click();await page.getByRole('button',{name:'Inspect result',exact:true}).click();await waiting;
    state.identity=principal('bob','login-b');release();await page.waitForFunction(()=>document.getElementById('family-status')?.textContent?.includes('no longer bound'));expect(await page.locator('#scheduled-result-text').textContent()).toBe('');
  }finally{await page.close();}
},20000);

browserTest('failed publication is not replayed automatically and requires fresh inspection and confirmation',async()=>{
  const page=await browser.newPage();
  try{
    await fixture(page);let sends=0;await page.route('**/agent/scheduled-results',r=>r.fulfill({json:resultList()}));await page.route('**/agent/scheduled-results/execution-one',r=>r.fulfill({json:resultDetail()}));
    await page.route('**/agent/scheduled-results/execution-one/publish',r=>{sends++;return r.fulfill(sends===1?{status:500,json:{}}:{json:{execution_id:'execution-one',chat_jid:'web:alice-two',message_rowid:99,created:false}});});
    await page.goto(base);await ready(page);await page.locator('#open-results').click();await page.getByRole('button',{name:'Inspect result',exact:true}).click();await page.locator('#confirm-result-publication').check();await page.locator('#publish-result').click();
    await page.waitForFunction(()=>document.getElementById('scheduled-results-status')?.textContent?.includes('may have completed'));expect(sends).toBe(1);expect(await page.locator('#publish-result').isDisabled()).toBe(true);
    await page.locator('#refresh-results').click();await page.getByRole('button',{name:'Inspect result',exact:true}).click();expect(await page.locator('#confirm-result-publication').isChecked()).toBe(false);await page.locator('#confirm-result-publication').check();await page.locator('#publish-result').click();
    await page.waitForFunction(()=>document.getElementById('scheduled-results-status')?.textContent?.includes('Publication verified'));expect(sends).toBe(2);
  }finally{await page.close();}
},20000);

browserTest('unsettled result cannot publish and foreign detail payload fails closed',async()=>{
  const page=await browser.newPage();
  try{
    await fixture(page);await page.route('**/agent/scheduled-results',r=>r.fulfill({json:resultList()}));let foreign=false;
    await page.route('**/agent/scheduled-results/execution-one',r=>r.fulfill({json:foreign?{...resultDetail(),owner_user_id:'bob'}:{...resultDetail(),state:'expired-unsettled',result:null}}));
    await page.goto(base);await ready(page);await page.locator('#open-results').click();await page.getByRole('button',{name:'Inspect result',exact:true}).click();await page.waitForFunction(()=>document.getElementById('scheduled-result-state')?.textContent?.includes('expired-unsettled'));expect(await page.locator('#confirm-result-publication').isDisabled()).toBe(true);
    foreign=true;await page.getByRole('button',{name:'Inspect result',exact:true}).click();await page.waitForFunction(()=>document.getElementById('scheduled-results-status')?.textContent?.includes('Invalid result response'));expect(await page.locator('#scheduled-result-text').textContent()).toBe('');
  }finally{await page.close();}
},20000);

browserTest('closing during publication clears detail and late success cannot reopen it or leave shell locked',async()=>{
  const page=await browser.newPage();
  try{
    await fixture(page);await page.route('**/agent/scheduled-results',r=>r.fulfill({json:resultList()}));await page.route('**/agent/scheduled-results/execution-one',r=>r.fulfill({json:resultDetail()}));
    let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);let sends=0;
    await page.route('**/agent/scheduled-results/execution-one/publish',async r=>{sends++;entered();await held;await r.fulfill({json:{execution_id:'execution-one',chat_jid:'web:alice-two',message_rowid:99,created:true}});});
    await page.goto(base);await ready(page);await page.locator('#open-results').click();await page.getByRole('button',{name:'Inspect result',exact:true}).click();await page.locator('#confirm-result-publication').check();await page.locator('#publish-result').click();await waiting;
    expect(await page.locator('#send-message').isDisabled()).toBe(true);await page.locator('#close-results').click();release();
    await page.waitForFunction(()=>!(document.getElementById('send-message') as HTMLButtonElement)?.disabled);
    expect(await page.locator('#scheduled-results').isVisible()).toBe(false);expect(await page.locator('#scheduled-result-text').textContent()).toBe('');expect(sends).toBe(1);
    await page.locator('#open-results').click();expect(await page.locator('#confirm-result-publication').isChecked()).toBe(false);
  }finally{await page.close();}
},20000);

browserTest('new result selection wins over an older delayed detail and does not carry confirmation',async()=>{
  const page=await browser.newPage();
  try{
    await fixture(page);await page.route('**/agent/scheduled-results',r=>r.fulfill({json:resultList([
      {execution_id:'execution-one',chat_jid:'web:alice-two',created_at:1780000000000,state:'settled',publication_recorded:false},
      {execution_id:'execution-two',chat_jid:'web:alice',created_at:1780000000001,state:'settled',publication_recorded:false},
    ])}));
    let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
    await page.route('**/agent/scheduled-results/execution-one',async r=>{entered();await held;await r.fulfill({json:resultDetail()});});
    await page.route('**/agent/scheduled-results/execution-two',r=>r.fulfill({json:resultDetail('execution-two','web:alice','LATEST_DETAIL')}));
    await page.goto(base);await ready(page);await page.locator('#open-results').click();await page.getByRole('button',{name:'Inspect result',exact:true}).nth(0).click();await waiting;
    await page.getByRole('button',{name:'Inspect result',exact:true}).nth(1).click();await page.waitForFunction(()=>document.getElementById('scheduled-result-text')?.textContent==='LATEST_DETAIL');release();await page.waitForTimeout(80);
    expect(await page.locator('#scheduled-result-text').textContent()).toBe('LATEST_DETAIL');expect(await page.locator('#confirm-result-publication').isChecked()).toBe(false);
  }finally{await page.close();}
},20000);

browserTest("fresh login ignores legacy browser state, uses home and sends pinned text with stable retry ID", async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 740 } });
  try {
    const state = await fixture(page); const sends: any[] = [];
    await page.addInitScript(() => { localStorage.setItem("piclaw_last_main_chat", "web:bob"); localStorage.setItem("piclaw_btw_session", "FOREIGN_SECRET"); });
    await page.route("**/agent/default/message?**", route => { sends.push({ body: route.request().postDataJSON(), headers: route.request().headers() }); return route.fulfill(sends.length === 1 ? { status: 500, json: {} } : { status: 201, json: { queued: "message" } }); });
    await page.goto(base); await ready(page);
    expect(state.calls[0]!.path).toContain("chat_jid=web%3Aalice"); expect(state.calls[0]!.headers["x-piclaw-login-id"]).toBe("login-a");
    expect(await page.locator("body").textContent()).not.toContain("FOREIGN_SECRET");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("#message-text").fill("hello"); await page.locator("#send-message").click();
    await page.waitForFunction(() => document.getElementById("family-error")?.textContent?.includes("Resend unchanged"));
    await page.locator("#send-message").click(); await page.waitForFunction(() => (document.getElementById("message-text") as HTMLTextAreaElement)?.value === "");
    expect(sends).toHaveLength(2); expect(sends[0].body.request_id).toBe(sends[1].body.request_id);
    expect(sends[0].headers["x-piclaw-account-id"]).toBe("alice"); expect(sends[1].body.content).toBe("hello");
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([2, 0]);
  } finally { await page.close(); }
}, 20000);

browserTest("foreign explicit URL does not fall back silently; Go home recovers", async () => {
  const page = await browser.newPage();
  try {
    await fixture(page);
    await page.route("**/timeline?**", route => route.fulfill(route.request().url().includes("web%3Abob") ? { status: 403, json: {} } : { json: posts() }));
    await page.goto(base + "/?chat_jid=web:bob");
    await page.waitForFunction(() => document.getElementById("family-error")?.textContent?.includes("Access denied"));
    expect(page.url()).toContain("web:bob"); expect(await page.locator("#send-message").isDisabled()).toBe(true);
    await page.locator("#go-home").click(); await ready(page); expect(page.url()).toContain("web%3Aalice");
  } finally { await page.close(); }
}, 20000);

browserTest("account/login change during a delayed response clears conversation and draft", async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page); await page.goto(base); await ready(page);
    await page.locator("#message-text").fill("unsent private draft");
    let release!: () => void, admitted!: () => void;
    const held = new Promise<void>(resolve => release = resolve), entered = new Promise<void>(resolve => admitted = resolve);
    await page.route("**/timeline?**", async route => { admitted(); await held; await route.fulfill({ json: posts("STALE_SECRET") }); });
    await page.locator("#refresh").click(); await entered;
    state.identity = principal("bob", "login-b"); release();
    await page.waitForFunction(() => document.getElementById("family-status")?.textContent?.includes("no longer bound"));
    expect(await page.locator("#timeline").textContent()).toBe(""); expect(await page.locator("#message-text").inputValue()).toBe("");
    expect(await page.locator("#send-message").isDisabled()).toBe(true);
  } finally { await page.close(); }
}, 20000);

browserTest("in-flight old session cannot overwrite newly selected session", async () => {
  const page = await browser.newPage();
  try {
    await fixture(page); await page.goto(base); await ready(page);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => release = resolve), waiting = new Promise<void>(resolve => entered = resolve);
    await page.route("**/timeline?**", async route => {
      if (route.request().url().includes("alice-two")) return route.fulfill({ json: posts("SECOND_SESSION") });
      entered(); await held; return route.fulfill({ json: posts("STALE_SESSION") });
    });
    await page.locator("#refresh").click(); await waiting;
    await page.locator("#session-select").selectOption("web:alice-two");
    await page.waitForFunction(() => document.getElementById("timeline")?.textContent?.includes("SECOND_SESSION")); release();
    await page.waitForTimeout(100);
    expect(await page.locator("#timeline").textContent()).not.toContain("STALE_SESSION");
  } finally { await page.close(); }
}, 20000);

browserTest("blur masks private UI, changed login on focus invalidates, pagehide erases drafts", async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page); await page.goto(base); await ready(page); await page.locator("#message-text").fill("private");
    await page.evaluate(() => dispatchEvent(new Event("blur")));
    expect(await page.locator("#timeline").textContent()).toBe(""); expect(await page.locator("#compose-form").isVisible()).toBe(false);
    state.identity = principal("alice", "new-login"); await page.evaluate(() => dispatchEvent(new Event("focus")));
    await page.waitForFunction(() => document.getElementById("family-status")?.textContent?.includes("no longer bound"));
    expect(await page.locator("#message-text").inputValue()).toBe("");
    state.identity = principal(); await page.reload(); await ready(page); await page.locator("#message-text").fill("private");
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
    expect(await page.locator("#message-text").inputValue()).toBe(""); expect(await page.locator("#timeline").textContent()).toBe("");
  } finally { await page.close(); }
}, 20000);

browserTest("pre-existing worker and caches are retired before private API calls", async () => {
  const page = await browser.newPage();
  try {
    let privateCalls = 0;
    await page.route("**/auth/me", route => { privateCalls++; return route.fulfill({ json: principal() }); });
    await page.goto(base + "/blank");
    await page.evaluate(async () => {
      await caches.open("old-piclaw").then(cache => cache.put("/old-private", new Response("secret")));
      await navigator.serviceWorker.register("/old-sw.js"); await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    });
    await page.goto(base);
    await page.waitForFunction(() => document.getElementById("family-error")?.textContent?.includes("previous service worker"));
    expect(privateCalls).toBe(0);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
  } finally { await page.close(); }
}, 20000);

browserTest("sign out sends the original pins, clears UI and navigates to login", async () => {
  const page = await browser.newPage();
  try {
    await fixture(page); let headers: Record<string, string> = {};
    await page.route("**/auth/logout", route => { headers = route.request().headers(); return route.fulfill({ json: { logged_out: true } }); });
    await page.goto(base); await ready(page); await page.locator("#sign-out").click(); await page.waitForURL(base + "/login");
    expect(headers["x-piclaw-account-id"]).toBe("alice"); expect(headers["x-piclaw-login-id"]).toBe("login-a");
  } finally { await page.close(); }
}, 20000);

browserTest("held-input controls use discovered IDs, require skip confirmation and reuse failed retry key", async () => {
  const page = await browser.newPage();
  try {
    await fixture(page); let held = true; const actions: any[] = [];
    await page.route("**/agent/message-recovery?**", route => route.fulfill({ json: held ? { state: "held", message_rowid: 42 } : { state: "idle" } }));
    await page.route("**/agent/message-recovery", route => {
      actions.push(route.request().postDataJSON());
      if (actions.length === 1) return route.fulfill({ status: 500, json: {} });
      if (actions.at(-1).action === "skip") held = false;
      return route.fulfill({ json: { recovered: true } });
    });
    await page.goto(base); await ready(page);
    expect(await page.locator("#recovery-status").textContent()).toContain("42");
    expect(await page.locator("#skip-message").isDisabled()).toBe(true);
    await page.locator("#retry-message").click();
    await page.waitForFunction(() => document.getElementById("family-error")?.textContent?.includes("same action"));
    await page.locator("#retry-message").click();
    await page.waitForFunction(() => !document.getElementById("family-error")?.textContent);
    expect(actions).toHaveLength(2); expect(actions[0].request_id).toBe(actions[1].request_id); expect(actions[0].message_rowid).toBe(42);
    await page.locator("#confirm-skip").check(); await page.locator("#skip-message").click();
    await page.waitForFunction(() => (document.getElementById("message-recovery") as HTMLElement)?.hidden);
    expect(actions[2].action).toBe("skip"); expect(actions[2].request_id).not.toBe(actions[1].request_id);
  } finally { await page.close(); }
}, 20000);

function accountSnapshot(recent = true) {
  return {
    user: { id: 'alice', username: 'alice', display_name: 'Alice' }, recent_auth: recent,
    capabilities: { update_profile: recent, register_passkey: recent, enrol_totp: false, revoke_session: recent, label_security_item: recent },
    factors: { totp: { enrolled: true, removable: recent }, passkeys: [
      { credential_id: 'first-key', label: '', created_at: 'today', last_used_at: null, usable: true, removable: recent },
      { credential_id: 'second-key', label: '', created_at: 'yesterday', last_used_at: 'today', usable: true, removable: recent },
    ] },
    sessions: [
      { session_id: 'login-a', label: '', current: true, auth_method: 'passkey', created_at: 'today', expires_at: 'tomorrow' },
      { session_id: 'other-login', label: '', current: false, auth_method: 'totp', created_at: 'yesterday', expires_at: 'tomorrow' },
    ],
  };
}

browserTest('legacy-held input offers only confirmed dismissal, preserves retry key and requires a separately submitted prompt',async()=>{
  const page=await browser.newPage();
  try{
    await fixture(page);let held=true;const writes:any[]=[];
    await page.route('**/agent/message-recovery?**',route=>route.fulfill({json:held?{state:'legacy-held',message_rowid:71}:{state:'idle'}}));
    await page.route('**/agent/message-recovery',route=>{writes.push({body:route.request().postDataJSON(),headers:route.request().headers()});if(writes.length===1)return route.fulfill({status:500,json:{}});held=false;return route.fulfill({json:{recovered:true}});});
    await page.goto(base);await ready(page);expect(await page.locator('#retry-message').isVisible()).toBe(false);expect(await page.locator('#skip-message').isDisabled()).toBe(true);expect(await page.locator('#recovery-warning').textContent()).toContain('send a new plain-text prompt');
    await page.locator('#confirm-skip').check();await page.locator('#skip-message').click();await page.waitForFunction(()=>document.getElementById('family-error')?.textContent?.includes('same action'));
    expect(writes).toHaveLength(1);expect(writes[0].body.action).toBe('dismiss-legacy');expect(writes[0].body.message_rowid).toBe(71);expect(writes[0].headers['x-piclaw-account-id']).toBe('alice');
    await page.locator('#skip-message').click();await page.waitForFunction(()=>(document.getElementById('message-recovery') as HTMLElement)?.hidden);expect(writes).toHaveLength(2);expect(writes[1].body.request_id).toBe(writes[0].body.request_id);expect(await page.locator('#message-text').inputValue()).toBe('');
  }finally{await page.close();}
},20000);

browserTest('legacy hold confirmation clears on blur and replacement login cannot render a late dismissal',async()=>{
  const page=await browser.newPage();
  try{
    const state=await fixture(page);await page.route('**/agent/message-recovery?**',route=>route.fulfill({json:{state:'legacy-held',message_rowid:71}}));
    await page.goto(base);await ready(page);await page.locator('#confirm-skip').check();await page.evaluate(()=>dispatchEvent(new Event('blur')));expect(await page.locator('#confirm-skip').isChecked()).toBe(false);expect(await page.locator('#recovery-status').textContent()).toBe('');
    await page.evaluate(()=>dispatchEvent(new Event('focus')));await ready(page);expect(await page.locator('#skip-message').isDisabled()).toBe(true);
    let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);await page.route('**/agent/message-recovery',async route=>{entered();await held;await route.fulfill({json:{recovered:true}});});
    await page.locator('#confirm-skip').check();await page.locator('#skip-message').click();await waiting;state.identity=principal('bob','login-b');release();await page.waitForFunction(()=>document.getElementById('family-status')?.textContent?.includes('no longer bound'));expect(await page.locator('#message-recovery').isVisible()).toBe(false);expect(await page.locator('#message-text').inputValue()).toBe('');
  }finally{await page.close();}
},20000);
async function openAccount(page: Page) {
  await page.goto(base); await ready(page); await page.locator('#open-account').click();
  await page.waitForFunction(() => !(document.getElementById('account-details') as HTMLElement)?.hidden);
}

function modelDefaultsSnapshot() {
  return { user_id: 'alice', preferences: { revision: 0, model: null as string | null, thinking_level: null as string | null }, can_edit: true,
    models: [{ label: 'test/reasoning', name: '<script>Reasoning</script>', thinking_levels: ['off','low','high'] }, { label: 'test/plain', name: 'Plain', thinking_levels: ['off'] }],
    effective: { model: 'test/plain', thinking_level: 'off' as string | null, source: 'instance', available: true } };
}
async function openModelDefaults(page: Page) {
  await page.goto(base); await ready(page); await page.locator('#open-preferences').click();
  await page.waitForFunction(() => !(document.getElementById('model-defaults-form') as HTMLElement)?.hidden);
}

browserTest('model defaults use supplied catalogue/levels, exact revisions and reset without switching sessions or shared settings', async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 740 } });
  try {
    await fixture(page); let value = modelDefaultsSnapshot(); const writes: any[] = [];
    await page.route('**/account/model-defaults', route => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON(); writes.push({ body, headers: route.request().headers() });
        value = { ...value, preferences: { revision: value.preferences.revision+1, model: body.model, thinking_level: body.thinking_level }, effective: { model: body.model ?? 'test/plain', thinking_level: body.thinking_level ?? 'off', source: body.model ? 'account' : 'instance', available: true } };
      }
      return route.fulfill({ json: value });
    });
    await openModelDefaults(page); const url = page.url(); expect(await page.locator('#default-thinking').isDisabled()).toBe(true);
    expect(await page.locator('#default-model option').allTextContents()).toContain('<script>Reasoning</script> · test/reasoning'); expect(await page.locator('#model-defaults-form script').count()).toBe(0);
    await page.locator('#default-model').selectOption('test/reasoning'); await page.locator('#default-thinking').selectOption('high'); await page.locator('#save-model-defaults').click();
    await page.waitForFunction(() => document.getElementById('model-defaults-status')?.textContent?.startsWith('Model defaults saved'));
    expect(writes[0].body).toEqual({ expected_revision: 0, model: 'test/reasoning', thinking_level: 'high' }); expect(writes[0].headers['x-piclaw-account-id']).toBe('alice'); expect(writes[0].headers['x-piclaw-login-id']).toBe('login-a');
    expect(await page.locator('#model-defaults-effective').textContent()).toContain('Configured account default: test/reasoning');
    await page.locator('#default-model').selectOption('test/plain'); expect(await page.locator('#default-thinking option').allTextContents()).toEqual(['Use instance thinking default', 'off']);
    await page.locator('#reset-model-defaults').click(); expect(writes).toHaveLength(1); await page.locator('#save-model-defaults').click(); await page.waitForFunction(() => document.getElementById('model-defaults-status')?.textContent?.startsWith('Model defaults saved'));
    expect(writes[1].body).toEqual({ expected_revision: 1, model: null, thinking_level: null }); expect(page.url()).toBe(url);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(await page.evaluate(() => [localStorage.length,sessionStorage.length])).toEqual([0,0]);
  } finally { await page.close(); }
}, 20000);

browserTest('unavailable defaults remain visible/resettable; server errors disable writes until refresh, malformed capabilities fail closed', async () => {
  const page = await browser.newPage();
  try {
    await fixture(page); const value = modelDefaultsSnapshot(); value.preferences = { revision: 2, model: 'test/missing', thinking_level: 'high' }; value.effective = { model: 'test/missing', thinking_level: null, source: 'account', available: false }; let writes = 0;
    await page.route('**/account/model-defaults', route => {
      if (route.request().method() === 'PATCH') { writes++; return route.fulfill({ status: 400, json: {} }); }
      return route.fulfill({ json: value });
    });
    await openModelDefaults(page); expect(await page.locator('#default-model').inputValue()).toBe('test/missing'); expect(await page.locator('#model-defaults-effective').textContent()).toContain('unavailable');
    await page.locator('#reset-model-defaults').click(); await page.locator('#save-model-defaults').click(); await page.waitForFunction(() => document.getElementById('model-defaults-status')?.textContent?.includes('No automatic retry'));
    expect(writes).toBe(1); expect(await page.locator('#save-model-defaults').isDisabled()).toBe(true);
    await page.locator('#refresh-model-defaults').click(); await page.waitForFunction(() => !(document.getElementById('save-model-defaults') as HTMLButtonElement)?.disabled);
    value.can_edit = undefined as any; await page.locator('#refresh-model-defaults').click(); await page.waitForFunction(() => !(document.getElementById('model-defaults-form') as HTMLElement)?.hidden); expect(await page.locator('#save-model-defaults').isDisabled()).toBe(true);
    value.models[0]!.thinking_levels = ['unsafe']; await page.locator('#refresh-model-defaults').click(); await page.waitForFunction(() => document.getElementById('model-defaults-status')?.textContent === 'Invalid model choices.'); expect(await page.locator('#model-defaults-form').isVisible()).toBe(false);
  } finally { await page.close(); }
}, 20000);

browserTest('model draft clears on blur/close and delayed former-login save cannot restore choices', async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page); await openModelDefaults(page);
    await page.locator('#default-model').selectOption('test/reasoning'); await page.locator('#default-thinking').selectOption('high');
    await page.evaluate(() => dispatchEvent(new Event('blur'))); expect(await page.locator('#default-model option').count()).toBe(0); expect(await page.locator('#model-defaults-effective').textContent()).toBe('');
    await page.evaluate(() => dispatchEvent(new Event('focus'))); await page.waitForFunction(() => !(document.getElementById('model-defaults-form') as HTMLElement)?.hidden);
    expect(await page.locator('#default-model').inputValue()).toBe('');
    let release!: () => void, entered!: () => void; const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
    await page.route('**/account/model-defaults', async route => { if (route.request().method() === 'PATCH') { entered(); await held; } await route.fulfill({ json: modelDefaultsSnapshot() }); });
    await page.locator('#default-model').selectOption('test/reasoning'); await page.locator('#save-model-defaults').click(); await waiting;
    await page.locator('#close-preferences').click(); expect(await page.locator('#default-model option').count()).toBe(0);
    state.identity = principal('bob','new-login'); release(); await page.waitForFunction(() => document.getElementById('family-status')?.textContent?.includes('no longer bound'));
    expect(await page.locator('#default-model option').count()).toBe(0); expect(await page.locator('#model-defaults-form').isVisible()).toBe(false);
  } finally { await page.close(); }
}, 20000);

browserTest('account avatar uploads pinned raster bytes, confirms deletion and releases blob URLs/drafts without storage', async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 740 } });
  try {
    await fixture(page); await page.route('**/account', route => route.fulfill({ json: accountSnapshot() }));
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).webp().toBuffer();
    let value = { user_id: 'alice', revision: 0, present: false, can_edit: true }; const writes: any[] = [], reads: any[] = [];
    await page.addInitScript(() => { const revoke = URL.revokeObjectURL; (window as any).revoked = []; URL.revokeObjectURL = url => { (window as any).revoked.push(url); revoke(url); }; });
    await page.route('**/account/avatar', route => {
      const method = route.request().method();
      if (method !== 'GET') { writes.push({ method, headers: route.request().headers(), body: route.request().postDataBuffer() }); value = { ...value, revision: value.revision+1, present: method === 'POST' }; }
      return route.fulfill({ json: value });
    });
    await page.route('**/account/avatar/image', route => { reads.push(route.request().headers()); return route.fulfill({ contentType: 'image/webp', body: bytes }); });
    await openAccount(page); await page.waitForFunction(() => !(document.getElementById('account-avatar-file') as HTMLInputElement)?.disabled);
    await page.locator('#account-avatar-file').setInputFiles({ name: 'private.webp', mimeType: 'image/webp', buffer: bytes });
    expect(writes).toHaveLength(0); expect(await page.locator('#account-avatar-image').getAttribute('src')).toBeNull();
    await page.locator('#save-account-avatar').click(); await page.waitForFunction(() => document.getElementById('account-avatar-status')?.textContent === 'Avatar saved.');
    expect(writes[0].headers['x-piclaw-account-id']).toBe('alice'); expect(writes[0].headers['x-piclaw-login-id']).toBe('login-a'); expect(writes[0].headers['x-piclaw-avatar-revision']).toBe('0'); expect(writes[0].body).toEqual(bytes);
    expect(reads[0]['x-piclaw-login-id']).toBe('login-a'); const url = await page.locator('#account-avatar-image').getAttribute('src'); expect(url?.startsWith('blob:')).toBe(true);
    expect(await page.locator('#remove-account-avatar').isDisabled()).toBe(true);
    await page.locator('#account-avatar-file').setInputFiles({ name: 'unsaved.webp', mimeType: 'image/webp', buffer: bytes });
    await page.evaluate(() => dispatchEvent(new Event('blur')));
    expect(await page.locator('#account-avatar-image').getAttribute('src')).toBeNull(); expect(await page.locator('#account-avatar-file').inputValue()).toBe('');
    expect(await page.evaluate(() => (window as any).revoked)).toContain(url);
    await page.evaluate(() => dispatchEvent(new Event('focus'))); await page.waitForFunction(() => !(document.getElementById('account-avatar-confirm') as HTMLInputElement)?.disabled);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#account-avatar-confirm').check(); await page.locator('#remove-account-avatar').click(); await page.waitForFunction(() => document.getElementById('account-avatar-status')?.textContent === 'Avatar removed.');
    expect(JSON.parse(writes[1].body.toString())).toEqual({ expected_revision: 1 }); expect(await page.locator('#account-avatar-image').getAttribute('src')).toBeNull();
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  } finally { await page.close(); }
}, 20000);

browserTest('avatar images admitted before close or login replacement never reappear and always recheck identity', async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page); await page.route('**/account', route => route.fulfill({ json: accountSnapshot() }));
    await page.route('**/account/avatar', route => route.fulfill({ json: { user_id: 'alice', revision: 1, present: true, can_edit: true } }));
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).webp().toBuffer();
    let release!: () => void, entered!: () => void; let held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
    await page.route('**/account/avatar/image', async route => { entered(); await held; await route.fulfill({ contentType: 'image/webp', body: bytes }); });
    await openAccount(page); await waiting; await page.locator('#close-account').click(); release();
    await page.waitForTimeout(100); expect(await page.locator('#account-avatar-image').getAttribute('src')).toBeNull();
    held = new Promise<void>(r => release = r); waiting = new Promise<void>(r => entered = r);
    await page.locator('#open-account').click(); await waiting; state.identity = principal('bob', 'login-b'); release();
    await page.waitForFunction(() => document.getElementById('family-status')?.textContent?.includes('no longer bound'));
    expect(await page.locator('#account-avatar-image').getAttribute('src')).toBeNull(); expect(await page.locator('#account-avatar-file').inputValue()).toBe('');
  } finally { await page.close(); }
}, 20000);

browserTest('avatar validation/capabilities fail closed and failed writes require explicit refresh without retries', async () => {
  const page = await browser.newPage();
  try {
    await fixture(page); await page.route('**/account', route => route.fulfill({ json: accountSnapshot() })); let editable: any = undefined, writes = 0;
    await page.route('**/account/avatar', route => { if (route.request().method() === 'POST') { writes++; return route.fulfill({ status: 400, json: {} }); } return route.fulfill({ json: { user_id: 'alice', revision: 0, present: false, can_edit: editable } }); });
    await openAccount(page); await page.waitForFunction(() => document.getElementById('account-avatar-status')?.textContent === 'No account avatar.');
    expect(await page.locator('#account-avatar-file').isDisabled()).toBe(true); editable = true; await page.locator('#refresh-account-avatar').click(); await page.waitForFunction(() => !(document.getElementById('account-avatar-file') as HTMLInputElement)?.disabled);
    await page.locator('#account-avatar-file').setInputFiles({ name: 'evil.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') }); expect(await page.locator('#account-avatar-file').inputValue()).toBe(''); expect(await page.locator('#save-account-avatar').isDisabled()).toBe(true);
    await page.locator('#account-avatar-file').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(2*1024*1024+1) }); expect(await page.locator('#account-avatar-file').inputValue()).toBe('');
    await page.locator('#account-avatar-file').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from('server validates bytes') }); await page.locator('#save-account-avatar').click();
    await page.waitForFunction(() => document.getElementById('account-avatar-status')?.textContent?.includes('Refresh before trying again'));
    expect(writes).toBe(1); expect(await page.locator('#save-account-avatar').isDisabled()).toBe(true); expect(await page.locator('#account-avatar-file').isDisabled()).toBe(true);
    await page.locator('#refresh-account-avatar').click(); await page.waitForFunction(() => !(document.getElementById('account-avatar-file') as HTMLInputElement)?.disabled); expect(writes).toBe(1);
  } finally { await page.close(); }
}, 20000);

browserTest('account preferences load/apply theme, save revisioned guidance and reset defaults without browser storage', async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 740 }, colorScheme: 'light' });
  try {
    await fixture(page); const value = { user_id: 'alice', preferences: { revision: 1, theme: 'dark', response_guidance: 'British English' }, defaults: { theme: 'system', response_guidance: '' }, can_edit: true };
    const writes: any[] = [];
    await page.route('**/account/preferences', route => {
      if (route.request().method() === 'PATCH') { const body = route.request().postDataJSON(); writes.push({ body, headers: route.request().headers() }); value.preferences = { revision: value.preferences.revision+1, theme: body.theme, response_guidance: body.response_guidance }; }
      return route.fulfill({ json: value });
    });
    await page.goto(base); await ready(page); expect(await page.locator('html').getAttribute('data-account-theme')).toBe('dark');
    await page.locator('#open-preferences').click(); await page.waitForFunction(() => !(document.getElementById('preferences-form') as HTMLElement)?.hidden);
    expect(await page.locator('#preferences-guidance').inputValue()).toBe('British English');
    await page.locator('#preferences-theme').selectOption('light'); await page.locator('#preferences-guidance').fill('  Use concise bullets.  '); await page.locator('#save-preferences').click();
    await page.waitForFunction(() => document.getElementById('preferences-status')?.textContent?.startsWith('Preferences saved'));
    expect(writes[0].body).toEqual({ expected_revision: 1, theme: 'light', response_guidance: 'Use concise bullets.' });
    expect(writes[0].headers['x-piclaw-account-id']).toBe('alice'); expect(writes[0].headers['x-piclaw-login-id']).toBe('login-a');
    expect(await page.locator('html').getAttribute('data-account-theme')).toBe('light');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload(); await ready(page); expect(await page.locator('html').getAttribute('data-account-theme')).toBe('light');
    await page.locator('#open-preferences').click(); await page.waitForFunction(() => !(document.getElementById('preferences-form') as HTMLElement)?.hidden);
    await page.locator('#reset-preferences').click(); expect(writes).toHaveLength(1); await page.locator('#save-preferences').click();
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-account-theme'));
    expect(writes[1].body).toEqual({ expected_revision: 2, theme: 'system', response_guidance: '' });
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  } finally { await page.close(); }
}, 20000);

browserTest('preference draft and theme clear on blur; late replacement-login saves never apply', async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page); const value = { user_id: 'alice', preferences: { revision: 1, theme: 'dark', response_guidance: 'Private preference' }, defaults: { theme: 'system', response_guidance: '' }, can_edit: true };
    await page.route('**/account/preferences', route => route.fulfill({ json: value }));
    await page.goto(base); await ready(page); await page.locator('#open-preferences').click(); await page.waitForFunction(() => !(document.getElementById('preferences-form') as HTMLElement)?.hidden);
    await page.locator('#preferences-guidance').fill('UNSAVED_PRIVATE'); await page.evaluate(() => dispatchEvent(new Event('blur')));
    expect(await page.locator('#preferences-guidance').inputValue()).toBe(''); expect(await page.locator('html').getAttribute('data-account-theme')).toBeNull();
    await page.evaluate(() => dispatchEvent(new Event('focus'))); await page.waitForFunction(() => !(document.getElementById('preferences-form') as HTMLElement)?.hidden);
    expect(await page.locator('#preferences-guidance').inputValue()).toBe('Private preference');
    let release!: () => void, entered!: () => void; const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
    await page.route('**/account/preferences', async route => { if (route.request().method() === 'PATCH') { entered(); await held; } await route.fulfill({ json: value }); });
    await page.locator('#save-preferences').click(); await waiting; state.identity = principal('bob', 'new-login'); release();
    await page.waitForFunction(() => document.getElementById('family-status')?.textContent?.includes('no longer bound'));
    expect(await page.locator('#preferences-guidance').inputValue()).toBe(''); expect(await page.locator('html').getAttribute('data-account-theme')).toBeNull();
  } finally { await page.close(); }
}, 20000);

browserTest('stale preference save requires explicit refresh and keeps dirty form out of polling updates', async () => {
  const page = await browser.newPage();
  try {
    await fixture(page); let writes = 0;
    await page.route('**/account/preferences', route => {
      if (route.request().method() === 'PATCH') { writes++; return route.fulfill({ status: 400, json: {} }); }
      return route.fulfill({ json: { user_id: 'alice', preferences: { revision: 2, theme: 'system', response_guidance: 'Server guidance' }, defaults: { theme: 'system', response_guidance: '' }, can_edit: true } });
    });
    await page.goto(base); await ready(page); await page.locator('#open-preferences').click(); await page.waitForFunction(() => !(document.getElementById('preferences-form') as HTMLElement)?.hidden);
    await page.locator('#preferences-guidance').fill('Dirty guidance'); await page.locator('#refresh').click(); await ready(page);
    expect(await page.locator('#preferences-guidance').inputValue()).toBe('Dirty guidance');
    await page.locator('#save-preferences').click(); await page.waitForFunction(() => document.getElementById('preferences-status')?.textContent?.includes('No automatic retry'));
    expect(writes).toBe(1); expect(await page.locator('#save-preferences').isDisabled()).toBe(true);
    await page.locator('#refresh-preferences').click(); await page.waitForFunction(() => !(document.getElementById('save-preferences') as HTMLButtonElement)?.disabled);
    expect(await page.locator('#preferences-guidance').inputValue()).toBe('Server guidance');
  } finally { await page.close(); }
}, 20000);

browserTest('a different account starts with its own appearance and cannot inherit former guidance after reload', async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page);
    await page.route('**/account/preferences', route => route.fulfill({ json: {
      user_id: state.identity.principal.userId, preferences: { revision: 1, theme: state.identity.principal.userId === 'alice' ? 'dark' : 'light', response_guidance: state.identity.principal.userId === 'alice' ? 'ALICE_ONLY' : 'BOB_ONLY' }, defaults: { theme: 'system', response_guidance: '' }, can_edit: true,
    } }));
    await page.goto(base); await ready(page); await page.locator('#open-preferences').click(); await page.waitForFunction(() => !(document.getElementById('preferences-form') as HTMLElement)?.hidden);
    expect(await page.locator('#preferences-guidance').inputValue()).toBe('ALICE_ONLY');
    state.identity = principal('bob', 'login-b');
    await page.route('**/agent/branches', route => route.fulfill({ json: { branches: [{ chat_jid: 'web:bob', root_chat_jid: 'web:bob', agent_name: 'home' }] } }));
    await page.reload(); await ready(page); await page.locator('#open-preferences').click(); await page.waitForFunction(() => !(document.getElementById('preferences-form') as HTMLElement)?.hidden);
    expect(await page.locator('html').getAttribute('data-account-theme')).toBe('light'); expect(await page.locator('#preferences-guidance').inputValue()).toBe('BOB_ONLY');
    expect(await page.locator('#preferences-guidance').inputValue()).not.toContain('ALICE_ONLY');
  } finally { await page.close(); }
}, 20000);

function workspacePolicyFixture(): FamilyWorkspacePolicy {
  return {
    user_id: 'alice', deployment: { routing_mode: 'family-shared', configured_mode: 'family-shared', activated_mode: 'single-user', supported_startup_mode: 'single-user', activation_allowed: false, container_isolation: false },
    tools: { policy: 'fixed-family-web-preview', configurable: false, allowed: [...FAMILY_WEB_TOOLS], denied: [], revision: 0, scope: 'Fixed ceiling, not configurable user grants.' },
    resources: [{ name: 'Workspace files', scope: 'shared', detail: 'Shared filesystem, not private volumes.' }],
    operations: [{ name: 'Shell', state: 'denied', detail: 'Not enabled for admitted web turns.' }],
    settings: [{ name: 'Providers', scope: 'shared', availability: 'No editor' }],
    memory: { personal: ['notes/users/alice/MEMORY.md', 'notes/users/alice/preferences.md'], family: 'notes/family/MEMORY.md' },
  };
}
async function openWorkspacePolicy(page: Page) {
  await page.goto(base); await ready(page); await page.locator('#open-workspace-policy').click();
  await page.waitForFunction(() => Boolean(document.getElementById('workspace-policy-details')?.textContent));
}

browserTest('workspace policy distinguishes gated modes, shared resources and tool ceiling without offering writes', async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 740 } });
  try {
    await fixture(page); const calls: any[] = [];
    await page.route('**/account/workspace', route => { calls.push({ method: route.request().method(), headers: route.request().headers() }); return route.fulfill({ json: workspacePolicyFixture() }); });
    await openWorkspacePolicy(page);
    const text = await page.locator('#workspace-policy-details').textContent();
    expect(text).toContain('configured mode: family-shared'); expect(text).toContain('stored activation marker: single-user'); expect(text).toContain('not container isolation');
    expect(text).toContain('read, ls, find, grep'); expect(text).toContain('notes/users/alice/MEMORY.md'); expect(text).toContain('Shell — denied');
    expect(await page.locator('#workspace-policy-details input, #workspace-policy-details button, #workspace-policy-details a').count()).toBe(0);
    expect(calls.every(c => c.method === 'GET' && c.headers['x-piclaw-account-id'] === 'alice' && c.headers['x-piclaw-login-id'] === 'login-a')).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator('#refresh-workspace-policy').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  } finally { await page.close(); }
}, 20000);

browserTest('workspace policy clears on blur/navigation and rejects late former-account or malformed activation responses', async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page);
    await page.route('**/account/workspace', route => route.fulfill({ json: workspacePolicyFixture() }));
    await openWorkspacePolicy(page); await page.evaluate(() => dispatchEvent(new Event('blur')));
    expect(await page.locator('#workspace-policy-details').textContent()).toBe('');
    await page.evaluate(() => dispatchEvent(new Event('focus'))); await page.waitForFunction(() => Boolean(document.getElementById('workspace-policy-details')?.textContent));
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
    await page.route('**/account/workspace', async route => { entered(); await held; const value = workspacePolicyFixture(); value.memory.personal = ['STALE_PATH']; await route.fulfill({ json: value }); });
    await page.locator('#refresh-workspace-policy').click(); await waiting; state.identity = principal('bob', 'new-login'); release();
    await page.waitForFunction(() => document.getElementById('family-status')?.textContent?.includes('no longer bound'));
    expect(await page.locator('#workspace-policy-details').textContent()).toBe('');
    state.identity = principal(); await page.route('**/account/workspace', route => route.fulfill({ json: { ...workspacePolicyFixture(), deployment: { ...workspacePolicyFixture().deployment, activation_allowed: true } } }));
    await page.reload(); await ready(page); await page.locator('#open-workspace-policy').click();
    await page.waitForFunction(() => document.getElementById('workspace-policy-status')?.textContent?.includes('Unsupported'));
    expect(await page.locator('#workspace-policy-details').textContent()).toBe('');
  } finally { await page.close(); }
}, 20000);

browserTest('security item names are owner-pinned, plain text, clearable and distinct from revoke actions', async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 740 } });
  try {
    await fixture(page); const snapshot = accountSnapshot(), writes: any[] = [];
    await page.route('**/account', route => route.fulfill({ json: snapshot }));
    await page.route(/\/account\/(factors\/passkey\/first-key|sessions\/other-login)$/, route => {
      const label = route.request().postDataJSON().label.trim(); writes.push({ label, path: route.request().url(), method: route.request().method(), headers: route.request().headers() });
      if (route.request().url().includes('passkey')) snapshot.factors.passkeys[0]!.label = label; else snapshot.sessions[1]!.label = label;
      return route.fulfill({ json: { label } });
    });
    await openAccount(page);
    await page.getByRole('button', { name: 'Name passkey first-key', exact: true }).click();
    await page.locator('#account-label').fill('<b>Hardware key</b>'); await page.locator('#account-label-save').click();
    await page.waitForFunction(() => document.getElementById('account-status')?.textContent?.startsWith('Name saved'));
    expect(await page.locator('#account-passkeys').textContent()).toContain('<b>Hardware key</b>'); expect(await page.locator('#account-passkeys b').count()).toBe(0);
    await page.getByRole('button', { name: 'Name device login other-login', exact: true }).click();
    await page.locator('#account-label').fill('Tablet'); await page.locator('#account-label-save').click();
    await page.waitForFunction(() => document.getElementById('account-sessions')?.textContent?.includes('Tablet'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Name passkey first-key', exact: true }).click(); await page.locator('#account-label').fill(''); await page.locator('#account-label-save').click();
    await page.waitForFunction(() => !document.getElementById('account-passkeys')?.textContent?.includes('Hardware key'));
    expect(writes.map(w => w.label)).toEqual(['<b>Hardware key</b>', 'Tablet', '']);
    expect(writes.every(w => w.method === 'PATCH' && w.headers['x-piclaw-account-id'] === 'alice' && w.headers['x-piclaw-login-id'] === 'login-a')).toBe(true);
    expect(await page.locator('#account-passkeys li').count()).toBe(2); expect(await page.locator('#account-sessions li').count()).toBe(2);
  } finally { await page.close(); }
}, 20000);

browserTest('label capabilities fail closed and draft/late response cannot survive login replacement', async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page); let snapshot = accountSnapshot(false);
    await page.route('**/account', route => route.fulfill({ json: snapshot }));
    await openAccount(page); expect(await page.getByRole('button', { name: 'Name passkey first-key', exact: true }).isDisabled()).toBe(true);
    snapshot = accountSnapshot(); await page.locator('#refresh-account').click();
    await page.waitForFunction(() => !(document.querySelector('[aria-label="Name passkey first-key"]') as HTMLButtonElement)?.disabled);
    await page.getByRole('button', { name: 'Name passkey first-key', exact: true }).click(); await page.locator('#account-label').fill('PRIVATE_NAME');
    await page.evaluate(() => dispatchEvent(new Event('blur'))); expect(await page.locator('#account-label').inputValue()).toBe('');
    await page.evaluate(() => dispatchEvent(new Event('focus'))); await page.waitForFunction(() => !(document.getElementById('account-details') as HTMLElement)?.hidden);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
    await page.route('**/account/factors/passkey/first-key', async route => { entered(); await held; await route.fulfill({ json: { label: 'STALE_NAME' } }); });
    await page.getByRole('button', { name: 'Name passkey first-key', exact: true }).click(); await page.locator('#account-label').fill('STALE_NAME'); await page.locator('#account-label-save').click(); await waiting;
    state.identity = principal('bob', 'new-login'); release();
    await page.waitForFunction(() => document.getElementById('family-status')?.textContent?.includes('no longer bound'));
    expect(await page.locator('#account-label').inputValue()).toBe(''); expect(await page.locator('#account-label-form').isVisible()).toBe(false);
    expect(await page.locator('body').textContent()).not.toContain('STALE_NAME');
  } finally { await page.close(); }
}, 20000);

browserTest('label length errors prevent writes and server failures never trigger automatic retry', async () => {
  const page = await browser.newPage();
  try {
    await fixture(page); let writes = 0;
    await page.route('**/account', route => route.fulfill({ json: accountSnapshot() }));
    await page.route('**/account/factors/passkey/first-key', route => { writes++; return route.fulfill({ status: 500, json: {} }); });
    await openAccount(page); await page.getByRole('button', { name: 'Name passkey first-key', exact: true }).click();
    await page.locator('#account-label').fill('a'.repeat(81)); await page.locator('#account-label-save').click();
    await page.waitForFunction(() => document.getElementById('account-status')?.textContent?.includes('80 characters')); expect(writes).toBe(0);
    await page.locator('#account-label').fill('Valid'); await page.locator('#account-label-save').click();
    await page.waitForFunction(() => document.getElementById('account-status')?.textContent?.includes('Refresh before trying')); expect(writes).toBe(1);
  } finally { await page.close(); }
}, 20000);

async function totpFixture(page: Page) {
  const state = await fixture(page), snapshot = accountSnapshot(); snapshot.factors.totp.enrolled = false; snapshot.capabilities.enrol_totp = true;
  const calls: any[] = [];
  const setup = { token: 't'.repeat(43), secret: 'A'.repeat(32), expires_at: Date.now()+60_000, qr_data_url: 'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') };
  await page.route('**/account', route => route.fulfill({ json: snapshot }));
  await page.route('**/account/totp/*', route => {
    calls.push({ path: new URL(route.request().url()).pathname, headers: route.request().headers(), body: route.request().postDataJSON() });
    if (route.request().url().endsWith('/start')) return route.fulfill({ json: setup });
    if (route.request().url().endsWith('/confirm')) { snapshot.factors.totp.enrolled = true; snapshot.capabilities.enrol_totp = false; return route.fulfill({ json: { enrolled: true } }); }
    return route.fulfill({ json: { cancelled: true } });
  });
  return { state, snapshot, calls, setup };
}

browserTest('self authenticator setup is explicit, pinned, confirms without login changes and clears secret', async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 740 } });
  try {
    const { calls } = await totpFixture(page); await openAccount(page);
    expect(calls).toHaveLength(0); await page.locator('#account-add-totp').click();
    await page.waitForFunction(() => document.getElementById('account-totp-secret')?.textContent?.length === 32);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('#account-totp-qr').getAttribute('src')).toStartWith('data:image/svg+xml;base64,');
    await page.locator('#account-totp-code').fill('123456'); await page.locator('#account-totp-confirm').click();
    await page.waitForFunction(() => document.getElementById('account-totp-status')?.textContent === 'Authenticator enrolled');
    expect(calls[1].body).toEqual({ token: 't'.repeat(43), code: '123456' });
    expect(calls.every(c => c.headers['x-piclaw-account-id'] === 'alice' && c.headers['x-piclaw-login-id'] === 'login-a')).toBe(true);
    expect(await page.locator('#account-totp-secret').textContent()).toBe(''); expect(await page.locator('#account-totp-qr').getAttribute('src')).toBeNull();
    expect(await page.locator('#account-add-totp').isDisabled()).toBe(true); expect(page.url()).not.toContain('token');
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  } finally { await page.close(); }
}, 20000);

browserTest('authenticator cancel, blur, expiry and late start never retain setup secrets', async () => {
  const page = await browser.newPage();
  try {
    const { calls, setup } = await totpFixture(page); await openAccount(page);
    const begin = async () => { await page.locator('#account-add-totp').click(); await page.waitForFunction(() => document.getElementById('account-totp-secret')?.textContent?.length === 32); };
    await begin(); await page.locator('#account-totp-cancel').click();
    await page.waitForFunction(() => !(document.getElementById('account-add-totp') as HTMLButtonElement)?.disabled);
    expect(calls[1].path).toBe('/account/totp/cancel'); expect(await page.locator('#account-totp-secret').textContent()).toBe('');
    await begin(); await page.evaluate(() => dispatchEvent(new Event('blur')));
    expect(await page.locator('#account-totp-secret').textContent()).toBe(''); expect(await page.locator('#account-totp-qr').getAttribute('src')).toBeNull();
    await page.evaluate(() => dispatchEvent(new Event('focus'))); await page.waitForFunction(() => !(document.getElementById('account-add-totp') as HTMLButtonElement)?.disabled);
    setup.expires_at = Date.now()+1000; await begin();
    await page.waitForFunction(() => !document.getElementById('account-totp-secret')?.textContent);
    await page.waitForFunction(() => !(document.getElementById('account-add-totp') as HTMLButtonElement)?.disabled);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
    await page.route('**/account/totp/start', async route => { entered(); await held; await route.fulfill({ json: { ...setup, expires_at: Date.now()+60000 } }); });
    await page.locator('#account-add-totp').click(); await waiting; await page.locator('#close-account').click(); release();
    await page.waitForTimeout(80); expect(await page.locator('#account-totp-secret').textContent()).toBe('');
  } finally { await page.close(); }
}, 20000);

browserTest('bad authenticator code retains bounded setup for manual retry; replaced login erases it', async () => {
  const page = await browser.newPage();
  try {
    const { state } = await totpFixture(page); let attempts = 0;
    await page.route('**/account/totp/confirm', route => { attempts++; return route.fulfill({ status: 403, json: {} }); });
    await openAccount(page); await page.locator('#account-add-totp').click(); await page.waitForFunction(() => document.getElementById('account-totp-secret')?.textContent?.length === 32);
    await page.locator('#account-totp-code').fill('111111'); await page.locator('#account-totp-confirm').click();
    await page.waitForFunction(() => document.getElementById('account-status')?.textContent?.includes('Only five attempts'));
    expect(attempts).toBe(1); expect(await page.locator('#account-totp-secret').textContent()).toHaveLength(32);
    state.identity = principal('bob', 'new-login'); await page.locator('#refresh-account').click();
    await page.waitForFunction(() => document.getElementById('family-status')?.textContent?.includes('no longer bound'));
    expect(await page.locator('#account-totp-secret').textContent()).toBe(''); expect(await page.locator('#account-totp-code').inputValue()).toBe('');
  } finally { await page.close(); }
}, 20000);

async function adminFixture(page: Page) {
  const state = await fixture(page); state.identity.principal.role = 'admin'; state.identity.capabilities.manage_users = true;
  const snapshot: AdministrationSettings = { recent_auth: true, capabilities: { create_user: true }, users: [
    { id: 'alice', username: 'alice', display_name: 'Alice', role: 'admin', enabled: true, invitation: 'none', capabilities: { disable: false, enable: false, change_role: false, invite: false, revoke_invitation: false, reset: false, inspect_security: false, assign_home: false, restrict_tools: true } },
    { id: 'bob', username: 'bob', display_name: 'Bob', role: 'member', enabled: true, invitation: 'none', capabilities: { disable: true, enable: false, change_role: true, invite: false, revoke_invitation: false, reset: true, inspect_security: true, assign_home: true, restrict_tools: true } },
    { id: 'pending', username: 'pending', display_name: 'Pending', role: 'member', enabled: false, invitation: 'none', capabilities: { disable: false, enable: false, change_role: true, invite: true, revoke_invitation: false, reset: true, inspect_security: true, assign_home: true, restrict_tools: true } },
  ] };
  const mutations: { path: string; method: string; headers: Record<string, string>; body: any }[] = [];
  await page.route('**/admin/users/settings', route => route.fulfill({ json: snapshot }));
  await page.route(/\/admin\/users(?:\/(alice|bob|pending))?(?:\/(invitation|reset))?$/, route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method(), body = route.request().postData() ? route.request().postDataJSON() : null;
    mutations.push({ path, method, body, headers: route.request().headers() });
    if (path === '/admin/users') snapshot.users.push({ ...snapshot.users[2]!, id: 'created', username: body.username, display_name: body.displayName, role: body.role });
    else {
      const user = snapshot.users.find(u => path.split('/')[3] === u.id)!;
      if (method === 'PATCH') { Object.assign(user, body); user.capabilities.disable = user.enabled; user.capabilities.enable = !user.enabled; }
      if (path.endsWith('invitation')) { user.invitation = method === 'DELETE' ? 'none' : 'issued'; user.capabilities.revoke_invitation = method !== 'DELETE'; }
      if (path.endsWith('reset')) { user.enabled = false; user.invitation = 'issued'; user.capabilities.invite = user.capabilities.revoke_invitation = true; }
      if (method === 'POST') return route.fulfill({ json: { token: 'g'.repeat(43), expiresAt: Date.now()+60_000 } });
    }
    return route.fulfill({ json: {} });
  });
  return { state, snapshot, mutations };
}
async function openAdministration(page: Page) {
  await page.goto(base); await ready(page); await page.locator('#open-administration').click();
  await page.waitForFunction(() => document.querySelectorAll('#administration-users li').length > 0);
}
async function confirmAdministration(page: Page, username: string) {
  await page.locator('#administration-confirm-name').fill(username); await page.locator('#administration-confirm').check(); await page.locator('#submit-administration-action').click();
}

const adminSecurityFixture = () => ({ user: { id: 'bob', username: 'bob', display_name: 'Bob', enabled: true },
  factors: { totp: { enrolled: true, removable: false }, passkeys: [{ credential_id: 'bob-key', label: 'Security key', created_at: 'today', last_used_at: null, usable: true, removable: true }] },
  sessions: [{ session_id: 'bob-login', label: 'Tablet', auth_method: 'totp', created_at: 'today', expires_at: 'tomorrow' }],
});

const adminHomeFixture = () => ({ user: { id: 'bob', username: 'bob', enabled: true }, roots: [
  { branch_id: 'bob-root', agent_name: 'home', current: true }, { branch_id: 'bob-second', agent_name: 'research', current: false },
] });

browserTest('admin tool restrictions edit only the supplied ceiling with exact confirmation and revision', async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 740 } });
  try {
    await adminFixture(page); const writes: any[] = [];
    let denied: string[] = ['read'], revision = 1;
    await page.route('**/admin/users/bob/tools', route => {
      if (route.request().method() === 'PATCH') { const body = route.request().postDataJSON(); writes.push({ body, headers: route.request().headers() }); denied = body.denied_tools; revision++; return route.fulfill({ json: {} }); }
      return route.fulfill({ json: { user: { id: 'bob', username: 'bob' }, ceiling: [...FAMILY_WEB_TOOLS], policy: { revision, denied, allowed: FAMILY_WEB_TOOLS.filter(name => !denied.includes(name)) } } });
    });
    await openAdministration(page); const open = () => page.locator('#administration-users li').nth(1).getByRole('button', { name: 'Tool restrictions', exact: true }).click();
    await open(); await page.waitForFunction(() => document.querySelectorAll('#administration-tools-list input').length === 8);
    expect(await page.getByLabel('Deny read', { exact: true }).isChecked()).toBe(true);
    expect(await page.locator('#administration-tools-list').textContent()).not.toContain('bash');
    await page.getByLabel('Deny messages', { exact: true }).check(); await page.locator('#administration-tools-confirm').check();
    expect(await page.locator('#save-administration-tools').isDisabled()).toBe(true);
    await page.locator('#administration-tools-username').fill('bob'); await page.locator('#save-administration-tools').click();
    await page.waitForFunction(() => document.getElementById('administration-status')?.textContent === 'Account change saved.');
    expect(writes[0].body).toEqual({ confirm_username: 'bob', expected_revision: 1, denied_tools: ['read', 'messages'] });
    expect(writes[0].headers['x-piclaw-account-id']).toBe('alice'); expect(await page.locator('#session-select').inputValue()).toBe('web:alice');
    await open(); await page.waitForFunction(() => document.getElementById('administration-tools-title')?.textContent?.includes('revision 2'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => dispatchEvent(new Event('blur'))); expect(await page.locator('#administration-tools-list').textContent()).toBe('');
    expect(await page.locator('#administration-tools-username').inputValue()).toBe('');
  } finally { await page.close(); }
}, 20000);

browserTest('late tool policy and stale write conflict never restore another login or auto-retry', async () => {
  const page = await browser.newPage();
  try {
    const { state } = await adminFixture(page); let writes = 0;
    const value = { user: { id: 'bob', username: 'bob' }, ceiling: ['read'], policy: { revision: 0, denied: [], allowed: ['read'] } };
    await page.route('**/admin/users/bob/tools', route => {
      if (route.request().method() === 'PATCH') { writes++; return route.fulfill({ status: 400, json: {} }); }
      return route.fulfill({ json: value });
    });
    await openAdministration(page); const open = () => page.locator('#administration-users li').nth(1).getByRole('button', { name: 'Tool restrictions', exact: true }).click();
    await open(); await page.getByLabel('Deny read', { exact: true }).check(); await page.locator('#administration-tools-username').fill('bob'); await page.locator('#administration-tools-confirm').check(); await page.locator('#save-administration-tools').click();
    await page.waitForFunction(() => document.getElementById('administration-status')?.textContent?.includes('No automatic retry')); expect(writes).toBe(1);
    await page.locator('#refresh-administration').click(); await page.waitForFunction(() => !document.getElementById('administration-status')?.textContent);
    let release!: () => void, entered!: () => void; const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
    await page.route('**/admin/users/bob/tools', async route => { entered(); await held; await route.fulfill({ json: value }); });
    await open(); await waiting; state.identity = principal('bob', 'new-login'); release();
    await page.waitForFunction(() => document.getElementById('family-status')?.textContent?.includes('no longer bound'));
    expect(await page.locator('#administration-tools').isVisible()).toBe(false); expect(await page.locator('#administration-tools-list').textContent()).toBe('');
  } finally { await page.close(); }
}, 20000);

browserTest('admin home uses eligible server roots and exact confirmation without navigation or content links', async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 740 } });
  try {
    await adminFixture(page); const snapshot = adminHomeFixture(), writes: any[] = [];
    await page.route('**/admin/users/bob/home', route => {
      if (route.request().method() === 'PATCH') { writes.push({ body: route.request().postDataJSON(), headers: route.request().headers() }); for (const root of snapshot.roots) root.current = root.branch_id === writes[0].body.branch_id; return route.fulfill({ json: { changed: true } }); }
      return route.fulfill({ json: snapshot });
    });
    await openAdministration(page);
    expect(await page.locator('#administration-users li').first().getByRole('button', { name: 'Home', exact: true }).isDisabled()).toBe(true);
    const open = () => page.locator('#administration-users li').nth(1).getByRole('button', { name: 'Home', exact: true }).click();
    await open(); await page.waitForFunction(() => document.querySelectorAll('#administration-home-roots li').length === 2);
    expect(await page.locator('#administration-home-roots button').first().isDisabled()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('#administration-home a').count()).toBe(0);
    await page.locator('#administration-home-roots button').nth(1).click(); await page.locator('#administration-confirm').check();
    expect(await page.locator('#submit-administration-action').isDisabled()).toBe(true);
    expect(await page.locator('#administration-action-warning').textContent()).toContain('active runs');
    await confirmAdministration(page, 'bob'); await page.waitForFunction(() => document.getElementById('administration-status')?.textContent === 'Account change saved.');
    expect(writes[0].body).toEqual({ branch_id: 'bob-second', confirm_username: 'bob' }); expect(writes[0].headers['x-piclaw-account-id']).toBe('alice');
    expect(await page.locator('#session-select').inputValue()).toBe('web:alice');
    await open(); await page.waitForFunction(() => document.querySelectorAll('#administration-home-roots li').length === 2);
    expect(await page.locator('#administration-home-roots button').nth(1).isDisabled()).toBe(true);
    await page.locator('#close-administration-home').click(); expect(await page.locator('#administration-home-roots').textContent()).toBe('');
  } finally { await page.close(); }
}, 20000);

browserTest('admin home late reads cannot revive roots after close or account replacement', async () => {
  for (const action of ['close', 'login']) {
    const page = await browser.newPage();
    try {
      const { state } = await adminFixture(page); let release!: () => void, entered!: () => void;
      const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
      await page.route('**/admin/users/bob/home', async route => { entered(); await held; await route.fulfill({ json: adminHomeFixture() }); });
      await openAdministration(page); await page.locator('#administration-users li').nth(1).getByRole('button', { name: 'Home', exact: true }).click(); await waiting;
      if (action === 'close') await page.locator('#close-administration').click(); else state.identity = principal('bob', 'new-login'); release();
      if (action === 'login') await page.waitForFunction(() => document.getElementById('family-status')?.textContent?.includes('no longer bound')); else await page.waitForTimeout(100);
      expect(await page.locator('#administration-home').isVisible()).toBe(false); expect(await page.locator('#administration-home-roots').textContent()).toBe('');
    } finally { await page.close(); }
  }
}, 20000);

browserTest('admin home empty eligibility and write denial do not cause fallback or automatic retry', async () => {
  const page = await browser.newPage();
  try {
    await adminFixture(page); let empty = true, writes = 0;
    await page.route('**/admin/users/bob/home', route => {
      if (route.request().method() === 'PATCH') { writes++; return route.fulfill({ status: 403, json: {} }); }
      return route.fulfill({ json: { ...adminHomeFixture(), roots: empty ? [] : adminHomeFixture().roots } });
    });
    await openAdministration(page); const open = () => page.locator('#administration-users li').nth(1).getByRole('button', { name: 'Home', exact: true }).click();
    await open(); await page.waitForFunction(() => document.getElementById('administration-home-roots')?.textContent?.includes('No eligible'));
    empty = false; await open(); await page.waitForFunction(() => document.querySelectorAll('#administration-home-roots button').length === 2);
    await page.locator('#administration-home-roots button').nth(1).click(); await confirmAdministration(page, 'bob');
    await page.waitForFunction(() => document.getElementById('administration-status')?.textContent?.includes('No automatic retry'));
    expect(writes).toBe(1); expect(await page.locator('#session-select').inputValue()).toBe('web:alice');
  } finally { await page.close(); }
}, 20000);

browserTest('admin security view confirms exact target revocation without changing current conversation', async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 740 } });
  try {
    await adminFixture(page); const security = adminSecurityFixture(), writes: any[] = [];
    await page.route('**/admin/users/bob/security', route => route.fulfill({ json: security }));
    await page.route('**/admin/users/bob/security/revoke', route => { const body = route.request().postDataJSON(); writes.push({ body, headers: route.request().headers() }); if (body.kind === 'session') security.sessions = []; else security.factors.passkeys = []; return route.fulfill({ json: { revoked: true } }); });
    await openAdministration(page);
    expect(await page.locator('#administration-users li').first().getByRole('button', { name: 'Security', exact: true }).isDisabled()).toBe(true);
    const open = async () => { await page.locator('#administration-users li').nth(1).getByRole('button', { name: 'Security', exact: true }).click(); await page.waitForFunction(() => !(document.getElementById('administration-security') as HTMLElement)?.hidden); };
    await open(); expect(await page.locator('#administration-security-items li').first().getByRole('button').isDisabled()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Revoke device login', exact: true }).click();
    await page.locator('#administration-confirm').check(); expect(await page.locator('#submit-administration-action').isDisabled()).toBe(true);
    await confirmAdministration(page, 'bob'); await page.waitForFunction(() => document.getElementById('administration-status')?.textContent === 'Account change saved.');
    expect(writes[0].body).toEqual({ kind: 'session', item_id: 'bob-login', confirm_username: 'bob' });
    await open(); await page.locator('#administration-security-items li').nth(1).getByRole('button', { name: 'Remove factor', exact: true }).click();
    expect(await page.locator('#administration-action-warning').textContent()).toContain('every device'); await confirmAdministration(page, 'bob');
    await page.waitForFunction(() => document.getElementById('administration-status')?.textContent === 'Account change saved.');
    expect(writes[1].body).toEqual({ kind: 'passkey', item_id: 'bob-key', confirm_username: 'bob' });
    expect(writes.every(w => w.headers['x-piclaw-account-id'] === 'alice')).toBe(true);
    expect(await page.locator('#session-select').inputValue()).toBe('web:alice'); expect(await page.locator('#administration-security').isVisible()).toBe(false);
  } finally { await page.close(); }
}, 20000);

browserTest('admin security late reads cannot restore metadata after blur or replacement login', async () => {
  for (const action of ['blur', 'login']) {
    const page = await browser.newPage();
    try {
      const { state } = await adminFixture(page); let release!: () => void, entered!: () => void;
      const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
      await page.route('**/admin/users/bob/security', async route => { entered(); await held; await route.fulfill({ json: adminSecurityFixture() }); });
      await openAdministration(page); await page.locator('#administration-users li').nth(1).getByRole('button', { name: 'Security', exact: true }).click(); await waiting;
      if (action === 'blur') await page.evaluate(() => dispatchEvent(new Event('blur'))); else state.identity = principal('bob', 'new-login');
      release();
      if (action === 'login') await page.waitForFunction(() => document.getElementById('family-status')?.textContent?.includes('no longer bound'));
      else { await page.waitForTimeout(80); await page.evaluate(() => dispatchEvent(new Event('focus'))); await ready(page); }
      expect(await page.locator('#administration-security').isVisible()).toBe(false); expect(await page.locator('#administration-security-items').textContent()).toBe('');
    } finally { await page.close(); }
  }
}, 20000);

browserTest('failed admin security revocation does not auto-retry or use another item', async () => {
  const page = await browser.newPage();
  try {
    await adminFixture(page); let writes = 0;
    await page.route('**/admin/users/bob/security', route => route.fulfill({ json: adminSecurityFixture() }));
    await page.route('**/admin/users/bob/security/revoke', route => { writes++; return route.fulfill({ status: 400, json: {} }); });
    await openAdministration(page); await page.locator('#administration-users li').nth(1).getByRole('button', { name: 'Security', exact: true }).click();
    await page.getByRole('button', { name: 'Revoke device login', exact: true }).click(); await confirmAdministration(page, 'bob');
    await page.waitForFunction(() => document.getElementById('administration-status')?.textContent?.includes('No automatic retry')); expect(writes).toBe(1);
    expect(await page.locator('#refresh-administration').isDisabled()).toBe(false);
  } finally { await page.close(); }
}, 20000);

browserTest('administration is hidden for members and requires explicit server capability for admins', async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page); let calls = 0;
    await page.route('**/admin/users/settings', route => { calls++; return route.fulfill({ status: 403, json: {} }); });
    await page.goto(base); await ready(page); expect(await page.locator('#open-administration').isVisible()).toBe(false);
    state.identity.principal.role = 'admin'; await page.reload(); await ready(page);
    expect(await page.locator('#open-administration').isVisible()).toBe(false); expect(calls).toBe(0);
  } finally { await page.close(); }
}, 20000);

browserTest('administration creates disabled accounts and confirms disable/reactivate/role changes without foreign navigation', async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 740 } });
  try {
    const { mutations } = await adminFixture(page); await openAdministration(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('#administration-users li').first().getByRole('button', { name: 'Disable', exact: true }).isDisabled()).toBe(true);
    await page.locator('#new-account-username').fill('new-user'); await page.locator('#new-account-display-name').fill('New person'); await page.locator('#create-account').click();
    await page.waitForFunction(() => document.getElementById('administration-status')?.textContent === 'Account change saved.');
    expect(mutations[0]!.body).toEqual({ username: 'new-user', displayName: 'New person', role: 'member' });
    const bob = () => page.locator('#administration-users li').filter({ has: page.locator('p', { hasText: '(@bob)' }) });
    for (const label of ['Disable', 'Reactivate', 'Change role']) {
      await bob().getByRole('button', { name: label, exact: true }).click();
      await page.locator('#administration-confirm').check(); expect(await page.locator('#submit-administration-action').isDisabled()).toBe(true);
      await page.locator('#administration-confirm-name').fill('wrong'); expect(await page.locator('#submit-administration-action').isDisabled()).toBe(true);
      await confirmAdministration(page, 'bob'); await page.waitForFunction(() => document.getElementById('administration-status')?.textContent === 'Account change saved.');
    }
    expect(mutations.slice(1).map(m => m.body)).toEqual([{ enabled: false }, { enabled: true }, { role: 'admin' }]);
    expect(mutations.every(m => m.headers['x-piclaw-account-id'] === 'alice' && m.headers['x-piclaw-login-id'] === 'login-a')).toBe(true);
    expect(await page.locator('#session-select').inputValue()).toBe('web:alice');
    expect(await page.locator('#administration-users a').count()).toBe(0);
  } finally { await page.close(); }
}, 20000);

browserTest('passkey invitation/reset require explicit capabilities and exact user confirmation, then show a method-pinned private link', async () => {
  const page = await browser.newPage();
  try {
    const {snapshot} = await adminFixture(page);
    snapshot.users[2]!.capabilities.invite_passkey=true; snapshot.users[1]!.capabilities.reset_passkey=true;
    const writes:any[]=[];
    for(const [id,operation] of [['pending','passkey-invitation'],['bob','reset-passkey']]) await page.route(`**/admin/users/${id}/${operation}`,route=>{ writes.push({path:route.request().url(),body:route.request().postDataJSON()}); return route.fulfill({json:{token:'p'.repeat(43),expiresAt:Date.now()+60_000,method:'passkey'}}); });
    await openAdministration(page);
    await page.locator('#administration-users li').nth(2).getByRole('button',{name:'Issue passkey invitation',exact:true}).click(); await confirmAdministration(page,'pending');
    await page.waitForFunction(()=>(document.getElementById('administration-invitation-link') as HTMLInputElement)?.value.includes('method=passkey'));
    expect(writes[0].body).toEqual({confirm_username:'pending'}); expect(await page.locator('#administration-invitation-link').inputValue()).toBe(`${base}/auth/invitation#token=${'p'.repeat(43)}&method=passkey`);
    await page.locator('#administration-users li').nth(1).getByRole('button',{name:'Reset to passkey',exact:true}).click(); expect(await page.locator('#administration-action-warning').textContent()).toContain('delete every'); await confirmAdministration(page,'bob');
    await page.waitForFunction(()=>document.getElementById('administration-status')?.textContent?.includes('Invitation issued')); expect(writes[1].body).toEqual({confirm_username:'bob'});
    await page.evaluate(()=>dispatchEvent(new Event('blur'))); expect(await page.locator('#administration-invitation-link').inputValue()).toBe(''); expect(page.url()).not.toContain('token=');
  } finally { await page.close(); }
},20000);

browserTest('invitation links are shown once, never stored or navigated, and cleared on blur and expiry', async () => {
  const page = await browser.newPage();
  try {
    const { mutations } = await adminFixture(page); await openAdministration(page);
    const pending = () => page.locator('#administration-users li').filter({ has: page.locator('p', { hasText: '(@pending)' }) });
    await pending().getByRole('button', { name: 'Issue invitation', exact: true }).click(); await confirmAdministration(page, 'pending');
    await page.waitForFunction(() => Boolean((document.getElementById('administration-invitation-link') as HTMLInputElement)?.value));
    expect(await page.locator('#administration-invitation-link').inputValue()).toBe(`${base}/auth/invitation#token=${'g'.repeat(43)}`);
    expect(await page.locator('#administration-invitation-link').isDisabled()).toBe(false); expect(page.url()).not.toContain('token');
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    await page.evaluate(() => dispatchEvent(new Event('blur'))); expect(await page.locator('#administration-invitation-link').inputValue()).toBe('');
    await page.evaluate(() => dispatchEvent(new Event('focus'))); await page.waitForFunction(() => document.querySelectorAll('#administration-users li').length > 0);
    expect(await page.locator('#administration-invitation').isVisible()).toBe(false);
    await pending().getByRole('button', { name: 'Revoke invitation', exact: true }).click(); await confirmAdministration(page, 'pending');
    await page.waitForFunction(() => document.getElementById('administration-status')?.textContent === 'Account change saved.');
    expect(mutations.at(-1)?.method).toBe('DELETE');
    await page.route('**/admin/users/pending/invitation', route => route.fulfill({ json: { token: 'e'.repeat(43), expiresAt: Date.now()+500 } }));
    await pending().getByRole('button', { name: 'Issue invitation', exact: true }).click(); await confirmAdministration(page, 'pending');
    await page.waitForFunction(() => (document.getElementById('administration-invitation-link') as HTMLInputElement)?.value.includes('eeeee'));
    await page.waitForFunction(() => !(document.getElementById('administration-invitation-link') as HTMLInputElement)?.value);
    expect(await page.locator('#administration-invitation').isVisible()).toBe(false);
  } finally { await page.close(); }
}, 20000);

browserTest('reset requires exact username and stale/closed grant responses cannot reappear', async () => {
  for (const change of ['close', 'login']) {
    const page = await browser.newPage();
    try {
      const { state } = await adminFixture(page); let release!: () => void, entered!: () => void, body: any;
      const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
      await page.route('**/admin/users/bob/reset', async route => { body = route.request().postDataJSON(); entered(); await held; await route.fulfill({ json: { token: 's'.repeat(43), expiresAt: Date.now()+60_000 } }); });
      await openAdministration(page);
      await page.locator('#administration-users li').nth(1).getByRole('button', { name: 'Reset account', exact: true }).click();
      expect(await page.locator('#administration-action-warning').textContent()).toContain('delete all');
      await confirmAdministration(page, 'bob'); await waiting; expect(body).toEqual({ confirm_username: 'bob' });
      if (change === 'close') await page.locator('#close-administration').click(); else state.identity = principal('bob', 'login-b');
      release();
      if (change === 'login') await page.waitForFunction(() => document.getElementById('family-status')?.textContent?.includes('no longer bound'));
      else { await page.waitForTimeout(80); await page.locator('#open-administration').click(); await page.waitForFunction(() => document.querySelectorAll('#administration-users li').length > 0); }
      expect(await page.locator('#administration-invitation-link').inputValue()).toBe(''); expect(await page.locator('body').textContent()).not.toContain('s'.repeat(43));
    } finally { await page.close(); }
  }
}, 20000);

browserTest('stale administration capabilities disable changes and failed writes are not retried automatically', async () => {
  const page = await browser.newPage();
  try {
    const { snapshot } = await adminFixture(page); snapshot.recent_auth = false; snapshot.capabilities.create_user = false;
    for (const user of snapshot.users) for (const key of Object.keys(user.capabilities) as (keyof typeof user.capabilities)[]) user.capabilities[key] = false;
    await openAdministration(page); expect(await page.locator('#create-account').isDisabled()).toBe(true);
    for (const button of await page.locator('#administration-users button').all()) expect(await button.isDisabled()).toBe(true);
    snapshot.capabilities.create_user = true; let writes = 0;
    await page.route('**/admin/users', route => { writes++; return route.fulfill({ status: 500, json: {} }); });
    await page.locator('#refresh-administration').click(); await page.waitForFunction(() => !(document.getElementById('create-account') as HTMLButtonElement)?.disabled);
    await page.locator('#new-account-username').fill('new-user'); await page.locator('#new-account-display-name').fill('New user'); await page.locator('#create-account').click();
    await page.waitForFunction(() => document.getElementById('administration-status')?.textContent?.includes('No automatic retry'));
    expect(writes).toBe(1); expect(await page.locator('#refresh-administration').isDisabled()).toBe(false);
  } finally { await page.close(); }
}, 20000);

browserTest('successful reset returns a restricted invitation without impersonation and pagehide erases it', async () => {
  const page = await browser.newPage();
  try {
    const { mutations } = await adminFixture(page); await openAdministration(page);
    await page.locator('#administration-users li').nth(1).getByRole('button', { name: 'Reset account', exact: true }).click();
    await confirmAdministration(page, 'bob');
    await page.waitForFunction(() => Boolean((document.getElementById('administration-invitation-link') as HTMLInputElement)?.value));
    expect(mutations[0]!.body).toEqual({ confirm_username: 'bob' });
    expect(await page.locator('#administration-users li').nth(1).textContent()).toContain('Disabled');
    expect(await page.locator('#session-select').inputValue()).toBe('web:alice');
    expect(await page.locator('#account-name').textContent()).toContain('alice');
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
    expect(await page.locator('#administration-invitation-link').inputValue()).toBe('');
    expect(await page.locator('#administration-users').textContent()).toBe('');
    expect(await page.locator('#open-administration').isVisible()).toBe(false);
  } finally { await page.close(); }
}, 20000);

browserTest('blur during invitation issuance drops the late secret and never repeats issuance on focus', async () => {
  const page = await browser.newPage();
  try {
    await adminFixture(page); let release!: () => void, entered!: () => void, calls = 0;
    const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
    await page.route('**/admin/users/pending/invitation', async route => { calls++; entered(); await held; await route.fulfill({ json: { token: 'z'.repeat(43), expiresAt: Date.now()+60_000 } }); });
    await openAdministration(page); await page.locator('#administration-users li').nth(2).getByRole('button', { name: 'Issue invitation', exact: true }).click();
    await confirmAdministration(page, 'pending'); await waiting;
    await page.evaluate(() => dispatchEvent(new Event('blur'))); release(); await page.waitForTimeout(80);
    await page.evaluate(() => dispatchEvent(new Event('focus'))); await page.waitForFunction(() => document.querySelectorAll('#administration-users li').length > 0);
    expect(await page.locator('#administration-invitation-link').inputValue()).toBe(''); expect(calls).toBe(1);
    expect(await page.locator('#refresh-administration').isDisabled()).toBe(false);
  } finally { await page.close(); }
}, 20000);

async function treeFixture(page: Page) {
  const state = await fixture(page);
  const branch = (id: string, name: string, parent: string | null = null): SessionSettings['branches'][number] => ({
    branch_id: id, chat_jid: `web:${id}`, root_chat_jid: parent ? 'web:alice' : `web:${id}`, parent_branch_id: parent,
    agent_name: name, archived_at: null, capabilities: { open: true, fork: true, rename: true, archive: id !== 'alice', restore: false, set_home: id !== 'alice' && !parent },
  });
  const snapshot: SessionSettings = { home_chat_jid: 'web:alice', capabilities: { create_root: true }, branches: [branch('alice', 'home'), branch('alice-two', 'second')] };
  const actions: { path: string; body: any; headers: Record<string, string> }[] = [];
  await page.route('**/account/trees', route => route.fulfill({ json: snapshot }));
  await page.route('**/agent/branches', route => route.fulfill({ json: { branches: snapshot.branches.filter(b => b.capabilities.open) } }));
  await page.route('**/timeline?**', route => {
    const jid = new URL(route.request().url()).searchParams.get('chat_jid');
    return route.fulfill(snapshot.branches.some(b => b.chat_jid === jid && b.capabilities.open) ? { json: posts() } : { status: 403, json: {} });
  });
  for (const path of ['/agent/root-session', '/agent/branch-fork', '/agent/branch-rename', '/agent/branch-prune', '/agent/branch-restore', '/account/home']) {
    await page.route(`**${path}`, route => {
      const body = route.request().postDataJSON(); actions.push({ path, body, headers: route.request().headers() });
      let target = snapshot.branches.find(b => b.chat_jid === body.chat_jid);
      if (path.endsWith('root-session') || path.endsWith('branch-fork')) { target = branch(`new-${actions.length}`, body.agent_name, path.endsWith('branch-fork') ? 'alice' : null); snapshot.branches.push(target); }
      if (path.endsWith('branch-rename')) target!.agent_name = body.agent_name;
      if (path.endsWith('branch-prune')) { target!.archived_at = 'now'; target!.capabilities = { open: false, fork: false, rename: false, archive: false, restore: true, set_home: false }; }
      if (path.endsWith('branch-restore')) { target!.archived_at = null; target!.agent_name = body.agent_name; target!.capabilities = { open: true, fork: true, rename: true, archive: true, restore: false, set_home: !target!.parent_branch_id }; }
      if (path.endsWith('/home')) {
        snapshot.home_chat_jid = target!.chat_jid; state.identity.principal.homeChatJid = target!.chat_jid;
        for (const item of snapshot.branches) { item.capabilities.set_home = !item.parent_branch_id && item.chat_jid !== target!.chat_jid; item.capabilities.archive = item.chat_jid !== target!.chat_jid; }
      }
      return route.fulfill({ json: { branch: target } });
    });
  }
  return { state, snapshot, actions };
}
async function openTrees(page: Page) {
  await page.goto(base); await ready(page); await page.locator('#open-sessions').click();
  await page.waitForFunction(() => document.querySelectorAll('#owned-tree-list li').length > 0);
}

async function transcriptFixture(page:Page) {
  const fixture=await treeFixture(page),branch=fixture.snapshot.branches[1]!;
  branch.archived_at='2026-09-06T00:00:00.000Z';branch.capabilities={open:false,fork:false,rename:false,archive:false,restore:true,set_home:false,download_transcript:true};
  const response=(ids:number[],hasMore=false)=>({schema:'piclaw.owned-transcript.v1',branch:{...branch},messages:ids.map(id=>({id,timestamp:'2026-09-06T00:00:00.000Z',sender_name:'Alice',is_bot_message:0,content:`TEXT_${id}`,content_truncated:id===1?1:0})),page:{limit:100,has_more:hasMore,next_before:hasMore?ids[0]:null},omitted:['media','tasks']});
  const calls:Array<{url:string;headers:Record<string,string>}>=[];
  await page.route('**/agent/branch-download?**',route=>{calls.push({url:route.request().url(),headers:route.request().headers()});return route.fulfill({json:new URL(route.request().url()).searchParams.has('before')?response([1,2]):response([3,4],true)});});
  return {...fixture,branch,response,calls};
}
async function startTranscript(page:Page) {
  await openTrees(page);await page.locator('#owned-tree-list li').nth(1).getByRole('button',{name:'Download transcript',exact:true}).click();
  await page.locator('#transcript-confirm').check();await page.locator('#prepare-transcript').click();
}

browserTest('archived transcript prepares pinned ordered pages, explicitly downloads plain text and revokes private blob URLs',async()=>{
  const page=await browser.newPage({viewport:{width:375,height:740}});let downloads=0;page.on('download',()=>downloads++);
  try {
    const fixture=await transcriptFixture(page);
    await page.addInitScript(()=>{const revoke=URL.revokeObjectURL;(window as any).revoked=[];URL.revokeObjectURL=url=>{(window as any).revoked.push(url);revoke(url);};});
    await openTrees(page);expect(await page.locator('#owned-tree-list li').first().getByRole('button',{name:'Download transcript',exact:true}).isDisabled()).toBe(true);
    await page.locator('#owned-tree-list li').nth(1).getByRole('button',{name:'Download transcript',exact:true}).click();expect(fixture.calls).toHaveLength(0);expect(await page.locator('#prepare-transcript').isDisabled()).toBe(true);
    await page.locator('#transcript-confirm').check();await page.locator('#prepare-transcript').click();await page.waitForFunction(()=>!(document.getElementById('save-transcript') as HTMLButtonElement)?.disabled);
    expect(downloads).toBe(0);expect(fixture.calls).toHaveLength(2);expect(fixture.calls[1]!.url).toContain('before=3');expect(fixture.calls.every(c=>c.headers['x-piclaw-account-id']==='alice'&&c.headers['x-piclaw-login-id']==='login-a')).toBe(true);
    expect(await page.locator('#transcript-status').textContent()).toContain('Prepared 4 messages (1 truncated)');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const download=page.waitForEvent('download');await page.locator('#save-transcript').click();const file=await download;expect(file.suggestedFilename()).toBe('piclaw-transcript-alice-two.txt');
    const text=readFileSync((await file.path())!,'utf8');expect(text).toContain('not a full backup');expect(text).toContain('[Message truncated by export]');expect(text.indexOf('TEXT_1')).toBeLessThan(text.indexOf('TEXT_2'));expect(text.indexOf('TEXT_2')).toBeLessThan(text.indexOf('TEXT_3'));expect(text.indexOf('TEXT_3')).toBeLessThan(text.indexOf('TEXT_4'));
    expect(await page.locator('#session-select').inputValue()).toBe('web:alice');expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
    await page.locator('#cancel-transcript').click();expect(await page.evaluate(()=>(window as any).revoked.length)).toBe(1);expect(await page.locator('#transcript-status').textContent()).toBe('');await file.delete();
  }finally{await page.close();}
},20000);

browserTest('transcript cancellation/blur/close discards held pages and prevents late download readiness',async()=>{
  for(const action of ['cancel','blur','close']){
    const page=await browser.newPage();let downloaded=false;page.on('download',()=>downloaded=true);
    try {
      const fixture=await transcriptFixture(page);let entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);
      await page.route('**/agent/branch-download?**',async route=>{entered();await held;await route.fulfill({json:fixture.response([1])});});
      await startTranscript(page);await waiting;
      if(action==='cancel')await page.locator('#cancel-transcript').click();else if(action==='close')await page.locator('#close-sessions').click();else await page.evaluate(()=>dispatchEvent(new Event('blur')));
      release();await page.waitForTimeout(100);expect(downloaded).toBe(false);expect(await page.locator('#save-transcript').isDisabled()).toBe(true);expect(await page.locator('#transcript-export').isVisible()).toBe(false);expect(await page.locator('#transcript-status').textContent()).toBe('');
    }finally{await page.close();}
  }
},20000);

browserTest('archive restoration and replaced login prevent saving an already prepared transcript',async()=>{
  for(const change of ['restore','login']){
    const page=await browser.newPage();let downloaded=false;page.on('download',()=>downloaded=true);
    try{
      const fixture=await transcriptFixture(page);await startTranscript(page);await page.waitForFunction(()=>!(document.getElementById('save-transcript') as HTMLButtonElement)?.disabled);
      if(change==='restore'){fixture.branch.archived_at=null;fixture.branch.capabilities.download_transcript=false;}else fixture.state.identity=principal('bob','login-b');
      await page.locator('#save-transcript').click();
      if(change==='restore')await page.waitForFunction(()=>document.getElementById('transcript-status')?.textContent?.includes('Nothing was downloaded'));else await page.waitForFunction(()=>document.getElementById('family-status')?.textContent?.includes('no longer bound'));
      expect(downloaded).toBe(false);expect(await page.locator('#save-transcript').isDisabled()).toBe(true);
    }finally{await page.close();}
  }
},20000);

browserTest('transcript malformed pages, duplicate pagination and message cap fail without partial file',async()=>{
  for(const kind of ['foreign','cursor','limit','empty']){
    const page=await browser.newPage();let count=0,downloads=0;page.on('download',()=>downloads++);
    try {
      const fixture=await transcriptFixture(page);await page.route('**/agent/branch-download?**',route=>{
        count++;const value=kind==='limit'?fixture.response(Array.from({length:100},(_,i)=>3000-count*100+i),true):fixture.response(kind==='empty'?[]:[1],kind==='cursor');
        if(kind==='foreign')value.branch.chat_jid='web:bob';if(kind==='cursor')value.page.next_before=2;
        return route.fulfill({json:value});
      });
      await startTranscript(page);
      if(kind==='empty'){await page.waitForFunction(()=>!(document.getElementById('save-transcript') as HTMLButtonElement)?.disabled);expect(await page.locator('#transcript-status').textContent()).toContain('Prepared 0 messages');}
      else {await page.waitForFunction(()=>document.getElementById('transcript-status')?.textContent?.includes('Close and refresh'));expect(await page.locator('#save-transcript').isDisabled()).toBe(true);}
      expect(downloads).toBe(0);expect(count).toBe(kind==='limit'?20:1);
    }finally{await page.close();}
  }
},30000);

browserTest('transcript accepts exactly 2000 messages and enforces UTF-8 byte bounds including empty-export headers',async()=>{
  for(const kind of ['exact-count','utf8-limit','header-limit']){
    const page=await browser.newPage();let pages=0,downloads=0;page.on('download',()=>downloads++);
    try {
      const fixture=await transcriptFixture(page);
      if(kind==='header-limit')fixture.branch.agent_name='x'.repeat(8*1024*1024);
      await page.route('**/agent/branch-download?**',route=>{
        pages++;const ids=kind==='header-limit'?[]:Array.from({length:100},(_,i)=>2001-pages*100+i);
        const value=fixture.response(ids,kind==='exact-count'?pages<20:kind==='utf8-limit');
        if(kind==='utf8-limit')for(const message of value.messages)message.content='😀'.repeat(32000);
        return route.fulfill({json:value});
      });
      await startTranscript(page);
      if(kind==='exact-count'){
        await page.waitForFunction(()=>!(document.getElementById('save-transcript') as HTMLButtonElement)?.disabled);
        expect(await page.locator('#transcript-status').textContent()).toContain('Prepared 2000 messages');expect(pages).toBe(20);
        const downloading=page.waitForEvent('download');await page.locator('#save-transcript').click();const file=await downloading;
        const text=readFileSync((await file.path())!,'utf8');expect(text.match(/^--- Message /gm)).toHaveLength(2000);
        expect(text.indexOf('TEXT_1\n')).toBeLessThan(text.indexOf('TEXT_2000\n'));await file.delete();
      }else{
        await page.waitForFunction(()=>document.getElementById('transcript-status')?.textContent?.includes('8 MiB limit'));
        expect(await page.locator('#save-transcript').isDisabled()).toBe(true);expect(downloads).toBe(0);expect(pages).toBe(kind==='header-limit'?0:1);
      }
    }finally{await page.close();}
  }
},30000);

browserTest('prepared transcript is discarded by focus loss, session refresh, navigation and target replacement',async()=>{
  for(const action of ['blur','refresh','switch','close','navigate','replace']){
    const page=await browser.newPage();let downloads=0;page.on('download',()=>downloads++);
    try{
      const fixture=await transcriptFixture(page);
      fixture.snapshot.branches.push({...fixture.snapshot.branches[0]!,branch_id:'alice-third',chat_jid:'web:alice-third',root_chat_jid:'web:alice-third',agent_name:'third'});
      await startTranscript(page);await page.waitForFunction(()=>!(document.getElementById('save-transcript') as HTMLButtonElement)?.disabled);
      if(action==='blur')await page.evaluate(()=>dispatchEvent(new Event('blur')));
      else if(action==='refresh')await page.locator('#refresh-sessions').click();
      else if(action==='switch')await page.locator('#session-select').selectOption('web:alice-third');
      else if(action==='close')await page.locator('#close-sessions').click();
      else if(action==='navigate')await page.goto(base+'/blank');
      else await page.locator('#owned-tree-list li').nth(1).getByRole('button',{name:'Download transcript',exact:true}).click();
      if(action!=='navigate'){
        expect(await page.locator('#save-transcript').isDisabled()).toBe(true);expect(await page.locator('#transcript-status').textContent()).toBe('');
        expect(await page.locator('#transcript-confirm').isChecked()).toBe(false);
      }
      expect(downloads).toBe(0);
    }finally{await page.close();}
  }
},30000);

browserTest('transcript cancellation during save-time archive check cannot create a late blob or download',async()=>{
  const page=await browser.newPage();let downloads=0;page.on('download',()=>downloads++);
  try{
    const fixture=await transcriptFixture(page);await startTranscript(page);await page.waitForFunction(()=>!(document.getElementById('save-transcript') as HTMLButtonElement)?.disabled);
    await page.evaluate(()=>{const create=URL.createObjectURL;(window as any).blobs=0;URL.createObjectURL=blob=>{(window as any).blobs++;return create(blob);};});
    let entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);
    await page.route('**/account/trees',async route=>{entered();await held;await route.fulfill({json:fixture.snapshot});});
    await page.locator('#save-transcript').click();await waiting;await page.locator('#cancel-transcript').click();release();await page.waitForTimeout(100);
    expect(downloads).toBe(0);expect(await page.evaluate(()=>(window as any).blobs)).toBe(0);
    expect(await page.locator('#save-transcript').isDisabled()).toBe(true);expect(await page.locator('#transcript-status').textContent()).toBe('');
  }finally{await page.close();}
},20000);

browserTest('owned session Settings creates, renames, selects home, archives and restores without implicit navigation', async () => {
  const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
  try {
    const { actions } = await treeFixture(page); await openTrees(page);
    const row = (name: string) => page.locator('#owned-tree-list li').filter({ has: page.locator('p', { hasText: `@${name} ·` }) });
    expect(await row('home').getByRole('button', { name: 'Archive', exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#root-name').fill('research'); await page.locator('#create-root').click();
    await page.waitForFunction(() => document.getElementById('session-settings-status')?.textContent?.includes('change saved'));
    expect(actions[0]!.body).toEqual({ agent_name: 'research' }); expect(await page.locator('#session-select').inputValue()).toBe('web:alice');
    await row('research').getByRole('button', { name: 'Rename', exact: true }).click(); await page.locator('#session-action-name').fill('renamed'); await page.locator('#submit-session-action').click();
    await page.waitForFunction(() => document.getElementById('owned-tree-list')?.textContent?.includes('@renamed'));
    expect(actions[1]!.body).toEqual({ chat_jid: 'web:new-1', agent_name: 'renamed' });
    await row('second').getByRole('button', { name: 'Set home', exact: true }).click();
    expect(await page.locator('#submit-session-action').isDisabled()).toBe(true);
    await page.locator('#session-action-confirm').check(); await page.locator('#submit-session-action').click();
    await page.waitForFunction(() => document.getElementById('session-home')?.textContent === 'Home: web:alice-two');
    expect(await page.locator('#session-select').inputValue()).toBe('web:alice');
    await row('home').getByRole('button', { name: 'Archive', exact: true }).click();
    await page.locator('#session-action-confirm').check(); await page.locator('#submit-session-action').click();
    await page.waitForFunction(() => document.getElementById('family-error')?.textContent?.includes('Access denied'));
    expect(await page.locator('#send-message').isDisabled()).toBe(true); expect(await page.locator('#session-select').inputValue()).toBe('');
    await page.evaluate(() => dispatchEvent(new Event('blur'))); await page.evaluate(() => dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelectorAll('#owned-tree-list li').length === 3);
    await row('home').getByRole('button', { name: 'Restore', exact: true }).click(); await page.locator('#session-action-name').fill('restored'); await page.locator('#submit-session-action').click();
    await page.waitForFunction(() => document.getElementById('owned-tree-list')?.textContent?.includes('@restored')); await ready(page);
    await page.locator('#go-home').click(); await page.waitForFunction(() => (document.getElementById('session-select') as HTMLSelectElement)?.value === 'web:alice-two');
    expect(actions.every(a => a.headers['x-piclaw-account-id'] === 'alice' && a.headers['x-piclaw-login-id'] === 'login-a')).toBe(true);
  } finally { await page.close(); }
}, 20000);

browserTest('manual fork retry preserves key without automatic replay', async () => {
  const page = await browser.newPage();
  try {
    await treeFixture(page); const requests: any[] = [];
    await page.route('**/agent/branch-fork', route => { requests.push(route.request().postDataJSON()); return route.fulfill(requests.length === 1 ? { status: 500, json: {} } : { json: { branch: {} } }); });
    await openTrees(page);
    await page.locator('#owned-tree-list li').first().getByRole('button', { name: 'Fork', exact: true }).click(); await page.locator('#session-action-name').fill('forked');
    await page.locator('#submit-session-action').click(); await page.waitForFunction(() => document.getElementById('session-settings-status')?.textContent?.includes('No automatic retry'));
    expect(requests).toHaveLength(1); expect(await page.locator('#session-action-name').inputValue()).toBe('forked');
    await page.locator('#submit-session-action').click(); await page.waitForFunction(() => document.getElementById('session-settings-status')?.textContent?.includes('change saved'));
    expect(requests[0].request_id).toBe(requests[1].request_id); expect(requests[0].chat_jid).toBe('web:alice');
  } finally { await page.close(); }
}, 20000);

browserTest('tree capabilities and late replacement-login responses never reveal foreign targets', async () => {
  const page = await browser.newPage();
  try {
    const { state, snapshot } = await treeFixture(page); snapshot.capabilities.create_root = false;
    snapshot.branches[1]!.capabilities.set_home = false;
    await openTrees(page); expect(await page.locator('#create-root').isDisabled()).toBe(true);
    expect(await page.locator('#owned-tree-list li').nth(1).getByRole('button', { name: 'Set home', exact: true }).isDisabled()).toBe(true);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
    await page.route('**/account/trees', async route => { entered(); await held; snapshot.branches[0]!.agent_name = 'STALE_TREE'; await route.fulfill({ json: snapshot }); });
    await page.locator('#refresh-sessions').click(); await waiting; state.identity = principal('bob', 'login-b'); release();
    await page.waitForFunction(() => document.getElementById('family-status')?.textContent?.includes('no longer bound'));
    expect(await page.locator('#session-settings').isVisible()).toBe(false); expect(await page.locator('#owned-tree-list').textContent()).toBe('');
    expect(await page.locator('body').textContent()).not.toContain('STALE_TREE');
  } finally { await page.close(); }
}, 20000);

browserTest('failed restore preserves selection, and backgrounded mutations cannot restore drafts or enable compose', async () => {
  const page = await browser.newPage();
  try {
    const { snapshot } = await treeFixture(page); const archived = snapshot.branches[1]!;
    archived.archived_at = 'yesterday'; archived.capabilities = { open: false, fork: false, rename: false, archive: false, restore: true, set_home: false };
    let attempts = 0;
    await page.route('**/agent/branch-restore', route => { attempts++; return route.fulfill({ status: 400, json: {} }); });
    await openTrees(page);
    await page.locator('#owned-tree-list li').nth(1).getByRole('button', { name: 'Restore', exact: true }).click();
    await page.locator('#session-action-name').fill('collision'); await page.locator('#submit-session-action').click();
    await page.waitForFunction(() => document.getElementById('session-settings-status')?.textContent?.includes('No automatic retry'));
    expect(attempts).toBe(1); expect(await page.locator('#session-action-name').inputValue()).toBe('collision');
    expect(await page.locator('#session-select').inputValue()).toBe('web:alice');
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
    await page.route('**/agent/branch-restore', async route => { entered(); await held; await route.fulfill({ status: 400, json: {} }); });
    await page.locator('#submit-session-action').click(); await waiting;
    await page.evaluate(() => dispatchEvent(new Event('blur'))); release();
    await page.waitForTimeout(80);
    expect(await page.locator('#session-settings').isVisible()).toBe(false);
    expect(await page.locator('#send-message').isDisabled()).toBe(true); expect(await page.locator('#session-action-name').inputValue()).toBe('');
    await page.evaluate(() => dispatchEvent(new Event('focus'))); await ready(page);
    await page.waitForFunction(() => document.querySelectorAll('#owned-tree-list li').length === 2);
    expect(await page.locator('#session-action-form').isVisible()).toBe(false);
  } finally { await page.close(); }
}, 20000);

browserTest('closing a pending session mutation keeps panel closed and refreshes picker after commit', async () => {
  const page = await browser.newPage();
  try {
    const { snapshot } = await treeFixture(page); let release!: () => void, entered!: () => void;
    const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
    await page.route('**/agent/branch-rename', async route => { entered(); await held; snapshot.branches[1]!.agent_name = 'renamed'; await route.fulfill({ json: { branch: snapshot.branches[1] } }); });
    await openTrees(page);
    await page.locator('#owned-tree-list li').nth(1).getByRole('button', { name: 'Rename', exact: true }).click();
    await page.locator('#session-action-name').fill('renamed'); await page.locator('#submit-session-action').click(); await waiting;
    await page.locator('#close-sessions').click(); release();
    await page.waitForFunction(() => document.getElementById('session-select')?.textContent?.includes('renamed'));
    expect(await page.locator('#session-settings').isVisible()).toBe(false);
    expect(await page.locator('#session-select').inputValue()).toBe('web:alice');
    await page.locator('#open-sessions').click(); await page.waitForFunction(() => document.querySelectorAll('#owned-tree-list li').length === 2);
    expect(await page.locator('#refresh-sessions').isDisabled()).toBe(false);
  } finally { await page.close(); }
}, 20000);

browserTest("account profile and device controls are pinned, confirmed and accessible on mobile", async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 740 } });
  try {
    const state = await fixture(page), snapshot = accountSnapshot(); const mutations: any[] = [];
    await page.route('**/account', route => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON(); mutations.push({ body, headers: route.request().headers() });
        snapshot.user.display_name = body.displayName; state.identity.principal.displayName = body.displayName;
      }
      return route.fulfill({ json: snapshot });
    });
    await page.route('**/account/sessions/*', route => { mutations.push(route.request().url()); return route.fulfill({ json: { revoked: true } }); });
    await openAccount(page);
    expect(await page.locator('#account-passkeys li').count()).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator('#account-save-profile').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByLabel('Display name', { exact: true }).fill('Updated name');
    await page.locator('#account-save-profile').click();
    await page.waitForFunction(() => document.getElementById('account-status')?.textContent === 'Profile saved.');
    expect(mutations[0].body).toEqual({ username: 'alice', displayName: 'Updated name' });
    expect(mutations[0].headers['x-piclaw-login-id']).toBe('login-a');
    await page.locator('#refresh').click(); await page.waitForFunction(() => document.getElementById('account-name')?.textContent?.includes('Updated name'));
    await page.locator('#account-sessions').getByRole('button', { name: 'Sign out device', exact: true }).nth(1).click();
    expect(await page.locator('#account-confirm-action').isDisabled()).toBe(true);
    await page.locator('#account-confirm-check').check(); await page.locator('#account-confirm-action').click();
    await page.waitForFunction(() => document.getElementById('account-status')?.textContent === 'Device signed out.');
    expect(mutations[1]).toContain('/account/sessions/other-login');
    // A previous mutation must not leave confirmation controls permanently disabled.
    await page.locator('#account-passkeys button').first().click();
    expect(await page.locator('#account-confirm-check').isDisabled()).toBe(false);
    expect(await page.locator('#account-confirm-text').textContent()).toContain('every device');
    await page.locator('#account-cancel-action').click();
    expect(await page.locator('#account-confirmation').isVisible()).toBe(false);
  } finally { await page.close(); }
}, 20000);

browserTest("server capabilities disable stale-auth and last-factor actions; errors do not auto-retry", async () => {
  const page = await browser.newPage();
  try {
    await fixture(page); let snapshot = accountSnapshot(false), writes = 0;
    await page.route('**/account', route => {
      if (route.request().method() !== 'GET') { writes++; return route.fulfill({ status: 403, json: {} }); }
      return route.fulfill({ json: snapshot });
    });
    await openAccount(page);
    for (const selector of ['#account-save-profile', '#account-add-passkey', '#account-remove-totp', '#account-passkeys button', '#account-sessions button']) expect(await page.locator(selector).first().isDisabled()).toBe(true);
    snapshot = accountSnapshot(); snapshot.factors.passkeys[0]!.removable = false; snapshot.factors.totp.removable = false;
    await page.locator('#refresh-account').click(); await page.waitForFunction(() => !(document.getElementById('account-save-profile') as HTMLButtonElement)?.disabled);
    expect(await page.locator('#account-passkeys button').first().isDisabled()).toBe(true);
    await page.locator('#account-save-profile').click();
    await page.waitForFunction(() => document.getElementById('account-status')?.textContent?.includes('Refresh before trying'));
    expect(writes).toBe(1);
  } finally { await page.close(); }
}, 20000);

browserTest("late account response and background drafts cannot survive replacement login", async () => {
  const page = await browser.newPage();
  try {
    const state = await fixture(page);
    await page.route('**/account', route => route.fulfill({ json: accountSnapshot() }));
    await openAccount(page); await page.locator('#account-display-name').fill('PRIVATE_DRAFT');
    await page.evaluate(() => dispatchEvent(new Event('blur')));
    expect(await page.locator('#account-settings').isVisible()).toBe(false);
    expect(await page.locator('#account-display-name').inputValue()).toBe('');
    await page.evaluate(() => dispatchEvent(new Event('focus'))); await page.waitForFunction(() => !(document.getElementById('account-details') as HTMLElement)?.hidden);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(r => release = r), waiting = new Promise<void>(r => entered = r);
    await page.route('**/account', async route => { entered(); await held; const snapshot = accountSnapshot(); snapshot.user.display_name = 'OLD_PRIVATE'; await route.fulfill({ json: snapshot }); });
    await page.locator('#refresh-account').click(); await waiting; state.identity = principal('bob', 'login-b'); release();
    await page.waitForFunction(() => document.getElementById('family-status')?.textContent?.includes('no longer bound'));
    expect(await page.locator('#account-settings').isVisible()).toBe(false);
    expect(await page.locator('body').textContent()).not.toContain('OLD_PRIVATE');
    expect(await page.locator('#account-display-name').inputValue()).toBe('');
  } finally { await page.close(); }
}, 20000);

browserTest("removing a factor confirms all-device sign-out and clears account state on revocation", async () => {
  const page = await browser.newPage();
  try {
    await fixture(page); let revoked = false;
    await page.route('**/auth/me', route => route.fulfill(revoked ? { status: 401, json: {} } : { json: principal() }));
    await page.route('**/account', route => route.fulfill({ json: accountSnapshot() }));
    await page.route('**/account/factors/passkey/first-key', route => { revoked = true; return route.fulfill({ json: { removed: true } }); });
    await openAccount(page); await page.locator('#account-passkeys button').first().click();
    await page.locator('#account-confirm-check').check(); await page.locator('#account-confirm-action').click();
    await page.waitForFunction(() => document.getElementById('family-status')?.textContent?.includes('no longer bound'));
    expect(revoked).toBe(true); expect(await page.locator('#account-passkeys').textContent()).toBe('');
    expect(await page.locator('#account-display-name').inputValue()).toBe('');
  } finally { await page.close(); }
}, 20000);

browserTest("passkey creation uses native registration twice without replacement and survives authenticator blur", async () => {
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('WebAuthn.enable');
    const options = { protocol: 'ctap2' as const, transport: 'internal' as const, hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true };
    let authenticator = await cdp.send('WebAuthn.addVirtualAuthenticator', { options });
    await fixture(page); const snapshot = accountSnapshot(), finishes: any[] = [];
    await page.route('**/account', route => route.fulfill({ json: snapshot }));
    await page.route('**/account/passkeys/register/start', route => route.fulfill({ json: { token: 'ceremony-token', options: {
      challenge: Buffer.from(crypto.randomUUID()).toString('base64url'), rp: { id: 'localhost', name: 'PiClaw' },
      user: { id: Buffer.from('alice').toString('base64url'), name: 'alice', displayName: 'Alice' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: finishes.map(f => ({ id: f.credential.id, type: 'public-key' })),
    } } }));
    await page.route('**/account/passkeys/register/finish', route => { const body = route.request().postDataJSON(); finishes.push(body); snapshot.factors.passkeys.push({ credential_id: body.credential.id, label: '', created_at: 'now', last_used_at: null, usable: true, removable: true }); return route.fulfill({ json: { registered: true } }); });
    await page.addInitScript(() => {
      const create = navigator.credentials.create.bind(navigator.credentials);
      navigator.credentials.create = async options => { dispatchEvent(new Event('blur')); try { return await create(options); } finally { dispatchEvent(new Event('focus')); } };
    });
    await openAccount(page);
    for (let i = 0; i < 2; i++) {
      if (i) { await cdp.send('WebAuthn.removeVirtualAuthenticator', authenticator); authenticator = await cdp.send('WebAuthn.addVirtualAuthenticator', { options }); }
      await page.locator('#account-add-passkey').click();
      await page.waitForFunction(count => document.querySelectorAll('#account-passkeys li').length === count, 3 + i, { timeout: 6000 });
    }
    expect(finishes).toHaveLength(2); expect(finishes[0].credential.id).not.toBe(finishes[1].credential.id);
    expect(finishes[0].credential.response.attestationObject.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  } finally { await cdp.detach(); await page.close(); }
}, 20000);

browserTest("closing or changing login during native registration never submits a late credential", async () => {
  for (const action of ['close', 'switch']) {
    const page = await browser.newPage();
    try {
      const state = await fixture(page); let finishes = 0;
      await page.route('**/account', route => route.fulfill({ json: accountSnapshot() }));
      await page.route('**/account/passkeys/register/start', route => route.fulfill({ json: { token: 'ceremony-token', options: {
        challenge: 'YQ', user: { id: 'YQ' }, excludeCredentials: [],
      } } }));
      await page.route('**/account/passkeys/register/finish', route => { finishes++; return route.fulfill({ json: {} }); });
      await page.addInitScript(() => {
        navigator.credentials.create = () => new Promise(resolve => {
          (window as any).releaseRegistration = () => resolve({ id: 'late', rawId: new ArrayBuffer(1), type: 'public-key', response: { clientDataJSON: new ArrayBuffer(1), attestationObject: new ArrayBuffer(1) }, getClientExtensionResults: () => ({}) } as any);
        });
      });
      await openAccount(page); await page.locator('#account-add-passkey').click();
      await page.waitForFunction(() => typeof (window as any).releaseRegistration === 'function');
      if (action === 'close') await page.locator('#close-account').click();
      else state.identity = principal('bob', 'login-b');
      await page.evaluate(() => (window as any).releaseRegistration());
      if (action === 'switch') await page.waitForFunction(() => document.getElementById('family-status')?.textContent?.includes('no longer bound'));
      else { await page.locator('#open-account').click(); await page.waitForFunction(() => !(document.getElementById('account-details') as HTMLElement)?.hidden); }
      expect(finishes).toBe(0);
    } finally { await page.close(); }
  }
}, 20000);
