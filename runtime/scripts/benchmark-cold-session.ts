#!/usr/bin/env bun

/**
 * benchmark-cold-session.ts — measure fresh-process Piclaw session bootstrap cost.
 *
 * Runs each sample in a child Bun process so module caches and singleton state do
 * not hide cold-start regressions. By default it uses a temporary empty
 * workspace; pass --workspace <path> to benchmark a real workspace.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

interface ChildResult {
  ok: boolean;
  durationMs: number;
  rssBeforeBytes: number;
  rssAfterBytes: number;
  rssDeltaBytes: number;
  workspace: string;
  chatJid: string;
  error?: string;
}

interface Summary {
  runs: number;
  chatJid: string;
  workspace: string;
  durationMs: Stats;
  rssDeltaBytes: Stats;
  samples: ChildResult[];
}

interface Stats {
  min: number;
  median: number;
  max: number;
  avg: number;
}

function parseArgs(args: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      parsed[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "-" : "";
  let value = Math.abs(bytes);
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${sign}${value.toFixed(digits)} ${units[unitIndex]}`;
}

function stats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    min: sorted[0] ?? 0,
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    avg: sorted.length ? sum / sorted.length : 0,
  };
}

function printSummary(summary: Summary): void {
  console.log("Cold session benchmark");
  console.log(`  workspace: ${summary.workspace}`);
  console.log(`  chat_jid:  ${summary.chatJid}`);
  console.log(`  runs:      ${summary.runs}`);
  console.log("  duration:  " + [
    `min ${summary.durationMs.min.toFixed(1)} ms`,
    `median ${summary.durationMs.median.toFixed(1)} ms`,
    `avg ${summary.durationMs.avg.toFixed(1)} ms`,
    `max ${summary.durationMs.max.toFixed(1)} ms`,
  ].join(" / "));
  console.log("  rss delta: " + [
    `min ${formatBytes(summary.rssDeltaBytes.min)}`,
    `median ${formatBytes(summary.rssDeltaBytes.median)}`,
    `avg ${formatBytes(summary.rssDeltaBytes.avg)}`,
    `max ${formatBytes(summary.rssDeltaBytes.max)}`,
  ].join(" / "));
}

async function runChild(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tempRoot = mkdtempSync(join(tmpdir(), "piclaw-cold-session-"));
  const workspace = typeof args.workspace === "string" ? resolve(args.workspace) : join(tempRoot, "workspace");
  const dataDir = join(tempRoot, "data");
  const storeDir = join(tempRoot, "store");
  const sessionDir = join(tempRoot, "session");
  const chatJid = typeof args["chat-jid"] === "string" ? args["chat-jid"] : "web:benchmark";

  process.env.PICLAW_WORKSPACE = workspace;
  process.env.PICLAW_DATA = dataDir;
  process.env.PICLAW_STORE = storeDir;
  process.env.PICLAW_DB_IN_MEMORY = "1";
  process.env.PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX = "1";
  process.env.PICLAW_DISABLE_STARTUP_SESSION_WARMUP = "1";

  try {
    mkdirSync(workspace, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(storeDir, { recursive: true });

    const before = process.memoryUsage().rss;
    const started = performance.now();
    const [{ AuthStorage, ModelRegistry, SettingsManager, getAgentDir }, { createSessionInDir }] = await Promise.all([
      import("@mariozechner/pi-coding-agent"),
      import("../src/agent-pool/session.ts"),
    ]);

    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const settingsManager = SettingsManager.create(workspace, getAgentDir());
    const runtime = await createSessionInDir(sessionDir, {
      authStorage,
      modelRegistry,
      settingsManager,
      tools: [],
      chatJid,
    });
    const durationMs = performance.now() - started;
    const after = process.memoryUsage().rss;
    runtime.dispose?.();

    const result: ChildResult = {
      ok: true,
      durationMs,
      rssBeforeBytes: before,
      rssAfterBytes: after,
      rssDeltaBytes: after - before,
      workspace,
      chatJid,
    };
    console.log(JSON.stringify(result));
  } catch (error) {
    const result: ChildResult = {
      ok: false,
      durationMs: 0,
      rssBeforeBytes: 0,
      rssAfterBytes: 0,
      rssDeltaBytes: 0,
      workspace,
      chatJid,
      error: error instanceof Error ? error.stack || error.message : String(error),
    };
    console.log(JSON.stringify(result));
    process.exitCode = 1;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runParent(): void {
  const args = parseArgs(process.argv.slice(2));
  const runs = readPositiveInt(args.runs, 3);
  const json = Boolean(args.json);
  const workspace = typeof args.workspace === "string" ? resolve(args.workspace) : "<empty-temp-workspace>";
  const chatJid = typeof args["chat-jid"] === "string" ? args["chat-jid"] : "web:benchmark";
  const samples: ChildResult[] = [];

  for (let index = 0; index < runs; index++) {
    const childArgs = [import.meta.path, "--child", "--chat-jid", chatJid];
    if (typeof args.workspace === "string") childArgs.push("--workspace", resolve(args.workspace));
    const child = spawnSync(process.execPath, childArgs, {
      cwd: resolve(import.meta.dir, ".."),
      env: {
        ...process.env,
        PICLAW_DB_IN_MEMORY: "1",
        PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX: "1",
        PICLAW_DISABLE_STARTUP_SESSION_WARMUP: "1",
      },
      encoding: "utf8",
    });
    const line = child.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
    let parsed: ChildResult | null = null;
    try {
      parsed = JSON.parse(line) as ChildResult;
    } catch {
      throw new Error(`Cold-session child did not return JSON. exit=${child.status}\nstdout=${child.stdout}\nstderr=${child.stderr}`);
    }
    if (!parsed.ok || child.status !== 0) {
      throw new Error(parsed.error || child.stderr || `Cold-session child failed with exit ${child.status}`);
    }
    samples.push(parsed);
  }

  const summary: Summary = {
    runs,
    chatJid,
    workspace,
    durationMs: stats(samples.map((sample) => sample.durationMs)),
    rssDeltaBytes: stats(samples.map((sample) => sample.rssDeltaBytes)),
    samples,
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSummary(summary);
  }
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (args.child) {
    await runChild();
  } else {
    runParent();
  }
}
