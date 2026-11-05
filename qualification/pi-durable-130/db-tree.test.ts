import "./src/test-guard.js";
import { expect, spyOn, test } from "bun:test";
import { watch } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import * as persistedImport from "../../runtime/durable-engine/src/legacy-import-schema.js";
import * as importCompatibility from "../../runtime/durable-engine/src/legacy-import.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Harness, type ConversationId } from "../../runtime/durable-engine/qualification/durable.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { HostConversationRuntime, importCopiedLegacyTree, LegacyImportManifest } from "../../runtime/durable-engine/src/index.js";
import { OwnedSqlite } from "./src/ownership.js";
import { hostSourceContractFixture } from "./src/host-source-contract-fixture.js";
import { context } from "./src/fixture.js";
import { createDurableConversationAdapter } from "../../runtime/src/agent-pool/durable-runtime-adapter.js";
import { AgentRuntimeFacade } from "../../runtime/src/agent-pool/runtime-facade.js";
import { projectPublicHistory } from "../../runtime/durable-engine/src/session-tree.js";

test("persisted import documents retain exact identity, versions, initial state and policy", () => {
  expect(persistedImport.IMPORTER_VERSION).toBe(2);
  expect(persistedImport.DEFAULT_IMPORT_LIMITS).toEqual({maxEntries:1000,maxBytes:8*1024*1024});
  expect(persistedImport.DEFAULT_TREE_IMPORT_LIMITS).toEqual({maxEntries:1000,maxBytes:8*1024*1024,maxBranches:16});
  for (const [doc, kind] of [[persistedImport.LegacyImportManifest,"app.copied-legacy-import"],
    [persistedImport.LegacyTreeImportManifest,"app.copied-legacy-tree-import"]] as const) {
    expect(doc.definition).toMatchObject({kind,version:1,scope:"conversation",history:"latest",fork:"initial"});
    expect(doc.definition.initial()).toEqual({binding:null});
  }
  expect(importCompatibility.LegacyImportManifest).toBe(persistedImport.LegacyImportManifest);
  expect(importCompatibility.LegacyTreeImportManifest).toBe(persistedImport.LegacyTreeImportManifest);
});

test("native history reader graph excludes import preparation and archival tooling", async () => {
  const engine = resolve(import.meta.dir,"../../runtime/durable-engine/src");
  const loaded = new Set<string>();
  const result = await Bun.build({
    entrypoints:[join(engine,"host-runtime.ts"),join(engine,"session-tree.ts")],
    target:"bun",packages:"external",
    plugins:[{name:"history-import-boundary",setup(build) {
      build.onLoad({filter:/\.[cm]?[jt]sx?$/}, args => { loaded.add(args.path); });
    }}],
  });
  expect(result.success, result.logs.map(String).join("\n")).toBe(true);
  expect(loaded.has(join(engine,"legacy-import-schema.ts"))).toBe(true);
  for (const retired of ["legacy-import.ts","copied-upgrade.ts","copied-installation.ts","index.ts"])
    expect(loaded.has(join(engine,retired))).toBe(false);
  expect([...loaded].some(path => path.endsWith("/scripts/lib/sqlite-session-archive.ts"))).toBe(false);
});

