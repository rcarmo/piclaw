/**
 * test/extensions/extensions-builtin-tool-catalog.test.ts
 *
 * Full regression test: every built-in extension factory must register
 * the expected tools without replacing SDK-owned tool restrictions.
 *
 * This test exists because a previous regression shipped a 4-tool
 * fallback baseline (read/bash/edit/write) that silently dropped
 * list_tools, attach_file, and every other extension
 * tool.  CI did not catch it because no test verified the full
 * registered catalog against the intended toolset definitions.
 */

import { describe, expect, test } from "bun:test";
import "../helpers.js";
import { createFakeExtensionApi } from "./fake-extension-api.js";
import { createBuiltinExtensionFactories } from "../../src/extensions/index.js";
import { TOOLSETS } from "../../src/extensions/tool-capabilities.js";

/**
 * Every tool name that a built-in extension factory must register.
 *
 * This is the canonical source-of-truth list.  If a built-in extension
 * adds or removes a tool, this list must be updated — that is the point.
 *
 * Tools provided by packaged/optional extensions (keychain, ssh,
 * bun_run, cdp_browser, office viewers, etc.) are NOT listed
 * here because they are loaded via additionalExtensionPaths and are
 * gated by platform/channel/env.  This test covers only the always-on
 * built-in extension factory catalog from extensions/index.ts.
 */
const EXPECTED_BUILTIN_TOOL_NAMES = [
  // file-attachments
  "attach_file",
  "read_attachment",
  "export_attachment",
  // messages-crud
  "messages",
  // model-control
  "get_model_state",
  "list_models",
  "switch_model",
  "switch_thinking",
  "set_model",
  "provider_quota",
  // internal-tools (discovery)
  "list_tools",
  // runtime-scripts
  "list_scripts",
  // workspace-search
  "search_workspace",
  "refresh_workspace_index",
  // send-adaptive-card
  "send_adaptive_card",
  // send-dashboard-widget
  "send_dashboard_widget",
  // chat-tool
  "chat",
  // open-workspace-file
  "open_workspace_file",
  // env-tools
  "env",
  // image-processing
  "image_process",
];

function runAllBuiltinExtensions() {
  const factories = createBuiltinExtensionFactories();
  const fake = createFakeExtensionApi({ allTools: [] });

  for (const factory of factories) {
    try {
      factory(fake.api);
    } catch (_err) {
      // Some factories may fail without a real DB/env — that is acceptable
      // as long as registerTool calls that precede the failure are captured.
      void _err;
    }
  }

  // Update allTools to reflect everything that was registered
  const allToolEntries = [...fake.tools.entries()].map(([name, tool]) => ({
    name,
    description: tool.description || `${name} tool`,
  }));
  fake.setAllTools(allToolEntries);

  return fake;
}

describe("built-in extension tool catalog regression", () => {
  test("all built-in extension factories register every expected tool", () => {
    const fake = runAllBuiltinExtensions();
    const registeredNames = new Set(fake.tools.keys());

    const missing = EXPECTED_BUILTIN_TOOL_NAMES.filter(
      (name) => !registeredNames.has(name),
    );

    expect(missing, `Missing built-in tools: ${missing.join(", ")}`).toEqual([]);
  });

  test("no unexpected tools are silently dropped from the catalog", () => {
    const fake = runAllBuiltinExtensions();
    const registeredNames = [...fake.tools.keys()].sort();

    // At minimum, we must have at least as many tools as expected
    expect(registeredNames.length).toBeGreaterThanOrEqual(
      EXPECTED_BUILTIN_TOOL_NAMES.length,
    );
  });

  test("session_start preserves SDK-owned tool restrictions", async () => {
    const fake = runAllBuiltinExtensions();

    const before = fake.api.getActiveTools();
    // Fire session_start
    const sessionStartHandlers = fake.handlers.filter(
      (entry) => entry.event === "session_start",
    );
    for (const handler of sessionStartHandlers) {
      try {
        await handler.handler({}, {});
      } catch (_err) {
        // tolerate DB/env failures in test
        void _err;
      }
    }

    expect(fake.api.getActiveTools()).toEqual(before);
    expect(fake.tools.has("activate_tools")).toBe(false);
    expect(fake.tools.has("reset_active_tools")).toBe(false);
  });

  test("every tool referenced in TOOLSETS that is a built-in extension tool is actually registered", () => {
    const fake = runAllBuiltinExtensions();
    const registeredNames = new Set(fake.tools.keys());

    // Tools from TOOLSETS that are provided by packaged/optional extensions
    // and are NOT expected to be registered by built-in factories.
    const OPTIONAL_PACKAGED_TOOLS = new Set([
      "read", "bash", "powershell", "edit", "write", // core SDK tools, not extensions
      "keychain", "ssh",                            // packaged integrations
      "bun_run", "exec_batch", "search_tool_output", // packaged integrations
      "cdp_browser",                                  // packaged browser extension
      "open_office_viewer",                            // packaged viewer extensions
      "office_read", "office_write",                  // packaged office tools
      "start_autoresearch", "stop_autoresearch", "autoresearch_status", // addon-provided experiment tools
      "schedule_task",                                // registered by task scheduler, not extension factory
      "exit_process",                                 // native process-control owner, not legacy extension factory
    ]);

    const toolsetToolNames = TOOLSETS.flatMap((ts) => ts.toolNames);
    const builtinToolsetTools = toolsetToolNames.filter(
      (name) => !OPTIONAL_PACKAGED_TOOLS.has(name),
    );

    const missing = builtinToolsetTools.filter(
      (name) => !registeredNames.has(name),
    );

    expect(
      missing,
      `TOOLSET-referenced built-in tools not registered by extension factories: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  test("tool construction has no manual default-list mechanism", async () => {
    const { AgentToolFactory } = await import("../../src/agent-pool/tool-factory.js");
    for (const platform of ["linux","win32"] as const) expect("createDefaultTools" in new AgentToolFactory({workspaceDir:"/workspace",platform})).toBe(false);
  });
});
