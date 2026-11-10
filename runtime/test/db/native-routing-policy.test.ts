import {installHistoricalExpenseFixture} from '../fixtures/historical-expense.js';
import { beforeEach, afterEach, expect, test } from "bun:test";
import { initDatabase, closeDatabase, getDb } from "../../src/db/connection.js";
import { storeChatMetadata, storeMessage } from "../../src/db/messages.js";
import { createUser, updateUser } from "../../src/db/users.js";
import { provisionUserHome } from "../../src/db/session-ownership.js";
import { migrateOwnedSessionHandles } from "../../src/db/session-handles.js";
import { commitOwnedFork } from "../../src/db/owned-forks.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";
import { ensureChatBranch, getChatBranchByChatJid, renameChatBranchIdentity, archiveChatBranch, restoreChatBranchIdentity, renameChatJid, permanentDeleteArchivedBranch } from "../../src/db/chat-branches.js";
import { requireLegacyRoutingMutation, registerNativeBranchControlGuard } from "../../src/db/native-routing-policy.js";
import { ChatAccessDenied } from "../../src/db/session-ownership.js";
import { AgentPool } from "../../src/agent-pool.js";
import { createAgentPoolModelOptions } from "../model-services-fixture.js";
beforeEach(() => initDatabase()); afterEach(() => closeDatabase());
const chat = "web:routing", at = "2026-10-25T00:00:00.000Z";
function fixture(native = true, liveOwner = true) {
  storeChatMetadata(chat, at);
  const branch = getChatBranchByChatJid(chat)!;
  if (native) {
    // Only the conservative Core metadata fence is under test here. Actual SDK
    // schema/manifest/creation/publication is qualified in the production factory.
    const db = getDb();
    if (liveOwner) registerNativeBranchControlGuard(db, () => undefined);
    db.exec(`CREATE TABLE documents(id INTEGER PRIMARY KEY,kind TEXT,scope_kind TEXT,owner_id INTEGER,retired_at TEXT);
      CREATE TABLE document_revisions(document_id INTEGER,kind TEXT,content TEXT);
      CREATE TABLE conversations(id INTEGER PRIMARY KEY,record TEXT,owner_conversation_id INTEGER);
      CREATE TABLE tasks(id INTEGER PRIMARY KEY,conversation_id INTEGER,status TEXT);
      INSERT INTO conversations VALUES(2,'{}',NULL),(3,'{}',NULL);
      INSERT INTO documents VALUES(1,'"app.application-conversations"','conversation',1,NULL),(2,'"app.application-identity"','conversation',2,NULL);`);
    db.query("INSERT INTO document_revisions VALUES(2,'base',?)").run(JSON.stringify({ domain: "fixture", chatJid: chat, branchId: branch.branch_id, sessionId: "original-session" }));
  }
  return branch;
}
test("native routing policy: archive requires the live native control owner", () => {
  const branch = fixture(true, false);
  expect(() => archiveChatBranch(chat)).toThrow("Native routing owner unavailable");
  expect(getChatBranchByChatJid(chat)).toEqual(branch);
  const release = registerNativeBranchControlGuard(getDb(), chats => {
    expect(chats).toEqual([chat]); throw Error("Native branch has active native controls");
  });
  expect(() => archiveChatBranch(chat)).toThrow("active native controls");
  expect(getChatBranchByChatJid(chat)).toEqual(branch);
  release();
  expect(() => archiveChatBranch(chat)).toThrow("Native routing owner unavailable");
  const shared = () => undefined;
  const first = registerNativeBranchControlGuard(getDb(), shared), second = registerNativeBranchControlGuard(getDb(), shared);
  first();
  expect(archiveChatBranch(chat).archived_at).not.toBeNull();
  restoreChatBranchIdentity({ chat_jid: chat }); second();
  expect(() => archiveChatBranch(chat)).toThrow("Native routing owner unavailable");
});
test("native root metadata requires a live owner and rolls back failed registration", async () => {
  fixture(true, false);
  const db = getDb(), pool = new AgentPool({ ...createAgentPoolModelOptions(), getDurableSession: () => undefined });
  const snapshot = () => [db.query("SELECT * FROM chats").all(), db.query("SELECT * FROM chat_branches").all()];
  const before = snapshot();
  try {
    await expect(pool.createRootChatSession("new-native")).rejects.toThrow("Native routing owner unavailable");
    expect(snapshot()).toEqual(before);
    const denied = registerNativeBranchControlGuard(db, chats => {
      expect(db.inTransaction).toBe(true); expect(chats).toEqual([]); throw Error("Native owner revoked");
    });
    await expect(pool.createRootChatSession("new-native")).rejects.toThrow("Native owner revoked");
    expect(snapshot()).toEqual(before); denied();
    const release = registerNativeBranchControlGuard(db, () => undefined);
    try {
      db.exec("CREATE TRIGGER refuse_new_root BEFORE INSERT ON chat_branches WHEN new.chat_jid='web:new-native' BEGIN SELECT RAISE(ABORT,'root registration refused'); END");
      await expect(pool.createRootChatSession("new-native")).rejects.toThrow("root registration refused");
      expect(snapshot()).toEqual(before); db.exec("DROP TRIGGER refuse_new_root");
      const created = await pool.createRootChatSession("new-native");
      expect(created).toMatchObject({ chat_jid: "web:new-native", root_chat_jid: "web:new-native", parent_branch_id: null });
      expect(db.query("SELECT count(*) AS n FROM conversations").get()).toEqual({ n: 2 });
    } finally { release(); }
    const after = snapshot();
    await expect(pool.createRootChatSession("closed-owner-root")).rejects.toThrow("Native routing owner unavailable");
    expect(snapshot()).toEqual(after);
  } finally { await pool.shutdown(); }
});

