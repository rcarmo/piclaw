import { beforeAll, expect, test } from "bun:test";
import { resolve, join } from "node:path";
import { readFileSync, readlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

import { FileCredentialStore } from "../../src/agent-pool/credential-store.js";
import { handleLogin, cancelProviderAuthFlows } from "../../src/agent-control/handlers/login.js";
import { withChatContext } from "../../src/core/chat-context.js";
import { WebAdaptiveCardSidePromptService } from "../../src/channels/web/cards/adaptive-card-side-prompt-service.js";
import { initDatabase, getDb, getMessageByRowId, deleteMessageByRowId } from "../../src/db.js";
import { WebSessionBroadcastService } from "../../src/channels/web/sse/session-broadcast-service.js";
import { createInteractionBroadcaster } from "../../src/channels/web/interaction-broadcaster.js";
import { admitWebMessage } from "../../src/channels/web/messaging/message-store.js";
import { startSessionRecording, stopSessionRecording, getSessionRecording, recordSessionFixtureNote } from "../../src/session-recordings/session-recordings.js";
import { handleSessionRecordingRoutes } from "../../src/channels/web/handlers/session-recordings.js";
import { TestAgentControlSession } from "../agent-control/session-fixture.js";
import { createTempWorkspace } from "../helpers.js";
import { addLogSink, removeLogSink, type LogRecord } from "../../src/utils/logger.js";

const enabled = process.env.PICLAW_RUN_ANTHROPIC_PRIVATE_UI_TESTS === "1" && process.env.PICLAW_E2E_DISPOSABLE === "1";
const browserTest = enabled ? test.serial : test.skip;
let script = "";
beforeAll(async () => {
  if (!enabled) return;
  expect(process.versions.bun).toBeDefined();
  expect(process.env.SYNTHETIC_PARENT_NETNS).toBeTruthy();
  expect(readlinkSync("/proc/self/ns/net")).not.toBe(process.env.SYNTHETIC_PARENT_NETNS);
  expect(readFileSync("/proc/net/dev", "utf8").trim().split("\n").slice(2).map(line => line.split(":")[0].trim())).toEqual(["lo"]);
  expect(readFileSync("/proc/net/route", "utf8").trim().split("\n")).toHaveLength(1);
  expect(process.getuid?.()).toBe(Number(process.env.SYNTHETIC_EXPECT_UID));
  expect(process.getuid?.()).not.toBe(0);
  const status = readFileSync("/proc/self/status", "utf8");
  for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) expect(status).toMatch(new RegExp(`${field}:\\s+0{16}(?:\\n|$)`));
  expect(status).toMatch(/NoNewPrivs:\s+1(?:\n|$)/);
  expect(status).toMatch(/Groups:\s*\n/);
  const packageRoot = fileURLToPath(new URL("..", import.meta.resolve("@earendil-works/pi-ai")));
  expect(JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version).toBe("1.0.0");
  expect(createHash("sha256").update(readFileSync(join(packageRoot, "dist/auth/oauth/anthropic.js"))).digest("hex")).toBe("80fc4412ce09d42d678f5094932f3e58eecec53df40c4530fc4f55651a57d0a4");
  const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, "fixtures/provider-auth-ui-matrix.ts")], target: "browser", format: "esm" });
  if (!built.success) throw new Error("Provider auth fixture did not build");
  script = await built.outputs[0].text();
  process.env.PICLAW_DB_IN_MEMORY = "1";
  initDatabase();
  if (getDb().filename !== ":memory:") throw new Error("Auth browser fixture requires an in-memory database");
}, 30_000);

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  for (const scenario of ["success", "denial-retry", "bad-state", "cancel-prompt", "cancel-exchange"]) {
    browserTest(`${name}: Pi 1.0.0 builtin Anthropic copy-code private UI and recording ${scenario}`, async () => {
      const ws = createTempWorkspace("provider-auth-ui-");
      const originalFetch = globalThis.fetch;
      let tokenRequests = 0, unexpectedNetwork = 0, transportAborted = false, privateResponses = 0;
      const sensitive = new Set<string>(["PRIVATE-ANTHROPIC-UI", "https://platform.claude.com/v1/oauth/token"]);
      const logs: LogRecord[] = [];
      const sink = (record: LogRecord) => logs.push(record);
      addLogSink(sink);
      let cleanupSession: TestAgentControlSession | undefined;
      let cleanupBrowser: (() => Promise<void>) | undefined;
      let cleanupServer: (() => void) | undefined;
      let cleanupChat: string | undefined;
      const savedRows: number[] = [];
      const previousRecordingsDir = process.env.PICLAW_RECORDINGS_DIR;
      process.env.PICLAW_RECORDINGS_DIR = join(ws.base, "recordings");
      try {
      const sentinel = "PRIVATE-ANTHROPIC-UI";
      const chat = `web:auth-ui:${crypto.randomUUID()}`, id = "anthropic";
      cleanupChat = chat;
      const recording = startSessionRecording({ chatJid: chat, title: "Auth boundary fixture", mode: "full" });
      const publicControl = "PUBLIC-RECORDING-CONTROL";
      recordSessionFixtureNote(chat, { marker: publicControl });
      let mode = scenario;
      const guard = (globalThis as typeof globalThis & { __anthropicUiGuard?: { unexpectedRequests: number } }).__anthropicUiGuard;
      expect(guard).toBeDefined();
      let authorization: URL | undefined;
      const credentials = new FileCredentialStore(join(ws.base, "agent", "auth.json"));
      globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
        try {
          if (String(input) !== "https://platform.claude.com/v1/oauth/token") throw new Error("Unexpected endpoint");
          tokenRequests++;
          expect(init?.method).toBe("POST"); expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
          const body = JSON.parse(String(init?.body));
          expect(body.grant_type).toBe("authorization_code"); expect(body.code).toBe(sentinel + "-code");
          expect(body.client_id).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e");
          expect(body.redirect_uri).toBe("https://platform.claude.com/oauth/code/callback");
          if (!authorization) throw new Error("Missing private authorization URL");
          expect(body.state).toBe(authorization.searchParams.get("state")!);
          sensitive.add(body.code_verifier);
          expect(createHash("sha256").update(body.code_verifier).digest("base64url")).toBe(authorization.searchParams.get("code_challenge")!);
          expect(init?.signal).toBeDefined(); assertNoCallbackListener();
          if (mode === "cancel-exchange") return new Promise<Response>((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () => { transportAborted = true; reject(new DOMException("Synthetic abort", "AbortError")); }, { once: true });
          });
          if (mode === "denial-retry") return Response.json({ error: "access_denied", error_description: sentinel + "-provider-error" }, { status: 400 });
          return Response.json({ access_token: sentinel + "-access", refresh_token: sentinel + "-refresh", expires_in: 3600 });
        } catch (error) { unexpectedNetwork++; throw error; }
      }, { preconnect: () => { unexpectedNetwork++; throw new Error("Unexpected preconnect"); } }) as typeof fetch;
      const runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStorePath: join(ws.base, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
      const model = runtime.getModels(id)[0]!;
      expect(model).toBeDefined(); expect(runtime.getProvider(id)?.auth.oauth).toBeDefined();
      const registry = new ModelRegistry(runtime);
      const session = new TestAgentControlSession(ws.base, registry);
      session.modelRuntime = runtime;
      cleanupSession = session;
      let latestPost = 0, latestMessage = "";
      const broadcasts: unknown[] = [];
      const broadcast = new WebSessionBroadcastService({ setProviderUsageRefreshListener: () => {} } as any, {
        sse: { broadcast: (type: string, data: unknown) => broadcasts.push({ type, data }) } as any,
      });
      const broadcaster = createInteractionBroadcaster(broadcast, () => ({ agentName: "Agent", userName: "Fixture" }));
      const projection = { pendingLinkPreviews: new Set<number>(), broadcastEvent: (type: string, data: unknown) => broadcast.broadcastEvent(type, data) };
      const write = async (text: string, blocks: unknown[] = []) => {
        latestMessage = text;
        const row = await admitWebMessage(projection, { chatJid: chat, content: text, isBot: true, mediaIds: [], agentId: "default", agentName: "Agent" }, { contentBlocks: blocks });
        if (!row) throw new Error("Auth fixture message was not stored");
        latestPost = row.id;
        savedRows.push(latestPost);
        broadcaster.broadcastAgentResponse(row);
      };
      const run = (command: any) => withChatContext(chat, "web", () => handleLogin(session as any, registry, command));
      const start = async () => { const result = await run({ type: "login", raw: "/login" }); await write(result.message, result.contentBlocks); };
      const service = new WebAdaptiveCardSidePromptService({
        defaultChatJid: chat, defaultAgentId: "default", json: (value, status = 200) => Response.json(value, { status }), webRuntimeConfig: {},
        agentPool: { applyControlCommand: async (_chat, command) => run(command) },
        authGateway: { setTotpSecret: () => {}, createTotpContext: () => ({ buildSessionCookie: () => "fixture" }) },
        interactionBroadcaster: broadcaster,
        sendMessage: async (_chat, text, options) => write(text, options && typeof options === "object" ? options.contentBlocks : undefined),
        broadcastEvent: (type, data) => broadcast.broadcastEvent(type, data), skipFailedOnModelSwitch: () => {},
        forwardAgentMessage: async () => Response.json({ error: "Unexpected forwarded input" }, { status: 400 }),
      });
      await start();
      const state = () => { return { blocks: getMessageByRowId(chat, latestPost)?.data.content_blocks ?? [], message: latestMessage, model: session.model.id, postId: latestPost, chatJid: chat, providerAborted: transportAborted }; };
      const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/fixture.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/static/common/js/vendor/adaptivecards.min.js") return new Response(Bun.file(resolve(import.meta.dir, "../../web/static/common/js/vendor/adaptivecards.min.js")), { headers: { "Content-Type": "text/javascript" } });
        if (path === "/fixture/state") return Response.json(state());
        if (path === "/fixture/start" && request.method === "POST") { mode = scenario === "denial-retry" ? "success" : scenario; await start(); return Response.json(state()); }
        if (path === "/agent/card-action" && request.method === "POST") {
          const response = await service.handleAdaptiveCardAction(request);
          const body = await response.clone().json() as { auth_presentation?: unknown };
          if (body.auth_presentation) {
            privateResponses++;
            expect(response.headers.get("Cache-Control")).toBe("private, no-store");
            expect(response.headers.get("Vary")).toBe("Cookie");
            expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
          }
          return response;
        }
        if (path === "/") return new Response('<!doctype html><meta name="viewport" content="width=device-width"><button id="start">Restart login</button><div id="model"></div><div id="status"></div><div id="card"></div><script type="module" src="/fixture.js"></script>', { headers: { "Content-Type": "text/html" } });
        return new Response(null, { status: 404 });
      } });
      cleanupServer = () => server.stop(true);
      const browser = await engine.launch({ headless: true });
      cleanupBrowser = () => browser.close();
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
      const choose = async () => {
        await page.locator("#card select").selectOption(id);
        await page.getByRole("button", { name: "Next →", exact: true }).click();
        await page.getByRole("radio", { name: "Login with OAuth", exact: true }).check();
        await page.getByRole("button", { name: "Next →", exact: true }).click();
        await page.getByRole("button", { name: "Open private authentication", exact: true }).click();
        await page.locator("dialog select").selectOption("copy_code");
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        await page.getByRole("dialog").filter({ hasText: "Paste the code Anthropic shows" }).waitFor();
      };
        await page.goto(server.url.toString()); await choose();
        authorization = new URL(await page.locator("dialog a").getAttribute("href") as string);
        sensitive.add(authorization.href); sensitive.add(authorization.searchParams.get("state")!);
        expect(authorization.origin).toBe("https://claude.ai");
        expect(authorization.searchParams.get("redirect_uri")).toBe("https://platform.claude.com/oauth/code/callback");
        assertNoCallbackListener();
        expect(await page.locator("#card").textContent()).not.toContain(sentinel);
        expect(session.model.id).toBe("gpt-test");
        if (scenario === "success") {
          await page.getByRole("button", { name: "Close", exact: true }).click();
          expect(await page.locator("dialog").count()).toBe(0);
          expect(await credentials.read(id)).toBeUndefined();
          expect(tokenRequests).toBe(0);
          await page.getByRole("button", { name: "Open private authentication", exact: true }).click();
          await page.getByRole("dialog").filter({ hasText: "Paste the code Anthropic shows" }).waitFor();
        }
        const currentPost = getMessageByRowId(chat, latestPost);
        const currentCard = currentPost?.data.content_blocks?.[0] as any;
        const currentAction = currentCard.payload.actions.find((action: any) => action.data.method === "runtime_present").data;
        if (scenario === "cancel-prompt") {
          await page.getByRole("button", { name: "Cancel authentication", exact: true }).click();
          await page.locator("dialog").waitFor({ state: "detached" });
          expect(await credentials.read(id)).toBeUndefined(); expect(tokenRequests).toBe(0);
        } else {
          const submitCode = async (bad = false) => {
            authorization = new URL(await page.locator("dialog a").getAttribute("href") as string);
            sensitive.add(authorization.href); sensitive.add(authorization.searchParams.get("state")!);
            await page.locator("dialog input").fill(sentinel + "-code#" + (bad ? "wrong-state" : authorization.searchParams.get("state")));
            await page.getByRole("button", { name: "Continue", exact: true }).click();
          };
          await submitCode(scenario === "bad-state");
          if (scenario === "cancel-exchange") {
            await page.getByRole("button", { name: "Cancel authentication", exact: true }).click({ timeout: 15000 });
            await page.locator("dialog").waitFor({ state: "detached" });
            expect(transportAborted).toBe(true); expect(await credentials.read(id)).toBeUndefined();
          } else if (scenario === "bad-state" || scenario === "denial-retry") {
            await page.locator('dialog [role="alert"]').filter({ hasText: "failed" }).waitFor();
            expect(await credentials.read(id)).toBeUndefined();
            if (scenario === "bad-state") expect(tokenRequests).toBe(0);
            else {
              await page.getByRole("button", { name: "Close", exact: true }).click();
              await page.getByRole("button", { name: "Restart login", exact: true }).click(); await choose(); await submitCode();
            }
          }
          if (scenario === "success" || scenario === "denial-retry") {
            // The real exchange can return a private progress view before the
            // runtime finishes availability refresh; advance through its public UI.
            await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => ["Activate Model", "Check & Continue"].includes(button.textContent?.trim() ?? "")));
            const check = page.getByRole("button", { name: "Check & Continue", exact: true });
            if (await check.count()) await check.click();
            await page.getByRole("button", { name: "Activate Model", exact: true }).waitFor();
            expect(session.model.id).toBe("gpt-test");
            const stored = await credentials.read(id); expect(stored?.type).toBe("oauth");
            expect(stored).toMatchObject({ access: sentinel + "-access", refresh: sentinel + "-refresh" });
            await page.locator("#card select").selectOption(model.id);
            await page.getByRole("button", { name: "Activate Model", exact: true }).click();
            await page.waitForFunction((expected) => document.querySelector("#model")?.textContent === expected, model.id);
            expect(session.model.id).toBe(model.id);
          }
        }
        expect(tokenRequests).toBe(scenario === "denial-retry" ? 2 : ["success", "cancel-exchange"].includes(scenario) ? 1 : 0);
        expect(unexpectedNetwork).toBe(0); expect(guard!.unexpectedRequests).toBe(0); assertNoCallbackListener();
        if (scenario.startsWith("cancel")) {
          const stale = await service.handleAdaptiveCardAction(new Request(server.url + "agent/card-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ post_id: latestPost, card_id: currentCard.card_id, chat_jid: chat, action: { type: "Action.Submit", data: currentAction } }) }));
          expect(stale.status).toBe(409);
        }
        expect(privateResponses).toBeGreaterThanOrEqual(2);
        const everyRow = getDb().query("SELECT * FROM messages WHERE chat_jid=? ORDER BY rowid").all(chat);
        expect(everyRow.length).toBeGreaterThan(0);
        for (const secret of sensitive) expect(JSON.stringify({ rows: everyRow, broadcasts })).not.toContain(secret);
        for (const secret of sensitive) expect(JSON.stringify(logs)).not.toContain(secret);
        stopSessionRecording(chat);
        const recorded = getSessionRecording(recording.id);
        expect(recorded?.meta.mode).toBe("full");
        expect(recorded?.events.some(event => event.kind === "assistant_output")).toBe(true);
        expect(recorded?.events.some(event => event.kind === "sse_event" && (event.data as any).event_type === "interaction_updated")).toBe(true);
        expect(recorded?.events.every(event => event.redactions === undefined)).toBe(true);
        expect(recorded?.events.filter(event => event.kind === "assistant_output" && (event.data as any).interaction_id).map(event => (event.data as any).interaction_id).sort()).toEqual([...new Set(savedRows)].sort());
        expect(readFileSync(recording.tracePath, "utf8")).toContain(publicControl);
        for (const secret of sensitive) expect(readFileSync(recording.tracePath, "utf8")).not.toContain(secret);
        const responder = (value: unknown, status = 200) => Response.json(value, { status });
        const checkExports = async (recordingId: string) => {
          for (const format of ["json", "jsonl", "html"]) {
            const path = `/agent/recordings/${recordingId}/export`;
            const response = await handleSessionRecordingRoutes(new Request(`http://fixture.invalid${path}?format=${format}`), path, responder);
            expect(response?.status).toBe(200);
            expect(response?.headers.get("Cache-Control")).toBe("no-store");
            const body = await response!.text();
            expect(body).toContain(recordingId);
            if (recordingId === recording.id) expect(body).toContain(publicControl);
            for (const secret of sensitive) expect(body).not.toContain(secret);
            const events = format === "jsonl" ? body.trim().split("\n").map(line => JSON.parse(line))
              : format === "json" ? JSON.parse(body).events
              : JSON.parse(body.split("const embeddedTrace = ")[1].split(";\nconst fixture =")[0]).events;
            expect(events.filter((event: any) => event.kind === "assistant_output" && event.data.interaction_id).map((event: any) => event.data.interaction_id).sort()).toEqual([...new Set(savedRows)].sort());
            expect(events.every((event: any) => event.redactions === undefined)).toBe(true);
          }
        };
        await checkExports(recording.id);
        // Exercise the real persisted-timeline snapshot path without replaying
        // private HTTP responses into a recorder or relying on redaction.
        const snapshotResponse = await handleSessionRecordingRoutes(new Request("http://fixture.invalid/agent/recordings/start", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_jid: chat, mode: "full", include_timeline_snapshot: true }),
        }), "/agent/recordings/start", responder);
        expect(snapshotResponse?.status).toBe(201);
        const snapshot = (await snapshotResponse!.json()).recording;
        stopSessionRecording(chat);
        const snapshotEvents = getSessionRecording(snapshot.id)!.events;
        expect(snapshotEvents.filter(event => event.kind === "assistant_output").map(event => (event.data as any).interaction_id).sort()).toEqual([...new Set(savedRows)].sort());
        expect(snapshotEvents.every(event => event.redactions === undefined)).toBe(true);
        for (const secret of sensitive) expect(readFileSync(snapshot.tracePath, "utf8")).not.toContain(secret);
        await checkExports(snapshot.id);
        expect(errors).toEqual([]);
        // Observe cancellation/cleanup logging before releasing the log sink.
        cancelProviderAuthFlows(session as any);
        await Bun.sleep(100);
        for (const secret of sensitive) expect(JSON.stringify(logs)).not.toContain(secret);
        console.log("ANTHROPIC_PRIVATE_UI=" + JSON.stringify({ browser: name, scenario, version: "1.0.0", tokenRequests, unexpectedNetwork, transportAborted,
          modelActivated: session.model.id !== "gpt-test", privateHeadersChecked: privateResponses > 0, allChatRowsChecked: true,
          fullRecordingAndExportsChecked: true, redactionFallback: false, callbackListenerObserved: false, inference: "not_invoked" }));
      } finally {
        try {
          if (cleanupSession) cancelProviderAuthFlows(cleanupSession as any);
          await Bun.sleep(100);
          for (const secret of sensitive) expect(JSON.stringify(logs)).not.toContain(secret);
        } finally {
          removeLogSink(sink);
          globalThis.fetch = originalFetch;
          try {
            if (cleanupChat) {
              stopSessionRecording(cleanupChat);
              const rows = getDb().query("SELECT rowid FROM messages WHERE chat_jid=?").all(cleanupChat) as Array<{ rowid: number }>;
              for (const row of rows) deleteMessageByRowId(cleanupChat, row.rowid);
            }
          } finally {
            try { await cleanupBrowser?.(); }
            finally {
              try { cleanupServer?.(); }
              finally {
                if (previousRecordingsDir === undefined) delete process.env.PICLAW_RECORDINGS_DIR;
                else process.env.PICLAW_RECORDINGS_DIR = previousRecordingsDir;
                ws.cleanup();
              }
            }
          }
        }
      }
    }, 45_000);
  }
}

function assertNoCallbackListener(): void {
  const port = (53692).toString(16).toUpperCase();
  for (const path of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    const rows = readFileSync(path, "utf8").trim().split("\n").slice(1).map(line => line.trim().split(/\s+/));
    expect(rows.some(row => row[3] === "0A" && row[1].split(":")[1] === port)).toBe(false);
  }
}
