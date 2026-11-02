import "./src/test-guard.js";
import { expect, test as bunTest } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Harness, createRegistry, defineExtension, defineTool, type Conversation, type TaskId, type GenerationHooks } from "../../runtime/durable-engine/qualification/durable.ts";
import { createModels, createProvider, estimateContextTokens, Type, type AssistantMessage, type Message, type Model } from "../../runtime/durable-engine/qualification/ai.ts";
import { AssistantMessageEventStream } from "../../runtime/durable-engine/qualification/event-stream.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { materializePlanContext, hostPlanContextKind, materializeGoalContext, hostGoalContextKind, withGoalSystemInstructions, type GoalContextIdentity } from "../../runtime/durable-engine/src/host-plan-context.js";
import { projectPublicHistory } from "../../runtime/durable-engine/src/session-tree.js";
import { context, barrier } from "./src/fixture.js";
import { awaitWithContext } from "../../runtime/durable-engine/qualification/context.ts";
// Match the public Root provider's normalization brand, not the private engine's.
import { normalizeContext as normalizeRootContext } from "../../node_modules/@earendil-works/pi-ai";
import { streamSimple as codexStream } from "@earendil-works/pi-ai/api/openai-codex-responses";

// These are isolated SQLite/harness integration cases; allow for the repository's
// background test priority and shared-host I/O without relaxing assertions.
const test = (name: string, body: () => Promise<void>, timeout = 30000) => bunTest(name, body, timeout);

