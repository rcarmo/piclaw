import type { Credential, CredentialInfo } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { AgentPoolOptions } from "../src/agent-pool/contracts.js";
import { FileCredentialStore, type PiclawCredentialStore } from "../src/agent-pool/credential-store.js";

export function createTestCredentialStore(initial: Record<string, Credential> = {}): PiclawCredentialStore {
  const data = new Map(Object.entries(initial));
  return {
    authPath: "/tmp/piclaw-test-auth.json",
    drainErrors() { return []; },
    async read(providerId) { return data.get(providerId); },
    async list(): Promise<readonly CredentialInfo[]> {
      return [...data.entries()].map(([providerId, credential]) => ({ providerId, type: credential.type }));
    },
    async modify(providerId, fn) {
      const next = await fn(data.get(providerId));
      if (next !== undefined) data.set(providerId, next);
      return next ?? data.get(providerId);
    },
    async delete(providerId) { data.delete(providerId); },
  };
}

export async function createRealTestModelServices(agentDir: string, credentials: Record<string, Credential> = {}) {
  const credentialStore = new FileCredentialStore(`${agentDir}/auth.json`);
  for (const [providerId, credential] of Object.entries(credentials)) {
    await credentialStore.modify(providerId, async () => credential);
  }
  const modelRuntime = await ModelRuntime.create({ credentials: credentialStore, modelsPath: null, allowModelNetwork: false });
  return { credentialStore, modelRuntime, modelRegistry: new ModelRegistry(modelRuntime) };
}

export function createTestModelRuntime(models: any[] = []): ModelRuntime {
  const providers = new Map<string, any>();
  for (const model of models) {
    if (!providers.has(model.provider)) providers.set(model.provider, { id: model.provider, name: model.provider, auth: {}, getModels: () => models.filter((entry) => entry.provider === model.provider) });
  }
  return {
    getProviders: () => [...providers.values()],
    getProvider: (providerId: string) => providers.get(providerId),
    getModels: (providerId?: string) => providerId ? models.filter((model) => model.provider === providerId) : models,
    getModel: (providerId: string, modelId: string) => models.find((model) => model.provider === providerId && model.id === modelId),
    getAvailableSnapshot: () => models,
    getAvailable: async () => models,
    getError: () => undefined,
    hasConfiguredAuth: () => true,
    getAuth: async () => ({ auth: { apiKey: "test-key" } }),
    settleCredentialWrites: async () => {},
    reloadConfig: async () => {},
    refresh: async () => ({ aborted: false, errors: new Map() }),
    registerProvider: () => {},
    unregisterProvider: () => {},
  } as unknown as ModelRuntime;
}

export function createAgentPoolModelOptions(models: any[] = []): Pick<AgentPoolOptions, "credentialStore" | "modelRuntime" | "getDurableSession"> {
  return { credentialStore: createTestCredentialStore(), modelRuntime: createTestModelRuntime(models), getDurableSession:()=>undefined };
}

/** Explicit resident SDK capture/resource fixtures only; never native admission. */
export function createLegacyCapturePoolOptions(models:any[]=[]):Pick<AgentPoolOptions,'credentialStore'|'modelRuntime'|'getDurableSession'|'legacyCapture'>{
  return {...createAgentPoolModelOptions(models),getDurableSession:undefined,legacyCapture:true};
}
