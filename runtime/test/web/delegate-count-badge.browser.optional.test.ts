import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;

browserTest('Delegate badge follows live snapshots in both skins at desktop and phone widths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'delegate-badge-browser-'));
  const web = resolve(import.meta.dir, '../../web');
  await writeFile(join(root, 'entry.ts'), `
    import { h, render } from '${web}/src/vendor/preact-htm.js';
    import { AgentStatus } from '${web}/src/components/status.ts';
    window.updateStatus = (count, extra = {}) => render(h(AgentStatus, {
      status: {type:'tool_call',title:'delegate',active_tools:Array.from({length:count},(_,i)=>({tool_name:'delegate',tool_call_id:'d'+i})),...extra},
      turnId:'fixture',loadWorkspaceBranch:async()=>null
    }), document.getElementById('fixture'));
    window.updateStatus(0);
  `);
  const build = await Bun.build({ entrypoints: [join(root, 'entry.ts')], outdir: root, naming: 'fixture.js', target: 'browser', format: 'esm' });
  expect(build.success).toBe(true);
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/fixture.js') return new Response(Bun.file(join(root, 'fixture.js')), { headers: {'content-type':'text/javascript'} });
    if (path === '/classic.css' || path === '/visual.css') return new Response(Bun.file(join(web, 'static', path.slice(1, -4), 'css/agent.css')), { headers: {'content-type':'text/css'} });
    if (path === '/') return new Response(`<!doctype html><html><head><link id="skin" rel="stylesheet" href="/classic.css"><style>
      :root{--text-primary:#222;--text-secondary:#555;--bg-primary:#fff;--bg-secondary:#eee;--border-color:#bbb;--accent-color:#557799}
      html.dark{--text-primary:#eee;--text-secondary:#bbb;--bg-primary:#222;--bg-secondary:#333;--border-color:#666}
      body{margin:12px;background:var(--bg-primary);color:var(--text-primary);font-family:system-ui}
    </style></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>`, { headers: {'content-type':'text/html'} });
    return new Response('Not found', {status:404});
  }});
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({headless:true, executablePath:process.env.PICLAW_TEST_CHROMIUM_PATH});
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
    await page.goto(server.url.href);
    await page.waitForFunction(() => typeof (window as any).updateStatus === 'function');
    for (const skin of ['classic','visual']) {
      await page.evaluate(skin => new Promise<void>(resolve => {
        const link = document.getElementById('skin') as HTMLLinkElement;
        if (new URL(link.href).pathname === '/' + skin + '.css' && link.sheet) return resolve();
        link.onload = () => resolve(); link.href = '/' + skin + '.css';
      }), skin);
      for (const dark of [false,true]) for (const width of [1200,390]) {
        await page.setViewportSize({width,height:800});
        await page.evaluate(dark => document.documentElement.classList.toggle('dark',dark),dark);
        for (const count of [1,2,12,1]) {
          await page.evaluate(count => (window as any).updateStatus(count),count);
          const badge = page.locator('.agent-delegate-count');
          await badge.waitFor();
          expect(await badge.textContent()).toBe(String(count));
          const geometry = await badge.evaluate(element => {
            const box=element.getBoundingClientRect(),css=getComputedStyle(element);
            return {width:box.width,height:box.height,radius:css.borderRadius,clipped:element.scrollWidth>element.clientWidth,
              color:css.color,expectedColor:getComputedStyle(document.body).color,title:element.getAttribute('title')};
          });
          expect(geometry.width).toBe(20);expect(geometry.height).toBe(20);expect(geometry.radius).toBe('4px');
          expect(geometry.clipped).toBe(false);expect(geometry.color).toBe(geometry.expectedColor);
          expect(geometry.title).toBe(`${count} ${count===1?'delegate':'delegates'} running`);
        }
        for (const state of [{count:0,extra:{}},{count:2,extra:{type:'error'}},{count:2,extra:{last_activity:true}}]) {
          await page.evaluate(state => (window as any).updateStatus(state.count,state.extra),state);
          expect(await page.locator('.agent-delegate-count').count()).toBe(0);
        }
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server.stop(true); await rm(root,{recursive:true,force:true});
  }
}, 60000);
