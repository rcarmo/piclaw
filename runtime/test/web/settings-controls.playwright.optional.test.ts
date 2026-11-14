import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createTempWorkspace } from "../helpers.js";

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
const runtimeRoot = join(import.meta.dir, "../..");
const evidence = join(runtimeRoot, "../.artifacts/settings-controls");
let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let workspace: ReturnType<typeof createTempWorkspace>;
const metrics: Record<string, unknown> = {};
// Optional companion checkout for the real first-party pane acceptance matrix.
const addonsRoot = process.env.PICLAW_SETTINGS_ADDONS_ROOT;

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  workspace = createTempWorkspace("settings-controls-");
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, "fixtures/settings-controls-fixture.ts")], outdir: workspace.base, target: "browser" });
  if (!build.success) throw new Error(String(build.logs));
  const script = await build.outputs[0].text();
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      const skin = "classic";
      const light = url.searchParams.get("theme") === "light";
      return new Response(`<!doctype html><html class="${light ? "light" : ""}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/${skin}/css/styles.css"><style>html,body,#app{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body class="${light ? "light" : ""}"><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>`, { headers: { "content-type": "text/html" } });
    }
    if (url.pathname === "/fixture.js") return new Response(script, { headers: { "content-type": "text/javascript" } });
    // Match the real asset route: exact filename, per-file transpilation, NOT a
    // bundler that silently resolves missing .js imports to .ts sources.
    const addonAsset = url.pathname.match(/^\/addon\/(sample-addon|delegate)\/([\w-]+\.(?:ts|js))$/);
    if (addonsRoot && addonAsset) {
      const file = Bun.file(join(addonsRoot, "addons", addonAsset[1], "web", addonAsset[2]));
      if (!await file.exists()) return new Response(null, { status: 404 });
      const source = await file.text();
      const code = new Bun.Transpiler({ loader: addonAsset[2].endsWith(".ts") ? "ts" : "js" }).transformSync(source);
      return new Response(code, { headers: { "content-type": "text/javascript" } });
    }
    if (!url.pathname.startsWith("/static/") || url.pathname.includes("..")) return new Response(null, { status: 404 });
    const file = Bun.file(join(runtimeRoot, "web", url.pathname));
    return await file.exists() ? new Response(file) : new Response(null, { status: 404 });
  } });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
  workspace?.cleanup();
  if (Object.keys(metrics).length) await writeFile(join(evidence, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
});

async function open(skin: string, section: string, width: number, theme: string): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width, height: width === 390 ? 844 : 820 }, colorScheme: theme as "dark" | "light", reducedMotion: "reduce" });
  page.setDefaultTimeout(2500);
  // LAN HTTP exposes crypto but not secure-context randomUUID; IDs must not need it.
  await page.addInitScript(() => Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined }));
  await page.route("**/*", route => new URL(route.request().url()).origin === server!.url.origin ? route.continue() : route.abort());
  await page.goto(`${server!.url}?skin=${skin}&section=${section}&theme=${theme}`);
  await page.locator(".settings-content").waitFor();
  await page.locator(section === "general" ? 'input[placeholder="Your name"]' : section === "keychain" ? (".settings-keychain-add-btn") : section === "keyboard" ? (".settings-shortcut-input") : "#contract-text").first().waitFor();
  return page;
}

for (const skin of ["classic"]) for (const width of [1366, 820, 520, 390]) for (const addon of ["sample-addon", "delegate"]) {
  (addonsRoot ? browserTest : test.skip)(`${skin} actual ${addon} pane uses the host contract at ${width}px`, async () => {
    const page = await browser!.newPage({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    try {
      await page.route("**/*", route => new URL(route.request().url()).origin === server!.url.origin ? route.continue() : route.abort());
      await page.goto(`${server!.url}?skin=${skin}&section=${addon}&theme=dark`);
      await page.locator(".settings-addon-pane .settings-addon-control").first().waitFor();
      const result = await measure(page, skin);
      metrics[`${skin}-${addon}-${width}`] = result;
      expect(result.length).toBeGreaterThan(2);
      expect(result.filter(row => row.outside)).toEqual([]);
      for (const input of await page.locator('.settings-addon-pane input:not([type="checkbox"]):not([type="radio"]),.settings-addon-pane textarea').all()) {
        expect(await input.evaluate((node: HTMLInputElement) => Boolean(node.getAttribute("aria-label") || node.labels?.length))).toBe(true);
      }
      if (addon === "delegate") {
        expect(await page.locator(".settings-addon-pane").evaluate(root => [...root.querySelectorAll("div")].some(node => ["180px", "190px"].includes(getComputedStyle(node).maxHeight)))).toBe(true);
      }
      await page.screenshot({ path: join(evidence, `${skin}-${addon}-${width}.png`), animations: "disabled" });
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("piclaw:open-settings", { detail: { section: "general" } })));
      await page.locator('input[placeholder="Your name"]').waitFor();
      expect(await page.locator(".settings-addon-pane").count()).toBe(0);
    } finally { await page.close(); }
  }, 15_000);
}

