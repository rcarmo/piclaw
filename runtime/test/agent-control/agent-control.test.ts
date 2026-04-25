/**
 * test/agent-control/agent-control.test.ts – Integration tests for the control command pipeline.
 *
 * Tests parseControlCommand() → applyControlCommand() end-to-end with a
 * StubSession, covering model switching, thinking levels, abort, compact,
 * session management, queue, and steering/followup mode commands.
 */

import { expect, test } from "bun:test";
import "../helpers.js";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AgentSessionRuntime } from "@mariozechner/pi-coding-agent";
import { applyControlCommand, parseControlCommand } from "../../src/agent-control/index.js";

const modelReasoning = { provider: "openai", id: "gpt-test", reasoning: true } as any;
const modelSimple = { provider: "anthropic", id: "claude-test", reasoning: false } as any;

function createRuntime(session: StubSession): AgentSessionRuntime {
  return {
    session: session as any,
    cwd: "/workspace",
    diagnostics: [],
    services: {} as any,
    modelFallbackMessage: undefined,
    newSession: async (options?: any) => ({
      cancelled: typeof (session as any).newSession === "function" ? !(await (session as any).newSession(options)) : false,
    }),
    switchSession: async (path: string) => ({
      cancelled: typeof (session as any).switchSession === "function" ? !(await (session as any).switchSession(path)) : false,
    }),
    fork: async (entryId: string) => (
      typeof (session as any).fork === "function"
        ? await (session as any).fork(entryId)
        : { cancelled: false }
    ),
    importFromJsonl: async () => ({ cancelled: false }),
    dispose: async () => {
      session.dispose?.();
    },
  } as any;
}

class StubSession {
  model: any = modelReasoning;
  thinkingLevel: ThinkingLevel = "low";
  followUpMode: "all" | "one-at-a-time" = "one-at-a-time";
  reloadCalls = 0;
  abortCalls = 0;
  isStreaming = false;
  isCompacting = false;
  promptCalls: Array<{ text: string; opts: { streamingBehavior: string } }> = [];

  async setModel(model: any) {
    this.model = model;
  }

  async reload() {
    this.reloadCalls += 1;
  }

  async abort() {
    this.abortCalls += 1;
  }

  setThinkingLevel(level: ThinkingLevel) {
    const available = this.getAvailableThinkingLevels();
    this.thinkingLevel = available.includes(level) ? level : available[0];
  }

  setFollowUpMode(mode: "all" | "one-at-a-time") {
    this.followUpMode = mode;
  }

  async prompt(text: string, opts: { streamingBehavior: string }) {
    this.promptCalls.push({ text, opts });
    return;
  }

  supportsThinking() {
    return !!this.model?.reasoning;
  }

  getAvailableThinkingLevels(): ThinkingLevel[] {
    return this.supportsThinking()
      ? (["off", "low", "medium", "high"] as ThinkingLevel[])
      : (["off"] as ThinkingLevel[]);
  }
}

const registry = {
  refresh: () => {},
  getAll: () => [modelReasoning, modelSimple],
  getAvailable: () => [modelReasoning, modelSimple],
} as any;

