import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { chromium, webkit } from "playwright";
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" && process.env.PICLAW_E2E_DISPOSABLE === "1", browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (!enabled) return;
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, "fixtures/popup-heading-fixture.tsx")], target: "browser", jsx: { runtime: "automatic", importSource: "preact" } });
  if (!build.success) throw Error(String(build.logs));
  const script = await build.outputs[0].text();
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/fixture.js") return new Response(script, { headers: { "content-type": "text/javascript" } });
    if (url.pathname.startsWith("/static/")) return new Response(Bun.file(join(import.meta.dir, "../../web", url.pathname)));
    return new Response(`<link rel="stylesheet" href="/static/classic/dist/app.bundle.css"><style>body{padding:20px}.compose-model-popup,.model-picker{position:relative!important;inset:auto!important;max-width:600px}.compose-model-popup-menu,.model-picker__results{height:180px!important;max-height:180px!important;overflow:auto!important}</style><output id="selection">none</output><div id="root"></div><script type="module" src="/fixture.js"></script>`, { headers: { "content-type": "text/html" } });
  } });
}, 30000);
afterAll(() => server?.stop(true));
for (const [name, engine] of Object.entries({ chromium, webkit })) for (const skin of ["classic"]) browserTest(`${skin}/${name}: typeahead keeps first pinned match uncovered`, async () => {
  const browser = await engine.launch(), page = await browser.newPage({ viewport: { width: 820, height: 900 } });
  page.on("pageerror", error => console.error("Popup fixture error", error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
  try {
    await page.goto(`${server.url}?${"classic"}`);
    const search = page.locator(".compose-model-catalogue-search");
    await page.waitForTimeout(300);
    expect(await search.count(), await page.locator('#root').innerHTML()).toBe(1);
    for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await search.fill("");
    await page.keyboard.press("ArrowDown");
    await search.fill("model-00");
    const geometry = await page.locator('[role="option"]').first().evaluate((row) => {
      const rect = row.getBoundingClientRect(), heading = document.querySelector(".compose-model-catalogue-section-heading,.model-picker__section-heading")!;
      const title = heading.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, headingTop: title.top, headingBottom: title.bottom, headingText: heading.textContent, position: getComputedStyle(heading).position };
    });
    expect(geometry.headingText).toContain("Pinned");
    expect(geometry.position).not.toBe("sticky");
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.headingBottom - 1);
    }
    await search.focus();
    await page.waitForTimeout(50);
    await page.keyboard.press("Enter");
    expect(await page.locator("#selection").textContent()).toBe("fixture/model-00");
  } finally { await browser.close(); }
}, 15000);
