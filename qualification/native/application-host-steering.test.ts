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
    const admission=await bundle.dispatchAcceptedInput(chat,message.id,message.rowid)!;
    expect(admission.submission_id).toBeGreaterThan(0);
    await entered.promise;
    expect(root.query('SELECT status FROM submissions WHERE id=?').get(admission.submission_id)).toEqual({status:'placed'});
    expect(root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);
    // A display projection is not an admission grant. Source/target/principal
    // authority below must remain independent of it.
    bundle.bindInputProjection(projection);
    // Exact targeting and source scope are checked before any accepted queue write.
    await expect(bundle.steerApplicationInput({ ...peer("retarget"), target: { ...target, sessionId: "other-session" } })).rejects.toThrow("Exact native");
    await expect(bundle.steerApplicationInput({ ...peer("mixed-goal"), source: "goal.continuation" as any })).rejects.toThrow("Unsupported");
    // Principal authority is checked through the durable ingress commit.
    // After that commit, the accepted source—not a UI projection—owns input.
    let commitChecks = 0;
    await expect(bundle.steerApplicationInput({ ...peer("revoked-at-commit"), assertCurrent() {
      lock.assertCurrentOwner();
      if (++commitChecks === 3) throw Error("fixture peer revoked at commit");
    } })).rejects.toThrow("revoked at commit");
    expect(commitChecks).toBe(3);
    expect(root.query("SELECT 1 FROM messages WHERE id='revoked-at-commit'").get()).toBeNull();
    expect(root.query("SELECT 1 FROM service_effect_s01_sources WHERE source_id='revoked-at-commit'").get()).toBeNull();
    expect(getDeferredQueuedFollowups(chat)).toEqual([]);
    bundle.bindInputProjection(undefined);
    expect(root.query("SELECT source_id FROM service_effect_s01_sources WHERE chat_jid=? AND state IN ('pending','claimed') AND source_id<>?").all(chat, message.id)).toEqual([]);
    const receipt = await bundle.steerApplicationInput(peer("peer-B"));
    expect(receipt.mode).toBe("steer");
    expect(checks).toBeGreaterThanOrEqual(4);
    expect([...guardContexts]).toEqual([true]);
    expect(getDeferredQueuedFollowups(chat)).toEqual([]);
    expect(base.host.modelCalls).toBe(0);
    base.host.finalContent = [{ type: "text", text: "one whole-operation answer" }];
    hold.release();
    for(let n=0;n<1000&&(root.query('SELECT status FROM submissions WHERE id=?').get(receipt.submission_id) as any).status!=='done';n++)await Bun.sleep(2);
    expect(root.query('SELECT status FROM submissions WHERE id=?').get(receipt.submission_id)).toEqual({status:'done'});
    expect(root.query('SELECT status FROM submissions WHERE id=?').get(admission.submission_id)).toEqual({status:'done'});
    expect(base.host.transcripts.length).toBe(2);
    expect(base.host.transcripts[1]).toContain("B verified peer steering");
    const sdkAnswer=root.query("SELECT record FROM entries WHERE json_extract(record,'$.kind')='pi.assistant' ORDER BY id DESC LIMIT 1").get() as {record:string};
    expect(JSON.parse(sdkAnswer.record).model[0].content).toEqual([{type:'text',text:'one whole-operation answer'}]);
    expect(root.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(chat)).toEqual([]);
    const sources = root.query("SELECT source_id,state FROM service_effect_s01_sources WHERE chat_jid=? ORDER BY source_seq").all(chat) as any[];
    expect(sources.filter(s => [message.id,"peer-B"].includes(s.source_id)).map(s=>s.state)).toEqual(["consumed","consumed"]);
    expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(0);
    expect(root.query("SELECT operation_id FROM service_effect_s01_operations WHERE chat_jid=?").all(chat)).toHaveLength(0);
    expect(getDeferredQueuedFollowups(chat)).toEqual([]);
    expect(root.query("SELECT source_id FROM service_effect_s01_sources WHERE chat_jid=? AND state IN ('pending','claimed')").all(chat)).toEqual([]);
    expect(root.query("SELECT content FROM messages WHERE chat_jid=? AND id='peer-B'").get(chat)).toEqual({content:'B verified peer steering'});
    expect(base.host.credentialLookups).toBe(0); expect(base.host.effects).toBe(0);
  } finally { hold.release(); await bundle.close(); await closeDatabase(); lock.release(); process.env.PICLAW_DB_IN_MEMORY = oldMemory; await rm(dir, { recursive: true, force: true }); }
}, 20000);
