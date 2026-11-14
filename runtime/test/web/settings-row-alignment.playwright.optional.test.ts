import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const optionalBrowserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
const runtimeRoot = join(import.meta.dir, "../..");
let browser: Browser | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let baseUrl = "";

let classicFixture = "";
let buildDir = "";

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  buildDir = await mkdtemp(join(tmpdir(), "piclaw-settings-row-alignment-"));
  for (const skin of ['classic']) {
    const outfile = join(buildDir, skin + '-compaction.js');
    const entry = 'web/src/dev/settings-widget-fixture.ts';
    const build = Bun.spawn(['bun','build',entry,'--target=browser','--format=esm','--jsx=automatic','--jsx-import-source=preact','--external','#editor-vendor/codemirror','--outfile',outfile], {cwd:runtimeRoot,stdout:'pipe',stderr:'pipe'});
    const [exitCode, stderr] = await Promise.all([build.exited,new Response(build.stderr).text()]);
    if(exitCode!==0)throw Error(stderr || skin + ' Compaction fixture build failed');
    classicFixture=await readFile(outfile,'utf8');
  }
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/classic") return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"></head><body><div id="settings-widget-fixture-root"></div><script type="module" src="/classic-compaction.js"></script></body></html>`, { headers: { "content-type": "text/html" } });
      if (url.pathname === "/classic-compaction.js") return new Response(classicFixture, { headers: { "content-type": "text/javascript" } });
      if (!url.pathname.startsWith("/static/") || url.pathname.includes("..")) return new Response("not found", { status: 404 });
      try {
        const path = join(runtimeRoot, "web/static", url.pathname.slice("/static/".length));
        const body = await readFile(path);
        return new Response(body, { headers: { "content-type": path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "text/javascript" : "application/octet-stream" } });
      } catch { return new Response("not found", { status: 404 }); }
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
  if (buildDir) await rm(buildDir, { recursive: true, force: true });
  browser = null;
  server = null;
});

async function openCompaction(skin: "classic", width: number, height: number): Promise<Page> {
  if (!browser) throw new Error("browser not started");
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: "dark" });
  {
    await page.goto(`${baseUrl}/classic?section=compaction&width=${Math.max(360, Math.min(width - 32, 1120))}&height=${Math.max(420, Math.min(height - 32, 760))}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".settings-dense-row", { state: "visible" });
  }
  return page;
}

async function geometry(page: Page, skin: "classic") {
  return page.evaluate((kind) => {
    const root = document.querySelector(kind === "classic" ? ".settings-content" : ".settings-panel__content") as HTMLElement;
    const rowSelector = kind === "classic" ? ".settings-dense-row" : ".settings-panel__dense-row";
    const compoundClass = kind === "classic" ? "settings-dense-row-compound" : "settings-panel__dense-row--compound";
    const rows = Array.from(document.querySelectorAll(rowSelector)) as HTMLElement[];
    const rootRect = root.getBoundingClientRect();
    const points = rows.filter((row) => !row.classList.contains(compoundClass)).map((row) => {
      const control = row.querySelector(kind === "classic"
        ? ":scope > .settings-number-stepper, :scope > select, :scope > input"
        : ":scope > .settings-panel__stepper, :scope > select, :scope > input, :scope > .settings-panel__field-content > .settings-panel__stepper, :scope > .settings-panel__field-content > select, :scope > .settings-panel__field-content > input") as HTMLElement | null;
      const help = row.querySelector(kind === "classic" ? ":scope > .settings-hint" : ":scope > .settings-panel__description, :scope > .settings-panel__field-content > .settings-panel__description") as HTMLElement | null;
      const controlRect = control?.getBoundingClientRect();
      const helpRect = help?.getBoundingClientRect();
      return { controlX: controlRect?.x ?? null, helpX: helpRect?.x ?? null, controlRight: controlRect?.right ?? null };
    });
    const spread = (values: Array<number | null>) => {
      const finite = values.filter((value): value is number => Number.isFinite(value));
      return finite.length ? Math.max(...finite) - Math.min(...finite) : 0;
    };
    return {
      rowCount: rows.length,
      controlSpread: spread(points.map((point) => point.controlX)),
      helpSpread: spread(points.map((point) => point.helpX)),
      clipped: points.filter((point) => point.controlRight != null && point.controlRight > rootRect.right + 1),
    };
  }, skin);
}

for (const width of [1366, 820, 520, 390]) {
  for (const skin of ["classic"] as const) {
    optionalBrowserTest(`${skin} dense Compaction rows align at ${width}px`, async () => {
      const page = await openCompaction(skin, width, width === 390 ? 844 : 760);
      try {
        const metrics = await geometry(page, skin);
        // Native auto + independent local-lite, tool/semantic and watchdog controls.
        expect(metrics.rowCount).toBe(9);
        expect(metrics.controlSpread).toBeLessThanOrEqual(1);
        expect(metrics.helpSpread).toBeLessThanOrEqual(1);
        expect(metrics.clipped).toEqual([]);
      } finally { await page.close(); }
    });
  }
}

for (const skin of ['classic'] as const) optionalBrowserTest(skin + ' native compaction reads and saves the auto flag by keyboard without retired settings', async()=>{
  const page=await openCompaction(skin,820,760);
  try {
    const root='.settings-content';
    const row=page.locator(root+' '+('.settings-row')).filter({has:page.locator('label',{hasText:'Enable automatic compaction'})});
    const toggle=row.locator('input[type=checkbox]');
    expect(await toggle.isChecked()).toBe(true);
    await page.evaluate(()=>{
      const prior=window.fetch.bind(window);(window as any).__nativeCompactionPosts=[];
      window.fetch=async(input,init)=>{if(String(input)==='/agent/settings/compaction'&&init?.method==='POST')(window as any).__nativeCompactionPosts.push(JSON.parse(String(init.body)));return prior(input,init);};
    });
    await toggle.focus();await page.keyboard.press('Space');
    await page.waitForFunction(()=> (window as any).__nativeCompactionPosts.length===1);
    expect(await toggle.isChecked()).toBe(false);
    await toggle.focus();await page.keyboard.press('Space');
    await page.waitForFunction(()=> (window as any).__nativeCompactionPosts.length===2);
    expect(await toggle.isChecked()).toBe(true);
    const posts=await page.evaluate(()=> (window as any).__nativeCompactionPosts);
    expect(posts.map((post:any)=>post.autoCompactionEnabled)).toEqual([false,true]);
    for(const post of posts)for(const field of ['smartCompactionMethod','compactionModel','remoteCompactionEnabled','remoteCompactionTimeoutSec','compactionThresholdPercent','compactionTimeoutSec','compactionBackoffBaseMin','compactionBackoffMaxMin','compactionBackoffDecayFactor'])expect(post).not.toHaveProperty(field);
    expect(await page.locator(root+' select').count()).toBe(0);
    expect(await page.locator(root).innerText()).toContain('already accepted maintenance is not cancelled');
  }finally{await page.close();}
});
