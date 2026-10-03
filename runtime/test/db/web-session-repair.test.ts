import { beforeEach, expect, test } from "bun:test";
import { initDatabase, getDb } from "../../src/db/connection.js";
import { createWebSession, getWebSession } from "../../src/db/web-sessions.js";

beforeEach(() => { initDatabase(); getDb().run("DELETE FROM web_sessions"); });

test("nullable legacy method and ID repair preserve current canonical identity", () => {
  const db = getDb(); createWebSession("legacy", "default", 3600, null);
  db.run("UPDATE web_sessions SET token='legacy', session_id=NULL");
  const login = getWebSession("legacy");
  expect(login?.auth_method).toBeNull(); expect(login?.session_id).toStartWith("login-");
  expect(getWebSession("legacy")?.session_id).toBe(login?.session_id);
});

test("a changed identity after this call's ID assignment is denied", () => {
  const db = getDb(); createWebSession("legacy", "default", 3600, "totp");
  db.run("UPDATE web_sessions SET session_id=NULL");
  db.run("CREATE TEMP TRIGGER change_repaired_id AFTER UPDATE OF session_id ON web_sessions BEGIN UPDATE web_sessions SET session_id='login-other' WHERE token=NEW.token; END");
  try { expect(getWebSession("legacy")).toBeNull(); }
  finally { db.run("DROP TRIGGER change_repaired_id"); }
  expect(getWebSession("legacy")?.session_id).toBe("login-other");
});

test("expiry crossing during ID repair is checked again", () => {
  const db = getDb(), now = Date.now; let clock = now();
  Date.now = () => clock;
  try {
    createWebSession("legacy", "default", 1, "totp"); db.run("UPDATE web_sessions SET session_id=NULL");
    const prepare = db.prepare;
    db.prepare = ((sql: string, ...args: unknown[]) => {
      const stmt = Reflect.apply(prepare, db, [sql, ...args]);
      if (!sql.startsWith("UPDATE web_sessions SET session_id")) return stmt;
      return new Proxy(stmt, { get(t, key) {
        if (key === "run") return (...params: unknown[]) => { const result = Reflect.apply(t.run, t, params); clock += 2000; return result; };
        return Reflect.get(t, key, t);
      } });
    }) as typeof db.prepare;
    try { expect(getWebSession("legacy")).toBeNull(); }
    finally { db.prepare = prepare; }
  } finally { Date.now = now; }
});

test("a canonical token collision during migration propagates and rolls back", () => {
  const db = getDb(); createWebSession("legacy", "default", 3600, "totp"); db.run("UPDATE web_sessions SET token='legacy'");
  const before = db.query("SELECT * FROM web_sessions").all();
  db.run(`CREATE TEMP TRIGGER collide_token BEFORE UPDATE OF token ON web_sessions BEGIN
    INSERT INTO web_sessions(token,user_id,auth_method,created_at,expires_at,session_id)
      VALUES (NEW.token,'other','passkey',NEW.created_at,NEW.expires_at,'login-collision'); END`);
  try { expect(() => getWebSession("legacy")).toThrow("UNIQUE constraint failed"); expect(db.query("SELECT * FROM web_sessions").all()).toEqual(before); }
  finally { db.run("DROP TRIGGER collide_token"); }
});

test("repair SQL failures propagate without authenticating and do not change modern reads", () => {
  const db = getDb(); createWebSession("legacy", "default", 3600, "totp"); createWebSession("modern", "default", 3600, "passkey");
  db.query("UPDATE web_sessions SET token='legacy' WHERE auth_method='totp'").run();
  db.run("CREATE TEMP TRIGGER deny_repair BEFORE UPDATE ON web_sessions BEGIN SELECT RAISE(ABORT,'repair denied'); END");
  try { expect(() => getWebSession("legacy")).toThrow("repair denied"); expect(getWebSession("modern")?.auth_method).toBe("passkey"); }
  finally { db.run("DROP TRIGGER deny_repair"); }
});
