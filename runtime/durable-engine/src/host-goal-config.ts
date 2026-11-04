import type { SyncSqliteOperation } from "../../src/db/sqlite-async-admission.js";
import { compactGoalInput } from "./host-goal-input.js";
import { getExtensionKvStore } from "../../src/extension-kv-registry.js";

/** Settings retains the authenticated request's existing KV admission scope,
 * without invoking the add-on's legacy HTTP enqueue implementation. */
export function createHostGoalConfig(addon: {
  loadThreadGoal(chat: string): unknown;
  goalResponse(goal: any): unknown;
  applyGoalConfig(chat: string, body: Record<string, unknown>): {
    goal: { goal_id: string; lifecycle_generation: number; updated_at: string } | null;
    continuation?: string; reason: string | null; response: Record<string, unknown>;
  };
  goalInputIdentity(text: string): { goalId: string; generation: number } | false | null;
  prepareGoalInput(text: string, chat: string): { decision: { action: string; text?: string } };
}, options: {
  assertAdmission(chat: string): void;
  admit(input: { sourceId: string; chatJid: string; text: string; queuedAt: string }): number | null;
}) {
  const scoped = async <T>(chatJid: string, body: SyncSqliteOperation<T>, writing: boolean): Promise<T> => {
    options.assertAdmission(chatJid);
    const run = () => { options.assertAdmission(chatJid); const result = body(); options.assertAdmission(chatJid); return result; };
    return writing ? getExtensionKvStore().write!("goal", run) : run();
  };
  return {
    get(chatJid: string) { return scoped(chatJid, () => addon.goalResponse(addon.loadThreadGoal(chatJid)), false); },
    set(chatJid: string, body: Record<string, unknown>) {
      body = structuredClone(body);
      return scoped(chatJid, () => {
        const result = addon.applyGoalConfig(chatJid, body);
        if (result.continuation) {
          const goal = result.goal;
          const prepared = addon.prepareGoalInput(result.continuation, chatJid).decision;
          if (!goal || prepared.action !== "transform" || !prepared.text) throw Error("Goal Settings input no longer executable");
          if (options.admit({ sourceId: `goal-settings:${goal.goal_id}:${goal.lifecycle_generation}`, chatJid,
            text: compactGoalInput(addon, result.continuation, prepared), queuedAt: goal.updated_at }) === null) throw Error("Goal Settings continuation admission unavailable");
        }
        return { ...result.response, continuationQueued: Boolean(result.continuation), continuationReason: result.reason };
      }, true);
    },
  };
}
