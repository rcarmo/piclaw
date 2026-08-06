import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pruneAgentLogs, writeAgentLog } from "../../src/agent-pool/logging.js";

function listLogFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = join(prefix, entry.name);
    const fullPath = join(dir, entry.name);
    return entry.isDirectory() ? listLogFiles(fullPath, relative) : [relative];
  });
}

test("writeAgentLog writes a timestamped agent log file in a date shard", () => {
  const logsDir = mkdtempSync(join(tmpdir(), "piclaw-agent-log-"));

  try {
    writeAgentLog(logsDir, "chat:test", 1234, false, "hello world", null);

    const files = listLogFiles(logsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}\/\d{2}\/agent-/);
    const content = readFileSync(join(logsDir, files[0]!), "utf-8");
    expect(content).toContain("Chat: chat:test");
    expect(content).toContain("Duration: 1234ms");
    expect(content).toContain("hello world");
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});

test("writeAgentLog classifies planned restart aborts as interruptions", () => {
  const logsDir = mkdtempSync(join(tmpdir(), "piclaw-agent-log-restart-"));
  try {
    writeAgentLog(logsDir, "chat:restart", 321, false, null, "Request aborted", null, {
      cause: "service_shutdown",
      operation: "agent_control.exit",
      recordedAt: "2026-08-05T00:00:00.000Z",
    });
    const files = listLogFiles(logsDir);
    const content = readFileSync(join(logsDir, files[0]!), "utf-8");
    expect(content).toContain("Outcome: interrupted");
    expect(content).toContain("AbortCause: service_shutdown");
    expect(content).toContain("AbortOperation: agent_control.exit");
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});

test("pruneAgentLogs removes old flat and sharded log files", () => {
  const logsDir = mkdtempSync(join(tmpdir(), "piclaw-agent-log-prune-"));

  try {
    const oldFlat = join(logsDir, "agent-old-flat.log");
    const oldShardDir = join(logsDir, "2026-01", "01");
    const oldSharded = join(oldShardDir, "agent-old-sharded.log");
    const freshFlat = join(logsDir, "agent-fresh.log");
    mkdirSync(oldShardDir, { recursive: true });
    writeFileSync(oldFlat, "old flat");
    writeFileSync(oldSharded, "old sharded");
    writeFileSync(freshFlat, "fresh");

    const now = new Date("2026-06-08T12:00:00.000Z").getTime();
    const old = new Date(now - 31 * 24 * 60 * 60 * 1000);
    utimesSync(oldFlat, old, old);
    utimesSync(oldSharded, old, old);

    expect(pruneAgentLogs(logsDir, 30 * 24 * 60 * 60 * 1000, now)).toBe(2);
    expect(existsSync(oldFlat)).toBe(false);
    expect(existsSync(oldSharded)).toBe(false);
    expect(existsSync(freshFlat)).toBe(true);
    expect(existsSync(oldShardDir)).toBe(false);
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});

test("writeAgentLog suppresses write failures", () => {
  const missingDir = join(tmpdir(), `piclaw-agent-log-missing-${Date.now().toString(36)}`);
  expect(() => writeAgentLog(missingDir, "chat:test", 50, true, null, "boom")).not.toThrow();
  rmSync(missingDir, { recursive: true, force: true });
});
