/**
 * runtime/coordinator.ts – Runtime message-loop orchestration helpers.
 */

import { createLogger } from "../utils/logger.js";
import {
  processMessages,
  runMessageLoop,
  type MessageLoopDeps,
  type MessageProcessingDeps,
} from "./message-loop.js";

const log = createLogger("runtime.coordinator");

/** Dependencies required to start the runtime message-processing loop. */
export type StartRuntimeLoopDeps = {
  queue: MessageLoopDeps["queue"];
  state: MessageLoopDeps["state"];
  agentPool: MessageProcessingDeps["agentPool"];
  assistantName: MessageLoopDeps["assistantName"];
  triggerPattern: MessageProcessingDeps["triggerPattern"];
  pollIntervalMs: MessageLoopDeps["pollIntervalMs"];
  signal?: AbortSignal;
  runMessageLoopFn?: (deps: MessageLoopDeps, signal?: AbortSignal) => Promise<void>;
  processMessagesFn?: (chatJid: string, deps: MessageProcessingDeps) => Promise<boolean>;
};

/**
 * Start the runtime polling loop with message-processing dependencies bound.
 */
export async function startRuntimeLoop(deps: StartRuntimeLoopDeps): Promise<void> {
  const runMessageLoopImpl = deps.runMessageLoopFn ?? runMessageLoop;
  const processMessagesImpl = deps.processMessagesFn ?? processMessages;

  log.info("Binding runtime loop dependencies", {
    operation: "start_runtime_loop",
    pollIntervalMs: deps.pollIntervalMs,
  });

  await runMessageLoopImpl({
    queue: deps.queue,
    state: deps.state,
    assistantName: deps.assistantName,
    pollIntervalMs: deps.pollIntervalMs,
    processMessages: (chatJid) =>
      processMessagesImpl(chatJid, {
        agentPool: deps.agentPool,
        state: deps.state,
        assistantName: deps.assistantName,
        triggerPattern: deps.triggerPattern,
      }),
  }, deps.signal);
}
