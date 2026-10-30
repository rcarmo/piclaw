import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SessionManager, buildSessionContext, convertToLlm, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { SqliteStorage, SQLITE_MIGRATIONS, CURRENT_SQLITE_SCHEMA_VERSION } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { STORE_DIR } from "../../runtime/src/core/config.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { prepareCopiedInstallation } from "../../runtime/durable-engine/src/copied-installation.js";
import { prepareCopiedUpgrade, prepareCopiedApplicationUpgrade } from "../../runtime/durable-engine/src/copied-upgrade.ts";
import { HostCutoverController, initializeCutoverManifest, LegacyTreeImportManifest, LegacyImportManifest, type GetLegacyContext } from "../../runtime/durable-engine/src/index.ts";
import { TestOwner, OwnedSqlite } from "./src/ownership.ts";
import { context, openFixture } from "./src/fixture.ts";
const sha = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const capturedBaseline = "Captured current upgrade host instructions for future continuation";
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const bridge: GetLegacyContext = (entries, leaf) => ({ messages: json(convertToLlm(buildSessionContext([...entries], leaf).messages)),
  projected: entries.map(entry => ({ sourceEntryId: entry.id, messages: json(convertToLlm(sessionEntryToContextMessages(entry))) })) });
async function using(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>, mainOnly = false, historicalBaseline = true) {
  const f = await setup(false, mainOnly, historicalBaseline);
  try { await run(f); } finally { await f.base.close(); f.owner.releaseAfterClose(); f.db.close(); f.owner.closeConnection(); await rm(f.dir, { recursive: true, force: true }); }
}
async function setup(sharedDatabase = false, mainOnly = false, historicalBaseline = true) {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "upgrade-"));
  const path = sharedDatabase ? join(STORE_DIR, "messages.db") : join(dir, "owned.sqlite");
  const manager = SessionManager.inMemory(dir, { id: "existing-session" });
  if (historicalBaseline) manager.appendMessage({ role: "system", content: "persisted baseline", timestamp: 1 });
  const user = manager.appendMessage({ role: "user", content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }], timestamp: 2 });
  manager.appendCustomEntry("qualification.display", { note: "copied metadata, not a model message" });
  const shared = manager.appendCompaction("Copied summary, never regenerated", user, 100, { copied: true }, true);
  const answer = () => manager.appendMessage({ role: "assistant", api: "openai-completions", provider: "never", model: "never", content: [{ type: "text", text: "historical" }], stopReason: "stop", timestamp: 3,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  const left = answer();
  if (!mainOnly) manager.branch(shared);
  const leaves = mainOnly ? [left] : [left, answer()];
  const source = Buffer.from([manager.getHeader(), ...manager.getEntries()].map(v => JSON.stringify(v)).join("\n") + "\n");
  const chatJid = sharedDatabase ? `web:existing-${crypto.randomUUID()}` : "web:existing";
  const host = { version: 2, sourceCopied: true, expectedSourceSHA256: sha(source), pending: 0, inflight: 0,
    hostBranchBindings: Object.fromEntries(leaves.map((leaf, i) => [leaf, { chatJid: sharedDatabase && i === 1 ? `${chatJid}-right` : chatJid, chatIncarnation: "existing-incarnation", branchId: mainOnly ? "main" : `${chatJid}-${i}`, hostBaseline: capturedBaseline }])) };
  if (!sharedDatabase) {
    await writeFile(join(dir, "copy.jsonl"), source); await writeFile(join(dir, "host.json"), JSON.stringify(host));
  }
  // Shared mode has only migration input bytes in memory, never a session file.
  const bytes = Buffer.from(source), manifest = Buffer.from(JSON.stringify(host));
  const expected = { sourceSHA256: sha(bytes), manifestSHA256: sha(manifest) };
  const owner = TestOwner.acquire(path);
  if (sharedDatabase) { owner.assert(); initDatabase(); }
  const db = sharedDatabase ? getDb() : new Database(path, { strict: true });
  db.exec("PRAGMA foreign_keys=ON"); initializeCutoverManifest(db, () => owner.assert());
  if (sharedDatabase) {
    // These are original manifest identities, persisted BEFORE any SDK import.
    for (const [leaf, binding] of Object.entries(host.hostBranchBindings)) {
      db.query("INSERT INTO chats(jid,name) VALUES (?,?)").run(binding.chatJid, "Existing host chat");
      db.query("INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,agent_name,created_at,updated_at) VALUES (?,?,?,?,?,?)")
        .run(binding.branchId, binding.chatJid, chatJid, `smith-${binding.branchId}`, "2026-01-01", "2026-01-01");
      for (const entry of manager.getBranch(leaf)) {
        if (entry.type === "message" && "content" in entry.message) db.query("INSERT INTO messages(id,chat_jid,content,timestamp) VALUES (?,?,?,?)")
          .run(entry.id, binding.chatJid, JSON.stringify(entry.message.content), "2026-01-01");
      }
    }
    db.query("INSERT INTO chat_cursors(chat_jid,cursor_ts,queued_followups_json) VALUES (?,?,?)")
      .run(chatJid, "2026-01-01", JSON.stringify([{ id: "original-queued", content: "untouched queue" }]));
    db.query("INSERT INTO users(id,username,display_name,role,enabled,created_at,updated_at) VALUES (?,?,?,'member',1,?,?)")
      .run(chatJid, chatJid, "Existing host user", "2026-01-01", "2026-01-01");
    // Reproduce a pre-retirement store; fresh production schemas no longer create this table.
    db.exec(`CREATE TABLE user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL CHECK(revision>=1),
      theme TEXT NOT NULL CHECK(theme IN ('system','light','dark')), response_guidance TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;`);
    db.query("INSERT INTO user_preferences VALUES (?,?,?,?,?)").run(chatJid, 1, "dark", "original guidance", "2026-01-01");
    const message = db.query("SELECT rowid FROM messages WHERE id=? AND chat_jid=?").get(user, chatJid) as { rowid: number };
    const media = db.query("INSERT INTO media(filename,content_type,data,metadata) VALUES (?,?,?,?) RETURNING id")
      .get("original.png", "image/png", Buffer.from("image"), JSON.stringify({ sourceEntryId: user })) as { id: number };
    db.query("INSERT INTO message_media VALUES (?,?)").run(message.rowid, media.id);
    const rootNames = new Set((db.query("SELECT name FROM sqlite_master").all() as { name: string }[]).map(row => row.name));
    const sdkNames = SQLITE_MIGRATIONS.flatMap(m => m.statements.flatMap(sql => {
      const match = /^CREATE (?:TABLE|INDEX) (\w+)/.exec(sql); return match ? [match[1]!] : [];
    })).concat("durable_schema");
    if (!rootNames.has("durable_schema")) expect(sdkNames.filter(name => rootNames.has(name))).toEqual([]);
  }
  const hostSnapshot = (connection = db) => ["chats", "chat_branches", "messages", "chat_cursors", "users", "user_preferences", "media", "message_media", "core_schema_migrations"]
    .map(table => connection.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const originalHost = sharedDatabase ? hostSnapshot() : [];
  const candidateDatabase = new OwnedSqlite(owner, { foreignKeys: sharedDatabase });
  const opened = await openFixture(owner, () => {}, () => SqliteStorage.open(candidateDatabase));
  // Harness.root() reuses the fixed SDK root, which can contain another fixture's history.
  // Keep the exact handle returned by public creation; never select a global first row.
  const root = sharedDatabase ? await opened.harness.createConversation({ ownership: { kind: "ownerless" } }, context) : opened.root;
  const base = { ...opened, root };
  const identity = { domain: "copied-authority", incarnation: "existing-host", ownerGeneration: owner.token.generation, sourceEngineId: "legacy", candidateStoreRef: "candidate" };
  const ports = { assertOwner() { owner.assert(); }, assertCurrentWriter(writer: string) { if (writer !== "legacy") throw Error("not source"); },
    checkDrained() { return { sourceDigest: expected.sourceSHA256, pending: 0, inflight: 0 }; } };
  const controller = new HostCutoverController(db, identity, ports);
  return { dir, path, owner, db, base, bytes, manifest, expected, controller, identity, ports, host, candidateDatabase, hostSnapshot, originalHost };
}
for (const historical of [false, true]) {
  test(`copied v2 continuation accepts ${historical ? "different historical system/checkpoint" : "no historical system"} without changing source audit`, () => using(async f => {
    const source = Buffer.from(f.bytes), records = source.toString().trim().split("\n").map(line => JSON.parse(line));
    const original = records.slice(1);
    expect(original.some(entry => entry.message?.role === "system")).toBe(historical);
    const plan = prepareCopiedUpgrade(f.bytes, f.manifest, f.expected, bridge);
    await plan.importCopied(f.base.root, () => f.owner.assert(), context);
    const receipt = (await f.base.harness.snapshot(LegacyTreeImportManifest, f.base.root.id, context))!.binding!;
    expect(receipt.importerVersion).toBe(2);
    expect(receipt.originalEntries).toEqual(original);
    const seedIds = new Set<number>();
    for (const branch of receipt.branches) {
      const conversation = (await f.base.harness.conversation(branch.engineConversationId as typeof f.base.root.id, context))!;
      const current = { role: "system", content: capturedBaseline, timestamp: 0 };
      const view = await conversation.context(context);
      const legacy = bridge(branch.originalEntries as unknown as Parameters<GetLegacyContext>[0], branch.sourceLeafId);
      expect(view.messages).toEqual([current, ...legacy.messages]);
      expect(view.messages.slice(1)).toEqual(legacy.messages);
      const history = (await conversation.commit(tx => tx.scanEntries({ conversationId: conversation.id, order: "ascending" }, original.length * 3 + 1), context)).items;
      const { id, conversationId: owner, ...seed } = history[0]!;
      seedIds.add(id); expect(owner).toBe(f.base.root.id);
      expect(seed).toEqual({ kind: "pi.system", model: [current] });
      expect(history.filter(entry => entry.kind === "pi.system")).toHaveLength(1);
      expect(history.filter(e => e.kind === "app.legacy-source").map(e => e.data)).toEqual(branch.originalEntries);
      for (const [index, row] of history.entries()) {
        if (row.kind !== "app.legacy-source") continue;
        const raw = row.data as { type: string; id: string };
        if (raw.type === "message") {
          expect(history[index + 1]).toMatchObject({ kind: "app.legacy-message", model: legacy.projected.find(p => p.sourceEntryId === raw.id)!.messages });
        }
        if (raw.type === "compaction") {
          expect(history[index + 1]).toMatchObject({ kind: "pi.compaction", model: [current, ...legacy.projected.find(p => p.sourceEntryId === raw.id)!.messages] });
          expect(branch.entries.find(e => e.sourceEntryId === raw.id)!.durableEntryId).toBe(history[index + 1]!.id);
        }
      }
    }
    expect(seedIds.size).toBe(1); // Forks inherit the original seed, never reseed.
    await plan.verify(f.base.harness, f.base.root.id, context);
    const before = await f.base.harness.snapshot(LegacyTreeImportManifest, f.base.root.id, context);
    await plan.importCopied(f.base.root, () => f.owner.assert(), context);
    expect(await f.base.harness.snapshot(LegacyTreeImportManifest, f.base.root.id, context)).toEqual(before);
    expect(f.bytes).toEqual(source);
    expect(await readFile(join(f.dir, "copy.jsonl"))).toEqual(source);
    expect(f.base.host.modelCalls + f.base.host.effects + f.base.host.credentialLookups).toBe(0);
    expect(f.controller.inspect()).toBeNull();
  }, false, historical));
}
test("installation: every source validated before writes; deterministic identity pins roots and rejects duplicates", () => using(async f => {
  const secondSource = Buffer.from(f.bytes.toString().replace('"id":"existing-session"', '"id":"second-session"'));
  const secondHost = { ...f.host, expectedSourceSHA256: sha(secondSource), hostBranchBindings:
    Object.fromEntries(Object.entries(f.host.hostBranchBindings).map(([leaf, identity]) => [leaf, { ...identity, chatJid: "web:second" }])) };
  const manifest = Buffer.from(JSON.stringify(secondHost));
  const first = { sourceJSONL: f.bytes.toString(), manifestJSON: f.manifest.toString(), expected: f.expected };
  const second = { sourceJSONL: secondSource.toString(), manifestJSON: manifest.toString(), expected: { sourceSHA256: sha(secondSource), manifestSHA256: sha(manifest) } };
  const root = await f.base.harness.createConversation({ ownership: { kind: "ownerless" } }, context);
  const roots = new Map([[f.expected.sourceSHA256, f.base.root.id], [second.expected.sourceSHA256, root.id]]);
  const before = f.db.serialize();
  const plan = prepareCopiedInstallation([first, second], roots, bridge);
  expect(prepareCopiedInstallation([second, first], roots, bridge).request).toEqual(plan.request);
  expect(prepareCopiedInstallation([first, second], new Map([[f.expected.sourceSHA256, root.id], [second.expected.sourceSHA256, f.base.root.id]]), bridge).request).not.toEqual(plan.request);
  const unsupported = Buffer.from(JSON.stringify({ ...secondHost, pending: 1 }));
  expect(() => prepareCopiedInstallation([first, { ...second, manifestJSON: unsupported.toString(), expected: { ...second.expected, manifestSHA256: sha(unsupported) } }], roots, bridge)).toThrow();
  expect(() => prepareCopiedInstallation([first, first], roots, bridge)).toThrow("Duplicate installation session");
  const conflict = Buffer.from(JSON.stringify({ ...secondHost, hostBranchBindings: f.host.hostBranchBindings }));
  expect(() => prepareCopiedInstallation([first, { ...second, manifestJSON: conflict.toString(), expected: { ...second.expected, manifestSHA256: sha(conflict) } }], roots, bridge)).toThrow("Conflicting installation branch/chat");
  expect(() => prepareCopiedInstallation([first, second], new Map([[first.expected.sourceSHA256, root.id], [second.expected.sourceSHA256, root.id]]), bridge)).toThrow("Invalid installation roots");
  expect(() => prepareCopiedInstallation([first, second], new Map([[first.expected.sourceSHA256, root.id]]), bridge)).toThrow("Exact installation root assignments");
  expect(() => prepareCopiedInstallation([first, second], new Map([[first.expected.sourceSHA256, root.id], ["wrong-source", f.base.root.id]]), bridge)).toThrow("Invalid installation roots");
  const missing = prepareCopiedInstallation([first, second], new Map([[first.expected.sourceSHA256, f.base.root.id], [second.expected.sourceSHA256, 999999999 as typeof root.id]]), bridge);
  await expect(missing.validateImporter(f.base.harness, f.base.root.id, context)).rejects.toThrow("Missing installation root");
  await expect(plan.validateImporter(f.base.harness, root.id, context)).rejects.toThrow("Installation importer root conflict");
  expect(f.db.serialize()).toEqual(before); expect(f.controller.inspect()).toBeNull();
  expect(await f.base.harness.snapshot(LegacyTreeImportManifest, f.base.root.id, context)).toBeUndefined();
  expect(await f.base.harness.snapshot(LegacyTreeImportManifest, root.id, context)).toBeUndefined();
  const controller = new HostCutoverController(f.db, f.identity, { ...f.ports, checkDrained: () => ({ sourceDigest: plan.request.sourceDigest, pending: 0, inflight: 0 }) });
  plan.checkpoint(controller);
  const pinned = f.db.serialize();
  const swapped = prepareCopiedInstallation([first, second], new Map([[first.expected.sourceSHA256, root.id], [second.expected.sourceSHA256, f.base.root.id]]), bridge);
  expect(() => swapped.checkpoint(controller)).toThrow(); expect(f.db.serialize()).toEqual(pinned);
}, true));
test("application upgrade bindings: reject valid unsupported branches before journal/import writes", () => using(async f => {
  expect(() => prepareCopiedApplicationUpgrade(f.bytes, f.manifest, f.expected, bridge))
    .toThrow("ambiguous same-chat branches are unsupported");
  expect(f.controller.inspect()).toBeNull();
  expect(await f.base.harness.snapshot(LegacyTreeImportManifest, f.base.root.id, context)).toBeUndefined();
}));
test("application upgrade bindings: verified original IDs survive lost import ACK and journal reopen", () => using(async f => {
  const plan = prepareCopiedApplicationUpgrade(f.bytes, f.manifest, f.expected, bridge);
  await expect(plan.verifyBindings(f.base.harness, f.base.root.id, context)).rejects.toThrow();
  const checkpoint = plan.checkpoint(f.controller);
  await expect(f.controller.begin(checkpoint.revision, {
    async copy() { return { sourceDigest: plan.sourceSHA256, receiptHash: plan.request.importHash }; },
    async importCopied() { await plan.importCopied(f.base.root, () => f.owner.assert(), context); throw Error("lost ACK"); },
  })).rejects.toThrow();
  const before = await f.base.harness.snapshot(LegacyTreeImportManifest, f.base.root.id, context);
  const rootId = f.base.root.id;
  await f.base.close();
  const reopened = await openFixture(f.owner, () => {}, () => SqliteStorage.open(new OwnedSqlite(f.owner)));
  const journal = new Database(f.path, { strict: true });
  try {
    const controller = new HostCutoverController(journal, f.identity, f.ports);
    const root = (await reopened.harness.conversation(rootId, context))!;
    const imported = await controller.begin(plan.checkpoint(controller).revision, {
      async copy() { return { sourceDigest: plan.sourceSHA256, receiptHash: plan.request.importHash }; },
      importCopied: () => plan.importCopied(root, () => f.owner.assert(), context),
    });
    const bindings = await plan.verifyBindings(reopened.harness, rootId, context);
    expect(bindings.manifest).toEqual([{ chatJid: "web:existing", branchId: "main", conversationId: rootId }]);
    expect([...bindings.sessions]).toEqual([["web:existing", "existing-session"]]);
    const verified = await controller.verify(imported.revision, () => plan.verify(reopened.harness, rootId, context));
    expect(verified.writer).toBe("legacy");
    expect(await reopened.harness.snapshot(LegacyTreeImportManifest, rootId, context)).toEqual(before);
    expect((await root.commit(tx => tx.scanConversations({}, 100), context)).items).toHaveLength(1);
    await root.commit(async tx => { (await tx.doc(LegacyTreeImportManifest, rootId)).binding!.branches[0]!.entries = []; }, context);
    await expect(plan.verifyBindings(reopened.harness, rootId, context)).rejects.toThrow();
    expect(controller.inspect()).toEqual(verified);
    expect(reopened.host.modelCalls).toBe(0);
  } finally { await reopened.close(); journal.close(); }
}, true));
test("copied upgrade: exact bytes checkpoint before import; lost acknowledgement and disk/public reopen preserve all IDs", () => using(async f => {
  const plan = prepareCopiedUpgrade(f.bytes, f.manifest, f.expected, bridge);
  f.bytes.fill(0); f.manifest.fill(0); // No retained caller buffers.
  const checkpoint = plan.checkpoint(f.controller);
  const preparation = { async copy() { return { sourceDigest: plan.sourceSHA256, receiptHash: plan.request.importHash }; },
    importCopied: () => plan.importCopied(f.base.root, () => f.owner.assert(), context) };
  const lostAcknowledgement = new Error("lost acknowledgement");
  let importCommitted = false;
  let callbackError: unknown;
  await expect(f.controller.begin(checkpoint.revision, { ...preparation, async importCopied() {
    try {
      await preparation.importCopied();
      expect((await f.base.harness.snapshot(LegacyTreeImportManifest, f.base.root.id, context))?.binding).toBeDefined();
      importCommitted = true;
      throw lostAcknowledgement;
    } catch (error) { callbackError = error; throw error; }
  } })).rejects.toThrow(/^Cutover rejected$/);
  expect(callbackError).toBe(lostAcknowledgement);
  expect(importCommitted).toBe(true);
  const rootId = f.base.root.id;
  const before = await f.base.harness.snapshot(LegacyTreeImportManifest, rootId, context);
  await f.base.close();
  const reopened = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new OwnedSqlite(f.owner)));
  const journal = new Database(join(f.dir, "owned.sqlite"), { strict: true });
  try {
    const root = (await reopened.harness.conversation(rootId, context))!;
    const controller = new HostCutoverController(journal, f.identity, f.ports);
    const checkpointAgain = plan.checkpoint(controller);
    const imported = await controller.begin(checkpointAgain.revision, { ...preparation, importCopied: () => plan.importCopied(root, () => f.owner.assert(), context) });
    const verified = await controller.verify(imported.revision, () => plan.verify(reopened.harness, rootId, context));
    expect(verified.phase).toBe("verified"); expect(verified.writer).toBe("legacy");
    expect(await reopened.harness.snapshot(LegacyTreeImportManifest, rootId, context)).toEqual(before);
    const after = f.controller.inspect();
    const originalSource = await readFile(join(f.dir, "copy.jsonl"));
    const differentManifest = Buffer.from(JSON.stringify(f.host) + "\n");
    const other = prepareCopiedUpgrade(originalSource, differentManifest, { ...f.expected, manifestSHA256: sha(differentManifest) }, bridge);
    expect(() => other.checkpoint(controller)).toThrow(); expect(f.controller.inspect()).toEqual(after);
    expect((await root.commit(tx => tx.scanConversations({}, 100), context)).items).toHaveLength(2);
    expect(controller.rollback(verified.revision).writer).toBe("legacy");
    expect(reopened.host.modelCalls + reopened.host.effects + reopened.host.credentialLookups).toBe(0);
  } finally { await reopened.close(); journal.close(); }
}));
test("copied upgrade: single host messages.db preserves original rows through lost import ACK and SDK/journal reopen without JSONL", async () => {
  const oldMemory = process.env.PICLAW_DB_IN_MEMORY;
  process.env.PICLAW_DB_IN_MEMORY = "0";
  const f = await setup(true);
  let reopened: Awaited<ReturnType<typeof openFixture>> | undefined;
  let journal: Database | undefined;
  try {
    const plan = prepareCopiedUpgrade(f.bytes, f.manifest, f.expected, bridge);
    const rootId = f.base.root.id;
    const checkpoint = plan.checkpoint(f.controller);
    const copy = async () => ({ sourceDigest: plan.sourceSHA256, receiptHash: plan.request.importHash });
    let importCommitted = false;
    const lostAcknowledgement = new Error("lost import acknowledgement");
    let callbackError: unknown;
    await expect(f.controller.begin(checkpoint.revision, { copy, async importCopied() {
      try {
        await plan.importCopied(f.base.root, () => f.owner.assert(), context);
        expect((await f.base.harness.snapshot(LegacyTreeImportManifest, rootId, context))?.binding).toBeDefined();
        importCommitted = true;
        throw lostAcknowledgement;
      } catch (error) { callbackError = error; throw error; }
    } })).rejects.toThrow(/^Cutover rejected$/);
    expect(callbackError).toBe(lostAcknowledgement);
    expect(importCommitted).toBe(true);
    const before = await f.base.harness.snapshot(LegacyTreeImportManifest, rootId, context);
    expect(before!.binding!.sourceSessionId).toBe("existing-session");
    expect(before!.binding!.branches.map(b => [b.sourceLeafId, b.chatJid, b.branchId]).sort(([a], [b]) => a!.localeCompare(b!)))
      .toEqual(Object.entries(f.host.hostBranchBindings).sort(([a], [b]) => a.localeCompare(b)).map(([leaf, b]) => [leaf, b.chatJid, b.branchId]));
    // Verify full source rows, provenance, branch receipts, contexts and media BEFORE close too.
    await plan.verify(f.base.harness, rootId, context);
    expect(f.hostSnapshot()).toEqual(f.originalHost);
    const originalConversations = (await f.base.root.commit(tx => tx.scanConversations({}, 100), context)).items;
    const header = f.db.query("PRAGMA user_version").get();
    await f.base.close(); closeDatabase();
    // The exclusive owner remains held across connection restart; nobody can steal a live owner.
    expect(() => TestOwner.acquire(f.path)).toThrow("owner busy");
    f.owner.assert(); initDatabase(); journal = getDb(); journal.exec("PRAGMA foreign_keys=ON");
    expect(f.hostSnapshot(journal)).toEqual(f.originalHost);
    expect(journal.query("PRAGMA user_version").get()).toEqual(header);
    const sdk = new OwnedSqlite(f.owner, { foreignKeys: true });
    reopened = await openFixture(f.owner, () => {}, () => SqliteStorage.open(sdk));
    const root = (await reopened.harness.conversation(rootId, context))!;
    const controller = new HostCutoverController(journal, f.identity, f.ports);
    const imported = await controller.begin(plan.checkpoint(controller).revision, { copy,
      importCopied: () => plan.importCopied(root, () => f.owner.assert(), context) });
    const verified = await controller.verify(imported.revision, () => plan.verify(reopened!.harness, rootId, context));
    expect(verified.phase).toBe("verified"); expect(verified.writer).toBe("legacy");
    // Retry again after verification: no extra durable IDs or entries, no writer flip.
    await plan.importCopied(root, () => f.owner.assert(), context);
    expect(await reopened.harness.snapshot(LegacyTreeImportManifest, rootId, context)).toEqual(before);
    const conversations = (await root.commit(tx => tx.scanConversations({}, 100), context)).items;
    expect(conversations).toEqual(originalConversations);
    expect(conversations.filter(c => before!.binding!.branches.some(b => b.engineConversationId === c.id))).toHaveLength(2);
    expect(f.hostSnapshot(journal)).toEqual(f.originalHost);
    const connections = [journal.query("PRAGMA database_list").all(), await sdk.all("SELECT * FROM pragma_database_list")] as
      { seq: number; name: string; file: string }[][];
    for (const [index, connection] of connections.entries()) {
      // ALTER TABLE during the owned core rebuild allocates SQLite's internal
      // temp namespace. Permit only that empty namespace and the SAME root file:
      // never another attached store or a second source of execution state.
      expect(connection.filter(row => row.name !== "temp")).toEqual([{ seq: 0, name: "main", file: f.owner.path }]);
      const temp = connection.filter(row => row.name === "temp");
      if (temp.length) {
        expect(temp).toEqual([{ seq: 1, name: "temp", file: "" }]);
        expect(index === 0 ? journal.query("SELECT name FROM temp.sqlite_schema").all()
          : await sdk.all("SELECT name FROM temp.sqlite_schema")).toEqual([]);
      }
    }
    expect(journal.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(await sdk.get("SELECT * FROM pragma_foreign_keys")).toEqual({ foreign_keys: 1 });
    expect(journal.query("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
    expect(await sdk.all("SELECT * FROM pragma_foreign_key_check")).toEqual([]);
    expect(journal.query("SELECT version FROM durable_schema").get()).toEqual({ version: CURRENT_SQLITE_SCHEMA_VERSION });
    for (const table of ["qualification_cutover_v1", "documents", "document_revisions", "entries", "conversations"]) {
      expect((journal.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n).toBeGreaterThan(0);
    }
    expect(controller.inspect()).toEqual(verified);
    expect(reopened.host.modelCalls + reopened.host.effects + reopened.host.credentialLookups).toBe(0);
    const files = [...(await readdir(f.dir)).map(name => join(f.dir, name)), ...(await readdir(STORE_DIR)).map(name => join(STORE_DIR, name))];
    expect(files.filter(file => /\.jsonl$/i.test(file))).toEqual([]);
    expect(files.filter(file => ![f.path, `${f.path}-wal`, `${f.path}-shm`].includes(file))).toEqual([]);
    expect((await stat(f.path)).ino).toBe((await stat(f.owner.path)).ino);
  } finally {
    await reopened?.close(); await f.base.close(); closeDatabase();
    f.owner.releaseAfterClose(); f.owner.closeConnection();
    process.env.PICLAW_DB_IN_MEMORY = oldMemory;
    await rm(f.dir, { recursive: true, force: true });
  }
}, 20000);
for (const fault of ["missing tree mapping", "missing branch mapping", "aliased conversations", "matching forged manifests"] as const) {
  test(`copied upgrade: public receipt corruption rejects ${fault} without advancing cutover`, () => using(async f => {
    const plan = prepareCopiedUpgrade(f.bytes, f.manifest, f.expected, bridge);
    const checkpoint = plan.checkpoint(f.controller);
    const imported = await f.controller.begin(checkpoint.revision, {
      async copy() { return { sourceDigest: plan.sourceSHA256, receiptHash: plan.request.importHash }; },
      importCopied: () => plan.importCopied(f.base.root, () => f.owner.assert(), context),
    });
    await f.base.root.commit(async tx => {
      const doc = await tx.doc(LegacyTreeImportManifest, f.base.root.id);
      const binding = doc.binding!;
      if (fault === "missing tree mapping") binding.entries = [];
      else if (fault === "missing branch mapping") binding.branches[0]!.entries = [];
      else if (fault === "aliased conversations") binding.branches[1]!.engineConversationId = binding.branches[0]!.engineConversationId;
      else {
        // Both receipt surfaces agree, but point one source at a different real entry.
        const branch = binding.branches[0]!;
        const mapped = branch.entries[0]!;
        mapped.durableEntryId = branch.entries[1]!.durableEntryId;
        binding.entries.find(entry => entry.sourceEntryId === mapped.sourceEntryId)!.durableEntryId = mapped.durableEntryId;
        (await tx.doc(LegacyImportManifest, f.base.root.id)).binding = json(branch);
      }
    }, context);
    const before = f.controller.inspect();
    await expect(f.controller.verify(imported.revision, () => plan.verify(f.base.harness, f.base.root.id, context))).rejects.toThrow();
    expect(f.controller.inspect()).toEqual(before);
    expect(f.controller.rollback(imported.revision).writer).toBe("legacy");
    expect((await f.base.root.commit(tx => tx.scanConversations({}, 100), context)).items).toHaveLength(2);
    expect(f.base.host.modelCalls + f.base.host.effects + f.base.host.credentialLookups).toBe(0);
  }));
}
test("copied upgrade: digest/provenance/context failures precede every journal/import write", () => using(async f => {
  const before = await f.base.harness.snapshot(LegacyTreeImportManifest, f.base.root.id, context);
  for (const patch of [{ expectedSourceSHA256: "0".repeat(64) }, { pending: 1 }, { sourceCopied: false }, { version: 1 }, { version: 3 },
    { hostBranchBindings: {} },
    { hostBranchBindings: Object.fromEntries(Object.entries(f.host.hostBranchBindings).map(([k, v]) => [k, { ...v, hostBaseline: "" }])) },
    { hostBranchBindings: Object.fromEntries(Object.entries(f.host.hostBranchBindings).map(([k, { hostBaseline: _hostBaseline, ...v }]) => [k, v])) },
    { hostBranchBindings: Object.fromEntries(Object.entries(f.host.hostBranchBindings).map(([k, v], index) => [k, { ...v, hostBaseline: index ? capturedBaseline + " conflicting" : capturedBaseline }])) }]) {
    const manifest = Buffer.from(JSON.stringify({ ...f.host, ...patch }));
    expect(() => prepareCopiedUpgrade(f.bytes, manifest, { ...f.expected, manifestSHA256: sha(manifest) }, bridge)).toThrow();
    expect(f.controller.inspect()).toBeNull();
  }
  expect(() => prepareCopiedUpgrade(f.bytes, f.manifest, { ...f.expected, sourceSHA256: "0".repeat(64) }, bridge)).toThrow();
  expect(() => prepareCopiedUpgrade(f.bytes, f.manifest, { ...f.expected, manifestSHA256: "0".repeat(64) }, bridge)).toThrow();
  expect(await f.base.harness.snapshot(LegacyTreeImportManifest, f.base.root.id, context)).toEqual(before);
}));
