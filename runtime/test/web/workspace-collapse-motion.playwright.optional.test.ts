import { afterAll, beforeAll, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { chromium, webkit, type Page } from 'playwright';
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  if (!enabled) return;
  const web = resolve(import.meta.dir, '../../web');
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/static/')) {
      const path = resolve(web, url.pathname.slice(1));
      return path.startsWith(web + '/static/') ? new Response(Bun.file(path)) : new Response(null, { status: 404 });
    }
    const stylesheet = url.searchParams.has('bundle') ? '/static/classic/dist/app.bundle.css' : '/static/classic/css/styles.css';
    return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="${stylesheet}"><div class="app-shell" style="--sidebar-width:280px;${url.searchParams.has('bundle') ? '' : '--ui-transition-fast:500ms linear'}"><main class="container"><textarea aria-label="Draft">preserve draft</textarea></main><div class="workspace-splitter"></div><button class="workspace-toggle-tab open" aria-label="Hide workspace" aria-expanded="true"><svg class="workspace-toggle-tab-icon"></svg></button><aside class="workspace-sidebar"><div class="workspace-header">Workspace</div><div class="workspace-tree" style="overflow:auto"><div style="height:1500px">Files</div></div></aside><button class="workspace-drawer-backdrop" aria-label="Close workspace"></button></div><script>
    window.setWorkspace = open => { const shell=document.querySelector('.app-shell'),button=document.querySelector('.workspace-toggle-tab'); shell.classList.toggle('workspace-collapsed',!open);button.classList.toggle('open',open);button.classList.toggle('closed',!open);button.setAttribute('aria-expanded',String(open)); };
    document.querySelector('.workspace-toggle-tab').onclick=()=>window.setWorkspace(document.querySelector('.app-shell').classList.contains('workspace-collapsed'));
    </script>`, { headers: { 'Content-Type': 'text/html' } });
  } });
});
afterAll(() => server?.stop(true));
async function geometry(page: Page) {
  return page.evaluate(() => {
    const sidebar=document.querySelector('.workspace-sidebar')!,chat=document.querySelector('.container')!,tab=document.querySelector('.workspace-toggle-tab')!;
    const s=sidebar.getBoundingClientRect(),c=chat.getBoundingClientRect(),t=tab.getBoundingClientRect();
    return { x:s.x,width:s.width,right:s.right,chatX:c.x,chatRight:c.right,chatWidth:c.width,tabX:t.x,tabRight:t.right,opacity:Number(getComputedStyle(sidebar).opacity),focus:document.activeElement?.tagName,overflow:document.documentElement.scrollWidth>innerWidth };
  });
}
async function motion(page: Page, open: boolean) {
  return page.evaluate(async open => {
    const sidebar=document.querySelector('.workspace-sidebar')!,tab=document.querySelector('.workspace-toggle-tab')!;
    const read=()=>{const s=sidebar.getBoundingClientRect(),t=tab.getBoundingClientRect();return {x:s.x,width:s.width,right:s.right,tabX:t.x,tabRight:t.right,opacity:Number(getComputedStyle(sidebar).opacity)};};
    const before=read();(window as any).setWorkspace(open);
    const frames=[read()]; const start=performance.now();
    await new Promise<void>(done=>{const tick=()=>{frames.push(read());if(performance.now()-start<650)requestAnimationFrame(tick);else done();};requestAnimationFrame(tick);});
    return {before,frames};
  }, open);
}
for(const [engineName,engine] of Object.entries({chromium,webkit})) {
  for(const [width, bundle] of [[1024,false],[1366,false],[1920,false],[1366,true]] as const) browserTest(`${engineName}: desktop ${width} ${bundle ? 'bundle' : 'source'} workspace tree collapses beside the chat and reopens along the same edge`,async()=>{
    const browser=await engine.launch();const page=await browser.newPage({viewport:{width,height:800},reducedMotion:'no-preference'});
    try {
      await page.route('**/*',r=>new URL(r.request().url()).origin===server.url.origin?r.continue():r.abort());
      await page.goto(server.url.href + (bundle ? '?bundle=1' : '')); await page.waitForTimeout(200);
      await page.getByLabel('Draft').focus();
      await page.locator('.workspace-tree').evaluate(el=>{el.scrollTop=150;});
      // #1987: the tree is on the right of the chat; its tab hangs over the chat edge.
      const original=await geometry(page);expect(original.right).toBeCloseTo(width,0);expect(original.tabRight).toBeCloseTo(original.x,0);
      const closing=await motion(page,false);
      expect(closing.frames.some(f=>f.width>1&&f.width<closing.before.width-1)).toBe(true);
      expect(closing.frames[0].tabX).toBeCloseTo(closing.before.tabX,0);
      for(let i=1;i<closing.frames.length;i++){
        expect(closing.frames[i].width).toBeLessThanOrEqual(closing.frames[i-1].width+1);
        expect(closing.frames[i].right).toBeLessThanOrEqual(width+9);
      }
      // Collapsed with nothing else on the right: the centred chat's auto margin puts the tab on the right edge.
      const closed=await geometry(page);expect(closed.width).toBe(0);expect(closed.opacity).toBe(0);
      expect(closed.tabRight).toBeCloseTo(width,0);
      expect(Math.abs(closed.chatX-(width-closed.chatWidth)/2)).toBeLessThanOrEqual(1);
      expect(closed.chatWidth).toBeLessThanOrEqual(900);expect(closed.overflow).toBe(false);
      const opening=await motion(page,true);
      for(let i=1;i<opening.frames.length;i++){
        expect(opening.frames[i].width).toBeGreaterThanOrEqual(opening.frames[i-1].width-1);
        expect(opening.frames[i].right).toBeLessThanOrEqual(width+9);
      }
      const reopened=await geometry(page);expect(reopened.width).toBeCloseTo(original.width,0);expect(reopened.chatX).toBeCloseTo(original.chatX,0);expect(reopened.right).toBeCloseTo(width,0);
      expect(reopened.tabRight).toBeCloseTo(reopened.x,0);
      expect(await page.getByLabel('Draft').inputValue()).toBe('preserve draft');expect(reopened.focus).toBe('TEXTAREA');
      expect(await page.locator('.workspace-tree').evaluate(el=>el.scrollTop)).toBe(150);
      // Reverse during a pending transition; the next target must win.
      await page.evaluate(()=>{(window as any).setWorkspace(false);});await page.waitForTimeout(65);
      await page.evaluate(()=>{(window as any).setWorkspace(true);});await page.waitForTimeout(650);
      expect((await geometry(page)).width).toBeCloseTo(original.width,0);
    }finally{await browser.close();}
  },15000);
  browserTest(`${engineName}: editor stays docked while a resized workspace collapses`,async()=>{
    const browser=await engine.launch();const page=await browser.newPage({viewport:{width:1366,height:800},reducedMotion:'no-preference'});
    try {
      await page.route('**/*',r=>new URL(r.request().url()).origin===server.url.origin?r.continue():r.abort());await page.goto(server.url.href);
      await page.evaluate(()=>{const shell=document.querySelector('.app-shell')! as HTMLElement;shell.classList.add('editor-open','sidebar-resizing');shell.style.setProperty('--sidebar-width','360px');document.querySelector('.workspace-drawer-backdrop')!.insertAdjacentHTML('afterend','<div class="editor-splitter"></div><div class="editor-pane-container" style="--editor-width:480px">Editor</div>');});
      await page.waitForTimeout(200);await page.evaluate(()=>document.querySelector('.app-shell')!.classList.remove('sidebar-resizing'));
      const editorBefore=await page.locator('.editor-pane-container').boundingBox();
      const closing=await motion(page,false);expect(closing.frames.every(f=>f.width>=0)).toBe(true);
      expect((await geometry(page)).chatX).toBeCloseTo(0,0);
      expect(await page.locator('.editor-pane-container').boundingBox()).toEqual(editorBefore);
      await motion(page,true);expect((await geometry(page)).width).toBeCloseTo(360,0);
      expect(await page.locator('.editor-pane-container').boundingBox()).toEqual(editorBefore);
    } finally {await browser.close();}
  },15000);
  browserTest(`${engineName}: resume settling snaps the sidebar and toggle together`, async () => {
    const browser = await engine.launch();
    const page = await browser.newPage({ viewport: { width: 1366, height: 800 }, reducedMotion: 'no-preference' });
    try {
      await page.route('**/*', r => new URL(r.request().url()).origin === server.url.origin ? r.continue() : r.abort());
      await page.goto(server.url.href);
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        (window as any).setWorkspace(false);
      });
      await page.waitForTimeout(65);
      await page.evaluate(() => document.querySelector('.app-shell')!.classList.add('resume-layout-settling'));
      const closed = await geometry(page);
      expect(closed.width).toBe(0);
      expect(closed.tabRight).toBe(1366);
      await page.evaluate(() => (window as any).setWorkspace(true));
      const open = await geometry(page);
      expect(open.width).toBe(280);
      expect(open.right).toBe(1366);
      expect(open.tabRight).toBe(open.x);
      expect(await page.locator('.workspace-toggle-tab-icon').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
    } finally {
      await browser.close();
    }
  }, 15000);
  browserTest(`${engineName}: reduced motion and sidebar resize settle without transition`,async()=>{
    const browser=await engine.launch();const page=await browser.newPage({viewport:{width:1366,height:800},reducedMotion:'reduce'});
    try{
      await page.route('**/*',r=>new URL(r.request().url()).origin===server.url.origin?r.continue():r.abort());await page.goto(server.url.href);
      await page.evaluate(()=>(window as any).setWorkspace(false));expect((await geometry(page)).width).toBe(0);expect((await geometry(page)).tabRight).toBeCloseTo(1366,0);
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.evaluate(()=>{document.querySelector('.app-shell')!.classList.add('sidebar-resizing');(window as any).setWorkspace(true);});
      expect((await geometry(page)).width).toBe(280);
      expect(await page.locator('.workspace-toggle-tab').evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s');
    }finally{await browser.close();}
  },15000);
  for(const [width,height] of [[390,844],[1024,1366]]) browserTest(`${engineName}: narrow or portrait ${width} preserves overlay drawer`,async()=>{
    const browser=await engine.launch();const page=await browser.newPage({viewport:{width,height}});
    try{
      await page.route('**/*',r=>new URL(r.request().url()).origin===server.url.origin?r.continue():r.abort());await page.goto(server.url.href);
      // #1987: the narrow drawer opens from the right edge.
      const open=await geometry(page);expect(open.right).toBeCloseTo(width,0);expect(open.width).toBeLessThanOrEqual(width-48);expect(open.chatX).toBe(0);
      expect(await page.locator('.workspace-drawer-backdrop').isVisible()).toBe(true);
      await page.evaluate(()=>(window as any).setWorkspace(false));expect(await page.locator('.workspace-sidebar').isVisible()).toBe(false);expect((await geometry(page)).chatX).toBe(0);
      await page.evaluate(()=>(window as any).setWorkspace(true));expect(await page.locator('.workspace-sidebar').isVisible()).toBe(true);
    }finally{await browser.close();}
  },15000);
}