const model: Model<"openai-completions"> = { id: "plan-context", provider: "plan-fixture", name: "Plan fixture",
  api: "openai-completions", baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false,
  contextWindow: 100000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const content = (plan: string) => [{ type: "text" as const, text: `Current Plan Sidebar checklist for web:plan:\n\n${plan || "(empty)"}` }];
const answer = (plan?: string, index = 0): AssistantMessage => ({ role: "assistant", api: model.api,
  provider: model.provider, model: model.id, timestamp: index + 1,
  content: plan === undefined ? [{ type: "text", text: "synthetic summary or answer" }] :
    [{ type: "toolCall", id: `change-${index}`, name: "change_plan", arguments: { markdown: plan } }],
  stopReason: plan === undefined ? "stop" : "toolUse", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

async function fixture(variant: {goal?:boolean; mixed?:boolean; identity?:()=>GoalContextIdentity; keepRecentTokens?:number;
  respond?:(messages:readonly Message[])=>Promise<AssistantMessage>} = {}) {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "plan-context-"));
  const requests: Message[][] = [], failures: unknown[] = [];
  const state = { plan: "- [ ] ORIGINAL", allowed: true, prepared: false, maintenance: false,
    replies: [] as string[], taskId: 0 as TaskId,
    afterPersist: undefined as ((ctx: Parameters<typeof materializePlanContext>[6]) => Promise<void>) | undefined,
    wrap: (conversation: Conversation) => conversation };
  const assertCurrent = () => { if (!state.allowed) throw Error("Plan source revoked"); };
  const registry = createRegistry();
  let harness: Harness, conversation: Conversation, database: BunSqliteDatabase;
  const handlers: Pick<GenerationHooks, "beforeRequest"> = { async beforeRequest(request, api, ctx) {
    state.prepared = false; state.taskId = api.taskId;
    try {
      const current = (await harness.conversation(api.conversationId, ctx))!;
      const messages = await database.withAdmissionGuard(assertCurrent, async () => {
        const identity = variant.identity?.() ?? {goalId:"goal-owned",generation:1,status:"active" as const};
        if (variant.mixed) {
          const goal = await materializeGoalContext(state.wrap(current), api.taskId, "web:plan", request.messages,
            [{type:"text",text:"Immutable Goal objective"}], identity, assertCurrent, ctx);
          return materializePlanContext(state.wrap(current), api.taskId, "web:plan", identity.systemPrompt
            ? [...withGoalSystemInstructions(goal, identity.systemPrompt, "web:plan", api.taskId)] : goal, content(state.plan), assertCurrent, ctx);
        }
        if (variant.goal) {
          const goal = await materializeGoalContext(state.wrap(current), api.taskId, "web:plan", request.messages, content(state.plan), identity, assertCurrent, ctx);
          return identity.systemPrompt ? withGoalSystemInstructions(goal, identity.systemPrompt, "web:plan", api.taskId) : goal;
        }
        return materializePlanContext(state.wrap(current), api.taskId, "web:plan", request.messages, content(state.plan), assertCurrent, ctx);
      });
      await state.afterPersist?.(ctx);
      state.prepared = true;
      return { messages };
    } catch (error) { failures.push(error); throw error; }
  } };
  const tool = defineTool({ name: "change_plan", description: "Fixture Plan update", callers: ["model"], replay: "unsafe",
    parameters: Type.Object({ markdown: Type.String() }), async execute(args) {
      state.plan = args.markdown; return { output: [{ type: "text", text: "Plan updated." }] };
    } });
  const extension = defineExtension({ name: "plan-fixture", tools: [tool], hooks: [{ task: "pi.generation", handlers }] });
  registry.install(extension);
  const models = createModels({ authContext: { env: async () => { throw Error("No ambient credentials"); },
    fileExists: async () => { throw Error("No ambient credentials"); } } });
  const stream = (_: unknown, request: { messages: readonly Message[] }) => {
    if (!state.maintenance && !state.prepared) throw Error("Plan dispatch was not prepared");
    state.prepared = false;
    requests.push(structuredClone([...request.messages]));
    const result = new AssistantMessageEventStream();
    if (variant.respond) {
      // Only detached message data crosses the Root/private SDK boundary.
      void variant.respond(request.messages).then(message => { result.push({ type: "error", reason: "error", error: message }); result.end(); }, error => {
        failures.push(error);
        const message: AssistantMessage = { ...answer(), stopReason: "error", errorMessage: String(error) };
        result.push({ type: "error", reason: "error", error: message }); result.end();
      });
      return result;
    }
    const message = answer(state.maintenance ? undefined : state.replies.shift(), requests.length);
    result.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }); result.end(); return result;
  };
  models.setProvider(createProvider({ id: model.provider, models: [model], api: { stream, streamSimple: stream },
    auth: { apiKey: { name: "Synthetic only", resolve: async () => ({ auth: {}, source: "fixture" }) } } }));
  const options = { models, registry, settings: { retry: { enabled: false }, compaction: { enabled: false, keepRecentTokens: variant.keepRecentTokens ?? 1 } } };
  const open = async () => {
    database = new BunSqliteDatabase(join(dir, "history.sqlite"));
    return Harness.open(await SqliteStorage.open(database), options, context);
  };
  harness = await open();
  conversation = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id },
    instructions: "Stable Plan fixture policy", extensions: [extension], tools: [tool] } });
  return { state, requests, failures, get harness() { return harness; }, get conversation() { return conversation; },
    async entries() { return (await conversation.entries({ order: "ascending" }, 1000, undefined, context)).items; },
    async submit(text: string, target = conversation) { return target.submit({ type: "input", content: [{ type: "text", text }] }, context); },
    async run(text = "continue", target = conversation) { return (await this.submit(text, target)).wait(context); },
    async reopen() { const id = conversation.id; await harness.close(context); harness = await open(); conversation = (await harness.conversation(id, context))!; },
    async close() { await harness.close(context); await rm(dir, { recursive: true, force: true }); } };
}
const snapshots = (rows: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["entries"]>>) => rows.filter(row => row.kind === hostPlanContextKind);
function prefix(before: readonly Message[], after: readonly Message[]) {
  expect(after.length).toBeGreaterThan(before.length);
  expect(JSON.stringify(after.slice(0, before.length))).toBe(JSON.stringify(before));
}

test("Plan changes after a tool append a snapshot without moving the previous request prefix", async () => {
  const f = await fixture();
  try {
    f.state.replies.push("- [-] UPDATED"); await f.run();
    expect(f.requests).toHaveLength(2); prefix(f.requests[0]!, f.requests[1]!);
    expect(snapshots(await f.entries())).toHaveLength(2);
    expect(JSON.stringify(f.requests[1])).toContain("ORIGINAL"); expect(JSON.stringify(f.requests[1])).toContain("UPDATED");
    expect(f.failures).toEqual([]);
  } finally { await f.close(); }
});

test("unchanged Plan is not duplicated over tool rounds or later accepted inputs", async () => {
  const f = await fixture();
  try {
    f.state.replies.push(f.state.plan, f.state.plan); await f.run(); await f.run("next user turn");
    expect(f.requests).toHaveLength(4);
    for (let i = 1; i < f.requests.length; i++) prefix(f.requests[i - 1]!, f.requests[i]!);
    expect(snapshots(await f.entries())).toHaveLength(1);
  } finally { await f.close(); }
});

