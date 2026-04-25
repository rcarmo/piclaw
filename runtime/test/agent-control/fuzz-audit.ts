import "../helpers.js";

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { createTempWorkspace, setEnv } from "../helpers.js";
import { DEFAULT_TEST_MODEL, TestAgentControlSession, cleanupRotatedSessionArtifacts, createTestAuthStorage, createTestModelRegistry, createTestSessionRuntime } from "./session-fixture.js";

const TRIGGER_PATTERN = /(?:^|\s)@PiClaw\b/i;
const DEFAULT_CHAT_JID = "web:default";
export const DEFAULT_FUZZ_SEED = 424242;
export const DEFAULT_FUZZ_ITERATIONS = 128;
export const DEFAULT_FUZZ_ARTIFACT_DIR = "artifacts/agent-control-fuzz";
export const DEFAULT_FUZZ_TEST_ARTIFACT_DIR = `${DEFAULT_FUZZ_ARTIFACT_DIR}/test`;

const ROUTING_SAMPLES: Record<string, string> = {
  "/model": "/model",
  "/cycle-model": "/cycle-model",
  "/thinking": "/thinking",
  "/cycle-thinking": "/cycle-thinking",
  "/state": "/state",
  "/stats": "/stats",
  "/context": "/context",
  "/last": "/last",
  "/compact": "/compact keep focus",
  "/auto-compact": "/auto-compact on",
  "/auto-retry": "/auto-retry off",
  "/abort": "/abort",
  "/abort-retry": "/abort-retry",
  "/abort-bash": "/abort-bash",
  "/shell": "/shell echo hello",
  "/bash": "/bash echo hello",
  "/queue": "/queue queue this",
  "/queue-all": "/queue-all queue this",
  "/steer": "/steer focus now",
  "/steering-mode": "/steering-mode all",
  "/followup-mode": "/followup-mode one",
  "/session-name": "/session-name fuzz-audit",
  "/new-session": "/new-session",
  "/switch-session": "/switch-session archive/session.jsonl",
  "/session-rotate": "/session-rotate keep current focus",
  "/fork": "/fork entry-1",
  "/clone": "/clone",
  "/forks": "/forks",
  "/tree": "/tree",
  "/label": "/label entry-1 checkpoint",
  "/labels": "/labels",
  "/agent-name": "/agent-name Audit Bot",
  "/agent-avatar": "/agent-avatar",
  "/user-name": "/user-name Test User",
  "/user-avatar": "/user-avatar https://example.com/avatar.png",
  "/user-github": "/user-github",
  "/export-html": "/export-html",
  "/passkey": "/passkey",
  "/totp": "/totp",
  "/qr": "/qr https://example.com/qr",
  "/search": "/search audit",
  "/ask": "/ask relay-1 audit this request",
  "/restart": "/restart",
  "/exit": "/exit",
  "/login": "/login",
  "/settings": "/settings",
  "/logout": "/logout",
  "/commands": "/commands",
};

const MALFORMED_CASES = [
  "/queue",
  "/queue-all   ",
  "/steer\t",
  "/auto-compact maybe",
  "/auto-retry maybe",
  "/steering-mode ???",
  "/followup-mode ???",
  "/switch-session",
  "/fork",
  "/label",
  "/qr",
  "/search --scope nope",
  "/model openai/",
  "/user-github not/a/handle",
  "/totp reset",
  "/passkey delete",
  "/unknown-command",
  "/ＭＯＤＥＬ ｇｐｔ",
];

const UNICODE_PAYLOADS = [
  "café Δelta 你好 مرحبا",
  "emoji 👩🏽‍💻🚀✨",
  "combining e\u0301 o\u0308 n\u0303",
  "rtl مرحبا \u202eabc\u202c",
  "zero-width\u200djoiner and \u2066markers\u2069",
  "path/with/slash and spaces",
  "quoted \"value\" and 'single quotes'",
  "tabs\tand\nnewlines",
];