test("only the adjacent audited imported compaction/baseline pair is deduplicated", () => {
  const source = { type: "compaction", id: "source", parentId: null, summary: "source summary", tokensBefore: 12 };
  const binding = { schemaVersion: 3, importerVersion: 2, sourceHash: "fixture", chatJid: "web:fixture", chatIncarnation: "fixture", branchId: "fixture", sourceSessionId: "fixture", sourceLeafId: "source", engineConversationId: 1, originalEntries: [source], entries: [{ sourceEntryId: "source", durableEntryId: 3 }] };
  const rows = [
    { id: 1, conversationId: 1, kind: "app.legacy-source", data: source },
    { id: 2, conversationId: 1, kind: "pi.compaction" },
    { id: 3, conversationId: 1, kind: "pi.system" },
  ] as unknown as Parameters<typeof projectPublicHistory>[0];
  expect(projectPublicHistory(rows, binding).map(n => n.entry)).toEqual([{ ...source, id: "3", parentId: null }]);
  const seed = { id: 0, conversationId: 1, kind: "pi.system", model: [{ role: "system", content: "Captured current continuation policy", timestamp: 0 }] } as unknown as typeof rows[number];
  expect(projectPublicHistory([seed, ...rows], binding).map(n => n.entry)).toEqual([{ ...source, id: "3", parentId: null }]);
  // Unmapped native compaction + arbitrary system must not erase the compaction.
  expect(projectPublicHistory(rows.slice(1), null).map(n => n.entry.id)).toEqual(["2"]);
  // Even a mapped baseline cannot prove the pair without the matching source audit.
  expect(projectPublicHistory(rows.slice(1), binding).map(n => n.entry.id)).toEqual(["2", "3"]);
  expect(projectPublicHistory([{ ...rows[0]!, data: { ...source, summary: "different source" } }, ...rows.slice(1)], binding).map(n => n.entry.id)).toEqual(["2", "3"]);
  const customBinding = { ...binding!, originalEntries: [{ ...source, type: "custom" }] } as Parameters<typeof projectPublicHistory>[1];
  expect(projectPublicHistory(rows, customBinding).map(n => n.entry.type)).toEqual(["compaction", "custom"]);
});

test("historical system instructions stay private and must match immutable import provenance", () => {
  const source = { type: "message", id: "historical-system", parentId: null,
    message: { role: "system", content: "Private historical instructions", timestamp: 1 } };
  const binding = { schemaVersion: 3, importerVersion: 2, sourceHash: "fixture", chatJid: "web:fixture", chatIncarnation: "fixture",
    branchId: "fixture", sourceSessionId: "fixture", sourceLeafId: source.id, engineConversationId: 1,
    originalEntries: [source], entries: [{ sourceEntryId: source.id, durableEntryId: 2 }] } as Parameters<typeof projectPublicHistory>[1];
  const rows = [{ id: 2, conversationId: 1, kind: "app.legacy-message", model: [source.message] }] as unknown as Parameters<typeof projectPublicHistory>[0];
  expect(projectPublicHistory(rows, binding)).toEqual([]);
  expect(() => projectPublicHistory([{ ...rows[0]!, model: [{ role: "system", content: "Changed instructions", timestamp: 1 }] }], binding))
    .toThrow("Imported system projection conflict");
  expect(() => projectPublicHistory(rows, null)).toThrow("Unsupported durable message role");
});

