import Database from "bun:sqlite";
import { beforeEach, afterEach, expect, test } from "bun:test";
import { createUser, initializeUserSchema, updateUser } from "../../src/db/users.js";
import { initializeSessionOwnershipSchema, assignRootOwner, provisionUserHome, getRootOwnership, resolveAuthorisedChat, ChatAccessDenied } from "../../src/db/session-ownership.js";
import * as ownership from "../../src/db/session-ownership.js";
import type { AuthenticatedPrincipal } from "../../src/channels/web/auth/principal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let db: Database;
let alice: string;
let bob: string;
function root(id: string, archived: string | null = null) {
  db.query("INSERT INTO chats(jid) VALUES (?)").run(id);
  db.query("INSERT INTO chat_branches VALUES (?,?,?,NULL,?)").run(id, id, id, archived);
}
function child(id: string, rootId: string, parent: string, archived: string | null = null) {
  db.query("INSERT INTO chats(jid) VALUES (?)").run(id);
  db.query("INSERT INTO chat_branches VALUES (?,?,?,?,?)").run(id, id, rootId, parent, archived);
}
function principal(id = alice, role: "admin" | "member" = "member"): AuthenticatedPrincipal {
  return { kind: "user", userId: id, username: id, displayName: id, role, mode: "single-user", homeChatJid: "untrusted-stale-home", authentication: { method: "totp", sessionId: "login-test", expiresAt: null } };
}
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE chats(jid TEXT PRIMARY KEY);
    CREATE TABLE chat_branches(branch_id TEXT PRIMARY KEY,chat_jid TEXT UNIQUE NOT NULL REFERENCES chats(jid),root_chat_jid TEXT NOT NULL,parent_branch_id TEXT,archived_at TEXT);
  `);
  initializeUserSchema(db);
  initializeSessionOwnershipSchema(db);
  alice = createUser(db, {username:"alice",displayName:"Alice"}).id;
  bob = createUser(db, {username:"bob",displayName:"Bob"}).id;
  root("web:alice"); root("web:bob");
  provisionUserHome(db, alice, "web:alice");
  provisionUserHome(db, bob, "web:bob");
  updateUser(db, alice, {enabled:true}); updateUser(db, bob, {enabled:true});
});
afterEach(() => db.close());

test("owned roots and nested forks resolve through records independently of JID prefixes", () => {
  child("web:unrelated-label", "web:alice", "web:alice");
  child("web:bob:looks-like-bob", "web:alice", "web:unrelated-label");
  const result=resolveAuthorisedChat(db,principal(),"web:bob:looks-like-bob","session.fork");
  expect(result.ownerUserId).toBe(alice);
  expect(result.rootChatJid).toBe("web:alice");
  expect(result.chatJid).toBe("web:bob:looks-like-bob");
  expect(() => resolveAuthorisedChat(db,principal(bob),result.chatJid,"session.read")).toThrow(ChatAccessDenied);
});

test("omitted target uses the current owned home, not client/principal-supplied defaults", () => {
  expect(resolveAuthorisedChat(db,principal(),undefined,"session.read").chatJid).toBe("web:alice");
  for (const target of ["web:bob","web:missing","", " "]) {
    expect(() => resolveAuthorisedChat(db,principal(),target,"session.read")).toThrow("Session access denied.");
  }
});

test("admin cannot read other owners or use account grants as a session action", () => {
  updateUser(db,alice,{role:"admin"});
  expect(() => resolveAuthorisedChat(db,principal(alice,"admin"),"web:bob","session.read")).toThrow(ChatAccessDenied);
  expect(() => resolveAuthorisedChat(db,principal(alice,"admin"),"web:alice","account.manage-users")).toThrow(ChatAccessDenied);
});

test("disabled accounts, changed roles and missing ownership fail closed", () => {
  updateUser(db,alice,{enabled:false});
  expect(() => resolveAuthorisedChat(db,principal(),undefined,"session.read")).toThrow(ChatAccessDenied);
  updateUser(db,alice,{enabled:true,role:"admin"});
  expect(() => resolveAuthorisedChat(db,principal(),undefined,"session.read")).toThrow(ChatAccessDenied);
  root("web:unowned");
  expect(() => resolveAuthorisedChat(db,principal(alice,"admin"),"web:unowned","session.read")).toThrow(ChatAccessDenied);
});

test("orphans, cycles and cross-root parent chains deny before returning ownership", () => {
  child("orphan", "web:alice", "unknown");
  child("cycle", "web:alice", "cycle");
  child("cross", "web:alice", "web:bob");
  for (const id of ["orphan","cycle","cross"]) expect(() => getRootOwnership(db,id)).toThrow(ChatAccessDenied);
});

test("unknown root owner or child assignment cannot mutate ownership", () => {
  child("child", "web:alice", "web:alice");
  expect(() => assignRootOwner(db,"child",alice)).toThrow(ChatAccessDenied);
  expect(() => assignRootOwner(db,"web:alice","absent-user")).toThrow(ChatAccessDenied);
  expect(() => assignRootOwner(db,"web:alice",bob)).toThrow(ChatAccessDenied);
  expect(() => db.query("UPDATE session_roots SET owner_user_id=? WHERE root_branch_id=?").run(bob,"web:alice")).toThrow("immutable");
  expect(getRootOwnership(db,"web:alice")?.ownerUserId).toBe(alice);
});

test("home provisioning retry is idempotent and cannot point at another owner's tree", () => {
  const before=db.query("SELECT total_changes() AS n").get();
  provisionUserHome(db,alice,"web:alice");
  expect(db.query("SELECT total_changes() AS n").get()).toEqual(before);
  expect(() => provisionUserHome(db,alice,"web:bob")).toThrow(ChatAccessDenied);
  expect(resolveAuthorisedChat(db,principal(),undefined,"session.read").chatJid).toBe("web:alice");
});

test("home archive/delete is protected until replacement; archived contexts cannot run", () => {
  expect(() => db.query("UPDATE chat_branches SET archived_at='archived' WHERE chat_jid='web:alice'").run()).toThrow("another owned home");
  expect(() => db.query("DELETE FROM chat_branches WHERE chat_jid='web:alice'").run()).toThrow();
  root("web:alice-new"); provisionUserHome(db,alice,"web:alice-new");
  db.query("UPDATE chat_branches SET archived_at='archived' WHERE chat_jid='web:alice'").run();
  expect(() => resolveAuthorisedChat(db,principal(),"web:alice","session.read")).toThrow(ChatAccessDenied);
  expect(getRootOwnership(db,"web:alice",true)?.ownerUserId).toBe(alice);
  expect(() => provisionUserHome(db,alice,"web:alice")).toThrow(ChatAccessDenied);
});

test("stable branch ownership survives permitted root JID maintenance", () => {
  db.exec("PRAGMA foreign_keys=OFF");
  db.query("UPDATE chats SET jid='web:alice-renamed' WHERE jid='web:alice'").run();
  db.query("UPDATE chat_branches SET chat_jid='web:alice-renamed',root_chat_jid='web:alice-renamed' WHERE branch_id='web:alice'").run();
  expect(getRootOwnership(db,"web:alice-renamed")?.ownerUserId).toBe(alice);
  expect(resolveAuthorisedChat(db,principal(),undefined,"session.read").chatJid).toBe("web:alice-renamed");
});

test('native ownership initialization never adopts unowned archived or non-web history',()=>{
  root('web:archived','old');root('messaging:root');
  const snapshot=()=>['users','chats','chat_branches','session_roots'].map(table=>db.query(`SELECT * FROM ${table} ORDER BY 1`).all());
  const before=snapshot();expect(ownership).not.toHaveProperty('assignLegacyRootOwners');
  initializeSessionOwnershipSchema(db);expect(snapshot()).toEqual(before);
  expect(getRootOwnership(db,'web:archived',true)).toBeNull();expect(getRootOwnership(db,'messaging:root')).toBeNull();
  expect(()=>resolveAuthorisedChat(db,principal(),'messaging:root','session.read')).toThrow(ChatAccessDenied);
});

test("ownership and home survive closing and reopening the store", () => {
  const dir = mkdtempSync(join(tmpdir(), "piclaw-owner-reopen-"));
  const path = join(dir, "state.db");
  let disk = new Database(path);
  try {
    disk.exec(`CREATE TABLE chats(jid TEXT PRIMARY KEY);
      CREATE TABLE chat_branches(branch_id TEXT PRIMARY KEY,chat_jid TEXT UNIQUE NOT NULL,root_chat_jid TEXT NOT NULL,parent_branch_id TEXT,archived_at TEXT);
      INSERT INTO chats VALUES ('web:default');
      INSERT INTO chat_branches VALUES ('b-root','web:default','web:default',NULL,NULL);`);
    initializeUserSchema(disk); initializeSessionOwnershipSchema(disk);
    provisionUserHome(disk, "default", "web:default");
    disk.close(); disk = new Database(path);
    initializeSessionOwnershipSchema(disk);
    expect(resolveAuthorisedChat(disk, principal("default", "admin"), undefined, "session.read")).toEqual({
      chatJid:"web:default", rootBranchId:"b-root", rootChatJid:"web:default", ownerUserId:"default", policy:"private",
    });
  } finally { disk.close(); rmSync(dir, {recursive:true, force:true}); }
});

test('unregistered chat has no migration fallback or implicit authority',()=>{
  db.query("INSERT INTO chats VALUES ('unmapped')").run();
  expect(ownership).not.toHaveProperty('assignLegacyRootOwners');
  expect(()=>resolveAuthorisedChat(db,principal(),'unmapped','session.read')).toThrow(ChatAccessDenied);
});