test("A to B to A preserves each historical snapshot rather than deduplicating by old text", async () => {
  const f = await fixture();
  try {
    f.state.replies.push("- [x] B", f.state.plan); await f.run();
    expect(snapshots(await f.entries())).toHaveLength(3);
    for (let i = 1; i < 3; i++) prefix(f.requests[i - 1]!, f.requests[i]!);
  } finally { await f.close(); }
});

test("empty Plan becomes an explicit clearing snapshot and is deduplicated", async () => {
  const f = await fixture();
  try {
    f.state.replies.push("", ""); await f.run();
    expect(snapshots(await f.entries())).toHaveLength(2);
    expect(JSON.stringify(f.requests.at(-1))).toContain("(empty)");
    prefix(f.requests[0]!, f.requests[1]!); prefix(f.requests[1]!, f.requests[2]!);
  } finally { await f.close(); }
});

test("initially empty Plan has one stable snapshot until the checklist changes", async () => {
  const f = await fixture();
  try {
    f.state.plan = ""; await f.run(); await f.run(); expect(snapshots(await f.entries())).toHaveLength(1);
    f.state.plan = "- [ ] populated"; await f.run();
    prefix(f.requests[0]!, f.requests[1]!); prefix(f.requests[1]!, f.requests[2]!);
    expect(snapshots(await f.entries())).toHaveLength(2);
  } finally { await f.close(); }
});

test("reopen retains unchanged Plan position and immutable original entries", async () => {
  const f = await fixture();
  try {
    await f.run(); const original = snapshots(await f.entries())[0]!;
    await f.reopen(); await f.run("after reopen");
    expect(snapshots(await f.entries())).toEqual([original]); prefix(f.requests[0]!, f.requests[1]!);
  } finally { await f.close(); }
});

test("pre-dispatch interruption recovers the exact pinned suffix before appending a newer Plan", async () => {
  const f = await fixture(); const committed = barrier();
  try {
    f.state.afterPersist = async ctx => { committed.release(); await awaitWithContext(new Promise<void>(() => {}), ctx); };
    const submission = await f.submit("interrupted"); const waiting = submission.wait(context).catch(() => undefined);
    await committed.promise; const original = snapshots(await f.entries())[0]!;
    expect(f.requests).toHaveLength(0);
    f.state.afterPersist = undefined; f.state.plan = "- [-] changed offline";
    await f.reopen(); await waiting;
    const recovered = (await f.harness.submission(submission.id, context))!; await recovered.wait(context);
    expect(f.requests).toHaveLength(1);
    const entries = snapshots(await f.entries()); expect(entries).toHaveLength(2); expect(entries[0]).toEqual(original);
    const sent = JSON.stringify(f.requests[0]); expect(sent.indexOf("ORIGINAL")).toBeLessThan(sent.indexOf("changed offline"));
    await f.run(); expect(snapshots(await f.entries())).toEqual(entries);
  } finally { await f.close(); }
}, 10000);

test("forks inherit the historical snapshot without rewriting it or appending a duplicate", async () => {
  const f = await fixture();
  try {
    await f.run(); const entries = await f.entries(); const inherited = snapshots(entries)[0]!;
    const child = await f.conversation.fork(entries.at(-1)!.id, { ownership: { kind: "ownerless" } }, context);
    await f.run("fork input", child);
    const rows = (await child.entries({ order: "ascending" }, 100, undefined, context)).items;
    expect(snapshots(rows)).toEqual([inherited]); prefix(f.requests[0]!, f.requests[1]!);
    expect(snapshots(await f.entries())).toEqual([inherited]);
  } finally { await f.close(); }
});

test("independent native conversations do not share Plan deduplication state", async () => {
  const f = await fixture();
  try {
    await f.run(); const agent = await f.conversation.agent(context);
    const child = await f.harness.createConversation({ ownership: { kind: "ownerless" }, agent: {
      model: agent.model!, instructions: "other context", extensions: agent.extensions, tools: agent.tools } }, context);
    await f.run("other conversation", child);
    const main = snapshots(await f.entries());
    const other = snapshots((await child.entries({ order: "ascending" }, 100, undefined, context)).items);
    expect(main).toHaveLength(1); expect(other).toHaveLength(1); expect(main[0]!.id).not.toBe(other[0]!.id);
    expect(other[0]!.conversationId).toBe(child.id);
  } finally { await f.close(); }
});

