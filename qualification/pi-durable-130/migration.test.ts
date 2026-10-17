import "./src/test-guard.js";
import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SessionManager as LegacyManager } from "@earendil-works/pi-coding-agent";
import type { Message } from "../../runtime/durable-engine/qualification/ai.ts";
import { CompactionEntry, SystemEntry, defineDoc, type Conversation, type EntryId, type EntryDraft, type ConversationId } from "../../runtime/durable-engine/qualification/durable.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/index.js";
import { barrier, context, openFixture } from "./src/fixture.js";
import { importCopiedLegacyTree, LegacyTreeImportManifest, type CopiedLegacyTreeInput, importCopiedLegacy, prepareLegacyImport, LegacyImportManifest, type CopiedLegacyInput, type GetLegacyContext } from "../../runtime/durable-engine/src/index.js";

// Resolve ONLY the public current SDK export from root dependencies, never its internals.
// The current package has an import-only export; createRequire.resolve cannot resolve it.
const legacy = await import("@earendil-works/pi-coding-agent");
const { SessionManager, convertToLlm, buildSessionContext, sessionEntryToContextMessages } = legacy;
type Fixture = Awaited<ReturnType<typeof openFixture>>;
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

type LegacyHistory = { chatJid: string; branchId: string; metadataRef: string; requestId: string; jsonl: string };
type Mapping = { sourceEntryId: string; durableEntryId: number };
type Manifest = { binding: null | { schemaVersion: number; sourceHash: string; chatJid: string; branchId: string;
  metadataRef: string; requestId: string; sourceSessionId: string; engineConversationId: number; entries: Mapping[] } };
const ImportManifest = defineDoc<Manifest>({ kind: "app.legacy-import", version: 1, scope: "conversation",
  history: "latest", fork: "initial", initial: () => ({ binding: null }) });

// Bounded H5 test helper only. NO production migration runner or live sessions directory.
function prepare(input: LegacyHistory) {
  for (const key of ["chatJid", "branchId", "metadataRef", "requestId"] as const) assert(input[key].length > 0);
  // Strict parsing: current SDK parseSessionEntries intentionally skips malformed lines, unacceptable here.
  const [header, ...entries]: unknown[] = input.jsonl.trim().split("\n").map(line => JSON.parse(line));
  object(header); keys(header, ["type", "version", "id", "timestamp", "cwd"]);
  assert(header.type === "session" && header.version === 3); strings(header, ["id", "timestamp", "cwd"]);
  assert(entries.length > 0 && entries.length <= 10, "bounded fixture only (1..10 records)");
  let parent: string | null = null;
  const ids = new Set<string>(), calls = new Set<string>();
  const pending: { id: string; name: string }[] = [];
  const drafts: EntryDraft[] = [];
  for (const entry of entries) {
    object(entry); strings(entry, ["type", "id", "timestamp"]);
    assert(Number.isFinite(Date.parse(entry.timestamp as string)), "invalid timestamp");
    assert(!ids.has(entry.id as string) && entry.parentId === parent, "non-contiguous branch/duplicate ID");
    parent = entry.id as string; ids.add(parent);
    let model: Message[] | undefined;
    if (entry.type === "message") {
      keys(entry, ["type", "id", "parentId", "timestamp", "message"]); message(entry.message);
      const msg = entry.message;
      if (msg.role === "toolResult") {
        const call = pending.shift();
        assert(call && call.id === msg.toolCallId && call.name === msg.toolName, "orphan/out-of-order tool result");
      } else {
        assert(pending.length === 0, "inflight tools");
        if (msg.role === "assistant") {
          for (const call of msg.content) if (call.type === "toolCall") {
            assert(!calls.has(call.id), "duplicate tool call"); calls.add(call.id); pending.push({ id: call.id, name: call.name });
          }
          assert((msg.stopReason === "toolUse") === (pending.length > 0), "inconsistent tool stop reason");
        }
      }
      model = [msg];
    } else if (entry.type === "custom") {
      keys(entry, ["type", "id", "parentId", "timestamp", "customType", "data"]);
      strings(entry, ["customType"]);
      assert(entry.customType === "qualification.display", "unsupported extension state");
    } else assert.fail(`unsupported record: ${entry.type}`);
    // Raw JSON retained exactly; host source IDs are metadata, never durable record IDs.
    drafts.push({ kind: "app.legacy", data: JSON.parse(JSON.stringify(entry)), ...(model ? { model } : {}) });
  }
  assert(pending.length === 0, "inflight tools");
  return { drafts, sourceSessionId: header.id as string,
    sourceHash: createHash("sha256").update(JSON.stringify({ chatJid: input.chatJid, branchId: input.branchId,
      metadataRef: input.metadataRef, requestId: input.requestId, jsonl: input.jsonl })).digest("hex") };
}
async function importCopied(f: Fixture, input: LegacyHistory, interruptedAfter?: number, conversationId: ConversationId = f.root.id) {
  const prepared = prepare(input); // Reject whole affected scope BEFORE any write.
  return f.root.commit(async tx => {
    const doc = await tx.doc(ImportManifest, conversationId);
    if (doc.binding) {
      assert(doc.binding.sourceHash === prepared.sourceHash, "import binding/content conflict");
      return JSON.parse(JSON.stringify(doc.binding)) as NonNullable<Manifest["binding"]>;
    }
    assert((await tx.scanEntries({ conversationId }, 1)).items.length === 0, "target must be empty");
    const entries: Mapping[] = [];
    for (const draft of prepared.drafts) {
      const appended = await tx.appendEntry(conversationId, draft);
      const raw = draft.data as { id: string };
      entries.push({ sourceEntryId: raw.id, durableEntryId: appended.id });
      if (entries.length === interruptedAfter) throw new Error("synthetic interrupted commit");
    }
    const binding = { schemaVersion: 1, sourceHash: prepared.sourceHash, chatJid: input.chatJid, branchId: input.branchId,
      metadataRef: input.metadataRef, requestId: input.requestId, sourceSessionId: prepared.sourceSessionId,
      engineConversationId: conversationId, entries };
    doc.binding = binding;
    return binding;
  }, context);
}
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function assistant(tool = false): Parameters<LegacyManager["appendMessage"]>[0] {
  return { role: "assistant", api: "openai-completions", provider: "qualification", model: "synthetic", usage,
    stopReason: tool ? "toolUse" : "stop", timestamp: 1001,
    content: tool ? [{ type: "toolCall", id: "copied-call", name: "host_effect", arguments: { value: "synthetic" } }]
      : [{ type: "text", text: "Completed historical answer", textSignature: "opaque-synthetic-signature" }] };
}
function copied(manager: LegacyManager): LegacyHistory {
  // Same serializer as the current SDK JSONL writer: one JSON record per line.
  return { chatJid: "web:existing-synthetic-chat", branchId: "existing-main", metadataRef: "synthetic:host-metadata/1",
    requestId: "legacy-import:existing-main:v1", jsonl: [manager.getHeader(), ...manager.getEntries()].map(x => JSON.stringify(x)).join("\n") + "\n" };
}
function representative() {
  const manager = SessionManager.inMemory(process.env.PICLAW_WORKSPACE!, { id: "qualification-existing-session" });
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "Existing attachment" },
    { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }], timestamp: 1000 });
  manager.appendMessage(assistant(true));
  manager.appendMessage({ role: "toolResult", toolCallId: "copied-call", toolName: "host_effect",
    content: [{ type: "text", text: "historically completed" }], details: { reference: "synthetic:completed/1" }, isError: false, timestamp: 1002 });
  manager.appendCustomEntry("qualification.display", { text: "Existing display-only metadata", attachmentRef: "synthetic:attachment/1" });
  manager.appendMessage(assistant());
  return manager;
}
async function using(run: (f: Fixture) => Promise<void>) {
  const f = await openFixture({ acquired: true });
  try { await run(f); } finally { await f.close(); }
}
async function empty(f: Fixture) {
  expect((await f.root.entries({}, 100, undefined, context)).items).toEqual([]);
  expect(await f.harness.snapshot(ImportManifest, f.root.id, context)).toBeUndefined();
  expect(f.host.modelCalls).toBe(0); expect(f.host.effects).toBe(0);
}

