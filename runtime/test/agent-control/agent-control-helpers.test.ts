/**
 * test/agent-control/agent-control-helpers.test.ts – Tests for helper functions.
 *
 * Covers formatCompactNumber(), formatCurrency(), formatShellBlock(),
 * truncateText(), extractTextFromContent(), normalizeModelMatch(),
 * and runPromptAndCapture().
 */

import { expect, test } from "bun:test";

import { createTempWorkspace } from "../helpers.js";
import {
  extractTextFromContent,
  formatCompactNumber,
  formatCurrency,
  formatShellBlock,
  formatThinkingLevelForDisplay,
  normalizeModelMatch,
  resolveThinkingAlias,
  runPromptAndCapture,
  truncateText,
} from "../../src/agent-control/agent-control-helpers.js";

class PromptSession {
  private listeners: Array<(event: any) => void> = [];

  subscribe(fn: (event: any) => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((listener) => listener !== fn);
    };
  }

  async prompt(_text: string) {
    for (const listener of this.listeners) {
      listener({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello" },
      });
      listener({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
      });
    }
  }
}

test("formatting helpers format numbers and currency", () => {
  expect(formatCompactNumber(950)).toBe("950");
  expect(formatCompactNumber(1500)).toBe("1.5K");
  expect(formatCompactNumber(2_500_000)).toBe("2.5M");
  expect(formatCurrency(0)).toBe("$0");
  expect(formatCurrency(0.009)).toBe("$0.0090");
  expect(formatCurrency(1.5)).toBe("$1.50");
});

test("formatShellBlock renders command with metadata", () => {
  const block = formatShellBlock("echo hi", "hi\n", ["(exit code 0)"]);
  expect(block).toContain("$ echo hi");
  expect(block).toContain("hi");
  expect(block).toContain("(exit code 0)");
});

test("resolveShellCwd prefers configured WORKSPACE_DIR over legacy /workspace", () => {
  const ws = createTempWorkspace("piclaw-shell-cwd-");

  try {
    const run = Bun.spawnSync({
      cmd: [
        "bun",
        "-e",
        'import { resolveShellCwd } from "./src/agent-control/agent-control-helpers.js"; console.log(resolveShellCwd());',
      ],
      cwd: "/workspace/piclaw/runtime",
      env: {
        ...process.env,
        PICLAW_WORKSPACE: ws.workspace,
        PICLAW_STORE: ws.store,
        PICLAW_DATA: ws.data,
        PICLAW_DB_IN_MEMORY: "1",
      },
    });

    expect(run.exitCode, run.stderr.toString() || run.stdout.toString()).toBe(0);
    expect(run.stdout.toString().trim()).toBe(ws.workspace);
  } finally {
    ws.cleanup();
  }
});

test("truncateText and extractTextFromContent", () => {
  expect(truncateText("hello", 10)).toBe("hello");
  expect(truncateText("hello world", 6)).toBe("hello…");
  expect(extractTextFromContent([{ type: "text", text: "A" }, { type: "image" }, { type: "text", text: "B" }]))
    .toBe("AB");
});

test("normalizeModelMatch finds provider/id case-insensitively", () => {
  const models = [
    { provider: "OpenAI", id: "gpt-test" },
    { provider: "Anthropic", id: "claude" },
  ] as any;
  const match = normalizeModelMatch(models, "openai", "GPT-TEST");
  expect(match?.provider).toBe("OpenAI");
});

test("thinking aliases and labels are provider-aware", () => {
  expect(resolveThinkingAlias("max", "anthropic")).toBe("xhigh");
  expect(resolveThinkingAlias("max", "openai")).toBe("max");
  expect(resolveThinkingAlias("high", "anthropic")).toBe("high");
  expect(formatThinkingLevelForDisplay("xhigh", "anthropic")).toBe("max");
  expect(formatThinkingLevelForDisplay("xhigh", "openai")).toBe("xhigh");
});

test("runPromptAndCapture captures assistant output", async () => {
  const session = new PromptSession();
  const result = await runPromptAndCapture(session as any, "hi");
  expect(result).toBe("Hello world");
});
