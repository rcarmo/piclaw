import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';

// The Classic Plan tab pane against a mocked plan-sidebar add-on API.
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
let browser: Browser;
let stored = { markdown: '- [x] Inspect\n- [-] Build the pane\n- [ ] Test', updated_at: '2026-11-11T10:00:00.000Z' };
const posts: any[] = [];
let available = true;

beforeAll(async () => {
  if (!enabled) return;
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/plan-pane-fixture.ts')], target: 'browser', format: 'esm' });
  if (!build.success) throw Error(build.logs.join('\n'));
  const js = await build.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/fixture.js') return new Response(js, { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname.startsWith('/static/')) return new Response(Bun.file(join(import.meta.dir, '../../web', url.pathname)));
    if (url.pathname === '/agent/addons/api/plan-sidebar/plan') {
      if (!available) return new Response('<!doctype html><title>Error</title>', { status: 500, headers: { 'content-type': 'text/html' } });
      if (req.method === 'POST') {
        const body = await req.json();
        posts.push({ kind: 'plan', body });
        stored = body.action === 'reset'
          ? { markdown: '- [ ] Inspect current state', updated_at: '2026-11-11T11:00:00.000Z' }
          : { markdown: body.markdown, updated_at: '2026-11-11T12:00:00.000Z' };
        return Response.json({ ok: true, plan: { chat_jid: body.chat_jid, ...stored } });
      }
      return Response.json({ chat_jid: url.searchParams.get('chat_jid'), ...stored });
    }
    if (url.pathname === '/agent/default/message') {
      posts.push({ kind: 'message', chat: url.searchParams.get('chat_jid'), body: await req.json() });
      return Response.json({ ok: true });
    }
    if (url.pathname === '/') return new Response('<!doctype html><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"><style>html,body{height:100%;margin:0}#pane{height:600px;width:520px}</style><div id="pane"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
    return Response.json({});
  } });
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); server?.stop(true); });