describe("H5 bounded copied existing-history qualification (not production migration)", () => {
  test("current public SDK is 1.2.0; 5 copied records retain IDs, attachments, exact context and execute nothing", () => using(async f => {
    const pkg = await Bun.file(new URL("../../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url)).json();
    expect(pkg.version).toBe("1.2.0");
    expect(import.meta.resolve("@earendil-works/pi-coding-agent")).toBe(new URL(
      "../../node_modules/@earendil-works/pi-coding-agent/dist/index.js", import.meta.url).href);
    const manager = representative(), input = copied(manager), original = input.jsonl;
    const restored = SessionManager.inMemory(process.env.PICLAW_WORKSPACE!, undefined, input.jsonl.trim().split("\n").map(line => JSON.parse(line)));
    expect(restored.buildSessionContext()).toEqual(manager.buildSessionContext());
    const manifest = await importCopied(f, input);
    const view = await f.root.context(context);
    expect(view.messages).toEqual(JSON.parse(JSON.stringify(convertToLlm(manager.buildSessionContext().messages))));
    expect(view.entries.map(e => e.data)).toEqual(JSON.parse(JSON.stringify(manager.getEntries())));
    expect(manifest.entries.map(e => e.sourceEntryId)).toEqual(manager.getEntries().map(e => e.id));
    expect(manifest.entries.every(e => typeof e.durableEntryId === "number")).toBe(true);
    expect(manifest.chatJid).toBe(input.chatJid); expect(manifest.engineConversationId).toBe(f.root.id);
    expect(await Promise.all([importCopied(f, input), importCopied(f, input)])).toEqual([manifest, manifest]);
    for (const key of ["chatJid", "branchId", "metadataRef", "requestId"] as const) {
      await expect(importCopied(f, { ...input, [key]: "changed-binding" })).rejects.toThrow("content conflict");
    }
    expect((await f.root.entries({}, 100, undefined, context)).items).toHaveLength(5);
    await expect(importCopied(f, { ...input, jsonl: input.jsonl.replace("Existing attachment", "changed") })).rejects.toThrow("content conflict");
    expect(input.jsonl).toBe(original);
    expect(await f.harness.inspect(context)).toEqual({ scheduling: "paused", tasks: [], submissions: [] });
    expect(f.host.effects).toBe(0); expect(f.host.modelCalls).toBe(0); expect(f.host.credentialLookups).toBe(0);
  }));
  test("callback interruption rolls back transcript AND manifest; retry has no duplicates", () => using(async f => {
    const input = copied(representative());
    await expect(importCopied(f, input, 3)).rejects.toThrow("interrupted commit");
    await empty(f);
    const manifest = await importCopied(f, input);
    expect(await importCopied(f, input)).toEqual(manifest);
    expect((await f.root.context(context)).entries).toHaveLength(5);
  }));
  test("SQLite close/reopen keeps identity mapping and lost acknowledgement replay idempotent", async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "legacy-copy-"));
    const path = join(dir, "candidate.sqlite");
    const open = () => openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path)));
    let f = await open();
    try {
      const input = copied(representative());
      await expect(importCopied(f, input, 3)).rejects.toThrow("interrupted commit");
      await f.close(); f = await open();
      await empty(f);
      const receipt = await importCopied(f, input);
      await f.close(); f = await open();
      expect(await importCopied(f, input)).toEqual(receipt);
      expect((await f.root.context(context)).entries).toHaveLength(5);
      expect(f.host.effects).toBe(0); expect(f.host.modelCalls).toBe(0);
    } finally { await f.close(); await rm(dir, { recursive: true, force: true }); }
  });
  for (const state of ["pending", "aborted", "error", "deferred"] as const) {
    test(`reject ${state} assistant before writing, never replay`, () => using(async f => {
      const input = copied(representative());
      input.jsonl = input.jsonl.replace('"stopReason":"stop"', `"stopReason":"${state}"`);
      await expect(importCopied(f, input)).rejects.toThrow("unfinished/cancelled"); await empty(f);
    }));
  }
  for (const variant of ["inflight", "orphan", "unknown-block", "malformed", "unknown-record", "bound", "duplicate"] as const) {
    test(`reject ${variant} whole scope without truncation`, () => using(async f => {
      const input = copied(representative());
      const records = input.jsonl.trim().split("\n").map(line => JSON.parse(line));
      if (variant === "inflight") records.splice(3);
      if (variant === "orphan") records[3].message.toolCallId = "no-such-call";
      if (variant === "unknown-block") records[1].message.content.push({ type: "inference", data: "unsupported" });
      if (variant === "unknown-record") records[4].type = "future-record";
      if (variant === "bound") while (records.length <= 11) records.push(records.at(-1));
      if (variant === "duplicate") records[4].id = records[1].id;
      input.jsonl = records.map(x => JSON.stringify(x)).join("\n") + (variant === "malformed" ? "\n{broken" : "");
      await expect(importCopied(f, input)).rejects.toThrow(); await empty(f);
    }));
  }
  for (const gap of ["system", "compaction", "deep-branch", "context-edit", "custom-message", "extension-state"] as const) {
    test(`NOT QUALIFIED: ${gap} explicitly rejected; unrelated conversation remains usable`, () => using(async f => {
      const manager = representative();
      if (gap === "system") manager.appendMessage({ role: "system", content: "baseline", timestamp: 1003 });
      if (gap === "compaction") manager.appendCompaction("Existing custom summary, NOT regenerated", manager.getEntries()[3]!.id, 500, { custom: true }, true);
      if (gap === "deep-branch") { manager.branch(manager.getEntries()[1]!.id); manager.appendMessage(assistant()); }
      if (gap === "context-edit") manager.appendContextEdit(manager.getEntries()[0]!.id, null);
      if (gap === "custom-message") manager.appendCustomMessageEntry("injected", "existing context", true);
      if (gap === "extension-state") manager.appendCustomEntry("unknown-extension", { enabled: true });
      await expect(importCopied(f, copied(manager))).rejects.toThrow(); await empty(f);
      const other = await f.harness.createConversation({ ownership: { kind: "ownerless" } }, context);
      await importCopied(f, { ...copied(representative()), chatJid: "web:other-existing-chat" }, undefined, other.id);
      expect((await other.context(context)).entries).toHaveLength(5);
      expect((await f.root.context(context)).entries).toHaveLength(0);
    }));
  }
});