for (const reset of [true, false]) test(`Plan rematerializes after ${reset ? "reset" : "actual compaction"} without consulting discarded snapshots`, async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 4; i++) await f.run(`history ${i}`);
    const original = snapshots(await f.entries())[0]!;
    if (reset) await f.conversation.reset("reset handoff", context);
    else {
      f.state.maintenance = true;
      const task = await f.conversation.compact(undefined, context);
      const result = await f.harness.waitForTask(task, context); f.state.maintenance = false;
      expect(result.state.outcome.status).toBe("completed");
      if (result.state.outcome.status === "completed") {
        const placed = (await f.harness.submission(result.state.outcome.result.submissionId!, context))!;
        expect((await placed.wait(context)).status).toBe("done");
      }
    }
    const view = await f.conversation.context(context); expect(view.entries.some(entry => entry.id === original.id)).toBe(false);
    await f.run("post boundary");
    const current = await f.conversation.context(context);
    expect(current.entries.filter(entry => entry.kind === hostPlanContextKind)).toHaveLength(1);
    expect(snapshots(await f.entries())[0]).toEqual(original);
    await f.run("same again"); prefix(f.requests.at(-2)!, f.requests.at(-1)!);
  } finally { await f.close(); }
});

test("source revocation after candidate append rolls back the snapshot at the SQL boundary", async () => {
  const f = await fixture();
  try {
    f.state.wrap = original => new Proxy(original, { get(target, key) {
      if (key === "commit") return (change: Parameters<Conversation["commit"]>[0], ctx: Parameters<Conversation["commit"]>[1]) =>
        original.commit(async tx => { const result = await change(tx); f.state.allowed = false; return result; }, ctx);
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(f.run()).rejects.toThrow("Session failed");
    expect(f.requests).toHaveLength(0);
    await f.reopen(); expect(snapshots(await f.entries())).toHaveLength(0);
    expect(String(f.failures[0])).toContain("Plan source revoked");
  } finally { await f.close(); }
});

test("an omitted snapshot is rematerialized from current Plan state without rewriting historical entries", async () => {
  const f = await fixture();
  try {
    await f.run(); const original = snapshots(await f.entries())[0]!;
    await f.conversation.commit(tx => tx.appendEntry(f.conversation.id, { kind: "test.context-edit",
      edits: [{ target: original.id, action: "omit" }] }), context);
    await f.run("after deliberate context edit"); await f.run("unchanged again");
    const rows = snapshots(await f.entries()); expect(rows).toHaveLength(2); expect(rows[0]).toEqual(original);
    expect(rows[1]!.model).toEqual(original.model); prefix(f.requests[1]!, f.requests[2]!);
  } finally { await f.close(); }
});

test("unknown or truncated request prefixes fail closed without a context write", async () => {
  const f = await fixture();
  try {
    await f.run(); const before = await f.entries();
    await expect(materializePlanContext(f.conversation, f.state.taskId, "web:plan", [], content("new"), () => {}, context))
      .rejects.toThrow("Unowned Plan request suffix");
    await expect(materializePlanContext(f.conversation, f.state.taskId, "web:plan", [{ role: "user", content: "forged", timestamp: 0 }],
      content("new"), () => {}, context)).rejects.toThrow("Unknown Plan request cutoff");
    expect(await f.entries()).toEqual(before);
  } finally { await f.close(); }
});

for (const goal of [false, true]) test(`${goal ? "Goal" : "Plan"}: actual Codex HTTP bodies retain an exact input-item prefix and stable instructions/tools/cache key`, async () => {
  const f = await fixture({goal});
  try {
    f.state.replies.push("- [-] UPDATED"); await f.run();
    const bodies: { input: unknown[]; instructions: unknown; tools: unknown; prompt_cache_key: unknown }[] = [];
    const transport = Object.assign(async (_url: unknown, init?: RequestInit) => {
      const raw = init?.body;
      let bytes: Uint8Array;
      if (typeof raw === "string") bytes = new TextEncoder().encode(raw);
      else if (raw instanceof Uint8Array) bytes = raw;
      else throw Error("Unexpected synthetic Codex body");
      if (new Headers(init?.headers).get("content-encoding") === "zstd") bytes = Bun.zstdDecompressSync(bytes);
      bodies.push(JSON.parse(new TextDecoder().decode(bytes)));
      return new Response('data: {"type":"response.completed","response":{"id":"plan-wire-fixture","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2,"input_tokens_details":{"cached_tokens":0}}}}\n\n',
        { headers: { "content-type": "text/event-stream" } });
    }, { preconnect() {} }) as typeof fetch;
    const jwt = "e30." + Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-only" } })).toString("base64url") + ".synthetic";
    for (const messages of f.requests) {
      const result = await codexStream({ ...model, provider: "openai-codex", api: "openai-codex-responses" }, normalizeRootContext({ messages }),
        { apiKey: jwt, fetch: transport, transport: "sse", sessionId: "plan-wire-fixture" }).result();
      expect(result.stopReason).toBe("stop");
    }
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1]!.input.slice(0, bodies[0]!.input.length))).toBe(JSON.stringify(bodies[0]!.input));
    for (const field of ["instructions", "tools", "prompt_cache_key"] as const) expect(bodies[1]![field]).toEqual(bodies[0]![field]);
    expect(JSON.stringify(bodies[1]!.input)).toContain("ORIGINAL");
    expect(JSON.stringify(bodies[1]!.input)).toContain("UPDATED");
  } finally { await f.close(); }
});

