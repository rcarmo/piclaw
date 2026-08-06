/**
  * test/agent-pool/omp-rpc-pilot.test.ts – Integration test for the omp RPC engine pilot.
  *
  * Drives a REAL `omp --mode rpc` subprocess (with real LLM calls) through
  * AgentPool.runAgent() when PICLAW_AGENT_ENGINE=omp-rpc. Verifies:
  *   1. A prompt round trip returns success with the expected marker text.
  *   2. Token usage is recorded into the token_usage table for the chat.
  *   3. The host-tool round trip (omp model -> xd:// device -> host_tool_call
  *      -> piclaw's real introspect_sql.execute -> host_tool_result -> bridged
  *      message_end toolResult evidence) succeeds.
  *
  * Requires omp to be independently authenticated on this machine. This is an
  * integration test, not a unit test — it spawns a child process and makes live
  * model calls, so it uses a generous per-test timeout.
  */

import { expect, test, afterEach } from "bun:test";
import { getTestWorkspace, importFresh, setEnv } from "../helpers.js";
import { createAgentPoolModelOptions } from "../model-services-fixture.js";
import { createLogger, debugSuppressedError } from "../../src/utils/logger.js";

const log = createLogger("test.omp-rpc-pilot");

let restoreEnv: (() => void) | null = null;

afterEach(async () => {
  restoreEnv?.();
  restoreEnv = null;
  try {
    const sshCore = await import("../../src/extensions/ssh-core.js");
    sshCore.setSshConnectionResolverForTests(null);
    await sshCore.unregisterLiveChatSshSession("web:default");
  } catch (error) {
    // Ignore: cleanup is best-effort.
    debugSuppressedError(log, "SSH cleanup hook failed; cleanup is best-effort.", error);
  }
});

test("omp-rpc engine pilots a real omp subprocess end to end", { timeout: 240_000 }, async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
    PICLAW_AGENT_ENGINE: "omp-rpc",
  });

  // Import db.js fresh FIRST: Bun's query-param import re-evaluates and replaces
  // the cache entry, so the pool's own transitive db.js import (resolved when we
  // importFresh agent-pool.js next) binds to THIS same module instance — verified
  // empirically: fresh.getDb() === base.getDb() is true, and rows written through
  // one importFresh'd graph are visible to another.
  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();
  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  // No createSession override: the omp-rpc branch in runAgent early-returns to
  // OmpRpcPool before runAgentPrompt/getOrCreateRuntime touches pi session creation.
  const pool = new AgentPool({ ...createAgentPoolModelOptions() });

  try {
    // 1. Prompt round trip through the real omp subprocess.
    const output = await pool.runAgent("Reply with exactly: PILOT_OK", "test:omp-pilot", { timeoutMs: 120_000 });
    expect(output.status).toBe("success");
    expect(String(output.result ?? "")).toContain("PILOT_OK");

    // 2. Usage recording flows through the pool into the token_usage table.
    const usageRow = db
      .getDb()
      .prepare("SELECT COUNT(*) AS c, COALESCE(SUM(total_tokens), 0) AS t FROM token_usage WHERE chat_jid = ?")
      .get("test:omp-pilot") as { c: number; t: number };
    expect(usageRow.c).toBeGreaterThanOrEqual(1);
    expect(usageRow.t).toBeGreaterThan(0);

    // 3. Host-tool round trip. omp exposes RPC host tools to the model via its
    // xd:// device idiom (read docs / write JSON args), so the model runs
    // introspect_sql through read/write calls rather than a tool call named
    // "introspect_sql". The deterministic proof is a toolResult message whose
    // text contains "Query returned" — produced only by sql-introspect.ts.
    // Retry up to 3 times: the model may occasionally answer without running
    // the query; the assertion itself is unchanged.
    let toolResultTexts: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      toolResultTexts = [];
      await pool.runAgent("Run the introspect_sql tool with the query SELECT 1 AS ok", "test:omp-pilot", {
        timeoutMs: 120_000,
        onEvent: (event) => {
          if (event.type !== "message_end") return;
          const message = event.message;
          if (!message || typeof message !== "object") return;
          if (!("role" in message) || message.role !== "toolResult") return;
          if (!("content" in message)) return;
          const content = message.content;
          if (!Array.isArray(content)) return;
          for (const item of content) {
            if (item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item) {
              const text = item.text;
              if (typeof text === "string") toolResultTexts.push(text);
            }
          }
        },
      });
      if (toolResultTexts.some((text) => text.includes("Query returned"))) break;
    }
    expect(toolResultTexts.some((text) => text.includes("Query returned"))).toBe(true);
  } finally {
    try {
      await pool.shutdown();
    } catch (error) {
      // Ignore: shutdown must still run, but its failure must not mask test results.
      debugSuppressedError(log, "AgentPool shutdown failed in test teardown.", error);
    }
  }
});
