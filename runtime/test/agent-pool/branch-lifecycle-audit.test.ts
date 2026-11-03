import { afterEach, expect, test } from "bun:test";
import { join } from "path";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createTempWorkspace, importFresh, setEnv } from "../helpers.js";
import { createLegacyCapturePoolOptions } from "../model-services-fixture.js";

let restoreEnv: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
});

function createRuntime(session: any): AgentSessionRuntime {
  return {
    session,
    cwd: "/workspace",
    diagnostics: [],
    services: {} as any,
    modelFallbackMessage: undefined,
    newSession: async (options?: { parentSession?: string; setup?: (sessionManager: SessionManager) => Promise<void> | void }) => ({
      cancelled: !(await session.newSession(options)),
    }),
    switchSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    importFromJsonl: async () => ({ cancelled: false }),
    dispose: async () => {
      session.dispose?.();
    },
  } as any;
}

test("agent pool audit: refuses to prune an active branch session", async () => {
  const ws = createTempWorkspace("piclaw-active-prune-audit-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();
  db.storeChatMetadata("web:default", new Date().toISOString(), "Default");
  const root = db.getChatBranchByChatJid("web:default");
  db.storeChatMetadata("web:default:branch:active", new Date().toISOString(), "Research");
  db.ensureChatBranch({
    chat_jid: "web:default:branch:active",
    root_chat_jid: "web:default",
    parent_branch_id: root?.branch_id ?? null,
    agent_name: "research",
  });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  class ActiveBranchSession {
    sessionName = "Research";
    sessionId = "branch-session";
    isStreaming = true;
    isCompacting = false;
    isRetrying = false;
    isBashRunning = false;
    subscribe(_listener: (event: any) => void) { return () => {}; }
    async prompt(_prompt: string) {}
    async abort() {}
    dispose() {}
  }

  const pool = new AgentPool({
    ...createLegacyCapturePoolOptions(),
    createSession: async () => createRuntime(new ActiveBranchSession()) as any,
  });

  await (pool as any).getOrCreate("web:default:branch:active");

  await expect((pool as any).pruneChatBranch("web:default:branch:active")).rejects.toThrow(
    "Cannot prune a branch while it is active.",
  );
  expect(db.getChatBranchByChatJid("web:default:branch:active")?.archived_at).toBeNull();

  await pool.shutdown();
  ws.cleanup();
});