const publicContextBridge: GetLegacyContext = (entries, leafId) => ({
  messages: json(convertToLlm(buildSessionContext([...entries], leafId).messages)),
  projected: entries.map(entry => ({ sourceEntryId: entry.id,
    messages: entry.type === "custom" ? [] : json(convertToLlm(sessionEntryToContextMessages(entry))) })),
});
function moduleInput(manager: LegacyManager): CopiedLegacyInput {
  return { sourceJSONL: copied(manager).jsonl, chatJid: "web:module-chat", chatIncarnation: "stable-original-uuid",
    branchId: "original-main", hostBaseline: "Known original synthetic baseline" };
}
describe("reusable copied-history module (not live migration wiring)", () => {
  for (const location of ["tool arguments", "tool details", "custom metadata", "compaction details"] as const) {
    test(`literal 1e400 in ${location} rejects before bridge or any writes`, () => using(async f => {
      const manager = advancedFixture(true);
      manager.appendMessage(assistant(true));
      manager.appendMessage({ role: "toolResult", toolCallId: "copied-call", toolName: "host_effect",
        content: [{ type: "text", text: "completed" }], details: {}, isError: false, timestamp: 3000 });
      manager.appendCustomEntry("qualification.display", {});
      const input = moduleInput(manager);
      const records = input.sourceJSONL.trim().split("\n").map(line => JSON.parse(line));
      const nested = { nested: [0, { overflow: "OVERFLOW" }] };
      if (location === "tool arguments") records.find(r => r.message?.stopReason === "toolUse").message.content[0].arguments = nested;
      if (location === "tool details") records.find(r => r.message?.role === "toolResult").message.details = nested;
      if (location === "custom metadata") records.find(r => r.type === "custom").data = nested;
      if (location === "compaction details") records.find(r => r.type === "compaction").details = nested;
      const invalid = { ...input, sourceJSONL: records.map(r => JSON.stringify(r)).join("\n").replace('"OVERFLOW"', "1e400") };
      let calls = 0;
      const bridge: GetLegacyContext = (...args) => { calls++; return publicContextBridge(...args); };
      expect(() => prepareLegacyImport(invalid, bridge)).toThrow("non-finite JSON number");
      await expect(importCopiedLegacy(f.root, invalid, bridge, () => {}, context)).rejects.toThrow("non-finite JSON number");
      expect(calls).toBe(0);
      expect((await f.root.entries({}, 100, undefined, context)).items).toEqual([]);
      expect(await f.harness.snapshot(LegacyImportManifest, f.root.id, context)).toBeUndefined();
      expect(f.host.effects + f.host.modelCalls + f.host.credentialLookups).toBe(0);
    }));
  }
  test("trusted bridge mutation cannot change the source hash or receipt identity", () => using(async f => {
    const original = moduleInput(advancedFixture(true));
    const expected = prepareLegacyImport(original, publicContextBridge);
    const input = { ...original };
    const receipt = await importCopiedLegacy(f.root, input, (...args) => {
      Object.assign(input, { sourceJSONL: "changed after validation", chatJid: "changed-chat",
        chatIncarnation: "changed-incarnation", branchId: "changed-branch", hostBaseline: "changed-baseline",
        maxEntries: 1, maxBytes: 1 });
      return publicContextBridge(...args);
    }, () => {}, context);
    expect(receipt.sourceHash).toBe(expected.sourceHash);
    expect(receipt.chatJid).toBe(original.chatJid);
    expect(receipt.chatIncarnation).toBe(original.chatIncarnation);
    expect(receipt.branchId).toBe(original.branchId);
    expect(receipt.originalEntries).toEqual(JSON.parse(JSON.stringify(expected.entries)));
    expect(await importCopiedLegacy(f.root, original, publicContextBridge, () => {}, context)).toEqual(receipt);
  }));
  test("host scalar accessors including limits are read exactly once", () => using(async f => {
    const original = { ...moduleInput(advancedFixture()), maxEntries: 1000, maxBytes: 8 * 1024 * 1024 };
    const reads = new Map<string, number>();
    const input = Object.defineProperties({}, Object.fromEntries(Object.entries(original).map(([key, value]) => [key, {
      get() { const count = (reads.get(key) ?? 0) + 1; reads.set(key, count); return count === 1 ? value : null; },
    }]))) as CopiedLegacyInput;
    const receipt = await importCopiedLegacy(f.root, input, publicContextBridge, () => {}, context);
    expect(receipt.sourceHash).toBe(prepareLegacyImport(original, publicContextBridge).sourceHash);
    expect(Object.fromEntries(reads)).toEqual(Object.fromEntries(Object.keys(original).map(key => [key, 1])));
    expect(receipt.chatJid).toBe(original.chatJid);
    expect(receipt.chatIncarnation).toBe(original.chatIncarnation);
    expect(receipt.branchId).toBe(original.branchId);
  }));
  test("held public commit uses private preparation despite later host and public-output mutation", () => using(async f => {
    const original = moduleInput(advancedFixture(true)), input = { ...original };
    const exposed = prepareLegacyImport(input, publicContextBridge);
    const expectedHash = exposed.sourceHash;
    const entered = barrier(), hold = barrier();
    // Decorate only the public Conversation.commit contract; no candidate store internals.
    const conversation: Conversation = Object.create(f.root);
    conversation.commit = async (callback, ctx) => {
      entered.release();
      await hold.promise;
      return f.root.commit(callback, ctx);
    };
    const pending = importCopiedLegacy(conversation, input, publicContextBridge, () => {}, context);
    await entered.promise;
    try {
      Object.assign(input, { sourceJSONL: "changed while commit held", chatJid: "changed-chat",
        chatIncarnation: "changed-incarnation", branchId: "changed-branch", hostBaseline: "changed-baseline" });
      exposed.sourceHash = "forged-public-hash";
      exposed.entries.length = 0;
      exposed.projection = { messages: [], projected: [] };
    } finally { hold.release(); }
    const receipt = await pending;
    expect(receipt.sourceHash).toBe(expectedHash);
    expect(receipt.chatJid).toBe(original.chatJid);
    expect(receipt.chatIncarnation).toBe(original.chatIncarnation);
    expect(receipt.branchId).toBe(original.branchId);
    expect(receipt.entries).toHaveLength(5);
    expect((await f.harness.snapshot(LegacyImportManifest, f.root.id, context))!.binding).toEqual(receipt);
    expect(await importCopiedLegacy(f.root, original, publicContextBridge, () => {}, context)).toEqual(receipt);
  }));
  test("100 records from public Pi120 preserve exact context, original UUID mapping and idempotency", () => using(async f => {
    const manager = advancedFixture();
    while (manager.getEntries().length < 100) manager.appendMessage({ role: "user", content: `history-${manager.getEntries().length}`, timestamp: 3000 });
    const input = moduleInput(manager);
    const receipt = await importCopiedLegacy(f.root, input, publicContextBridge, () => {}, context);
    await equivalent(f, manager);
    expect(receipt.entries).toHaveLength(100);
    expect(receipt.originalEntries).toEqual(JSON.parse(JSON.stringify(manager.getEntries())));
    expect(receipt.chatIncarnation).toBe("stable-original-uuid");
    expect(receipt.sourceSessionId).toBe(manager.getSessionId());
    expect(receipt.entries.map(e => e.sourceEntryId)).toEqual(manager.getEntries().map(e => e.id));
    expect(await importCopiedLegacy(f.root, input, publicContextBridge, () => {}, context)).toEqual(receipt);
    await expect(importCopiedLegacy(f.root, { ...input, sourceJSONL: input.sourceJSONL + "\n" }, publicContextBridge, () => {}, context)).rejects.toThrow("content conflict");
    expect((await f.root.context(context)).entries).toHaveLength(200);
  }));
  test("compaction checkpoint, audit data and original fork points survive extraction", () => using(async f => {
    const manager = advancedFixture(true);
    const receipt = await importCopiedLegacy(f.root, moduleInput(manager), publicContextBridge, () => {}, context);
    await equivalent(f, manager);
    for (const index of [1, 3]) {
      const entry = manager.getEntries()[index]!;
      const at = receipt.entries.find(e => e.sourceEntryId === entry.id)!.durableEntryId;
      const fork = await f.root.fork(at as EntryId, { ownership: { kind: "ownerless" } }, context);
      expect((await fork.context(context)).messages).toEqual(json(convertToLlm(buildSessionContext(manager.getEntries(), entry.id).messages)));
    }
    expect((await f.harness.snapshot(LegacyImportManifest, f.root.id, context))!.binding).toEqual(receipt);
  }));
  test("interruption after actual appends rolls back all entries and manifest; retry is idempotent", () => using(async f => {
    const input = moduleInput(advancedFixture(true)); let checks = 0;
    await expect(importCopiedLegacy(f.root, input, publicContextBridge, () => {
      if (++checks === 7) throw new Error("interrupted owner");
    }, context)).rejects.toThrow("interrupted owner");
    expect((await f.root.entries({}, 100, undefined, context)).items).toEqual([]);
    expect(await f.harness.snapshot(LegacyImportManifest, f.root.id, context)).toBeUndefined();
    const receipt = await importCopiedLegacy(f.root, input, publicContextBridge, () => {}, context);
    expect(await importCopiedLegacy(f.root, input, publicContextBridge, () => {}, context)).toEqual(receipt);
    expect((await f.harness.inspect(context)).tasks).toEqual([]);
    expect(f.host.effects + f.host.modelCalls + f.host.credentialLookups).toBe(0);
  }));
  test("completed historical tool result, image and display metadata import as data only", () => using(async f => {
    const manager = SessionManager.inMemory(process.env.PICLAW_WORKSPACE!, { id: "original-tools-uuid" });
    manager.appendMessage({ role: "system", content: "Known original synthetic baseline", timestamp: 999 });
    for (const entry of representative().getEntries()) {
      if (entry.type === "message") { message(entry.message); manager.appendMessage(entry.message); }
      else if (entry.type === "custom") manager.appendCustomEntry(entry.customType, entry.data);
    }
    const receipt = await importCopiedLegacy(f.root, moduleInput(manager), publicContextBridge, () => {}, context);
    await equivalent(f, manager);
    expect(receipt.originalEntries).toEqual(JSON.parse(JSON.stringify(manager.getEntries())));
    expect(JSON.stringify((await f.root.context(context)).messages)).toContain("historically completed");
  }));
  test("module SQLite rollback, reopen and lost-ack retry retain manifest and exact context", async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "module-sqlite-"));
    const open = () => openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(join(dir, "copy.sqlite"))));
    let f = await open();
    try {
      const manager = advancedFixture(true), input = moduleInput(manager); let checks = 0;
      await expect(importCopiedLegacy(f.root, input, publicContextBridge, () => {
        if (++checks === 7) throw new Error("interrupted SQLite import");
      }, context)).rejects.toThrow("interrupted SQLite");
      await f.close(); f = await open();
      expect((await f.root.entries({}, 100, undefined, context)).items).toEqual([]);
      expect(await f.harness.snapshot(LegacyImportManifest, f.root.id, context)).toBeUndefined();
      const receipt = await importCopiedLegacy(f.root, input, publicContextBridge, () => {}, context);
      await f.close(); f = await open();
      expect(await importCopiedLegacy(f.root, input, publicContextBridge, () => {}, context)).toEqual(receipt);
      await equivalent(f, manager);
    } finally { await f.close(); await rm(dir, { recursive: true, force: true }); }
  });
  test("explicit bounds, absent baseline, nonlinear tree, unsupported records fail before writing", () => using(async f => {
    const manager = advancedFixture(true), input = moduleInput(manager);
    for (const invalid of [{ ...input, maxEntries: 2 }, { ...input, maxBytes: 10 }, { ...input, hostBaseline: "" },
      { ...input, hostBaseline: undefined } as unknown as CopiedLegacyInput]) {
      await expect(importCopiedLegacy(f.root, invalid, publicContextBridge, () => {}, context)).rejects.toThrow();
    }
    manager.branch(manager.getEntries()[1]!.id);
    manager.appendMessage({ role: "user", content: "deep branch", timestamp: 4000 });
    expect(() => prepareLegacyImport(moduleInput(manager), publicContextBridge)).toThrow("nonlinear");
    const unknown = advancedFixture(); unknown.appendCustomEntry("unknown", {});
    expect(() => prepareLegacyImport(moduleInput(unknown), publicContextBridge)).toThrow("unsupported extension");
    expect((await f.root.entries({}, 100, undefined, context)).items).toEqual([]);
    expect(await f.harness.snapshot(LegacyImportManifest, f.root.id, context)).toBeUndefined();
  }));
});