const LONG_PAYLOAD = "長い入力🙂-".repeat(256);

interface AuditFailure {
  category: "exception" | "typed_failure" | "routing_invariant" | "idempotence";
  caseId: number;
  seed: number;
  input: string;
  detail: string;
  replayCommand: string;
  artifactPath?: string;
}

export interface AgentControlAuditSummary {
  seed: number;
  iterations: number;
  fuzz_cases_run: number;
  failing_seeds: number;
  replayable_failures: number;
  typed_failure_mismatches: number;
  idempotence_failures: number;
  routing_invariant_failures: number;
  artifact_outputs_present: number;
  targeted_runtime_sec: number;
  fuzz_gap_count: number;
  unhandled_exceptions: number;
  summaryPath: string;
  latestPath: string;
  failures: AuditFailure[];
}

interface AuditRunOptions {
  seed?: number;
  iterations?: number;
  artifactDir?: string;
  replayCaseId?: number | null;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

function withVariant(rand: () => number, input: string): string {
  const [command, ...rest] = input.trim().split(/\s+/);
  const args = rest.join(" ");
  const separators = [" ", "  ", "\t", " \t ", "\n", " \n "];
  const separator = pick(rand, separators);
  let decoratedCommand = command;
  if (decoratedCommand.includes("-") && rand() < 0.35) decoratedCommand = decoratedCommand.replace(/-/g, "_");
  if (rand() < 0.25) decoratedCommand = decoratedCommand.toUpperCase();
  const prefix = rand() < 0.35 ? "@PiClaw " : rand() < 0.15 ? "  @PiClaw\n" : "";
  const suffix = rand() < 0.2 ? "   " : "";
  return `${prefix}${decoratedCommand}${args ? `${separator}${args}` : ""}${suffix}`;
}

function buildReplayCommand(seed: number, iterations: number, caseId: number): string {
  return `PICLAW_DB_IN_MEMORY=1 PICLAW_FUZZ_SEED=${seed} PICLAW_FUZZ_ITERATIONS=${iterations} PICLAW_FUZZ_REPLAY_CASE=${caseId} bun run runtime/scripts/agent-control-fuzz-audit.ts`;
}

async function importFromHere<T = any>(relativePath: string): Promise<T> {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set("t", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return import(url.href) as Promise<T>;
}

async function writeArtifacts(artifactDir: string, summary: AgentControlAuditSummary): Promise<AgentControlAuditSummary> {
  mkdirSync(artifactDir, { recursive: true });
  const summaryPath = join(artifactDir, `summary-seed-${summary.seed}-iter-${summary.iterations}.json`);
  const latestPath = join(artifactDir, "latest.json");
  for (const failure of summary.failures) {
    const failurePath = join(artifactDir, `failure-seed-${failure.seed}-case-${failure.caseId}.json`);
    writeFileSync(failurePath, JSON.stringify(failure, null, 2) + "\n");
    failure.artifactPath = failurePath;
  }
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(latestPath, JSON.stringify({ summaryPath, seed: summary.seed, iterations: summary.iterations }, null, 2) + "\n");
  summary.summaryPath = summaryPath;
  summary.latestPath = latestPath;
  summary.replayable_failures = new Set(summary.failures.filter((failure) => Boolean(failure.replayCommand)).map((failure) => failure.seed)).size;
  summary.artifact_outputs_present = Number(existsSync(summaryPath) && existsSync(latestPath) && summary.failures.every((failure) => failure.artifactPath && existsSync(failure.artifactPath)));
  summary.fuzz_gap_count =
    summary.unhandled_exceptions +
    summary.typed_failure_mismatches +
    summary.routing_invariant_failures +
    summary.idempotence_failures +
    Math.max(0, summary.failing_seeds - summary.replayable_failures) +
    (summary.artifact_outputs_present ? 0 : 1);
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

export async function runAgentControlFuzzAudit(options: AuditRunOptions = {}): Promise<AgentControlAuditSummary> {
  const seed = options.seed ?? DEFAULT_FUZZ_SEED;
  const iterations = options.iterations ?? DEFAULT_FUZZ_ITERATIONS;
  const artifactDir = resolve(options.artifactDir ?? DEFAULT_FUZZ_ARTIFACT_DIR);
  const replayCaseId = options.replayCaseId ?? null;
  const start = Date.now();
  const failures: AuditFailure[] = [];
  const failingSeeds = new Set<number>();

  const workspace = createTempWorkspace("piclaw-agent-control-fuzz-");
  const restoreEnv = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
  (globalThis as { __PICLAW_EXIT_SCHEDULER__?: () => void }).__PICLAW_EXIT_SCHEDULER__ = () => {};

  try {
    const db = await importFromHere<any>("../../src/db.ts");
    db.initDatabase();
    db.storeTokenUsage({
      chat_jid: DEFAULT_CHAT_JID,
      run_at: new Date().toISOString(),
      input_tokens: 120,
      output_tokens: 30,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 150,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0.15,
      provider: "openai",
      model: "gpt-test",
    });

    const { parseControlCommand, applyControlCommand } = await importFromHere<any>("../../src/agent-control/index.ts");
    const { CONTROL_COMMAND_DEFINITIONS, normalizeControlCommandName } = await importFromHere<any>("../../src/agent-control/command-registry.ts");
    const { COMMAND_PARSERS } = await importFromHere<any>("../../src/agent-control/command-parsers.ts");
    const { withChatContext } = await importFromHere<any>("../../src/core/chat-context.ts");

    const authStorage = createTestAuthStorage();
    const registry = createTestModelRegistry([DEFAULT_TEST_MODEL], authStorage);

    const runCase = async (caseId: number, input: string) => {
      const caseSeed = seed + caseId;
      const replayCommand = buildReplayCommand(seed, iterations, caseId);
      const session = new TestAgentControlSession(workspace.workspace, registry);
  const runtime = createTestSessionRuntime(session);
      cleanupRotatedSessionArtifacts(workspace.workspace);
      let parsed: any = null;
      try {
        parsed = parseControlCommand(input, TRIGGER_PATTERN);
      } catch (error) {
        failures.push({
          category: "exception",
          caseId,
          seed: caseSeed,
          input,
          detail: `Parser threw: ${error instanceof Error ? error.stack || error.message : String(error)}`,
          replayCommand,
        });
        failingSeeds.add(caseSeed);
        return;
      }

      if (!parsed) {
        if (input.trim().startsWith("/")) {
          return { parsed: null, typedFailure: true, status: "error" };
        }
        return { parsed: null, typedFailure: false, status: "ignored" };
      }

      try {
        const result = await withChatContext(DEFAULT_CHAT_JID, "web", () => applyControlCommand(runtime as any, registry as any, parsed));
        if (!result || (result.status !== "success" && result.status !== "error") || typeof result.message !== "string") {
          failures.push({
            category: "routing_invariant",
            caseId,
            seed: caseSeed,
            input,
            detail: `Handler returned invalid result shape: ${JSON.stringify(result)}`,
            replayCommand,
          });
          failingSeeds.add(caseSeed);
          return;
        }
        return { parsed, typedFailure: result.status === "error", status: result.status, result, session };
      } catch (error) {
        failures.push({
          category: "exception",
          caseId,
          seed: caseSeed,
          input,
          detail: `Handler threw: ${error instanceof Error ? error.stack || error.message : String(error)}`,
          replayCommand,
        });
        failingSeeds.add(caseSeed);
        return;
      }
    };

    let caseId = 0;
    for (const definition of CONTROL_COMMAND_DEFINITIONS as Array<{ name: string; aliases?: string[] }>) {
      const sample = ROUTING_SAMPLES[definition.name];
      if (!sample) {
        failures.push({
          category: "routing_invariant",
          caseId,
          seed: seed + caseId,
          input: definition.name,
          detail: `Missing routing sample for ${definition.name}`,
          replayCommand: buildReplayCommand(seed, iterations, caseId),
        });
        failingSeeds.add(seed + caseId);
        caseId += 1;
        continue;
      }
      const variants = [definition.name, ...(definition.aliases ?? [])];
      if (definition.name.includes("-")) variants.push(definition.name.replace(/-/g, "_"));
      for (const variant of variants) {
        const input = sample.replace(definition.name, variant);
        const normalized = normalizeControlCommandName(variant);
        if (normalized !== definition.name) {
          failures.push({
            category: "routing_invariant",
            caseId,
            seed: seed + caseId,
            input,
            detail: `Expected ${variant} to normalize to ${definition.name}, got ${normalized}`,
            replayCommand: buildReplayCommand(seed, iterations, caseId),
          });
          failingSeeds.add(seed + caseId);
        }
        const outcome = await runCase(caseId, input);
        if (outcome && !outcome.parsed && COMMAND_PARSERS[normalizeControlCommandName(variant)]) {
          failures.push({
            category: "routing_invariant",
            caseId,
            seed: seed + caseId,
            input,
            detail: `Known parser ${variant} did not produce a command`,
            replayCommand: buildReplayCommand(seed, iterations, caseId),
          });
          failingSeeds.add(seed + caseId);
        }
        caseId += 1;
      }
    }

    const idempotenceCases = [
      { raw: "/auto-compact on", read: (session: TestAgentControlSession) => session.autoCompactionEnabled },
      { raw: "/auto-retry off", read: (session: TestAgentControlSession) => session.autoRetryEnabled },
      { raw: "/steering-mode all", read: (session: TestAgentControlSession) => session.steeringMode },
      { raw: "/followup-mode one", read: (session: TestAgentControlSession) => session.followUpMode },
      { raw: "/session-name keep-me", read: (session: TestAgentControlSession) => session.sessionName },
    ];

    for (const testCase of idempotenceCases) {
      const caseSeed = seed + caseId;
      const replayCommand = buildReplayCommand(seed, iterations, caseId);
      const session = new TestAgentControlSession(workspace.workspace, registry);
  const runtime = createTestSessionRuntime(session);
      const parsed = parseControlCommand(testCase.raw, TRIGGER_PATTERN);
      if (!parsed) {
        failures.push({ category: "idempotence", caseId, seed: caseSeed, input: testCase.raw, detail: "Idempotence case did not parse", replayCommand });
        failingSeeds.add(caseSeed);
        caseId += 1;
        continue;
      }
      const first = await withChatContext(DEFAULT_CHAT_JID, "web", () => applyControlCommand(runtime as any, registry as any, parsed));
      const afterFirst = testCase.read(session);
      const second = await withChatContext(DEFAULT_CHAT_JID, "web", () => applyControlCommand(runtime as any, registry as any, parsed));
      const afterSecond = testCase.read(session);
      if (first.status !== second.status || JSON.stringify(afterFirst) !== JSON.stringify(afterSecond)) {
        failures.push({
          category: "idempotence",
          caseId,
          seed: caseSeed,
          input: testCase.raw,
          detail: `Repeated command diverged: first=${JSON.stringify(first)}, second=${JSON.stringify(second)}, state1=${JSON.stringify(afterFirst)}, state2=${JSON.stringify(afterSecond)}`,
          replayCommand,
        });
        failingSeeds.add(caseSeed);
      }
      caseId += 1;
    }

    for (const malformed of MALFORMED_CASES) {
      const outcome = await runCase(caseId, malformed);
      if (!outcome?.typedFailure && malformed.trim().startsWith("/")) {
        failures.push({
          category: "typed_failure",
          caseId,
          seed: seed + caseId,
          input: malformed,
          detail: `Malformed command did not produce a stable typed failure: ${JSON.stringify(outcome)}`,
          replayCommand: buildReplayCommand(seed, iterations, caseId),
        });
        failingSeeds.add(seed + caseId);
      }
      caseId += 1;
    }

    const rand = mulberry32(seed);
    const generationCommands = [
      "/queue",
      "/queue-all",
      "/steer",
      "/search",
      "/model",
      "/label",
      "/qr",
      "/session-name",
      "/shell",
      "/bash",
      "/thinking",
      "/passkey",
      "/totp",
      "/unknown",
    ];

    for (let i = 0; i < iterations; i += 1) {
      if (replayCaseId !== null && caseId !== replayCaseId) {
        caseId += 1;
        continue;
      }
      const command = pick(rand, generationCommands);
      const payload = rand() < 0.2 ? LONG_PAYLOAD : pick(rand, UNICODE_PAYLOADS);
      const baseInput = command === "/unknown"
        ? `/${payload.replace(/\s+/g, "-").slice(0, 24)}`
        : `${command} ${payload}`;
      await runCase(caseId, withVariant(rand, baseInput));
      caseId += 1;
      if (replayCaseId !== null) break;
    }

    const summary: AgentControlAuditSummary = {
      seed,
      iterations,
      fuzz_cases_run: replayCaseId !== null ? 1 : caseId,
      failing_seeds: failingSeeds.size,
      replayable_failures: 0,
      typed_failure_mismatches: failures.filter((failure) => failure.category === "typed_failure").length,
      idempotence_failures: failures.filter((failure) => failure.category === "idempotence").length,
      routing_invariant_failures: failures.filter((failure) => failure.category === "routing_invariant").length,
      artifact_outputs_present: 0,
      targeted_runtime_sec: Number(((Date.now() - start) / 1000).toFixed(3)),
      fuzz_gap_count: 0,
      unhandled_exceptions: failures.filter((failure) => failure.category === "exception").length,
      summaryPath: "",
      latestPath: "",
      failures,
    };

    return await writeArtifacts(artifactDir, summary);
  } finally {
    delete (globalThis as { __PICLAW_EXIT_SCHEDULER__?: () => void }).__PICLAW_EXIT_SCHEDULER__;
    cleanupRotatedSessionArtifacts(workspace.workspace);
    restoreEnv();
    workspace.cleanup();
  }
}

export function printAuditMetrics(summary: AgentControlAuditSummary): void {
  console.log(`artifact: ${summary.summaryPath}`);
  console.log(`latest: ${summary.latestPath}`);
  console.log(`seed: ${summary.seed}`);
  console.log(`iterations: ${summary.iterations}`);
  if (summary.failures.length) {
    console.log(`failures: ${summary.failures.length}`);
    for (const failure of summary.failures.slice(0, 10)) {
      console.log(`- [${failure.category}] case=${failure.caseId} seed=${failure.seed} input=${JSON.stringify(failure.input)} replay=${failure.replayCommand}`);
    }
  }
  console.log(`METRIC fuzz_gap_count=${summary.fuzz_gap_count}`);
  console.log(`METRIC fuzz_cases_run=${summary.fuzz_cases_run}`);
  console.log(`METRIC failing_seeds=${summary.failing_seeds}`);
  console.log(`METRIC replayable_failures=${summary.replayable_failures}`);
  console.log(`METRIC typed_failure_mismatches=${summary.typed_failure_mismatches}`);
  console.log(`METRIC idempotence_failures=${summary.idempotence_failures}`);
  console.log(`METRIC routing_invariant_failures=${summary.routing_invariant_failures}`);
  console.log(`METRIC artifact_outputs_present=${summary.artifact_outputs_present}`);
  console.log(`METRIC targeted_runtime_sec=${summary.targeted_runtime_sec}`);
}
