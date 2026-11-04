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
import { openFixture, context, barrier } from "./src/fixture.js";

import { admitWebMessage } from "../../runtime/src/channels/web/messaging/message-store.js";
import { InMemoryEffectPayloadResolver } from "../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";

// Owned SDK13 primitive proof, not a Root SDK12 bridge qualification.
applicationTest("owned application peer steer joins active native operation and settles both sources", async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "host-steering-"));
  const lock = acquireRuntimeLock({ lockPath: join(dir, "owner.lock"), strictOwnership: true, disabled: false });
  const oldMemory = process.env.PICLAW_DB_IN_MEMORY;
  process.env.PICLAW_DB_IN_MEMORY = "0";
  initDatabase();
  const root = getDb(); root.exec("PRAGMA foreign_keys=ON");
  const path = (root.query("PRAGMA database_list").all() as any[]).find(r => r.name === "main")!.file;
  const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => lock.assertCurrentOwner() })));
  const chat = "web:host-steering:" + crypto.randomUUID();
  storeChatMetadata(chat, new Date().toISOString());
  const branchId = (root.query("SELECT branch_id FROM chat_branches WHERE chat_jid=?").get(chat) as any).branch_id;
  const conversation = await base.harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: { provider: "qualification", modelId: "synthetic" } } }, context);
  await base.close(); installTerminalSettlementCompositionSchema(root);
  const resolver = new InMemoryEffectPayloadResolver();
  const bundle = await createApplicationBootstrapBundle({ root, path, ownership: applicationOwnership(lock),
    manifest: [{ chatJid: chat, branchId, conversationId: conversation.id }], sessions: new Map([[chat, "real-session"]]),
    offlineInitialize: true, answers: { put(ref, text) { resolver.putText(ref, text); }, resolver },
    runtime: { incarnation: "host-steering-domain", sessionId: "runtime", lane: "main", generation: 1,
      now: () => new Date().toISOString(), harnessOptions: { models: base.models, registry: base.registry } },
  }, context);
  const hold = barrier(), entered = barrier();
  base.host.modelHold = hold; base.host.onModelEnter = () => entered.release();
  const events: {type: string; data: any}[] = [];
  const projection = { pendingLinkPreviews: new Set<string>(), broadcastEvent(type: string, data: any) { events.push({type, data}); } };
  try {
    const target = bundle.sessionTargets.list()[0]!;
    let checks = 0;
    const guardContexts = new Set<boolean>();
    const peer = (sourceId: string) => ({ source: "remote_peer" as const, sourceId, text: "B verified peer steering", queuedAt: new Date().toISOString(),
      principal: { id: "verified-fixture-peer", revision: "policy-1" }, target,
      assertCurrent() { checks++; guardContexts.add(root.inTransaction); lock.assertCurrentOwner(); } });
    const ports = bundle.bind({ queue: {} as any, agentPool: {} as any });
    const stored = await admitWebMessage(projection, { chatJid: chat, content: "A primary native input", isBot: false, mediaIds: [], agentId: "default", agentName: "Fixture" },
      { acceptSource: ports.getInputSourceAdmission!(chat) }, () => lock.assertCurrentOwner(), new AbortController().signal);
    expect(stored).not.toBeNull();
    const message = root.query("SELECT rowid,id FROM messages WHERE chat_jid=? AND content=?").get(chat, "A primary native input") as any;
    const dispatch = bundle.dispatchAcceptedInput(chat, message.id, message.rowid)!;
    expect(dispatch).toBeFunction();
    const settling = dispatch();
    await entered.promise;
    // Provider entry precedes binding; synchronize on committed host state, not elapsed time.
    let running = false;
    for (let n=0; n<1000; n++) {
      const rows = root.query("SELECT * FROM service_effect_s01_operations WHERE chat_jid=?").all(chat) as any[];
      running = rows.some(r => r.phase === "executing" && r.harness_operation_id !== null);
      if (running) break;
      await Bun.sleep(2);
    }
    expect(running).toBe(true);
    await expect(bundle.steerApplicationInput(peer("no-projection"))).rejects.toThrow("projection");
    expect(getDeferredQueuedFollowups(chat)).toEqual([]);
    expect(root.query("SELECT * FROM service_effect_s01_operation_sources os JOIN service_effect_s01_sources s ON s.chat_jid=? AND s.source_seq=os.source_seq WHERE s.source_id='no-projection'").all(chat)).toEqual([]);
    bundle.bindInputProjection(projection);
    // Exact targeting and source scope are checked before any accepted queue write.
    await expect(bundle.steerApplicationInput({ ...peer("retarget"), target: { ...target, sessionId: "other-session" } })).rejects.toThrow("Exact native");
    await expect(bundle.steerApplicationInput({ ...peer("mixed-goal"), source: "goal.continuation" as any })).rejects.toThrow("Unsupported");
    // Revoke after the composite helper crosses its first await, not just at ingress.
    let outsideChecks = 0;
    await expect(bundle.steerApplicationInput({ ...peer("revoked-after-await"), assertCurrent() {
      lock.assertCurrentOwner();
      if (!root.inTransaction && ++outsideChecks === 2) throw Error("fixture peer revoked after await");
    } })).rejects.toThrow("revoked after await");
    expect(outsideChecks).toBe(2);
    expect(getDeferredQueuedFollowups(chat)).toEqual([]);
    // The captured projection is authority too: losing it must withdraw the queue.
    outsideChecks = 0;
    await expect(bundle.steerApplicationInput({ ...peer("detached-projection"), assertCurrent() {
      lock.assertCurrentOwner();
      if (!root.inTransaction && ++outsideChecks === 2) bundle.bindInputProjection(undefined);
    } })).rejects.toThrow("projection detached");
    expect(getDeferredQueuedFollowups(chat)).toEqual([]);
    bundle.bindInputProjection(projection);
    expect(root.query("SELECT source_id FROM service_effect_s01_sources WHERE chat_jid=? AND state IN ('pending','claimed') AND source_id<>?").all(chat, message.id)).toEqual([]);
    const receipt = await bundle.steerApplicationInput(peer("peer-B"));
    expect(receipt.mode).toBe("steer");
    expect(checks).toBeGreaterThan(4);
    expect([...guardContexts].sort()).toEqual([false, true]);
    expect(getDeferredQueuedFollowups(chat)).toEqual([]);
    expect(base.host.modelCalls).toBe(0);
    base.host.finalContent = [{ type: "text", text: "one whole-operation answer" }];
    hold.release();
    expect(await settling).toBe("settled");
    expect(base.host.transcripts.length).toBe(2);
    expect(base.host.transcripts[1]).toContain("B verified peer steering");
    expect(root.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(chat)).toEqual([{content: "one whole-operation answer"}]);
    const sources = root.query("SELECT source_id,state FROM service_effect_s01_sources WHERE chat_jid=? ORDER BY source_seq").all(chat) as any[];
    expect(sources.filter(s => [message.id,"peer-B"].includes(s.source_id)).map(s=>s.state)).toEqual(["consumed","consumed"]);
    expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
    expect(root.query("SELECT operation_id FROM service_effect_s01_operations WHERE chat_jid=?").all(chat)).toHaveLength(1);
    expect(getDeferredQueuedFollowups(chat)).toEqual([]);
    expect(root.query("SELECT source_id FROM service_effect_s01_sources WHERE chat_jid=? AND state IN ('pending','claimed')").all(chat)).toEqual([]);
    const posts = events.filter(e => e.type === "new_post");
    expect(posts).toHaveLength(1);
    expect(JSON.stringify(posts[0].data)).toContain("B verified peer steering");
    const peerMessage = root.query("SELECT rowid FROM messages WHERE chat_jid=? AND id='peer-B'").get(chat) as { rowid: number };
    expect(posts[0].data.id).toBe(peerMessage.rowid);
    expect(posts[0].data.chat_jid).toBe(chat);
    expect(base.host.credentialLookups).toBe(0); expect(base.host.effects).toBe(0);
  } finally { hold.release(); await bundle.close(); await closeDatabase(); lock.release(); process.env.PICLAW_DB_IN_MEMORY = oldMemory; await rm(dir, { recursive: true, force: true }); }
}, 20000);
