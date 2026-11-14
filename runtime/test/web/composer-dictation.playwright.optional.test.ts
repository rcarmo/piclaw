import { beforeAll, afterAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
 if (!enabled) return;
 const bundles = new Map<string, string>();
 for (const skin of ['classic']) {
  const result = await build({entryPoints:[join(import.meta.dir, 'fixtures/composer-dictation-browser.ts')], bundle:true, write:false, platform:'browser', format:'esm', jsx:'automatic', jsxImportSource:'preact', external:['#editor-vendor/codemirror']});
  bundles.set('/' + skin + '.js', result.outputFiles![0].text);
 }
 server = Bun.serve({hostname:'127.0.0.1', port:0, fetch(request) {
  const path = new URL(request.url).pathname;
  if (request.headers.get('accept')?.includes('text/event-stream')) return new Response(': fixture\n\n', {headers:{'content-type':'text/event-stream'}});
  if (bundles.has(path)) return new Response(bundles.get(path), {headers:{'content-type':'text/javascript'}});
  if (path === '/editor-vendor/codemirror.js') return new Response(Bun.file(join(import.meta.dir,'../../extensions/viewers/editor/vendor/codemirror.js')), {headers:{'content-type':'text/javascript'}});
  if (path === '/classic') return new Response(`<!doctype html><div id="root"></div><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><script type="module" src="${path}.js"></script>`, {headers:{'content-type':'text/html'}});
  return Response.json({commands:[], models:[], items:[], settings:{}, presets:[]});
 }});
}, 30000);
afterAll(() => server?.stop(true));

for (const [name, engine] of Object.entries({chromium, webkit})) for (const skin of ['classic']) for (const method of ['button', 'enter']) browserTest(`${name}/${skin}/${method}: existing mic and Send await final draft once`, async () => {
 const browser = await engine.launch({headless:true});
 try {
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('DICTATION_FIXTURE_ERROR', error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
  await page.goto(new URL(skin + '?chat_jid=web:fixture', server.url).href, {waitUntil:'domcontentloaded'});
  await page.locator('[data-testid="compose-input"]').waitFor();
  await page.getByRole('button', {name:'Voice input', exact:true}).click({timeout:5000});
  await page.waitForFunction(() => (window as any).dictationFixture.calls.includes('start'), {}, {timeout:5000});
  await page.evaluate(() => (window as any).dictationFixture.partial());
  const input=page.locator('[data-testid="compose-input"]');
  if(method==='button')await page.getByRole('button', {name:'Send message', exact:true}).click();
  else {await input.focus();await page.keyboard.press('Enter');}
  await page.waitForFunction(() => (window as any).dictationFixture.calls.includes('finish'));
  await input.focus();await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).dictationFixture.calls.filter((s:string) => s.startsWith('send:')))).toEqual([]);
  expect(await page.evaluate(() => (window as any).dictationFixture.calls.filter((s:string) => s === 'finish').length)).toBe(1);
  await page.evaluate(() => (window as any).dictationFixture.release());
  await page.waitForFunction(() => (window as any).dictationFixture.calls.some((s:string) => s.startsWith('send:')));
  expect(await page.evaluate(() => (window as any).dictationFixture.calls.filter((s:string) => s.startsWith('send:')))).toEqual(['send:final words']);
 } finally { await browser.close(); }
}, 30000);

for(const [name,engine] of Object.entries({chromium,webkit})) for(const method of ['space','touch']) browserTest(`${name}/classic/${method}: provider capture finishes on release`,async()=>{
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage();await page.goto(new URL('classic?chat_jid=web:fixture',server.url).href,{waitUntil:'domcontentloaded'});
  const input=page.getByTestId('compose-input');await input.waitFor();
  if(method==='space'){await input.focus();await page.keyboard.down('Space');}
  else await page.getByRole('button',{name:'Voice input',exact:true}).dispatchEvent('pointerdown',{pointerType:'touch',pointerId:1,bubbles:true});
  await page.waitForFunction(()=>(window as any).dictationFixture.calls.includes('start'),{},{timeout:5000});
  if(method==='space')await page.keyboard.up('Space');
  else await page.locator('.voice-input-btn').dispatchEvent('pointerup',{pointerType:'touch',pointerId:1,bubbles:true});
  await page.waitForFunction(()=>(window as any).dictationFixture.calls.includes('finish'),{},{timeout:5000});
  expect(await page.evaluate(()=>(window as any).dictationFixture.calls.filter((s:string)=>s==='finish').length)).toBe(1);
  await page.evaluate(()=>(window as any).dictationFixture.release());
  await page.waitForFunction(()=>(document.querySelector('[data-testid="compose-input"]') as HTMLTextAreaElement).value==='final words');
  expect(await page.evaluate(()=>(window as any).dictationFixture.calls.filter((s:string)=>s.startsWith('send:')))).toEqual([]);
 }finally{await browser.close();}
},30000);