test("one DB imported fork tree through actual facade, original provenance and native public suffix", async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "db-tree-"));
  const f = await hostSourceContractFixture(dir, "before-submit", false, { sharedDatabase: true });
  const events: string[] = [];
  const watcher = watch(dirname(f.hostPath), { recursive: true }, (_, name) => { if (name?.endsWith(".jsonl")) events.push(name); });
  const spies = (["create", "open", "continueRecent"] as const).map(key => spyOn(SessionManager, key).mockImplementation(() => { throw Error("JSONL forbidden"); }));
  let runtime: HostConversationRuntime | undefined;
  const openStorage = () => SqliteStorage.open(new OwnedSqlite(f.owner, { foreignKeys: true }));
  try {
    const harness = await Harness.open(await openStorage(), { models: f.base.models, registry: f.base.registry }, context);
    const root = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
    const raw = [
      { type: "message", id: "baseline", parentId: null, timestamp: new Date(0).toISOString(), message: { role: "system", content: "baseline", timestamp: 0 } },
      { type: "message", id: "original-root", parentId: "baseline", timestamp: new Date(1000).toISOString(), message: { role: "user", content: "shared", timestamp: 1000 } },
      { type: "compaction", id: "original-compaction", parentId: "original-root", timestamp: new Date(1500).toISOString(), summary: "imported summary", firstKeptEntryId: "original-root", tokensBefore: 123, systemMessage: { role: "system", content: "compacted baseline", timestamp: 1500 } },
      { type: "message", id: "original-a", parentId: "original-compaction", timestamp: new Date(2000).toISOString(), message: { role: "user", content: "branch A", timestamp: 2000 } },
      { type: "message", id: "original-b", parentId: "original-compaction", timestamp: new Date(3000).toISOString(), message: { role: "user", content: "branch B", timestamp: 3000 } },
    ];
    const receipt = await importCopiedLegacyTree(root, {
      sourceJSONL: [{ type: "session", version: 3, id: "original-host-session", timestamp: new Date(0).toISOString(), cwd: "/fixture" }, ...raw].map(e => JSON.stringify(e)).join("\n"),
      hostBranchBindings: Object.fromEntries(["original-a", "original-b"].map((id, index) => [id, { chatJid: `web:tree-${index}`, chatIncarnation: "original-incarnation", branchId: `branch-${index}`, hostBaseline: "baseline" }])),
    }, entries => ({ messages: entries.flatMap(e => e.type === "message" ? [e.message] : []) as any,
      projected: entries.map(e => ({ sourceEntryId: e.id, messages: e.type === "message" ? [e.message] as any : e.type === "compaction" ? [{ role: "user", content: e.summary, timestamp: 1500 }, (e as any).systemMessage] as any : [] })) }), () => f.owner.assert(), context);
    const branch = receipt.branches[1]!;
    const conversation = (await harness.conversation(branch.engineConversationId as ConversationId, context))!;
    let nativeCompactionId: string | undefined;
    let rawHeadId: string | undefined;
    await conversation.commit(async tx => {
      await tx.appendEntry(conversation.id, { kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "native assistant" }, { type: "toolCall", id: "call", name: "read", arguments: {} }], timestamp: 3500, api: "openai-completions", provider: "qualification", model: "synthetic", stopReason: "toolUse", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }] });
      await tx.appendEntry(conversation.id, { kind: "pi.tool-result", model: [{ role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "native tool" }], isError: false, timestamp: 4000 }] });
      nativeCompactionId = String((await tx.appendEntry(conversation.id, { kind: "pi.compaction", model: [{ role: "user", content: "public summary", timestamp: 5000 }] })).id);
      rawHeadId = String((await tx.appendEntry(conversation.id, { kind: "pi.system", model: [{ role: "system", content: "private native baseline", timestamp: 6000 }] })).id);
    }, context);
    const provenance = await harness.snapshot(LegacyImportManifest, conversation.id, context);
    const publicRows = (await conversation.entries({ order: "ascending" }, 100, undefined, context)).items;
    expect(provenance!.binding!.importerVersion).toBe(2);
    expect(provenance!.binding!.originalEntries).toEqual(JSON.parse(JSON.stringify(raw.filter(entry => entry.id !== "original-a"))));
    expect(publicRows[0]).toMatchObject({ kind: "pi.system", model: [{ role: "system", content: "baseline", timestamp: 0 }] });
    expect(publicRows.filter(row => row.kind === "app.legacy-source").map(row => row.data)).toEqual(provenance!.binding!.originalEntries);
    const historicalSystem = publicRows.findIndex(row => row.kind === "app.legacy-source" && (row.data as { id?: string }).id === "baseline");
    expect(publicRows[historicalSystem + 1]).toMatchObject({ kind: "app.legacy-message", model: [raw[0]!.message] });
    const projectedCompactions = projectPublicHistory(publicRows, provenance!.binding).filter(n => n.entry.type === "compaction");
    expect(projectedCompactions).toHaveLength(2); // one imported source plus the independent native compaction
    expect(projectedCompactions[0]!.entry).toEqual({ ...raw[2], id: String(provenance!.binding!.entries.find(e => e.sourceEntryId === "original-compaction")!.durableEntryId), parentId: String(provenance!.binding!.entries.find(e => e.sourceEntryId === "original-root")!.durableEntryId) });
    expect(provenance?.binding).toMatchObject({ sourceSessionId: "original-host-session", sourceLeafId: "original-b", chatJid: branch.chatJid, chatIncarnation: "original-incarnation", branchId: branch.branchId });
    expect(provenance?.binding?.originalEntries.map((e: any) => e.id)).toContain("original-root");
    await harness.close(context);
    const manifest = receipt.branches.map(b => ({ chatJid: b.chatJid, branchId: b.branchId, conversationId: b.engineConversationId }));
    runtime = await HostConversationRuntime.open({ incarnation: "tree", owner: { assert: () => f.owner.assert(), release() {} }, openStorage, harnessOptions: { models: f.base.models, registry: f.base.registry }, work: f.ports.work, terminal: f.ports.terminal, bindings: f.ports.bindings, conversationFor: (chat, branch) => { const b = manifest.find(b => b.chatJid === chat && b.branchId === branch); if (!b) throw Error("binding"); return b.conversationId as ConversationId; }, existingConversationIds: manifest.map(b => b.conversationId as ConversationId), authorizeScheduling() { throw Error("read only"); }, putAnswer() { throw Error("read only"); }, sessionId: "original-host-session", now: () => new Date(0).toISOString() }, context);
    const adapter = createDurableConversationAdapter({ incarnation: "tree", manifest, runtime });
    const app = new AgentRuntimeFacade({ pool: new Map(), getDurableSession: chat => chat === branch.chatJid ? adapter.sessionPosition(branch.chatJid, branch.branchId, "original-host-session") : undefined, modelRegistry: {} as any, modelRuntime: {} as any, authPath: "unused",});
    const tree = await app.getSessionTreeForChat(branch.chatJid);
    expect(tree.nodes.filter(n => n.parentId === null)).toHaveLength(1);
    expect(tree.nodes.find(n => n.detail === "shared")?.childCount).toBe(1);
    const importedId = String(provenance!.binding!.entries.find(e => e.sourceEntryId === "original-compaction")!.durableEntryId);
    const importedNodes = tree.nodes.filter(n => n.type === "compaction" && n.id !== nativeCompactionId);
    expect(importedNodes).toHaveLength(1);
    expect(importedNodes[0]).toMatchObject({ id: importedId, type: "compaction", childCount: 2, timestamp: new Date(1500).toISOString() });
    expect(await app.getSessionTreeSummaryForChat(branch.chatJid)).toEqual({ leafId: rawHeadId!, total: tree.nodes.length });
    expect(tree.total).toBe(tree.nodes.length);
    expect(tree.total).toBeLessThan(publicRows.length);
    expect(tree.leafId).toBe(rawHeadId!);
    expect(tree.visibleLeafId).toBe(nativeCompactionId!);
    expect(tree.nodes.filter(n => n.active).map(n => n.id)).toEqual([nativeCompactionId!]);
    expect(tree.nodes.some(n => n.id === rawHeadId)).toBe(false);
    expect(tree.nodes.some(n => n.detail === "branch A")).toBe(true);
    expect(tree.nodes.some(n => n.detail === "branch B")).toBe(true);
    expect(tree.nodes.some(n => n.role === "toolResult" && n.detail === "native tool")).toBe(true);
    expect(tree.nodes.some(n => n.type === "compaction")).toBe(true);
    expect(tree.nodes.some(n => n.role === "assistant" && typeof n.detail === "string" && n.detail.includes("native assistant"))).toBe(true);
    expect(JSON.stringify(tree)).not.toContain("private reasoning");
    expect(JSON.stringify(tree)).not.toContain('"thinking"');
    expect(tree.nodes.some(n => n.id === "original-root")).toBe(false);
    expect((await app.applyControlCommand(branch.chatJid, { type: "tree", raw: "/tree" })).status).toBe("success");
    expect((await app.applyControlCommand(branch.chatJid, { type: "tree", raw: "/tree", targetId: tree.leafId! })).status).toBe("error");
    expect(tree.leafId).toBe(await app.saveSessionPosition(branch.chatJid));
    expect(receipt.sourceSessionId).toBe("original-host-session");
    expect(branch.chatIncarnation).toBe("original-incarnation");
    expect(branch.sourceLeafId).toBe("original-b");
    const writer = await Harness.open(await openStorage(), { models: f.base.models, registry: f.base.registry }, context);
    try {
      const current = (await writer.conversation(conversation.id, context))!;
      await current.commit(async tx => { await tx.appendEntry(current.id, { kind: "app.unsupported-tree-kind", model: [] }); }, context);
    } finally { await writer.close(context); }
    await expect(app.getSessionTreeSummaryForChat(branch.chatJid)).rejects.toThrow("Unsupported durable entry");
    await expect(app.getSessionTreeForChat(branch.chatJid)).rejects.toThrow("Unsupported durable entry");
    await expect(app.applyControlCommand(branch.chatJid, { type: "tree", raw: "/tree" })).rejects.toThrow("Unsupported durable entry");
    expect((await readdir(dirname(f.hostPath), { recursive: true })).filter(name => name.endsWith(".jsonl"))).toEqual([]);
    expect(events).toEqual([]);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally { await runtime?.close(); watcher.close(); for (const spy of spies) spy.mockRestore(); await f.close(); await rm(dir, { recursive: true, force: true }); }
});


