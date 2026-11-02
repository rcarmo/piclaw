import { beforeAll, expect, test } from "bun:test";
import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { chromium, webkit } from "playwright";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Model, Provider } from "@earendil-works/pi-ai";
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

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" && process.env.PICLAW_E2E_DISPOSABLE === "1";
const browserTest = enabled ? test.serial : test.skip;
let script = "";
beforeAll(async () => {
  if (!enabled) return;
  const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, "fixtures/provider-auth-ui-matrix.ts")], target: "browser", format: "esm" });
  if (!built.success) throw new Error("Provider auth fixture did not build");
  script = await built.outputs[0].text();
  process.env.PICLAW_DB_IN_MEMORY = "1";
  initDatabase();
  if (getDb().filename !== ":memory:") throw new Error("Auth browser fixture requires an in-memory database");
}, 30_000);

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  for (const scenario of ["success", "denial-retry", "cancel", "expiry"]) {
    browserTest(`${name}: real card callback and public runtime ${scenario}`, async () => {
      const ws = createTempWorkspace("provider-auth-ui-");
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
      const sentinel = "PRIVATE-UI-provider-event";
      const chat = `web:auth-ui:${crypto.randomUUID()}`, id = "synthetic-ui-auth";
      cleanupChat = chat;
      const recording = startSessionRecording({ chatJid: chat, title: "Auth boundary fixture", mode: "full" });
      const publicControl = "PUBLIC-RECORDING-CONTROL";
      recordSessionFixtureNote(chat, { marker: publicControl });
      const model: Model<"openai-completions"> = { id: "synthetic-model", name: "Synthetic Model", provider: id,
        api: "openai-completions", baseUrl: "https://fixture.invalid/v1", reasoning: false, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 };
      let attempts = 0, mode = scenario;
      const flowSignals: AbortSignal[] = [];
      const credentials = new FileCredentialStore(join(ws.base, "agent", "auth.json"));
      const runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStorePath: join(ws.base, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
      const provider: Provider = {
        id, name: "Synthetic UI Auth", getModels: () => [model],
        stream: () => { throw new Error("Inference forbidden"); }, streamSimple: () => { throw new Error("Inference forbidden"); },
        auth: {
          apiKey: { name: "Synthetic key", login: async input => ({ type: "api_key", key: await input.prompt({ type: "secret", message: "Key" }) }),
            resolve: async ({ credential }) => credential?.key ? { auth: { apiKey: credential.key }, source: "stored" } : undefined },
          oauth: { name: "Synthetic device", login: async input => {
            attempts++;
            flowSignals.push(input.signal);
            const method = await input.prompt({ type: "select", message: "Choose synthetic route", options: [{ id: "device", label: "Device code" }, { id: "manual", label: "Manual handoff" }] });
            if (method !== "device") throw new Error("Unexpected synthetic route");
            input.notify({ type: "device_code", userCode: sentinel, verificationUri: `https://fixture.invalid/device?state=${sentinel}`, expiresInSeconds: mode === "expiry" ? 1 : 30, intervalSeconds: 1 });
            for (let i = 0; i < 12; i++) input.notify({ type: "progress", message: `${sentinel}-progress-${i}` });
            await input.prompt({ type: "manual_code", message: "Paste synthetic handoff", placeholder: sentinel });
            if (mode === "denial-retry" && attempts === 1) throw new Error(`access_denied ${sentinel}`);
            await input.prompt({ type: "secret", message: "Synthetic private challenge" });
            await input.prompt({ type: "text", message: "Synthetic account label" });
            return { type: "oauth", access: `${sentinel}-access`, refresh: `${sentinel}-refresh`, expires: Date.now() + 3_600_000 };
          }, refresh: async current => current, toAuth: async current => ({ apiKey: current.access }) },
        },
      };
      runtime.registerNativeProvider(provider);
      await runtime.refresh({ allowNetwork: false });
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
      const state = () => { return { blocks: getMessageByRowId(chat, latestPost)?.data.content_blocks ?? [], message: latestMessage, model: session.model.id, postId: latestPost, chatJid: chat, providerAborted: flowSignals.at(-1)?.aborted ?? false }; };
      const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/fixture.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/static/common/js/vendor/adaptivecards.min.js") return new Response(Bun.file(resolve(import.meta.dir, "../../web/static/common/js/vendor/adaptivecards.min.js")), { headers: { "Content-Type": "text/javascript" } });
        if (path === "/fixture/state") return Response.json(state());
        if (path === "/fixture/start" && request.method === "POST") { mode = scenario === "denial-retry" ? "success" : scenario; await start(); return Response.json(state()); }
        if (path === "/agent/card-action" && request.method === "POST") return service.handleAdaptiveCardAction(request);
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
        await page.locator("dialog select").selectOption("device");
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        await page.getByRole("dialog").filter({ hasText: "Paste synthetic handoff" }).waitFor();
      };
        await page.goto(server.url.toString()); await choose();
        expect(await page.locator("dialog").textContent()).toContain(sentinel);
        expect(await page.locator("#card").textContent()).not.toContain(sentinel);
        expect(session.model.id).toBe("gpt-test");
        if (scenario === "success") {
          await page.getByRole("button", { name: "Close", exact: true }).click();
          expect(await page.locator("dialog").count()).toBe(0);
          expect(await credentials.read(id)).toBeUndefined();
          expect(flowSignals.at(-1)?.aborted).toBe(false);
          await page.getByRole("button", { name: "Open private authentication", exact: true }).click();
          await page.getByRole("dialog").filter({ hasText: "Paste synthetic handoff" }).waitFor();
        }
        const currentPost = getMessageByRowId(chat, latestPost);
        const currentCard = currentPost?.data.content_blocks?.[0] as any;
        const currentAction = currentCard.payload.actions.find((action: any) => action.data.method === "runtime_present").data;
        if (scenario === "cancel") {
          await page.getByRole("button", { name: "Cancel authentication", exact: true }).click();
          await page.locator("dialog").waitFor({ state: "detached" });
          expect(await credentials.read(id)).toBeUndefined();
        } else if (scenario === "expiry") {
          await page.locator("dialog").waitFor({ state: "detached" });
          expect(await credentials.read(id)).toBeUndefined();
        } else {
          await page.locator("dialog input").fill(`${sentinel}-handoff`);
          await page.getByRole("button", { name: "Continue", exact: true }).click();
          if (scenario === "denial-retry") {
            await page.locator('dialog [role="alert"]').filter({ hasText: "failed" }).waitFor();
            expect(await credentials.read(id)).toBeUndefined();
            await page.getByRole("button", { name: "Close", exact: true }).click();
            await page.getByRole("button", { name: "Restart login", exact: true }).click(); await choose();
            await page.locator("dialog input").fill(`${sentinel}-handoff`); await page.getByRole("button", { name: "Continue", exact: true }).click();
          }
          await page.locator('dialog input[type="password"]').fill(`${sentinel}-submitted-secret`);
          await page.getByRole("button", { name: "Continue", exact: true }).click();
          await page.getByRole("dialog").filter({ hasText: "Synthetic account label" }).waitFor();
          await page.locator("dialog input").fill(`${sentinel}-submitted-label`);
          await page.getByRole("button", { name: "Continue", exact: true }).click();
          await page.getByRole("button", { name: "Activate Model", exact: true }).waitFor();
          expect(session.model.id).toBe("gpt-test"); expect((await credentials.read(id))?.type).toBe("oauth");
          await page.getByRole("button", { name: "Activate Model", exact: true }).click();
          await page.waitForFunction(() => document.querySelector("#model")?.textContent === "synthetic-model");
          expect(session.model.id).toBe("synthetic-model");
        }
        if (scenario === "cancel" || scenario === "expiry") {
          await page.waitForFunction(async () => (await (await fetch("/fixture/state")).json()).providerAborted === true);
          expect(flowSignals.at(-1)?.aborted).toBe(true);
          const stale = await service.handleAdaptiveCardAction(new Request(`${server.url}agent/card-action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ post_id: latestPost, card_id: currentCard.card_id, chat_jid: chat, action: { type: "Action.Submit", data: currentAction } }) }));
          expect(stale.status).toBe(409);
        }
        expect(JSON.stringify({ rows: [...new Set(savedRows)].map(row => getMessageByRowId(chat, row)), broadcasts })).not.toContain(sentinel);
        expect(JSON.stringify(logs)).not.toContain(sentinel);
        stopSessionRecording(chat);
        const recorded = getSessionRecording(recording.id);
        expect(recorded?.meta.mode).toBe("full");
        expect(recorded?.events.some(event => event.kind === "assistant_output")).toBe(true);
        expect(recorded?.events.some(event => event.kind === "sse_event" && (event.data as any).event_type === "interaction_updated")).toBe(true);
        expect(recorded?.events.every(event => event.redactions === undefined)).toBe(true);
        expect(recorded?.events.filter(event => event.kind === "assistant_output" && (event.data as any).interaction_id).map(event => (event.data as any).interaction_id).sort()).toEqual([...new Set(savedRows)].sort());
        expect(readFileSync(recording.tracePath, "utf8")).toContain(publicControl);
        expect(readFileSync(recording.tracePath, "utf8")).not.toContain(sentinel);
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
            expect(body).not.toContain(sentinel);
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
        expect(readFileSync(snapshot.tracePath, "utf8")).not.toContain(sentinel);
        await checkExports(snapshot.id);
        expect(errors).toEqual([]);
      } finally {
        removeLogSink(sink);
        if (cleanupSession) cancelProviderAuthFlows(cleanupSession as any);
        if (cleanupChat) {
          stopSessionRecording(cleanupChat);
          for (const row of new Set(savedRows)) deleteMessageByRowId(cleanupChat, row);
        }
        try { await cleanupBrowser?.(); }
        finally {
          cleanupServer?.();
          if (previousRecordingsDir === undefined) delete process.env.PICLAW_RECORDINGS_DIR;
          else process.env.PICLAW_RECORDINGS_DIR = previousRecordingsDir;
          ws.cleanup();
        }
      }
    }, 35_000);
  }
}
