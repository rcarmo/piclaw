import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { spyOn } from "bun:test";
import { AgentPool } from "../../src/agent-pool.js";
import { createAgentPoolServices } from "../../src/agent-pool/service-factory.js";
import { createAgentPoolModelOptions } from "../model-services-fixture.js";
import { SESSIONS_DIR } from "../../src/core/config.js";
import { initDatabase } from "../../src/db.js";
import * as legacySession from "../../src/agent-pool/session.js";
import { AgentToolFactory } from "../../src/agent-pool/tool-factory.js";

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
      get createSideSession(): never { factoryReads++; throw Error("legacy side factory accessed"); },
    };
    const snapshot = () => { try { return readdirSync(SESSIONS_DIR, { recursive: true }).sort(); } catch { return []; } };
    const before = snapshot();
    const spies = [
      ...(["create", "open", "continueRecent"] as const).map(name => spyOn(SessionManager, name).mockImplementation(() => { throw Error("JSONL forbidden"); })),
      ...(["ensureSessionDir", "ensureNamedSessionDir", "createDefaultSession", "createSessionInDir", "lightweightPrewarmSession"] as const)
        .map(name => spyOn(legacySession, name).mockImplementation(() => { throw Error("legacy session setup forbidden"); })),
      spyOn(AgentToolFactory.prototype, "createDefaultTools").mockImplementation(() => { throw Error("legacy tool setup forbidden"); }),
    ];
    let pool: AgentPool | undefined;
    let services: ReturnType<typeof createAgentPoolServices> | undefined;
    try {
      const options = Object.assign({}, model, { getDurableSession: (chat: string) => durableSessions.get(chat) });
      Object.defineProperties(options, Object.getOwnPropertyDescriptors(compatibility));
      pool = new AgentPool(options);
      const serviceOptions = Object.assign({}, {
        pool: new Map(), sidePool: new Map(), activeForkBaseLeafByChat: new Map(),
        authStorage: model.credentialStore, modelRuntime: model.modelRuntime,
        modelRegistry: model.modelRegistry!, settingsManager: SettingsManager.inMemory(), workspaceDir: process.env.PICLAW_WORKSPACE!, getDurableSession: (chat: string) => durableSessions.get(chat),
      });
      Object.defineProperties(serviceOptions, Object.getOwnPropertyDescriptors(compatibility));
      services = createAgentPoolServices(serviceOptions);
      // Backend-owned lookup remains live for post-startup routes.
      for (const chat of ["web:bound", "web:unknown"]) {
        await expect(pool.getSessionForIntrospection(chat)).rejects.toThrow("Durable application does not construct legacy sessions");
        await expect(services.sessionManager.getOrCreate(chat)).rejects.toThrow("Durable application does not construct legacy sessions");
        await expect(services.sessionManager.getOrCreateSide(chat)).rejects.toThrow("Durable application does not construct legacy sessions");
        expect(services.sessionManager.prewarm(chat, { mode: "lightweight" })).toBe(false);
        expect(services.sessionManager.prewarm(chat, { mode: "full" })).toBe(false);
      }
      if (!empty) {
        expect(await pool.saveSessionPosition("web:bound")).toBe("leaf");
        expect(await pool.getCurrentModelLabel("web:bound")).toBe("provider/model");
      }
      expect(factoryReads).toBe(0);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(snapshot()).toEqual(before);
    } finally {
      await pool?.shutdown();
      await services?.sessionManager.shutdown();
      for (const spy of spies) spy.mockRestore();
    }
  });
}
