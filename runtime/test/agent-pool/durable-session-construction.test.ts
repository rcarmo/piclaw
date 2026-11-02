import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { spyOn } from "bun:test";
import { AgentPool } from "../../src/agent-pool.js";
import { AgentSessionManager } from "../../src/agent-pool/session-manager.js";
import { createAgentPoolServices } from "../../src/agent-pool/service-factory.js";
import { createAgentPoolModelOptions } from "../model-services-fixture.js";
import { SESSIONS_DIR } from "../../src/core/config.js";
import { archiveChatBranch, initDatabase, storeChatMetadata, getChatBranchByChatJid } from "../../src/db.js";
import * as legacySession from "../../src/agent-pool/session.js";
import { AgentToolFactory } from "../../src/agent-pool/tool-factory.js";
import { AgentSessionBinder } from "../../src/agent-pool/session-binder.js";
import { AgentBranchManager } from "../../src/agent-pool/branch-manager.js";
import { getDb } from "../../src/db/connection.js";

test("durable lookup port must be callable", () => {
  const legacyCreate = spyOn(SessionManager, "create").mockImplementation(() => { throw Error("JSONL forbidden"); });
  try {
    const options = {
      ...createAgentPoolModelOptions(),
      getDurableSession: "invalid-durable-lookup-port",
    } as unknown as ConstructorParameters<typeof AgentPool>[0];
    expect(() => new AgentPool(options)).toThrow("Durable session lookup must be callable");
    expect(legacyCreate).not.toHaveBeenCalled();
  } finally {
    legacyCreate.mockRestore();
  }
});

test("durable service-factory lookup port must be callable", () => {
  const model = createAgentPoolModelOptions();
  const legacyCreate = spyOn(SessionManager, "create").mockImplementation(() => { throw Error("JSONL forbidden"); });
  try {
    const options = {
      pool: new Map(),
      activeForkBaseLeafByChat: new Map(),
      authStorage: model.credentialStore,
      modelRuntime: model.modelRuntime,
      modelRegistry: model.modelRegistry!,
      settingsManager: SettingsManager.inMemory(),
      workspaceDir: process.env.PICLAW_WORKSPACE!,
      getDurableSession: "invalid-service-factory-lookup-port",
    } as unknown as Parameters<typeof createAgentPoolServices>[0];
    expect(() => createAgentPoolServices(options)).toThrow("Durable service factory lookup must be callable");
    expect(legacyCreate).not.toHaveBeenCalled();
  } finally {
    legacyCreate.mockRestore();
  }
});

