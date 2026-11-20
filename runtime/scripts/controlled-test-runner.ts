#!/usr/bin/env bun

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { assertTestWorkspaceArguments, ensureTestFilesystemIsolation } from "./test-filesystem-isolation.js";

type RunnerOptions = {
  stageSize: number;
  sampleMs: number;
  reportPath: string | null;
  useInMemoryDb: boolean;
  passthroughArgs: string[];
};

type ProcEntry = {
  pid: number;
  ppid: number;
  rssKb: number;
};

type StagePlan = {
  index: number;
  files: string[];
};

type StageResult = {
  index: number;
  file_count: number;
  files: string[];
  elapsed_ms: number;
  exit_code: number;
  peak_process_tree_rss_kb: number;
  peak_cgroup_memory_bytes: number | null;
  peak_process_tree_at_ms: number;
  peak_cgroup_at_ms: number | null;
  samples: number;
};

type ControlledTestReport = {
  generated_at: string;
  package_dir: string;
  runtime_dir: string;
  stage_size: number;
  sample_ms: number;
  use_in_memory_db: boolean;
  base_bun_args: string[];
  total_files: number;
  stages_completed: number;
  elapsed_ms: number;
  max_peak_process_tree_rss_kb: number;
  max_peak_cgroup_memory_bytes: number | null;
  failed_stage_index: number | null;
  exit_code: number;
  stages: StageResult[];
};

function printUsage(): void {
  console.log([
    "Usage: bun run test:controlled -- [--stage-size N] [--sample-ms N] [--report PATH] [--no-db-in-memory] [-- <test options/files>]",
    "",
    "Defaults:",
    "  - discovers runtime/test/**/*.test.ts",
    "  - runs stages sequentially in fresh Bun processes",
    "  - forces --max-concurrency=1 unless already supplied",
    "  - sets PICLAW_DB_IN_MEMORY=1 unless disabled",
    "  - does not write a JSON report unless --report PATH is supplied",
  ].join("\n"));
}

function parsePositiveInt(value: string | undefined, fallback: number, min = 1): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function parseArgs(argv = process.argv.slice(2)): RunnerOptions {
  const args = [...argv];
  let stageSize = 25;
  let sampleMs = 1000;
  let reportPath = "";
  let useInMemoryDb = true;
  let passthroughArgs: string[] = [];

  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg === "--") {
      passthroughArgs = args.splice(0, args.length);
      break;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--stage-size") {
      stageSize = parsePositiveInt(args.shift(), stageSize);
      continue;
    }
    if (arg.startsWith("--stage-size=")) {
      stageSize = parsePositiveInt(arg.slice("--stage-size=".length), stageSize);
      continue;
    }
    if (arg === "--sample-ms") {
      sampleMs = parsePositiveInt(args.shift(), sampleMs);
      continue;
    }
    if (arg.startsWith("--sample-ms=")) {
      sampleMs = parsePositiveInt(arg.slice("--sample-ms=".length), sampleMs);
      continue;
    }
    if (arg === "--report") {
      reportPath = String(args.shift() || "").trim();
      continue;
    }
    if (arg.startsWith("--report=")) {
      reportPath = arg.slice("--report=".length).trim();
      continue;
    }
    if (arg === "--no-db-in-memory") {
      useInMemoryDb = false;
      continue;
    }
    passthroughArgs.push(arg);
  }

  return {
    stageSize,
    sampleMs,
    reportPath: reportPath ? resolve(process.cwd(), reportPath) : null,
    useInMemoryDb,
    passthroughArgs,
  };
}

function hasMaxConcurrencyArg(args: string[]): boolean {
  return args.some((arg, index) => arg === "--max-concurrency" || arg.startsWith("--max-concurrency=") || (args[index - 1] === "--max-concurrency"));
}

function isTestFileLike(arg: string): boolean {
  const trimmed = String(arg || "").trim();
  return trimmed.endsWith(".test.ts") || trimmed.endsWith(".test.js") || trimmed.endsWith(".optional.test.ts") || trimmed.endsWith(".optional.test.js");
}

function normalizeFileArg(arg: string): string {
  const trimmed = String(arg || "").trim().replace(/\\/g, "/");
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("runtime/")) return trimmed.slice("runtime/".length);
  return trimmed;
}

