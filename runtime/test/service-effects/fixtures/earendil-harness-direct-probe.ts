import { fileURLToPath } from "node:url";

import { createModels, type Usage } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  AgentHarness,
  HarnessNotImplemented,
  InMemorySessionStorage,
  Session,
  type AgentMessage,
  type NewRecord,
  type OperationStartedRecord,
} from "@earendil-works/pi-agent-core";

export const EARENDIL_HARNESS_DIRECT_OPERATIONS = Object.freeze([
  "prompt",
  "skill",
  "promptFromTemplate",
  "compact",
  "navigateTree",
  "resume",
  "abort",
  "steer",
  "followUp",
  "nextRun",
  "cancelQueued",
  "recordUsage",
  "waitForIdle",
  "runWhenIdle",
  "peekAction",
  "executeAction",
  "runToCompletion",
  "watch",
  "lane",
  "createLane",
  "lanes",
  "watchSession",
  "hooks.on",
  "events.on",
  "create.restore",
] as const);

export type EarendilHarnessDirectOperation = typeof EARENDIL_HARNESS_DIRECT_OPERATIONS[number];

export interface EarendilHarnessDirectProbeRow {
  readonly operation: EarendilHarnessDirectOperation;
  readonly status: "unsupported" | "unexpected_success" | "unexpected_error";
  readonly reportedOperation: string | null;
  readonly errorName: string | null;
}

const MESSAGE: AgentMessage = {
  role: "user",
  content: [{ type: "text", text: "WP-3B direct public probe" }],
  timestamp: 1,
};

const USAGE: Usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function createSession(id = "wp-3b-direct-probe"): Session {
  return new Session(new InMemorySessionStorage({ id, createdAt: 1 }));
}

export async function readInstalledEarendilAgentCoreVersion(): Promise<string> {
  const packageUrl = import.meta.resolve("@earendil-works/pi-agent-core/package.json");
  const manifest: unknown = await Bun.file(fileURLToPath(packageUrl)).json();
  if (!manifest || typeof manifest !== "object" || !("version" in manifest) || typeof manifest.version !== "string") {
    throw new Error("The public @earendil-works/pi-agent-core/package.json export has no string version.");
  }
  return manifest.version;
}

async function assertCurrentRuntime(): Promise<void> {
  if (await readInstalledEarendilAgentCoreVersion() !== "0.84.4") {
    throw new Error("The provisional direct probe executes only @earendil-works/pi-agent-core@0.84.4.");
  }
}

async function createHarness(session = createSession()): Promise<AgentHarness> {
  const model = getModel("google", "gemini-2.5-flash");
  if (!model) throw new Error("Expected the public 0.84.4 compatibility model catalogue entry.");
  return (await AgentHarness.create({ session, models: createModels(), model })).harness;
}

async function classify(
  operation: EarendilHarnessDirectOperation,
  invoke: () => unknown | Promise<unknown>,
): Promise<EarendilHarnessDirectProbeRow> {
  try {
    await invoke();
    return Object.freeze({ operation, status: "unexpected_success", reportedOperation: null, errorName: null });
  } catch (error) {
    if (error instanceof HarnessNotImplemented && error.operation === operation) {
      return Object.freeze({ operation, status: "unsupported", reportedOperation: error.operation, errorName: error.name });
    }
    return Object.freeze({
      operation,
      status: "unexpected_error",
      reportedOperation: error instanceof HarnessNotImplemented ? error.operation : null,
      errorName: error instanceof Error ? error.name : null,
    });
  }
}

/** Exercise the installed package through public exports without adapters or simulated capabilities. */
export async function runEarendilHarnessDirectProbe(): Promise<readonly EarendilHarnessDirectProbeRow[]> {
  await assertCurrentRuntime();
  const harness = await createHarness();
  const rows = await Promise.all([
    classify("prompt", () => harness.prompt(MESSAGE)),
    classify("skill", () => harness.skill("wp-3b")),
    classify("promptFromTemplate", () => harness.promptFromTemplate("wp-3b")),
    classify("compact", () => harness.compact()),
    classify("navigateTree", () => harness.navigateTree(null)),
    classify("resume", () => harness.resume()),
    classify("abort", () => harness.abort()),
    classify("steer", () => harness.steer(MESSAGE)),
    classify("followUp", () => harness.followUp(MESSAGE)),
    classify("nextRun", () => harness.nextRun(MESSAGE)),
    classify("cancelQueued", () => harness.cancelQueued("queued")),
    classify("recordUsage", () => harness.recordUsage(USAGE)),
    classify("waitForIdle", () => harness.waitForIdle()),
    classify("runWhenIdle", () => harness.runWhenIdle(() => {})),
    classify("peekAction", () => harness.peekAction()),
    classify("executeAction", () => harness.executeAction()),
    classify("runToCompletion", () => harness.runToCompletion()),
    classify("watch", () => harness.watch()),
    classify("lane", () => harness.lane("main")),
    classify("createLane", () => harness.createLane("thread", null)),
    classify("lanes", () => harness.lanes()),
    classify("watchSession", () => harness.watchSession()),
    classify("hooks.on", () => harness.hooks.on("before_run", () => {})),
    classify("events.on", () => harness.events.on("wp-3b", () => {})),
  ]);

  const recorded = createSession("wp-3b-direct-restore-probe");
  const operationStarted: NewRecord<OperationStartedRecord> = {
    type: "operation_started",
    id: "run",
    lane: "main",
    sourceLeafId: null,
    intent: { kind: "run", originalPrompt: [], initialMessages: [] },
  };
  await recorded.appendRecord(operationStarted);
  rows.push(await classify("create.restore", () => createHarness(recorded)));
  return Object.freeze(rows);
}
