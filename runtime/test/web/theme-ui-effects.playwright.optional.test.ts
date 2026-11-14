import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { createTempWorkspace } from "../helpers";
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const root = join(import.meta.dir, "../..");
const evidence = join(root, "../.artifacts/full-ui");
const browsers: Record<string, Browser> = {};
let server: ReturnType<typeof Bun.serve>;
let workspace: ReturnType<typeof createTempWorkspace>;
beforeAll(async () => {
  if (!enabled) return;
  workspace = createTempWorkspace("theme-ui-");
  const built = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "fixtures/theme-ui-effects-fixture.tsx"),
    ],
    target: "browser",
    jsx: { runtime: "automatic", importSource: "preact" },
    external: ["#editor-vendor/codemirror"],
  });
  if (!built.success) throw new Error(String(built.logs));
  const script = await built.outputs[0].text();
  await mkdir(evidence, { recursive: true });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/fixture.js")
        return new Response(script, {
          headers: { "content-type": "text/javascript" },
        });
      if (url.pathname === "/media/42")
        return new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#f4d35e"/><circle cx="160" cy="90" r="55" fill="#336699"/></svg>',
          { headers: { "content-type": "image/svg+xml" } },
        );
      if (url.pathname === "/sse/stream")
        return new Response(": fixture\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      if (url.pathname === "/") {
        const skin =
          "classic";
        return new Response(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/${skin}/dist/app.bundle.css"><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><style>html,body{margin:0;width:100%;height:100%;overflow:auto}#app{min-height:100%;padding:24px;box-sizing:border-box}#real-compose{height:480px;position:relative}#control-matrix{display:grid;gap:14px}#control-matrix label{display:grid;gap:4px}#control-matrix input{max-width:100%}.post-content{padding:16px}</style></head><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      if (url.pathname === "/editor-vendor/codemirror.js")
        return new Response(
          Bun.file(
            join(root, "extensions/viewers/editor/vendor/codemirror.js"),
          ),
          { headers: { "content-type": "text/javascript" } },
        );
      if (url.pathname.startsWith("/static/") && !url.pathname.includes("..")) {
        const f = Bun.file(join(root, "web/static", url.pathname.slice(8)));
        if (await f.exists()) return new Response(f);
      }
      return new Response(null, { status: 404 });
    },
  });
  browsers.chromium = await chromium.launch();
  browsers.webkit = await webkit.launch();
}, 30000);
afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  server?.stop(true);
  workspace?.cleanup();
});
async function open(
  engine: string,
  skin: string,
  view: string,
  width = 820,
  extra = "",
) {
  const page = await browsers[engine].newPage({
    viewport: { width, height: 900 },
    reducedMotion: "no-preference",
    colorScheme: "dark",
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(5000);
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === server.url.origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(
    `${server.url}?skin=${skin}&view=${view}&picker=${view}&${extra}`,
  );
  await page.waitForFunction(() => Boolean((window as any).themeUi));
  return { page, errors };
}
async function themedFocus(page: Page, selector: string) {
  return page.locator(selector).evaluate((el: HTMLElement) => {
    el.focus();
    const s = getComputedStyle(el);
    const probe = document.createElement("span");
    probe.style.color = "var(--focus-ring)";
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return {
      focused: document.activeElement === el,
      color: s.outlineColor,
      expected,
      style: s.outlineStyle,
      width: s.outlineWidth,
      shadow: s.boxShadow,
      text: s.textShadow,
    };
  });
}
for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic"]) {
    browserTest(
      `${engine} ${skin}: every input family has palette focus, caret, selection and native accents`,
      async () => {
        const { page, errors } = await open(engine, skin, "matrix");
        try {
          const result = await page.evaluate(() => {
            const failures: string[] = [];
            let checks = 0;
            const probe = document.createElement("span");
            document.body.append(probe);
            const color = (v: string) => {
              probe.style.color = v;
              return getComputedStyle(probe).color;
            };
            for (const preset of (window as any).themeUi.presets) {
              (window as any).themeUi.selectLocalTheme(preset.id);
              const ring = color("var(--focus-ring)"),
                accent = color("var(--accent-color)");
              for (const el of document.querySelectorAll<HTMLElement>(
                "[data-audit]",
              )) {
                el.focus();
                const s = getComputedStyle(el);
                checks++;
                if (
                  document.activeElement !== el ||
                  s.outlineStyle !== "solid" ||
                  s.outlineWidth !== "2px" ||
                  s.outlineColor !== ring
                )
                  failures.push(
                    `${preset.id}/${el.dataset.audit}: focus ${s.outlineColor} != ${ring}`,
                  );
                if (s.caretColor !== accent || s.accentColor !== accent)
                  failures.push(
                    `${preset.id}/${el.dataset.audit}: caret/accent`,
                  );
                // Engines do not expose input-internal selection pseudos consistently;
                // inspect the author's selection rule on the editable DOM surface.
              }
              const editable = document.querySelector(
                '[data-audit="editable"]',
              )!;
              const selection = getComputedStyle(editable, "::selection");
              if (selection.backgroundColor !== accent)
                failures.push(`${preset.id}: selection`);
            }
            probe.remove();
            return { failures, checks };
          });
          expect(result.failures).toEqual([]);
          expect(result.checks).toBe(56 * 55);
          await page.locator("#keyboard-target").focus();
          await page.keyboard.press("Tab");
          await page.keyboard.press("Shift+Tab");
          expect(
            await page
              .locator("#keyboard-target")
              .evaluate((e) => getComputedStyle(e).outlineStyle),
          ).toBe("solid");
          expect(await page.locator("#disabled-control").isDisabled()).toBe(
            true,
          );
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      30000,
    );
    for (const view of ["model", "session", "settings"])
      browserTest(
        `${engine} ${skin}: actual ${view} input focus follows selected theme`,
        async () => {
          const { page, errors } = await open(
            engine,
            skin,
            view,
            390,
            "section=contract",
          );
          try {
            let selector: string;
            if (view === "settings") selector = "#contract-text";
            else if (view === "model")
              selector =
                ".compose-model-catalogue-search";
            else {
              await page.locator('[data-testid="session-switcher"]').click();
              selector = ".compose-session-search";
            }
            await page.locator(selector).waitFor();
            for (const id of [
              "synthwave-84-full",
              "as400",
              "paper",
              "monokai-pro",
            ]) {
              await page.evaluate(
                (id) => (window as any).themeUi.selectLocalTheme(id),
                id,
              );
              const result = await themedFocus(page, selector);
              expect(result.focused).toBe(true);
              expect(result.color).toBe(result.expected);
              expect(result.style).toBe("solid");
              expect(result.width).toBe("2px");
              if (id === "synthwave-84-full") {
                expect(result.shadow).not.toBe("none");
                expect(result.text).not.toBe("none");
              } else expect(result.text).toBe("none");
            }
            if (view === "settings") {
              for (const control of await page
                .locator(
                  ".settings-addon-pane input:not(:disabled), .settings-addon-pane textarea, .settings-addon-pane select",
                )
                .all()) {
                await control.focus();
                expect(
                  await control.evaluate(
                    (e) => getComputedStyle(e).outlineStyle,
                  ),
                ).toBe("solid");
              }
            }
            await page.evaluate(() =>
              (window as any).themeUi.selectLocalTheme("synthwave-84-full"),
            );
            await page.locator(selector).focus();
            await page.screenshot({
              path: join(evidence, `${engine}-${skin}-${view}-390.png`),
            });
            expect(errors).toEqual([]);
          } finally {
            await page.close();
          }
        },
        20000,
      );
    for (const width of [390, 1280])
      browserTest(
        `${engine} ${skin}: Full neon reaches actual composer and UI at ${width}, and cleans up`,
        async () => {
          const { page, errors } = await open(engine, skin, "ui", width);
          try {
            const compose =
              ".compose-input-wrapper";
            const input = `${compose} textarea`;
            await page.locator(input).fill("Neon all the way. Ready to send.");
            await page.locator(input).focus();
            const snapshot = () =>
              page.evaluate(
                ({ compose, input }) => {
                  const body = getComputedStyle(document.body),
                    c = getComputedStyle(document.querySelector(compose)!),
                    i = getComputedStyle(document.querySelector(input)!),
                    prose = getComputedStyle(
                      document.querySelector("#neon-prose")!,
                    );
                  return {
                    text: prose.textShadow,
                    inputText: i.textShadow,
                    animation: body.animationName,
                    composeAnimation: c.animationName,
                    shadow: c.boxShadow,
                    background: c.backgroundImage,
                    paused: [body.animationPlayState, c.animationPlayState],
                    overflow: document.documentElement.scrollWidth - innerWidth,
                  };
                },
                { compose, input },
              );
            const full = await snapshot();
            expect(full.text).not.toBe("none");
            expect(full.inputText).not.toBe("none");
            expect(full.animation).toBe("synthwave-full-ui");
            expect(full.composeAnimation).toBe("synthwave-full-compose");
            expect(full.shadow).not.toBe("none");
            expect(full.background).toContain("gradient");
            expect(full.overflow).toBeLessThanOrEqual(1);
            const before = await page
              .locator("body")
              .evaluate((e) => e.getAnimations()[0]?.currentTime);
            await page.waitForTimeout(180);
            expect(
              await page
                .locator("body")
                .evaluate((e) => e.getAnimations()[0]?.currentTime),
            ).not.toBe(before);
            await page.screenshot({
              path: join(evidence, `${engine}-${skin}-full-${width}.png`),
            });
            await page.evaluate(() => {
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: true,
              });
              document.dispatchEvent(new Event("visibilitychange"));
            });
            expect((await snapshot()).paused).toEqual(["paused", "paused"]);
            await page.evaluate(() => {
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: false,
              });
              document.dispatchEvent(new Event("visibilitychange"));
            });
            expect((await snapshot()).paused).toEqual(["running", "running"]);
            await page.emulateMedia({ reducedMotion: "reduce" });
            const reduced = await snapshot();
            expect(reduced.animation).toBe("none");
            expect(reduced.composeAnimation).toBe("none");
            expect(reduced.text).not.toBe("none");
            if (engine === "chromium") {
              await page.emulateMedia({ forcedColors: "active" });
              const forced = await snapshot();
              expect(forced.text).toBe("none");
              expect(forced.inputText).toBe("none");
              expect(forced.shadow).toBe("none");
              expect(forced.background).toBe("none");
              expect((await themedFocus(page, input)).style).toBe("none");
              expect(
                await page
                  .locator(compose)
                  .evaluate((e) => getComputedStyle(e).outlineStyle),
              ).toBe("solid");
              await page.emulateMedia({ forcedColors: "none" });
            }
            await page.emulateMedia({ reducedMotion: "no-preference" });
            for (const id of ["synthwave-84", "as400", "paper", "default"]) {
              await page.evaluate(
                (id) => (window as any).themeUi.selectLocalTheme(id),
                id,
              );
              const other = await snapshot();
              expect(other.text).toBe("none");
              expect(other.inputText).toBe("none");
              expect(other.animation).toBe("none");
              expect(other.composeAnimation).toBe("none");
              expect(other.background).toBe("none");
            }
            expect(errors).toEqual([]);
          } finally {
            await page.close();
          }
        },
        20000,
      );
  }