for (const skin of ["classic"]) {
  browserTest(`${skin} Keyboard retains labelled save, invalid, reset and filter behavior`, async () => {
    const page = await open(skin, "keyboard", 390, "dark");
    try {
      const card = page.locator(".settings-shortcut-card").first();
      const input = card.locator('input[type="text"]');
      const initial = await input.inputValue();
      expect(await input.evaluate((node: HTMLInputElement) => node.labels?.length)).toBe(1);
      await input.fill("ctrl+escape");
      await card.getByRole("button", { name: "Save", exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.locator('[role="alert"], [role="status"]').filter({ hasText: /Invalid shortcut/i }).waitFor();
      await input.fill("ctrl+shift+y");
      await card.getByRole("button", { name: "Save", exact: true }).click();
      await page.locator('[role="status"]').filter({ hasText: /saved/i }).waitFor();
      await card.getByRole("button", { name: /Default/, exact: false }).click();
      expect(await input.inputValue()).toBe(initial);
      const filter = page.locator(".settings-header-filter");
      await filter.fill("fixture-no-shortcut-matches");
      expect(await page.locator(".settings-shortcut-card").count()).toBe(0);
    } finally { await page.close(); }
  }, 15_000);
}

async function measure(page: Page, _skin) {
  return page.evaluate(rootSelector => {
    const root = document.querySelector(rootSelector) as HTMLElement;
    const bounds = root.getBoundingClientRect();
    return [...root.querySelectorAll("input,select,textarea,button")].filter(node => (node as HTMLElement).getBoundingClientRect().width > 0).map(node => {
      const element = node as HTMLInputElement;
      const r = element.getBoundingClientRect(), s = getComputedStyle(element);
      return { id: element.id, type: element.type, placeholder: element.getAttribute("placeholder"), text: element.tagName === "BUTTON" ? element.textContent : null,
        left: r.left, right: r.right, width: r.width, height: r.height, outside: r.left < bounds.left - 1 || r.right > bounds.right + 1,
        fontFamily: s.fontFamily, fontSize: s.fontSize, lineHeight: s.lineHeight, padding: s.padding, border: s.border, radius: s.borderRadius, background: s.backgroundColor,
        placeholderColor: getComputedStyle(element, "::placeholder").color, outline: s.outline, disabled: element.disabled, readOnly: element.readOnly,
        label: element.getAttribute("aria-label") || [...(element.labels || [])].map(label => label.textContent).join(" "), invalid: element.getAttribute("aria-invalid") };
    });
  }, ".settings-content");
}

for (const skin of ["classic"]) for (const width of [1366, 820, 520, 390]) for (const section of ["general", "keychain", "contract"]) {
  browserTest(`${skin} ${section} controls fit their content viewport at ${width}px`, async () => {
    const page = await open(skin, section, width, "dark");
    try {
      if (section === "keychain") {
        await page.locator(".settings-keychain-add-btn").click();
        await page.locator('input[type="password"]').waitFor();
      }
      const result = await measure(page, skin);
      metrics[`${skin}-${section}-${width}`] = result;
      await page.screenshot({ path: join(evidence, `${skin}-${section}-${width}.png`), animations: "disabled" });
      expect(result.length).toBeGreaterThan(2);
      expect(result.filter(row => row.outside).map(row => ({ id: row.id, placeholder: row.placeholder, left: row.left, right: row.right }))).toEqual([]);
    } finally { await page.close(); }
  }, 15_000);
}

for (const skin of ["classic"]) for (const width of [1366, 820, 520, 390]) for (const theme of ["dark", "light"]) {
  browserTest(`${skin} opt-in fields retain same-skin control shell and native states at ${width}px ${theme}`, async () => {
    const page = await open(skin, "general", width, theme);
    try {
      const shell = (node: Element) => {
        const s = getComputedStyle(node);
        return { fontSize: s.fontSize, fontFamily: s.fontFamily, lineHeight: s.lineHeight, padding: s.padding, border: s.border, radius: s.borderRadius, background: s.backgroundColor };
      };
      const reference = await page.locator('input[placeholder="Your name"]').evaluate(shell);
      {
        // Captured from unmodified 060b72e6b ordinary Classic General controls.
        expect(reference).toMatchObject({ fontSize: width <= 640 ? "11.088px" : "13.2px", lineHeight: "normal", padding: "6px 10px", radius: "6px" });
        expect(reference.border).toMatch(/^1px solid /);
      }
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("piclaw:open-settings", { detail: { section: "contract" } })));
      await page.locator("#contract-text").waitFor();
      for (const id of ["text", "search", "password", "url", "number"]) {
        const control = page.locator(`#contract-${id}`);
        expect(await control.evaluate(shell)).toEqual(reference);
        expect(await control.evaluate((node: HTMLInputElement) => node.labels?.length)).toBe(1);
      }
      for (const id of ["select", "textarea"]) {
        const style = await page.locator(`#contract-${id}`).evaluate(shell);
        // Native select line-height and textarea fonts remain role-specific.
        expect(style.padding).toBe(reference.padding);
        expect(style.border).toBe(reference.border);
        expect(style.radius).toBe(reference.radius);
      }
      expect(await page.locator("#contract-disabled").isDisabled()).toBe(true);
      expect(await page.locator("#contract-readonly").isEditable()).toBe(false);
      expect(await page.locator("#contract-invalid").getAttribute("aria-invalid")).toBe("true");
      expect(await page.getByRole("alert").textContent()).toBe("Invalid fixture value");
      await page.locator("#contract-checkbox").check();
      expect(await page.locator("#contract-checkbox").isChecked()).toBe(true);
      await page.keyboard.press("Tab");
      await page.locator("#contract-text").focus();
      expect(await page.locator("#contract-text").evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");
      const placeholder = await page.locator("#contract-text").evaluate(node => getComputedStyle(node, "::placeholder").opacity);
      expect(placeholder).toBe("0.7");
      const result = await measure(page, skin);
      metrics[`${skin}-contract-${width}-${theme}-states`] = result;
      expect(result.filter(row => row.outside)).toEqual([]);
    } finally { await page.close(); }
  });
}

for (const skin of ["classic"]) for (const width of [1366, 390]) {
  browserTest(`${skin} General exposes names and visible keyboard focus at ${width}px`, async () => {
    const page = await open(skin, "general", width, "dark");
    try {
      const name = page.locator('input[placeholder="Your name"]');
      expect(await name.evaluate((node: HTMLInputElement) => node.labels?.length)).toBe(1);
      const agent = page.locator(`input[placeholder="${"Agent name"}"]`);
      expect(await agent.evaluate((node: HTMLInputElement) => node.labels?.length)).toBe(1);
      for (const input of await page.locator('input[type="number"],input[type="checkbox"]').all()) {
        expect(await input.evaluate((node: HTMLInputElement) => Boolean(node.getAttribute("aria-label") || node.labels?.length))).toBe(true);
      }
      await page.keyboard.press("Tab");
      await name.focus();
      expect(await name.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe("none");
      await page.emulateMedia({ forcedColors: "active" });
      expect(await name.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe("none");
      await page.emulateMedia({ forcedColors: "none" });
      await name.fill("Changed fixture");
      await agent.focus();

      expect(await agent.evaluate(node => node === document.activeElement)).toBe(true);
    } finally { await page.close(); }
  });

  browserTest(`${skin} Keychain labels, errors and save/cancel focus at ${width}px`, async () => {
    const page = await open(skin, "keychain", width, "dark");
    const opener = page.locator(".settings-keychain-add-btn");
    try {
      await opener.focus();
      await page.keyboard.press("Enter");
      const name = page.locator(".settings-keychain-add-form input[type=text]").first();
      await name.waitFor();
      await page.waitForFunction(() => document.activeElement?.tagName === "INPUT");
      expect(await name.evaluate(node => node === document.activeElement)).toBe(true);
      const secret = page.locator('input[type="password"]');
      for (const input of [name, secret]) expect(await input.evaluate((node: HTMLInputElement) => Boolean(node.getAttribute("aria-label") || node.labels?.length))).toBe(true);

      const save = page.getByRole("button", { name: "Save", exact: true });
      expect(await save.isDisabled()).toBe(true);
      await name.fill("   ");
      expect(await name.getAttribute("aria-invalid")).toBe("true");
      await name.fill("fail");
      await secret.fill("fixture-secret-only");
      await save.click();
      await page.getByRole("alert").first().waitFor();
      expect(await secret.inputValue()).toBe("fixture-secret-only");
      await name.fill("fixture/saved");
      await save.click();
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-expanded") === "false");
      expect(await opener.evaluate(node => node === document.activeElement)).toBe(true);
      {
        const reveal = page.getByRole("button", { name: "Reveal secret: fixture/entry", exact: true });
        await reveal.click();
        const password = page.locator(".settings-keychain-prompt-input");
        await password.waitFor();
        await password.focus();
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.activeElement?.classList.contains("settings-keychain-reveal-btn"));
        expect(await reveal.evaluate(node => node === document.activeElement)).toBe(true);
        expect(await page.locator(".settings-dialog").isVisible()).toBe(true);
      }
      await opener.click();
      await name.waitFor();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-expanded") === "false");
      expect(await opener.evaluate(node => node === document.activeElement)).toBe(true);
    } finally { await page.close(); }
  });
}
