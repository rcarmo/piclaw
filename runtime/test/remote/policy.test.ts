import { describe, expect, test } from "bun:test";
import { getToolCeilingFilter, RESTRICTED_TOOL_DENYLIST } from "../../src/remote/policy.js";

describe("getToolCeilingFilter", () => {
  test("full profile returns null (no restriction)", () => {
    expect(getToolCeilingFilter("full")).toBeNull();
  });

  test("read-only profile blocks all tools (ping/status only)", () => {
    const filter = getToolCeilingFilter("read-only")!;
    expect(filter).toBeTruthy();
    // read-only = ping/status only; no tool execution at all
    expect(filter("read")).toBe(false);
    expect(filter("find")).toBe(false);
    expect(filter("grep")).toBe(false);
    expect(filter("bash")).toBe(false);
    expect(filter("edit")).toBe(false);
    expect(filter("list_tools")).toBe(false);
  });

  test("non-mutating profile allows tools with read-only capability", () => {
    const filter = getToolCeilingFilter("non-mutating")!;
    expect(filter).toBeTruthy();
    // Known read-only tools from tool-capabilities registry
    expect(filter("read")).toBe(true);
    expect(filter("find")).toBe(true);
    expect(filter("grep")).toBe(true);
    expect(filter("ls")).toBe(true);
    expect(filter("list_tools")).toBe(true);
  });

  test("non-mutating profile blocks mutating tools", () => {
    const filter = getToolCeilingFilter("non-mutating")!;
    expect(filter("bash")).toBe(false);
    expect(filter("edit")).toBe(false);
    expect(filter("write")).toBe(false);
  });

  test("restricted profile blocks tools in RESTRICTED_TOOL_DENYLIST", () => {
    const filter = getToolCeilingFilter("restricted")!;
    expect(filter).toBeTruthy();
    for (const tool of RESTRICTED_TOOL_DENYLIST) {
      expect(filter(tool)).toBe(false);
    }
  });

  test("restricted profile allows tools not in denylist", () => {
    const filter = getToolCeilingFilter("restricted")!;
    expect(filter("read")).toBe(true);
    expect(filter("find")).toBe(true);
    expect(filter("grep")).toBe(true);
    expect(filter("ls")).toBe(true);
  });

  test("restricted denylist includes critical security-sensitive tools", () => {
    expect(RESTRICTED_TOOL_DENYLIST.has("bash")).toBe(true);
    expect(RESTRICTED_TOOL_DENYLIST.has("edit")).toBe(true);
    expect(RESTRICTED_TOOL_DENYLIST.has("write")).toBe(true);
    expect(RESTRICTED_TOOL_DENYLIST.has("keychain")).toBe(true);
    expect(RESTRICTED_TOOL_DENYLIST.has("activate_tools")).toBe(true);
    expect(RESTRICTED_TOOL_DENYLIST.has("reset_active_tools")).toBe(true);
  });

  test("custom profile falls back to restricted ceiling", () => {
    const customFilter = getToolCeilingFilter("custom")!;
    const restrictedFilter = getToolCeilingFilter("restricted")!;
    expect(customFilter).toBeTruthy();
    // custom should behave identically to restricted
    for (const tool of RESTRICTED_TOOL_DENYLIST) {
      expect(customFilter(tool)).toBe(false);
    }
    expect(customFilter("read")).toBe(true);
    expect(customFilter("find")).toBe(true);
    // Same results as restricted
    expect(customFilter("bash")).toBe(restrictedFilter("bash"));
    expect(customFilter("read")).toBe(restrictedFilter("read"));
  });
});
