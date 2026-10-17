import { readFileSync } from "node:fs";
import { main } from "../../src/runtime.js";
import { AgentQueue } from "../../src/queue.js";
import { acquireRuntimeLock } from "../../src/runtime/single-instance.js";
import { createShutdownHandler } from "../../src/runtime/shutdown.js";
import type { RuntimeBootstrapDeps, RuntimeBootstrapAgentPool, RuntimeBootstrapWeb, RuntimeBootstrapState } from "../../src/runtime/bootstrap.js";

const [lockPath, mode, strict] = process.argv.slice(2);
const calls: string[] = [];
const queue = new AgentQueue();
const owner = acquireRuntimeLock({ lockPath, strictOwnership: strict === "true", disabled: false });
console.log(JSON.stringify({ acquired: readFileSync(lockPath, "utf8") }));
process.on("exit", () => console.log(JSON.stringify({ calls })));
if (mode === "normal-exit") process.exit(0);

// Exercise the real production callback and process.exit; shorten only deadlines
// under test, not the shutdown logic or ownership implementation.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) =>
  realSetTimeout(fn, mode === "backstop" && ms === 15000 ? 1 : mode === "queue-timeout" && ms === 5000 ? 1 : ms, ...args)) as typeof setTimeout;
let shutdown!: (signal: string) => Promise<void>;
const request = () => {
  void shutdown("fixture").catch(error => console.log(JSON.stringify({ error: error.name })));
};
const deps: RuntimeBootstrapDeps = {
  base: { queue, state: {} as RuntimeBootstrapState },
  assistantName: "Pi", triggerPattern: /@pi/i, pollIntervalMs: 1,
  signalRegistrar: { on: () => {} },
  initializeRuntimeEnvironment: () => {},
  hydrateMcpCredentials: async () => [], clearMcpCredentials: () => {},
  createAgentPool: async () => ({ shutdown: async () => { calls.push("pool"); } }) as RuntimeBootstrapAgentPool,
  startWebChannel: async () => ({ stop: async () => { calls.push("web"); } }) as RuntimeBootstrapWeb,
  startBackgroundModelRefresh: () => {}, startOptionalPushoverChannel: async () => null,
  createShutdownHandler,
  registerRuntimeShutdownSignals: (_registrar, handler) => { shutdown = handler; },
  createRuntimeSenders: () => ({ sendMessage: async () => {}, sendNudge: async () => {} }),
  startRuntimeWorkers: () => {}, queueStartupResumePendingIpc: () => {}, log: () => {},
  stopIpcWatcher: async () => {}, stopSchedulerLoop: () => {}, stopOptionalProviders: () => {},
  startRuntimeLoop: ({ signal }) => {
    if (mode === "queue-timeout") {
      queue.enqueue(async () => { calls.push("task"); request(); await new Promise<void>(() => {}); }, "accepted");
    } else realSetTimeout(request, 0);
    return new Promise<void>(resolve => {
      if (mode !== "backstop") signal!.addEventListener("abort", () => resolve(), { once: true });
    });
  },
};
// An uncertified shutdown must not reach main's finally, even when the producer
// has joined. No artificial keepalive: natural process exit must retain its lock.
void main({ acquireLock: () => owner, createBootstrapDeps: () => deps });
