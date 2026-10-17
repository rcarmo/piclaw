/**
 * runtime/shutdown.ts – Graceful shutdown orchestration helpers.
 */

import { runPreShutdownHooksOnce } from "./shutdown-registry.js";
import { createLogger } from "../utils/logger.js";
import { stopToolOutputCleanup } from "../tool-output.js";
import { SchedulerStoreReleaseError } from "../task-scheduler.js";

const log = createLogger("runtime.shutdown");

export { RuntimeStartupCleanupError } from "./startup-cleanup-error.js";

/** Runtime resources required to perform graceful shutdown. */
export type ShutdownDeps = {
  queue: { shutdown: (timeoutMs?: number) => Promise<unknown> };
  agentPool: { shutdown: () => Promise<unknown> };
  web: { stop: () => Promise<unknown>; sealAdmissions?: () => Promise<void> };
  pushover?: { stop: () => Promise<unknown> } | null;
  stopIpcWatcher: () => Promise<void>;
  stopMessageLoop?: () => void | Promise<void>;
  stopSchedulerLoop: () => void | Promise<void>;
  stopOptionalProviders: () => void;
  closeApplicationBackend?: () => Promise<void>;
  /** Certify successful cleanup only; never called on failure or deadline exit. */
  onShutdownComplete?: () => void;
};

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      log.warn("Shutdown step timed out", { operation: "with_timeout", label, timeoutMs: ms });
      reject(new Error(`Shutdown step timed out: ${label}`));
    }, ms);
  });

  try {
    const result = await Promise.race([promise.then((value) => ({ value })), timeout]);
    if (result && typeof result === "object" && "value" in result) {
      return (result as { value: T }).value;
    }
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Build a signal handler that performs graceful shutdown exactly once.
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let shuttingDown = false;

  return async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info("Shutdown signal received", { operation: "handle_signal", signal });
    // Arm the process-wide backstop before extensible pre-shutdown hooks. A
    // broken add-on must not prevent the fallback from ever being scheduled.
    const forceExit = setTimeout(() => {
      log.warn("Forcing shutdown after timeout", { operation: "force_exit", timeoutMs: 15000 });
      process.exit(0);
    }, 15000);

    const errors: unknown[] = [];
    const cleanup = async (run: () => unknown | Promise<unknown>, ms: number, label: string) => {
      try {
        await withTimeout(Promise.resolve().then(run), ms, label);
      } catch (error) {
        errors.push(error);
        log.error("Shutdown step failed", { operation: "cleanup", label, err: error });
      }
    };
    try {
      // Seal synchronously before any producer can yield or queue disposal can
      // begin. Join only request/control admission, not queue-owned agent runs.
      await deps.web.sealAdmissions?.();
      stopToolOutputCleanup();
      // Join the producer itself, never bootstrapRuntime (which awaits it).
      // Unknown join failures must leave queue/pool resources intact.
      await deps.stopMessageLoop?.();
      await cleanup(runPreShutdownHooksOnce, 5000, "pre-shutdown hooks");
      await cleanup(deps.stopIpcWatcher, 4000, "ipc watcher stop");
      try {
        await deps.stopSchedulerLoop();
      } catch (error) {
        // Only this error guarantees admission joined. An unknown join failure
        // must not dispose resources that may still have live polling work.
        if (!(error instanceof SchedulerStoreReleaseError)) throw error;
        errors.push(error);
      }
      await cleanup(deps.stopOptionalProviders, 1000, "optional providers stop");
      // Accepted tasks remain queue-owned even after the poll has joined.
      // Any rejected/expired queue join is uncertain, unlike a known post-join
      // scheduler store-release error. Do not dispose a pool still used by tasks.
      await withTimeout(Promise.resolve().then(() => deps.queue.shutdown(5000)), 7000, "queue shutdown");
      await cleanup(() => deps.agentPool.shutdown(), 8000, "agent pool shutdown");
      await cleanup(() => deps.web.stop(), 4000, "web stop");
      await cleanup(() => deps.pushover?.stop(), 4000, "pushover stop");
      if (errors.length) throw new AggregateError(errors, "Runtime shutdown cleanup failed");
      await deps.closeApplicationBackend?.();
      deps.onShutdownComplete?.();
      process.exit(0);
    } finally {
      clearTimeout(forceExit);
    }
  };
}
