import { expect, test } from "bun:test";

import { ModelRegistry, ModelRuntime, SettingsManager, type AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

import { createAgentPoolServices } from "../../src/agent-pool/service-factory.js";
import { createTempWorkspace, waitFor } from "../helpers.js";
import { FileCredentialStore } from '../../src/agent-pool/credential-store.js';

async function createFactoryModelServices(agentDir: string) {
  const credentialStore = new FileCredentialStore(`${agentDir}/auth.json`);
  // These tests exercise collaborator wiring and attachment isolation, not
  // provider catalogue/auth discovery (covered by model-runtime fixtures).
  const modelRuntime = await ModelRuntime.create({ credentials: credentialStore, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  return { credentialStore, modelRuntime, modelRegistry: new ModelRegistry(modelRuntime) };
}

function createServicesOptions(modelServices: Awaited<ReturnType<typeof createFactoryModelServices>>, workspaceDir: string) {
  return {
    authStorage: modelServices.credentialStore,
    modelRuntime: modelServices.modelRuntime,
    modelRegistry: modelServices.modelRegistry,
    settingsManager: SettingsManager.inMemory(),
    workspaceDir,
    legacyCapture:true as const,
  };
}

test("createAgentPoolServices wires the extracted helper services together", async () => {
  const workspace = createTempWorkspace("service-factory-");
  try {
    const modelServices = await createFactoryModelServices(workspace.base);
    const services = createAgentPoolServices({
      pool: new Map(),
      ...createServicesOptions(modelServices, workspace.workspace),
    });

    expect(services.attachments).toBeDefined();
    expect(services.sessionBinder).toBeDefined();
    expect(services).not.toHaveProperty("toolFactory");
    expect(services).not.toHaveProperty("turnCoordinator");
    expect(services.sessionManager).toBeDefined();
    expect(services.runtimeFacade).toBeDefined();
    expect(services.branchManager).toBeDefined();
    expect(services.runtimeFacade.isStreaming("web:default")).toBe(false);
  } finally {
    workspace.cleanup();
  }
});

test("createAgentPoolServices scopes attachment registries per pool", async () => {
  const workspace = createTempWorkspace("service-factory-scope-");
  try {
    const modelServices = await createFactoryModelServices(workspace.base);
    const options = createServicesOptions(modelServices, workspace.workspace);
    const first = createAgentPoolServices({
      pool: new Map(), ...options,
    });
    const second = createAgentPoolServices({
      pool: new Map(), ...options,
    });

    first.attachments.register("web:default", {
      id: 1,
      name: "report.txt",
      contentType: "text/plain",
      size: 6,
      kind: "file",
      sourcePath: "/tmp/report.txt",
    });

    expect(first.attachments.take("web:default")).toHaveLength(1);
    expect(second.attachments.take("web:default")).toHaveLength(0);
  } finally {
    workspace.cleanup();
  }
});
