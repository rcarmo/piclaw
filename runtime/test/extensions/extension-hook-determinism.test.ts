import { describe, expect, test } from "bun:test";

import { runExtensionHookDeterminismAudit } from "./extension-hook-determinism-audit.ts";

describe("built-in extension hook determinism", () => {
  test("preserves before_agent_start hook, tool, and command ordering", async () => {
    const audit = await runExtensionHookDeterminismAudit();

    expect(audit.ok, audit.detail).toBe(true);
    expect(audit.before_agent_start_hooks).toBeGreaterThan(0);
    expect(audit.context_hooks).toBeGreaterThan(0);
    expect(audit.repeated_match).toBe(true);
    expect(audit.fresh_match).toBe(true);
    expect(audit.hook_order).toEqual([
      "fileAttachments",
      "messagesCrud",
      "modelControl",
      "internalTools",
      "runtimeScripts",
      "toolActivation",
      "sqlIntrospect",
      "workspaceSearch",
      "workspaceMemoryBootstrap",
      "sendAdaptiveCard",
      "sendDashboardWidget",
      "chatTool",
      "sessionControl",
      "openWorkspaceFile",
      "envTools",
      "imageProcessing",
      "localLitePromptProfile",
    ]);
    expect(audit.context_hook_order).toEqual(["fileAttachments", "contextPrune", "llmContextNormalizer"]);
    expect(audit.final_system_prompt).toContain("## File Attachments");
    expect(audit.final_system_prompt).toContain("## Script discovery");
    expect(audit.final_system_prompt).toContain("## Database Introspection");
    expect(audit.final_system_prompt).toContain("## Workspace search");
    expect(audit.final_system_prompt).toContain("## Workspace memory bootstrap");
    expect(audit.final_system_prompt).toContain("## Dashboard widget posting");
    expect(audit.context_messages).toEqual([
      {
        role: "user",
        timestamp: 0,
        content: [
          { type: "text", text: "hello" },
          { type: "text", text: "[Invalid image block removed: unsupported MIME image/svg+xml]" },
        ],
      },
      {
        role: "assistant",
        timestamp: 0,
        content: [{ type: "text", text: "" }],
      },
    ]);
  });
});
