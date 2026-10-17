/**
 * runtime/shutdown-registry.ts – Global shutdown handle for agent-initiated exits.
 *
 * bootstrapRuntime() registers the graceful shutdown handler here after
 * startup. The exit_process tool and /exit slash command call
 * requestGracefulShutdown() to trigger the same orderly teardown
 * (queue drain → session dispose → web stop → process.exit) that SIGINT uses.
 *
 * For agent-initiated exits (exit_process tool), the actual shutdown is
 * **deferred** until the current turn completes and is persisted to the DB.
 * Call markPendingShutdown() during a tool call, then checkPendingShutdown()
 * from finalizeSuccessfulRun() after the response is committed.
 *
 * isPendingShutdown() returns true while the flag is set, so the run-agent
 * orchestrator can abort the session immediately after the exit_process tool
 * executes — preventing further tool calls in the same turn.
 */

import { createLogger } from "../utils/logger.js";

const log = createLogger("runtime.shutdown-registry");

type ShutdownFn = (signal: string) => Promise<void>;
type PreShutdownHook = () => void | Promise<void>;

/** Per-runtime success-only lifetime gate. Failure never certifies resource release. */
export function createShutdownCompletion(): { promise: Promise<void>; complete: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, complete: resolve };
}

let registeredShutdown: ShutdownFn | null = null;
let pendingShutdownReason: string | null = null;
const preShutdownHooks = new Set<PreShutdownHook>();
let preShutdownHooksRan = false;

/**
 * Register the graceful shutdown handler.
 * Called once by bootstrapRuntime() after all services are wired.
 */
export function registerShutdownHandler(handler: ShutdownFn): void {
  registeredShutdown = handler;
}

/**
 * Register a best-effort hook that runs immediately before graceful shutdown
 * begins. Used for cheap persistence cleanup such as clearing transient UI
 * state that should not survive a clean restart.
 */
export function registerPreShutdownHook(hook: PreShutdownHook): void {
  preShutdownHooks.add(hook);
}

export async function runPreShutdownHooksOnce(): Promise<void> {
  if (preShutdownHooksRan) return;
  preShutdownHooksRan = true;
  // Start every independent cleanup before awaiting any of them. A stuck hook
  // is bounded by shutdown.ts and must not prevent later hooks from starting.
  await Promise.all([...preShutdownHooks].map(async (hook, index) => {
    try {
      await hook();
    } catch (error) {
      log.warn("Pre-shutdown hook failed", {
        operation: "pre_shutdown_hook",
        hookIndex: index,
        err: error,
      });
    }
  }));
}

/**
 * Request an immediate graceful shutdown of the entire runtime.
 *
 * Used by /exit slash command (which runs outside the agent turn).
 * For exit_process tool (mid-turn), use markPendingShutdown() instead.
 */
export function requestGracefulShutdown(reason: string, delayMs = 800): void {
  const testScheduler = (globalThis as { __PICLAW_EXIT_SCHEDULER__?: () => void }).__PICLAW_EXIT_SCHEDULER__;
  if (typeof testScheduler === "function") {
    testScheduler();
    return;
  }

  if (registeredShutdown) {
    // The registered shutdown handler owns the process-wide deadline and runs
    // pre-shutdown hooks inside that deadline. Waiting here first would let a
    // stuck extensible hook prevent the backstop from ever being armed.
    log.info("Graceful shutdown requested", { operation: "request", reason });
    void registeredShutdown(`exit_process: ${reason}`).catch((error) => {
      log.error("Requested runtime shutdown failed", { operation: "request_shutdown", reason, err: error });
    });
    return;
  }

  const hookTimeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
  void Promise.race([runPreShutdownHooksOnce(), hookTimeout]).finally(() => {
    log.info("No runtime handler registered; scheduling process exit", {
      operation: "request_fallback",
      reason,
      delayMs,
    });
    setTimeout(() => process.exit(0), delayMs);
  });
}

/**
 * Mark that a graceful shutdown should happen after the current turn
 * completes and is persisted. Called by the exit_process tool.
 */
export function markPendingShutdown(reason: string): void {
  pendingShutdownReason = reason;
  log.info("Pending shutdown marked", { operation: "mark_pending", reason });
}

/**
 * Query whether a pending shutdown has been requested.
 * Used by the run-agent orchestrator to abort the session after
 * exit_process executes, preventing further tool calls.
 */
export function isPendingShutdown(): boolean {
  return pendingShutdownReason !== null;
}

/**
 * Check if a pending shutdown was requested. If so, execute it after a brief
 * delay. Called from finalizeSuccessfulRun() after the response is committed
 * to the DB and broadcast to connected clients.
 *
 * The delay gives the SSE transport time to flush the final "done" status and
 * stored message events to connected web clients before the server tears down.
 * Without it the client may miss the agent's final reply even though it is
 * already persisted in the DB.
 */
export function checkPendingShutdown(): void {
  if (!pendingShutdownReason) return;
  const reason = pendingShutdownReason;
  pendingShutdownReason = null;
  log.info("Pending shutdown: delaying 1.5s for SSE flush", { operation: "check_pending.delay", reason });
  setTimeout(() => requestGracefulShutdown(reason), 1500);
}