async function discoverTestFiles(runtimeDir: string): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob("test/**/*.test.ts");
  for await (const match of glob.scan({ cwd: runtimeDir, absolute: false })) {
    files.push(match);
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function splitPassthroughArgs(args: string[]): { fileArgs: string[]; optionArgs: string[] } {
  const fileArgs: string[] = [];
  const optionArgs: string[] = [];
  for (const arg of args) {
    if (isTestFileLike(arg)) fileArgs.push(normalizeFileArg(arg));
    else optionArgs.push(arg);
  }
  return { fileArgs, optionArgs };
}

function chunkFiles(files: string[], stageSize: number): StagePlan[] {
  const stages: StagePlan[] = [];
  for (let index = 0; index < files.length; index += stageSize) {
    stages.push({ index: stages.length + 1, files: files.slice(index, index + stageSize) });
  }
  return stages;
}

function readProcEntries(): ProcEntry[] {
  const entries: ProcEntry[] = [];
  let procDirs: string[];
  try {
    procDirs = readdirSync("/proc");
  } catch {
    return entries;
  }

  for (const name of procDirs) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const text = readFileSync(`/proc/${name}/status`, "utf8");
      const ppidMatch = text.match(/^PPid:\s+(\d+)$/m);
      const rssMatch = text.match(/^VmRSS:\s+(\d+)\s+kB$/m);
      entries.push({
        pid: Number(name),
        ppid: ppidMatch ? Number(ppidMatch[1]) : 0,
        rssKb: rssMatch ? Number(rssMatch[1]) : 0,
      });
    } catch (error) {
      console.debug("[controlled-test] Process exited before /proc status could be read.", error, { pid: name });
    }
  }
  return entries;
}

function measureProcessTreeRssKb(rootPid: number): number {
  if (!Number.isFinite(rootPid) || rootPid <= 0) return 0;
  const entries = readProcEntries();
  const childrenByParent = new Map<number, number[]>();
  const rssByPid = new Map<number, number>();
  for (const entry of entries) {
    rssByPid.set(entry.pid, entry.rssKb);
    const siblings = childrenByParent.get(entry.ppid) ?? [];
    siblings.push(entry.pid);
    childrenByParent.set(entry.ppid, siblings);
  }

  let total = 0;
  const queue = [rootPid];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    total += rssByPid.get(pid) ?? 0;
    for (const child of childrenByParent.get(pid) ?? []) queue.push(child);
  }
  return total;
}