for (const empty of [false, true]) {
  test(`durable backend ${empty ? "empty" : "exact"} scope never reads legacy factories or creates sessions`, async () => {
    initDatabase();
    const model = createAgentPoolModelOptions();
    const durableSessions = new Map(empty ? [] : [["web:bound", {
      sessionId: "durable", branchId: "main", readPosition: async () => "leaf", readModel: async () => "provider/model",
    }] as const]);
    let factoryReads = 0;
    const compatibility = {
      get createSession(): never { factoryReads++; throw Error("legacy main factory accessed"); },
    };
    const snapshot = () => { try { return readdirSync(SESSIONS_DIR, { recursive: true }).sort(); } catch { return []; } };
    const before = snapshot();
    const spies = [
      ...(["create", "open", "continueRecent"] as const).map(name => spyOn(SessionManager, name).mockImplementation(() => { throw Error("JSONL forbidden"); })),
      ...(["ensureSessionDir", "ensureNamedSessionDir", "createDefaultSession", "createSessionInDir", "lightweightPrewarmSession"] as const)
        .map(name => spyOn(legacySession, name).mockImplementation(() => { throw Error("legacy session setup forbidden"); })),
      spyOn(AgentToolFactory.prototype, "createDefaultTools").mockImplementation(() => { throw Error("legacy tool setup forbidden"); }),
      spyOn(AgentBranchManager.prototype, "mergeChatBranchIntoParent").mockImplementation(() => { throw Error("legacy merge entered"); }),
      spyOn(AgentBranchManager.prototype, "restoreChatBranch").mockImplementation(() => { throw Error("legacy restore entered"); }),
      spyOn(AgentBranchManager.prototype, "renameChatJid").mockImplementation(() => { throw Error("legacy identity rename entered"); }),
      spyOn(AgentBranchManager.prototype, "createForkedChatBranch").mockImplementation(() => { throw Error("legacy fork entered"); }),
      spyOn(AgentBranchManager.prototype, "createRootChatSession").mockImplementation(() => { throw Error("legacy root creation entered"); }),
      spyOn(AgentBranchManager.prototype, "permanentPurgeChatBranch").mockImplementation(() => { throw Error("legacy purge entered"); }),
    ];
    let pool: AgentPool | undefined;
    let services: ReturnType<typeof createAgentPoolServices> | undefined;
    try {
      const options = Object.assign({}, model, { getDurableSession: (chat: string) => durableSessions.get(chat) });
      Object.defineProperties(options, Object.getOwnPropertyDescriptors(compatibility));
      pool = new AgentPool(options);
      const serviceOptions = Object.assign({}, {
        pool: new Map(), activeForkBaseLeafByChat: new Map(),
        authStorage: model.credentialStore, modelRuntime: model.modelRuntime,
        modelRegistry: model.modelRegistry!, settingsManager: SettingsManager.inMemory(), workspaceDir: process.env.PICLAW_WORKSPACE!, getDurableSession: (chat: string) => durableSessions.get(chat),
      });
      Object.defineProperties(serviceOptions, Object.getOwnPropertyDescriptors(compatibility));
      services = createAgentPoolServices(serviceOptions);
      for(const field of ["sessionManager","sessionBinder","toolFactory"])expect(services).not.toHaveProperty(field);
      expect(services).not.toHaveProperty("turnCoordinator");
      const databaseBefore = getDb().serialize();
      let runnerOptionReads = 0;
      // Backend-owned lookup remains live for post-startup routes.
      for (const chat of ["web:bound", "web:unknown"]) {
        await expect(pool.getSessionForIntrospection(chat)).rejects.toThrow("Durable application does not construct legacy sessions");
        await expect(pool.mergeChatBranchIntoParent(chat)).rejects.toThrow("Durable branch rollup unavailable");
        // Native restore now exists. An absent branch must still reject before
        // any legacy fallback or persisted metadata change.
        await expect(pool.restoreChatBranch(chat)).rejects.toThrow(`Unknown chat branch: ${chat}`);
        expect(getDb().serialize()).toEqual(databaseBefore);
        await expect(pool.renameChatJid(chat, "web:renamed")).rejects.toThrow("Durable chat identity rename unavailable");
        await expect(pool.createForkedChatBranch(chat, { agentName: "forked" })).rejects.toThrow("Durable branch fork unavailable");
        await expect(pool.permanentPurgeChatBranch(chat)).rejects.toThrow("Durable branch purge unavailable");
        expect(await pool.applyControlCommand(chat, { type: "rollup", raw: "/rollup" })).toMatchObject({ status: "error", message: "Durable branch rollup unavailable" });
      }
      await expect(pool.createRootChatSession("durable-root")).rejects.toThrow("Durable root session creation unavailable");
      expect(getDb().serialize()).toEqual(databaseBefore);
      expect('runAgent' in pool).toBe(false);
      expect(runnerOptionReads).toBe(0);
      expect(getDb().serialize()).toEqual(databaseBefore);
      if (!empty) {
        expect(await pool.saveSessionPosition("web:bound")).toBe("leaf");
        expect(await pool.getCurrentModelLabel("web:bound")).toBe("provider/model");
      }
      expect(factoryReads).toBe(0);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(snapshot()).toEqual(before);
    } finally {
      await pool?.shutdown();
      await services?.sessionManager?.shutdown();
      for (const spy of spies) spy.mockRestore();
    }
  });
}

test("durable branch discovery stays host-only without legacy session construction", async () => {
  initDatabase();
  const chat = "web:durable-known";
  storeChatMetadata(chat, "2026-10-25T00:00:00.000Z", "durable-known");
  const snapshot = () => { try { return readdirSync(SESSIONS_DIR, { recursive: true }).sort(); } catch { return []; } };
  const filesBefore = snapshot();
  let factoryReads = 0;
  const options = {
    ...createAgentPoolModelOptions(),
    getDurableSession: () => undefined,
    get createSession(): never { factoryReads++; throw Error("legacy factory accessed"); },
  };
  const spies = [
    ...(["create", "open", "continueRecent"] as const).map(name => spyOn(SessionManager, name).mockImplementation(() => { throw Error("JSONL forbidden"); })),
    ...(["ensureSessionDir", "ensureNamedSessionDir", "createDefaultSession", "createSessionInDir", "lightweightPrewarmSession"] as const)
      .map(name => spyOn(legacySession, name).mockImplementation(() => { throw Error("legacy session setup forbidden"); })),
  ];
  let pool: AgentPool | undefined;
  try {
    pool = new AgentPool(options);
    const known = pool.listKnownChats(chat, { includeArchived: true });
    expect(Array.isArray(known)).toBe(true);
    expect(known.some(entry => entry.chat_jid === chat)).toBe(true);
    expect(pool.findChatByAgentName("durable-known")).toEqual({ chat_jid: chat, agent_name: "durable-known" });
    expect(pool.findActiveChatByAgentName("durable-known")).toBeNull();
    expect(pool.getAgentHandleForChat(chat)).toBe("durable-known");

    const archived = archiveChatBranch(chat);
    expect(archived.archived_at).toBeTruthy();
    expect(pool.listKnownChats(chat).some(entry => entry.chat_jid === chat)).toBe(false);
    const knownWithArchived = pool.listKnownChats(chat, { includeArchived: true });
    expect(knownWithArchived.some(entry => entry.chat_jid === chat && entry.archived_at !== null)).toBe(true);
    expect(pool.findChatByAgentName("durable-known")).toBeNull();

    expect(factoryReads).toBe(0);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(filesBefore);
  } finally {
    await pool?.shutdown();
    for (const spy of spies) spy.mockRestore();
  }
});

