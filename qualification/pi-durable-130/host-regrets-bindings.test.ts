import { repoRoot } from "./src/repo-root.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createHostRegretsBindings } from "../../runtime/durable-engine/src/host-regrets-bindings.ts";
const { createLateNightRegrets, readExchanges } = await import((process.env.DURABLE_REGRETS_QUALIFICATION_ROOT ?? repoRoot("ADDONS")) + "/addons/late-night-regrets/native.ts");
function fixture(revokeDuringWrite = false) {
  const root = new Database(":memory:");
  root.exec(`CREATE TABLE extension_kv(extension_id TEXT,scope TEXT,scope_key TEXT,key TEXT,value TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(extension_id,scope,scope_key,key));
    CREATE TABLE messages(chat_jid TEXT,sender TEXT,sender_name TEXT,content TEXT,timestamp TEXT,is_bot_message INTEGER,content_blocks TEXT,thread_id INTEGER,content_erased INTEGER DEFAULT 0);`);
  const add = root.query("INSERT INTO messages(chat_jid,sender,sender_name,content,timestamp,is_bot_message) VALUES(?,'human','Human',?,?,0)");
  add.run("chat:a", "Please be concise", new Date(Date.now()-1000).toISOString());
  add.run("chat:b", "Foreign fixture", new Date(Date.now()-1000).toISOString());
  let writes = 0;
  let owned = true, mode = "single-user", all = false, files = 0, admissions = 0, models = 0;
  const ports = createHostRegretsBindings({ transactionalWrite: body => root.transaction(() => { writes++; return body(); }).immediate(), root, historyDatabase: root, cwd: "/fixture", chat: "chat:a",
    assertCurrent() { if (revokeDuringWrite && writes === 2 && root.query("SELECT value FROM extension_kv").get() && !JSON.parse((root.query("SELECT value FROM extension_kv").get() as { value: string }).value).enabled) owned = false; if (!owned) throw Error("revoked"); }, accessMode: () => mode, allowAllChats: () => all, readExchanges,
    async readFile() { files++; return undefined; }, async admitConversationInput(text) { admissions++; return { accepted: text }; },
  });
  return { root, ports, native: createLateNightRegrets(ports), revoke() { owned = false; }, mode(v: string) { mode = v; }, all(v: boolean) { all = v; }, counts: () => ({ files, admissions, models }) };
}
test("owned SQLite scoped history, explicit all-chat opt-in and RootKV settings", async () => {
  const f = fixture(); try {
    await f.native.setConfig({ review_scope: "current" });
    const result = await f.native.tool.execute("call", {});
    expect(JSON.stringify(result)).toContain("Please be concise"); expect(JSON.stringify(result)).not.toContain("Foreign fixture");
    expect(f.native.settings.config.get().config.review_scope).toBe("current");
    await f.native.settings.config.set({ review_scope: "all" });
    await expect(f.native.tool.execute("call", {})).rejects.toThrow("scope denied");
    f.all(true); expect(JSON.stringify(await f.native.tool.execute("call", {}))).toContain("Foreign fixture");
    expect(f.root.query("SELECT count(*) n FROM extension_kv").get()).toEqual({ n: 1 });
  } finally { f.root.close(); }
});
test("single-user and revoked direct settings deny effects", async () => {
  const f = fixture(); try {
    f.mode("multi-user"); await expect(f.native.tool.execute("call", {})).rejects.toThrow("single-user");
    expect(f.counts().files).toBe(0); f.revoke();
    expect(() => f.native.settings.config.get()).toThrow("revoked");
    await expect(f.native.settings.config.set({ enabled: false })).rejects.toThrow("revoked");
    expect(() => f.native.settings.models.get()).toThrow("revoked");
    await expect(f.native.command()).rejects.toThrow("revoked"); expect(f.counts().admissions).toBe(0);
    expect(f.root.query("SELECT count(*) n FROM extension_kv").get()).toEqual({ n: 0 });
  } finally { f.root.close(); }
});
for (const boundary of ["history", "file", "model", "admission"] as const) test(`independent revocation after awaited ${boundary}`, async () => {
  const f = fixture(); try {
    await f.native.setConfig({ review_scope: "current" });
    let later = 0;
    const ports = { ...f.ports,
      history: async (...args: Parameters<typeof f.ports.history>) => { const r = await f.ports.history(...args); if (boundary === "history") f.revoke(); return r; },
      readFile: async () => { later++; if (boundary === "file") f.revoke(); return undefined; },
      admitConversationInput: async () => { await Promise.resolve(); f.revoke(); return { accepted: true }; },
      accountedDecision: { getAvailable: () => [{ provider: "fixture", id: "model", name: "fixture", maxTokens: 4096, contextWindow: 100000 } as any], async complete() { later++; await Promise.resolve(); f.revoke(); return { content: [{ type: "text", text: '{"decisions":[{"rowid":1,"choice":"review"}]}' }] } as any; } },
    };
    const native = createLateNightRegrets(ports);
    if (boundary === "admission") await expect(native.command()).rejects.toThrow("revoked");
    else {
      if (boundary === "model") await native.setConfig({ decision_model: "fixture/model" });
      await expect(native.tool.execute("call", {})).rejects.toThrow("revoked");
      expect(later).toBe(boundary === "history" ? 0 : boundary === "file" ? 1 : 2);
    }
  } finally { f.root.close(); }
});
test("normal input callback and prompt/resource/config parity", async () => {
  const f = fixture(); try {
    expect(await f.native.command()).toHaveProperty("accepted"); expect(f.counts().admissions).toBe(1);
    expect(f.native.resources.skillPaths[0]).toEndWith("skills/late-night-regrets/SKILL.md");
    expect(f.native.prompt("base")).toContain("30 2 * * *");
    expect(f.native.models()).toEqual([]);
    await expect(f.native.setConfig({ decision_model: "unaccounted/model" })).rejects.toThrow("available");
    await f.native.setConfig({ enabled: false }); expect(f.native.prompt("base")).toBe("base");
    expect(await f.native.command()).toEqual({ disabled: true }); expect(f.counts().admissions).toBe(1);
  } finally { f.root.close(); }
});

