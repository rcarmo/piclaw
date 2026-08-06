import { describe, expect, test } from "bun:test";

import "../helpers.js";

import { createAttemptToolBudgetController } from "../../src/agent-pool/run-agent-attempt-budget.js";

describe("prompt attempt tool budget", () => {
  test("blocks newly emitted tool calls during the recovery finalization reserve", async () => {
    let activeTools = ["read", "bash"];
    const session = {
      agent: {},
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names: string[]) => { activeTools = [...names]; },
    } as any;
    const controller = createAttemptToolBudgetController({
      session,
      chatJid: "web:test-finalization-reserve",
      initialToolExecutionCount: 0,
      toolUseMessageBudget: 64,
      toolUseWarningThreshold: 48,
      runOptions: {},
      getRunObservabilityDetails: () => ({}),
    });

    expect(controller.applyFinalizationReserve()).toBe(true);
    expect(activeTools).toEqual([]);
    const blocked = await session.agent.beforeToolCall({
      toolCall: { id: "call-after-reserve", name: "bash" },
      args: { command: "echo late" },
    });
    expect(blocked).toEqual({
      block: true,
      reason: "Automatic recovery is in its finalization window. Return a terminal assistant reply without calling more tools.",
    });
    expect(controller.applyFinalizationReserve()).toBe(false);

    controller.restoreToolBudgetGuard();
    controller.restoreToolBudgetSoftStop();
    expect(activeTools).toEqual(["read", "bash"]);
  });

  test("locks the tool surface immediately after the completed execution budget is reached", async () => {
    let activeTools = ["read", "bash"];
    const session = {
      agent: {},
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names: string[]) => { activeTools = [...names]; },
    } as any;
    const controller = createAttemptToolBudgetController({
      session,
      chatJid: "web:test-completed-budget",
      initialToolExecutionCount: 0,
      toolUseMessageBudget: 2,
      toolUseWarningThreshold: 1,
      runOptions: {},
      getRunObservabilityDetails: () => ({}),
    });

    expect(await session.agent.beforeToolCall({ toolCall: { id: "call-a", name: "read" }, args: {} })).toBeUndefined();
    expect(await session.agent.beforeToolCall({ toolCall: { id: "call-b", name: "read" }, args: {} })).toBeUndefined();
    controller.consumeToolExecutionEnd("call-a", false);
    controller.consumeToolExecutionEnd("call-b", false);
    controller.enforceCompletedExecutionBudget();

    expect(controller.state.toolUseBudgetExceeded).toBe(true);
    expect(activeTools).toEqual([]);
    await expect(session.agent.beforeToolCall({ toolCall: { id: "call-c", name: "bash" }, args: {} })).resolves.toEqual({
      block: true,
      reason: "Per-turn tool execution budget exhausted (2/2). Ask the user to continue before calling more tools.",
    });

    controller.restoreToolBudgetGuard();
    controller.restoreToolBudgetSoftStop();
    expect(activeTools).toEqual(["read", "bash"]);
  });

  test("applies a deferred soft stop after every threshold-crossing tool call finishes", () => {
    let activeTools = ["read", "bash"];
    const session = {
      agent: {},
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names: string[]) => { activeTools = [...names]; },
    } as any;
    const controller = createAttemptToolBudgetController({
      session,
      chatJid: "web:test-attempt-budget",
      initialToolExecutionCount: 0,
      toolUseMessageBudget: 2,
      toolUseWarningThreshold: 1,
      runOptions: {},
      getRunObservabilityDetails: () => ({}),
    });

    controller.requestToolBudgetSoftStop([{ id: "call-a" }, { id: "call-b" }], 2);
    expect(controller.state.toolUseSoftStopApplied).toBe(false);
    expect(activeTools).toEqual(["read", "bash"]);

    controller.consumeToolExecutionEnd("call-a", false);
    expect(controller.state.toolUseSoftStopApplied).toBe(false);
    expect(activeTools).toEqual(["read", "bash"]);

    controller.consumeToolExecutionEnd("call-b", false);
    expect(controller.state.toolUseSoftStopApplied).toBe(true);
    expect(activeTools).toEqual([]);

    controller.restoreToolBudgetSoftStop();
    expect(activeTools).toEqual(["read", "bash"]);
  });
});