test("durable pruneChatBranch archives metadata without legacy session construction", async () => {
  initDatabase();
  const chat = "web:native-prune-durable";
  storeChatMetadata(chat, "2026-10-25T00:00:00.000Z");
  const snapshot = () => { try { return readdirSync(SESSIONS_DIR, { recursive: true }).sort(); } catch { return []; } };
  const filesBefore = snapshot();
  let factoryReads = 0;
  const options = {
    ...createAgentPoolModelOptions(),
    getDurableSession: () => undefined,
    get createSession(): never { factoryReads++; throw Error("legacy factory accessed"); },
  };
  const legacyCreate = spyOn(SessionManager, "create").mockImplementation(() => { throw Error("JSONL forbidden"); });
  let pool: AgentPool | undefined;
  try {
    pool = new AgentPool(options);
    const archived = await pool.pruneChatBranch(chat);
    expect(archived.chat_jid).toBe(chat);
    expect(archived.archived_at).toBeTruthy();
    expect(getChatBranchByChatJid(chat)?.archived_at).toBeTruthy();
    expect(factoryReads).toBe(0);
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(filesBefore);
  } finally {
    await pool?.shutdown();
    legacyCreate.mockRestore();
  }
});

test("durable metadata lookup rejects invalid reader contract without legacy construction", async () => {
  initDatabase();
  const chat = "web:native-invalid-metadata-reader";
  const snapshot = () => { try { return readdirSync(SESSIONS_DIR, { recursive: true }).sort(); } catch { return []; } };
  const filesBefore = snapshot();
  let factoryReads = 0;
  const options = {
    ...createAgentPoolModelOptions(),
    getDurableSession: (id: string) => id !== chat ? undefined : {
      sessionId: "durable-metadata",
      branchId: "branch-metadata",
      readMetadata: "invalid-reader" as unknown as () => Promise<unknown>,
    },
    get createSession(): never { factoryReads++; throw Error("legacy factory accessed"); },
  };
  const legacyCreate = spyOn(SessionManager, "create").mockImplementation(() => { throw Error("JSONL forbidden"); });
  let pool: AgentPool | undefined;
  try {
    pool = new AgentPool(options);
    await expect(pool.getDurableSessionMetadata(chat)).rejects.toThrow("Durable metadata reader invalid");
    expect(factoryReads).toBe(0);
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(filesBefore);
  } finally {
    await pool?.shutdown();
    legacyCreate.mockRestore();
  }
});

test("native restore invalid binding contract retains metadata atomicity without legacy construction", async () => {
  initDatabase();
  const chat = "web:native-restore-invalid-contract";
  storeChatMetadata(chat, "2026-10-25T00:00:00.000Z");
  getDb().query("UPDATE chat_branches SET archived_at=? WHERE chat_jid=?").run("2026-10-25T00:01:00.000Z", chat);
  const archived = getChatBranchByChatJid(chat)!;
  let factoryReads = 0;
  const options = {
    ...createAgentPoolModelOptions(),
    getDurableSession: (id: string) => id !== chat ? undefined : {
      sessionId: "same-native-session",
      branchId: archived.branch_id,
      assertCurrent: "invalid-assertion-port" as unknown as () => void,
    },
    get createSession(): never { factoryReads++; throw Error("legacy factory accessed"); },
  };
  const legacyRestore = spyOn(AgentBranchManager.prototype, "restoreChatBranch").mockImplementation(() => { throw Error("legacy restore entered"); });
  const legacyCreate = spyOn(SessionManager, "create").mockImplementation(() => { throw Error("JSONL forbidden"); });
  let pool: AgentPool | undefined;
  try {
    pool = new AgentPool(options);
    const databaseBefore = getDb().serialize();
    const snapshot = () => { try { return readdirSync(SESSIONS_DIR, { recursive: true }).sort(); } catch { return []; } };
    const filesBefore = snapshot();
    await expect(pool.restoreChatBranch(chat, { agentName: "must-rollback" })).rejects.toThrow("Exact native restore binding invalid");
    expect(getDb().serialize()).toEqual(databaseBefore);
    expect(getChatBranchByChatJid(chat)).toEqual(archived);
    expect(factoryReads).toBe(0);
    expect(legacyRestore).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(filesBefore);
  } finally {
    await pool?.shutdown();
    legacyRestore.mockRestore();
    legacyCreate.mockRestore();
  }
});

