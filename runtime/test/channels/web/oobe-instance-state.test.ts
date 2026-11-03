import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createTempWorkspace, importFresh, setEnv } from "../../helpers.js";

let restoreEnv: (() => void) | null = null;
let cleanupWorkspace: (() => void) | null = null;
let db: typeof import("../../../src/db.js");
let oobeState: typeof import("../../../src/channels/web/oobe-instance-state.js");

beforeEach(async () => {
  const ws = createTempWorkspace("piclaw-oobe-instance-state-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
  });

  db = await importFresh<typeof import("../../../src/db.js")>("../src/db.js");
  oobeState = await importFresh<typeof import("../../../src/channels/web/oobe-instance-state.js")>("../src/channels/web/oobe-instance-state.js");
  db.initDatabase();
});

afterEach(() => {
  restoreEnv?.();
  cleanupWorkspace?.();
  restoreEnv = null;
  cleanupWorkspace = null;
});

describe("oobe-instance-state", () => {
  test("returns true when the provider-ready OOBE was explicitly completed for this instance", async () => {
    db.setRouterState("web:oobe:provider-ready:completed", "true");
    expect(await oobeState.isProviderReadyOobeCompletedForInstance()).toBe(true);
  });

  test("auto-completes provider-ready OOBE on established installs with existing conversation history", async () => {
    db.storeMessage({
      id: "msg-oobe-history-1",
      chat_jid: "web:default",
      sender: "user",
      sender_name: "User",
      content: "hello",
      timestamp: "2026-04-20T00:00:00.000Z",
      is_from_me: false,
      is_bot_message: false,
    });

    expect(await oobeState.isProviderReadyOobeCompletedForInstance()).toBe(true);
    const row = db.getDb().prepare("SELECT value FROM router_state WHERE key = ?").get("web:oobe:provider-ready:completed") as { value?: string } | undefined;
    expect(row?.value).toBe("true");
  });

  test("keeps provider-ready OOBE incomplete on fresh installs with no history", async () => {
    expect(await oobeState.isProviderReadyOobeCompletedForInstance()).toBe(false);
  });
});
