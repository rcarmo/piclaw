import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium, webkit, type Browser } from "playwright";
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const root = join(import.meta.dir, "../.."),
  evidence = join(root, "../.artifacts/workspace-theme");
let server: ReturnType<typeof Bun.serve>;
const browsers: Record<string, Browser> = {};
beforeAll(async () => {
  if (!enabled) return;
  const b = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "fixtures/workspace-theme-fixture.tsx"),
    ],
    target: "browser",
    jsx: { runtime: "automatic", importSource: "preact" },
  });
  if (!b.success) throw Error(String(b.logs));
  const script = await b.outputs[0].text();
  await mkdir(evidence, { recursive: true });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/fixture.js")
        return new Response(script, {
          headers: { "content-type": "text/javascript" },
        });
      if (u.pathname === "/") {
        const skin =
          "classic";
        return new Response(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/${skin}/dist/app.bundle.css"><style>html,body{margin:0;height:auto;overflow:auto}#layout{display:flex;gap:24px;padding:18px;align-items:flex-start}#explorer-host{width:340px;min-width:0;height:790px;border:1px solid var(--border-color);background:var(--bg-secondary)}#meter-host{position:relative;min-width:190px;height:250px}.system-meters-hud-overlay{position:relative;top:0;right:0}.system-meters-row{display:grid;grid-template-columns:34px 56px auto;gap:8px}.system-meters-spark{width:56px;height:16px;overflow:visible}.system-meters-spark path{fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.system-meters-card{padding:10px;border:1px solid var(--border-color);background:var(--bg-primary);color:var(--text-primary)}.workspace-explorer{height:100%}#explorer-host .workspace-sidebar{display:flex!important;position:relative!important;width:100%!important;height:100%!important}#explorer-host .workspace-row,#explorer-host .file-tree__item{transition:none!important}#visual-stats{max-width:190px}@media(max-width:600px){#layout{flex-direction:column;padding:12px}#explorer-host{width:100%;height:670px}#meter-host{width:100%}}</style></head><body><div id="layout"><div id="explorer-host"></div><div><div id="meter-host"></div><div id="visual-stats"></div></div></div><script type="module" src="/fixture.js"></script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      if (u.pathname.startsWith("/static/") && !u.pathname.includes("..")) {
        const f = Bun.file(join(root, "web/static", u.pathname.slice(8)));
        if (await f.exists()) return new Response(f);
      }
      return new Response(null, { status: 404 });
    },
  });
  browsers.chromium = await chromium.launch();
  browsers.webkit = await webkit.launch();
}, 30000);
afterAll(async () => {
  for (const b of Object.values(browsers)) await b.close();
  server?.stop(true);
});
for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic"])
    for (const width of [390, 1100])
      browserTest(
        `${engine} ${skin} explorer/chart/meters follow palettes at ${width}`,
        async () => {
          const page = await browsers[engine].newPage({
            viewport: { width, height: 1050 },
            colorScheme: "dark",
            reducedMotion: "no-preference",
          });
          const errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          page.setDefaultTimeout(6000);
          try {
            await page.route("**/*", (r) =>
              new URL(r.request().url()).origin === server.url.origin
                ? r.continue()
                : r.abort(),
            );
            await page.goto(`${server.url}?skin=${skin}`);
            await page.waitForFunction(() =>
              Boolean((window as any).workspaceTheme),
            );
            {
              await page.locator('[data-item-path="src/"]').click();
              // Folder sizes load on demand from the selection bar disclosure.
              await page.locator(".workspace-folder-sizes > summary").click();
              await page
                .locator(".workspace-folder-starburst-segment")
                .first()
                .waitFor();
            }
            await page
              .locator(
                width > 600
                  ? ".system-meters-row.cpu path"
                  : ".system-meters-compact-summary",
              )
              .waitFor();
            await page.waitForTimeout(300);
            const segment =
              ".workspace-folder-starburst-segment";
            const selected =
              '[data-item-path][aria-selected="true"]';
            const initialCalls = await page.evaluate(
              () =>
                (window as any).workspaceTheme.calls.filter(
                  (path: string) =>
                    path === "/workspace/tree" || path === "/workspace/stat",
                ).length,
            );
            const result = await page.evaluate(
              ({ segment, selected, width }) => {
                const f = (window as any).workspaceTheme;
                let checks = 0;
                const failures: string[] = [];
                const p = document.createElement("span");
                document.body.append(p);
                const color = (v: string) => {
                  p.style.color = v;
                  return getComputedStyle(p).color;
                };
                const geometry = document
                  .querySelector(segment)!
                  .getAttribute("d");
                for (const theme of f.presets) {
                  f.selectLocalTheme(theme.id);
                  for (const node of document.querySelectorAll(segment)) {
                    const fill = getComputedStyle(node).fill;
                    if (!node.getAttribute("fill")?.includes("var(--chart-"))
                      failures.push(theme.id + " unthemed arc");
                    const expected = color(node.getAttribute("fill")!);
                    checks++;
                    if (fill !== expected)
                      failures.push(
                        theme.id + " arc " + fill + "!=" + expected,
                      );
                    if (theme.id === "as400" && /rgb\((?!0,)/.test(fill))
                      failures.push("AS400 arc " + fill);
                  }
                  for (const [name, slot] of Object.entries({
                    cpu: 1,
                    ram: 2,
                    swap: 4,
                    buf: 3,
                    rss: 6,
                    vram: 5,
                  })) {
                    const node = document.querySelector(
                      ".system-meters-row." + name + " path",
                    );
                    if (!node && width <= 600) continue;
                    checks++;
                    if (
                      getComputedStyle(node).stroke !==
                      color("var(--chart-" + slot + ")")
                    )
                      failures.push(theme.id + " meter " + name);
                  }
                  for (const icon of document.querySelectorAll(
                    ".file-tree__item--file .file-tree__icon",
                  )) {
                    if (
                      getComputedStyle(icon, "::before").color !==
                      color("var(--text-secondary)")
                    )
                      failures.push(theme.id + " file icon");
                  }
                  const row = document.querySelector(selected)!;
                  if (
                    getComputedStyle(row).backgroundColor !==
                    color(
                      row.matches(":hover")
                        ? "var(--accent-soft-strong)"
                        : "var(--accent-soft)",
                    )
                  )
                    failures.push(theme.id + " selected row");
                  if (
                    document.querySelector(segment)!.getAttribute("d") !==
                    geometry
                  )
                    failures.push("geometry changed");
                }
                p.remove();
                return { checks, failures };
              },
              { segment, selected, width },
            );
            expect(result.failures).toEqual([]);
            expect(result.checks).toBeGreaterThan(100);
            await page.waitForTimeout(300);
            expect(
              await page.evaluate(
                () =>
                  (window as any).workspaceTheme.calls.filter(
                    (path: string) =>
                      path === "/workspace/tree" || path === "/workspace/stat",
                  ).length,
              ),
            ).toBe(initialCalls);
            expect(
              await page
                .locator(segment)
                .first()
                .evaluate((e) => {
                  const p = document.createElement("span");
                  p.style.color = e.getAttribute("fill")!;
                  document.body.append(p);
                  const expected = getComputedStyle(p).color;
                  p.remove();
                  return getComputedStyle(e).fill === expected;
                }),
            ).toBe(true);
            await page.evaluate(() => {
              const f = (window as any).workspaceTheme;
              f.resetTheme();
              f.selectLocalTheme("synthwave-84-full");
            });
            if (width <= 600) {
              expect(
                await page
                  .locator(".system-meters-compact-summary")
                  .evaluate((e) => getComputedStyle(e).textShadow),
              ).not.toBe("none");
              await page.screenshot({
                path: join(evidence, `${engine}-${skin}-full-${width}.png`),
                fullPage: true,
              });
              await page.setViewportSize({ width: 1100, height: 1050 });
              await page.locator(".system-meters-row.cpu path").waitFor();
            }
            {
              await page
                .locator(".workspace-folder-starburst-segment")
                .first()
                .dispatchEvent("click");
              await page.waitForTimeout(300);
              expect(
                await page
                  .locator(".workspace-folder-starburst-svg")
                  .getAttribute("aria-label"),
              ).toContain("src/lib");
              await page.getByRole("button", { name: "Zoom out" }).click();
              await page.waitForTimeout(300);
              expect(
                await page
                  .locator(".workspace-folder-starburst-svg")
                  .getAttribute("aria-label"),
              ).toContain("src");
            }
            const spark = page.locator(
              ".system-meters-row.cpu .system-meters-spark",
            );
            expect(
              await spark.evaluate((e) => getComputedStyle(e).filter),
            ).not.toBe("none");
            expect(
              await spark.evaluate((e) => getComputedStyle(e).animationName),
            ).toBe("synthwave-meter-neon");
            await spark.scrollIntoViewIfNeeded();
            await page.waitForTimeout(100);
            const beforeTime = await spark.evaluate(
              (e) => e.getAnimations()[0]?.currentTime,
            );
            await page.waitForTimeout(180);
            expect(
              await spark.evaluate((e) => e.getAnimations()[0]?.currentTime),
            ).not.toBe(beforeTime);
            if (width > 600)
              await page.screenshot({
                path: join(evidence, `${engine}-${skin}-full-${width}.png`),
                fullPage: true,
              });
            await page.evaluate(() => {
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: true,
              });
              document.dispatchEvent(new Event("visibilitychange"));
            });
            expect(
              await spark.evaluate(
                (e) => getComputedStyle(e).animationPlayState,
              ),
            ).toBe("paused");
            await page.evaluate(() => {
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: false,
              });
              document.dispatchEvent(new Event("visibilitychange"));
            });
            expect(
              await spark.evaluate(
                (e) => getComputedStyle(e).animationPlayState,
              ),
            ).toBe("running");
            await page.emulateMedia({ reducedMotion: "reduce" });
            expect(
              await spark.evaluate((e) => getComputedStyle(e).animationName),
            ).toBe("none");
            expect(
              await spark.evaluate((e) => getComputedStyle(e).filter),
            ).not.toBe("none");
            if (engine === "chromium") {
              await page.emulateMedia({ forcedColors: "active" });
              expect(
                await spark.evaluate((e) => getComputedStyle(e).filter),
              ).toBe("none");
              await page.emulateMedia({ forcedColors: "none" });
            }
            await page.emulateMedia({ reducedMotion: "no-preference" });
            await page.evaluate(() =>
              (window as any).workspaceTheme.selectLocalTheme("synthwave-84"),
            );
            expect(
              await spark.evaluate((e) => getComputedStyle(e).filter),
            ).not.toBe("none");
            expect(
              await spark.evaluate((e) => getComputedStyle(e).animationName),
            ).toBe("none");
            await page.evaluate(() =>
              (window as any).workspaceTheme.selectLocalTheme("paper"),
            );
            expect(
              await spark.evaluate((e) => getComputedStyle(e).filter),
            ).toBe("none");
            expect(
              await spark.evaluate((e) => getComputedStyle(e).animationName),
            ).toBe("none");
            if (width <= 600)
              await page.setViewportSize({ width, height: 1050 });
            await page.screenshot({
              path: join(evidence, `${engine}-${skin}-paper-${width}.png`),
              fullPage: true,
            });
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth - innerWidth,
              ),
            ).toBeLessThanOrEqual(1);
            expect(errors).toEqual([]);
          } catch (e) {
            console.log(
              "FIXTURE_FAILURE",
              engine,
              skin,
              width,
              errors,
              (await page.locator("body").innerText()).slice(0, 1500),
            );
            throw e;
          } finally {
            await page.close();
          }
        },
        30000,
      );
