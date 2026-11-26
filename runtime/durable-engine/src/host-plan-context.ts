import { LiveDoc, type Conversation, type EntryRecord, type TaskId } from "@earendil-works/pi-durable";
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/chord/context";
import { isBoxedPrimitive, isProxy } from "node:util/types";

export const hostPlanContextKind = "host.plan-context";
export const hostGoalContextKind = "host.goal-context";
type ContextEntry = Pick<EntryRecord, "kind" | "data" | "model">;
export type GoalContextIdentity = { goalId: string; generation: number; status: "active" | "budget_limited"; systemPrompt?: string; inputKey?: string };

/** Hidden model context, never accepted user input or a visible timeline entry. */
export function assertHostPlanContext(entry: ContextEntry): void { assertHiddenContext(entry, hostPlanContextKind, "host:plan-prompt", "Plan"); }
export function assertHostGoalContext(entry: ContextEntry): void {
  assertHiddenContext(entry, hostGoalContextKind, "host:goal-prompt", "Goal");
  const data = entry.data as Record<string, unknown>;
  if (data.inputKey !== undefined && (typeof data.inputKey !== "string" || !data.inputKey.trim())) throw Error("Invalid hidden Goal input key");
  if (data.systemPrompt !== undefined && (typeof data.systemPrompt !== "string" || !data.systemPrompt.trim())) throw Error("Invalid hidden Goal system authority");
  if (typeof data.goalId !== "string" || !data.goalId || !Number.isSafeInteger(data.generation) || Number(data.generation) < 1 || (data.status !== "active" && data.status !== "budget_limited")) throw Error("Invalid hidden Goal identity");
}
function assertSnapshot(entry: ContextEntry): void {
  if (entry.kind === hostPlanContextKind) assertHostPlanContext(entry);
  else if (entry.kind === hostGoalContextKind) assertHostGoalContext(entry);
  else throw Error("Unowned host prompt context");
}
function assertHiddenContext(entry: ContextEntry, kind: string, owner: string, label: string): void {
  const data = entry.data as Record<string, unknown> | undefined;
  const message = entry.model?.[0];
  if (entry.kind !== kind || data?.owner !== owner ||
    typeof data.chatJid !== "string" || !data.chatJid || !Number.isSafeInteger(data.taskId) || Number(data.taskId) <= 0 ||
    entry.model?.length !== 1 || message?.role !== "user" || message.timestamp !== 0 ||
    !Array.isArray(message.content) || !message.content.length ||
    !message.content.every(part => part.type === "text" && typeof part.text === "string"))
    throw Error(`Invalid hidden ${label} context`);
}

/** Request-local composition, never persisted. Object identity survives the SDK's
 * shallow message-array normalisation; user text cannot manufacture this tag. */
const goalSystemMessages = new WeakMap<Message, { chatJid: string; taskId: number }>();
function splitGoalSystemInstructions(messages: readonly Message[], chatJid: string, taskId: number) {
  const last = messages.at(-1);
  const scope = last && goalSystemMessages.get(last);
  return scope?.chatJid === chatJid && scope.taskId === taskId
    ? { messages: messages.slice(0, -1), instruction: last }
    : { messages, instruction: undefined };
}
export function withGoalSystemInstructions(messages: readonly Message[], prompt: string, chatJid: string, taskId: number): readonly Message[] {
  const base = splitGoalSystemInstructions(messages, chatJid, taskId).messages;
  const instruction: Message = Object.freeze({ role: "system", content: prompt, timestamp: 0 });
  goalSystemMessages.set(instruction, { chatJid, taskId });
  return [...base, instruction];
}

/** The caller supplies the host's source-fenced storage scope. No private SDK
 * checkpoint edits: public context and entry IDs prove the pinned request's
 * missing suffix. A recovered pre-dispatch commit may leave several snapshots
 * beyond that cutoff, all of which must stay before the next assistant reply. */
export async function materializePlanContext(conversation: Conversation, taskId: TaskId, chatJid: string,
  request: readonly Message[], content: UserMessage["content"], assertCurrent: () => void, context: Context): Promise<readonly Message[]> {
  return materializePromptContext(conversation, taskId, chatJid, request, content, assertCurrent, context, {kind:hostPlanContextKind, owner:"host:plan-prompt", label:"Plan"});
}
export async function materializeGoalContext(conversation: Conversation, taskId: TaskId, chatJid: string,
  request: readonly Message[], content: UserMessage["content"], identity: GoalContextIdentity, assertCurrent: () => void, context: Context): Promise<readonly Message[]> {
  return materializePromptContext(conversation, taskId, chatJid, request, content, assertCurrent, context, {kind:hostGoalContextKind, owner:"host:goal-prompt", label:"Goal", identity});
}
/** Prove the common case of equal, plain JSON without building either encoded
 * string. Fall back to the existing comparison for any unproven case, including
 * alternate JSON representations, accessors and custom serialization. */