test("parseControlCommand parses model and thinking commands", () => {
  const modelCmd = parseControlCommand("@PiClaw /model openai/gpt-test", /(?:^|\s)@PiClaw\b/i);
  expect(modelCmd?.type).toBe("model");
  expect(modelCmd && "provider" in modelCmd ? modelCmd.provider : null).toBe("openai");
  expect(modelCmd && "modelId" in modelCmd ? modelCmd.modelId : null).toBe("gpt-test");

  const thinkingCmd = parseControlCommand("/thinking high");
  expect(thinkingCmd?.type).toBe("thinking");
  expect(thinkingCmd && "level" in thinkingCmd ? thinkingCmd.level : null).toBe("high");

  const restartCmd = parseControlCommand("/restart");
  expect(restartCmd?.type).toBe("restart");

  const exitCmd = parseControlCommand("/exit");
  expect(exitCmd?.type).toBe("exit");

  const shellCmd = parseControlCommand("/shell ls -la");
  expect(shellCmd?.type).toBe("shell");
  expect(shellCmd && "command" in shellCmd ? shellCmd.command : null).toBe("ls -la");

  const queueCmd = parseControlCommand("/queue do this next");
  expect(queueCmd?.type).toBe("queue");
  expect(queueCmd && "message" in queueCmd ? queueCmd.message : null).toBe("do this next");

  const queueAllCmd = parseControlCommand("/queue-all batch this");
  expect(queueAllCmd?.type).toBe("queue_all");
  expect(queueAllCmd && "message" in queueAllCmd ? queueAllCmd.message : null).toBe("batch this");

  const steerCmd = parseControlCommand("/steer zoom in");
  expect(steerCmd?.type).toBe("steer");
  expect(steerCmd && "message" in steerCmd ? steerCmd.message : null).toBe("zoom in");

  const stateCmd = parseControlCommand("/state");
  expect(stateCmd?.type).toBe("state");

  const autoCompactCmd = parseControlCommand("/auto-compact on");
  expect(autoCompactCmd?.type).toBe("auto_compact");
  expect(autoCompactCmd && "enabled" in autoCompactCmd ? autoCompactCmd.enabled : null).toBe(true);

  const bashCmd = parseControlCommand("/bash ls");
  expect(bashCmd?.type).toBe("bash");
  expect(bashCmd && "command" in bashCmd ? bashCmd.command : null).toBe("ls");

  const abortCmd = parseControlCommand("/abort");
  expect(abortCmd?.type).toBe("abort");

  const treeCmd = parseControlCommand("/tree abc123 --summarize --label checkpoint");
  expect(treeCmd?.type).toBe("tree");
  expect(treeCmd && "targetId" in treeCmd ? treeCmd.targetId : null).toBe("abc123");

  const labelCmd = parseControlCommand("/label abc123 milestone");
  expect(labelCmd?.type).toBe("label");
  expect(labelCmd && "label" in labelCmd ? labelCmd.label : null).toBe("milestone");

  const agentNameCmd = parseControlCommand("/agent-name Pi");
  expect(agentNameCmd?.type).toBe("agent_name");
  expect(agentNameCmd && "name" in agentNameCmd ? agentNameCmd.name : null).toBe("Pi");

  const agentAvatarCmd = parseControlCommand("/agent-avatar https://example.com/avatar.png");
  expect(agentAvatarCmd?.type).toBe("agent_avatar");
  expect(agentAvatarCmd && "avatar" in agentAvatarCmd ? agentAvatarCmd.avatar : null).toBe(
    "https://example.com/avatar.png"
  );

  const searchCmd = parseControlCommand("/search --scope notes \"token pricing\"");
  expect(searchCmd?.type).toBe("search_workspace");
  expect(searchCmd && "query" in searchCmd ? searchCmd.query : null).toBe("token pricing");
  expect(searchCmd && "scope" in searchCmd ? searchCmd.scope : null).toBe("notes");
});

test("applyControlCommand switches model and thinking level", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);
  session.model = modelSimple;
  session.thinkingLevel = "off";

  const modelResult = await applyControlCommand(runtime as any, registry, {
    type: "model",
    provider: "openai",
    modelId: "gpt-test",
    raw: "/model openai/gpt-test",
  });

  expect(modelResult.status).toBe("success");
  expect(session.model).toBe(modelReasoning);
  expect(modelResult.message).toContain("openai/gpt-test");
  expect(session.reloadCalls).toBe(0);

  const thinkingResult = await applyControlCommand(runtime as any, registry, {
    type: "thinking",
    level: "high",
    raw: "/thinking high",
  });

  expect(thinkingResult.status).toBe("success");
  expect(session.thinkingLevel).toBe("high");
  expect(session.reloadCalls).toBe(0);
});

test("applyControlCommand reports unsupported thinking", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);
  session.model = modelSimple;

  const result = await applyControlCommand(runtime as any, registry, {
    type: "thinking",
    level: "high",
    raw: "/thinking high",
  });

  expect(result.status).toBe("error");
  expect(session.thinkingLevel).toBe("off");
});

test("applyControlCommand resolves /effort max alias through thinking handler", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);
  // max alias only resolves on Anthropic (effort provider)
  session.model = { provider: "anthropic", id: "claude-test", reasoning: true } as any;
  session.thinkingLevel = "low";

  const result = await applyControlCommand(runtime as any, registry, {
    type: "thinking",
    level: "max",
    raw: "/effort max",
  });

  expect(result.status).toBe("success");
  // max→xhigh via alias, StubSession clamps to "off" (xhigh not in available list)
  expect(result.message).toContain("requested max");
  expect(result.thinking_level).toBe("off");
  expect(result.thinking_level_label).toBeDefined();
});

test("applyControlCommand includes thinking_level_label in response", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);
  session.model = modelReasoning;

  const result = await applyControlCommand(runtime as any, registry, {
    type: "thinking",
    level: "high",
    raw: "/thinking high",
  });

  expect(result.status).toBe("success");
  expect(result.thinking_level).toBe("high");
  expect(result.thinking_level_label).toBe("high");
});

test("applyControlCommand sends immediate steering when stream active", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);
  session.isStreaming = true;

  const result = await applyControlCommand(runtime as any, registry, {
    type: "steer",
    message: "focus on pricing",
    raw: "/steer focus on pricing",
  } as any);

  expect(result.status).toBe("success");
  expect(result.queued_steer).toBe(true);
  expect(session.promptCalls.length).toBe(1);
  expect(session.promptCalls[0].text).toBe("focus on pricing");
  expect(session.promptCalls[0].opts.streamingBehavior).toBe("steer");
});

