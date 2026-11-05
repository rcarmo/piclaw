import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import "./src/test-guard.js";
import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { storeMessageInDatabase } from "../../runtime/src/db/messages.js";
import { storeChatMetadata } from "../../runtime/src/db.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { createProvider, getCurrentTools, type AssistantMessage, type TranscriptContext } from "../../runtime/durable-engine/qualification/ai.ts";
import { AssistantMessageEventStream } from "../../runtime/durable-engine/qualification/event-stream.ts";
import { createRegistry, defineExtension } from "../../runtime/durable-engine/qualification/durable.ts";
import { applicationOwnership, createApplicationBootstrapBundle } from "../../runtime/durable-engine/src/application-bootstrap.js";
import { createHostProcessControls } from "../../runtime/durable-engine/src/host-process-controls.js";
import { nativeExitNotice } from "../../runtime/durable-engine/src/host-process-receipt.js";
import type { HostConversationRuntime } from "../../runtime/durable-engine/src/host-runtime.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { admitWebMessage } from "../../runtime/src/channels/web/messaging/message-store.js";
import { InMemoryEffectPayloadResolver } from "../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";
import { openFixture, context } from "./src/fixture.js";

const applicationTest = isolatedApplicationTest(import.meta.url);
for (const scenario of ["success", "siblings", "materialization-recovery", "altered-result"] as const) {
  applicationTest(`native exit: ${scenario} uses SDK termination and actual timeline publication without host settlement`, async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "process-exit-"));
    const owner = acquireRuntimeLock({ lockPath: join(dir, "owner.lock"), strictOwnership: true, disabled: false });
    process.env.PICLAW_DB_IN_MEMORY = "0"; initDatabase();
    const root = getDb(); root.exec("PRAGMA foreign_keys=ON");
    const path = (root.query("PRAGMA database_list").all() as any[]).find(row => row.name === "main")!.file;
    const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => owner.assertCurrentOwner() })));
    let calls = 0, effects = 0, closes = 0, failMaterialization = scenario === "materialization-recovery";
    const deferred: (() => Promise<void>)[] = [], shutdowns: string[] = [];
    const reason = "qualified native installation";
    const model = { provider: "qualification", id: "synthetic", name: "Synthetic", api: "openai-completions" as const,
      baseUrl: "https://invalid.invalid", reasoning: false, input: ["text" as const], contextWindow: 100000, maxTokens: 100,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const advertised: ReturnType<typeof getCurrentTools> = [];
    const stream = (_model: unknown, request: TranscriptContext) => {
      const exit = getCurrentTools(request.messages).find(tool => tool.name === "exit_process");
      if (exit) advertised.push(exit);
      calls++;
      const output = new AssistantMessageEventStream();
      const first = calls === 1;
      const message: AssistantMessage = { role: "assistant" as const, api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: first ? "toolUse" as const : "stop" as const,
        content: first ? [{ type: "toolCall" as const, id: "exit", name: "exit_process", arguments: { reason } },
          ...(scenario === "siblings" ? [{ type: "toolCall" as const, id: "sibling", name: "host_effect", arguments: { value: "one" } }] : [])]
          : [{ type: "text" as const, text: "Exit refused; sibling finished normally" }] };
      if (calls > (scenario === "siblings" ? 2 : 1)) throw Error("Unexpected post-exit provider request");
      output.push({ type: "done", reason: first ? "toolUse" : "stop", message }); output.end(message); return output;
    };
    base.models.setProvider(createProvider({ id: model.provider, models: [model],
      auth: { apiKey: { name: "Synthetic keyless", resolve: async () => ({ auth: {}, source: "synthetic" }) } },
      api: { stream, streamSimple: stream } }));
    const chat = "web:native-exit", session = "native-session";
    storeChatMetadata(chat, new Date().toISOString());
    const branchId = (root.query("SELECT branch_id FROM chat_branches WHERE chat_jid=?").get(chat) as any).branch_id;
    let bundle: Awaited<ReturnType<typeof createApplicationBootstrapBundle>>;
    let controls: ReturnType<typeof createHostProcessControls>;
    let controlRuntime: HostConversationRuntime;
    const resolver = new InMemoryEffectPayloadResolver();
    const boot = async (initial = false) => {
      controls = createHostProcessControls({ root, runtime: () => controlRuntime, assertOwner: () => owner.assertCurrentOwner(),
        defer(run) { deferred.push(run); }, requestShutdown(value) { shutdowns.push(value); },
        async closeNative() { closes++; await bundle.close(); } });
      const registry = createRegistry();
      registry.install(defineExtension({ name: "process-test", tools: [...controls.tools,
        { name: "host_effect", description: "Synthetic sibling", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } as any,
          async execute() { effects++; return { output: [{ type: "text" as const, text: "sibling completed" }] }; } }],
        hooks: [...controls.extension.hooks!, ...(scenario === "altered-result" ? [{ task: "pi.tool", handlers: {
          afterTool(_call: unknown, result: any) { return { ...result, output: [{ type: "text", text: "FORGED_NOTICE" }] }; },
        } }] : [])] }));
      let conversationId: number;
      if (initial) {
        const extension = registry.snapshot().extension("process-test")!;
        base.registry.install(extension);
        const conversation = await base.harness.createConversation({ ownership: { kind: "ownerless" }, agent: {
          model: { provider: model.provider, modelId: model.id }, tools: extension.tools!, extensions: [extension] } }, context);
        conversationId = conversation.id;
        await base.close(); installTerminalSettlementCompositionSchema(root);
      } else conversationId = (root.query("SELECT conversation_id FROM piclaw_durable_bindings_v1 LIMIT 1").get() as any).conversation_id;
      bundle = await createApplicationBootstrapBundle({ root, path, ownership: applicationOwnership(owner),
        manifest: [{ chatJid: chat, branchId, conversationId: conversationId as any }], sessions: new Map([[chat, session]]), offlineInitialize: true,
        assertAdmission: input => controls.assertAdmission(input), assertInputAdmission() { controls.assertAdmission(); },
        answers: { put(ref, text) { if (failMaterialization) throw Error("synthetic answer storage failure"); resolver.putText(ref, text); }, resolver },
        onRuntime(value) { controlRuntime = value; },
        async onMessageResult(input,result){
          if(failMaterialization)throw Error("synthetic publication failure");
          if(!result.answer?.text.trim())return;
          const id=`native-answer:${result.runId}`;
          let row=(root.query("SELECT rowid FROM messages WHERE id=? AND chat_jid=?").get(id,chat) as {rowid:number}|null)?.rowid;
          if(!row)row=storeMessageInDatabase(root,{id,chat_jid:chat,sender:"assistant",sender_name:"Fixture",content:result.answer.text,timestamp:new Date().toISOString(),is_from_me:true,is_bot_message:true,is_terminal_agent_reply:true,thread_id:Number(result.inputs[0]!.payloadRef.slice(12))});
          controls.onMessagePublished(input,row,result.answer.processExit);
        },
        runtime: { incarnation: "native-process-test", sessionId: "runtime",
          now: () => new Date().toISOString(), harnessOptions: { models: base.models, registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } } },
      }, context);
    };
    try {
      await boot(true);
      const bound = bundle!.bind({ queue: {} as any, agentPool: {} as any });
      const stored = await admitWebMessage({ pendingLinkPreviews: new Set<number>(), broadcastEvent() {} },
        { chatJid: chat, content: "Request the approved restart", isBot: false, mediaIds: [], agentId: "default", agentName: "Fixture" },
        { acceptSource: bound.getInputSourceAdmission!(chat) }, () => owner.assertCurrentOwner(), new AbortController().signal);
      expect(stored).not.toBeNull();
      const message = root.query("SELECT rowid,id FROM messages WHERE chat_jid=? AND is_bot_message=0").get(chat) as any;
      const ack=await bundle!.dispatchAcceptedInput(chat,message.id,message.rowid);
      expect(ack.submission_id).toBeGreaterThan(0);
      const idle=async()=>{const deadline=Date.now()+5000;while(Date.now()<deadline){if(!(root.query("SELECT 1 FROM tasks WHERE status<>'terminal' LIMIT 1").get())){await Bun.sleep(30);return;}await Bun.sleep(10);}throw Error("SDK process round did not settle");};
      await idle();
      expect(advertised).toHaveLength(calls);expect(advertised.length).toBeGreaterThan(0);
      for(const tool of advertised){const schema=JSON.parse(JSON.stringify(tool.parameters));expect(Object.keys(schema.properties)).toEqual(["reason"]);expect(schema.required).toEqual(["reason"]);}
      if(scenario==="altered-result"){
        expect(root.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toEqual([]);
        expect(controls!.pending()).toBe(false);expect(deferred).toHaveLength(0);expect(shutdowns).toHaveLength(0);
        expect(root.query("SELECT * FROM service_effect_s01_operations").all()).toEqual([]);
        expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toEqual([]);expect(calls).toBe(1);return;
      }
      if(scenario==="materialization-recovery"){
        expect(root.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toEqual([]);expect(calls).toBe(1);expect(deferred).toHaveLength(0);
        await bundle!.close();failMaterialization=false;await boot();
        const again=await bundle!.dispatchAcceptedInput(chat,message.id,message.rowid);expect(again.submission_id).toBe(ack.submission_id);await idle();
        expect(deferred).toHaveLength(0);expect(shutdowns).toHaveLength(0);expect(calls).toBe(1);
      }
      const posts = root.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(chat);
      expect(posts).toEqual([{ content: scenario === "siblings" ? "Exit refused; sibling finished normally" : nativeExitNotice(reason) }]);
      expect(root.query("SELECT * FROM service_effect_s01_operations").all()).toEqual([]);
      expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toEqual([]);
      expect(calls).toBe(scenario === "siblings" ? 2 : 1);
      expect(effects).toBe(scenario === "siblings" ? 1 : 0);
      if (scenario === "success") {
        expect(deferred).toHaveLength(1); expect(shutdowns).toHaveLength(0); expect(closes).toBe(0);
        expect(() => bundle!.admitHostFollowup({ sourceId: "late", chatJid: chat, text: "late work", queuedAt: new Date().toISOString() })).toThrow("admission is sealed");
        await deferred[0]!();
        expect(shutdowns).toEqual([reason]); expect(closes).toBe(1);
      } else { expect(deferred).toHaveLength(0); expect(shutdowns).toHaveLength(0); }
      expect(root.query("SELECT id FROM tasks WHERE status<>'terminal'").all()).toEqual([]);
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id=?").get(message.id)).toEqual({ state: "consumed" });
    } finally {
      await bundle!?.close(); await closeDatabase(); owner.release(); await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
}