test("terminal generations cannot append Plan context and snapshots remain hidden from the existing tree", async () => {
  const f = await fixture();
  try {
    await f.run(); const rows = await f.entries(); const view = await f.conversation.context(context);
    await expect(materializePlanContext(f.conversation, f.state.taskId, "web:plan", view.messages, content("new"), () => {}, context))
      .rejects.toThrow("Exact live Plan generation required");
    expect(await f.entries()).toEqual(rows);
    const visible = projectPublicHistory(rows, null);
    expect(visible.some(node => node.entry.type === "message" && JSON.stringify(node.entry).includes("ORIGINAL"))).toBe(false);
    expect(visible.filter(node => node.entry.type === "message")).toHaveLength(2);
    const hidden = snapshots(rows)[0]!;
    expect(() => projectPublicHistory([{ ...hidden, data: { owner: "forged" } }], null)).toThrow("Invalid hidden Plan context");
  } finally { await f.close(); }
});

const goalSnapshots = (rows: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["entries"]>>) => rows.filter(row => row.kind === hostGoalContextKind);
test("Goal context preserves every prior implicit cache-write ending through tools and later input", async () => {
  const f = await fixture({goal:true});
  try {
    f.state.replies.push(f.state.plan, f.state.plan); await f.run(); await f.run("later accepted input");
    expect(f.requests).toHaveLength(4);
    for (let i=1;i<f.requests.length;i++) prefix(f.requests[i-1]!, f.requests[i]!);
    const rows=await f.entries(); expect(goalSnapshots(rows)).toHaveLength(1);
    expect(JSON.stringify(projectPublicHistory(rows, null))).not.toContain("Current Plan Sidebar");
    expect(f.failures).toEqual([]);
  } finally { await f.close(); }
});
test("Goal objective changes append new snapshots and survive reopen without duplicate context", async () => {
  const f = await fixture({goal:true});
  try {
    f.state.replies.push("Changed Goal objective", f.state.plan); await f.run();
    expect(goalSnapshots(await f.entries())).toHaveLength(3);
    await f.reopen(); await f.run("continue retained goal");
    expect(goalSnapshots(await f.entries())).toHaveLength(3);
    for (let i=1;i<f.requests.length;i++) prefix(f.requests[i-1]!, f.requests[i]!);
    expect(f.failures).toEqual([]);
  } finally { await f.close(); }
});
test("Goal identity changes append even when prompt bytes are identical", async () => {
  let identity: GoalContextIdentity={goalId:"original",generation:1,status:"active"};
  const f = await fixture({goal:true,identity:()=>identity});
  try {
    await f.run(); identity={goalId:"replacement",generation:2,status:"active"}; await f.run("new Goal generation");
    identity={...identity,status:"budget_limited"}; await f.run("budget wrap-up");
    const rows=goalSnapshots(await f.entries()); expect(rows).toHaveLength(3);
    expect(rows.map(row=>(row.data as GoalContextIdentity).goalId)).toEqual(["original","replacement","replacement"]);
    expect(rows.map(row=>(row.data as GoalContextIdentity).status)).toEqual(["active","active","budget_limited"]);
    for(let i=1;i<f.requests.length;i++)prefix(f.requests[i-1]!,f.requests[i]!);
  } finally { await f.close(); }
});
test("Goal and Plan repair only their shared owned pinned suffix and retain distinct historical positions", async () => {
  const f = await fixture({mixed:true});
  try {
    f.state.replies.push("Changed Plan", "Changed Plan"); await f.run(); await f.reopen(); await f.run("next user");
    expect(goalSnapshots(await f.entries())).toHaveLength(1); expect(snapshots(await f.entries())).toHaveLength(2);
    for(let i=1;i<f.requests.length;i++)prefix(f.requests[i-1]!,f.requests[i]!);
    expect(f.failures).toEqual([]);
  } finally { await f.close(); }
});
test("revoked Goal context authority cannot dispatch or write a snapshot", async () => {
  const f=await fixture({goal:true});
  try {
    f.state.allowed=false; const before=(await f.entries()).length; await f.run();
    expect(f.requests).toHaveLength(0); expect((await f.entries()).filter(row=>row.kind===hostGoalContextKind)).toHaveLength(0);
    expect((await f.entries()).length).toBeGreaterThanOrEqual(before); expect(f.failures.length).toBeGreaterThan(0);
  } finally {await f.close();}
});
test("invalid Goal identity fails closed and rolls back the context append", async () => {
  const f=await fixture({goal:true,identity:()=>({goalId:"",generation:0,status:"active"})});
  try {await f.run();expect(f.requests).toHaveLength(0);expect(goalSnapshots(await f.entries())).toHaveLength(0);expect(f.failures.length).toBeGreaterThan(0);}
  finally {await f.close();}
});

