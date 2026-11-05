import { compactGoalInput } from "./host-goal-input.js";
import type Database from "bun:sqlite";
import { getDeferredQueuedFollowups } from "../../src/db.js";
import { accountCommittedGoalBatch, isGoalBudgetWrapup } from "./host-goal-usage.js";
import { isNativeMessageInput, type NativeMessageResult, type AcceptedInput, type HostConversationRuntime, type SettledAnswer } from "./host-runtime.js";
import type { TerminalDatabaseEffect, TerminalCommit } from "../../src/service-effects/contracts/terminal-settlement-store.js";
import { withExtensionKvAuthority, type ExtensionKvAuthority } from "../../src/extension-kv-registry.js";

/** Only usable inside applyTerminalEffects, after the exact terminal record was
 * inserted on this connection. Never grants authority from an old receipt alone. */
export function withGoalSettlementAuthority<T>(root: Database, commit: Readonly<TerminalCommit>, assertTerminalScope: (expected: Readonly<TerminalCommit>) => void,
  body: (authority: ExtensionKvAuthority) => T): T {
  let chatJid: string;
  const assertCurrent = () => {
    assertTerminalScope(commit);
    if (!root.inTransaction) throw Error("Goal settlement transaction required");
    const row = root.query(`SELECT c.chat_jid,c.operation_id,c.operation_version,c.disposition,o.phase FROM service_effect_s02_commits c
      JOIN service_effect_s01_operations o ON o.operation_id=c.operation_id WHERE c.operation_id=?`).get(commit.operationId) as
      { chat_jid: string; operation_id: string; operation_version: number; disposition: string; phase: string } | null;
    if (!row || row.operation_id !== commit.operationId || row.operation_version !== commit.operationVersion || row.disposition !== commit.disposition || row.phase !== "terminal")
      throw Error("Exact Goal terminal commit required");
    chatJid = row.chat_jid;
  };
  assertCurrent();
  const authority: ExtensionKvAuthority = { extensionId: "goal", chatJid: chatJid!, assertCurrent,
    write(run) { assertCurrent(); const result = run(); assertCurrent(); return result; } };
  assertCurrent();
  const result = withExtensionKvAuthority(authority, () => body(authority));
  assertCurrent();
  return result;
}

/** Recovery accounting bound to the original input and committed tool evidence.
 * Never infer terminal permission from current Goal status alone. */
type GoalContinuationState = { goal_id: string; lifecycle_generation: number; status: string; chat_jid: string };
type GoalPlanState = { available: boolean; total: number; allCompleted: boolean; fingerprint: string; plan: { step: string; status: string }[] };
interface GoalContinuationAddon {
  claimGoalBudgetWrapup(chat: string, expected: { goalId: string; generation: number }): any;
  buildVisibleGoalPrompt(goal: any, reason: "budget_limited" | "finalize" | "continuation"): string;
  shouldContinueGoalAfterMessage(message: unknown): boolean;
  applyGoalPlanProgress(goal: any, plan: GoalPlanState, hadToolActivity: boolean): { goal: any; decision: { action: string; completionProbeCount?: number } };
  prepareGoalInput(text: string, chat: string): { decision: { action: string; text?: string } };
}
type GoalProjectionOptions = {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "readAcceptedInputText" | "readSettledInputUsage" | "hasSettledGoalTerminalResult">;
  assertOwner(): void;
  /** Committed activity is prepared outside SQLite; current Plan is read inside
   * the terminal transaction. Admission is synchronous and uses the source port. */
  continuation?: {
    addon: GoalContinuationAddon;
    prepare(input: AcceptedInput): Promise<{ message: unknown; hadToolActivity: boolean }>;
    readPlan(chatJid: string, assertCurrent: () => void): GoalPlanState;
    admit(input: { sourceId: string; chatJid: string; text: string; queuedAt: string }, onlyIfIdle?: boolean): number | null;
  };
};
export type GoalProjection = (authority: ExtensionKvAuthority, committedAt: string) => void;