test("applyControlCommand falls back to follow-up when steering with no active response", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);

  const result = await applyControlCommand(runtime as any, registry, {
    type: "steer",
    message: "focus on pricing",
    raw: "/steer focus on pricing",
  } as any);

  expect(result.status).toBe("success");
  expect(result.queued_followup).toBe(true);
  expect(result.message).toContain("Queued follow-up");
  expect(session.promptCalls.length).toBe(1);
  expect(session.promptCalls[0].text).toBe("focus on pricing");
});

test("applyControlCommand queues follow-up when queue has no active response", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);

  const result = await applyControlCommand(runtime as any, registry, {
    type: "queue",
    message: "capture this for later",
    raw: "/queue capture this for later",
  } as any);

  expect(result.status).toBe("success");
  expect(result.queued_followup).toBe(true);
  expect(result.message).toContain("Queued follow-up");
  expect(session.promptCalls.length).toBe(1);
  expect(session.promptCalls[0].text).toBe("capture this for later");
  expect(session.promptCalls[0].opts?.streamingBehavior).toBe("followUp");
});

test("applyControlCommand restarts agent", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);

  const result = await applyControlCommand(runtime as any, registry, {
    type: "restart",
    raw: "/restart",
  });

  expect(result.status).toBe("success");
  expect(session.abortCalls).toBe(1);
  expect(session.reloadCalls).toBe(1);
  expect(result.message).toContain("Agent restarted");
});

test("applyControlCommand exits agent so supervisor can restart it", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);
  let scheduled = 0;
  (globalThis as any).__PICLAW_EXIT_SCHEDULER__ = () => {
    scheduled += 1;
  };

  try {
    const result = await applyControlCommand(runtime as any, registry, {
      type: "exit",
      raw: "/exit",
    });

    expect(result.status).toBe("success");
    expect(result.message).toContain("supervisor can restart");
    expect(session.abortCalls).toBe(1);
    expect(scheduled).toBe(1);
  } finally {
    delete (globalThis as any).__PICLAW_EXIT_SCHEDULER__;
  }
});

test("applyControlCommand aborts agent", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);

  const result = await applyControlCommand(runtime as any, registry, {
    type: "abort",
    raw: "/abort",
  });

  expect(result.status).toBe("success");
  expect(session.abortCalls).toBe(1);
  expect(result.message).toContain("Aborted");
});

test("applyControlCommand lists models when /model has no args", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);

  const result = await applyControlCommand(runtime as any, registry, {
    type: "model",
    raw: "/model",
  });

  expect(result.status).toBe("success");
  expect(result.message).toContain("**Available models**");
  expect(result.message).toContain("openai/gpt-test");
  expect(result.message).toContain("current");
});

test("applyControlCommand blocks model switching during compaction", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);
  session.isCompacting = true;

  const result = await applyControlCommand(runtime as any, registry, {
    type: "model",
    provider: "openai",
    modelId: "gpt-test",
    raw: "/model openai/gpt-test",
  });

  expect(result.status).toBe("error");
  expect(result.message).toContain("Auto-compaction is still running");
});

test("/model uses session registry when available", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);
  (session as any).modelRegistry = {
    refresh: () => {},
    getAvailable: () => [modelSimple],
    getAll: () => [modelSimple],
  } as any;

  const result = await applyControlCommand(runtime as any, registry, {
    type: "model",
    raw: "/model",
  });

  expect(result.status).toBe("success");
  expect(result.message).toContain("anthropic/claude-test");
  expect(result.message).not.toContain("openai/gpt-test");
});

test("/model rejects provider without model id", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);
  const parsed = parseControlCommand("/model openai/");

  expect(parsed?.type).toBe("model");
  expect(parsed && "provider" in parsed ? parsed.provider : null).toBe("openai");
  expect(parsed && "modelId" in parsed ? parsed.modelId : null).toBeUndefined();

  const result = await applyControlCommand(runtime as any, registry, parsed as any);
  expect(result.status).toBe("error");
  expect(result.message).toContain("model");
  expect(result.message.toLowerCase()).toContain("provider");
});

test("/model warns when model id matches multiple providers", async () => {
  const session = new StubSession();
  const runtime = createRuntime(session);
  const duplicateModel = { provider: "azure", id: "gpt-test", reasoning: true } as any;
  const dupRegistry = {
    refresh: () => {},
    getAvailable: () => [modelReasoning, duplicateModel, modelSimple],
    getAll: () => [modelReasoning, duplicateModel, modelSimple],
  } as any;

  const result = await applyControlCommand(runtime as any, dupRegistry, {
    type: "model",
    modelId: "gpt-test",
    raw: "/model gpt-test",
  });

  expect(result.status).toBe("error");
  expect(result.message).toContain("matches multiple providers");
  expect(result.message).toContain("openai/gpt-test");
  expect(result.message).toContain("azure/gpt-test");
});
