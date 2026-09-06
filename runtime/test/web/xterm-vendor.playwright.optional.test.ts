import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

const optionalBrowserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
const vendorDir = join(import.meta.dir, "../../web/static/common/js/vendor/xterm");
let browser: Browser | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/") {
        return new Response(`<!doctype html><html><head><link rel="stylesheet" href="/xterm.css"><script src="/addon-canvas.js"></script></head><body><div id="terminal" style="width:640px;height:240px"></div><script type="module">
const specs = {
  xterm: ["xterm.mjs", "Terminal"], attach: ["addon-attach.mjs", "AttachAddon"],
  clipboard: ["addon-clipboard.mjs", "ClipboardAddon"], fit: ["addon-fit.mjs", "FitAddon"],
  image: ["addon-image.mjs", "ImageAddon"], ligatures: ["addon-ligatures.mjs", "LigaturesAddon"],
  progress: ["addon-progress.mjs", "ProgressAddon"], search: ["addon-search.mjs", "SearchAddon"],
  serialize: ["addon-serialize.mjs", "SerializeAddon"], graphemes: ["addon-unicode-graphemes.mjs", "UnicodeGraphemesAddon"],
  unicode11: ["addon-unicode11.mjs", "Unicode11Addon"], links: ["addon-web-links.mjs", "WebLinksAddon"],
  webgl: ["addon-webgl.mjs", "WebglAddon"]
};
try {
  const modules = {};
  for (const [key, [file, exported]] of Object.entries(specs)) {
    const loaded = await import("/" + file);
    if (typeof loaded[exported] !== "function") throw new Error(file + " does not export " + exported);
    modules[key] = loaded;
  }
  if (typeof globalThis.CanvasAddon?.CanvasAddon !== "function") throw new Error("canvas UMD export missing");
  const terminal = new modules.xterm.Terminal({ cols: 40, rows: 8, allowProposedApi: true });
  const fit = new modules.fit.FitAddon();
  terminal.loadAddon(fit);
  terminal.open(document.querySelector("#terminal"));
  terminal.loadAddon(new modules.ligatures.LigaturesAddon({ fallbackLigatures: ["=>"] }));
  terminal.loadAddon(new globalThis.CanvasAddon.CanvasAddon());
  fit.fit();
  terminal.write("xterm vendor smoke\\r\\n");
  await new Promise(resolve => setTimeout(resolve, 100));
  globalThis.result = {
    ok: true,
    cols: terminal.cols,
    rows: terminal.rows,
    rendered: terminal.buffer.active.getLine(0)?.translateToString(true).includes("xterm vendor smoke") || false,
    moduleCount: Object.keys(modules).length
  };
} catch (error) {
  globalThis.result = { ok: false, error: String(error), stack: error?.stack };
}
</script></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.pathname.includes("..")) return new Response("not found", { status: 404 });
      try {
        const body = await readFile(join(vendorDir, url.pathname.slice(1)));
        const contentType = url.pathname.endsWith(".css") ? "text/css" : "text/javascript";
        return new Response(body, { headers: { "content-type": contentType } });
      } catch {
        return new Response("not found", { status: 404 });
      }
    },
  });
});

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
  browser = null;
  server = null;
});

optionalBrowserTest("vendored xterm runtime and add-on APIs load in Chromium", async () => {
  if (!browser || !server) throw new Error("browser fixture not started");
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    await page.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean((globalThis as any).result));
    const result = await page.evaluate(() => (globalThis as any).result);
    expect(result).toMatchObject({ ok: true, rendered: true, moduleCount: 13 });
    expect(result.cols).toBeGreaterThan(0);
    expect(result.rows).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await page.close();
  }
});