function prepareGoalProjection(addon: Parameters<typeof accountCommittedGoalBatch>[0], options: GoalProjectionOptions) {
  return async (input: AcceptedInput, answer?: SettledAnswer, nativeResult?: NativeMessageResult): Promise<GoalProjection | undefined> => {
    const captured = Object.freeze({ ...input });
    options.assertOwner();
    const runtime = options.runtime();
    const text = await runtime.readAcceptedInputText(captured);
    options.assertOwner();
    const identity = addon.goalInputIdentity(text);
    if (identity === false) throw Error("Invalid accepted Goal identity");
    const goal = withExtensionKvAuthority({ extensionId: "goal", chatJid: captured.chatJid,
      assertCurrent: options.assertOwner, write() { throw Error("Goal preparation is read-only"); } }, () => addon.loadThreadGoal(captured.chatJid));
    let proof: { goalId: string; generation: number; status: "complete" | "stopped" } | undefined;
    if (identity && goal && (goal.status === "complete" || goal.status === "stopped")) {
      proof = { goalId: goal.goal_id, generation: goal.lifecycle_generation, status: goal.status };
      if (identity.goalId !== goal.goal_id || identity.generation + 1 !== goal.lifecycle_generation ||
        !await runtime.hasSettledGoalTerminalResult(captured, proof)) throw Error("Goal terminal operation proof required");
    }
    // Ordinary user turns must also wake an active Goal. Their usage is not
    // Goal-owned: only explicit accepted Goal inputs authorize accounting.
    if (!identity && (!options.continuation || goal?.status !== "active")) return undefined;
    const ordinaryGoal = !identity && goal ? { goalId: goal.goal_id, generation: goal.lifecycle_generation } : undefined;
    const batch = identity ? await runtime.readSettledInputUsage(captured) : { inputs: [], receipts: [] };
    options.assertOwner();
    if (!batch || (identity && !batch.receipts.length)) throw Error("Missing committed Goal usage");
    const ordinary = batch.inputs.findIndex(input => addon.goalInputIdentity(input.text) === null);
    if (ordinary >= 0 && batch.inputs.slice(ordinary).some(input => addon.goalInputIdentity(input.text) !== null))
      throw Error("Goal input after ordinary steer");
    const prefix = ordinary < 0 ? batch.inputs : batch.inputs.slice(0, ordinary);
    // SDK custom inputs are placed after the current tool round. Receipts before
    // the first ordinary placement belong to the Goal prefix; later work does not.
    const receipts = ordinary < 0 ? batch.receipts : batch.receipts.filter(receipt => receipt.entryId < batch.inputs[ordinary]!.entryId);
    // Detach public evidence before crossing the asynchronous payload boundary
    // in commitTerminal; the transaction still rechecks lifecycle and ownership.
    const texts = Object.freeze(prefix.map(input => input.text));
    const usage = Object.freeze(receipts.map(receipt => Object.freeze({ ...receipt })));
    const progress = !answer?.processExit && options.continuation ? structuredClone(await options.continuation.prepare(captured)) : undefined;
    options.assertOwner();
    return (authority, committedAt) => {
      options.assertOwner();
      if (authority.chatJid !== captured.chatJid) throw Error("Goal settlement chat conflict");
      const source = { operationId: nativeResult?.runId ?? captured.operationId, conversationId: captured.conversationId };
      if (identity) accountCommittedGoalBatch(addon, authority, texts, usage, proof, source);
      if (ordinaryGoal) {
        const current = addon.loadThreadGoal(captured.chatJid);
        // Pause/replacement during preparation revokes this continuation. It
        // must not stop the unrelated, already committed user answer settling.
        if (!current || current.goal_id !== ordinaryGoal.goalId || current.lifecycle_generation !== ordinaryGoal.generation || current.status !== "active") return;
      }
      if (!options.continuation || !progress || !options.continuation.addon.shouldContinueGoalAfterMessage(progress.message)) return;
      const current = addon.loadThreadGoal(captured.chatJid) as GoalContinuationState | null;
      if (current?.status === "budget_limited") {
        if (!isGoalBudgetWrapup(addon, captured.chatJid, texts, source)) throw Error("Goal budget input authority unavailable");
        const claimed = options.continuation.addon.claimGoalBudgetWrapup(captured.chatJid,
          { goalId: current.goal_id, generation: current.lifecycle_generation });
        if (!claimed) return;
        const prompt = options.continuation.addon.buildVisibleGoalPrompt(claimed, "budget_limited");
        const prepared = options.continuation.addon.prepareGoalInput(prompt, captured.chatJid).decision;
        if (prepared.action === "handled" || !prepared.text) throw Error("Goal budget wrap-up lifecycle changed");
        // Budget wrap-up follows existing human work, using normal source/FIFO
        // admission. It never claims the worker or starts another scheduler.
        if (options.continuation.admit({ sourceId: `goal-budget:${current.goal_id}:${current.lifecycle_generation}`,
          chatJid: captured.chatJid, text: compactGoalInput(addon, prompt, prepared), queuedAt: committedAt }, false) === null)
          throw Error("Goal budget wrap-up admission changed");
        return;
      }
      if (!current || current.status !== "active") return;
      // This check and the guard mutation/admission share the terminal write.
      if (!nativeResult && (getDeferredQueuedFollowups(captured.chatJid).length || options.root.query(
        "SELECT 1 FROM service_effect_s01_sources WHERE chat_jid=? AND state IN ('pending','claimed') LIMIT 1",
      ).get(captured.chatJid))) return;
      const plan = options.continuation.readPlan(captured.chatJid, authority.assertCurrent);
      authority.assertCurrent();
      const next = options.continuation.addon.applyGoalPlanProgress(current, plan, progress.hadToolActivity);
      if (next.decision.action === "stop") return;
      const prompt = options.continuation.addon.buildVisibleGoalPrompt(next.goal, next.decision.action === "finalize" ? "finalize" : "continuation");
      const prepared = options.continuation.addon.prepareGoalInput(prompt, captured.chatJid).decision;
      if (prepared.action === "handled") throw Error("Goal continuation lifecycle changed");
      const queued = options.continuation.admit({ sourceId: `goal-continuation:${source.operationId}`,
        chatJid: captured.chatJid, text: compactGoalInput(addon, prompt, prepared), queuedAt: committedAt });
      if (queued === null) throw Error("Goal continuation admission changed");
      authority.assertCurrent();
    };
  };
}