test("preserved recovery history projects public content without rewriting entries", () => {
  const data = { owner: "operator:recent-context-copy", copied: true, sourceHash: "a".repeat(64),
    sourceSessionId: "saved-session", sourceLeafId: "saved-leaf", chatJid: "web:fixture", branchId: "fixture", messageIndex: 0 };
  const rows = [{ id: 42, conversationId: 1, kind: "app.recent-history-copy", data, model: [{ role: "assistant", timestamp: 1,
    content: [{ type: "thinking", thinking: "private", signature: "encrypted" }, { type: "text", text: "preserved answer" }] }] }] as unknown as Parameters<typeof projectPublicHistory>[0];
  const before = JSON.stringify(rows);
  const nodes = projectPublicHistory(rows, null);
  expect(nodes[0]!.entry).toMatchObject({ id: "42", type: "message", message: { role: "assistant", content: [{ type: "text", text: "preserved answer" }] } });
  expect(JSON.stringify(nodes)).not.toContain("private"); expect(JSON.stringify(nodes)).not.toContain("encrypted");
  expect(JSON.stringify(rows)).toBe(before);
  for (const invalid of [{ ...data, copied: false }, { ...data, owner: "unknown" }, { ...data, sourceHash: "invalid" }, { ...data, messageIndex: -1 }])
    expect(() => projectPublicHistory([{ ...rows[0]!, data: invalid }], null)).toThrow("Invalid recovery history copy");
  expect(() => projectPublicHistory([{ ...rows[0]!, model: [{ role: "system", content: "private policy", timestamp: 1 }] }], null)).toThrow("Unsupported durable message role");
  expect(() => projectPublicHistory([{ ...rows[0]!, kind: "app.unknown-copy" }], null)).toThrow("Unsupported durable entry");
});


test("native reset remains a public tree boundary without leaking model or baseline payloads", () => {
  const rows = [{ id: 3, conversationId: 1, kind: "pi.reset", data: { secret: "private reset data" }, model: [{ role: "system", content: "private reset instructions", timestamp: 1 }] },
    { id: 4, conversationId: 1, kind: "pi.system", model: [{ role: "system", content: "private baseline", timestamp: 1 }] },
    { id: 5, conversationId: 1, kind: "pi.user", model: [{ role: "user", content: "after reset", timestamp: 2 }] }] as unknown as Parameters<typeof projectPublicHistory>[0];
  const projected = projectPublicHistory(rows, null);
  expect(projected[0]).toEqual({ entry: { id: "3", parentId: null, type: "custom", customType: "pi.reset" }, children: [] });
  expect(projected[1]?.entry.parentId).toBe("3");
  expect(projected.map(n => n.entry.id)).toEqual(["3", "5"]);
  expect(JSON.stringify(projected)).not.toContain("private");
});
