import type { Message, Tool } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { SystemEntry, type ContextView, type PromptInput } from "@earendil-works/pi-durable";
import { declarationsEqual, getCurrentTools, toToolDeclaration } from "@earendil-works/pi-ai/utils/transcript";
import type { Context } from "@earendil-works/chord";

/** Ephemeral admitted-snapshot projection only. The SDK has no public preview
 * (request 11652 was auto-closed). Remove this gap adapter when one exists.
 * Never persist entries/edits here or import the private SDK planner.
 */
export async function projectModelContext(view: ContextView, input: Omit<PromptInput, "shown">, context: Context): Promise<readonly Message[]> {
  const shown = new Map<string, string>();
  for (const message of view.messages) if (message.role === "system") {
    for (const [key, value] of Object.entries(message.sections ?? {})) {
      if (value === null) shown.delete(key); else shown.set(key, value);
    }
  }
  const desired = new Map<string, string>();
  for (const section of input.agent.sections) {
    context.abortSignal?.throwIfAborted();
    const value = await section.render({ ...input, shown: Object.fromEntries(shown) }, context);
    context.abortSignal?.throwIfAborted();
    if (value === undefined) continue;
    if (typeof value !== "string") throw Error("Dynamic prompt overhead unavailable");
    desired.set(section.key, section.tag === false ? value : `<${section.key}>\n${value}\n</${section.key}>`);
  }
  const tools = input.agent.tools.map(toToolDeclaration);
  let timestamp = Date.now();
  for (const message of view.messages) timestamp = Math.max(timestamp, message.timestamp + 1);
  const leading = (messages: Message[], baseline?: Message): readonly Message[] => {
    const index = messages.findIndex(message => message.role === "system");
    if (index <= 0 || (messages[index] !== baseline && messages.slice(0, index).some(message => message.role !== "user"))) return messages;
    return [messages[index]!, ...messages.slice(0, index), ...messages.slice(index + 1)];
  };
  const system = (sections?: Record<string, string | null>, changes?: { toolsRemoved: { name: string }[]; toolsAdded: Tool[] }): Message => ({
    role: "system", content: "", timestamp, ...(sections === undefined ? {} : { sections }),
    ...(changes?.toolsRemoved.length ? { toolsRemoved: changes.toolsRemoved } : {}),
    ...(changes?.toolsAdded.length ? { toolsAdded: changes.toolsAdded } : {}),
  });
  if (view.head && !view.entries.some(entry => SystemEntry.is(entry) && entry.id > view.head!.id)) {
    // Replacing native rows requires UNIQUE reference provenance. Never remove a
    // custom host system contribution, nor guess from equal serialized values.
    if (view.entries.length !== view.contributions.length) throw Error("Model context provenance unavailable");
    const counts = (messages: readonly Message[]) => {
      const result = new Map<Message, number>();
      for (const message of messages) result.set(message, (result.get(message) ?? 0) + 1);
      return result;
    };
    const visibleCounts = counts(view.messages), contributionCounts = counts(view.contributions.flat());
    const removed = new Set<Message>();
    for (let i = 0; i < view.entries.length; i++) if (SystemEntry.is(view.entries[i]!)) {
      for (const message of view.contributions[i]!) {
        if (message.role !== "system" || removed.has(message) ||
            visibleCounts.get(message) !== 1 || contributionCounts.get(message) !== 1)
          throw Error("Model context provenance unavailable");
        removed.add(message);
      }
    }
    const baseline = system(Object.fromEntries(desired), { toolsRemoved: [], toolsAdded: tools });
    return leading([...view.messages.filter(message => !removed.has(message)), baseline], baseline);
  }
  const patches: Record<string, string | null>[] = [];
  const desiredKeys = [...desired.keys()];
  const order = [...[...shown.keys()].filter(key => desired.has(key)), ...desiredKeys.filter(key => !shown.has(key))];
  if (order.some((key, index) => key !== desiredKeys[index])) {
    patches.push(Object.fromEntries([...shown.keys()].map(key => [key, null])), Object.fromEntries(desired));
  } else {
    const patch: Record<string, string | null> = Object.create(null);
    for (const [key, value] of shown) if (desired.get(key) !== value) patch[key] = desired.get(key) ?? null;
    for (const [key, value] of desired) if (!shown.has(key)) patch[key] = value;
    if (Object.keys(patch).length) patches.push(patch);
  }
  const offered = getCurrentTools(view.messages);
  const kept = offered.filter(tool => tools.some(next => next.name === tool.name && declarationsEqual(tool, next)));
  const added = tools.filter(tool => !kept.some(old => old.name === tool.name));
  const reordered = [...kept, ...added].some((tool, index) => tool.name !== tools[index]?.name);
  const changes = reordered ? { toolsRemoved: offered.map(({ name }) => ({ name })), toolsAdded: tools }
    : { toolsRemoved: offered.filter(tool => !kept.includes(tool)).map(({ name }) => ({ name })), toolsAdded: added };
  if (!patches.length && !changes.toolsAdded.length && !changes.toolsRemoved.length) return view.messages;
  const additions = patches.length ? patches.map((patch, index) => system(patch, index === patches.length - 1 ? changes : undefined)) : [system(undefined, changes)];
  // The first native system contribution is an initial baseline even after
  // existing dialogue. An earlier edited/omitted system still owns that slot.
  const initial = !view.head && !view.entries.some(entry => SystemEntry.is(entry) ||
    entry.model?.some(message => message.role === "system") ||
    entry.edits?.some(edit => edit.action === "replace" && edit.messages.some(message => message.role === "system")));
  return leading([...view.messages, ...additions], initial ? additions[0] : undefined);
}

