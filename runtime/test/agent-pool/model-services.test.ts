import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CreateModelRuntimeOptions, ModelRuntime } from "@earendil-works/pi-coding-agent";

import { PiclawModelRegistry, createRuntimeModelServices } from "../../src/agent-pool/model-services.js";

const roots: string[] = [];
const originalPiclawAgentDir = process.env.PICLAW_PI_AGENT_DIR;
const originalUpstreamAgentDir = process.env.PI_CODING_AGENT_DIR;
afterEach(() => {
  if (originalPiclawAgentDir === undefined) delete process.env.PICLAW_PI_AGENT_DIR;
  else process.env.PICLAW_PI_AGENT_DIR = originalPiclawAgentDir;
  if (originalUpstreamAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalUpstreamAgentDir;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempAgentDir(): string {
  const root = mkdtempSync(join(tmpdir(), "piclaw-model-services-"));
  roots.push(root);
  return join(root, "agent");
}

describe("runtime model services", () => {
  test("creates the runtime cache-first with canonical agent paths", async () => {
    const agentDir = tempAgentDir();
    let captured: CreateModelRuntimeOptions | null = null;
    const fakeRuntime = { getProvider: () => undefined, refresh: async () => ({ aborted: false, errors: new Map() }) } as unknown as ModelRuntime;

    const services = await createRuntimeModelServices({
      agentDir,
      createModelRuntime: async (options) => {
        captured = options;
        return fakeRuntime;
      },
    });

    expect(captured).toMatchObject({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
      modelsStorePath: join(agentDir, "models-store.json"),
      allowModelNetwork: false,
    });
    const runtimeOptions = captured as CreateModelRuntimeOptions | null;
    expect(runtimeOptions?.credentials).not.toBe(services.credentialStore);
    await runtimeOptions!.credentials!.modify("fixture", async () => ({ type: "api_key", key: "synthetic-key" }));
    expect(await services.credentialStore.read("fixture")).toEqual({ type: "api_key", key: "synthetic-key" });
    expect(services.modelRuntime).toBe(fakeRuntime);
    expect(services.modelRegistry).toBeInstanceOf(PiclawModelRegistry);
  });

  test("default construction uses Piclaw's agent directory over a conflicting upstream path", async () => {
    const root = mkdtempSync(join(tmpdir(), "piclaw-model-services-env-"));
    roots.push(root);
    const piclawAgentDir = join(root, "piclaw-agent");
    process.env.PICLAW_PI_AGENT_DIR = piclawAgentDir;
    process.env.PI_CODING_AGENT_DIR = join(root, "upstream-agent");
    let captured: CreateModelRuntimeOptions | null = null;
    const fakeRuntime = { getProvider: () => undefined, refresh: async () => ({ aborted: false, errors: new Map() }) } as unknown as ModelRuntime;

    const services = await createRuntimeModelServices({
      createModelRuntime: async (options) => {
        captured = options;
        return fakeRuntime;
      },
    });

    expect(services.agentDir).toBe(piclawAgentDir);
    expect(services.credentialStore.authPath).toBe(join(piclawAgentDir, "auth.json"));
    expect(captured).toMatchObject({
      authPath: join(piclawAgentDir, "auth.json"),
      modelsPath: join(piclawAgentDir, "models.json"),
      modelsStorePath: join(piclawAgentDir, "models-store.json"),
    });
  });

  test("provider composition and cache-only refresh finish before the native catalogue can be captured", async () => {
    const events: string[] = [];
    const fakeRuntime = {
      getProvider: () => ({ id: "github-copilot", getModels: () => [] }),
      registerNativeProvider: () => { events.push("register"); },
      refresh: async (options: unknown) => {
        expect(options).toEqual({ allowNetwork: false });
        events.push("refresh");
        return { aborted: false, errors: new Map() };
      },
    } as unknown as ModelRuntime;
    const services = await createRuntimeModelServices({ agentDir: tempAgentDir(), createModelRuntime: async () => fakeRuntime });
    events.push("capture-native-catalogue");
    expect(services.modelRuntime).toBe(fakeRuntime);
    expect(events).toEqual(["register", "refresh", "capture-native-catalogue"]);
  });

  for (const aborted of [false, true]) test(`catalogue preparation fails closed before backend capture: aborted=${aborted}`, async () => {
    const fakeRuntime = { getProvider: () => undefined,
      refresh: async () => ({ aborted, errors: aborted ? new Map() : new Map([["fixture", new Error("catalogue unavailable")]]) }),
    } as unknown as ModelRuntime;
    await expect(createRuntimeModelServices({ agentDir: tempAgentDir(), createModelRuntime: async () => fakeRuntime }))
      .rejects.toThrow("Model catalogue preparation failed");
  });

  test("compat registry propagates aborted refresh state and provider errors", async () => {
    tempAgentDir();
    const providerError = new Error("catalog unavailable");
    const runtime = {
      refresh: async () => ({ aborted: true, errors: new Map([["github-copilot", providerError]]) }),
    } as unknown as ModelRuntime;
    const registry = new PiclawModelRegistry(runtime);

    const result = await registry.refresh({ providers: ["github-copilot"], signal: AbortSignal.abort() });

    expect(result.aborted).toBe(true);
    expect(result.errors.get("github-copilot")).toBe(providerError);
  });

  test("compat registry coalesces concurrent config reloads", async () => {
    tempAgentDir();
    let refreshCalls = 0;
    const refreshOptions: unknown[] = [];
    let release: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const runtime = {
      refresh: async (options: unknown) => {
        refreshCalls += 1;
        refreshOptions.push(options);
        await blocker;
        return { aborted: false, errors: new Map() };
      },
    } as unknown as ModelRuntime;
    const registry = new PiclawModelRegistry(runtime);

    const first = registry.refresh();
    const second = registry.refresh();
    expect(first).toBe(second);
    expect(refreshCalls).toBe(1);
    release?.();
    await first;

    await registry.refresh();
    expect(refreshCalls).toBe(2);
    expect(refreshOptions).toEqual([{ allowNetwork: false }, { allowNetwork: false }]);
  });
});