function samePlainJson(left: unknown, right: unknown, depth = 0): boolean {
  if (left === null || typeof left === "string" || typeof left === "boolean" ||
    typeof left === "number" || left === undefined) return left === right;
  if (depth === 128 || !left || !right || typeof left !== "object" || typeof right !== "object" ||
    isProxy(left) || isProxy(right) || isBoxedPrimitive(left) || isBoxedPrimitive(right)) return false;
  const array = Array.isArray(left), rightArray = Array.isArray(right);
  const prototype = array ? Array.prototype : Object.prototype;
  if (array !== rightArray || Object.getPrototypeOf(left) !== prototype || Object.getPrototypeOf(right) !== prototype ||
    "toJSON" in left || "toJSON" in right) return false;
  const keys = Object.keys(left), other = Object.keys(right);
  if (keys.length !== other.length || (array && rightArray && (keys.length !== left.length || keys.length !== right.length))) return false;
  return keys.every((key, index) => {
    if (key !== other[index] || (array && key !== String(index))) return false;
    const a = Object.getOwnPropertyDescriptor(left, key), b = Object.getOwnPropertyDescriptor(right, key);
    return !!a && !!b && "value" in a && "value" in b && samePlainJson(a.value, b.value, depth + 1);
  });
}

async function materializePromptContext(conversation: Conversation, taskId: TaskId, chatJid: string,
  request: readonly Message[], content: UserMessage["content"], assertCurrent: () => void, context: Context,
  snapshot: {kind:string;owner:string;label:string;identity?:GoalContextIdentity}): Promise<readonly Message[]> {
  assertCurrent();
  const view = await conversation.context(context);
  assertCurrent();
  const encoded = (messages: readonly Message[]) => JSON.stringify(messages);
  const composed = splitGoalSystemInstructions(request, chatJid, taskId);
  request = composed.messages;
  const prefix = view.messages.slice(0, request.length);
  if (request.length > view.messages.length || (!samePlainJson(prefix, request) && encoded(prefix) !== encoded(request)))
    throw Error(`Unknown ${snapshot.label} request cutoff`);
  let trailing = 0;
  for (let index = view.entries.length - 1; index >= 0; index--) {
    const contribution = view.contributions[index]!;
    if (!contribution.length) continue;
    const entry = view.entries[index]!;
    if (entry.kind !== hostPlanContextKind && entry.kind !== hostGoalContextKind) break;
    assertSnapshot(entry);
    const data = entry.data as { chatJid: string; taskId: number };
    if (data.chatJid !== chatJid || data.taskId !== taskId) break;
    if (contribution.length !== 1 || encoded(contribution) !== encoded(entry.model!))
      throw Error(`Edited ${snapshot.label} request suffix`);
    trailing++;
  }
  const missing = view.messages.slice(request.length);
  if (missing.length > trailing) throw Error(`Unowned ${snapshot.label} request suffix`);
  let previousIndex = view.entries.length - 1;
  for (; previousIndex >= 0; previousIndex--) {
    const entry = view.entries[previousIndex]!;
    if (entry.kind === snapshot.kind && (entry.data as { chatJid?: string } | undefined)?.chatJid === chatJid) break;
  }
  const previous = view.entries[previousIndex];
  if (previous) assertSnapshot(previous);
  if (!Array.isArray(content) || !content.length || !content.every(part => part.type === "text" && typeof part.text === "string"))
    throw Error(`Invalid ${snapshot.label} snapshot content`);
  const priorIdentity = previous?.data as Partial<GoalContextIdentity> | undefined;
  const sameGoal = snapshot.identity !== undefined && priorIdentity?.goalId === snapshot.identity.goalId &&
    priorIdentity?.generation === snapshot.identity.generation && priorIdentity?.status === snapshot.identity.status &&
    priorIdentity?.inputKey === snapshot.identity.inputKey;
  // Like the add-on input hook, expand once per accepted operation. Usage
  // accounting between provider calls must not regenerate the same input.
  const message: UserMessage = snapshot.identity?.inputKey && sameGoal && previous
    ? previous.model![0] as UserMessage : { role: "user", content: structuredClone(content), timestamp: 0 };
  const changed = !previous || encoded(previous.model!) !== encoded([message]) ||
    encoded(view.contributions[previousIndex]!) !== encoded([message]) ||
    (snapshot.identity !== undefined && (priorIdentity?.goalId !== snapshot.identity.goalId || priorIdentity?.generation !== snapshot.identity.generation || priorIdentity?.status !== snapshot.identity.status || priorIdentity?.inputKey !== snapshot.identity.inputKey));
  // History views are ordered by logical contributing range. Their last
  // array member need not have the highest raw entry ID after compaction.
  const tail = view.entries.reduce((id, entry) => Math.max(id, entry.id), 0);
  await conversation.commit(async tx => {
    assertCurrent();
    const task = await tx.task(taskId);
    const live = await tx.doc(LiveDoc, conversation.id);
    if (!task || task.kind !== "pi.generation" || task.conversationId !== conversation.id ||
      task.abortRequested || task.state.status === "terminal" || live.run?.taskId !== taskId)
      throw Error(`Exact live ${snapshot.label} generation required`);
    if ((await tx.scanEntries({ conversationId: conversation.id }, 1)).items[0]?.id !== tail)
      throw Error(`${snapshot.label} context changed during preparation`);
    if (changed) {
      const entry = { kind: snapshot.kind, data: { owner: snapshot.owner, chatJid, taskId, ...snapshot.identity }, model: [message] };
      assertSnapshot(entry);
      await tx.appendEntry(conversation.id, entry);
    }
    assertCurrent();
  }, context);
  assertCurrent();
  const messages = [...request, ...missing, ...(changed ? [message] : [])];
  return composed.instruction ? [...messages, composed.instruction] : messages;
}