for(const malformed of [["active"],["budget_limited"],{},0,null]) test(`Goal status validator rejects malformed ${JSON.stringify(malformed)} rather than coercing it`,async()=>{
  const f=await fixture({goal:true});
  try {await f.run();const row=structuredClone(goalSnapshots(await f.entries())[0]!);(row.data as Record<string,unknown>).status=malformed;
    expect(()=>projectPublicHistory([row],null)).toThrow("Invalid hidden Goal identity");}
  finally {await f.close();}
});

// The request-local rules footer is intentionally not durable history.
const composedPrefix = (a: readonly Message[], b: readonly Message[]) => prefix(
  a.filter(m => m.role !== "system" || m.content !== "Trusted Goal rules"),
  b.filter(m => m.role !== "system" || m.content !== "Trusted Goal rules"));
const canonicalGoalIdentity = () => ({ goalId: "canonical-goal", generation: 1,
  status: "active" as const, systemPrompt: "Trusted Goal rules", inputKey: "fixed-input" });
const authorityRecords = (entries: readonly any[]) => entries.filter(entry => entry.kind === "host.goal-system-authority");

test("canonical Goal rules survive Plan preparation, later generations and reopen without authority records", async () => {
  const f = await fixture({ mixed: true, identity: canonicalGoalIdentity });
  try {
    for (let i = 0; i < 3; i++) await f.run(`history ${i}`);
    const entries = await f.entries();
    expect(authorityRecords(entries)).toEqual([]);
    const goal = entries.filter(entry => entry.kind === hostGoalContextKind);
    expect(goal).toHaveLength(1);
    expect(goal[0]!.model?.map(message => message.role)).toEqual(["user"]);
    for (const request of f.requests) {
      expect(request.filter(message => message.role === "system" && message.content === "Trusted Goal rules")).toHaveLength(1);
      expect(JSON.stringify(request)).toContain("Immutable Goal objective");
      expect(JSON.stringify(request)).toContain(f.state.plan);
    }
    composedPrefix(f.requests[0]!, f.requests[1]!); composedPrefix(f.requests[1]!, f.requests[2]!);
    expect(JSON.stringify(projectPublicHistory(entries, null))).not.toContain("Trusted Goal rules");
    await f.reopen(); await f.run("after reopen");
    expect((await f.entries()).filter(entry => entry.kind === hostGoalContextKind)).toHaveLength(1);
    expect(authorityRecords(await f.entries())).toEqual([]);
    composedPrefix(f.requests[2]!, f.requests[3]!);
  } finally { await f.close(); }
});

