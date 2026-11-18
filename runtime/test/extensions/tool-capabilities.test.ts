/**
 * test/extensions/tool-capabilities.test.ts – Tests for tool capability registry.
 */

import { describe, expect, test } from "bun:test";
import { getToolCapability } from "../../src/extensions/tool-capabilities.js";
import { TOOLSETS } from "../../src/extensions/tool-capabilities.js";

describe("tool-capabilities registry", () => {
  test("known tools return specific metadata", () => {
    const bash = getToolCapability("bash");
    expect(bash.kind).toBe("mutating");
    expect(bash.weight).toBe("standard");

    const read = getToolCapability("read");
    expect(read.kind).toBe("read-only");
    expect(read.weight).toBe("lightweight");

    const messages = getToolCapability("messages");
    expect(messages.kind).toBe("mixed");

    const exitProcess = getToolCapability("exit_process");
    expect(exitProcess.kind).toBe("mutating");
    expect(exitProcess.weight).toBe("lightweight");

    // upstream core tools
    const find = getToolCapability("find");
    expect(find.kind).toBe("read-only");

    const grep = getToolCapability("grep");
    expect(grep.kind).toBe("read-only");

    const ls = getToolCapability("ls");
    expect(ls.kind).toBe("read-only");
  });

  test("unknown tools get sensible defaults", () => {
    const unknown = getToolCapability("totally_unknown_tool_xyz");
    expect(unknown.kind).toBe("mixed");
    expect(unknown.weight).toBe("standard");
    expect(unknown.summary).toBeUndefined();
  });

  test("all tools in TOOLSETS have capability entries", () => {
    const missing: string[] = [];
    for (const toolset of TOOLSETS) {
      for (const name of toolset.toolNames) {
        const cap = getToolCapability(name);
        // Every TOOLSET tool should have an explicit entry (not the default)
        if (cap === getToolCapability("__nonexistent__")) {
          missing.push(name);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("summary is only set when overriding the tool description", () => {
    // Most tools should NOT have a summary (they use the tool's own description at runtime)
    const bash = getToolCapability("bash");
    expect(bash.summary).toBeUndefined();

    // refresh_workspace_index has an explicit override
    const refresh = getToolCapability("refresh_workspace_index");
    expect(refresh.summary).toBe("Rebuild the workspace FTS index.");
  });
});