for(const [name,engine] of Object.entries({chromium,webkit})) for(const skin of ['classic']) browserTest(`${name}/${skin}: selected provider aborts and fences native recognition`,async()=>{
 const browser=await engine.launch({headless:true});try{
  const page=await browser.newPage();await page.goto(new URL(skin+'?chat_jid=web:fixture&native=1',server.url).href,{waitUntil:'domcontentloaded'});
  const input=page.locator('[data-testid="compose-input"]');await input.waitFor();
  await page.getByRole('button',{name:'Start voice input',exact:true}).click();
  await page.waitForFunction(()=>(window as any).dictationFixture.calls.includes('native-start'));
  await page.evaluate(()=>(window as any).nativeDictationFixture.enable());
  await page.waitForFunction(()=>(window as any).dictationFixture.calls.includes('native-abort'));
  await page.getByRole('button',{name:'Voice input',exact:true}).click();
  await page.waitForFunction(()=>(window as any).dictationFixture.calls.includes('start'));
  await page.evaluate(()=>{(window as any).dictationFixture.partial();(window as any).nativeDictationFixture.late();});
  expect(await input.inputValue()).toBe('partial');
  expect(await page.evaluate(()=>(window as any).dictationFixture.calls.filter((s:string)=>s==='cancel'))).toEqual([]);
 }finally{await browser.close();}
},30000);

for(const[name,engine]of Object.entries({chromium,webkit})) browserTest(`${name}/classic: search cancels hidden provider capture`,async()=>{
 const browser=await engine.launch({headless:true});try{
  const page=await browser.newPage();await page.goto(new URL('classic?chat_jid=web:fixture',server.url).href,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Voice input',exact:true}).click();await page.waitForFunction(()=>(window as any).dictationFixture.calls.includes('start'));
  await page.evaluate(()=>(window as any).dictationFixture.enterSearch());await page.waitForFunction(()=>(window as any).dictationFixture.calls.includes('cancel'));
  await page.evaluate(()=>(window as any).dictationFixture.partial());expect(await page.getByTestId('compose-input').inputValue()).toBe('');expect(await page.locator('.voice-input-btn').count()).toBe(0);
 }finally{await browser.close();}
},30000);

for(const[name,engine]of Object.entries({chromium,webkit}))for(const skin of ['classic'])browserTest(`${name}/${skin}: Send before first partial awaits final result`,async()=>{
 const browser=await engine.launch({headless:true});try{
  const page=await browser.newPage();await page.goto(new URL(skin+'?chat_jid=web:fixture',server.url).href,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Voice input',exact:true}).click();await page.waitForFunction(()=>(window as any).dictationFixture.calls.includes('start'));
  await page.getByRole('button',{name:'Send message',exact:true}).click();await page.waitForFunction(()=>(window as any).dictationFixture.calls.includes('finish'));
  expect(await page.evaluate(()=>(window as any).dictationFixture.calls.filter((value:string)=>value.startsWith('send:')))).toEqual([]);await page.evaluate(()=>(window as any).dictationFixture.release());
  await page.waitForFunction(()=>(window as any).dictationFixture.calls.includes('send:final words'));
 }finally{await browser.close();}
},30000);

for(const[name,engine]of Object.entries({chromium,webkit}))for(const skin of ['classic'])for(const theme of ['light','dark'])browserTest(`${name}/${skin}/${theme}: steering shortcut waits final draft`,async()=>{
 const browser=await engine.launch({headless:true});try{
  const page=await browser.newPage();await page.goto(new URL(skin+'?chat_jid=web:fixture',server.url).href,{waitUntil:'domcontentloaded'});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;},theme);
  await page.getByRole('button',{name:'Voice input',exact:true}).click();await page.waitForFunction(()=>(window as any).dictationFixture.calls.includes('start'));
  const input=page.locator('[data-testid="compose-input"]');await input.focus();await page.keyboard.press('Control+Enter');await page.waitForFunction(()=>(window as any).dictationFixture.calls.includes('finish'));
  expect(await page.evaluate(()=>(window as any).dictationFixture.calls.filter((value:string)=>value.startsWith('send:')))).toEqual([]);await page.evaluate(()=>(window as any).dictationFixture.release());await page.waitForFunction(()=>(window as any).dictationFixture.calls.includes('send:final words'));
 }finally{await browser.close();}
},30000);