// Independent advanced fixture lane. The original fail-closed importer above is unchanged.
// Public Pi120 generates the JSONL; a temporary copy is reloaded through its public reader.
// This is a <=10-record, selected-path experiment, NOT a tree importer or migration runner.
type AdvancedBinding = { chatJid: string; branchId: string; sourceSessionId: string;
  engineConversationId: number; sourceLeafId: string | null; sourceHash: string;
  topology: { id: string; parentId: string | null }[]; entries: Mapping[] };
const AdvancedManifest = defineDoc<{ binding: AdvancedBinding | null }>({ kind: "app.advanced-import", version: 1,
  scope: "conversation", history: "latest", fork: "initial", initial: () => ({ binding: null }) });
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function advancedFixture(compact = false) {
  const manager = SessionManager.inMemory(process.env.PICLAW_WORKSPACE!, { id: "qualification-advanced" });
  manager.appendMessage({ role: "system", content: "Known original synthetic baseline", timestamp: 2000 });
  manager.appendMessage({ role: "user", content: "Original question", timestamp: 2001 });
  manager.appendMessage(assistant());
  if (compact) manager.appendCompaction("EXACT supplied summary: retain this punctuation!", manager.getEntries()[1]!.id,
    123, { original: "qualification-only" }, true);
  manager.appendMessage({ role: "user", content: "After checkpoint", timestamp: 2002 });
  return manager;
}
async function copiedAdvanced(manager: LegacyManager, run: (copy: LegacyManager, jsonl: string) => Promise<void>) {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "advanced-copy-"));
  try {
    const path = join(dir, "synthetic.jsonl"), text = copied(manager).jsonl;
    await Bun.write(path, text);
    const opened = SessionManager.open(path, dir);
    expect(opened.buildSessionContext()).toEqual(manager.buildSessionContext());
    // Mutate only a detached public in-memory copy when generating branch continuations.
    const copy = SessionManager.inMemory(process.env.PICLAW_WORKSPACE!, undefined,
      [opened.getHeader()!, ...opened.getEntries()]);
    await run(copy, text);
    expect(await Bun.file(path).text()).toBe(text);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
async function appendAdvanced(f: Fixture, manager: LegacyManager, text: string, branchId: string,
  conversation: Conversation = f.root, selected = manager.getBranch(), inherited = new Map<string, EntryId>()) {
  assert(manager.getEntries().length <= 10, "advanced fixture bound, not a production limit");
  // Validate entire selected batch before writing; never silently flatten an unsupported record.
  for (const entry of selected) {
    assert(entry.type === "message" || entry.type === "compaction", `advanced unsupported: ${entry.type}`);
    if (entry.type === "message") {
      if (entry.message.role === "system") {
        assert(typeof entry.message.content === "string", "only known string baseline qualified");
      } else message(entry.message);
    }
  }
  const pathIds = new Set(manager.getBranch().map(e => e.id));
  const mapping = new Map([...inherited].filter(([id]) => pathIds.has(id)));
  await conversation.commit(async tx => {
    for (const entry of selected) {
      // Raw source identity/topology are audit data, not engine IDs and not duplicate model messages.
      const audit = await tx.appendEntry(conversation.id, { kind: "app.advanced-source", data: JSON.parse(JSON.stringify(entry)) });
      let at = audit.id;
      if (entry.type === "message") {
        const model = json(convertToLlm(sessionEntryToContextMessages(entry)));
        const record = entry.message.role === "system"
          ? await tx.appendEntry(SystemEntry, conversation.id, { model })
          : await tx.appendEntry(conversation.id, { kind: "app.advanced-message", model });
        at = record.id;
      } else if (entry.type === "compaction") {
        const kept = mapping.get(entry.firstKeptEntryId);
        assert(kept, "first kept entry must be mapped on this path");
        const projected = json(convertToLlm(sessionEntryToContextMessages(entry)));
        const record = await tx.appendEntry(CompactionEntry, conversation.id, {
          head: kept, data: { reason: "manual" }, model: projected.filter(m => m.role !== "system"),
        });
        at = record.id;
        // Real positional baseline AFTER head; it is taken only from the original compaction checkpoint.
        const baseline = projected.filter(m => m.role === "system");
        if (baseline.length) at = (await tx.appendEntry(SystemEntry, conversation.id, { model: baseline })).id;
      }
      mapping.set(entry.id, at);
    }
    const doc = await tx.doc(AdvancedManifest, conversation.id);
    doc.binding = { chatJid: "web:advanced-synthetic", branchId, sourceSessionId: manager.getSessionId(),
      engineConversationId: conversation.id, sourceLeafId: manager.getLeafId(),
      sourceHash: createHash("sha256").update(text).digest("hex"),
      topology: manager.getEntries().map(e => ({ id: e.id, parentId: e.parentId })),
      entries: [...mapping].map(([sourceEntryId, durableEntryId]) => ({ sourceEntryId, durableEntryId })) };
  }, context);
  return mapping;
}
async function equivalent(f: Fixture, manager: LegacyManager, conversation: Conversation = f.root) {
  const original = buildSessionContext(manager.getEntries(), manager.getLeafId());
  expect(original).toEqual(manager.buildSessionContext());
  const view = await conversation.context(context);
  expect(view.messages).toEqual(json(convertToLlm(original.messages)));
  expect(view.messages.filter(m => m.role === "system")).toHaveLength(1);
  expect(f.host.modelCalls).toBe(0); expect(f.host.effects).toBe(0); expect(f.host.credentialLookups).toBe(0);
  const inspection = await f.harness.inspect(context);
  expect(inspection.tasks).toEqual([]); expect(inspection.submissions).toEqual([]);
}

describe("H5 advanced actual public context qualification, independent of rejected legacy importer", () => {
  test("known original system baseline: copied JSONL and actual durable model context, no double messages", () => using(async f => {
    await copiedAdvanced(advancedFixture(), async (manager, text) => {
      await appendAdvanced(f, manager, text, "original-main"); await equivalent(f, manager);
      expect((await f.root.context(context)).messages).toHaveLength(4);
    });
  }));
  test("compaction: exact provided summary and checkpoint baseline precede retained history", () => using(async f => {
    await copiedAdvanced(advancedFixture(true), async (manager, text) => {
      await appendAdvanced(f, manager, text, "original-compacted"); await equivalent(f, manager);
      const view = await f.root.context(context);
      expect(view.head?.kind).toBe(CompactionEntry.kind);
      expect(JSON.stringify(view.messages)).toContain("EXACT supplied summary: retain this punctuation!");
      const audit = (await f.root.entries({ order: "ascending" }, 100, undefined, context)).items
        .filter(e => e.kind === "app.advanced-source").map(e => e.data);
      expect(audit).toEqual(JSON.parse(JSON.stringify(manager.getEntries())));
    });
  }));
  test("two public forks at original entries derive distinct branch contexts and typed host identities", () => using(async f => {
    const source = advancedFixture(true);
    await copiedAdvanced(source, async (manager, text) => {
      const mapping = await appendAdvanced(f, manager, text, "host-main");
      const mainContext = json((await f.root.context(context)).messages);
      for (const [index, branchId] of [[1, "host-before-compaction"], [3, "host-after-compaction"]] as const) {
        const sourceAt = manager.getEntries()[index]!;
        const at = mapping.get(sourceAt.id)!;
        const fork = await f.root.fork(at, { ownership: { kind: "ownerless" } }, context);
        manager.branch(sourceAt.id);
        expect((await fork.context(context)).messages).toEqual(json(convertToLlm(manager.buildSessionContext().messages)));
        const id = manager.appendMessage({ role: "user", content: branchId, timestamp: 2003 });
        await appendAdvanced(f, manager, copied(manager).jsonl, branchId, fork, [manager.getEntry(id)!], mapping);
        await equivalent(f, manager, fork);
        const binding = (await f.harness.snapshot(AdvancedManifest, fork.id, context))!.binding!;
        expect(binding.branchId).toBe(branchId); expect(binding.engineConversationId).toBe(fork.id);
        expect(binding.entries.map(e => e.sourceEntryId)).toEqual(manager.getBranch().map(e => e.id));
        expect(binding.topology).toEqual(manager.getEntries().map(e => ({ id: e.id, parentId: e.parentId })));
      }
      expect((await f.root.context(context)).messages).toEqual(mainContext);
      expect((await f.harness.snapshot(AdvancedManifest, f.root.id, context))!.binding!.branchId).toBe("host-main");
    });
  }));
  test("public reset removes prior system baseline; known replacement baseline is not inferred", () => using(async f => {
    const manager = advancedFixture();
    await appendAdvanced(f, manager, copied(manager).jsonl, "before-reset");
    await f.root.reset(undefined, context);
    expect((await f.root.context(context)).messages).toEqual([]);
    const replacement = advancedFixture();
    await appendAdvanced(f, replacement, copied(replacement).jsonl, "explicit-after-reset");
    await equivalent(f, replacement);
  }));
  test("SQLite reopened compaction retains actual context and typed manifest", async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "advanced-sqlite-"));
    const open = () => openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(join(dir, "copy.sqlite"))));
    let f = await open();
    try {
      const manager = advancedFixture(true);
      await appendAdvanced(f, manager, copied(manager).jsonl, "sqlite-original");
      const binding = await f.harness.snapshot(AdvancedManifest, f.root.id, context);
      await f.close(); f = await open();
      await equivalent(f, manager);
      expect(await f.harness.snapshot(AdvancedManifest, f.root.id, context)).toEqual(binding);
    } finally { await f.close(); await rm(dir, { recursive: true, force: true }); }
  });
  test("BLOCKED: missing host-only baseline cannot be recovered from JSONL; no invented system context", () => using(async f => {
    const manager = SessionManager.inMemory(process.env.PICLAW_WORKSPACE!);
    manager.appendMessage({ role: "user", content: "No persisted system baseline", timestamp: 2000 });
    const knownHostBaseline = { source: "explicit synthetic host fixture, not JSONL", systemPrompt: "External host instructions" };
    expect(manager.buildSessionContext().messages.some(m => m.role === "system")).toBe(false);
    await appendAdvanced(f, manager, copied(manager).jsonl, "missing-host-baseline");
    const view = await f.root.context(context);
    expect(view.messages).toEqual(json(convertToLlm(manager.buildSessionContext().messages)));
    expect(JSON.stringify(view.messages)).not.toContain(knownHostBaseline.systemPrompt);
    // Exact JSONL-only equality is NOT full host/model-context qualification in this case.
    expect(view.messages.some(m => m.role === "system")).toBe(false);
  }));
});

