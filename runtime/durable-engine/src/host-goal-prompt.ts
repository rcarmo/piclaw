import type Database from "bun:sqlite";
import { defineExtension, type GenerationHooks } from "@earendil-works/pi-durable";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import type { HostConversationRuntime } from "./host-runtime.js";
import { accountCommittedGoalBatch, isGoalBudgetWrapup } from "./host-goal-usage.js";
import { withExtensionKvAuthority } from "../../src/extension-kv-registry.js";
import { withGoalSystemInstructions } from "./host-plan-context.js";
import { GoalRequestDenied } from "./host-model-failure.js";

type GoalState = { status: string; goal_id: string; lifecycle_generation: number; deadline_checkpoint?: unknown; budget_limit_reported: boolean };
export function createHostGoalPrompt(addon: {
  loadThreadGoal(chat: string): GoalState | null;
  buildGoalSystemPrompt(goal: any): string;
  buildGoalBudgetLimitPrompt(goal: any): string;
  claimGoalBudgetWrapup(chat: string, expected: { goalId: string; generation: number }): unknown;
  isGoalBudgetInput(text: string): boolean;
  goalInputIdentity(text: string): { goalId: string; generation: number } | false | null;
  resolveGoalInput(text: string, chat: string): { action: string; text?: string };
  accountGoalProgress(chat: string, tokens: number): unknown;
  accountTerminalGoalProgress(chat: string, expected: { goalId: string; generation: number }, tokens: number): unknown;
}, options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "captureRunSource" | "readCapturedInputText" | "hasGoalTerminalResult" | "readCommittedRunUsage" | "prepareGoalContext" | "readMessageInbox" | "removeQueuedMessage">;
  assertOwner(): void;
  failClosed(error: unknown, api: Pick<Parameters<NonNullable<GenerationHooks["beforeRequest"]>>[1], "taskId" | "conversationId">): void;
}) {
  const load = addon.loadThreadGoal.bind(addon), build = addon.buildGoalSystemPrompt.bind(addon);
  // Goal commands/continuations can wait behind ordinary work which finishes or
  // replaces their Goal. Withdraw only still-queued, lifecycle-tagged inputs;
  // the SDK owns the placement race. Never abort a run or its human follow-ups.
  const withdrawStaleQueuedInputs = async (runtime: ReturnType<typeof options.runtime>,
    captured: Awaited<ReturnType<HostConversationRuntime["captureRunSource"]>>,
    scope: <T>(body: () => T) => T) => {
    if (!captured.native) return;
    const binding = captured.inputs[0]!;
    for (const item of await runtime.readMessageInbox(binding)) {
      const stale = scope(() => !!addon.goalInputIdentity(item.content) &&
        addon.resolveGoalInput(item.content, binding.chatJid).action === "handled");
      if (stale) await runtime.removeQueuedMessage(binding, item.submissionId);
      scope(() => {}); // Recheck the invocation/source after each SDK await.
    }
  };
  const beforeRequest: NonNullable<GenerationHooks["beforeRequest"]> = async (request, api, context) => {
    try {
    options.assertOwner();
    const runtime = options.runtime();
    const captured = await runtime.captureRunSource(api.conversationId, api.taskId);
    const source = { operationId: captured.operation.operationId, conversationId: api.conversationId as number };
    const authority = createHostOperationAuthority(options.root, captured, options.assertOwner, true);
    const scope = <T>(body: () => T) => withExtensionKvAuthority({ extensionId: "goal", chatJid: captured.operation.chatJid,
      assertCurrent: authority.assertCurrent, write: authority.write }, () => { authority.assertCurrent(); return body(); });
    const texts = await runtime.readCapturedInputText(captured.inputs);
    authority.assertCurrent();
    await withdrawStaleQueuedInputs(runtime, captured, scope);
    const autonomous = texts.some(text => addon.goalInputIdentity(text) !== null);
    const budgetWrapup = () => scope(() => isGoalBudgetWrapup(addon, captured.operation.chatJid, texts, source));
    const executable = () => scope(() => {
      const goal = load(captured.operation.chatJid);
      if (goal?.deadline_checkpoint) throw new GoalRequestDenied("Native Goal deadline checkpoint recovery unavailable");
      if (goal?.status === "usage_limited") throw new GoalRequestDenied("Native Goal usage-limit recovery unavailable");
      if (goal?.status === "budget_limited" && autonomous && !budgetWrapup()) throw new GoalRequestDenied("Goal budget input authority unavailable");
    });
    executable();
    let terminalProof: { goalId: string; generation: number; status: "complete" | "stopped" } | undefined;
    for (const text of texts) {
      const denied = scope(() => addon.resolveGoalInput(text, captured.operation.chatJid).action === "handled");
      if (!denied) continue;
      if (budgetWrapup()) continue;
      const identity = addon.goalInputIdentity(text);
      const goal = scope(() => load(captured.operation.chatJid));
      if (!identity || !goal || identity.goalId !== goal.goal_id || identity.generation + 1 !== goal.lifecycle_generation ||
        (goal.status !== "complete" && goal.status !== "stopped") ||
        !await runtime.hasGoalTerminalResult(api.conversationId, api.taskId, {
          goalId: goal.goal_id, generation: goal.lifecycle_generation, status: goal.status,
        })) throw new GoalRequestDenied("Goal input lifecycle changed");
      authority.assertCurrent();
      terminalProof = { goalId: goal.goal_id, generation: goal.lifecycle_generation, status: goal.status };
      const current = scope(() => load(captured.operation.chatJid));
      if (!current || current.goal_id !== goal.goal_id || current.lifecycle_generation !== goal.lifecycle_generation || current.status !== goal.status)
        throw new GoalRequestDenied("Goal input lifecycle changed");
    }
    // Ordinary input does not acquire autonomous Goal accounting authority.
    if (texts.length && texts.every(text => addon.goalInputIdentity(text))) {
      const receipts = await runtime.readCommittedRunUsage(api.conversationId, api.taskId);
      authority.assertCurrent();
      if (receipts.length) {
        const writer = createHostOperationAuthority(options.root, captured, options.assertOwner);
        await writer.admitWrite(() => accountCommittedGoalBatch(addon,
          { extensionId: "goal", chatJid: captured.operation.chatJid, ...writer }, texts, receipts, terminalProof, source));
        if (!terminalProof && !budgetWrapup() && texts.some(text => scope(() => addon.resolveGoalInput(text, captured.operation.chatJid).action === "handled")))
          throw new GoalRequestDenied("Goal usage changed input lifecycle");
      }
    }
    executable();
    if (budgetWrapup()) {
      const goal = scope(() => load(captured.operation.chatJid))!;
      if (!goal.budget_limit_reported) {
        const writer = createHostOperationAuthority(options.root, captured, options.assertOwner);
        await writer.admitWrite(() => withExtensionKvAuthority({ extensionId: "goal", chatJid: captured.operation.chatJid, ...writer }, () =>
          addon.claimGoalBudgetWrapup(captured.operation.chatJid, { goalId: goal.goal_id, generation: goal.lifecycle_generation })));
      }
    }
    const contribution = scope(() => {
      const goal = load(captured.operation.chatJid);
      if (goal?.status === "budget_limited" && budgetWrapup()) {
        const prompt = addon.buildGoalBudgetLimitPrompt(goal) + "\nThe goal is already budget_limited. Give the final wrap-up without calling further tools.";
        return { goal, prompt };
      }
      if (!goal || (goal.status !== "active")) return null;
      const prompt = build(goal);
      authority.assertCurrent();
      return { goal, prompt };
    });
    if (!contribution) return request;
    const { goal, prompt } = contribution;
    const assertContributionCurrent = () => {
      executable();
      scope(() => {
        const current = load(captured.operation.chatJid);
        if (!current || current.goal_id !== goal.goal_id || current.lifecycle_generation !== goal.lifecycle_generation || current.status !== goal.status)
          throw new GoalRequestDenied("Goal context lifecycle changed");
        for (const text of texts) if (addon.resolveGoalInput(text, captured.operation.chatJid).action === "handled" && !budgetWrapup())
          throw new GoalRequestDenied("Goal input lifecycle changed");
      });
    };
    assertContributionCurrent();
    // The queue stores the short visible input plus its lifecycle identity.
    // Append expanded continuation instructions once as durable hidden user
    // context, preserving previous snapshots and their exact cache prefixes.
    const continuations = scope(() => texts.flatMap(text => {
      const decision = addon.resolveGoalInput(text, captured.operation.chatJid);
      return decision.action === "transform" && decision.text ? [{ type: "text" as const, text: decision.text }] : [];
    }));
    const messages = await runtime.prepareGoalContext(api.conversationId, api.taskId, captured.inputs,
      request.messages, continuations.length ? continuations : [{ type: "text", text: "Goal state is supplied by the system instructions for this request." }], {
        goalId: goal.goal_id, generation: goal.lifecycle_generation, status: goal.status as "active" | "budget_limited",
        ...(continuations.length ? { inputKey: JSON.stringify([captured.operation.operationId,
          captured.inputs.map(input => input.sourceSeq)]) } : {}),
      }, assertContributionCurrent, context);
    assertContributionCurrent();
    // Match the add-on system-prompt contract. Goal rules must not be demoted
    // to user instructions; the objective is explicitly labelled user data.
    return { messages: withGoalSystemInstructions(messages, prompt, captured.operation.chatJid, api.taskId) };
    } catch (error) {
      options.failClosed(error, api);
      throw Error("Goal request authority unavailable");
    }
  };
  const onYield: NonNullable<GenerationHooks["onYield"]> = async (_answer, api) => {
    try {
      options.assertOwner();
      const runtime = options.runtime();
      const captured = await runtime.captureRunSource(api.conversationId, api.taskId);
      const authority = createHostOperationAuthority(options.root, captured, options.assertOwner, true);
      await withdrawStaleQueuedInputs(runtime, captured, body => withExtensionKvAuthority({ extensionId: "goal", chatJid: captured.operation.chatJid,
        assertCurrent: authority.assertCurrent, write: authority.write }, () => { authority.assertCurrent(); return body(); }));
    } catch (error) {
      options.failClosed(error, api);
      throw Error("Goal queue authority unavailable");
    }
  };
  return defineExtension({ name: "app.host-goal-prompt", hooks: [{ task: "pi.generation", handlers: { beforeRequest, onYield } }] });
}
