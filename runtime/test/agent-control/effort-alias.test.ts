/**
 * test/agent-control/effort-alias.test.ts – Tests for /effort alias and thinking level label logic.
 */

import { describe, expect, test } from "bun:test";
import "../helpers.js";
import {
  resolveThinkingAlias,
  isEffortProvider,
  formatThinkingLevelForDisplay,
  EFFORT_PROVIDER_THINKING_LEVEL_ALIASES,
} from "../../src/agent-control/agent-control-helpers.js";
import { parseControlCommand } from "../../src/agent-control/index.js";

describe("thinking level alias helpers", () => {
  test("resolveThinkingAlias maps provider-native aliases to internal levels", () => {
    expect(resolveThinkingAlias("max", "anthropic")).toBe("xhigh");
    expect(resolveThinkingAlias("high", "anthropic")).toBe("high");
    expect(resolveThinkingAlias("low", "anthropic")).toBe("low");
    expect(resolveThinkingAlias("off", "anthropic")).toBe("off");
    expect(resolveThinkingAlias("unknown", "anthropic")).toBe("unknown");
    // max is NOT resolved on non-Anthropic providers
    expect(resolveThinkingAlias("max", "openai")).toBe("max");
    expect(resolveThinkingAlias("max", null)).toBe("max");
  });

  test("isEffortProvider identifies Anthropic as effort-terminology provider", () => {
    expect(isEffortProvider("anthropic")).toBe(true);
    expect(isEffortProvider("Anthropic")).toBe(true);
    expect(isEffortProvider("ANTHROPIC")).toBe(true);
    expect(isEffortProvider("openai")).toBe(false);
    expect(isEffortProvider(null)).toBe(false);
    expect(isEffortProvider(undefined)).toBe(false);
  });

  test("formatThinkingLevelForDisplay uses provider-native terms for Anthropic", () => {
    expect(formatThinkingLevelForDisplay("xhigh", "anthropic")).toBe("max");
    expect(formatThinkingLevelForDisplay("high", "anthropic")).toBe("high");
    expect(formatThinkingLevelForDisplay("low", "anthropic")).toBe("low");
    expect(formatThinkingLevelForDisplay("off", "anthropic")).toBe("off");
  });

  test("formatThinkingLevelForDisplay leaves non-Anthropic levels unchanged", () => {
    expect(formatThinkingLevelForDisplay("xhigh", "openai")).toBe("xhigh");
    expect(formatThinkingLevelForDisplay("xhigh", null)).toBe("xhigh");
    expect(formatThinkingLevelForDisplay("high", "openai")).toBe("high");
  });

  test("EFFORT_PROVIDER_THINKING_LEVEL_ALIASES contains expected mappings", () => {
    expect(EFFORT_PROVIDER_THINKING_LEVEL_ALIASES).toEqual({ max: "xhigh" });
  });
});

describe("/effort command parsing", () => {
  test("/effort is parsed as a thinking command", () => {
    const cmd = parseControlCommand("/effort high");
    expect(cmd?.type).toBe("thinking");
    expect(cmd && "level" in cmd ? cmd.level : null).toBe("high");
  });

  test("/effort max is parsed as a thinking command with level max", () => {
    const cmd = parseControlCommand("/effort max");
    expect(cmd?.type).toBe("thinking");
    expect(cmd && "level" in cmd ? cmd.level : null).toBe("max");
  });

  test("/effort with no args queries current level", () => {
    const cmd = parseControlCommand("/effort");
    expect(cmd?.type).toBe("thinking");
    expect(cmd && "level" in cmd ? cmd.level : null).toBeFalsy();
  });

  test("/thinking still works as before", () => {
    const cmd = parseControlCommand("/thinking medium");
    expect(cmd?.type).toBe("thinking");
    expect(cmd && "level" in cmd ? cmd.level : null).toBe("medium");
  });
});
