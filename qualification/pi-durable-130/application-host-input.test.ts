import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import "./src/test-guard.js";
import { expect } from "bun:test";
const applicationTest = isolatedApplicationTest(import.meta.url);
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

applicationTest("owned public SDK bundle admits authenticated host inputs, not Goal continuations", async () => {
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
  try {
    const target = bundle.sessionTargets.list()[0]!;
    expect(target.sessionId).toBe("real-session");
    let allowed = true, checks = 0;
    const input = { source: "remote_peer" as const, sourceId: `peer:${crypto.randomUUID()}`, text: "verified peer message",
      queuedAt: new Date().toISOString(), principal: { id: "authenticated-peer", revision: "policy-1" }, target,
      assertCurrent() { checks++; expect(root.inTransaction).toBe(true); if (!allowed) throw Error("revoked principal"); } };
    const receipt = await bundle.admitApplicationInput(input);
    expect(checks).toBeGreaterThanOrEqual(4);
    expect(await bundle.admitApplicationInput(input)).toEqual(receipt);
    expect(getDeferredQueuedFollowups(chat)).toEqual([]);
    expect(receipt.submission_id).toBeGreaterThan(0);
    const message=root.query("SELECT content,content_blocks FROM messages WHERE chat_jid=? AND id=?").get(chat,input.sourceId) as {content:string;content_blocks:string};
    expect(message.content).toBe(input.text);expect(JSON.parse(message.content_blocks)).toEqual([{type:"peer_message",peer_instance_id:"authenticated-peer",message_id:input.sourceId}]);
    const sdkBefore=root.query("SELECT id,json_extract(record,'$.requestId') request_id FROM submissions ORDER BY id").all();
    await expect(bundle.admitApplicationInput({...input,principal:{...input.principal,revision:"changed"}})).rejects.toThrow();
    expect(root.query("SELECT id,json_extract(record,'$.requestId') request_id FROM submissions ORDER BY id").all()).toEqual(sdkBefore);
    const source = root.query("SELECT kind,target_operation_id,parent_source_seq,provenance_ref FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?").get(chat, input.sourceId) as any;
    expect(source.kind).toBe("message"); expect(source.target_operation_id).toBeNull(); expect(source.parent_source_seq).toBeNull();
    expect(source.provenance_ref).toStartWith("application:pi-durable:");
    await expect(bundle.admitApplicationInput({ ...input, text: "changed replay" })).rejects.toThrow("conflict");
    await expect(bundle.admitApplicationInput({ ...input, target: { ...target, revision: "wrong" } })).rejects.toThrow("Exact native");
    await expect(bundle.admitApplicationInput({ ...input, target: { ...target, sessionId: "fake" } })).rejects.toThrow("Exact native");
    allowed = false;
    await expect(bundle.admitApplicationInput({ ...input, sourceId: "revoked" })).rejects.toThrow("revoked");
    allowed = true;
    let n = 0;
    await expect(bundle.admitApplicationInput({ ...input, sourceId: "commit-revoked", assertCurrent() { if (++n === 3) throw Error("revoked at commit"); } })).rejects.toThrow("commit");
    expect(root.query("SELECT 1 FROM service_effect_s01_sources WHERE source_id='commit-revoked'").get()).toBeNull();
    expect(getDeferredQueuedFollowups(chat).some(i => i.source_id === "commit-revoked")).toBe(false);
    await bundle.admitApplicationInput({ ...input, source: "regrets.command", sourceId: "regrets-command" });
    expect(getDeferredQueuedFollowups(chat).some(i => i.source === "goal.continuation")).toBe(false);
    await expect(bundle.admitApplicationInput({ ...input, mode: "steer" as any })).rejects.toThrow("Unsupported");
    const newChat = `${chat}:new`; storeChatMetadata(newChat, new Date().toISOString());
    const ports = bundle.bind({ queue: {} as any, agentPool: {} as any });
    await ports.prepareInputSourceAdmission!(newChat);
    const added = bundle.sessionTargets.list().find(t => t.chatJid === newChat)!;
    expect(added.sessionId).toBe("new-real-session"); expect(bundle.sessionTargets.resolve(added)).toEqual(added);
    await bundle.admitApplicationInput({ ...input, sourceId: "new-chat", target: added });
    expect(getDeferredQueuedFollowups(newChat)).toEqual([]);
    expect(root.query("SELECT state FROM service_effect_s01_sources WHERE chat_jid=?").get(newChat)).toEqual({state:"consumed"});
    expect(root.query("SELECT * FROM service_effect_s01_operations").all()).toEqual([]);expect(base.host.credentialLookups).toBe(0);
  } finally { await bundle.close(); await closeDatabase(); lock.release(); await rm(dir, { recursive: true, force: true }); }
});
