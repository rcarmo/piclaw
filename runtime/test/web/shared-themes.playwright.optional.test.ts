import { beforeAll, afterAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const root = join(import.meta.dir, "../..");
let server: ReturnType<typeof Bun.serve>,
  base = "";
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  if (!enabled) return;
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "fixtures/shared-themes-fixture.ts")],
    target: "browser",
    format: "esm",
    jsx: { runtime: "automatic", importSource: "preact" },
  });
  if (!build.success) throw new Error(String(build.logs));
  const bundle = await build.outputs[0].text();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/fixture.js")
        return new Response(bundle, {
          headers: { "content-type": "text/javascript" },
        });
      if (url.pathname === "/")
        return new Response(
          `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/${"classic"}/css/styles.css"><style>body{overflow:auto}#app{height:auto;min-height:100vh}.settings-content,.settings-panel__content{max-width:100%;padding:16px}.settings-theme-table{max-width:100%}#theme-probes{padding:16px}#theme-probes pre{background:var(--bg-code);color:var(--text-code);padding:12px}#theme-prose{color:var(--text-primary)}</style></head><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      if (url.pathname.startsWith("/static/") && !url.pathname.includes("..")) {
        const f = Bun.file(join(root, "web/static", url.pathname.slice(8)));
        if (await f.exists()) return new Response(f);
      }
      return new Response("not found", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
  browsers.chromium = await chromium.launch({ headless: true });
  browsers.webkit = await webkit.launch({ headless: true });
}, 30000);
afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  server?.stop(true);
});
async function open(engine: string, skin: string, width = 1280) {
  const page = await browsers[engine].newPage({
    viewport: { width, height: 850 },
    colorScheme: "dark",
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?skin=${skin}`);
  await page.waitForFunction(
    () =>
      !!(window as any).themeFixture &&
      !!document.getElementById("theme-probes"),
  );
  await page.waitForLoadState("networkidle");
  return { page, errors };
}
async function select(page: Page, skin: string, name: string) {
  await page.getByRole("radio", { name, exact: true }).check();
}
for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic"]) {
    browserTest(
      `${engine} ${skin}: all palettes share mode, foreground and terminal roles`,
      async () => {
        const { page, errors } = await open(engine, skin);
        try {
          const results = await page.evaluate(() => {
            const f = (window as any).themeFixture;
            return f.presets.map((preset: any) => {
              f.selectLocalTheme(preset.id);
              const s = getComputedStyle(document.documentElement);
              return {
                id: preset.id,
                mode: document.documentElement.dataset.theme,
                expected: preset.mode === "auto" ? "dark" : preset.mode,
                colorScheme: s.colorScheme,
                bg: s.getPropertyValue("--bg").trim(),
                bgAlias: s.getPropertyValue("--bg-primary").trim(),
                text: s.getPropertyValue("--text").trim(),
                textAlias: s.getPropertyValue("--text-primary").trim(),
                accent: s.getPropertyValue("--accent").trim(),
                accentAlias: s.getPropertyValue("--accent-color").trim(),
                code: s.getPropertyValue("--bg-code").trim(),
                termBackground: s.getPropertyValue("--bg-terminal").trim(),
                term: f.terminalThemeFromCss(),
              };
            });
          });
          expect(results.length).toBe(56);
          for (const r of results) {
            expect(r.mode).toBe(r.expected);
            expect(r.colorScheme).toBe(r.mode);
            expect(r.bg).toBe(r.bgAlias);
            expect(r.text).toBe(r.textAlias);
            expect(r.accent).toBe(r.accentAlias);
            expect(r.term.background).toBe(r.termBackground);
            expect(r.term.foreground).toBe(r.text);
          }
          await page.evaluate(() => {
            const f = (window as any).themeFixture;
            f.selectLocalTheme("default");
            f.setThemeModePreference("light");
          });
          expect(await page.locator("html").getAttribute("data-theme")).toBe(
            "light",
          );
          await page.evaluate(() =>
            (window as any).themeFixture.setThemeModePreference("auto"),
          );
          await page.emulateMedia({ colorScheme: "light" });
          await page.waitForFunction(
            () => document.documentElement.dataset.theme === "light",
          );
          await page.evaluate(() =>
            (window as any).themeFixture.selectLocalTheme("solarized-dark"),
          );
          expect(await page.locator("html").getAttribute("data-theme")).toBe(
            "dark",
          );
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      30000,
    );
    browserTest(
      `${engine} ${skin}: actual Appearance selects Monokais and intrinsic SynthWave glow`,
      async () => {
        const { page, errors } = await open(engine, skin, 390);
        try {
          await select(page, skin, "Monokai Original");
          expect(
            await page.locator("html").getAttribute("data-color-theme"),
          ).toBe("monokai");
          expect(
            await page
              .locator("html")
              .evaluate((e) =>
                getComputedStyle(e).getPropertyValue("--accent-color").trim(),
              ),
          ).toBe("#f92672");
          await select(page, skin, "Monokai Pro");
          expect(
            await page.locator("html").getAttribute("data-color-theme"),
          ).toBe("monokai-pro");
          expect(
            await page
              .locator("html")
              .evaluate((e) =>
                getComputedStyle(e).getPropertyValue("--accent-color").trim(),
              ),
          ).toBe("#ff6188");
          // Legacy local opt-out must never suppress intrinsic SynthWave glow.
          await page.evaluate(() =>
            localStorage.setItem("piclaw_synthwave_glow", "off"),
          );
          await select(page, skin, "SynthWave ’84");
          expect(
            await page
              .locator(".token.keyword")
              .evaluate((e) => getComputedStyle(e).textShadow),
          ).not.toBe("none");
          expect(
            await page
              .locator("#theme-real-code .tok-keyword")
              .first()
              .evaluate((e) => getComputedStyle(e).textShadow),
          ).not.toBe("none");
          expect(
            await page
              .locator("#theme-prose")
              .evaluate((e) => getComputedStyle(e).textShadow),
          ).toBe("none");
          expect(
            await page
              .getByRole("checkbox", { name: /SynthWave glow/i })
              .count(),
          ).toBe(0);
          expect(
            await page
              .locator(".token.keyword")
              .evaluate((e) => getComputedStyle(e).textShadow),
          ).not.toBe("none");
          await page.emulateMedia({ forcedColors: "active" });
          expect(
            await page
              .locator(".token.keyword")
              .evaluate((e) => getComputedStyle(e).textShadow),
          ).toBe("none");
          await page.emulateMedia({ forcedColors: "none" });
          await page.locator("#theme-probes").scrollIntoViewIfNeeded();
          await mkdir(join(root, "../.artifacts/shared-themes"), {
            recursive: true,
          });
          await page.screenshot({
            path: join(
              root,
              `../.artifacts/shared-themes/${engine}-${skin}-synthwave-glow-390.png`,
            ),
            fullPage: true,
          });
          await select(page, skin, "Paper");
          expect(await page.locator("html").getAttribute("data-theme")).toBe(
            "light",
          );
          expect(
            await page
              .locator(".token.keyword")
              .evaluate((e) => getComputedStyle(e).textShadow),
          ).toBe("none");
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth - innerWidth,
            ),
          ).toBeLessThanOrEqual(1);
          await mkdir(join(root, "../.artifacts/shared-themes"), {
            recursive: true,
          });
          await page.screenshot({
            path: join(
              root,
              `../.artifacts/shared-themes/${engine}-${skin}-paper-390.png`,
            ),
            fullPage: true,
          });
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      30000,
    );
  }

for (const engine of ["chromium", "webkit"])
  for (const width of [1366, 820, 520, 390]) {
    browserTest(
      `${engine}: real Classic Appearance dialog has aligned compact theme columns at ${width}px`,
      async () => {
        const page = await browsers[engine].newPage({
          viewport: { width, height: 900 },
          colorScheme: "dark",
        });
        try {
          await page.goto(`${base}/?skin=classic&host=dialog`);
          await page
            .locator(".settings-theme-table tbody tr")
            .first()
            .waitFor();
          const geometry = await page.evaluate(() => {
            const content = document.querySelector(
              ".settings-content",
            ) as HTMLElement;
            const table = document.querySelector(
              ".settings-theme-table",
            ) as HTMLElement;
            const root = content.getBoundingClientRect();
            const rows = [...table.querySelectorAll("tr")].map((row) =>
              [...row.children].map((cell) => {
                const r = cell.getBoundingClientRect();
                return { left: r.left, right: r.right, width: r.width };
              }),
            );
            const first = rows[0];
            const drift = rows.flatMap((row) =>
              row.map((cell, i) => Math.abs(cell.left - first[i].left)),
            );
            const swatches = [
              ...table.querySelectorAll(".settings-theme-palette"),
            ].map((el) => ({
              width: el.getBoundingClientRect().width,
              visible: getComputedStyle(el).display !== "none",
              colours: el.children.length,
            }));
            const select = document
              .querySelector("#appearance-mode")!
              .getBoundingClientRect();
            const label = document
              .querySelector('label[for="appearance-mode"]')!
              .getBoundingClientRect();
            return {
              columns: first.length,
              drift: Math.max(...drift),
              overflow: content.scrollWidth - content.clientWidth,
              tableWidth: table.getBoundingClientRect().width,
              contentWidth: content.clientWidth,
              swatches,
              modeOutside: select.left < root.left || select.right > root.right,
              labelWidth: label.width,
              nameWidths: rows.slice(1).map((r) => r[1].width),
            };
          });
          expect(geometry.columns).toBe(4);
          expect(geometry.drift).toBeLessThanOrEqual(1);
          expect(geometry.overflow).toBeLessThanOrEqual(1);
          expect(geometry.tableWidth).toBeLessThanOrEqual(
            geometry.contentWidth,
          );
          expect(Math.min(...geometry.nameWidths)).toBeGreaterThanOrEqual(
            width <= 390 ? 115 : 140,
          );
          expect(geometry.modeOutside).toBe(false);
          expect(geometry.labelWidth).toBeGreaterThanOrEqual(170);
          expect(geometry.swatches.length).toBe(55);
          expect(
            geometry.swatches.every(
              (s) => s.visible && s.width >= 75 && s.colours === 8,
            ),
          ).toBe(true);
          expect(
            await page.getByRole("columnheader").allTextContents(),
          ).toEqual(["Selected", "Theme", "Mode", "Palette"]);
          expect(
            await page
              .getByRole("checkbox", { name: /SynthWave glow/i })
              .count(),
          ).toBe(0);
          await page
            .getByRole("radio", { name: "Monokai Pro", exact: true })
            .check();
          expect(
            await page.locator("html").getAttribute("data-color-theme"),
          ).toBe("monokai-pro");
          await page.locator(".settings-content").evaluate((e) => {
            e.scrollTop = 0;
          });
          await mkdir(join(root, "../.artifacts/appearance-correction"), {
            recursive: true,
          });
          await page.screenshot({
            path: join(
              root,
              `../.artifacts/appearance-correction/${engine}-classic-${width}.png`,
            ),
          });
        } finally {
          await page.close();
        }
      },
      20000,
    );
  }

for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic"]) {
    browserTest(
      `${engine} ${skin}: Full has strong animated neon, Normal stays static, accessibility and visibility stop motion`,
      async () => {
        const { page, errors } = await open(engine, skin, 820);
        try {
          await page.emulateMedia({ reducedMotion: "no-preference" });
          await select(page, skin, "SynthWave ’84");
          const keyword = page.locator("#theme-real-code .tok-keyword").first();
          const normal = await keyword.evaluate((e) => ({
            shadow: getComputedStyle(e).textShadow,
            color: getComputedStyle(e).color,
            animation: getComputedStyle(e).animationName,
          }));
          expect(normal.animation).toBe("none");
          expect(normal.shadow).not.toBe("none");
          await select(page, skin, "SynthWave ’84 Full");
          expect(
            await page.locator("html").getAttribute("data-color-theme"),
          ).toBe("synthwave-84-full");
          const full = await keyword.evaluate((e) => ({
            shadow: getComputedStyle(e).textShadow,
            color: getComputedStyle(e).color,
            animation: getComputedStyle(e).animationName,
            duration: getComputedStyle(e).animationDuration,
          }));
          expect(full.color).toBe("rgb(244, 238, 228)");
          expect(full.shadow).not.toBe(normal.shadow);
          expect(full.animation).toBe("synthwave-full-neon");
          expect(full.duration).toBe("5.5s");
          expect(
            await page
              .locator("#theme-probes .compose-send-btn")
              .evaluate((e) => getComputedStyle(e, "::after").animationName),
          ).toBe("synthwave-full-accent");
          expect(
            await page.locator("#theme-prose").evaluate((e) => getComputedStyle(e).textShadow),
          ).not.toBe("none");
          expect(await page.locator('body').evaluate((e) => getComputedStyle(e).animationName)).toBe('synthwave-full-ui');
          const before = await keyword.evaluate(
            (e) => e.getAnimations()[0]?.currentTime as number,
          );
          await page.waitForTimeout(180);
          const after = await keyword.evaluate(
            (e) => e.getAnimations()[0]?.currentTime as number,
          );
          expect(after).toBeGreaterThan(before);
          // Explicit visibility-handler test; headless execution is not evidence of a native hidden tab.
          await page.evaluate(() => {
            Object.defineProperty(document, "hidden", {
              configurable: true,
              get: () => true,
            });
            document.dispatchEvent(new Event("visibilitychange"));
          });
          expect(
            await page.locator("html").getAttribute("data-theme-motion"),
          ).toBe("paused");
          expect(
            await keyword.evaluate(
              (e) => getComputedStyle(e).animationPlayState,
            ),
          ).toBe("paused");
          expect(
            await page
              .locator("#theme-probes .compose-send-btn")
              .evaluate(
                (e) => getComputedStyle(e, "::after").animationPlayState,
              ),
          ).toBe("paused");
          await page.evaluate(() => {
            delete (document as any).hidden;
            document.dispatchEvent(new Event("visibilitychange"));
          });
          expect(
            await keyword.evaluate(
              (e) => getComputedStyle(e).animationPlayState,
            ),
          ).toBe("running");
          await page.emulateMedia({ reducedMotion: "reduce" });
          expect(
            await keyword.evaluate((e) => getComputedStyle(e).animationName),
          ).toBe("none");
          expect(
            await keyword.evaluate((e) => getComputedStyle(e).textShadow),
          ).not.toBe("none");
          expect(
            await page
              .locator("#theme-probes .compose-send-btn")
              .evaluate((e) => getComputedStyle(e, "::after").animationName),
          ).toBe("none");
          await page.emulateMedia({
            reducedMotion: "no-preference",
            forcedColors: "active",
          });
          expect(
            await keyword.evaluate((e) => getComputedStyle(e).animationName),
          ).toBe("none");
          expect(
            await keyword.evaluate((e) => getComputedStyle(e).textShadow),
          ).toBe("none");
          expect(
            await page
              .locator("#theme-probes .compose-send-btn")
              .evaluate((e) => getComputedStyle(e, "::after").display),
          ).toBe("none");
          await page.emulateMedia({ forcedColors: "none" });
          await page.locator("#theme-probes").scrollIntoViewIfNeeded();
          await mkdir(join(root, "../.artifacts/synthwave-full"), {
            recursive: true,
          });
          await page.evaluate(() =>
            document.getAnimations().forEach((a) => {
              a.pause();
              a.currentTime = 2750;
            }),
          );
          await page.locator("#theme-probes").screenshot({
            path: join(
              root,
              `../.artifacts/synthwave-full/${engine}-${skin}-full.png`,
            ),
          });
          if (engine === "chromium" && skin === "classic") {
            const frames = join(root, "../.artifacts/synthwave-full/frames");
            await mkdir(frames, { recursive: true });
            for (let index = 0; index < 44; index++) {
              await page.evaluate(
                (time) =>
                  document.getAnimations().forEach((a) => {
                    a.pause();
                    a.currentTime = time;
                  }),
                index * 125,
              );
              await page.locator("#theme-probes").screenshot({
                path: join(frames, `${String(index).padStart(3, "0")}.png`),
              });
            }
          }
          await select(page, skin, "SynthWave ’84");
          expect(
            await keyword.evaluate((e) => getComputedStyle(e).animationName),
          ).toBe("none");
          expect(await keyword.evaluate((e) => getComputedStyle(e).color)).toBe(
            normal.color,
          );
          expect(
            await page
              .locator("#theme-probes .compose-send-btn")
              .evaluate((e) => getComputedStyle(e, "::after").content),
          ).toBe("none");
          await page.locator("#theme-probes").screenshot({
            path: join(
              root,
              `../.artifacts/synthwave-full/${engine}-${skin}-normal.png`,
            ),
          });
          await select(page, skin, "Paper");
          expect(
            await keyword.evaluate((e) => getComputedStyle(e).textShadow),
          ).toBe("none");
          expect(
            await page.evaluate(
              () =>
                document
                  .getAnimations()
                  .filter((a) =>
                    (a as CSSAnimation).animationName?.startsWith(
                      "synthwave-full",
                    ),
                  ).length,
            ),
          ).toBe(0);
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      30000,
    );
  }

for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic"]) {
    browserTest(
      `${engine} ${skin}: requested catalogue themes are selectable with correct native mode`,
      async () => {
        const { page, errors } = await open(engine, skin, 1280);
        try {
          for (const [name, id, mode, bg] of [
            ["Turbo Pascal (Original)", "turbo-pascal", "dark", "#000088"],
            ["Tokyo Night", "tokyo", "dark", "#1a1b26"],
            ["Tokyo Night Storm", "tokyo-night-storm", "dark", "#24283b"],
            ["Tokyo Night Light", "tokyo-night-light", "light", "#e6e7ed"],
            ["Noctis", "noctis", "dark", "#052529"],
            ["Noctis Lux", "noctis-lux", "light", "#fef8ec"],
            ["Bearded Arc", "bearded-arc", "dark", "#1c2433"],
            ["Catppuccin Frappé", "catppuccin-frappe", "dark", "#303446"],
            ["Catppuccin Macchiato", "catppuccin-macchiato", "dark", "#24273a"],
            ["Nord", "nord", "dark", "#2e3440"],
            ["AS/400 Green Screen (5250)", "as400", "dark", "#000000"],
            ["Lumon", "lumon", "dark", "#1b2d40"],
          ]) {
            await select(page, skin, name);
            expect(
              await page.locator("html").getAttribute("data-color-theme"),
            ).toBe(id);
            expect(await page.locator("html").getAttribute("data-theme")).toBe(
              mode,
            );
            expect(
              await page
                .locator("html")
                .evaluate((e) =>
                  getComputedStyle(e).getPropertyValue("--bg-primary").trim(),
                ),
            ).toBe(bg);
            expect(
              await page
                .locator("#theme-real-code .tok-keyword")
                .first()
                .evaluate((e) => getComputedStyle(e).animationName),
            ).toBe("none");
            if (engine === "chromium") {
              await mkdir(join(root, "../.artifacts/requested-themes"), {
                recursive: true,
              });
              await page.locator("#theme-probes").scrollIntoViewIfNeeded();
              await page.locator("#theme-probes").screenshot({
                path: join(
                  root,
                  `../.artifacts/requested-themes/${skin}-${id}.png`,
                ),
              });
            }
          }
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      60000,
    );
  }

for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic"]) {
    browserTest(
      `${engine} ${skin}: AS400 renders syntax, statuses, overlays and ANSI without red or blue`,
      async () => {
        const { page, errors } = await open(engine, skin, 820);
        try {
          await select(page, skin, "AS/400 Green Screen (5250)");
          const colors = await page.evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            const probe = document.getElementById("theme-probes")!;
            const status = document.createElement("p");
            status.id = "as400-status-colors";
            for (const [name, key] of [
              ["✓ Ready", "--success-color"],
              ["△ Warning", "--warning-color"],
              ["× Error", "--danger-color"],
            ]) {
              const span = document.createElement("span");
              span.textContent = name + "  ";
              span.style.color = `var(${key})`;
              status.append(span);
            }
            probe.append(status);
            const overlay = document.createElement("div");
            overlay.id = "as400-overlay";
            overlay.textContent = "Hover / selected surface";
            overlay.style.background = "var(--overlay-white-15)";
            probe.append(overlay);
            const swatches = Array.from(
              probe.querySelectorAll(
                "#theme-real-code span, #theme-prose, #as400-status-colors span, #as400-overlay",
              ),
            ).map((el) => ({
              label: el.textContent,
              color: getComputedStyle(el).color,
              background: getComputedStyle(el).backgroundColor,
            }));
            return {
              swatches,
              terminal: (window as any).themeFixture.terminalThemeFromCss(),
              tints: ["--tint-red-13", "--tint-blue-13", "--tint-green-13"].map(
                (k) => root.getPropertyValue(k).trim(),
              ),
            };
          });
          function monochrome(color: string) {
            if (color.startsWith("#")) {
              expect(color).toMatch(/^#00[\da-f]{2}00$/i);
              return;
            }
            const match = /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/.exec(
              color,
            );
            expect(match).not.toBeNull();
            expect(Number(match![1])).toBe(0);
            expect(Number(match![3])).toBe(0);
          }
          for (const sample of colors.swatches) {
            monochrome(sample.color);
            monochrome(sample.background);
          }
          for (const color of Object.values(colors.terminal))
            monochrome(String(color));
          for (const color of colors.tints) monochrome(color);
          await mkdir(join(root, "../.artifacts/as400-green"), {
            recursive: true,
          });
          await page.locator("#theme-probes").screenshot({
            path: join(root, `../.artifacts/as400-green/${engine}-${skin}.png`),
          });
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      20000,
    );
  }

for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic"]) {
    browserTest(
      `${engine} ${skin}: every palette preserves expected syntax roles in real chat/editor scopes`,
      async () => {
        const { page, errors } = await open(engine, skin, 1280);
        try {
          await page.waitForSelector("#syntax-editor .cm-content");
          const result = await page.evaluate((skin) => {
            const f = (window as any).themeFixture;
            const failures: string[] = [];
            let checks = 0;
            const color = (value: string) => {
              const el = document.createElement("span");
              el.style.color = value;
              document.body.append(el);
              const c = getComputedStyle(el).color;
              el.remove();
              return c;
            };
            for (const expectation of f.syntaxExpectations) {
              if (expectation.skin && expectation.skin !== skin) continue;

              f.setThemeModePreference(expectation.mode);
              f.selectLocalTheme(expectation.id);
              for (const scope of [".post-content", ".cm-editor"])
                for (const role of f.syntaxRoles) {
                  const el = document.querySelector(
                    `#syntax-roles ${scope} [data-role="${role}"]`,
                  )!;
                  const actual = getComputedStyle(el).color,
                    expected = color(expectation.roles[role]);
                  checks++;
                  if (actual !== expected)
                    failures.push(
                      `${expectation.id}/${expectation.mode}/${scope}/${role}: ${actual} != ${expected}`,
                    );
                }
              const pairs = [
                ["#theme-real-code .tok-keyword", "keyword"],
                ["#syntax-editor .tok-keyword", "keyword"],
                ["#theme-real-code .tok-number", "number"],
                ["#syntax-editor .tok-number", "number"],
                ["#theme-real-code .tok-string", "string"],
                ["#syntax-editor .tok-string", "string"],
                ["#syntax-editor .tok-comment", "comment"],
                ["#syntax-editor .tok-function", "function"],
                ["#theme-real-code .tok-function", "function"],
              ];
              for (const [selector, role] of pairs) {
                const el = document.querySelector(selector);
                checks++;
                if (!el) failures.push(`Missing real parser token ${selector}`);
                else if (
                  getComputedStyle(el).color !== color(expectation.roles[role])
                )
                  failures.push(
                    `${expectation.id}/${selector}: incorrect ${role}`,
                  );
              }
              for (const selector of [
                "#theme-real-code code",
                "#syntax-editor .cm-content",
              ]) {
                checks++;
                if (
                  getComputedStyle(document.querySelector(selector)!).color !==
                  color(expectation.foreground)
                )
                  failures.push(
                    `${expectation.id} base code foreground ${selector}`,
                  );
              }
              for (const selector of [
                "#theme-real-code",
                "#syntax-editor .cm-scroller",
              ]) {
                checks++;
                if (
                  getComputedStyle(document.querySelector(selector)!)
                    .backgroundColor !== color(expectation.background)
                )
                  failures.push(
                    `${expectation.id} code background ${selector}`,
                  );
              }
              checks++;
              if (
                getComputedStyle(document.querySelector("#theme-prose")!)
                  .color !==
                color(
                  getComputedStyle(document.documentElement)
                    .getPropertyValue("--text-primary")
                    .trim(),
                )
              )
                failures.push(`${expectation.id} prose foreground`);
            }
            return { failures, checks };
          }, skin);
          expect(result.failures).toEqual([]);
          expect(result.checks).toBeGreaterThan(3500);
          if (engine === "chromium") {
            await mkdir(join(root, "../.artifacts/theme-syntax"), {
              recursive: true,
            });
            for (const [id, label] of [
              ["lumon", "Lumon"],
              ["noctis", "Noctis"],
              ["tokyo", "Tokyo Night"],
              ["monokai", "Monokai Original"],
              ["monokai-pro", "Monokai Pro"],
              ["as400", "AS/400 Green Screen"],
            ]) {
              await page.evaluate(
                ({ id, label }) => {
                  const f = (window as any).themeFixture;
                  f.selectLocalTheme(id);
                  let frame = document.getElementById("syntax-capture");
                  if (!frame) {
                    frame = document.createElement("section");
                    frame.id = "syntax-capture";
                    frame.style.cssText =
                      "padding:20px;max-width:760px;background:var(--bg-primary);color:var(--text-primary);";
                    frame.innerHTML =
                      '<h2 id="syntax-capture-title"></h2><h3>Chat code</h3><div class="post-content" id="syntax-capture-chat"></div><h3>Editor</h3>';
                    frame
                      .querySelector("#syntax-capture-chat")!
                      .append(document.getElementById("theme-real-code")!);
                    frame.append(document.getElementById("syntax-editor")!);
                    document.body.append(frame);
                  }
                  document.getElementById("syntax-capture-title")!.textContent =
                    label;
                },
                { id, label },
              );
              await page
                .locator("#syntax-capture")
                .screenshot({
                  path: join(
                    root,
                    `../.artifacts/theme-syntax/${skin}-${id}.png`,
                  ),
                });
            }
          }
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      60000,
    );
  }

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  browserTest(name + ": rendered Markdown fences follow theme and live system mode", async () => {
    const browser = await engine.launch({ headless: true });
    try {
      for (const skin of ["classic"]) {
        const page = await browser.newPage({ colorScheme: "dark", viewport: { width: 1280, height: 1000 } });
        const errors: string[] = [];
        page.on("pageerror", e => errors.push(e.message));
        await page.goto(base + "/?skin=" + skin + "&fences=1", { waitUntil: "networkidle" });
        const surfaces = ["#markdown-timeline", "#markdown-workspace-preview", "#markdown-editor-preview"];
        for (const surface of surfaces) await page.locator(surface + " .tok-keyword").first().waitFor();
        expect(await page.evaluate(() => (window as any).cmHighlight)).toBeUndefined();
        const read = () => page.evaluate((surfaces) => {
          const resolve = (role: string) => {
            const probe = document.createElement("span");
            probe.style.color = "var(--syntax-" + role + ")";
            document.body.append(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
          };
          const roles = { keyword: "tok-keyword", string: "tok-string", number: "tok-number", atom: "tok-bool", function: "tok-function", comment: "tok-comment" };
          return surfaces.map(surface => {
            const node = document.querySelector(surface)!;
            const failures: string[] = [];
            const colors: string[] = [];
            for (const [role, cls] of Object.entries(roles)) {
              const token = node.querySelector("." + cls);
              if (!token) { failures.push("missing:" + role); continue; }
              const actual = getComputedStyle(token).color, expected = resolve(role);
              colors.push(actual);
              if (actual !== expected) failures.push(role + ":" + actual + " != " + expected);
            }
            const code = node.querySelector("pre code, .cm-md-code-content")!;
            const backdrop = node.querySelector("pre, .cm-md-code-line")!;
            const probe = document.createElement("span");
            probe.style.cssText = "color:var(--text-code);background:var(--bg-code)";
            document.body.append(probe);
            const expected = getComputedStyle(probe);
            if (getComputedStyle(code).color !== expected.color) failures.push("foreground");
            if (getComputedStyle(backdrop).backgroundColor !== expected.backgroundColor) failures.push("background");
            probe.remove();
            return { surface, failures, colors };
          });
        }, surfaces);
        await page.evaluate(() => { const f=(window as any).themeFixture; f.selectLocalTheme("default",null); f.setThemeModePreference("auto"); });
        const dark = await read();
        for (const probe of dark) expect(probe.failures).toEqual([]);
        await page.emulateMedia({ colorScheme: "light" });
        await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
        const light = await read();
        for (const probe of light) expect(probe.failures).toEqual([]);
        expect(light[0].colors).not.toEqual(dark[0].colors);
        for (const id of ["monokai", "solarized-light", "github-dark"]) {
          await page.evaluate(id => (window as any).themeFixture.selectLocalTheme(id,null),id);
          for (const probe of await read()) expect(probe.failures).toEqual([]);
        }
        for (const probe of await read()) expect(probe.failures).toEqual([]);
        await page.emulateMedia({ colorScheme: "dark" });
        for (const probe of await read()) expect(probe.failures).toEqual([]);
        expect(errors).toEqual([]);
        await page.close();
      }
    } finally { await browser.close(); }
  }, 120000);
}
