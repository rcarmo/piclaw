import { repoRoot } from "./src/repo-root.js";
import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import "./src/test-guard.js";
import { expect, spyOn } from "bun:test";
const applicationTest = isolatedApplicationTest(import.meta.url);
import { cpSync, symlinkSync, realpathSync, mkdirSync, readdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPiclawAgentDir } from "../../runtime/src/core/agent-dir.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { createTestCredentialStore } from "../../runtime/test/model-services-fixture.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { createRuntimeBaseServices } from "../../runtime/src/runtime/composition.js";
import { WebChannel } from "../../runtime/src/channels/web.js";
import { admitWebUserMessage } from "../../runtime/src/channels/web/messaging/message-store.js";
import type { Model, AssistantMessage, CredentialStore } from "../../node_modules/@earendil-works/pi-ai";
import { HostConversationRuntime } from "../../runtime/durable-engine/src/host-runtime.js";
import { HostCodexModelServices } from "../../runtime/durable-engine/src/host-codex-model-services.js";
const rootUrl = new URL("../../package.json", import.meta.url).href;
const { ModelRuntime } = await import(import.meta.resolve("@earendil-works/pi-coding-agent", rootUrl));
const { createAssistantMessageEventStream, getCurrentTools } = await import(import.meta.resolve("@earendil-works/pi-ai", rootUrl));

