import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { JsonValue, Context } from "@earendil-works/chord";
import type { Message } from "@earendil-works/pi-ai";
import type { SessionEntry } from "../../../node_modules/@earendil-works/pi-coding-agent";
import { CompactionEntry, SystemEntry, defineDoc, type Conversation, type EntryId, type ConversationId, type Tx } from "@earendil-works/pi-durable";
type ObjectValue = Record<string, unknown>;
function object(value: unknown): asserts value is ObjectValue {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "object required");
}
function keys(value: ObjectValue, allowed: string[]) {
  assert(Object.keys(value).every(key => allowed.includes(key)), "unsupported fields");
}
function strings(value: ObjectValue, names: string[]) {
  assert(names.every(name => typeof value[name] === "string"), "string required");
}
function finite(value: unknown) { assert(typeof value === "number" && Number.isFinite(value), "number required"); }
function blocks(content: unknown, assistant = false) {
  assert(Array.isArray(content), "content array required");
  for (const block of content) {
    object(block);
    if (block.type === "text") {
      keys(block, ["type", "text", "textSignature"]); strings(block, ["text"]);
      if (block.textSignature !== undefined) strings(block, ["textSignature"]);
    } else if (block.type === "image" && !assistant) {
      keys(block, ["type", "data", "mimeType"]); strings(block, ["data", "mimeType"]);
    } else if (block.type === "toolCall" && assistant) {
      keys(block, ["type", "id", "name", "arguments"]); strings(block, ["id", "name"]); object(block.arguments);
    } else assert.fail("unsupported content block");
  }
}
// Narrow qualification schema, deliberately NOT a blanket legacy-message cast.
function message(value: unknown): asserts value is Message {
  object(value); finite(value.timestamp);
  if (value.role === "user") {
    keys(value, ["role", "content", "timestamp"]);
    if (typeof value.content !== "string") blocks(value.content);
  } else if (value.role === "assistant") {
    keys(value, ["role", "content", "api", "provider", "model", "usage", "stopReason", "timestamp"]);
    strings(value, ["api", "provider", "model"]); blocks(value.content, true);
    assert(["stop", "length", "toolUse"].includes(String(value.stopReason)), "unfinished/cancelled assistant");
    object(value.usage); keys(value.usage, ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "cost"]);
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) finite(value.usage[key]);
    object(value.usage.cost); keys(value.usage.cost, ["input", "output", "cacheRead", "cacheWrite", "total"]);
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) finite(value.usage.cost[key]);
  } else if (value.role === "toolResult") {
    keys(value, ["role", "toolCallId", "toolName", "content", "isError", "timestamp", "details"]);
    strings(value, ["toolCallId", "toolName"]); blocks(value.content); assert(typeof value.isError === "boolean");
  } else assert.fail("unsupported message role (including system baseline)");
}


export const IMPORTER_VERSION = 1;
export const DEFAULT_IMPORT_LIMITS = { maxEntries: 1000, maxBytes: 8 * 1024 * 1024 } as const;
export type CopiedLegacyInput = Readonly<{
  sourceJSONL: string; chatJid: string; chatIncarnation: string; branchId: string;
  hostBaseline: string;
  maxEntries?: number; maxBytes?: number;
}>;
/** Trusted host bridge: use ONLY public Pi120 buildSessionContext/convertToLlm and
 * sessionEntryToContextMessages. No SDK runtime, provider, path or engine is loaded here.
 * The input is detached JSON; the host must return detached, serializable model data.
 * This callback is trusted to project faithfully: forged host messages are not security-gated. */