test("durable shutdown remains host-only without legacy session construction", async () => {
  initDatabase();
  const snapshot = () => { try { return readdirSync(SESSIONS_DIR, { recursive: true }).sort(); } catch { return []; } };
  const filesBefore = snapshot();
  let factoryReads = 0;
  const options = {
    ...createAgentPoolModelOptions(),
    getDurableSession: () => undefined,
    get createSession(): never { factoryReads++; throw Error("legacy factory accessed"); },
  };
  const spies = [
    ...(["create", "open", "continueRecent"] as const).map(name => spyOn(SessionManager, name).mockImplementation(() => { throw Error("JSONL forbidden"); })),
    ...(["ensureSessionDir", "ensureNamedSessionDir", "createDefaultSession", "createSessionInDir", "lightweightPrewarmSession"] as const)
      .map(name => spyOn(legacySession, name).mockImplementation(() => { throw Error("legacy session setup forbidden"); })),
  ];
  const pool = new AgentPool(options);
  try {
    await pool.shutdown();
    await pool.shutdown();
    expect(factoryReads).toBe(0);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(filesBefore);
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

for (const binding of ["missing", "foreign", "stale", "current", "cancelled", "revoked"] as const) {
  test(`native restore ${binding} binding retains metadata atomicity without legacy construction`, async () => {
    initDatabase();
    const chat = `web:native-restore-${binding}`;
    storeChatMetadata(chat, "2026-10-25T00:00:00.000Z");
    getDb().query("UPDATE chat_branches SET archived_at=? WHERE chat_jid=?").run("2026-10-25T00:01:00.000Z", chat);
    const archived = getChatBranchByChatJid(chat)!;
    let factoryReads = 0, ownerChecks = 0;
    const options = {
      ...createAgentPoolModelOptions(),
      getDurableSession: (id: string) => id !== chat || binding === "missing" ? undefined : {
        sessionId: "same-native-session",
        branchId: binding === "foreign" ? "foreign-branch" : archived.branch_id,
        assertCurrent() { ownerChecks++; if (binding === "stale") throw Error("fixture native owner stale"); },
      },
      get createSession(): never { factoryReads++; throw Error("legacy factory accessed"); },
    };
    const legacyRestore = spyOn(AgentBranchManager.prototype, "restoreChatBranch").mockImplementation(() => { throw Error("legacy restore entered"); });
    const legacyCreate = spyOn(SessionManager, "create").mockImplementation(() => { throw Error("JSONL forbidden"); });
    let pool: AgentPool | undefined;
    try {
      pool = new AgentPool(options);
      const databaseBefore = getDb().serialize();
      const snapshot = () => { try { return readdirSync(SESSIONS_DIR, { recursive: true }).sort(); } catch { return []; } };
      const filesBefore = snapshot();
      const controller = new AbortController();
      if (binding === 'cancelled') controller.abort(Error('native restore stopped'));
      const context = { signal: controller.signal, authorise() { if (binding === 'revoked') throw Error('native request revoked'); } };
      if (binding === "current") {
        const restored = await pool.restoreChatBranch(chat, { agentName: "restored-native-handle", ...context });
        expect(restored).toMatchObject({ branch_id: archived.branch_id, chat_jid: chat, root_chat_jid: archived.root_chat_jid,
          parent_branch_id: archived.parent_branch_id, archived_at: null, agent_name: "restored-native-handle" });
        expect(getChatBranchByChatJid(chat)).toEqual(restored);
        expect(ownerChecks).toBe(1);
      } else {
        await expect(pool.restoreChatBranch(chat, { agentName: "must-rollback", ...context })).rejects.toThrow(
          binding === 'cancelled' ? 'native restore stopped' : binding === 'revoked' ? 'native request revoked'
            : binding === "stale" ? "fixture native owner stale" : "Exact native restore binding unavailable");
        expect(getDb().serialize()).toEqual(databaseBefore);
        expect(getChatBranchByChatJid(chat)).toEqual(archived);
        expect(ownerChecks).toBe(binding === "stale" ? 1 : 0);
      }
      expect(factoryReads).toBe(0);
      expect(legacyRestore).not.toHaveBeenCalled(); expect(legacyCreate).not.toHaveBeenCalled();
      expect(snapshot()).toEqual(filesBefore);
    } finally {
      await pool?.shutdown(); legacyRestore.mockRestore(); legacyCreate.mockRestore();
    }
  });
}
