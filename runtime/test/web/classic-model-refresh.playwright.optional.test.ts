import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { chromium, webkit, type Browser } from "playwright";
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const browsers: Record<string, Browser> = {};
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (!enabled) return;
  const classic = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "fixtures/classic-model-refresh-fixture.ts"),
    ],
    target: "browser",
    external: ["#editor-vendor/codemirror"],
  });
  if (!classic.success) throw Error(String(classic.logs));
  const classicScript = await classic.outputs[0].text();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/editor-vendor/codemirror.js"
        ? new Response(
            Bun.file(
              join(
                import.meta.dir,
                "../../extensions/viewers/editor/vendor/codemirror.js",
              ),
            ),
            { headers: { "content-type": "text/javascript" } },
          )
        : new URL(req.url).pathname === "/fixture.js"
          ? new Response(
              classicScript,
              {
                headers: { "content-type": "text/javascript" },
              },
            )
          : new Response(
              `<!doctype html><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><div id="app"></div><script type="module" src="/fixture.js?skin=${new URL(req.url).searchParams.get("skin") || "classic"}"></script>`,
              { headers: { "content-type": "text/html" } },
            ),
  });
  browsers.chromium = await chromium.launch();
  browsers.webkit = await webkit.launch();
});
afterAll(async () => {
  for (const browser of Object.values(browsers)) await browser.close();
  server?.stop(true);
});
for (const engine of ["chromium", "webkit"])
  browserTest(
    `${engine}: Classic model metadata survives same-chat renders, partial updates and request races`,
    async () => {
      const page = await browsers[engine].newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.clock.install();
        await page.goto(`${server.url}?skin=classic`);
        await page.waitForSelector("#classic-state");
        await page.clock.runFor(150);
        const state = async () =>
          JSON.parse(await page.locator("#classic-state").innerText());
        expect((await state()).model).toBe("fixture/model");
        expect((await state()).thinking).toBe("High");
        await page.evaluate(() => (window as any).classicFixture.rerender());
        await page.clock.runFor(100);
        expect((await state()).model).toBe("fixture/model");
        expect((await state()).thinking).toBe("High");
        await page.evaluate(async () => {
          const f = (window as any).classicFixture;
          f.setModel({
            current: "fixture/model",
            provider_usage: { hint_short: "usage" },
          });
          await f.refresh();
        });
        await page.clock.runFor(100);
        expect((await state()).thinking).toBe("High");
        expect((await state()).supports).toBe(true);
        await page.evaluate(async () => {
          const f = (window as any).classicFixture;
          f.fail(true);
          await f.refresh();
        });
        await page.clock.runFor(100);
        expect((await state()).model).toBe("fixture/model");
        await page.evaluate(() => {
          const f = (window as any).classicFixture;
          f.fail(false);
          f.block();
          void f.refresh();
        });
        await page.clock.runFor(100);
        await page.evaluate(() =>
          (window as any).classicFixture.apply({
            current: "fixture/new",
            thinking_level: "off",
            supports_thinking: true,
          }),
        );
        await page.clock.runFor(100);
        await page.evaluate(() => (window as any).classicFixture.release());
        await page.clock.runFor(100);
        expect((await state()).model).toBe("fixture/new");
        expect((await state()).thinking).toBe("off");
        await page.evaluate(() =>
          (window as any).classicFixture.apply({
            thinking_level_label: "Maximum",
          }),
        );
        await page.clock.runFor(100);
        expect((await state()).thinking).toBe("Maximum");
        await page.evaluate(() => {
          const f = (window as any).classicFixture;
          f.block();
          f.setModel({ current: "fixture/wrong-old" });
          void f.refresh();
        });
        await page.clock.runFor(100);
        await page.evaluate(() => {
          const f = (window as any).classicFixture;
          f.fail(true);
          f.changeChat("web:b");
        });
        await page.clock.runFor(100);
        await page.evaluate(() => (window as any).classicFixture.release());
        await page.clock.runFor(100);
        expect((await state()).model).toBeNull();
        await page.evaluate(async () => {
          const f = (window as any).classicFixture;
          f.fail(false);
          f.setModel({
            current: null,
            available_model_count: 2,
            model_options: [],
            thinking_level: null,
          });
          await f.refresh();
        });
        await page.clock.runFor(100);
        expect(
          await page
            .getByRole("button", { name: "Open model picker" })
            .textContent(),
        ).toContain("Select model");
        expect(errors).toEqual([]);
      } finally {
        await page.close();
      }
    },
    20000,
  );
