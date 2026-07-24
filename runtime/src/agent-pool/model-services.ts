import { join } from "node:path";

import {
  ModelRegistry,
  ModelRuntime,
  type CreateModelRuntimeOptions,
} from "@earendil-works/pi-coding-agent";

import { getPiclawAgentDir } from "../core/agent-dir.js";
import { FileCredentialStore, type PiclawCredentialStore } from "./credential-store.js";

export class PiclawModelRegistry extends ModelRegistry {
  private refreshInFlight: Promise<void> | null = null;

  constructor(readonly modelRuntime: ModelRuntime) {
    super(modelRuntime);
  }

  override refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const refresh = this.modelRuntime.refresh({ allowNetwork: false }).then(() => undefined);
    const tracked = refresh.finally(() => {
      if (this.refreshInFlight === tracked) this.refreshInFlight = null;
    });
    this.refreshInFlight = tracked;
    return tracked;
  }
}

export interface RuntimeModelServices {
  credentialStore: PiclawCredentialStore;
  modelRuntime: ModelRuntime;
  modelRegistry: PiclawModelRegistry;
  agentDir: string;
}

export interface CreateRuntimeModelServicesOptions {
  agentDir?: string;
  credentialStore?: PiclawCredentialStore;
  createModelRuntime?: (options: CreateModelRuntimeOptions) => Promise<ModelRuntime>;
}

/** Create the one process-wide cache-first model/auth stack. */
export async function createRuntimeModelServices(
  options: CreateRuntimeModelServicesOptions = {},
): Promise<RuntimeModelServices> {
  const agentDir = options.agentDir ?? getPiclawAgentDir();
  const credentialStore = options.credentialStore ?? new FileCredentialStore(join(agentDir, "auth.json"));
  const createModelRuntime = options.createModelRuntime ?? ((runtimeOptions) => ModelRuntime.create(runtimeOptions));
  const modelRuntime = await createModelRuntime({
    credentials: credentialStore,
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
    modelsStorePath: join(agentDir, "models-store.json"),
    allowModelNetwork: false,
  });
  const modelRegistry = new PiclawModelRegistry(modelRuntime);
  return { credentialStore, modelRuntime, modelRegistry, agentDir };
}
