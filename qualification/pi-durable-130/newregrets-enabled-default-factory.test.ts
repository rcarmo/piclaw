import { handleAgentMessage } from "../../runtime/src/channels/web/handlers/agent.js";
import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import "./src/test-guard.js";
import { expect } from "bun:test";
const applicationTest = isolatedApplicationTest(import.meta.url);
import { cpSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";

import { createAssistantMessageEventStream } from "../../node_modules/@earendil-works/pi-ai";
import { createTestCredentialStore } from "../../runtime/test/model-services-fixture.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { createRuntimeBaseServices } from "../../runtime/src/runtime/composition.js";
import { WebChannel } from "../../runtime/src/channels/web.js";

import { ModelRuntime } from "../../node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import { createProvider, normalizeContext, type Model } from "../../node_modules/@earendil-works/pi-ai/dist/index.js";
import { streamSimple as sdkStreamSimple } from "../../node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js";
import { previewHostRequest } from "../../runtime/src/agent-pool/model-request-preview.ts";
import { getPiclawAgentDir } from "../../runtime/src/core/agent-dir.js";
import { getExtensionKvStore, withExtensionKvAuthority } from "../../runtime/src/extension-kv-registry.ts";

for(const mode of ['reported','unknown-price','report-fault'] as const)applicationTest(`enabled Regrets actual factory retains original usage without expense ownership or replay: ${mode}`, async () => {
  const workspace = process.env.PICLAW_WORKSPACE!;
  const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-late-night-regrets");
  cpSync(join(process.env.DURABLE_ADDONS_ROOT!, "addons/late-night-regrets"), pkg, { recursive: true, filter: p => !p.split("/").includes("node_modules") });
  symlinkSync(join(import.meta.dir, "../../node_modules"), join(pkg, "node_modules"));
  process.env.PICLAW_DB_IN_MEMORY = "0"; initDatabase();
  const database = getDb();
  database.query("INSERT INTO budget_work(id,chat_jid,execution_kind,status,created_at,updated_at) VALUES('historical-regrets','web:default','interactive','paused','2026-01-01','2026-01-01')").run();
  database.query("INSERT INTO budget_caps(id,scope,metric,amount,work_id,created_at,updated_at) VALUES('historical-zero','task','api_usd_micros',0,'historical-regrets','2026-01-01','2026-01-01')").run();
  database.query("INSERT INTO budget_request_reservations(id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,state,created_at,updated_at) VALUES('historical-unknown','historical-regrets','web:default','openai-codex','synthetic','original-account',?,'unresolved','2026-01-01','2026-01-01')").run('a'.repeat(64));
  const financialSnapshot = () => ['budget_work','budget_caps','budget_request_reservations','budget_usage_events'].map(table=>database.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const financialBefore = financialSnapshot();
  if(mode==='report-fault')database.exec("CREATE TEMP TRIGGER fail_regrets_report BEFORE INSERT ON token_usage BEGIN SELECT RAISE(ABORT,'synthetic passive Regrets report failure'); END");
  mkdirSync(getPiclawAgentDir(), { recursive: true });
  writeFileSync(join(getPiclawAgentDir(), "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic", refresh: "synthetic", accountId: "syntheticOnly", expires: Date.now()+60000 } }));
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "enabled-regrets.lock"), strictOwnership: true, disabled: false });
  const model: any = { provider: "openai-codex", id: "synthetic", name: "Synthetic", type: "chat", api: "openai-completions", baseUrl: "https://synthetic.invalid", input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 4096, cost: { input: mode==='unknown-price'?0:1, output: mode==='unknown-price'?0:1, cacheRead: mode==='unknown-price'?0:1, cacheWrite: mode==='unknown-price'?0:1 } };
  const root = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, credentials: { read: async () => undefined, get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] } as any });
  let mainCalls = 0, decisionCalls = 0, nativeToolResult = "", decisionWires = 0;
  const dispatchEvidence: any[] = [];
  let publicCompleteCalls = 0;
  const complete = root.completeSimple.bind(root);
  let decisionUsage: Awaited<ReturnType<typeof complete>>["usage"] | undefined;
  root.completeSimple = ((...args: any[]) => {
    publicCompleteCalls++;
    expect(args[0]).toMatchObject({ provider: "openai-codex", id: "synthetic" });
    expect(args[1].systemPrompt).toContain("Return only JSON:");
    expect(args[1].messages).toHaveLength(1);
    expect(args[1].messages[0].role).toBe("user");
    expect(args[2]).toMatchObject({ maxTokens: 1024, maxRetries: 0, timeoutMs: 60000 });
    return complete(...args as Parameters<typeof complete>).then(message => {
      decisionUsage = structuredClone(message.usage); return message;
    });
  }) as typeof root.completeSimple;
  const stream = (_model: any, context: any) => {
    const decision = context.messages.some((m: any) => m.role === "system" && typeof m.content === "string" && m.content.includes("Return only JSON:"));
    dispatchEvidence.push(getDb().query("SELECT r.*,w.parent_work_id,w.execution_kind FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE r.state='dispatched'").all());
    const tool = context.messages.findLast((m: any) => m.role === "toolResult");
    let content: any[];
    if (decision) {
      decisionCalls++;
      const packet = JSON.parse(context.messages.find((m: any) => m.role === "user").content);
      content = [{ type: "text", text: JSON.stringify({ decisions: packet.exchanges.map((e: any) => ({ rowid: e.rowid, choice: "review" })) }) }];
    } else {
      mainCalls++;
      const users = context.messages.filter((m: any) => m.role === "user");
      if (tool) nativeToolResult = JSON.stringify(tool);
      content = users.length < 2 || tool ? [{ type: "text", text: "Baseline complete" }] : [{ type: "toolCall", id: "enabled-regrets-call", name: "regrets_review", arguments: {} }];
    }
    const message: any = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content, stopReason: content[0].type === "toolCall" ? "toolUse" : "stop", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: mode==='unknown-price'?0:0.00001, output: mode==='unknown-price'?0:0.000005, cacheRead: 0, cacheWrite: 0, total: mode==='unknown-price'?0:0.000015 } } };
    const out = createAssistantMessageEventStream(); queueMicrotask(() => { out.push({ type: "done", reason: message.stopReason, message }); out.end(message); }); return out;
  };
  const native = createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: "synthetic", resolve: async () => ({ auth: { apiKey: "synthetic" }, source: "fixture" }) } }, api: {
    stream,
    streamSimple(owner, context, options) {
      if (!context.messages.some(m => m.role === "system" && typeof m.content === "string" && m.content.includes("Return only JSON:"))) return stream(owner, context);
      // Actual SDK output lowering, serialization and SSE parser; no provider network.
      expect(owner.api).toBe('openai-completions');
      return sdkStreamSimple(owner as Model<'openai-completions'>, context, { ...options, fetch: Object.assign(async (_url: RequestInfo | URL, init?: RequestInit) => {
        decisionWires++;
        const body = JSON.parse(String(init?.body));
        expect(body.max_tokens ?? body.max_completion_tokens).toBe(1024);
        const terminal = await stream(owner, context).result();
        const text = terminal.content.filter(c => c.type === "text").map(c => c.text).join("");
        const chunks = [{ id: "offline-regrets", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
          { id: "offline-regrets", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }];
        return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
      }, { preconnect() { throw Error('Fixture network preconnect forbidden'); } }) });
    },
  } });
  root.registerNativeProvider(native);
  const physical = root.getPhysicalModel(model.provider, model.id)!;
  const services: any = { modelRuntime: root, modelRegistry: { getAvailable: () => [physical] } };
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    withExtensionKvAuthority({ extensionId: "late-night-regrets", chatJid: "web:default", globalRead: true, globalWrite: true, assertCurrent: () => owner.assertCurrentOwner(), write: body => { owner.assertCurrentOwner(); return getDb().transaction(body)(); } }, () => getExtensionKvStore().set("late-night-regrets", "config", { enabled: true, decision_model: "openai-codex/synthetic", review_scope: "current" }, "global"));
    const base = createRuntimeBaseServices({ dataDir: workspace });
    const pool = new AgentPool({ credentialStore: createTestCredentialStore({}), modelRuntime: root, modelRegistry: services.modelRegistry, ...backend.sessionOptions } as any);
    const bound = backend.bind({ queue: base.queue, agentPool: pool });
    const channel = new WebChannel(bound);
    channel.queue.isLaneBusy=()=>{throw Error("Host lane must not govern native submission");};
    (channel as any).getQueuedFollowupCount=()=>{throw Error("Saved UI queue must not govern native submission");};
    (channel as any).getAcceptedQueuedSteering=()=>{throw Error("Host steering selection must not govern native submission");};
    pool.isActive=()=>true; pool.isStreaming=()=>false; // Reproduced stale host lifecycle window.
    let completed=0;
    for (const content of ["Please explain the baseline", "Please be concise. Review recent exchanges"]) {
      const request=new Request("https://fixture/agent/default/message",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content})});
      const response=await handleAgentMessage(channel,request,"/agent/default/message","web:default","default");
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({submission_id:expect.any(Number)});
      completed++;
      const until=Date.now()+4000;
      while((getDb().query("SELECT count(*) n FROM messages WHERE is_bot_message=1").get() as {n:number}).n<completed && Date.now()<until)await Bun.sleep(10);
      expect((getDb().query("SELECT count(*) n FROM messages WHERE is_bot_message=1").get() as {n:number}).n).toBe(completed);
    }
    expect([mainCalls, decisionCalls]).toEqual([3, 1]);
    expect(JSON.parse(nativeToolResult).details.decision).toMatchObject({ status: "complete", decisions: [{ rowid: 1, choice: "review" }, { rowid: 3, choice: "review" }] }); expect(nativeToolResult).not.toContain('"isError":true');
    const rows = getDb().query("SELECT * FROM budget_request_reservations ORDER BY rowid").all();
    const usage = getDb().query("SELECT * FROM budget_usage_events ORDER BY rowid").all() as any[];
    const work = getDb().query("SELECT * FROM budget_work ORDER BY rowid").all() as any[];
    expect(publicCompleteCalls).toBe(1);
    expect(decisionWires).toBe(1);
    // Custom native transports are honestly unknown; no extra preview/decorator layer.
    expect(await previewHostRequest(root, model, normalizeContext({ messages: [] }), {})).toEqual({ status: "unknown", reason: "unsupported" });
    const tokens = getDb().query("SELECT * FROM token_usage ORDER BY id").all() as any[];
    expect(tokens).toHaveLength(mode==='report-fault'?0:4);
    expect(decisionUsage?.totalTokens).toBe(15);
    const assistants=getDb().query("SELECT record FROM entries WHERE json_extract(record,'$.kind')='pi.assistant' ORDER BY id").all() as {record:string}[];
    expect(assistants.map(row=>JSON.parse(row.record).model[0].usage.totalTokens)).toEqual([15,15,15]);
    for (const [index, token] of tokens.entries()) expect(token).toMatchObject({ input_tokens: 10, output_tokens: 5, total_tokens: 15,
      // The real SDK sums input/output categories; retain its exact numeric evidence.
      cost_total: index === 2 ? decisionUsage!.cost.total : mode==='unknown-price'?0:0.000015,
      provider: "openai-codex", model: "synthetic", chat_jid: "web:default" });
    expect(financialSnapshot()).toEqual(financialBefore);
    expect(rows).toEqual(financialBefore[2]); expect(usage).toEqual([]);
    expect(work).toHaveLength(1);
    expect(dispatchEvidence).toEqual([[],[],[],[]]);
    const operations = getDb().query("SELECT * FROM service_effect_s01_operations ORDER BY rowid").all() as any[];
    const sources = getDb().query("SELECT * FROM service_effect_s01_sources ORDER BY rowid").all() as any[];
    expect(operations).toHaveLength(0); expect(sources).toHaveLength(2);
    expect(sources.every(source=>source.state==="consumed")).toBe(true);
    expect(sources.every(s => s.chat_jid === "web:default" && s.kind === "message")).toBe(true);
    const before = JSON.stringify({ rows, usage, work, tokens, messages: getDb().query("SELECT * FROM messages ORDER BY rowid").all(), sources: getDb().query("SELECT * FROM service_effect_s01_sources ORDER BY rowid").all(), operations: getDb().query("SELECT * FROM service_effect_s01_operations ORDER BY rowid").all() });
    await backend.close(); backend = await createDefaultApplicationRuntime(owner, async () => services);
    expect([mainCalls, decisionCalls, publicCompleteCalls]).toEqual([3, 1, 1]);
    expect(JSON.stringify({ rows: getDb().query("SELECT * FROM budget_request_reservations ORDER BY rowid").all(), usage: getDb().query("SELECT * FROM budget_usage_events ORDER BY rowid").all(), work: getDb().query("SELECT * FROM budget_work ORDER BY rowid").all(), tokens: getDb().query("SELECT * FROM token_usage ORDER BY id").all(), messages: getDb().query("SELECT * FROM messages ORDER BY rowid").all(), sources: getDb().query("SELECT * FROM service_effect_s01_sources ORDER BY rowid").all(), operations: getDb().query("SELECT * FROM service_effect_s01_operations ORDER BY rowid").all() })).toBe(before);
  } finally { await backend?.close(); owner.release(); await closeDatabase(); }
});
