import { repoRoot } from "./src/repo-root.js";
import { UsageDoc, defineTask } from "../../runtime/durable-engine/qualification/durable.ts";
import "./src/test-guard.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { getDeferredQueuedFollowups, storeChatMetadata } from "../../runtime/src/db.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { applicationOwnership, createApplicationBootstrapBundle } from "../../runtime/durable-engine/src/application-bootstrap.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { openFixture, context } from "./src/fixture.js";

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { qualifyNativeResources, qualifyNativeResourceSource, createRootDashboardReader } from "../../runtime/durable-engine/src/host-addon-resources";
const addons = resolve(repoRoot("ADDONS"), "addons");
const names = ["diagram-tools", "export-timeline-pdf", "kanban-editor", "yolo-vibe", "mindmap", "web-viewer", "eml-viewer", "session-dashboard"];
test("all eight resource descriptors preserve installed web/skill contracts", async () => {
  for (const name of names) {
    const { nativeResources } = await import(`${addons}/${name}/native-resources.ts`);
    const proof = qualifyNativeResources(name, nativeResources);
    const qualified = await qualifyNativeResourceSource(name, new URL(`file://${addons}/${name}/native-resources.ts`));
    expect(qualified.moduleUrl).toContain(name);
    const pkg = await Bun.file(`${addons}/${name}/package.json`).json();
    expect([...proof.webEntries]).toEqual(pkg.pi.web?.entries || []);
    for (const file of [...proof.webEntries, ...proof.skillPaths]) expect(await Bun.file(`${addons}/${name}/${file}`).exists()).toBe(true);
    expect(() => qualifyNativeResources("wrong", nativeResources)).toThrow();
  }
});
test("owned application Root dashboard projects native routes, timeline and usage without IO", async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "host-input-"));
  const lock = acquireRuntimeLock({ lockPath: join(dir, "owner.lock"), strictOwnership: true, disabled: false });
  process.env.PICLAW_DB_IN_MEMORY = "0";
  initDatabase();
  const root = getDb(); root.exec("PRAGMA foreign_keys=ON");
  const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(r => r.name === "main")!.file;
  const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => lock.assertCurrentOwner() })));
  const chat = `web:host-input:${crypto.randomUUID()}`;
  storeChatMetadata(chat, new Date().toISOString());
  const branchId = (root.query("SELECT branch_id FROM chat_branches WHERE chat_jid=?").get(chat) as { branch_id: string }).branch_id;
  const conversation = await base.harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: { provider: "qualification", modelId: "synthetic" } } }, context);
  const pending = defineTask<null, { phase: "hold" }, null>({ name: "dashboard-proof", version: 1,
    initial: () => ({ phase: "hold" }), phases: { hold: async () => { throw Error("Observer must not drive tasks"); } },
    abort: async () => { throw Error("Observer must not abort tasks"); } });
  let pendingId: number;
  await base.root.commit(async tx => {
    const usage = await tx.doc(UsageDoc, conversation.id);
    usage.models["qualification/synthetic"] = { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 } };
  }, context);
  await base.close(); installTerminalSettlementCompositionSchema(root);
  const bundle = await createApplicationBootstrapBundle({ root, path, ownership: applicationOwnership(lock),
    manifest: [{ chatJid: chat, branchId, conversationId: conversation.id }], sessions: new Map([[chat, "real-session"]]),
    offlineInitialize: true, answers: { put() {}, resolver: { async resolve() { return null; } } },
    async createConversation(tx, chatJid, branchId) {
      const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
      return { chatJid, branchId, conversationId: c.id, sessionId: "new-real-session" };
    },
    runtime: { incarnation: "host-input-domain", sessionId: "runtime", lane: "main", generation: 1,
      now: () => new Date().toISOString(), harnessOptions: { models: base.models, registry: base.registry } },
  }, context);
  let current = true, visible = true, disposals = 0;
  const scope = { ownerId: "fixture-owner", authScope: "fixture-auth" };
  try {
    const ports = bundle.bind({ queue: {} as any, agentPool: {} as any });
    const second = chat + ":second"; storeChatMetadata(second, "2026-10-19T00:00:00Z");
    await ports.prepareInputSourceAdmission!(second);
    const writer = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => lock.assertCurrentOwner() })));
    try { await writer.root.commit(async tx => {
      await tx.retireDoc(UsageDoc, bundle.sessionTargets.list().find(t => t.chatJid === second)!.conversationId as any);
      pendingId = await tx.createTask(pending, null, { conversationId: conversation.id, ownership: { kind: "conversation" } });
    }, context); } finally { await writer.close(); }
    root.query(`INSERT INTO messages(id,chat_jid,sender,content,timestamp,is_bot_message) VALUES (?,?,?,?,?,?)`).run("dashboard-user", chat, "user", "Question", "2026-10-19T01:00:00Z", 0);
    root.query(`INSERT INTO messages(id,chat_jid,sender,content,timestamp,is_bot_message,content_blocks) VALUES (?,?,?,?,?,?,?)`).run("dashboard-answer", chat, "assistant", "", "2026-10-19T01:01:00Z", 1, JSON.stringify([{ type: "TextBlock", text: "Actual Root output" }]));
    const reader = createRootDashboardReader({ root, scope, isCurrent: () => { lock.assertCurrentOwner(); return current; },
      sessionTargets: () => bundle.sessionTargets, canReadTarget: () => visible });
    await expect(reader.read({ ...scope, ownerId: "wrong", limit: 8 })).rejects.toThrow();
    await expect(reader.read({ ...scope, limit: 13 })).rejects.toThrow();
    const before = root.query("SELECT total_changes() AS n").get();
    const source = await qualifyNativeResourceSource("session-dashboard", new URL(`file://${addons}/session-dashboard/native-resources.ts`));
    let get: any;
    const binding = { scope, reader, isCurrent: () => current,
      authorize: (req: Request) => req.headers.get("authorization") === "fixture",
      register: (id: string, action: string, handlers: any) => {
        expect(id).toBe("session-dashboard"); expect(action).toBe("sessions"); get = handlers.get;
        return () => { disposals++; };
      } };
    const dispose = source.factory(binding);
    expect(() => source.factory(binding)).toThrow("already bound");
    await expect(get({}, new Request("https://fixture/sessions"))).rejects.toThrow();
    const req = new Request("https://fixture/sessions", { headers: { authorization: "fixture" } });
    const result = await get({}, req);
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0]).toMatchObject({ summary: "Actual Root output", chat_jid: chat,
      branch_id: branchId, session_id: "real-session", conversation_id: String(conversation.id), message_count: 2,
      last_active_at: "2026-10-19T01:01:00Z", tasks: [{ id: pendingId!, status: "pending" }] });
    expect(result.sessions[0].usage.models["qualification/synthetic"].totalTokens).toBe(10);
    expect(root.query("SELECT total_changes() AS n").get()).toEqual(before);
    // Missing telemetry is null, never a fabricated zero ledger.
    const secondRow = (await reader.read({ ...scope, limit: 12 })).find(r => r.chatJid === second)!;
    expect(secondRow.usage).toBeNull(); expect(secondRow.messageCount).toBe(0);
    expect(secondRow.updatedAt).toBeNull();
    // Revocation during projection cannot return an already collected row.
    let checks = 0;
    const revoked = createRootDashboardReader({ root, scope, sessionTargets: () => bundle.sessionTargets,
      isCurrent: () => ++checks < 3, canReadTarget: () => true });
    await expect(revoked.read({ ...scope, limit: 8 })).rejects.toThrow();
    visible = false; expect((await get({}, req)).sessions).toEqual([]); visible = true;
    current = false; await expect(get({}, req)).rejects.toThrow(); current = true;
    dispose(); dispose(); expect(disposals).toBe(1);
    await expect(get({}, req)).rejects.toThrow();
    expect(base.host.modelCalls).toBe(0); expect(base.host.credentialLookups).toBe(0);
  } finally {
    await bundle.close();
    // Do not leave fixture work for the next test's real application recovery.
    if (pendingId!) {
      const cleanup = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => lock.assertCurrentOwner() })));
      try { await cleanup.harness.abortTask(pendingId as any, context); await cleanup.harness.waitForTask(pendingId as any, context);
        expect(cleanup.host.modelCalls).toBe(0);
      } finally { await cleanup.close(); }
    }
    await closeDatabase(); lock.release(); await rm(dir, { recursive: true, force: true });
  }
});

test("public loader legacy static registration retains viewer routes without native duplicate registration", async () => {
  const routes = new Map<string, any>();
  const host = globalThis as any;
  const original = host.__piclaw_registerRoute;
  host.__piclaw_registerRoute = (prefix: string, handler: any) => {
    expect(routes.has(prefix)).toBe(false); routes.set(prefix, handler); return "created";
  };
  try {
    const eml = await import(`${addons}/eml-viewer/index.ts`);
    eml.default(undefined);
    const mindmap = await import(`${addons}/mindmap/index.ts`);
    mindmap.default(undefined);
    await import(`${addons}/web-viewer/index.ts`);
    for (const prefix of ["/html-viewer", "/image-viewer", "/video-viewer", "/eml-viewer"]) {
      const response = routes.get(prefix)(new Request(`https://fixture${prefix}`), prefix);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
    }
    const vendor = routes.get("/mindmap-vendor");
    expect(vendor(new Request("https://fixture/"), "/mindmap-vendor/../index.ts").status).toBe(404);
    expect(vendor(new Request("https://fixture/", { method: "POST" }), "/mindmap-vendor/a.js").status).toBe(405);
  } finally { host.__piclaw_registerRoute = original; }
});
