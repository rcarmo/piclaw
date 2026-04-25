/**
 * test/extensions/extensions-builtin-tool-catalog.test.ts
 *
 * Full regression test: every built-in extension factory must register
 * the expected tools, and the session_start activation must make the
 * bootstrap-critical tools available in the active set.
 *
 * This test exists because a previous regression shipped a 4-tool
 * fallback baseline (read/bash/edit/write) that silently dropped
 * list_tools, activate_tools, attach_file, and every other extension
 * tool.  CI did not catch it because no test verified the full
 * registered catalog against the intended toolset definitions.
 */

import { describe, expect, test } from "bun:test";
import "../helpers.js";
import { createFakeExtensionApi } from "./fake-extension-api.js";
import { createBuiltinExtensionFactories } from "../../src/extensions/index.js";
import {
  TOOLSETS,
  getDefaultActiveToolNames,
  getEffectiveDefaultActiveToolNames,
} from "../../src/extensions/tool-activation.js";

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
  // internal-tools (discovery)
  "list_tools",
  "list_internal_tools",
  // runtime-scripts
  "list_scripts",
  // tool-activation
  "activate_tools",
  "reset_active_tools",
  // sql-introspect
  "introspect_sql",
  // workspace-search
  "search_workspace",
  "refresh_workspace_index",
  // send-adaptive-card
  "send_adaptive_card",
  // send-dashboard-widget
  "send_dashboard_widget",
  // open-workspace-file
  "open_workspace_file",
  // env-tools
  "env",
  // exit-process
  "exit_process",
  // autoresearch-supervisor
  "start_autoresearch",
  "stop_autoresearch",
  "autoresearch_status",
  // image-processing
  "image_process",
];

/**
 * Bootstrap-critical tools that must be in the default active set.
 * If any of these are missing from a fresh session, the agent loses
 * the ability to discover, activate, or deliver files.
 */
const BOOTSTRAP_CRITICAL_ACTIVE_TOOLS = [
  "list_tools",
  "activate_tools",
  "reset_active_tools",
  "attach_file",
  "messages",
  "exit_process",
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

  test("bootstrap-critical tools are in the default active tool baseline", () => {
    const defaults = getDefaultActiveToolNames("linux");

    const missing = BOOTSTRAP_CRITICAL_ACTIVE_TOOLS.filter(
      (name) => !defaults.includes(name),
    );

    expect(
      missing,
      `Bootstrap-critical tools missing from default active set: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  test("bootstrap-critical tools are in the Windows default active tool baseline", () => {
    const defaults = getDefaultActiveToolNames("win32");

    const missing = BOOTSTRAP_CRITICAL_ACTIVE_TOOLS.filter(
      (name) => !defaults.includes(name),
    );

    expect(
      missing,
      `Bootstrap-critical tools missing from Windows default active set: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  test("session_start activation includes all bootstrap-critical tools in the effective set", async () => {
    const fake = runAllBuiltinExtensions();

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

    const activeTools = fake.api.getActiveTools();
    const missing = BOOTSTRAP_CRITICAL_ACTIVE_TOOLS.filter(
      (name) => !activeTools.includes(name),
    );

    expect(
      missing,
      `Bootstrap-critical tools missing after session_start: ${missing.join(", ")}`,
    ).toEqual([]);
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
      "schedule_task",                                // registered by task scheduler, not extension factory
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

  test("AgentToolFactory initial baseline matches getDefaultActiveToolNames", async () => {
    const { AgentToolFactory } = await import(
      "../../src/agent-pool/tool-factory.js"
    );

    const linuxFactory = new AgentToolFactory({
      workspaceDir: "/workspace",
      platform: "linux",
    });
    const winFactory = new AgentToolFactory({
      workspaceDir: "/workspace",
      platform: "win32",
    });

    expect(linuxFactory.createDefaultTools()).toEqual(
      getDefaultActiveToolNames("linux"),
    );
    expect(winFactory.createDefaultTools()).toEqual(
      getDefaultActiveToolNames("win32"),
    );

    // Explicit bootstrap checks — these must never regress
    expect(linuxFactory.createDefaultTools()).toContain("list_tools");
    expect(linuxFactory.createDefaultTools()).toContain("activate_tools");
    expect(linuxFactory.createDefaultTools()).toContain("attach_file");
    expect(winFactory.createDefaultTools()).toContain("list_tools");
    expect(winFactory.createDefaultTools()).toContain("activate_tools");
    expect(winFactory.createDefaultTools()).toContain("attach_file");
  });
});