test("canonical Goal rules rematerialize after actual SDK compaction without an authority lookup", async () => {
  const f = await fixture({ goal: true, keepRecentTokens: 128, identity: canonicalGoalIdentity });
  try {
    for (let i = 0; i < 4; i++) await f.run(`history ${i}` + (i === 1 ? " old history".repeat(1000) : ""));
    const original = (await f.entries()).find(entry => entry.kind === hostGoalContextKind)!;
    f.state.maintenance = true;
    const task = await f.conversation.compact(undefined, context);
    const result = await f.harness.waitForTask(task, context);
    expect(result.state.outcome.status).toBe("completed");
    if (result.state.outcome.status === "completed") {
      const placed = (await f.harness.submission(result.state.outcome.result.submissionId!, context))!;
      expect((await placed.wait(context)).status).toBe("done");
    }
    f.state.maintenance = false;
    expect((await f.conversation.context(context)).entries.some(entry => entry.id === original.id)).toBe(false);
    await f.run("after compaction");
    expect(f.requests.at(-1)!.filter(message => message.role === "system" && message.content === "Trusted Goal rules")).toHaveLength(1);
    expect(authorityRecords(await f.entries())).toEqual([]);
    expect((await f.entries()).find(entry => entry.id === original.id)).toEqual(original);
    await f.run("same again"); composedPrefix(f.requests.at(-2)!, f.requests.at(-1)!);
  } finally { await f.close(); }
});

test("retained orphaned legacy authority records are inert and do not block input preparation", async () => {
  const f = await fixture({ mixed: true, identity: canonicalGoalIdentity });
  try {
    await f.conversation.commit(tx => tx.appendEntry(f.conversation.id, {
      kind: "host.goal-system-authority", data: { goalContextEntryId: 999999 }, model: [],
    }), context);
    const legacy = (await f.entries()).find(entry => entry.kind === "host.goal-system-authority")!;
    await f.run("ordinary input"); await f.run("another input");
    expect(authorityRecords(await f.entries())).toEqual([legacy]);
    expect(JSON.stringify(projectPublicHistory(await f.entries(), null))).not.toContain("goalContextEntryId");
    expect(f.requests).toHaveLength(2); composedPrefix(f.requests[0]!, f.requests[1]!);
  } finally { await f.close(); }
});

test("legacy Goal snapshots are reused unchanged without rewriting history or creating authority records", async () => {
  const f = await fixture({ goal: true, identity: canonicalGoalIdentity });
  try {
    await f.conversation.commit(tx => tx.appendEntry(f.conversation.id, {
      kind: hostGoalContextKind, data: { owner: "host:goal-prompt", chatJid: "web:plan", taskId: 12, ...canonicalGoalIdentity() },
      model: [{ role: "user", content: [{ type: "text", text: "Frozen legacy continuation" }], timestamp: 0 }],
    }), context);
    const legacy = (await f.entries()).find(entry => entry.kind === hostGoalContextKind)!;
    await f.run("upgrade"); await f.run("reuse");
    const entries = await f.entries();
    expect(entries.find(entry => entry.id === legacy.id)).toEqual(legacy);
    expect(entries.filter(entry => entry.kind === hostGoalContextKind)).toHaveLength(1);
    expect(authorityRecords(entries)).toEqual([]);
    for (const request of f.requests) expect(request.filter(message => message.role === "system" && message.content === "Trusted Goal rules")).toHaveLength(1);
    composedPrefix(f.requests[0]!, f.requests[1]!);
  } finally { await f.close(); }
});

