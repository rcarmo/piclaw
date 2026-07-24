import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model, type Provider, type SimpleStreamOptions, type StreamOptions } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { FileCredentialStore } from "../../src/agent-pool/credential-store.js";

const model: Model<"openai-responses"> = {
  id: "ambient-auth-test",
  name: "Ambient Auth Test",
  api: "openai-responses",
  provider: "ambient-auth-test",
  baseUrl: "https://example.invalid/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 1_024,
};

function assistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

describe("Earendil 0.81.0 ambient auth", () => {
  test("branch summarization can use a native provider that supplies auth outside Pi", async () => {
    const root = mkdtempSync(join(tmpdir(), "piclaw-ambient-auth-"));
    try {
      const credentials = new FileCredentialStore(join(root, "auth.json"));
      const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
      let streamCalls = 0;
      const streamWithAmbientAuth = (_selectedModel: Model<any>, _context: Context, options?: StreamOptions | SimpleStreamOptions) => {
        streamCalls += 1;
        expect(options?.apiKey).toBe("ambient-native-key");
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "done", reason: "stop", message: assistant("branch summary text") });
        return stream;
      };
      const provider: Provider<"openai-responses"> = {
        id: model.provider,
        name: "Ambient Auth Test",
        baseUrl: model.baseUrl,
        auth: {
          apiKey: {
            name: "Ambient test auth",
            resolve: async () => ({ auth: { apiKey: "ambient-native-key" }, source: "ambient-test" }),
          },
        },
        getModels: () => [model],
        stream: streamWithAmbientAuth,
        streamSimple: streamWithAmbientAuth,
      };
      modelRuntime.registerNativeProvider(provider);
      await modelRuntime.refresh({ allowNetwork: false });

      const settingsManager = SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
      });
      const sessionManager = SessionManager.create(root, root);
      const { session } = await createAgentSession({
        cwd: root,
        sessionManager,
        modelRuntime,
        settingsManager,
        model,
        tools: [],
      });

      const targetId = sessionManager.appendMessage({ role: "user", content: "first branch", timestamp: Date.now() });
      sessionManager.appendMessage(assistant("first reply"));
      sessionManager.appendMessage({ role: "user", content: "abandoned branch work", timestamp: Date.now() });
      sessionManager.appendMessage(assistant("abandoned reply"));

      const result = await session.navigateTree(targetId, { summarize: true });

      expect(result.cancelled).toBe(false);
      expect(streamCalls).toBe(1);
      expect(result.summaryEntry?.type).toBe("branch_summary");
      expect(result.summaryEntry?.summary).toContain("branch summary text");
      session.dispose();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