for (const scenario of ["write", "model", "sse", "broken-sse"] as const) applicationTest(`Codex production factory ${scenario}: real public dispatch and reopen`, async () => {
  const source = realpathSync(process.env.DURABLE_ADDONS_ROOT!);
  const workspace = process.env.PICLAW_WORKSPACE!;
  const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-codex-conversion");
  cpSync(join(source, "addons/codex-conversion"), pkg, { recursive: true, filter: p => !p.split("/").includes("node_modules") });
  // All links belong to this isolated package; neither dependency source is mutated.
  const dependencies = join(pkg, "node_modules");
  mkdirSync(dependencies, {recursive:true});
  for (const sourceModules of [join(repoRoot("CORE"), "node_modules"), process.env.DURABLE_CATALOG_DEPENDENCIES ?? join(source, "node_modules"), join(source, "addons/codex-conversion/node_modules")].filter(path => existsSync(path))) {
    for (const entry of readdirSync(sourceModules)) {
      if (entry.startsWith(".")) continue;
      if (entry.startsWith("@")) {
        mkdirSync(join(dependencies, entry), { recursive: true });
        for (const child of readdirSync(join(sourceModules, entry))) {
          const target = join(dependencies, entry, child);
          if (!existsSync(target)) symlinkSync(join(sourceModules, entry, child), target);
        }
      } else {
        const target = join(dependencies, entry);
        if (!existsSync(target)) symlinkSync(join(sourceModules, entry), target);
      }
    }
  }
  // The production default includes this optional dynamic section. An empty
  // Regrets prompt must not make model switching permanently unavailable.
  if (scenario === "model") {
    const regrets = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-late-night-regrets");
    cpSync(join(source, "addons/late-night-regrets"), regrets, { recursive: true, filter: p => !p.split("/").includes("node_modules") });
    symlinkSync(dependencies, join(regrets, "node_modules"));
  }
  const model: Model<"openai-codex-responses"> = { provider: "openai-codex", id: "synthetic-codex", name: "Synthetic Codex", api: "openai-codex-responses", baseUrl: "https://fixture.invalid", input: ["text", "image"], reasoning: false, contextWindow: 100000, maxTokens: 1000, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };
  const credentials: CredentialStore = {
    async read(id) { if (id !== model.provider) throw Error("Ambient credentials forbidden: " + id); return { type: "api_key", key: "synthetic-only" }; },
    async list() { return [{ providerId: model.provider, type: "api_key" }]; },
    async modify(_id, fn) { return fn(undefined); }, async delete() {},
  };
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} }, allowModelNetwork: false, refreshOnCreate: false });
  const alternate = { ...model, id: "synthetic-alternate", name: "Synthetic alternate" };
  let calls = 0;
  const routingTokens: (string | null)[] = [];
  const routingRelease = spyOn(HostCodexModelServices.prototype, "releaseTurn");
  let fixtureError: unknown;
  let bodyFailed = false;
  let bodyPulls = 0;
  let joined = 0;
  const originalClose = HostConversationRuntime.prototype.close;
  const closeSpy = spyOn(HostConversationRuntime.prototype, "close").mockImplementation(async function(this: HostConversationRuntime) {
    await originalClose.call(this);
    joined++;
  });
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    if (scenario === "write") {
      routingTokens.push(new Headers(init?.headers).get("x-codex-turn-state"));
      return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream", "x-codex-turn-state": "ROUTING_TOKEN_" + routingTokens.length } });
    }
    if (scenario === "broken-sse") return new Response(new ReadableStream({
      async pull(controller) {
        bodyPulls++;
        if (bodyPulls === 1) controller.enqueue(new TextEncoder().encode('data: {"type":"response.created","response":{"id":"response-broken-fixture"}}\n\n'));
        else { await new Promise(resolve => setTimeout(resolve, 5)); bodyFailed = true; controller.error(new Error("PRIVATE_SYNTHETIC_CAPTURE_FAILURE")); }
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const events = [{ type: "response.created", response: { id: "response-fixture" } }, { type: "response.output_item.done", item: { type: "image_generation_call", id: "image-fixture", result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=", output_format: "png" } }];
    const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n");
    return new Response(new ReadableStream({ start(controller) { for (let i=0;i<bytes.length;i+=17) controller.enqueue(bytes.slice(i,i+17)); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
  });
  const names = ["read", "bash", "edit", "write", "codemode", "set_model", "list_models", "view_image", "web_search", "image_generation"];
  const run: Parameters<typeof runtime.registerNativeProvider>[0]["streamSimple"] = (actual, context, options) => {
    calls++;
    expect(actual.provider).toBe(model.provider); expect(actual.id).toBe(scenario === "model" && calls > 1 ? alternate.id : model.id); expect(actual.api).toBe(model.api);
    const tools = getCurrentTools(context.messages);
    for (const name of names) expect(tools.some(t => t.name === name)).toBe(true);
    for (const name of ["exec_command", "write_stdin", "apply_patch"]) expect(tools.some(t => t.name === name)).toBe(false);
    expect(options?.onPayload).toBeFunction();
    const stream = createAssistantMessageEventStream();
    void (async () => {
      try {
    if (scenario === "write" && calls === 2) {
      const result = context.messages.findLast(m => m.role === "toolResult");
      expect(result).toBeDefined();
      expect((result as any).isError).toBe(false);
      expect(JSON.stringify((result as any).content)).toContain("Successfully wrote");
      expect(context.messages.some(m => m.role === "assistant" && m.content.some((c:any) => c.type === "toolCall" && c.id === "write-fixture"))).toBe(true);
    }

        // Public Root consumes transformHeaders before entering the native provider.
        expect(options?.headers?.["x-fixture"]).toBe("owned");
        const payload = await options!.onPayload!({ model: model.id, input: [], tools: tools.map(t => ({type: "function", name: t.name, description: t.description, parameters: t.parameters})) }, actual);
        expect(payload).toBeDefined();
        if (scenario === "write") {
          const response = await options!.fetch!("https://fixture.invalid/responses", { method: "POST", body: JSON.stringify(payload), headers: options!.headers as HeadersInit });
          await response.text();
        }
        if (scenario !== "write" && scenario !== "model") {
          for (const name of ["image_generation", "web_search"]) {
            const declaration = tools.find(t => t.name === name)!;
            expect(declaration.parameters).toEqual({type: "object", additionalProperties: false});
            const native = (payload as any).tools.find((t:any) => t.type === name);
            expect(native).toBeDefined();
            expect(native.parameters).toBeUndefined();
            expect((payload as any).tools.some((t:any) => t.type === "function" && t.name === name)).toBe(false);
          }
          expect(options?.fetch).toBeFunction();
          const response = await options!.fetch!("https://fixture.invalid/responses", {method: "POST", body: JSON.stringify(payload)});
          expect(await response.text()).toContain("image_generation_call");
        }
        const message: AssistantMessage = { role: "assistant", provider: model.provider, model: actual.id, api: model.api, timestamp: Date.now(), content: [{ type: "text", text: "owned synthetic codex terminal" }], stopReason: "stop", usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0.000003, output: 0.000002, cacheRead: 0, cacheWrite: 0, total: 0.000005 } } };
        if (scenario === "write" && calls === 1) {
          message.content = [{type: "toolCall", id: "write-fixture", name: "write", arguments: {path: "native-factory-proof.txt", content: "native write proof\n"}}];
          message.stopReason = "toolUse";
        }
        if (scenario === "model" && calls === 1) {
          message.content = [{type: "toolCall", id: "owned-model-fixture", name: "set_model", arguments: {model: model.provider + "/" + alternate.id, thinking_level: "off"}}];
          message.stopReason = "toolUse";
        }
        if (scenario === "model" && calls === 2) {
          const result: any = context.messages.findLast(m => m.role === "toolResult");
          expect(result.isError).toBe(false);
          expect(JSON.stringify(result.content)).toContain(alternate.id);
        }
        stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message);
      } catch (error) {
        fixtureError = error;
        const message: AssistantMessage = { role: "assistant", provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), content: [], stopReason: "error", errorMessage: String(error), usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0.000003, output: 0.000002, cacheRead: 0, cacheWrite: 0, total: 0.000005 } } };
        stream.push({ type: "error", reason: "error", error: message }); stream.end(message);

      }
    })();
    return stream;
  };
  const provider: Parameters<typeof runtime.registerNativeProvider>[0] = { id: model.provider, name: "Synthetic Codex", getModels: () => [model, alternate], auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: { apiKey: "synthetic-only", headers: { "x-fixture": "owned" } }, source: "fixture" }) } }, stream: run, streamSimple: run };
  runtime.registerNativeProvider(provider);
  expect(runtime.getRegisteredNativeProvider(model.provider)).toBe(provider);
  const services = { modelRuntime: runtime, modelRegistry: { getAvailable: () => [model, alternate] } };
  mkdirSync(getPiclawAgentDir(), { recursive: true });
  writeFileSync(join(getPiclawAgentDir(), "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic-only", refresh: "synthetic-refresh", expires: Date.now() + 3600000, accountId: "synthetic-account" } }));
  process.env.PICLAW_DB_IN_MEMORY = "0"; initDatabase();
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "codex-production-owner.lock"), strictOwnership: true, disabled: false });
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => services as never);
    expect(calls).toBe(0);
    expect(runtime.getRegisteredNativeProvider(model.provider)).toBe(provider);
    const base = createRuntimeBaseServices({ dataDir: workspace });
    const pool = new AgentPool({ credentialStore: createTestCredentialStore({}), modelRuntime: runtime, modelRegistry: services.modelRegistry, ...backend.sessionOptions } as never);
    const bound = backend.bind({ queue: base.queue, agentPool: pool });
    const channel = new WebChannel(bound);
    const priorReservations = new Set((getDb().query("SELECT id FROM budget_request_reservations").all() as {id:string}[]).map(r=>r.id));
    const priorBotCount = (getDb().query("SELECT count(*) AS n FROM messages WHERE is_bot_message=1").get() as {n:number}).n;
    const admitted = await admitWebUserMessage(channel, { chatJid: "web:default", content: "Reply with a short synthetic result", mediaIds: [], isBot: false, agentId: "default", agentName: "Fixture" }, { acceptSource: bound.getInputSourceAdmission!("web:default") }, () => owner.assertCurrentOwner(), new AbortController().signal);
    expect(admitted).not.toBeNull();
    const row = getDb().query("SELECT id FROM messages WHERE rowid=?").get(admitted!.id) as { id: string };
    const outcome = await bound.dispatchAcceptedInput!("web:default", row.id, admitted!.id)!();
    if (scenario === "broken-sse") {
      expect(bodyFailed).toBe(true);
      expect(bodyPulls).toBe(2);
      expect(calls).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      // Native model-error settlement consumes the accepted input once and releases the lane.
      expect(outcome).toBe("settled");
      const reservations = (getDb().query("SELECT * FROM budget_request_reservations").all() as any[]).filter(r => !priorReservations.has(r.id));
      expect(reservations).toHaveLength(1);
      expect(reservations[0].state).toBe("settled");
      const usage = getDb().query("SELECT u.input_tokens, u.output_tokens, e.api_usd_micros FROM budget_usage_events e JOIN token_usage u ON u.id=e.token_usage_id WHERE e.usage_event_id=?").get(reservations[0].usage_event_id) as any;
      expect(usage).toEqual({ input_tokens: 3, output_tokens: 2, api_usd_micros: 5 });
      const workBefore = getDb().query("SELECT * FROM budget_work WHERE id=?").get(reservations[0].work_id);
      const before = JSON.stringify(reservations);
      const tree = JSON.stringify(await backend.sessionOptions.getDurableSession!("web:default")!.readTree!());
      expect(tree).not.toContain("owned synthetic codex terminal");
      expect(tree).not.toContain("PRIVATE_SYNTHETIC_CAPTURE_FAILURE");
      expect(tree).not.toContain("Files:");
      expect(outcome).toBe("settled");
      const records = JSON.stringify(getDb().query("SELECT record FROM entries ORDER BY id").all());
      expect(records).toContain("Host model request failed [phase=conversion; category=unknown; evidence=");
      const {parseModelFailure}=await import("../../runtime/durable-engine/src/host-model-failure.js");
      const rows=getDb().query("SELECT record FROM entries ORDER BY id").all() as {record:string}[];
      const messages:{errorMessage?:string}[]=rows.flatMap(row=>JSON.parse(row.record).model??[]);
      const detail=messages.find(message=>message.errorMessage?.startsWith("Host model request failed"))?.errorMessage;
      const failure=parseModelFailure(detail);
      expect(failure).toMatchObject({phase:"conversion",category:"unknown"});
      expect(failure?.evidenceId).toMatch(/^[a-f0-9-]{36}$/);
      const {DATA_DIR}=await import("../../runtime/src/core/config.js");
      const retained=await Bun.file(join(DATA_DIR,"diagnostics","model-failures",failure!.evidenceId+".json")).json();
      expect(retained.failure).toMatchObject({phase:"conversion",category:"unknown"});
      expect(retained.errors.error.message).toBeTypeOf("string");
      expect(records).not.toContain("PRIVATE_SYNTHETIC_CAPTURE_FAILURE");
      expect(records).not.toContain("owned synthetic codex terminal");
      expect(records).not.toContain("Files:");
      expect(getDb().query("SELECT * FROM extension_kv WHERE value LIKE '%openai-codex-images%' OR value LIKE '%image-fixture%'").all()).toHaveLength(0);
      expect(existsSync(join(workspace, ".pi/openai-codex-images"))).toBe(false);
      const bots = getDb().query("SELECT content FROM messages WHERE is_bot_message=1 AND chat_jid=?").all("web:default");
      expect(bots).toHaveLength(priorBotCount + 1);
      expect(JSON.stringify(bots)).toContain("Turn failed");
      expect(JSON.stringify(bots)).not.toContain("PRIVATE_SYNTHETIC_CAPTURE_FAILURE");
      await backend.stop();
      const closing = backend.close();
      const firstError = await closing.catch(error => error);
      expect(joined).toBe(1);
      expect(backend.close()).toBe(closing);
      expect(await backend.close().catch(error => error)).toBe(firstError);
      expect(joined).toBe(1);
      expect(getDb().query("SELECT * FROM budget_work WHERE id=?").get(reservations[0].work_id)).toEqual(workBefore);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify((getDb().query("SELECT * FROM budget_request_reservations").all() as any[]).filter(r => !priorReservations.has(r.id)))).toBe(before);
      backend = undefined;
      return;
    }
    if (fixtureError) throw fixtureError;
    expect(outcome).toBe("settled");
    expect(calls).toBe((scenario === "write" || scenario === "model") ? 2 : 1);
    const reservations = (getDb().query("SELECT * FROM budget_request_reservations").all() as any[]).filter(r => !priorReservations.has(r.id));
    expect(reservations).toHaveLength(calls);
    for (const reservation of reservations) {
      expect(reservation.state).toBe("settled");
      expect(reservation.provider_id).toBe(model.provider);
      expect([model.id, ...(scenario === "model" ? [alternate.id] : [])]).toContain(reservation.model_id);
      expect(reservation.account_ref).toBeTruthy();
      expect(reservation.settlement_sha256).toHaveLength(64);
      expect((getDb().query("SELECT status FROM budget_work WHERE id=?").get(reservation.work_id) as any).status).toBe("completed");
    }
    if (scenario === "write") {
      expect(readFileSync(join(workspace, "native-factory-proof.txt"), "utf8")).toBe("native write proof\n");
      expect(routingTokens).toEqual([null, "ROUTING_TOKEN_1"]);
      const firstOperation = getDb().query("SELECT operation_id FROM service_effect_s01_operations WHERE chat_jid=? ORDER BY primary_source_seq DESC LIMIT 1").get("web:default") as { operation_id: string };
      expect(routingRelease).toHaveBeenCalledWith(firstOperation.operation_id);
      const second = await admitWebUserMessage(channel, { chatJid: "web:default", content: "A new synthetic user turn", mediaIds: [], isBot: false, agentId: "default", agentName: "Fixture" }, { acceptSource: bound.getInputSourceAdmission!("web:default") }, () => owner.assertCurrentOwner(), new AbortController().signal);
      expect(second).not.toBeNull();
      const next = getDb().query("SELECT id FROM messages WHERE rowid=?").get(second!.id) as { id: string };
      expect(await bound.dispatchAcceptedInput!("web:default", next.id, second!.id)!()).toBe("settled");
      if (fixtureError) throw fixtureError;
      expect(routingTokens).toEqual([null, "ROUTING_TOKEN_1", null]);
      expect(calls).toBe(3);
      expect(JSON.stringify(getDb().query("SELECT record FROM entries").all())).not.toContain("ROUTING_TOKEN_");
      expect(JSON.stringify(getDb().query("SELECT content FROM document_revisions").all())).not.toContain("ROUTING_TOKEN_");
    } else if (scenario !== "model") {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const bots = getDb().query("SELECT content FROM messages WHERE is_bot_message=1 AND chat_jid=?").all("web:default") as {content:string}[];
      expect(bots).toHaveLength(priorBotCount + 1);
      expect(bots.at(-1)!.content).toContain("Files:\n- .pi/openai-codex-images/");
    }
    const position = backend.sessionOptions.getDurableSession!("web:default")!;
    if (scenario === "model") {
      expect(await position.readModel!()).toBe(model.provider + "/" + alternate.id);
      expect(await position.readThinkingLevel!()).toBe("off");
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    }
    const treeBefore = await position.readTree!();
    expect(JSON.stringify(treeBefore)).toContain("owned synthetic codex terminal");
    expect(JSON.stringify(treeBefore)).not.toContain("Files:");
    await backend.close(); backend = undefined;
    backend = await createDefaultApplicationRuntime(owner, async () => services as never);
    expect(calls).toBe(scenario === "write" ? 3 : scenario === "model" ? 2 : 1);
    const reopened = backend.sessionOptions.getDurableSession!("web:default")!;
    if (scenario === "model") {
      expect(await reopened.readModel!()).toBe(model.provider + "/" + alternate.id);
      expect(await reopened.readThinkingLevel!()).toBe("off");
    }
    const treeAfter = await reopened.readTree!();
    expect(treeAfter).toEqual(treeBefore);
    expect(runtime.getRegisteredNativeProvider(model.provider)).toBe(provider);
  } finally { fetchSpy.mockRestore(); try { await backend?.close(); } finally { routingRelease.mockRestore(); closeSpy.mockRestore(); owner.release(); closeDatabase(); } }
}, 60000);
