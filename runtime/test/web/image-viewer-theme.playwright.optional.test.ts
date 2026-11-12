import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium, webkit, type Browser } from "playwright";
import { handleExtensionRoutes } from "../../src/channels/web/http/extension-routes";
import "../../src/channels/web/http/image-viewer-route";
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1",
  browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
const browsers: Record<string, Browser> = {};
const evidence = join(import.meta.dir, "../../../.artifacts/svg-themes");
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#ffeedd"/><text x="10" y="65" fill="#123456">Authored colour</text></svg>';
beforeAll(async () => {
  if (!enabled) return;
  await mkdir(evidence, { recursive: true });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname.startsWith("/image-viewer"))
        return (
          (await handleExtensionRoutes(req, u.pathname)) ||
          new Response(null, { status: 404 })
        );
      if (u.pathname === "/workspace/raw")
        return new Response(image, {
          headers: { "Content-Type": "image/svg+xml" },
        });
      return new Response(
        '<!doctype html><html data-theme="light" style="color-scheme:light;--bg-primary:#fff8e7;--bg-secondary:#f2ead8;--text-primary:#203040;--text-secondary:#506070;--border-color:#b0a080;--accent-color:#995500"><body><iframe title="Image" style="width:100%;height:500px;border:0" src="/image-viewer/?path=test.svg"></iframe></body></html>',
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  [browsers.chromium, browsers.webkit] = await Promise.all([chromium.launch(), webkit.launch()]);
});
afterAll(async () => {
  for (const b of Object.values(browsers)) await b.close();
  server?.stop(true);
});
for (const engine of ["chromium", "webkit"])
  browserTest(
    `${engine}: workspace image viewer follows parent palette and offers source-preserving surfaces`,
    async () => {
      const page = await browsers[engine].newPage({
        viewport: { width: 390, height: 700 },
        colorScheme: "dark",
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const requests: string[] = [];
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === server.url.origin
          ? route.continue()
          : route.abort(),
      );
      page.on("request", (req) => {
        if (new URL(req.url()).pathname === "/workspace/raw")
          requests.push(req.url());
      });
      try {
        await page.goto(server.url.href);
        const frame = page.frameLocator("iframe");
        await frame.locator("img").waitFor();
        const source = await frame.locator("img").getAttribute("src");
        expect(
          await frame
            .locator("body")
            .evaluate((e) => getComputedStyle(e).backgroundColor),
        ).toBe("rgb(255, 248, 231)");
        expect(
          await frame
            .locator("html")
            .evaluate((e) => getComputedStyle(e).colorScheme),
        ).toBe("light");
        await page.evaluate(() => {
          const root = document.documentElement;
          root.style.setProperty("--bg-primary", "#201028");
          root.style.setProperty("--text-primary", "#f0e0ff");
          root.dataset.theme = "dark";
          root.style.colorScheme = "dark";
          window.dispatchEvent(new Event("piclaw-theme-change"));
        });
        expect(
          await frame
            .locator("body")
            .evaluate((e) => getComputedStyle(e).backgroundColor),
        ).toBe("rgb(32, 16, 40)");
        expect(await frame.locator("img").getAttribute("src")).toBe(source);
        for (const [value, expected] of [
          ["light", "rgb(255, 255, 255)"],
          ["dark", "rgb(23, 27, 34)"],
          ["transparent", "rgba(0, 0, 0, 0)"],
        ]) {
          await frame.getByLabel("Image background").selectOption(value);
          expect(
            await frame
              .locator("img")
              .evaluate((e) => getComputedStyle(e).backgroundColor),
          ).toBe(expected);
        }
        await frame.getByLabel("Image background").focus();
        await page.waitForTimeout(250);
        expect(
          await frame
            .locator("#toolbar")
            .evaluate((e) => getComputedStyle(e).opacity),
        ).not.toBe("0");
        await frame
          .getByRole("button", { name: "Zoom in", exact: true })
          .click();
        expect(await frame.locator("#zoomLabel").textContent()).toBe("125%");
        await frame.getByRole("button", { name: "Reset zoom" }).click();
        expect(await frame.locator("#zoomLabel").textContent()).toBe("100%");
        expect(requests).toHaveLength(1);
        expect(errors).toEqual([]);
        await page.screenshot({
          path: join(evidence, engine + "-workspace-viewer.png"),
        });
        const response = await page.request.get(
          server.url + "image-viewer/?path=test.svg",
        );
        expect(response.headers()["content-security-policy"]).toContain(
          "frame-ancestors 'self'",
        );
        expect(response.headers()["x-frame-options"]).toBe("SAMEORIGIN");
      } finally {
        await page.close();
      }
    },
    20000,
  );