function treeFixture() {
  const manager = advancedFixture(true);
  const checkpoint = manager.getEntries().find(e => e.type === "compaction")!.id;
  const before = manager.getEntries()[1]!.id;
  const mainLeaf = manager.getLeafId()!;
  manager.branch(checkpoint);
  const sibling = manager.appendMessage({ role: "user", content: [{ type: "text", text: "Sibling image" },
    { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }], timestamp: 4000 });
  manager.appendMessage(assistant(true));
  manager.appendMessage({ role: "toolResult", toolCallId: "copied-call", toolName: "host_effect",
    content: [{ type: "text", text: "completed sibling tool" }], isError: false, timestamp: 4001 });
  const siblingLeaf = manager.appendCustomEntry("qualification.display", { original: "sibling audit" });
  manager.branch(sibling);
  manager.appendMessage({ role: "user", content: "Grandchild fork", timestamp: 4002 });
  const grandchildLeaf = manager.appendCustomEntry("qualification.display", { original: "grandchild audit" });
  manager.branch(before);
  const earlyLeaf = manager.appendMessage({ role: "user", content: "Before compaction", timestamp: 4003 });
  const leaves = [mainLeaf, siblingLeaf, grandchildLeaf, earlyLeaf];
  const input: CopiedLegacyTreeInput = {
    sourceJSONL: copied(manager).jsonl,
    hostBranchBindings: Object.fromEntries(leaves.map((leaf, index) => [leaf, {
      chatJid: `web:original-tree-${index}`, chatIncarnation: `original-incarnation-${index}`,
      branchId: `original-host-branch-${index}`, hostBaseline: "Known original synthetic baseline",
    }])),
  };
  return { manager, input, leaves };
}
async function checkTree(f: Fixture, fixture: ReturnType<typeof treeFixture>, receipt: Awaited<ReturnType<typeof importCopiedLegacyTree>>) {
  expect(receipt.branches).toHaveLength(4);
  expect(receipt.entries).toHaveLength(fixture.manager.getEntries().length);
  expect(new Set(receipt.entries.map(e => e.durableEntryId)).size).toBe(receipt.entries.length);
  expect(receipt.originalEntries).toEqual(JSON.parse(JSON.stringify(fixture.manager.getEntries())));
  for (const branch of receipt.branches) {
    const conversation = (await f.harness.conversation(branch.engineConversationId as ConversationId, context))!;
    const expected = json(convertToLlm(buildSessionContext(fixture.manager.getEntries(), branch.sourceLeafId).messages));
    expect((await conversation.context(context)).messages).toEqual(expected);
    const host = fixture.input.hostBranchBindings[branch.sourceLeafId]!;
    expect([branch.chatJid, branch.chatIncarnation, branch.branchId]).toEqual([host.chatJid, host.chatIncarnation, host.branchId]);
    expect(branch.entries.map(e => e.sourceEntryId)).toEqual(fixture.manager.getBranch(branch.sourceLeafId).map(e => e.id));
    for (const entry of branch.entries)
      expect(entry.durableEntryId).toBe(receipt.entries.find(e => e.sourceEntryId === entry.sourceEntryId)!.durableEntryId);
    expect((await f.harness.snapshot(LegacyImportManifest, conversation.id, context))!.binding).toEqual(branch);
  }
  const conversations = await f.root.commit(tx => tx.scanConversations({}, 100), context);
  expect(conversations.items).toHaveLength(4);
  let audits = 0;
  for (const record of conversations.items) {
    const c = (await f.harness.conversation(record.id, context))!;
    const page = await c.entries({}, 100, undefined, context);
    // Visible inherited entries occur on several paths, but have identical durable IDs.
    for (const entry of page.items.filter(e => e.kind === "app.legacy-source")) {
      const raw = entry.data as { id: string };
      expect(receipt.entries.some(e => e.sourceEntryId === raw.id)).toBe(true);
      audits++;
    }
  }
  expect(audits).toBeGreaterThanOrEqual(receipt.entries.length);
  expect(await f.harness.inspect(context)).toEqual({ scheduling: "paused", tasks: [], submissions: [] });
  expect(f.host.effects + f.host.modelCalls + f.host.credentialLookups).toBe(0);
}