/** Candidate-only bound shared by idle operator and owned in-turn model controls. */
export function assertModelContextFits(messages: readonly Message[], target: { contextWindow: number; maxTokens: number }): void {
  if (!Number.isFinite(target.contextWindow) || target.contextWindow <= 0 || !Number.isFinite(target.maxTokens) || target.maxTokens < 0) throw Error("Model context unavailable");
  if (messages.some(message => typeof message.content !== "string" && message.content.some(block => block.type === "image"))) throw Error("Non-text context overhead unavailable");
  if (messages.some(message => message.role === "assistant" &&
    [message.usage.input, message.usage.output, message.usage.cacheRead, message.usage.cacheWrite, message.usage.totalTokens]
      .some(value => !Number.isFinite(value) || value < 0))) throw Error("Model context usage unavailable");
  // Use the SDK's token units. JSON envelopes, tool telemetry and opaque
  // reasoning signatures are not text tokens; their byte length cannot prove
  // that the candidate context is full. The provider remains the final limit.
  const estimate = estimateContextTokens(messages);
  if (messages.some(message => message.role === "assistant" && message.usage.totalTokens > 0 &&
    message.usage.totalTokens < message.usage.input + message.usage.output))
    throw Error("Model context usage unavailable");
  // Providers disagree about whether totalTokens includes cache components.
  // Accept both SDK shapes, but never use the smaller total to hide capacity.
  const measured = estimate.lastUsageIndex === null ? undefined : messages[estimate.lastUsageIndex];
  const usage = measured?.role === "assistant" ? measured.usage : undefined;
  const measuredTokens = usage ? Math.max(estimate.usageTokens, usage.input + usage.output + usage.cacheRead + usage.cacheWrite) : estimate.usageTokens;
  const suffix = estimate.lastUsageIndex === null ? messages : messages.slice(estimate.lastUsageIndex + 1);
  // The SDK text estimator omits IDs and result names. Some provider adapters
  // forward them; count this framing conservatively, never envelope telemetry.
  const framing = suffix.flatMap(message => message.role === "toolResult" ? [message.toolName, message.toolCallId]
    : message.role === "assistant" ? message.content.flatMap(block => block.type === "toolCall" ? [block.id] : []) : []);
  const framingTokens = framing.length ? estimateContextTokens([{ role: "user", content: framing.join("\n"), timestamp: 0 }]).tokens : 0;
  const inputEstimate = Math.max(estimate.tokens, measuredTokens + estimate.trailingTokens) + framingTokens;
  if (!Number.isFinite(inputEstimate) || inputEstimate < 0 || inputEstimate + 8192 + target.maxTokens > target.contextWindow) {
    const bytes = new TextEncoder().encode(JSON.stringify(messages)).length;
    throw Error(`Candidate context estimate exceeded; compact first (serialized input bytes=${bytes}, reported tokens=${estimate.usageTokens}, estimated context tokens=${estimate.tokens}, input token estimate=${inputEstimate}, reserve=8192, output budget=${target.maxTokens}, context window=${target.contextWindow})`);
  }
}

export interface ModelContextAdmission {
  messages: readonly Message[];
  assertScopeCurrent(): void;
  assertCurrent(tx: import('@earendil-works/pi-durable').Tx, current: unknown): Promise<void>;
}

/** Resolve one public SDK loadout and fence its configuration and history before
 * using a narrower schema bound. All reads precede the selection transaction. */
export async function prepareModelContextAdmission(options: {
  conversation: import('@earendil-works/pi-durable').Conversation;
  registry: import('@earendil-works/pi-durable').RegistryReader;
  defaultExtensions(): readonly { name: string }[] | undefined;
  readAgentState(): Promise<unknown>;
  project(view: ContextView, agent: import('@earendil-works/pi-durable').Agent): Promise<readonly Message[]>;
  assertCurrent(): void;
  context: Context;
}): Promise<ModelContextAdmission> {
  const { conversation, context } = options;
  const installed = [...options.registry.snapshot().installed()];
  const defaults = () => JSON.stringify(options.defaultExtensions()?.map(extension => extension.name));
  const expectedDefaults = defaults();
  const checkScope = () => {
    context.abortSignal?.throwIfAborted();
    options.assertCurrent();
    const current = options.registry.snapshot().installed();
    if (current.length !== installed.length || current.some((extension, index) => extension !== installed[index]) || defaults() !== expectedDefaults) {
      throw Error('Model context registry changed; retry the command.');
    }
  };
  checkScope();
  const expectedState = JSON.stringify((await options.readAgentState()) ?? {}); checkScope();
  // Context order after compaction differs from append order: retained older
  // entries follow the new head. Fence the actual transcript frontier instead.
  const tail = await conversation.commit(async tx =>
    (await tx.scanEntries({ conversationId: conversation.id, order: 'descending' }, 1)).items[0]?.id, context);
  checkScope();
  const resolved = await conversation.agent(context); checkScope();
  const view = await conversation.context(context); checkScope();
  const messages = await options.project(view, resolved); checkScope();
  return {
    messages, assertScopeCurrent: checkScope,
    async assertCurrent(tx, current) {
      checkScope();
      if (JSON.stringify(current) !== expectedState) throw Error('Model context configuration changed; retry the command.');
      const latest = await tx.scanEntries({ conversationId: conversation.id, order: 'descending' }, 1);
      checkScope();
      if (latest.items[0]?.id !== tail) throw Error('Model context history changed; retry the command.');
    },
  };
}
