import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
const runtimeRoot = join(import.meta.dir, "../..");
let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let buildDir = "";

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  buildDir = await mkdtemp(join(tmpdir(), "piclaw-addon-buttons-"));
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "fixtures/addon-settings-buttons-fixture.ts")],
    outdir: buildDir, target: "browser",
  });
  if (!result.success) throw new Error(String(result.logs));
  const script = await result.outputs[0].text();
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        const skin = "classic";
        const dark = url.searchParams.get("theme") === "dark";
        return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/${skin}/css/styles.css"><style>:root{--bg-primary:${dark ? "#111820" : "#fff"};--bg-secondary:${dark ? "#1c2630" : "#f7f9fa"};--bg-hover:${dark ? "#293542" : "#e8ebed"};--text-primary:${dark ? "#edf3f7" : "#0f1419"};--border-color:${dark ? "#52606d" : "#aab6c0"};--accent-color:#2783b8;--accent-hover:#1d6894;--accent-contrast-text:#fff;--danger-color:#dc3545;--font-family:system-ui,sans-serif}#app{height:100vh}</style></head><body><div id="app"></div><button id="outside" style="padding:1px;border-radius:2px">Outside settings</button><script type="module" src="/fixture.js"></script></body></html>`, { headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/fixture.js") return new Response(script, { headers: { "content-type": "text/javascript" } });
      if (!url.pathname.startsWith("/static/") || url.pathname.includes("..")) return new Response(null, { status: 404 });
      const file = Bun.file(join(runtimeRoot, "web", url.pathname));
      return await file.exists() ? new Response(file) : new Response(null, { status: 404 });
    },
  });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
  if (buildDir) await rm(buildDir, { recursive: true, force: true });
});

async function open(skin: string, theme: string, width = 1280): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width, height: 900 }, colorScheme: theme as "dark" | "light", reducedMotion: "reduce" });
  await page.route("**/*", (route) => new URL(route.request().url()).origin === server!.url.origin ? route.continue() : route.abort());
  await page.goto(`${server!.url}?skin=${skin}&theme=${theme}`);
  await page.locator(".settings-addon-pane #plain").waitFor();
  return page;
}

async function style(page: Page, id: string) {
  return page.locator(id.startsWith(".") ? id : `#${id}`).evaluate((el) => {
    const s = getComputedStyle(el);
    return { padding: s.padding, radius: s.borderRadius, border: s.border, background: s.backgroundColor,
      color: s.color, font: s.font, height: s.height, cursor: s.cursor, opacity: s.opacity, outline: s.outlineStyle,
      minWidth: s.minWidth, minHeight: s.minHeight, whiteSpace: s.whiteSpace, transition: s.transition };
  });
}

async function forceHover(page: Page, selector: string) {
  // General's token row can extend beyond the phone viewport. Force only its
  // hover pseudo-state so we measure its real CSS without changing its layout.
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    await session.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] });
    return session;
  } catch (error) {
    await session.detach();
    throw error;
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 390]) {
    browserTest(`Classic ${theme} buttons match the real widget-token Regenerate at ${width}px`, async () => {
      const page = await open("classic", theme, width);
      try {
        await page.evaluate(() => window.dispatchEvent(new CustomEvent("piclaw:open-settings", { detail: { section: "general" } })));
        const regenerate = page.locator(".settings-widget-token-regenerate");
        await regenerate.waitFor();
        await page.mouse.move(0, 0);
        const reference = await style(page, ".settings-widget-token-regenerate");
        const referenceState = await forceHover(page, ".settings-widget-token-regenerate");
        const referenceHover = await style(page, ".settings-widget-token-regenerate");
        await referenceState.detach();
        // No token regeneration: compare the disabled appearance without executing it.
        await regenerate.evaluate((el: HTMLButtonElement) => { el.disabled = true; });
        await page.mouse.move(0, 0);
        const referenceDisabled = await style(page, ".settings-widget-token-regenerate");
        await page.evaluate(() => window.dispatchEvent(new CustomEvent("piclaw:open-settings", { detail: { section: "buttons" } })));
        await page.locator("#plain").evaluate(el => { el.textContent = "Regenerate"; });
        await page.mouse.move(0, 0);
        expect(await style(page, "plain")).toEqual(reference);
        const addonState = await forceHover(page, "#plain");
        expect(await style(page, "plain")).toEqual(referenceHover);
        await addonState.detach();
        await page.locator("#plain").evaluate((el: HTMLButtonElement) => { el.disabled = true; });
        await page.mouse.move(0, 0);
        expect(await style(page, "plain")).toEqual(referenceDisabled);
      } finally { await page.close(); }
    });
  }
}

