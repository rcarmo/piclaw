import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { createTempWorkspace } from "../helpers.js";

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const runtimeRoot = join(import.meta.dir, "../..");
const evidence = join(runtimeRoot, "../.artifacts/picker-buttons");
const browsers: Record<string, Browser> = {};
let server: ReturnType<typeof Bun.serve> | null = null;
let base = "";
let workspace: ReturnType<typeof createTempWorkspace>;

beforeAll(async () => {
  if (!enabled) return;
  workspace = createTempWorkspace("picker-buttons-");
  for (const skin of ["classic"]) {
    const proc = Bun.spawn(
      [
        "bun",
        "build",
        `test/web/fixtures/${skin}-picker-buttons-fixture.${"ts"}`,
        "--target=browser",
        "--format=esm",
        "--jsx=automatic",
        "--jsx-import-source=preact",
        "--outfile",
        join(workspace.base, skin + ".js"),
      ],
      { cwd: runtimeRoot, stdout: "pipe", stderr: "pipe" },
    );
    const stderr = await new Response(proc.stderr).text();
    if ((await proc.exited) !== 0) throw new Error(stderr);
  }
  await mkdir(evidence, { recursive: true });
  browsers.chromium = await chromium.launch({ headless: true });
  browsers.webkit = await webkit.launch({ headless: true });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/agent/active-chats")
        return Response.json({
          chats: [
            { chat_jid: "web:default", agent_name: "current", is_active: true },
            { chat_jid: "web:other", agent_name: "other" },
          ],
        });
      if (url.pathname === "/agent/branches")
        return Response.json({ branches: [] });
      if (url.pathname === "/classic") {
        const skin = url.pathname.slice(1);
        const session =
          skin === "classic" && url.searchParams.get("picker") === "session";
        return new Response(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/${skin}/dist/app.bundle.css"><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><style>html,body,#picker-root{margin:0;height:100%;width:100%;overflow:hidden}</style></head><body><div id="${session ? "session-picker-fixture-root" : "picker-root"}"></div><script type="module" src="${session ? "/static/classic/dist/session-picker-fixture.bundle.js" : "/" + skin + ".js"}"></script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      if (url.pathname === "/classic.js")
        return new Response(
          Bun.file(join(workspace.base, url.pathname.slice(1))),
          { headers: { "content-type": "text/javascript" } },
        );
      if (url.pathname.includes(".."))
        return new Response("not found", { status: 404 });
      if (
        url.pathname.startsWith("/static/") ||
        url.pathname === "/editor-vendor/codemirror.js"
      ) {
        const file =
          url.pathname === "/editor-vendor/codemirror.js"
            ? join(
                runtimeRoot,
                "extensions/viewers/editor/vendor/codemirror.js",
              )
            : join(runtimeRoot, "web/static", url.pathname.slice(8));
        try {
          return new Response(await readFile(file), {
            headers: {
              "content-type": url.pathname.endsWith(".css")
                ? "text/css"
                : "text/javascript",
            },
          });
        } catch {
          return new Response("not found", { status: 404 });
        }
      }
      return new Response("not found", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
}, 30000);

afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  server?.stop(true);
  workspace?.cleanup();
});

async function open(page: Page, skin: string, picker: string, theme: string) {
  await page.goto(`${base}/${skin}?picker=${picker}`, {
    waitUntil: "networkidle",
  });
  await page.evaluate((light) => {
    document.documentElement.classList.toggle("light", light);
    document.body.classList.toggle("light", light);
  }, theme === "light");
  if (picker === "session")
    await page
      .locator(
        '[data-testid="session-switcher"]',
      )
      .click();
  const popup =
    picker === "session"
        ? ".compose-session-popup"
        : ".compose-model-catalogue";
  await page.locator(popup).waitFor({ state: "visible" });
  return popup;
}

for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic"])
    for (const width of [1280, 390])
      for (const theme of ["dark", "light"]) {
        browserTest(
          `${engine} ${skin} picker buttons at ${width}px ${theme}`,
          async () => {
            const page = await browsers[engine].newPage({
              viewport: { width, height: 844 },
              hasTouch: width === 390,
            });
            page.setDefaultTimeout(8000);
            const errors: string[] = [];
            page.on("pageerror", (e) => errors.push(e.message));
            try {
              for (const picker of ["model", "session"]) {
                const popup = await open(page, skin, picker, theme);
                const action =
                  `${popup} .compose-model-popup-btn`;
                const measured = await page
                  .locator(action)
                  .evaluateAll((nodes) =>
                    nodes.map((node) => {
                      const s = getComputedStyle(node),
                        r = node.getBoundingClientRect();
                      return {
                        font: s.fontFamily,
                        bodyFont: getComputedStyle(document.body).fontFamily,
                        size: s.fontSize,
                        lineHeight: s.lineHeight,
                        appearance: s.appearance,
                        webkitAppearance:
                          s.getPropertyValue("-webkit-appearance"),
                        boxSizing: s.boxSizing,
                        margin: s.margin,
                        border: s.borderTopWidth,
                        radius: s.borderTopLeftRadius,
                        height: r.height,
                        left: r.left,
                        right: r.right,
                        background: s.backgroundColor,
                        color: s.color,
                        disabled: (node as HTMLButtonElement).disabled,
                      };
                    }),
                  );
                expect(measured.length).toBeGreaterThan(1);
                for (const button of measured) {
                  expect(button.font).toBe(button.bodyFont);
                  expect(button.appearance).toBe("none");
                  expect(button.boxSizing).toBe("border-box");
                  expect(button.lineHeight).toBe("15px");
                  expect(button.size).toBe("12px");
                  expect(button.margin).toBe("0px");
                  expect(button.border).toBe("1px");
                  expect(button.height).toBe(width < 640 ? 44 : 28);
                  expect(button.left).toBeGreaterThanOrEqual(0);
                  expect(button.right).toBeLessThanOrEqual(width);
                }
                const first = page.locator(action + ":not(:disabled)").first();
                await page.keyboard.press("ArrowRight");
                await first.focus();
                const focus = await first.evaluate((e) => ({
                  style: getComputedStyle(e).outlineStyle,
                  width: getComputedStyle(e).outlineWidth,
                }));
                expect(focus).toEqual({ style: "solid", width: "2px" });
                // Pin/icon buttons inherit an explicit font/appearance without replacing list-row styling.
                const native = await page
                  .locator(`${popup} button`)
                  .evaluateAll((nodes) =>
                    nodes
                      .filter((n) => getComputedStyle(n).appearance !== "none")
                      .map((n) => n.className),
                  );
                expect(native).toEqual([]);
                if (picker === "model") {
                  await page
                    .getByRole("button", { name: /Show incompatible/ })
                    .click();
                  expect(
                    await page
                      .getByRole("button", { name: /Hide incompatible/ })
                      .count(),
                  ).toBe(1);
                  await page
                    .getByRole("button", {
                      name: "Open Models settings",
                      exact: true,
                    })
                    .click();
                  expect(
                    await page.locator("#picker-action").textContent(),
                  ).toBe("settings");
                }
                // Exercise the native disabled state on the rendered control without invoking a destructive action.
                await first.evaluate((e) => {
                  (e as HTMLButtonElement).disabled = true;
                });
                expect(
                  await page
                    .locator(action)
                    .first()
                    .evaluate((e) => ({
                      opacity: getComputedStyle(e).opacity,
                      cursor: getComputedStyle(e).cursor,
                    })),
                ).toEqual({ opacity: "0.5", cursor: "not-allowed" });
                await page
                  .locator(action)
                  .first()
                  .evaluate((e) => {
                    (e as HTMLButtonElement).disabled = false;
                  });
                if (skin === "classic" && picker === "session") {
                  await page
                    .getByRole("button", { name: "New branch", exact: true })
                    .click();
                  expect(
                    await page.locator("#session-picker-action").textContent(),
                  ).toContain("new:");
                  await page.getByTestId("session-switcher").click();
                }
                await page.screenshot({
                  path: join(
                    evidence,
                    `${engine}-${skin}-${picker}-${width}-${theme}.png`,
                  ),
                });
              }
              expect(errors).toEqual([]);
            } finally {
              await page.close();
            }
          },
          30000,
        );
      }