function readCgroupMemoryCurrent(): number | null {
  try {
    const text = readFileSync("/proc/self/cgroup", "utf8");
    const line = text.split("\n").find((entry) => entry.startsWith("0::"));
    if (!line) return null;
    const relativePath = line.slice(3).trim();
    const fullPath = relativePath && relativePath !== "/"
      ? `/sys/fs/cgroup${relativePath}/memory.current`
      : "/sys/fs/cgroup/memory.current";
    const raw = readFileSync(fullPath, "utf8").trim();
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

async function runStage(
  runtimeDir: string,
  stage: StagePlan,
  baseArgs: string[],
  sampleMs: number,
  env: Record<string, string | undefined>,
): Promise<StageResult> {
  const cmd = [process.execPath, join(import.meta.dir, "local-test-priority.ts"), "--cwd", runtimeDir, "--", process.execPath, "test", ...baseArgs, ...stage.files];
  console.log(`\n[controlled-test] stage ${stage.index}: ${stage.files.length} file(s)`);
  if (stage.files.length <= 3) {
    for (const file of stage.files) console.log(`[controlled-test]   ${file}`);
  } else {
    console.log(`[controlled-test]   ${stage.files[0]} … ${stage.files[stage.files.length - 1]}`);
  }

  const startedAt = Date.now();
  const child = Bun.spawn(cmd, {
    cwd: runtimeDir,
    stdout: "inherit",
    stderr: "inherit",
    env,
  });

  let peakProcessTreeRssKb = 0;
  let peakCgroupMemoryBytes: number | null = null;
  let peakProcessTreeAtMs = 0;
  let peakCgroupAtMs: number | null = null;
  let samples = 0;

  const sample = (alive: boolean) => {
    const elapsedMs = Date.now() - startedAt;
    const processTreeRssKb = measureProcessTreeRssKb(child.pid);
    const cgroupMemoryBytes = readCgroupMemoryCurrent();
    samples += 1;

    if (processTreeRssKb > peakProcessTreeRssKb) {
      peakProcessTreeRssKb = processTreeRssKb;
      peakProcessTreeAtMs = elapsedMs;
    }
    if (cgroupMemoryBytes !== null && (peakCgroupMemoryBytes === null || cgroupMemoryBytes > peakCgroupMemoryBytes)) {
      peakCgroupMemoryBytes = cgroupMemoryBytes;
      peakCgroupAtMs = elapsedMs;
    }
    if (alive && samples % Math.max(1, Math.round(5000 / sampleMs)) === 0) {
      const cgroupLabel = cgroupMemoryBytes === null ? "n/a" : `${Math.round(cgroupMemoryBytes / (1024 * 1024))} MiB`;
      console.log(
        `[controlled-test] stage ${stage.index} alive: elapsed=${Math.round(elapsedMs / 1000)}s rss=${Math.round(processTreeRssKb / 1024)} MiB cgroup=${cgroupLabel}`,
      );
    }
  };

  sample(true);
  const timer = setInterval(() => sample(true), sampleMs);
  let exitCode: number;
  try { exitCode = await child.exited; }
  finally { clearInterval(timer); }
  sample(false);
  return {
    index: stage.index,
    file_count: stage.files.length,
    files: [...stage.files],
    elapsed_ms: Date.now() - startedAt,
    exit_code: exitCode,
    peak_process_tree_rss_kb: peakProcessTreeRssKb,
    peak_cgroup_memory_bytes: peakCgroupMemoryBytes,
    peak_process_tree_at_ms: peakProcessTreeAtMs,
    peak_cgroup_at_ms: peakCgroupAtMs,
    samples,
  };
}

async function main(): Promise<void> {
  const isolation = ensureTestFilesystemIsolation();
  assertTestWorkspaceArguments(process.argv.slice(2));
  const { findProjectPackageDir } = await import("./vendor-workflow.js");
  const options = parseArgs();
  const packageDir = findProjectPackageDir(process.cwd());
  if (!packageDir) {
    throw new Error(`Could not find package.json near ${process.cwd()}`);
  }
  const runtimeDir = resolve(packageDir, "runtime");
  if (!existsSync(join(runtimeDir, "tsconfig.json"))) {
    throw new Error(`Could not find runtime directory under ${packageDir}`);
  }

  const { fileArgs, optionArgs } = splitPassthroughArgs(options.passthroughArgs);
  const discoveredFiles = fileArgs.length > 0 ? fileArgs : await discoverTestFiles(runtimeDir);
  if (discoveredFiles.length === 0) {
    throw new Error("No test files matched the controlled test run.");
  }

  const baseArgs = hasMaxConcurrencyArg(optionArgs) ? [...optionArgs] : [...optionArgs, "--max-concurrency=1"];
  const stages = chunkFiles(discoveredFiles, options.stageSize);
  const env = {
    ...process.env,
    ...(options.useInMemoryDb ? { PICLAW_DB_IN_MEMORY: "1" } : { PICLAW_DB_IN_MEMORY: undefined }),
  };

  console.log(`[controlled-test] package=${packageDir}`);
  console.log(`[controlled-test] runtime=${runtimeDir}`);
  console.log(`[controlled-test] files=${discoveredFiles.length} stages=${stages.length} stage_size=${options.stageSize} sample_ms=${options.sampleMs}`);
  console.log(`[controlled-test] base_args=${JSON.stringify(baseArgs)}`);

  const startedAt = Date.now();
  const results: StageResult[] = [];
  let exitCode = 0;
  let failedStageIndex: number | null = null;

  for (const stage of stages) {
    const result = await runStage(runtimeDir, stage, baseArgs, options.sampleMs, env);
    results.push(result);
    console.log(
      `[controlled-test] stage ${result.index} done: exit=${result.exit_code} elapsed=${Math.round(result.elapsed_ms / 1000)}s peak_rss=${Math.round(result.peak_process_tree_rss_kb / 1024)} MiB`,
    );
    if (result.exit_code !== 0) {
      exitCode = result.exit_code;
      failedStageIndex = result.index;
      break;
    }
  }

  const report: ControlledTestReport = {
    generated_at: new Date().toISOString(),
    package_dir: packageDir,
    runtime_dir: runtimeDir,
    stage_size: options.stageSize,
    sample_ms: options.sampleMs,
    use_in_memory_db: options.useInMemoryDb,
    base_bun_args: baseArgs,
    total_files: discoveredFiles.length,
    stages_completed: results.length,
    elapsed_ms: Date.now() - startedAt,
    max_peak_process_tree_rss_kb: results.reduce((max, entry) => Math.max(max, entry.peak_process_tree_rss_kb), 0),
    max_peak_cgroup_memory_bytes: results.reduce<number | null>((max, entry) => {
      if (entry.peak_cgroup_memory_bytes === null) return max;
      if (max === null) return entry.peak_cgroup_memory_bytes;
      return Math.max(max, entry.peak_cgroup_memory_bytes);
    }, null),
    failed_stage_index: failedStageIndex,
    exit_code: exitCode,
    stages: results,
  };

  if (options.reportPath) {
    mkdirSync(dirname(options.reportPath), { recursive: true });
    writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  const peakCgroupLabel = report.max_peak_cgroup_memory_bytes === null
    ? "n/a"
    : `${Math.round(report.max_peak_cgroup_memory_bytes / (1024 * 1024))} MiB`;
  console.log(`\n[controlled-test] summary: exit=${report.exit_code} stages=${report.stages_completed}/${stages.length} total_elapsed=${Math.round(report.elapsed_ms / 1000)}s peak_rss=${Math.round(report.max_peak_process_tree_rss_kb / 1024)} MiB peak_cgroup=${peakCgroupLabel}`);
  console.log(options.reportPath
    ? `[controlled-test] report=${relative(packageDir, options.reportPath) || options.reportPath}`
    : "[controlled-test] report=disabled (pass --report PATH to write JSON)");

  if (isolation.createdRoot) isolation.cleanup();
  process.exit(report.exit_code);
}

await main();
