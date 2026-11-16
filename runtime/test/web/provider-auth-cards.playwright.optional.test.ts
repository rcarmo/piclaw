import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { withPrivateProviderAuthResponse } from "../../src/agent-control/handlers/login.js";
import { withChatContext } from "../../src/core/chat-context.js";
import { createTestModelRegistry, TestAgentControlSession } from "../agent-control/session-fixture.js";
import { getTestWorkspace } from "../helpers.js";
import { createNativeControlFixture } from "../agent-control/native-control-fixture.js";

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" && process.env.PICLAW_E2E_DISPOSABLE === "1";
const browserTest = enabled ? test : test.skip;
let script = "";
beforeAll(async () => {
  if (!enabled) return;
  const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, "fixtures/provider-auth-cards-fixture.ts")], target: "browser", format: "esm" });
  if (!built.success) throw new Error(String(built.logs));
  script = await built.outputs[0].text();
}, 30_000);
for (const [name, engine] of Object.entries({ chromium, webkit })) browserTest(`${name}: password prompt, session-bound continuation and explicit single-model activation`, async () => {
  const registry = createTestModelRegistry([{ provider: "openai", id: "fixture-one", name: "Fixture One" }]);
  const session = new TestAgentControlSession(getTestWorkspace().workspace, registry);
  const control = createNativeControlFixture(session, registry, "web:provider-browser-fixture");
  const controls: any[] = [];
  const run = (step: string, data: object) => withChatContext("web:provider-browser-fixture", "web", () => control.facade.applyControlCommand("web:provider-browser-fixture", { type: "login", provider: `__${step} ${JSON.stringify(data)}`, raw: `/login __${step}` }));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/fixture.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
    if (path === "/static/common/js/vendor/adaptivecards.min.js") return new Response(Bun.file(resolve(import.meta.dir, "../../web/static/common/js/vendor/adaptivecards.min.js")), { headers: { "Content-Type": "text/javascript" } });
    if (path === "/fixture/start") return Response.json(await run("step1", { provider: "openai" }));
    if (path === "/fixture/action" && request.method === "POST") {
      const data = await request.json() as any;
      controls.push({ intent: data.intent, method: data.method, flow_id: data.flow_id, action_id: data.action_id, activation_id: data.activation_id });
      const result = data.method === "runtime_present"
        ? await withPrivateProviderAuthResponse(() => run("step2", data))
        : await run(data.intent === "login-step3" ? "step3" : "step2", data);
      if (result.authPresentation) return Response.json({ status: "ok", auth_presentation: result.authPresentation, source_post_id: 1, card_id: (result.contentBlocks?.[0] as any).card_id, chat_jid: "web:provider-browser-fixture" });
      return Response.json(result);
    }
    if (path === "/") return new Response('<!doctype html><meta name="viewport" content="width=device-width"><style>body{font-family:system-ui;padding:12px}</style><div id="status"></div><div id="card"></div><script type="module" src="/fixture.js"></script>', { headers: { "Content-Type": "text/html" } });
    return new Response(null, { status: 404 });
  } });
  const browser = await engine.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
  try {
    await page.goto(server.url.toString());
    expect(await page.locator('#card input[type="password"]').count()).toBe(0);
    await page.getByRole("button", { name: "Open private authentication", exact: true }).click();
    await page.locator('input[type="password"]').fill("SYNTHETIC-browser-key");
    expect(session.model.id).toBe("gpt-test");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Activate Model", exact: true }).waitFor();
    expect(session.model.id).toBe("gpt-test");
    expect(registry.authStorage.get("openai").key).toBe("SYNTHETIC-browser-key");
    expect(controls[0]).toMatchObject({ intent: "login-step2", method: "runtime_present", flow_id: expect.any(String), action_id: expect.any(String) });
    expect(await page.locator("dialog").count()).toBe(0);
    expect(await page.locator("body").textContent()).not.toContain("SYNTHETIC-browser-key");
    await page.getByRole("button", { name: "Activate Model", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("Model set"));
    expect(session.model.id).toBe("fixture-one");
    expect(controls[2]).toMatchObject({ intent: "login-step3", activation_id: expect.any(String) });
    await page.evaluate(() => (window as any).showPrivateAuthFixture({
      status: "ok", source_post_id: 1, card_id: "expired-private", chat_jid: "web:provider-browser-fixture",
      auth_presentation: { expires_at: Date.now() + 750,
        action_data: { intent: "login-step2", provider: "openai", flow_id: "owned", action_id: "expires" },
        events: [{ type: "device_code", userCode: "PRIVATE-expiry-code", verificationUri: "javascript:alert(1)" }],
        prompt: { type: "secret", message: "<img src=x onerror=alert(1)>" },
      },
    }));
    expect(await page.locator("dialog").textContent()).toContain("PRIVATE-expiry-code");
    expect(await page.locator("dialog a").count()).toBe(0);
    expect(await page.locator("dialog img").count()).toBe(0);
    await page.locator("dialog input").fill("PRIVATE-expiring-secret");
    await page.waitForFunction(() => document.querySelector("dialog") === null);
    expect(await page.locator("body").textContent()).not.toContain("PRIVATE-expiry-code");
    expect(await page.locator('input[type="password"]').count()).toBe(0);
    await page.evaluate(() => (window as any).showPrivateAuthStalled({
      status: "ok", source_post_id: 1, card_id: "stalled-private", chat_jid: "web:provider-browser-fixture",
      auth_presentation: { expires_at: Date.now() + 60_000, events: [], prompt: { type: "secret", message: "Secret" },
        action_data: { intent: "login-step2", provider: "openai", flow_id: "owned", action_id: "stalled" } },
    }));
    await page.locator("dialog input").fill("PRIVATE-stalled-secret");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    expect(await page.evaluate(() => (window as any).privateAuthAborted)).toBe(true);
    expect(await page.locator("dialog").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    control.dispose();
    await browser.close();
    server.stop(true);
  }
}, 20_000);
