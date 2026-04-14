import { expect, test } from "bun:test";

import { DEFAULT_COMPACTION_SETTINGS } from "@mariozechner/pi-coding-agent";
import type { AgentSessionRuntime } from "@mariozechner/pi-coding-agent";

import { getAttachmentRegistry } from "../../src/agent-pool/attachments.js";
import { AgentTurnCoordinator } from "../../src/agent-pool/turn-coordinator.js";
import { runAgentPrompt } from "../../src/agent-pool/run-agent-orchestrator.js";

function createRuntime(session: any): AgentSessionRuntime {
  return {
    session,
    cwd: "/workspace",
    diagnostics: [],
    services: {} as any,
    modelFallbackMessage: undefined,
    newSession: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    importFromJsonl: async () => ({ cancelled: false }),
    dispose: async () => {},
  } as any;
}

test("runAgentPrompt aggregates deltas and returns pending attachments", async () => {
  const attachments = getAttachmentRegistry();
  attachments.clear("web:default");

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      attachments.register("web:default", {
        id: 1,
        name: "out.txt",
        contentType: "text/plain",
        size: 3,
        kind: "file",
        sourcePath: "/tmp/out.txt",
      });
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } });
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " world" } });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const forkStates: Array<string | null> = [];
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: (chatJid) => attachments.take(chatJid),
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const result = await runAgentPrompt("test", "web:default", { timeoutMs: 0 }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator,
    clearAttachments: (chatJid) => attachments.clear(chatJid),
    takeAttachments: (chatJid) => attachments.take(chatJid),
    logsDir: process.env.PICLAW_WORKSPACE || "/workspace",
    setActiveForkBaseLeaf: (_chatJid, leafId) => {
      forkStates.push(leafId);
    },
    clearActiveForkBaseLeaf: () => {
      forkStates.push(null);
    },
  });

  expect(result.status).toBe("success");
  expect(result.result).toBe("hello world");
  expect(result.attachments).toHaveLength(1);
  expect(forkStates).toEqual(["leaf-1", null]);
});

test("runAgentPrompt auto-compacts before prompting when estimated context exceeds the threshold", async () => {
  const calls: string[] = [];

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-1",
      buildSessionContext: () => ({
        messages: [
          { role: "user", content: "x".repeat(200) },
        ],
      }),
    };
    settingsManager = {
      getCompactionSettings: () => ({
        ...DEFAULT_COMPACTION_SETTINGS,
        enabled: true,
        reserveTokens: 10,
      }),
    };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      calls.push("compact");
    }
    async prompt() {
      calls.push("prompt");
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const result = await runAgentPrompt("test", "web:default", { timeoutMs: 0 }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator,
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: process.env.PICLAW_WORKSPACE || "/workspace",
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result.status).toBe("success");
  expect(calls).toEqual(["compact", "prompt"]);
});

test("runAgentPrompt skips pre-prompt auto-compaction when it is disabled", async () => {
  const calls: string[] = [];

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-1",
      buildSessionContext: () => ({
        messages: [
          { role: "user", content: "x".repeat(200) },
        ],
      }),
    };
    settingsManager = {
      getCompactionSettings: () => ({
        ...DEFAULT_COMPACTION_SETTINGS,
        enabled: false,
        reserveTokens: 10,
      }),
    };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      calls.push("compact");
    }
    async prompt() {
      calls.push("prompt");
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const result = await runAgentPrompt("test", "web:default", { timeoutMs: 0 }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator,
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: process.env.PICLAW_WORKSPACE || "/workspace",
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result.status).toBe("success");
  expect(calls).toEqual(["prompt"]);
});

test("runAgentPrompt surfaces provider error instead of returning null result", async () => {
  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      for (const listener of this.listeners) {
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "error",
            errorMessage:
              'Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"You\'re out of extra usage."},"request_id":"req_abc123"}',
            content: [],
          },
        });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const result = await runAgentPrompt("hello", "web:default", { timeoutMs: 0 }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator,
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: process.env.PICLAW_WORKSPACE || "/workspace",
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result.status).toBe("error");
  expect(result.error).toContain("invalid_request_error");
  expect(result.error).toContain("extra usage");
  expect(result.result).toBeNull();
});

test("runAgentPrompt ignores commentary-only aborted output", async () => {
  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      for (const listener of this.listeners) {
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_start",
            contentIndex: 0,
            partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) }] },
          },
        });
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "progress update",
            contentIndex: 0,
            partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) }] },
          },
        });
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "progress update", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) }],
          },
        });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const result = await runAgentPrompt("test", "web:default", { timeoutMs: 0 }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator,
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: process.env.PICLAW_WORKSPACE || "/workspace",
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result.status).toBe("success");
  expect(result.result).toBeNull();
  expect(result.attachments).toBeUndefined();
});