test("native routing policy: metadata registration cannot undo archive", () => {
  const branch = fixture(); archiveChatBranch(chat);
  storeChatMetadata(chat, "2026-10-25T00:01:00.000Z");
  expect(getChatBranchByChatJid(chat)?.archived_at).not.toBeNull();
  expect(getChatBranchByChatJid(chat)?.branch_id).toBe(branch.branch_id);
});
test("native routing policy: address moves fail before changing any identity", () => {
  const branch = fixture(), db = getDb(), anchor = db.query("SELECT * FROM document_revisions").all();
  expect(() => renameChatJid(chat, "web:wrong-new-route")).toThrow("Native routing identities are immutable");
  expect(getChatBranchByChatJid(chat)).toEqual(branch);
  expect(getChatBranchByChatJid("web:wrong-new-route")).toBeNull();
  expect(db.query("SELECT * FROM document_revisions").all()).toEqual(anchor);
});
test("native routing policy: active SDK maintenance blocks archive in the same owner frame", () => {
  const branch = fixture(); getDb().exec("INSERT INTO tasks VALUES(1,2,'running')");
  expect(() => archiveChatBranch(chat)).toThrow("live SDK work");
  expect(getChatBranchByChatJid(chat)).toEqual(branch);
});
test("native routing policy: unrelated SDK work does not block this branch", () => {
  fixture(); getDb().exec("INSERT INTO tasks VALUES(1,3,'running')");
  expect(archiveChatBranch(chat).archived_at).not.toBeNull();
});
test("native routing policy: owned and parent-linked SDK fork work retains scope", () => {
  fixture(); const db = getDb();
  db.exec(`INSERT INTO conversations VALUES(4,'{"parent":{"conversationId":2}}',NULL),(5,'{}',4); INSERT INTO tasks VALUES(1,5,'running')`);
  expect(() => archiveChatBranch(chat)).toThrow("live SDK work");
});
test("native routing policy: historical expense holds remain inert and unchanged across archive", () => {
  const branch = fixture(),database=getDb();installHistoricalExpenseFixture(database);
  database.query("INSERT INTO budget_work(id,chat_jid,execution_kind,created_at,updated_at) VALUES ('routing-work',?,'interactive',?,?)").run(chat,at,at);
  database.query("INSERT INTO budget_request_reservations(id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,amount_microusd,state,created_at,updated_at) VALUES ('routing-request','routing-work',?,'fixture','fixture','fixture',?,1,'reserved',?,?)").run(chat,'a'.repeat(64),at,at);
  const historical=()=>['budget_work','budget_request_reservations'].map(table=>database.query(`SELECT * FROM ${table} ORDER BY rowid`).all()),before=historical();
  const archived=archiveChatBranch(chat);expect(archived.archived_at).not.toBeNull();expect(archived.branch_id).toBe(branch.branch_id);
  expect(historical()).toEqual(before);
});
test("native routing policy: explicit handle rename and restore preserve the creation anchor", () => {
  const branch = fixture(), db = getDb(), anchor = db.query("SELECT * FROM document_revisions").all();
  expect(renameChatBranchIdentity({ chat_jid: chat, agent_name: "friendly-native" }).branch_id).toBe(branch.branch_id);
  archiveChatBranch(chat); const restored = restoreChatBranchIdentity({ chat_jid: chat });
  expect(restored.archived_at).toBeNull(); expect(restored.branch_id).toBe(branch.branch_id);
  expect(restored.chat_jid).toBe(chat); expect(restored.agent_name).toBe("friendly-native");
  expect(db.query("SELECT * FROM document_revisions").all()).toEqual(anchor);
});
test("native routing policy: ensure cannot reparent identities or publish a legacy child", () => {
  const branch = fixture();
  expect(() => ensureChatBranch({ chat_jid: chat, root_chat_jid: "web:forged" })).toThrow("Native routing identities are immutable");
  expect(() => ensureChatBranch({ chat_jid: "web:routing:child", root_chat_jid: chat, parent_branch_id: branch.branch_id })).toThrow("Native routing identities are immutable");
  expect(getChatBranchByChatJid("web:routing:child")).toBeNull();
  expect(getChatBranchByChatJid(chat)).toEqual(branch);
});
test("native routing policy: destructive legacy purge retains native provenance", () => {
  fixture(); archiveChatBranch(chat);
  expect(() => permanentDeleteArchivedBranch(chat)).toThrow("Native routing identities are immutable");
  expect(getChatBranchByChatJid(chat)).not.toBeNull();
});
test("native routing policy: partial host authority cannot be treated as idle", () => {
  const branch = fixture(); getDb().exec("DROP TABLE service_effect_s01_queued_inputs");
  expect(() => archiveChatBranch(chat)).toThrow("authority is incomplete");
  expect(getChatBranchByChatJid(chat)).toEqual(branch);
});
test("native routing policy: imported profile is not silently given default archive policy", async () => {
  const branch = fixture();
  getDb().exec("DELETE FROM documents WHERE id=1; CREATE TABLE piclaw_durable_bindings_v1(branch_id TEXT)");
  expect(() => archiveChatBranch(chat)).toThrow("unavailable for this imported routing profile");
  expect(getChatBranchByChatJid(chat)).toEqual(branch);
  const startup = await import("../../src/runtime/startup.js");
  expect(startup.cleanupOrphanedActiveChatArtifacts()).toBe(0);
  expect(getChatBranchByChatJid(chat)).toEqual(branch);
});
test("native routing policy: owned legacy fork cannot create a partially published native child", () => {
  const branch = fixture(), db = getDb();
  const user = createUser(db, { username: "routing-owner", displayName: "Routing owner" });
  provisionUserHome(db, user.id, chat); updateUser(db, user.id, { enabled: true }); migrateOwnedSessionHandles(db);
  const principal: AuthenticatedPrincipal = { kind: "user", userId: user.id, username: user.username, displayName: user.displayName,
    role: "member", mode: "single-user", homeChatJid: chat, authentication: { method: "totp", sessionId: "fixture", expiresAt: null } };
  expect(() => commitOwnedFork(db, principal, chat, "native-owned-fork", "child", "{}")).toThrow("Native routing identities are immutable");
  expect(db.query("SELECT branch_id FROM chat_branches").all()).toEqual([{ branch_id: branch.branch_id }]);
  expect(db.query("SELECT * FROM owned_fork_operations").all()).toEqual([]);
  expect(() => commitOwnedFork(db, { ...principal, userId: "foreign" }, chat, "native-owned-foreign", "child", "{}")).toThrow(ChatAccessDenied);
});
test("native routing policy: legacy Dream cleanup cannot erase native metadata or history", async () => {
  fixture(); const db = getDb(), ghost = "dream:manual:protected:0";
  storeChatMetadata(ghost, at); const branch = getChatBranchByChatJid(ghost);
  storeMessage({ id: "native-dream-provenance", chat_jid: ghost, sender: "user", sender_name: "Fixture", content: "retain original bytes", timestamp: at, is_bot_message: false });
  const history = db.query("SELECT * FROM messages WHERE chat_jid=?").all(ghost);
  const dream = await import("../../src/dream.js"); let disposals = 0;
  await dream.runDreamAgentTurn({ chatJid: "web:default", mode: "manual", days: 1, agentPool: {
    isDurableRuntime:()=>true,dispatchDreamOperation: async () => ({ status: "success", result: "fixture" }), disposeChatSession: async () => { disposals++; },
  } as any });
  expect(getChatBranchByChatJid(ghost)).toEqual(branch);
  expect(db.query("SELECT * FROM messages WHERE chat_jid=?").all(ghost)).toEqual(history);
  expect(disposals).toBe(0);
});
test("native routing policy: migrated owner namespace still rejects legacy metadata mutation", () => {
  fixture(); getDb().query("UPDATE chat_branches SET handle_owner_id='another-owner' WHERE chat_jid=?").run(chat);
  expect(() => ensureChatBranch({ chat_jid: chat })).toThrow(ChatAccessDenied);
  expect(() => renameChatBranchIdentity({ chat_jid: chat, agent_name: "forged" })).toThrow(ChatAccessDenied);
  expect(getChatBranchByChatJid(chat)?.agent_name).toBe("routing");
});
test("native routing policy: legacy stores keep address and child mutation contracts", () => {
  const branch = fixture(false);
  expect(() => requireLegacyRoutingMutation(getDb(), "fork")).not.toThrow();
  ensureChatBranch({ chat_jid: "web:routing:child", root_chat_jid: chat, parent_branch_id: branch.branch_id });
  expect(renameChatJid(chat, "web:legacy-moved").branch.branch_id).toBe(branch.branch_id);
  expect(getChatBranchByChatJid("web:legacy-moved:child")).not.toBeNull();
});
