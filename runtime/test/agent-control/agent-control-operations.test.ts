/**
 * test/agent-control/agent-control-operations.test.ts – Tests for /shell and /bash handlers.
 *
 * Verifies shell command execution, output formatting, error handling,
 * and the distinction between /shell (tracked) and /bash (raw) modes.
 */

import { describe, test, expect } from "bun:test";
import "../helpers.js";

import { handleShell, handleBash } from "../../src/agent-control/handlers/operations.js";

function makeShellCommand(command?: string) {
  return { type: "shell", command, raw: command ? `/shell ${command}` : "/shell" } as any;
}

function makeBashCommand(command?: string) {
  return { type: "bash", command, raw: command ? `/bash ${command}` : "/bash" } as any;
}

function makeSession(result: any, throws = false) {
  return {
    executeBash: async () => {
      if (throws) throw new Error("boom");
      return result;
    },
  } as any;
}

describe("agent-control operations", () => {
  test("handleShell requires a command", async () => {
    const result = await handleShell({} as any, makeShellCommand());
    expect(result.status).toBe("error");
    expect(result.message).toContain("Usage: /shell <command>");
  });

  test("handleShell runs a command and captures output", async () => {
    const result = await handleShell({} as any, makeShellCommand("printf 'hello'") );
    expect(result.status).toBe("success");
    expect(result.message).toContain("$ printf 'hello'");
    expect(result.message).toContain("hello");
    expect(result.message).toContain("(exit code 0)");
    expect(result.message).toContain("```");
  });

  test("handleShell marks non-zero exit code as error", async () => {
    const result = await handleShell({} as any, makeShellCommand("exit 2"));
    expect(result.status).toBe("error");
    expect(result.message).toContain("(exit code 2)");
    expect(result.message).toContain("```");
  });

  test("handleShell truncates long output", async () => {
    const result = await handleShell(
      {} as any,
      makeShellCommand("printf 'A%.0s' {1..21000}")
    );
    expect(result.message).toContain("(output truncated)");
  });

  test("handleBash requires a command", async () => {
    const result = await handleBash({} as any, makeBashCommand());
    expect(result.status).toBe("error");
    expect(result.message).toContain("Usage: /bash <command>");
  });

  test("handleBash formats successful output", async () => {
    const session = makeSession({ output: "hi", exitCode: 0 });
    const result = await handleBash(session, makeBashCommand("echo hi"));
    expect(result.status).toBe("success");
    expect(result.message).toContain("$ echo hi");
    expect(result.message).toContain("hi");
    expect(result.message).toContain("```");
  });

  test("handleBash marks cancelled output", async () => {
    const session = makeSession({ output: "", cancelled: true });
    const result = await handleBash(session, makeBashCommand("echo hi"));
    expect(result.status).toBe("error");
    expect(result.message).toContain("(cancelled)");
  });

  test("handleBash marks non-zero exit code", async () => {
    const session = makeSession({ output: "", exitCode: 3 });
    const result = await handleBash(session, makeBashCommand("echo hi"));
    expect(result.status).toBe("error");
    expect(result.message).toContain("(exit code 3)");
  });

  test("handleBash surfaces errors", async () => {
    const session = makeSession(null, true);
    const result = await handleBash(session, makeBashCommand("echo hi"));
    expect(result.status).toBe("error");
    expect(result.message).toContain("boom");
  });
});
