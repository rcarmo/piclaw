/**
 * runtime/composition.ts – runtime base composition and signal binding helpers.
 */

import { DATA_DIR } from "../core/config.js";
import { AgentQueue } from "../queue.js";
import { createLogger } from "../utils/logger.js";
import { RuntimeState } from "./state.js";

const log = createLogger("runtime.composition");

/** Services safe to construct before persisted environment overrides are applied. */
export interface RuntimeBaseServices {
  queue: AgentQueue;
  state: RuntimeState;
}

/** Optional factory overrides for runtime base service creation. */
export interface RuntimeBaseFactoryDeps {
  dataDir?: string;
  createQueue?: () => AgentQueue;
  createState?: (dataDir: string) => RuntimeState;
}

/** Build services that do not capture model/auth/config environment. */
export function createRuntimeBaseServices(deps: RuntimeBaseFactoryDeps = {}): RuntimeBaseServices {
  const dataDir = deps.dataDir ?? DATA_DIR;
  const createQueue = deps.createQueue ?? (() => new AgentQueue());
  const createState = deps.createState ?? ((dir) => new RuntimeState(dir));

  const services = {
    queue: createQueue(),
    state: createState(dataDir),
  };
  log.info("Created runtime base services", {
    operation: "create_runtime_base_services",
    dataDir,
  });
  return services;
}

/** Async runtime shutdown callback signature for signal handlers. */
export type RuntimeShutdownHandler = (signal: string) => Promise<void>;

/** Minimal process-like signal registrar used by runtime signal wiring. */
export interface RuntimeSignalRegistrar {
  on(event: "SIGTERM" | "SIGINT", listener: () => void): void;
}

/** Register SIGTERM/SIGINT handlers for graceful runtime shutdown. */
export function registerRuntimeShutdownSignals(
  registrar: RuntimeSignalRegistrar,
  shutdown: RuntimeShutdownHandler
): void {
  log.info("Registering runtime shutdown signals", {
    operation: "register_runtime_shutdown_signals",
    signals: ["SIGTERM", "SIGINT"],
  });
  registrar.on("SIGTERM", () => {
    void shutdown("SIGTERM").catch((error) => {
      log.error("Runtime shutdown failed", { operation: "shutdown_signal", signal: "SIGTERM", err: error });
    });
  });
  registrar.on("SIGINT", () => {
    void shutdown("SIGINT").catch((error) => {
      log.error("Runtime shutdown failed", { operation: "shutdown_signal", signal: "SIGINT", err: error });
    });
  });
}
