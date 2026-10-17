/**
 * runtime.ts – Application lifecycle: startup, polling loop, and shutdown.
 *
 * This is the top-level orchestrator that wires together all subsystems:
 *   - Initialises the database (db/connection.ts).
 *   - Creates the AgentPool, AgentQueue, and RuntimeState.
 *   - Starts the web channel, optional Pushover, and IPC. Additional channels via addons.
 *   - Runs the main message-polling loop and task scheduler.
 *   - Handles graceful shutdown (SIGINT/SIGTERM).
 *
 * Consumers:
 *   - index.ts calls startRuntime() as the entry point.
 */

import { DATA_DIR } from "./core/config.js";
import { bootstrapRuntime, createDefaultRuntimeBootstrapDeps, RuntimeStartupCleanupError, type RuntimeBootstrapDeps } from "./runtime/bootstrap.js";
import { createRuntimeBaseServices } from "./runtime/composition.js";
import { acquireRuntimeLock } from "./runtime/single-instance.js";

/** Lifecycle injection keeps tests on disposable owners without replacing bootstrap. */
export interface RuntimeMainDeps {
  acquireLock(): ReturnType<typeof acquireRuntimeLock>;
  createBootstrapDeps(): RuntimeBootstrapDeps;
}

/** Boot all subsystems (DB, channels, agent pool, scheduler) and enter the main loop. */
export async function main(deps: RuntimeMainDeps = {
  acquireLock: () => acquireRuntimeLock({ strictOwnership: true }),
  createBootstrapDeps: () => createDefaultRuntimeBootstrapDeps(createRuntimeBaseServices({ dataDir: DATA_DIR })),
}): Promise<void> {
  const runtimeLock = deps.acquireLock();
  let retain = false;
  try {
    const bootstrapDeps = deps.createBootstrapDeps();
    const onShutdownComplete = bootstrapDeps.onShutdownComplete;
    await bootstrapRuntime({
      ...bootstrapDeps,
      onShutdownComplete: () => {
        onShutdownComplete?.();
        runtimeLock.markSafeReleaseOnExit();
      },
    }, runtimeLock);
  } catch (error) {
    retain = error instanceof RuntimeStartupCleanupError;
    throw error;
  } finally {
    if (!retain) runtimeLock.release();
  }
}
