import { repoRoot } from "./src/repo-root.js";
import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { getDeferredQueuedFollowups, storeChatMetadata } from "../../runtime/src/db.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { applicationOwnership, createApplicationBootstrapBundle } from "../../runtime/durable-engine/src/application-bootstrap.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { openFixture, context, barrier } from "./src/fixture.js";

test("remote-peer delivery uses public bootstrap queue and S01 admission", async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "host-input-"));
  const lock = acquireRuntimeLock({ lockPath: join(dir, "owner.lock"), strictOwnership: true, disabled: false });
  process.env.PICLAW_DB_IN_MEMORY = "0";
  initDatabase();
  const root = getDb(); root.exec("PRAGMA foreign_keys=ON");
  const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(r => r.name === "main")!.file;
  const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => lock.assertCurrentOwner() })));
  const hold=barrier();base.host.modelHold=hold;
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
    runtime: { incarnation: "remote-host-input-domain", sessionId: "runtime", lane: "main", generation: 1,
      now: () => new Date().toISOString(), harnessOptions: { models: base.models, registry: base.registry } },
  }, context);
  try {
    const target = bundle.sessionTargets.list()[0]!;
    expect(target.sessionId).toBe("real-session");
    let allowed = true, checks = 0;
    const input = { source: "remote_peer" as const, sourceId: `peer:${crypto.randomUUID()}`, text: "verified peer message",
      queuedAt: new Date().toISOString(), principal: { id: "authenticated-peer", revision: "policy-1" }, target,
      assertCurrent() { checks++; if (!allowed) throw Error("revoked principal"); } };
    const { createNativeRemotePeerDelivery } = await import(repoRoot("ADDONS") + "/addons/remote-peer/native.ts");
    const { RemotePeerAuthorityScope } = await import(repoRoot("ADDONS") + "/addons/remote-peer/native-authority.ts");
    let retired = false;
    const owner = { assertCurrent() { lock.assertCurrentOwner(); if (retired) throw Error("owner retired"); } };
    const authority = new RemotePeerAuthorityScope({ ...owner, assertPeerCurrent() { if (!allowed) throw Error("revoked principal"); } });
    const deliver = createNativeRemotePeerDelivery({ bundle, owner, authority, select(i) {
      return bundle.sessionTargets.resolve({ ...target, revision: i.target_incarnation! });
    } });
    const request = { target_chat_jid: chat, target_incarnation: target.revision, content: "native delivery", mode: "queue" as const,
      source: { peer_instance_id: "authenticated-peer", peer_fingerprint: "fixture", message_id: "delivery-1" } };
    const incoming = () => authority.incoming({ peer: "authenticated-peer", revision: "policy-1", operation: "message" }, () => deliver(request));
    const delivered = await incoming();
    request.content = "changed replay";
    await expect(incoming()).rejects.toThrow("conflict");
    request.content = "native delivery";
    expect(getDeferredQueuedFollowups(chat)).toEqual([]);
    expect(root.query("SELECT content FROM messages WHERE chat_jid=? AND content='native delivery'").get(chat)).toEqual({content:'native delivery'});
    expect(delivered).toBeTruthy();
    await expect(authority.application("settings", () => deliver(request))).rejects.toThrow("Authenticated peer");
    request.target_incarnation = "wrong";
    await expect(incoming()).rejects.toThrow("Exact native");
    request.target_incarnation = target.revision;
    allowed = false; expect(incoming).toThrow("revoked"); allowed = true;
    retired = true; expect(incoming).toThrow("retired"); retired = false;
    const receipt = await bundle.admitApplicationInput(input);
    expect(checks).toBeGreaterThanOrEqual(4);
    expect(await bundle.admitApplicationInput(input)).toEqual(receipt);
    expect(receipt.submission_id).toBeGreaterThan(0);
    expect(root.query('SELECT submission_id FROM piclaw_durable_bindings_v1 WHERE chat_jid=? AND source_id=?').get(chat,input.sourceId)).toEqual({submission_id:receipt.submission_id});
    const peerMessage=root.query('SELECT sender,sender_name,content_blocks FROM messages WHERE chat_jid=? AND id=?').get(chat,input.sourceId) as any;
    expect(peerMessage.sender).toBe('remote_peer');expect(peerMessage.sender_name).toBe('authenticated-peer');
    expect(JSON.parse(peerMessage.content_blocks)).toEqual([{type:'peer_message',peer_instance_id:'authenticated-peer',message_id:input.sourceId}]);
    expect(receipt.target).toEqual(target);
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
    await expect(bundle.admitApplicationInput({ ...input, sourceId: "remote-commit-revoked", assertCurrent() { if (++n === 3) throw Error("revoked at commit"); } })).rejects.toThrow("commit");
    expect(root.query("SELECT 1 FROM service_effect_s01_sources WHERE source_id='remote-commit-revoked'").get()).toBeNull();
    expect(getDeferredQueuedFollowups(chat).some(i => i.source_id === "remote-commit-revoked")).toBe(false);
    await bundle.admitApplicationInput({ ...input, source: "regrets.command", sourceId: "remote-regrets-command" });
    expect(getDeferredQueuedFollowups(chat).some(i => i.source === "goal.continuation")).toBe(false);
    await expect(bundle.admitApplicationInput({ ...input, mode: "steer" as any })).rejects.toThrow("Unsupported");
    const newChat = `${chat}:new`; storeChatMetadata(newChat, new Date().toISOString());
    const ports = bundle.bind({ queue: {} as any, agentPool: {} as any });
    await ports.prepareInputSourceAdmission!(newChat);
    const added = bundle.sessionTargets.list().find(t => t.chatJid === newChat)!;
    expect(added.sessionId).toBe("new-real-session"); expect(bundle.sessionTargets.resolve(added)).toEqual(added);
    const addedReceipt=await bundle.admitApplicationInput({ ...input, sourceId: 'remote-new-chat', target: added });
    expect(addedReceipt.submission_id).toBeGreaterThan(0);
    expect(root.query('SELECT state FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?').get(newChat,'remote-new-chat')).toEqual({state:'consumed'});
    expect(getDeferredQueuedFollowups(newChat)).toEqual([]);
    expect(base.host.modelCalls).toBe(0); expect(base.host.credentialLookups).toBe(0);
  } finally { hold.release(); await bundle.close(); await closeDatabase(); lock.release(); await rm(dir, { recursive: true, force: true }); }
});
