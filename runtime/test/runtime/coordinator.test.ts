import { describe, expect, test } from "bun:test";
import { startRuntimeLoop, type StartRuntimeLoopDeps } from "../../src/runtime/coordinator.js";
import type { MessageLoopDeps, MessageProcessingDeps } from "../../src/runtime/message-loop.js";

describe("runtime coordinator", () => {
  test("binds message processing deps and delegates to runMessageLoop", async () => {
    const queue = {} as unknown as MessageLoopDeps["queue"];
    const state = {} as unknown as MessageLoopDeps["state"];
    const agentPool = {} as unknown as MessageProcessingDeps["agentPool"];

    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    let capturedLoopDeps: MessageLoopDeps | null = null;
    let capturedChatJid: string | null = null;
    let capturedMessageDeps: MessageProcessingDeps | null = null;

    const runMessageLoopFn: NonNullable<StartRuntimeLoopDeps["runMessageLoopFn"]> = async (deps, signal) => {
      capturedSignal = signal;
      capturedLoopDeps = deps;
    };

    const processMessagesFn: NonNullable<StartRuntimeLoopDeps["processMessagesFn"]> = async (chatJid, deps) => {
      capturedChatJid = chatJid;
      capturedMessageDeps = deps;
      return true;
    };

    await startRuntimeLoop({
      queue,
      state,
      agentPool,
      assistantName: "Pi",
      triggerPattern: /@Pi/i,
      pollIntervalMs: 1234,
      signal: controller.signal,
      runMessageLoopFn,
      processMessagesFn,
    });

    expect(capturedSignal).toBe(controller.signal);
    expect(capturedLoopDeps).not.toBeNull();
    if (!capturedLoopDeps) throw new Error("Expected loop deps to be captured");

    expect(capturedLoopDeps.queue).toBe(queue);
    expect(capturedLoopDeps.state).toBe(state);
    expect(capturedLoopDeps.assistantName).toBe("Pi");
    expect(capturedLoopDeps.pollIntervalMs).toBe(1234);

    await capturedLoopDeps.processMessages("chat:1");
    expect(capturedChatJid).toBe("chat:1");

    expect(capturedMessageDeps).not.toBeNull();
    if (!capturedMessageDeps) throw new Error("Expected message deps to be captured");

    expect(capturedMessageDeps.agentPool).toBe(agentPool);
    expect(capturedMessageDeps.state).toBe(state);
    expect(capturedMessageDeps.assistantName).toBe("Pi");
    expect(capturedMessageDeps.triggerPattern).toBeInstanceOf(RegExp);
  });
});