describe("restartable public full copied branch-tree importer", () => {
  test("all four leaves, sibling/grandchild compaction, tools/images/audit, shared IDs and exact context", () => using(async f => {
    const fixture = treeFixture();
    const receipt = await importCopiedLegacyTree(f.root, fixture.input, publicContextBridge, () => {}, context);
    await checkTree(f, fixture, receipt);
    expect(await importCopiedLegacyTree(f.root, fixture.input, publicContextBridge, () => {}, context)).toEqual(receipt);
    await checkTree(f, fixture, receipt);
    await expect(importCopiedLegacyTree(f.root, { ...fixture.input, sourceJSONL: fixture.input.sourceJSONL + "\n" },
      publicContextBridge, () => {}, context)).rejects.toThrow("content conflict");
    const changed = json(fixture.input);
    const leaf = fixture.leaves[0]!;
    (changed.hostBranchBindings[leaf] as { branchId: string }).branchId = "changed-host-branch";
    await expect(importCopiedLegacyTree(f.root, changed, publicContextBridge, () => {}, context)).rejects.toThrow("content conflict");
  }));
  test("fault after public Tx fork rolls back that branch; persisted root plan retries without duplicate forks", () => using(async f => {
    const fixture = treeFixture(); let forks = 0;
    const decorated: Conversation = Object.create(f.root);
    decorated.commit = (callback, ctx) => f.root.commit(tx => callback(new Proxy(tx, {
      get(target, key) {
        if (key === "forkConversation") return async (...args: Parameters<typeof tx.forkConversation>) => {
          await tx.forkConversation(...args); forks++;
          throw new Error("fault after public fork before manifest");
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    })), ctx);
    await expect(importCopiedLegacyTree(decorated, fixture.input, publicContextBridge, () => {}, context)).rejects.toThrow("fault after public fork");
    expect(forks).toBe(1);
    expect((await f.root.entries({}, 100, undefined, context)).items.length).toBeGreaterThan(0);
    expect((await f.harness.snapshot(LegacyTreeImportManifest, f.root.id, context))!.binding!.branches).toHaveLength(1);
    expect((await f.root.commit(tx => tx.scanConversations({}, 100), context)).items).toHaveLength(1);
    const receipt = await importCopiedLegacyTree(f.root, fixture.input, publicContextBridge, () => {}, context);
    expect(await importCopiedLegacyTree(f.root, fixture.input, publicContextBridge, () => {}, context)).toEqual(receipt);
    await checkTree(f, fixture, receipt);
  }));
  test("SQLite reopen after lost acknowledgement of committed fork resumes root plan without duplicates", async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "tree-import-sqlite-"));
    const open = () => openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(join(dir, "tree.sqlite"))));
    let f = await open();
    try {
      const fixture = treeFixture();
      const decorated: Conversation = Object.create(f.root);
      let commits = 0;
      decorated.commit = async (callback, ctx) => {
        const result = await f.root.commit(callback, ctx);
        if (++commits === 2) throw new Error("lost acknowledgement after committed fork");
        return result;
      };
      await expect(importCopiedLegacyTree(decorated, fixture.input, publicContextBridge, () => {}, context)).rejects.toThrow("lost acknowledgement");
      const partial = (await f.harness.snapshot(LegacyTreeImportManifest, f.root.id, context))!.binding!;
      expect(partial.branches).toHaveLength(2);
      expect(partial.plannedBranches).toHaveLength(4);
      expect((await f.root.commit(tx => tx.scanConversations({}, 100), context)).items).toHaveLength(2);
      const changed = json(fixture.input);
      (changed.hostBranchBindings[fixture.leaves[3]!] as { branchId: string }).branchId = "changed-unfinished-plan";
      await expect(importCopiedLegacyTree(f.root, changed, publicContextBridge, () => {}, context)).rejects.toThrow("content conflict");
      await f.close(); f = await open();
      const receipt = await importCopiedLegacyTree(f.root, fixture.input, publicContextBridge, () => {}, context);
      expect(receipt.branches.slice(0, 2)).toEqual(partial.branches);
      await f.close(); f = await open();
      expect(await importCopiedLegacyTree(f.root, fixture.input, publicContextBridge, () => {}, context)).toEqual(receipt);
      await checkTree(f, fixture, receipt);
    } finally { await f.close(); await rm(dir, { recursive: true, force: true }); }
  });
  test("detached nested host bindings survive bridge mutation; out-of-order records retain full tree", () => using(async f => {
    const fixture = treeFixture(), original = json(fixture.input), mutable = json(fixture.input);
    const records = original.sourceJSONL.trim().split("\n");
    const reordered = { ...original, sourceJSONL: [records[0], ...records.slice(1).reverse()].join("\n") };
    const receipt = await importCopiedLegacyTree(f.root, mutable, (...args) => {
      (mutable.hostBranchBindings[fixture.leaves[0]!] as { branchId: string }).branchId = "mutated-by-host";
      return publicContextBridge(...args);
    }, () => {}, context);
    expect(await importCopiedLegacyTree(f.root, original, publicContextBridge, () => {}, context)).toEqual(receipt);
    const other = await f.harness.createConversation({ ownership: { kind: "ownerless" } }, context);
    const second = await importCopiedLegacyTree(other, reordered, publicContextBridge, () => {}, context);
    for (const branch of second.branches) {
      const c = (await f.harness.conversation(branch.engineConversationId as ConversationId, context))!;
      expect((await c.context(context)).messages).toEqual(json(convertToLlm(buildSessionContext(fixture.manager.getEntries(), branch.sourceLeafId).messages)));
    }
  }));
  for (const invalid of ["missing-binding", "extra-binding", "duplicate-host", "duplicate-ID", "missing-parent", "cycle",
    "two-roots", "unknown-record", "overflow", "entries-bound", "bytes-bound", "branches-bound", "bad-baseline"] as const) {
    test(`whole-tree preflight rejects ${invalid} without any writes`, () => using(async f => {
      const fixture = treeFixture(), input = json(fixture.input);
      const bindings = input.hostBranchBindings as Record<string, { chatJid: string; chatIncarnation: string; branchId: string; hostBaseline: string }>;
      const records = input.sourceJSONL.trim().split("\n").map(line => JSON.parse(line));
      const leaf = fixture.leaves[0]!;
      if (invalid === "missing-binding") delete bindings[leaf];
      if (invalid === "extra-binding") bindings.extra = bindings[leaf]!;
      if (invalid === "duplicate-host") bindings[fixture.leaves[1]!] = bindings[leaf]!;
      if (invalid === "duplicate-ID") records[2].id = records[1].id;
      if (invalid === "missing-parent") records[2].parentId = "missing";
      if (invalid === "cycle") records[2].parentId = records[3].id;
      if (invalid === "two-roots") records[2].parentId = null;
      if (invalid === "unknown-record") records.at(-1).type = "future-record";
      if (invalid === "overflow") records.at(-1).message.content = "OVERFLOW";
      if (invalid === "bad-baseline") bindings[leaf]!.hostBaseline = "unsupported baseline";
      const candidate = { ...input, sourceJSONL: records.map(r => JSON.stringify(r)).join("\n").replace('"OVERFLOW"', "1e400"),
        ...(invalid === "entries-bound" ? { maxEntries: 2 } : {}),
        ...(invalid === "bytes-bound" ? { maxBytes: 2 } : {}),
        ...(invalid === "branches-bound" ? { maxBranches: 3 } : {}),
      };
      await expect(importCopiedLegacyTree(f.root, candidate, publicContextBridge, () => {}, context)).rejects.toThrow();
      expect((await f.root.entries({}, 100, undefined, context)).items).toEqual([]);
      expect(await f.harness.snapshot(LegacyTreeImportManifest, f.root.id, context)).toBeUndefined();
      expect((await f.root.commit(tx => tx.scanConversations({}, 100), context)).items).toHaveLength(1);
      expect(f.host.effects + f.host.modelCalls + f.host.credentialLookups).toBe(0);
    }));
  }
});
