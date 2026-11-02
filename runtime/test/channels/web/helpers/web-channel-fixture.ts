import { initDatabase } from "../../../../src/db.js";
import { WebChannel } from "../../../../src/channels/web.js";
import { createTempWorkspace, getTestWorkspace, setEnv, type TempWorkspace } from "../../../helpers.js";

function createDefaultQueue() {
  return {
    enqueue() {},
  };
}

function createDefaultAgentPool() {
  return {
    setSessionBinder: () => {},
    runAgent: async () => ({ status: "success", result: "ok", attachments: [] }),
    getContextUsageForChat: async () => null,
    listKnownChats: () => [],
  };
}

interface WebChannelFixtureOptions {
  workspace?: "shared" | "temp";
  prefix?: string;
  queue?: any;
  agentPool?: any;
  resetSql?: string | string[];
  seed?: (db: typeof import("../../../../src/db.js")) => void | Promise<void>;
}

/**
 * Create a lightweight WebChannel unit-test fixture with workspace/env wiring,
 * database initialization, optional DB reset/seed hooks, and captured SSE events.
 *
 * @param options Fixture overrides for workspace mode, queue/agentPool stubs, and DB setup.
 * @returns The constructed channel, captured events array, DB module, workspace paths, and cleanup callback.
 */
export async function createWebChannelTestFixture(options: WebChannelFixtureOptions = {}) {
  const workspace: TempWorkspace = options.workspace === "temp"
    ? createTempWorkspace(options.prefix || "piclaw-web-test-")
    : getTestWorkspace();

  const restoreEnv = setEnv({
    PICLAW_WORKSPACE: workspace.workspace,
    PICLAW_STORE: workspace.store,
    PICLAW_DATA: workspace.data,
  });

  initDatabase();

  if (options.resetSql) {
    const statements = Array.isArray(options.resetSql) ? options.resetSql : [options.resetSql];
    const { getDb } = await import("../../../../src/db.js");
    getDb().exec(statements.join("\n"));
  }

  const db = await import("../../../../src/db.js");
  if (typeof options.seed === "function") {
    await options.seed(db);
  }

  const channel = new WebChannel({
    queue: options.queue ?? createDefaultQueue(),
    agentPool: options.agentPool ?? createDefaultAgentPool(),
  });

  const events: Array<{ type: string; data: any }> = [];
  channel.broadcastEvent = (type: string, data: unknown) => {
    events.push({ type, data });
  };

  return {
    workspace,
    db,
    channel,
    events,
    cleanup: () => {
      restoreEnv();
      if (options.workspace === "temp") {
        workspace.cleanup();
      }
    },
  };
}