export type GetLegacyContext = (entries: readonly SessionEntry[], leafId: string) => {
  messages: readonly Message[];
  projected: readonly { sourceEntryId: string; messages: readonly Message[] }[];
};
type Mapping = { sourceEntryId: string; durableEntryId: number };
export type LegacyImportBinding = {
  schemaVersion: number; importerVersion: number; sourceHash: string;
  chatJid: string; chatIncarnation: string; branchId: string; sourceSessionId: string;
  sourceLeafId: string; engineConversationId: number;
  originalEntries: JsonValue[]; entries: Mapping[];
};
export const LegacyImportManifest = defineDoc<{ binding: LegacyImportBinding | null }>({
  kind: "app.copied-legacy-import", version: 1, scope: "conversation", history: "latest",
  fork: "initial", initial: () => ({ binding: null }),
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Pure fail-closed preparation. Only a complete linear, quiescent v3 history is supported.
 * Bounds reject the WHOLE input. No selected-path filtering or silent truncation. */
export function prepareLegacyImport(input: CopiedLegacyInput, getLegacyContext: GetLegacyContext) {
  return prepareCopiedLegacy(input, getLegacyContext);
}

function prepareCopiedLegacy(input: CopiedLegacyInput, getLegacyContext: GetLegacyContext) {
  // Host-owned accessors are read once, before validation or any trusted callback.
  // Readonly is a type-level promise, not runtime isolation; retain only scalar copies.
  const { sourceJSONL, chatJid, chatIncarnation, branchId, hostBaseline,
    maxEntries: requestedMaxEntries, maxBytes: requestedMaxBytes } = input;
  const identity = Object.freeze({ chatJid, chatIncarnation, branchId, hostBaseline });
  for (const key of ["chatJid", "chatIncarnation", "branchId", "hostBaseline"] as const)
    assert(typeof identity[key] === "string" && identity[key].length > 0, `missing ${key}`);
  assert(typeof sourceJSONL === "string", "missing sourceJSONL");
  const maxEntries = requestedMaxEntries ?? DEFAULT_IMPORT_LIMITS.maxEntries;
  const maxBytes = requestedMaxBytes ?? DEFAULT_IMPORT_LIMITS.maxBytes;
  assert(Number.isSafeInteger(maxEntries) && maxEntries > 0, "invalid maxEntries");
  assert(Number.isSafeInteger(maxBytes) && maxBytes > 0, "invalid maxBytes");
  assert(Buffer.byteLength(sourceJSONL, "utf8") <= maxBytes, "maxBytes exceeded");
  const lines = sourceJSONL.trim().split("\n");
  assert(lines.length > 1 && lines.length - 1 <= maxEntries, "maxEntries exceeded or empty source");
  const [header, ...raw]: unknown[] = lines.map(line => JSON.parse(line, (_key, value: unknown) => {
    assert(typeof value !== "number" || Number.isFinite(value), "non-finite JSON number");
    return value;
  }));
  object(header); keys(header, ["type", "version", "id", "timestamp", "cwd"]);
  assert(header.type === "session" && header.version === 3, "unsupported session schema");
  strings(header, ["id", "timestamp", "cwd"]);
  const ids = new Set<string>(), calls = new Set<string>();
  const pending: { id: string; name: string }[] = [];
  let parent: string | null = null;
  for (const entry of raw) {
    object(entry); strings(entry, ["type", "id", "timestamp"]);
    assert(Number.isFinite(Date.parse(entry.timestamp as string)), "invalid timestamp");
    assert(!ids.has(entry.id as string) && entry.parentId === parent, "unsupported nonlinear history/duplicate ID");
    if (entry.type === "message") {
      keys(entry, ["type", "id", "parentId", "timestamp", "message"]);
      object(entry.message);
      if (entry.message.role === "system") {
        keys(entry.message, ["role", "content", "timestamp"]); strings(entry.message, ["content"]);
        finite(entry.message.timestamp);
        assert(pending.length === 0, "inflight tools");
      } else {
        message(entry.message);
        const msg: Message = clone(entry.message) as Message;
        if (msg.role === "toolResult") {
          const call = pending.shift();
          assert(call && call.id === msg.toolCallId && call.name === msg.toolName, "orphan/out-of-order tool result");
        } else {
          assert(pending.length === 0, "inflight tools");
          if (msg.role === "assistant") {
            for (const call of msg.content) if (call.type === "toolCall") {
              assert(!calls.has(call.id), "duplicate tool call"); calls.add(call.id);
              pending.push({ id: call.id, name: call.name });
            }
            assert((msg.stopReason === "toolUse") === (pending.length > 0), "inconsistent tool stop reason");
          }
        }
      }
    } else if (entry.type === "compaction") {
      keys(entry, ["type", "id", "parentId", "timestamp", "summary", "firstKeptEntryId", "tokensBefore", "details", "fromHook", "systemMessage"]);
      strings(entry, ["summary", "firstKeptEntryId"]); finite(entry.tokensBefore);
      assert(ids.has(entry.firstKeptEntryId as string), "unmapped compaction head");
      assert(pending.length === 0, "inflight tools");
      if (entry.fromHook !== undefined) assert(typeof entry.fromHook === "boolean");
      if (entry.systemMessage !== undefined) {
        object(entry.systemMessage); keys(entry.systemMessage, ["role", "content", "timestamp"]);
        assert(entry.systemMessage.role === "system"); strings(entry.systemMessage, ["content"]); finite(entry.systemMessage.timestamp);
      }
    } else if (entry.type === "thinking_level_change") {
      keys(entry, ["type", "id", "parentId", "timestamp", "thinkingLevel"]);
      assert(["off", "minimal", "low", "medium", "high", "xhigh"].includes(entry.thinkingLevel as string), "unsupported thinking level");
      assert(pending.length === 0, "inflight tools");
    } else if (entry.type === "model_change") {
      keys(entry, ["type", "id", "parentId", "timestamp", "provider", "modelId"]);
      strings(entry, ["provider", "modelId"]);
      assert(pending.length === 0, "inflight tools");
    } else if (entry.type === "custom") {
      keys(entry, ["type", "id", "parentId", "timestamp", "customType", "data"]);
      assert(entry.customType === "qualification.display", "unsupported extension state");
    } else assert.fail(`unsupported record: ${entry.type}`);
    parent = entry.id as string; ids.add(parent);
  }
  assert(pending.length === 0, "inflight tools");
  // Cast only after the narrow data validator above; never executes source content.
  const entries = raw as SessionEntry[];
  const first = entries[0];
  assert(first?.type === "message" && first.message.role === "system" && first.message.content === hostBaseline,
    "missing/mismatched persisted host baseline (external-only baseline unsupported)");
  const projection = clone(getLegacyContext(clone(entries), parent!));
  assert(projection.projected.length === entries.length && projection.projected.every((p, i) => p.sourceEntryId === entries[i]!.id),
    "incomplete host projection");
  const sourceHash = createHash("sha256").update(JSON.stringify({
    importerVersion: IMPORTER_VERSION, chatJid, chatIncarnation, branchId, hostBaseline, sourceJSONL,
  })).digest("hex");
  return { identity, entries, projection, sourceHash, sourceSessionId: header.id as string, sourceLeafId: parent! };
}

/** Caller MUST hold exclusive host ownership, drain admission/work, and use owned/fenced
 * storage for the entire async commit (including final storage commit). assertOwnership
 * is a synchronous additional check, NOT a lease or a final async storage fence.
 * No live source reads, tasks, queue, replay, batch runner or production activation.
 * One bounded transaction; large-input blocking/performance is NOT qualified. */
export async function importCopiedLegacy(conversation: Conversation, input: CopiedLegacyInput,
  getLegacyContext: GetLegacyContext, assertOwnership: () => void, context: Context) {
  // Always privately reprepare; a caller-mutated public preparation is never accepted.
  const prepared = prepareCopiedLegacy(input, getLegacyContext);
  assertOwnership();
  return conversation.commit(async tx => {
    assertOwnership();
    const doc = await tx.doc(LegacyImportManifest, conversation.id);
    if (doc.binding) {
      assert(doc.binding.sourceHash === prepared.sourceHash, "import binding/content conflict");
      assertOwnership();
      return clone(doc.binding);
    }
    assert((await tx.scanEntries({ conversationId: conversation.id }, 1)).items.length === 0, "target must be empty");
    const mapping = new Map<string, EntryId>();
    await appendPrepared(tx, conversation.id, prepared, 0, mapping, assertOwnership);
    const binding: LegacyImportBinding = {
      schemaVersion: 3, importerVersion: IMPORTER_VERSION, sourceHash: prepared.sourceHash,
      chatJid: prepared.identity.chatJid, chatIncarnation: prepared.identity.chatIncarnation, branchId: prepared.identity.branchId,
      sourceSessionId: prepared.sourceSessionId, sourceLeafId: prepared.sourceLeafId,
      engineConversationId: conversation.id, originalEntries: JSON.parse(JSON.stringify(prepared.entries)),
      entries: [...mapping].map(([sourceEntryId, durableEntryId]) => ({ sourceEntryId, durableEntryId })),
    };
    assertOwnership(); doc.binding = binding;
    assertOwnership(); return clone(binding);
  }, context);
}

async function appendPrepared(tx: Tx, conversationId: ConversationId,
  prepared: ReturnType<typeof prepareCopiedLegacy>, start: number, mapping: Map<string, EntryId>,
  assertOwnership: () => void) {
    for (const [index, entry] of prepared.entries.entries()) {
      if (index < start) continue;
      assertOwnership();
      const audit = await tx.appendEntry(conversationId, { kind: "app.legacy-source", data: JSON.parse(JSON.stringify(entry)) });
      let at = audit.id;
      const model = [...prepared.projection.projected[index]!.messages];
      if (entry.type === "message") {
        assertOwnership();
        at = entry.message.role === "system"
          ? (await tx.appendEntry(SystemEntry, conversationId, { model })).id
          : (await tx.appendEntry(conversationId, { kind: "app.legacy-message", model })).id;
      } else if (entry.type === "compaction") {
        const head = mapping.get(entry.firstKeptEntryId); assert(head, "unmapped compaction head");
        assertOwnership();
        at = (await tx.appendEntry(CompactionEntry, conversationId, {
          head, data: { reason: "manual" }, model: model.filter(m => m.role !== "system"),
        })).id;
        const baseline = model.filter(m => m.role === "system");
        if (baseline.length) {
          assertOwnership();
          at = (await tx.appendEntry(SystemEntry, conversationId, { model: baseline })).id;
        }
      }
      mapping.set(entry.id, at);
    }
}

export const DEFAULT_TREE_IMPORT_LIMITS = { ...DEFAULT_IMPORT_LIMITS, maxBranches: 16 } as const;
export type LegacyTreeHostBinding = Readonly<{
  chatJid: string; chatIncarnation: string; branchId: string; hostBaseline: string;
}>;
export type CopiedLegacyTreeInput = Readonly<{
  sourceJSONL: string;
  /** Complete leaf-ID → original host identity map; no active-branch inference. */
  hostBranchBindings: Readonly<Record<string, LegacyTreeHostBinding>>;
  maxEntries?: number; maxBytes?: number; maxBranches?: number;
}>;
export type LegacyTreeImportBinding = {
  importerVersion: number; sourceHash: string; sourceSessionId: string;
  originalEntries: JsonValue[];
  plannedBranches: { sourceLeafId: string; chatJid: string; chatIncarnation: string; branchId: string; hostBaseline: string }[];
  branches: LegacyImportBinding[]; entries: Mapping[];
};
export const LegacyTreeImportManifest = defineDoc<{ binding: LegacyTreeImportBinding | null }>({
  kind: "app.copied-legacy-tree-import", version: 1, scope: "conversation", history: "latest",
  fork: "initial", initial: () => ({ binding: null }),
});

/** Every source record must belong to the single rooted tree, and EVERY leaf must
 * have an explicit host binding. Detached once before invoking any host bridge.
 * Separate host JSONL files must be assembled/validated by the caller, not inferred. */
export function prepareLegacyTreeImport(input: CopiedLegacyTreeInput, bridge: GetLegacyContext) {
  const { sourceJSONL, hostBranchBindings, maxEntries: requestedEntries,
    maxBytes: requestedBytes, maxBranches: requestedBranches } = input;
  const bindings = clone(hostBranchBindings);
  object(bindings);
  const maxEntries = requestedEntries ?? DEFAULT_TREE_IMPORT_LIMITS.maxEntries;
  const maxBytes = requestedBytes ?? DEFAULT_TREE_IMPORT_LIMITS.maxBytes;
  const maxBranches = requestedBranches ?? DEFAULT_TREE_IMPORT_LIMITS.maxBranches;
  for (const limit of [maxEntries, maxBytes, maxBranches])
    assert(Number.isSafeInteger(limit) && limit > 0, "invalid tree limit");
  assert(typeof sourceJSONL === "string", "missing sourceJSONL");
  assert(Buffer.byteLength(sourceJSONL, "utf8") <= maxBytes, "maxBytes exceeded");
  const lines = sourceJSONL.trim().split("\n");
  assert(lines.length > 1 && lines.length - 1 <= maxEntries, "maxEntries exceeded or empty source");
  const [header, ...raw]: unknown[] = lines.map(line => JSON.parse(line, (_key, value: unknown) => {
    assert(typeof value !== "number" || Number.isFinite(value), "non-finite JSON number");
    return value;
  }));
  const records = new Map<string, ObjectValue>();
  for (const entry of raw) {
    object(entry); strings(entry, ["id"]);
    assert(entry.id !== "" && !records.has(entry.id as string), "duplicate/empty source ID");
    assert(entry.parentId === null || typeof entry.parentId === "string", "invalid parent ID");
    records.set(entry.id as string, entry);
  }
  const parents = new Set<string>();
  let roots = 0;
  for (const entry of records.values()) {
    if (entry.parentId === null) roots++;
    else { assert(records.has(entry.parentId as string), "missing parent"); parents.add(entry.parentId as string); }
  }
  assert(roots === 1, "single root required");
  const leaves = [...records.keys()].filter(id => !parents.has(id)).sort();
  assert(leaves.length > 0 && leaves.length <= maxBranches, "maxBranches exceeded or cyclic source");
  assert(Object.keys(bindings).length === leaves.length && leaves.every(id => Object.hasOwn(bindings, id)),
    "complete bindings for ALL leaves required");
  const visited = new Set<string>(), identities = new Set<string>();
  const paths = leaves.map(leaf => {
    const path: ObjectValue[] = [], seen = new Set<string>();
    let id: string | null = leaf;
    while (id !== null) {
      assert(!seen.has(id), "cyclic source"); seen.add(id); visited.add(id);
      const entry = records.get(id)!; path.push(entry); id = entry.parentId as string | null;
    }
    path.reverse();
    const binding = bindings[leaf]!;
    object(binding); keys(binding, ["chatJid", "chatIncarnation", "branchId", "hostBaseline"]);
    strings(binding, ["chatJid", "chatIncarnation", "branchId", "hostBaseline"]);
    assert(Object.values(binding).every(value => typeof value === "string" && value.length > 0), "empty host binding");
    const identity = JSON.stringify([binding.chatJid, binding.chatIncarnation, binding.branchId]);
    assert(!identities.has(identity), "duplicate host branch identity"); identities.add(identity);
    return { path, binding };
  });
  assert(visited.size === records.size, "cyclic/disconnected source");
  const plannedBranches = paths.map(({ binding }, index) => ({ sourceLeafId: leaves[index]!,
    chatJid: binding.chatJid, chatIncarnation: binding.chatIncarnation,
    branchId: binding.branchId, hostBaseline: binding.hostBaseline }));
  const hashedInput = JSON.stringify({ importerVersion: IMPORTER_VERSION, sourceJSONL,
    plannedBranches, maxEntries, maxBytes, maxBranches });
  assert(Buffer.byteLength(hashedInput, "utf8") <= maxBytes, "maxBytes exceeded (source and host bindings)");
  // Validate all paths using the SAME strict linear parser; no commits until all succeed.
  const prepared = paths.map(({ path, binding }) => prepareCopiedLegacy({ ...binding,
    sourceJSONL: [header, ...path].map(record => JSON.stringify(record)).join("\n"),
    maxEntries, maxBytes,
  }, bridge));
  const sourceHash = createHash("sha256").update(hashedInput).digest("hex");
  return { prepared, sourceHash, raw, plannedBranches };
}

/** Quiescent owned/fenced storage contract is identical to importCopiedLegacy.
 * Public forks require committed anchors. Each branch is one atomic commit including
 * fork, suffix, branch binding and root progress. Retry identical input after interruption;
 * no fork can commit without its receipt. Keep partially imported storage offline
 * until all branches are returned. No tasks, effects, selection policy or private APIs. */
export async function importCopiedLegacyTree(conversation: Conversation, input: CopiedLegacyTreeInput,
  bridge: GetLegacyContext, assertOwnership: () => void, context: Context) {
  const plan = prepareLegacyTreeImport(input, bridge);
  assertOwnership();
  for (;;) {
    const result = await conversation.commit(async tx => {
      assertOwnership();
      const doc = await tx.doc(LegacyTreeImportManifest, conversation.id);
      if (doc.binding) {
        assert(doc.binding.sourceHash === plan.sourceHash, "tree import binding/content conflict");
        if (doc.binding.branches.length === plan.prepared.length) {
          assertOwnership(); return clone(doc.binding);
        }
      } else {
        assert((await tx.scanEntries({ conversationId: conversation.id }, 1)).items.length === 0, "target must be empty");
      }
      const branches = clone(doc.binding?.branches ?? []);
      const locations = new Map<string, { at: EntryId; conversationId: ConversationId }>();
      for (const branch of branches) for (const entry of branch.entries)
        if (!locations.has(entry.sourceEntryId)) locations.set(entry.sourceEntryId,
          { at: entry.durableEntryId as EntryId, conversationId: branch.engineConversationId as ConversationId });
      const prepared = plan.prepared[branches.length]!;
      const mapping = new Map<string, EntryId>();
      let start = 0, conversationId = conversation.id;
      while (start < prepared.entries.length && locations.has(prepared.entries[start]!.id)) {
        const entry = prepared.entries[start++]!;
        mapping.set(entry.id, locations.get(entry.id)!.at);
      }
      if (start > 0) {
        const parent = locations.get(prepared.entries[start - 1]!.id)!;
        assertOwnership();
        conversationId = (await tx.forkConversation(parent.conversationId, parent.at,
          { ownership: { kind: "ownerless" } })).id;
      }
      await appendPrepared(tx, conversationId, prepared, start, mapping, assertOwnership);
      for (const entry of prepared.entries.slice(start))
        locations.set(entry.id, { at: mapping.get(entry.id)!, conversationId });
      const binding: LegacyImportBinding = {
        schemaVersion: 3, importerVersion: IMPORTER_VERSION, sourceHash: plan.sourceHash,
        ...prepared.identity, sourceSessionId: prepared.sourceSessionId, sourceLeafId: prepared.sourceLeafId,
        engineConversationId: conversationId, originalEntries: clone(prepared.entries) as unknown as JsonValue[],
        entries: [...mapping].map(([sourceEntryId, durableEntryId]) => ({ sourceEntryId, durableEntryId })),
      };
      (await tx.doc(LegacyImportManifest, conversationId)).binding = binding;
      branches.push(binding);
    const treeBinding: LegacyTreeImportBinding = {
      importerVersion: IMPORTER_VERSION, sourceHash: plan.sourceHash,
      sourceSessionId: plan.prepared[0]!.sourceSessionId, originalEntries: clone(plan.raw) as JsonValue[],
      plannedBranches: clone(plan.plannedBranches), branches, entries: [...locations].map(([sourceEntryId, location]) => ({ sourceEntryId, durableEntryId: location.at })),
    };
    assertOwnership(); doc.binding = treeBinding;
    assertOwnership(); return clone(treeBinding);
    }, context);
    if (result.branches.length === plan.prepared.length) return result;
  }
}