for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic"])
    for (const width of [390, 1280]) {
      browserTest(
        `${engine} ${skin}: compose frame alone owns focus across palettes at ${width}`,
        async () => {
          const { page, errors } = await open(engine, skin, "ui", width);
          try {
            const frame =
              ".compose-input-wrapper";
            const input = frame + " textarea";
            await page
              .locator(input)
              .fill("Focus belongs to the complete composer.");
            // Freeze transitions, not focus state or colours, for the exhaustive
            // synchronous palette loop. Actual pointer/keyboard transitions follow.
            await page.addStyleTag({
              content: frame + "{transition:none !important}",
            });
            const result = await page.evaluate(
              ({ frame, input }) => {
                const f = (window as any).themeUi,
                  box = document.querySelector(frame) as HTMLElement,
                  field = document.querySelector(input) as HTMLTextAreaElement;
                const probe = document.createElement("span");
                document.body.append(probe);
                const color = (v: string) => {
                  probe.style.color = v;
                  return getComputedStyle(probe).color;
                };
                const failures: string[] = [];
                let checks = 0;
                for (const preset of f.presets) {
                  f.selectLocalTheme(preset.id);
                  field.blur();
                  const before = box.getBoundingClientRect();
                  if (getComputedStyle(box).outlineStyle !== "none")
                    failures.push(preset.id + " blur frame");
                  field.focus();
                  const outer = getComputedStyle(box),
                    inner = getComputedStyle(field);
                  checks++;
                  const expected = color(
                    preset.id === "synthwave-84-full"
                      ? "#36f9f6"
                      : "var(--focus-ring)",
                  );
                  if (
                    document.activeElement !== field ||
                    outer.outlineStyle !== "solid" ||
                    outer.outlineWidth !== "2px" ||
                    outer.outlineColor !== expected
                  )
                    failures.push(
                      preset.id + " outer focus " + outer.outlineColor,
                    );
                  if (
                    inner.outlineStyle !== "none" ||
                    inner.boxShadow !== "none" ||
                    inner.borderTopWidth !== "0px"
                  )
                    failures.push(preset.id + " inner decoration");
                  if (inner.caretColor !== color("var(--accent-color)"))
                    failures.push(preset.id + " caret");
                  const after = box.getBoundingClientRect();
                  if (
                    before.width !== after.width ||
                    before.height !== after.height
                  )
                    failures.push(preset.id + " geometry");
                  field.blur();
                  if (getComputedStyle(box).outlineStyle !== "none")
                    failures.push(preset.id + " retained focus");
                }
                probe.remove();
                return { failures, checks };
              },
              { frame, input },
            );
            expect(result.failures).toEqual([]);
            expect(result.checks).toBe(56);
            await page.evaluate(() =>
              (window as any).themeUi.selectLocalTheme("synthwave-84-full"),
            );
            await page.locator(input).click();
            expect(
              await page
                .locator(frame)
                .evaluate((e) => getComputedStyle(e).outlineColor),
            ).toBe("rgb(54, 249, 246)");
            expect(
              await page
                .locator(input)
                .evaluate((e) => getComputedStyle(e).boxShadow),
            ).toBe("none");
            // In both real composers the attachment action precedes the textarea.
            await page.keyboard.press("Shift+Tab");
            await page.keyboard.press("Tab");
            expect(
              await page
                .locator(input)
                .evaluate((e) => document.activeElement === e),
            ).toBe(true);
            expect(
              await page
                .locator(frame)
                .evaluate((e) => getComputedStyle(e).outlineStyle),
            ).toBe("solid");
            await page.screenshot({
              path: join(
                evidence,
                `${engine}-${skin}-frame-focus-${width}.png`,
              ),
            });
            await page.emulateMedia({ reducedMotion: "reduce" });
            expect(
              await page
                .locator(input)
                .evaluate((e) => getComputedStyle(e).outlineStyle),
            ).toBe("none");
            expect(
              await page
                .locator(frame)
                .evaluate((e) => getComputedStyle(e).outlineStyle),
            ).toBe("solid");
            if (engine === "chromium") {
              await page.emulateMedia({ forcedColors: "active" });
              expect(
                await page
                  .locator(input)
                  .evaluate((e) => getComputedStyle(e).outlineStyle),
              ).toBe("none");
              expect(
                await page
                  .locator(frame)
                  .evaluate((e) => getComputedStyle(e).outlineStyle),
              ).toBe("solid");
              const system = await page.locator(frame).evaluate((e) => {
                const p = document.createElement("i");
                p.style.outline = "2px solid Highlight";
                document.body.append(p);
                const c = getComputedStyle(p).outlineColor;
                p.remove();
                return {
                  actual: getComputedStyle(e).outlineColor,
                  expected: c,
                };
              });
              expect(system.actual).toBe(system.expected);
            }
            await page
              .locator(input)
              .evaluate((e: HTMLTextAreaElement) => e.blur());
            expect(
              await page
                .locator(frame)
                .evaluate((e) => getComputedStyle(e).outlineStyle),
            ).toBe("none");
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
      `${engine} ${skin}: field and compose focus have one sharp contour in all themes`,
      async () => {
        const { page, errors } = await open(engine, skin, "ui", 1280);
        try {
          const frame =
            ".compose-input-wrapper";
          const result = await page.evaluate(
            ({ frame }) => {
              const f = (window as any).themeUi,
                box = document.querySelector(frame)!,
                field = box.querySelector("textarea")!;
              const control = document.createElement("input");
              control.className = "settings-filter-input settings-panel__input";
              document.body.append(control);
              const failures: string[] = [];
              for (const theme of f.presets) {
                f.selectLocalTheme(theme.id);
                field.focus();
                const s = getComputedStyle(box);
                if (s.outlineOffset !== "-2px")
                  failures.push(theme.id + " frame gap");
                if (theme.id !== "synthwave-84-full" && s.boxShadow !== "none")
                  failures.push(theme.id + " frame shadow");
                control.focus();
                const c = getComputedStyle(control);
                if (c.outlineOffset !== "-2px")
                  failures.push(theme.id + " field gap");
                if (theme.id !== "synthwave-84-full" && c.boxShadow !== "none")
                  failures.push(theme.id + " field shadow");
              }
              control.remove();
              return failures;
            },
            { frame },
          );
          expect(result).toEqual([]);
          await page.evaluate(() =>
            (window as any).themeUi.selectLocalTheme("synthwave-84-full"),
          );
          await page.locator(frame + " textarea").focus();
          const shadows = await page.locator(frame).evaluate((e) => {
            const animation = e
              .getAnimations()
              .find(
                (a) =>
                  (a as CSSAnimation).animationName ===
                  "synthwave-full-compose",
              );
            animation?.pause();
            return [0, 2400, 4800].map((time) => {
              if (animation) animation.currentTime = time;
              return getComputedStyle(e).boxShadow;
            });
          });
          for (const shadow of shadows) {
            expect(shadow).not.toBe("none");
            expect(shadow).not.toMatch(/0px 0px 0px [1-9]/);
          }
          await page.evaluate(() =>
            (window as any).themeUi.selectLocalTheme("paper"),
          );
          expect(
            await page
              .locator(frame)
              .evaluate((e) => getComputedStyle(e).boxShadow),
          ).toBe("none");
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      20000,
    );
    for (const width of [390, 1280])
      browserTest(
        `${engine} ${skin}: session pill text is centred with explicit typography at ${width}`,
        async () => {
          const { page, errors } = await open(engine, skin, "session", width);
          try {
            const label =
              ".compose-current-agent-label";
            await page.locator(label).waitFor();
            await page.evaluate(() => document.fonts.ready);
            const m = await page.locator(label).evaluate((e: HTMLElement) => {
              const s = getComputedStyle(e),
                r = e.getBoundingClientRect(),
                p = e.parentElement!.getBoundingClientRect(),
                range = document.createRange();
              range.selectNodeContents(e);
              const t = range.getBoundingClientRect();
              return {
                line: s.lineHeight,
                size: s.fontSize,
                font: s.fontFamily,
                offset: Math.abs(t.y + t.height / 2 - (r.y + r.height / 2)),
                parentOffset: Math.abs(
                  r.y + r.height / 2 - (p.y + p.height / 2),
                ),
                height: r.height,
              };
            });
            expect(m.line).toBe("16px");

            expect(m.offset).toBeLessThanOrEqual(1);
            expect(m.parentOffset).toBeLessThanOrEqual(1);
            expect(m.font).not.toContain("-webkit-standard");
            await page
              .locator(label)
              .screenshot({
                path: join(
                  evidence,
                  `${engine}-${skin}-pill-after-${width}.png`,
                ),
              });
            expect(errors).toEqual([]);
          } finally {
            await page.close();
          }
        },
        20000,
      );
    for (const view of ["lightbox"])
      browserTest(
        `${engine} ${skin}: ${view} uses a translucent theme surface without fading media`,
        async () => {
          const { page, errors } = await open(engine, skin, view, 390);
          try {
            await page.locator("#open-preview").click();
            const backdrop =
              view === "lightbox"
                ? ".attachment-preview-modal"
                : ".lightbox__backdrop";
            await page.locator(backdrop).waitFor();
            const failures = await page.evaluate((selector) => {
              const f = (window as any).themeUi,
                b = document.querySelector(selector)!;
              const probe = document.createElement("i");
              document.body.append(probe);
              const failures: string[] = [];
              for (const theme of f.presets) {
                f.selectLocalTheme(theme.id);
                probe.style.color = "var(--media-backdrop)";
                const actual = getComputedStyle(b).backgroundColor,
                  expected = getComputedStyle(probe).color;
                if (actual !== expected || !actual.endsWith(", 0.62)"))
                  failures.push(theme.id + ":" + actual);
              }
              probe.remove();
              return failures;
            }, backdrop);
            expect(failures).toEqual([]);
            await page.evaluate(() =>
              (window as any).themeUi.selectLocalTheme("synthwave-84-full"),
            );
            await page.waitForTimeout(250);
            expect(
              await page
                .locator(backdrop)
                .evaluate((e) => getComputedStyle(e).opacity),
            ).toBe("1");
            expect(
              await page
                .locator(backdrop + " img")
                .evaluate((e) => getComputedStyle(e).opacity),
            ).toBe("1");
            await page.screenshot({
              path: join(evidence, `${engine}-${skin}-${view}-translucent.png`),
            });
            if (view === "image-lightbox") {
              await page.keyboard.press("Escape");
            } else
              await page
                .locator('.attachment-preview-close')
                .click();
            expect(await page.locator(backdrop).count()).toBe(0);
            await page.locator("#open-preview").click();
            await page.locator(backdrop).waitFor();
            if (view === "image-lightbox")
              await page.locator(backdrop).dispatchEvent("mousedown");
            else await page.locator(backdrop).dispatchEvent("click");
            expect(await page.locator(backdrop).count()).toBe(0);
            expect(errors).toEqual([]);
          } finally {
            await page.close();
          }
        },
        20000,
      );
    browserTest(
      `${engine} ${skin}: timestamps and context retain only native title tooltips`,
      async () => {
        const { page, errors } = await open(
          engine,
          skin,
          "native-tooltips",
          390,
        );
        try {
          await page.locator(".post-time").waitFor();
          const title = await page.locator(".post-time").getAttribute("title");
          expect(title).toContain("Input: 12,000 · Output: 3,456");
          expect(title).toContain(
            "Reasoning: 1,200 · Cache read: 7,800 · Cache write: 900",
          );
          expect(title).toContain("Provider-reported cost: $0.01");
          expect(title!.split("\n")).toHaveLength(5);
          expect(title).not.toMatch(/…|\.\.\./);
          const pie = page.locator(".compose-context-pie");
          await pie.waitFor();
          expect(await pie.getAttribute("title")).toContain(
            "32K / 128K tokens (25%)",
          );
          expect(await pie.getAttribute("data-tooltip")).toBeNull();
          await pie.hover();
          expect(
            await pie.evaluate((e) => getComputedStyle(e, "::after").content),
          ).toMatch(/^(none|normal)$/);

          expect(
            await page.locator('[role="tooltip"],.timestamp-tooltip').count(),
          ).toBe(0);
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      20000,
    );
  }