browserTest('the Plan pane shows progress, edits, saves, resets and submits for the current chat', async () => {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  try {
    await page.goto(`${server.url}?chat_jid=web%3Aops`);
    await page.waitForSelector('.plan-pane-item');
    expect(await page.locator('.plan-pane-item').count()).toBe(3);
    expect(await page.locator('.plan-pane-item.in_progress .plan-pane-item-step').textContent()).toBe('Build the pane');
    expect(await page.locator('.plan-pane-progress').getAttribute('aria-valuenow')).toBe('33');
    expect((await page.locator('.plan-pane-chat').textContent())?.trim()).toBe('web:ops');

    await page.getByRole('button', { name: 'Edit' }).click();
    await page.locator('.plan-pane-editor').fill('- [x] Inspect\n- [x] Build the pane\n- [-] Test');
    // The dirty flag is reported from an effect after the edit renders.
    await page.waitForFunction(() => (window as any).planPane.instance.isDirty() === true);
    await page.keyboard.press('Control+s');
    await page.waitForSelector('.plan-pane-item');
    expect(await page.locator('.plan-pane-progress').getAttribute('aria-valuenow')).toBe('67');
    expect(posts.at(-1)).toEqual({ kind: 'plan', body: { chat_jid: 'web:ops', markdown: '- [x] Inspect\n- [x] Build the pane\n- [-] Test' } });
    await page.waitForFunction(() => (window as any).planPane.instance.isDirty() === false);

    // A model-side change refreshes the view.
    stored = { markdown: '- [x] Inspect\n- [x] Build the pane\n- [x] Test', updated_at: '2026-11-11T13:00:00.000Z' };
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('piclaw-extension-ui:status', { detail: { payload: { key: 'plan.changes', chat_jid: 'web:ops', source: 'tool' } } })));
    await page.waitForFunction(() => document.querySelector('.plan-pane-progress')?.getAttribute('aria-valuenow') === '100');
    expect(await page.locator('.plan-pane-status').textContent()).toContain('Updated by the model');

    await page.getByRole('button', { name: 'Submit to model' }).click();
    await page.waitForFunction(() => document.querySelector('.plan-pane-status')?.textContent?.includes('Submitted'));
    const message = posts.at(-1);
    expect(message.kind).toBe('message');
    expect(message.chat).toBe('web:ops');
    expect(message.body.mode).toBe('auto');
    expect(message.body.content).toContain('- [x] Test');

    await page.getByRole('button', { name: 'Reset' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.plan-pane-item').length === 1);
    expect(posts.at(-1)).toEqual({ kind: 'plan', body: { chat_jid: 'web:ops', action: 'reset' } });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30000);

browserTest('the Plan pane explains when the add-on is not installed', async () => {
  available = false;
  const page = await browser.newPage();
  try {
    await page.goto(`${server.url}?chat_jid=web%3Aops`);
    await page.waitForSelector('.plan-pane-unavailable');
    expect(await page.locator('.plan-pane-unavailable').textContent()).toContain('plan-sidebar add-on');
  } finally { available = true; await page.close(); }
}, 30000);

browserTest('Plan drafts stay scoped to their chat and survive switching without being saved into another chat',async()=>{
 const page=await browser.newPage();const writes:any[]=[];
 await page.route('**/agent/addons/api/plan-sidebar/plan?*',async route=>{const chat=new URL(route.request().url()).searchParams.get('chat_jid');if(route.request().method()==='POST')writes.push({chat,body:route.request().postDataJSON()});await route.fulfill({json:{ok:true,plan:{markdown:`- [ ] ${chat}`,updated_at:null}}});});
 const switchTo=async(chat:string)=>{await page.evaluate(chat=>{history.pushState({},'',`?chat_jid=${encodeURIComponent(chat)}`);window.dispatchEvent(new CustomEvent('piclaw:current-chat-changed'));},chat);};
 try{
  await page.goto(`${server.url}?chat_jid=chat-a`);await page.locator('.plan-pane-item').waitFor();await page.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('textarea').fill('- [ ] PRIVATE A DRAFT');
  await switchTo('chat-b');await page.waitForFunction(()=>document.querySelector('.plan-pane-chat')?.textContent?.trim()==='chat-b');
  expect(await page.locator('textarea').count()).toBe(0);expect(await page.locator('.plan-pane-items').textContent()).not.toContain('PRIVATE A DRAFT');
  await switchTo('chat-a');await page.locator('textarea').waitFor();expect(await page.locator('textarea').inputValue()).toBe('- [ ] PRIVATE A DRAFT');expect(writes).toEqual([]);
 }finally{await page.close();}
},30000);

browserTest('missing Plan API refuses Save and never submits the unsaved draft',async()=>{
 const page=await browser.newPage();let messages=0;
 await page.route('**/agent/addons/api/plan-sidebar/plan?*',route=>route.request().method()==='POST'?route.fulfill({status:404,json:{error:'No plan API'}}):route.fulfill({json:{markdown:'- [ ] Original',updated_at:null}}));
 await page.route('**/agent/default/message?*',route=>{messages++;return route.fulfill({json:{ok:true}});});
 try{await page.goto(`${server.url}?chat_jid=chat-a`);await page.locator('.plan-pane-item').waitFor();await page.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('textarea').fill('- [ ] Unsaved');await page.getByRole('button',{name:'Submit to model',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.plan-pane-status')?.classList.contains('error'));expect(messages).toBe(0);expect(await page.locator('textarea').inputValue()).toBe('- [ ] Unsaved');}
 finally{await page.close();}
},30000);

browserTest('a late Plan response cannot replace a different chat plan',async()=>{
 const page=await browser.newPage();let held:import('playwright').Route|undefined;
 await page.route('**/agent/addons/api/plan-sidebar/plan?*',async route=>{if(new URL(route.request().url()).searchParams.get('chat_jid')==='chat-a'){held=route;return;}await route.fulfill({json:{markdown:'- [ ] B ONLY',updated_at:null}});});
 try{await page.goto(`${server.url}?chat_jid=chat-a`);await page.waitForFunction(()=>document.querySelector('.plan-pane-chat')?.textContent?.trim()==='chat-a');await page.evaluate(()=>{history.pushState({},'','?chat_jid=chat-b');window.dispatchEvent(new CustomEvent('piclaw:current-chat-changed'));});await page.getByText('B ONLY',{exact:true}).waitFor();await held!.fulfill({json:{markdown:'- [ ] PRIVATE A LATE',updated_at:null}});await page.waitForTimeout(100);expect(await page.locator('.plan-pane-items').textContent()).toContain('B ONLY');expect(await page.locator('.plan-pane-items').textContent()).not.toContain('PRIVATE A LATE');}
 finally{await page.close();}
},30000);
