import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";

import { createRealTestModelServices } from "../model-services-fixture.js";
import { importFresh, setEnv } from "../helpers.js";

function makeAssistantMessage(text = "ready") {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    timestamp: Date.now(),
  } as any;
}

function makeLargeTextToolResult(textChars = 300_000) {
  return {
    role: "toolResult",
    toolCallId: "call-test",
    toolName: "read",
    content: [{ type: "text", text: "X".repeat(textChars) }],
    timestamp: Date.now(),
  } as any;
}

test("session tool-result env limits reject malformed suffixes at module initialization", { timeout: 30000 }, async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "piclaw-session-strict-env-"));
  const sessionDir = join(tempRoot, "session");
  const restore = setEnv({
    PICLAW_SESSION_TOOL_RESULT_MAX_PERSIST_BYTES: "500000oops",
    PICLAW_SESSION_FILE_PRELOAD_SANITIZE_MIN_BYTES: "500000oops",
    PICLAW_SESSION_TOOL_RESULT_PREVIEW_CHARS: "20oops",
  });

  try {
    const [{ createSessionInDir }, { modelRuntime }] = await Promise.all([
      importFresh<typeof import("../../src/agent-pool/session.js")>("../src/agent-pool/session.ts"),
      createRealTestModelServices(join(tempRoot, "agent")),
    ]);
    const settingsManager = SettingsManager.create(process.env.PICLAW_WORKSPACE || "/workspace", getAgentDir());
    const runtime = await createSessionInDir(sessionDir, {
      modelRuntime,
      settingsManager,
      tools: [],
      chatJid: "web:test",
    });

    runtime.session.sessionManager.appendMessage(makeAssistantMessage("seed"));
    runtime.session.sessionManager.appendMessage(makeLargeTextToolResult());

    const sessionText = readFileSync(runtime.session.sessionFile!, "utf8");
    const context = runtime.session.sessionManager.buildSessionContext();
    const toolResult = context.messages.find((message: any) => message.role === "toolResult") as any;
    const text = String(toolResult?.content?.[0]?.text || "");

    expect(sessionText).toContain("Persisted tool result truncated");
    expect(text).toContain("Persisted tool result truncated");
    expect(text.length).toBeGreaterThan(100);

    await runtime.dispose();
  } finally {
    restore();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