for (const skin of ["classic"]) {
  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 390]) {
      browserTest(`${skin} ${theme} add-on buttons share appearance at ${width}px`, async () => {
        const page = await open(skin, theme, width);
        try {
          const plain = await style(page, "plain");
          for (const id of ["row", "inline", "telegram"]) expect(await style(page, id)).toEqual(plain);
          expect(plain.radius).toBe("6px");
          expect(parseFloat(plain.height)).toBeGreaterThanOrEqual(26);
          expect(await page.locator("#telegram span").evaluate(el => getComputedStyle(el).fontSize)).toBe(width <= 640 ? "10.584px" : "12.6px");
          expect((await style(page, "outside")).padding).toBe("1px");
          expect((await style(page, "custom")).padding).toBe("1px");
          expect((await style(page, "tab")).padding).toBe("2px");
          expect((await style(page, "switch")).padding).toBe("3px");
          expect(await page.locator("#hidden").isVisible()).toBe(false);
          expect(await page.locator("#stepper").evaluate(el => getComputedStyle(el).width)).toBe("32px");
          expect(await page.locator(".settings-addon-pane").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        } finally { await page.close(); }
      });
    }
    browserTest(`${skin} ${theme} buttons have hover, focus, disabled and semantic states`, async () => {
      const page = await open(skin, theme);
      try {
        const initial = await style(page, "plain");
        await page.locator("#plain").hover();
        expect((await style(page, "plain")).background).not.toBe(initial.background);
        await page.locator("#plain").focus();
        await page.keyboard.press("Tab");
        expect((await style(page, "row")).outline).toBe("solid");
        for (const id of ["disabled", "aria-disabled"]) {
          const before = await style(page, id);
          expect(before.opacity).toBe("0.5");
          expect(before.cursor).toBe("pointer");
          await page.locator(`#${id}`).hover({ force: true });
          expect((await style(page, id)).background).toBe(before.background);
        }
        expect((await style(page, "danger")).color).toBe("rgb(220, 53, 69)");
        await page.locator("#danger").hover();
        expect((await style(page, "danger")).border).toContain("rgb(220, 53, 69)");
        expect((await style(page, "primary")).background).toBe("rgb(39, 131, 184)");
        await page.locator("#primary").hover();
        expect((await style(page, "primary")).background).toBe("rgb(29, 104, 148)");
        expect((await style(page, "icon")).padding).toBe("6px");
        // Pending requests can add controls after the initial Settings render.
        await page.locator(".settings-addon-pane section").evaluate(el => {
          const button = document.createElement("button");
          button.id = "incoming";
          button.textContent = "Accept request";
          el.append(button);
        });
        expect((await style(page, "incoming")).padding).toBe(initial.padding);
        const nav = ".settings-nav";
        await page.locator(nav).getByRole("button", { name: "General", exact: true }).click();
        expect(await page.locator(".settings-addon-pane").count()).toBe(0);
        await page.locator(nav).getByRole("button", { name: "Buttons", exact: true }).click();
        await page.locator(".settings-addon-pane #plain").waitFor();
      } finally { await page.close(); }
    });
  }
}
