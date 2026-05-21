/**
 * runtime/shutdown.ts – Graceful shutdown orchestration helpers.
 */

import { runPreShutdownHooksOnce } from "./shutdown-registry.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("runtime.shutdown");

/** Runtime resources required to perform graceful shutdown. */
export type ShutdownDeps = {
  queue: { shutdown: (timeoutMs?: number) => Promise<unknown> };
  agentPool: { shutdown: () => Promise<unknown> };
  whatsapp: { disconnect: () => Promise<unknown> };
  telegram: { disconnect: () => Promise<unknown> };
  web: { stop: () => Promise<unknown> };
  pushover?: { stop: () => Promise<unknown> } | null;
  stopIpcWatcher: () => Promise<void>;
  stopSchedulerLoop: () => void;
};

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      log.warn("Shutdown step timed out", { operation: "with_timeout", label, timeoutMs: ms });
      resolve(null);
    }, ms);
  });

  try {
    const result = await Promise.race([promise.then((value) => ({ value })), timeout]);
    if (result && typeof result === "object" && "value" in result) {
      return (result as { value: T }).value;
    }
    return null;
  } catch (error) {
    log.error("Shutdown step failed", { operation: "with_timeout", label, timeoutMs: ms, err: error });
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
    await runPreShutdownHooksOnce();
    const forceExit = setTimeout(() => {
      log.warn("Forcing shutdown after timeout", { operation: "force_exit", timeoutMs: 15000 });
      process.exit(0);
    }, 15000);

    await withTimeout(deps.stopIpcWatcher(), 4000, "ipc watcher stop");
    deps.stopSchedulerLoop();
    await withTimeout(deps.queue.shutdown(5000), 7000, "queue shutdown");
    await withTimeout(deps.agentPool.shutdown(), 8000, "agent pool shutdown");
    await withTimeout(deps.whatsapp.disconnect(), 8000, "whatsapp disconnect");
    await withTimeout(deps.telegram.disconnect(), 8000, "telegram disconnect");
    await withTimeout(deps.web.stop(), 4000, "web stop");
    await withTimeout(deps.pushover?.stop() ?? Promise.resolve(), 4000, "pushover stop");

    clearTimeout(forceExit);
    process.exit(0);
  };
}