test("request-local Goal instructions survive shallow copies but reject forged, duplicate and foreign messages", async () => {
  const model: Message[] = [{ role: "user", content: [{ type: "text", text: "Current Plan" }], timestamp: 0 }];
  const plan: any = { id: 10, kind: hostPlanContextKind, model,
    data: { owner: "host:plan-prompt", chatJid: "web:plan", taskId: 13 } };
  const view: any = { messages: model, entries: [plan], contributions: [model] };
  const conversation: any = { id: 1, context: async () => view,
    entries: async () => { throw Error("No historical lookup is permitted"); },
    commit: async (change: any) => change({
      task: async () => ({ kind: "pi.generation", conversationId: 1, state: { status: "running" } }),
      doc: async () => ({ run: { taskId: 13 } }), scanEntries: async () => ({ items: [plan] }),
      appendEntry: async () => { throw Error("No duplicate snapshot is permitted"); },
    }),
  };
  const owned = withGoalSystemInstructions(model, "Trusted Goal rules", "web:plan", 13);
  expect(Object.isFrozen(owned.at(-1))).toBe(true);
  const result = await materializePlanContext(conversation, 13 as TaskId, "web:plan", [...owned],
    [{ type: "text", text: "Current Plan" }], () => {}, context);
  expect(result).toEqual(owned); expect(result.at(-1)).toBe(owned.at(-1));
  for (const request of [JSON.parse(JSON.stringify(owned)), [...owned, owned.at(-1)!],
    withGoalSystemInstructions(model, "Trusted Goal rules", "web:other", 13),
    withGoalSystemInstructions(model, "Trusted Goal rules", "web:plan", 14)]) {
    await expect(materializePlanContext(conversation, 13 as TaskId, "web:plan", request,
      [{ type: "text", text: "Current Plan" }], () => {}, context)).rejects.toThrow("Unknown Plan request cutoff");
  }
});

for (const goal of [false, true]) test(`${goal ? 'Goal' : 'Plan'} hook overflow: real SDK rejection settles accepted input once and survives reopen without replay`, async () => {
  let wires = 0;
  const jwt = 'e30.' + Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-only' } })).toString('base64url') + '.synthetic';
  const f = await fixture({ goal, async respond(messages) {
    expect(estimateContextTokens(messages).tokens).toBeGreaterThan(model.contextWindow);
    const transport = Object.assign(async (_url: unknown, init?: RequestInit) => {
      let bytes = typeof init?.body === 'string' ? new TextEncoder().encode(init.body) : init?.body as Uint8Array;
      if (new Headers(init?.headers).get('content-encoding') === 'zstd') bytes = Bun.zstdDecompressSync(bytes);
      const body = JSON.parse(new TextDecoder().decode(bytes));
      expect(JSON.stringify(body.input)).toContain('OVERFLOW-PROMPT');
      wires++;
      return new Response(JSON.stringify({ error: { message: 'context_length_exceeded', code: 'context_length_exceeded' } }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }, { preconnect() {} }) as typeof fetch;
    const response = await codexStream({ ...model, provider: 'openai-codex', api: 'openai-codex-responses' },
      normalizeRootContext({ messages: structuredClone([...messages]) }),
      { apiKey: jwt, fetch: transport, transport: 'sse', maxRetries: 0 }).result();
    expect(response.stopReason).toBe('error');
    expect(response.errorMessage).toContain('context_length_exceeded');
    return { ...structuredClone(response), api: model.api, provider: model.provider };
  } });
  try {
    f.state.plan = 'OVERFLOW-PROMPT ' + 'x'.repeat(400000);
    const submission = await f.submit('Accepted input must remain terminal');
    const terminal = await submission.wait(context);
    expect(terminal).toMatchObject({ status: 'unanswered', reason: 'model_error' });
    expect(wires).toBe(1); expect(f.requests).toHaveLength(1);
    const rows = await f.entries();
    expect(rows.filter(row => row.kind === (goal ? hostGoalContextKind : hostPlanContextKind))).toHaveLength(1);
    expect(rows.flatMap(row => row.model ?? []).filter(message => message.role === 'assistant')).toHaveLength(1);
    expect(JSON.stringify(rows)).toContain('Accepted input must remain terminal');
    await f.reopen();
    const retained = (await f.harness.submission(submission.id, context))!;
    expect(await retained.wait(context)).toEqual(terminal);
    expect(await f.entries()).toEqual(rows);
    expect(wires).toBe(1); expect(f.requests).toHaveLength(1);
    expect(f.failures).toEqual([]);
  } finally { await f.close(); }
});

test('a rejected Root fixture producer settles its private stream and retains the original failure', async () => {
  const failure = Error('Root adapter fixture failed');
  const f = await fixture({ async respond() { throw failure; } });
  try {
    expect(await f.run()).toMatchObject({ status: 'unanswered', reason: 'model_error' });
    expect(f.failures).toEqual([failure]);
    expect(f.requests).toHaveLength(1);
  } finally { await f.close(); }
});