import { createHostRegretsPromptExtension, createHostRegretsSettings } from "../../runtime/durable-engine/src/host-regrets-tool.ts";
test("SDK 1.4 request section rebinds current chat/config; accepted command uses normal admission", async () => {
  const f = fixture(); const addon = { createLateNightRegrets };
  let binds = 0;
  try {
    const extension = createHostRegretsPromptExtension(addon, { async bindBeforeModelRequest(input) {
      expect(input.conversationId).toBe(2 as any); binds++; return f.ports;
    } });
    const render = extension.sections![0]!.render;
    const input = { conversationId: 2 } as any;
    expect(await render(input, {} as any)).toContain("Late Night Regrets");
    const settings = createHostRegretsSettings(addon, async () => f.ports);
    await settings.setConfig({ enabled: false });
    expect(await render(input, {} as any)).toBeUndefined();
    await settings.setConfig({ enabled: true, reflections_path: "notes/new-reflections.md" });
    expect(await render(input, {} as any)).toContain("notes/new-reflections.md");
    expect(binds).toBe(3);
    expect(await settings.getConfig()).toHaveProperty("config");
    expect(await settings.getModels()).toEqual({ ok: true, models: [] });
    const accepted = { chat: "chat:a", sourceId: "accepted-command" };
    const command = async (event: typeof accepted) => {
      expect(event).toBe(accepted); return addon.createLateNightRegrets(f.ports).command();
    };
    expect(await command(accepted)).toHaveProperty("accepted");
    expect(f.counts().admissions).toBe(1);
    f.revoke(); await expect(render(input, {} as any)).rejects.toThrow("revoked");
  } finally { f.root.close(); }
});

test("config mutation and post-write authority check share a rollback boundary", async () => {
  const f = fixture(true);
  try {
    await f.native.setConfig({ enabled: true });
    const before = f.root.query("SELECT value FROM extension_kv").get();
    await expect(f.native.setConfig({ enabled: false })).rejects.toThrow("revoked");
    expect(f.root.query("SELECT value FROM extension_kv").get()).toEqual(before);
  } finally { f.root.close(); }
});
