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
    const fakeRuntime = { refresh: async () => ({ aborted: false, errors: new Map() }) } as unknown as ModelRuntime;

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
    expect(captured?.credentials).toBe(services.credentialStore);
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
    const fakeRuntime = { refresh: async () => ({ aborted: false, errors: new Map() }) } as unknown as ModelRuntime;

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
