import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import "./src/test-guard.js";
import { expect } from "bun:test";
const applicationTest = isolatedApplicationTest(import.meta.url);
import { cpSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { getDeferredQueuedFollowups, storeChatMetadata } from "../../runtime/src/db.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";

import { createAssistantMessageEventStream } from "../../node_modules/@earendil-works/pi-ai";
import { createTestCredentialStore } from "../../runtime/test/model-services-fixture.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { createRuntimeBaseServices } from "../../runtime/src/runtime/composition.js";
import { WebChannel } from "../../runtime/src/channels/web.js";
import { admitWebUserMessage } from "../../runtime/src/channels/web/messaging/message-store.js";

applicationTest("Regrets-only actual factory executes default decision-off review, queues command and reopens", async () => {
  const workspace = process.env.PICLAW_WORKSPACE!;
  const source = process.env.DURABLE_ADDONS_ROOT!;
  const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-late-night-regrets");
  cpSync(join(source, "addons/late-night-regrets"), pkg, { recursive: true, filter: p => !p.split("/").includes("node_modules") });
  symlinkSync(join(import.meta.dir, "../../node_modules"), join(pkg, "node_modules"));
  process.env.PICLAW_DB_IN_MEMORY = "0"; initDatabase();
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "regrets-owner.lock"), strictOwnership: true, disabled: false });
  const model = { provider: "synthetic", id: "approved", name: "Approved", api: "openai-completions", baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let calls = 0, result = "";
  const services = { modelRegistry: { getAvailable: () => [model] }, modelRuntime: {
    getPhysicalModel: () => model,
    streamSimple(_model: unknown, input: any) {
      calls++;
      const tool = input.messages.find((m: any) => m.role === "toolResult");
      if (tool) result = JSON.stringify(tool);
      const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
        content: tool ? [{ type: "text", text: "review complete" }] : [{ type: "toolCall", id: "regrets-call", name: "regrets_review", arguments: {} }],
        stopReason: tool ? "stop" : "toolUse", usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { ...model.cost, total: 0 } } } as any;
      const stream = createAssistantMessageEventStream(); stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message); return stream;
    },
    completeSimple() { throw Error("Default decision-off must not request a nested model"); },
  } } as any;
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    expect(calls).toBe(0);
    const base = createRuntimeBaseServices({ dataDir: workspace });
    const pool = new AgentPool({ credentialStore: createTestCredentialStore({}), modelRuntime: services.modelRuntime, modelRegistry: services.modelRegistry, ...backend.sessionOptions } as any);
    const bound = backend.bind({ queue: base.queue, agentPool: pool });
    const channel = new WebChannel(bound);
    const admitted = await admitWebUserMessage(channel, { chatJid: "web:default", content: "Review recent exchanges", mediaIds: [], isBot: false, agentId: "default", agentName: "Fixture" },
      { acceptSource: bound.getInputSourceAdmission!("web:default") }, () => owner.assertCurrentOwner(), new AbortController().signal);
    expect(admitted).not.toBeNull();
    const id = (getDb().query("SELECT id FROM messages WHERE rowid=?").get(admitted!.id) as any).id;
    expect(await bound.dispatchAcceptedInput!("web:default", id, admitted!.id)!()).toBe("settled");
    expect(result).toContain("reflections_path"); expect(result).toContain("disabled"); expect(result).not.toContain('"isError":true');
    expect(calls).toBe(2);
    expect(await pool.applySlashCommand("web:default", "/regrets")).toMatchObject({ status: "success" });
    expect(calls).toBe(2);
    const queued = getDeferredQueuedFollowups("web:default");
    expect(queued).toHaveLength(1);
    expect(queued[0]!.queuedContent).toContain("regrets_review");
    const sourceId = queued[0]!.source_id;
    expect(sourceId).toBeTruthy();
    expect(getDb().query("SELECT source_id FROM service_effect_s01_sources WHERE source_id=?").get(sourceId!)).toBeTruthy();
    await backend.close(); backend = undefined;
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    expect(calls).toBe(2);
    expect(getDeferredQueuedFollowups("web:default")[0]!.source_id).toBe(sourceId);
  } finally { await backend?.close(); owner.release(); closeDatabase(); }
});