/** Historical S02 callers still prove their real terminal row. Native callers
 * below use the SDK result and the existing publication transaction instead. */
export function createHostGoalSettlement(addon: Parameters<typeof accountCommittedGoalBatch>[0], options: GoalProjectionOptions):
  (input: AcceptedInput, answer?: SettledAnswer) => Promise<TerminalDatabaseEffect | undefined> {
  const prepare=prepareGoalProjection(addon,options);
  return async(input,answer)=>{
    const captured=Object.freeze({...input});
    const apply=await prepare(captured,answer);if(!apply)return undefined;
    return (commit,scope)=>{
      if(commit.operationId!==captured.operationId||commit.disposition!=="completed")throw Error("Exact Goal operation completion required");
      withGoalSettlementAuthority(options.root,commit,scope,authority=>apply(authority,commit.committedAt));
    };
  };
}

/** Prepare only from an exact completed SDK result. The application supplies
 * Root publication authority; no synthetic S01/S02 terminal record is created. */
export function createNativeGoalProjection(addon: Parameters<typeof accountCommittedGoalBatch>[0], options: GoalProjectionOptions) {
  const prepare=prepareGoalProjection(addon,options);
  return async(input: AcceptedInput,result: NativeMessageResult):Promise<GoalProjection|undefined>=>{
    if(!isNativeMessageInput(input)||result.status.status!=="done"||!result.answer||!result.inputs.some(source=>source.requestId===input.requestId))throw Error("Completed native Goal source required");
    return prepare(input,result.answer,result);
  };
}
