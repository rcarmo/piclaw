import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, readFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager, buildSessionContext, convertToLlm, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import type { ConversationId } from "../../runtime/durable-engine/qualification/durable.ts";
import { TestOwner, OwnedSqlite } from "./src/ownership.js";
import { barrier, context, openFixture } from "./src/fixture.js";
import { importCopiedLegacyTree, LegacyTreeImportManifest, DEFAULT_TREE_IMPORT_LIMITS, type GetLegacyContext } from "../../runtime/durable-engine/src/index.js";
import { HostCutoverController, initializeCutoverManifest, initializeHostDurableBindings, type Manifest, type Receipt } from "../../runtime/durable-engine/src/index.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const bridge: GetLegacyContext = (entries, leaf) => ({
  messages: json(convertToLlm(buildSessionContext([...entries], leaf).messages)),
  projected: entries.map(entry => ({ sourceEntryId: entry.id, messages: json(convertToLlm(sessionEntryToContextMessages(entry))) })),
});
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup();
  try { await run(f); } finally { await f.base.close(); f.owner.releaseAfterClose(); f.db.close(); f.owner.closeConnection(); await rm(f.dir, { recursive: true, force: true }); }
}
async function setup() {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "cutover-")), path = join(dir, "host.sqlite");
  const owner = TestOwner.acquire(path), db = new Database(path, { strict: true });
  db.exec("PRAGMA foreign_keys=ON"); initializeCutoverManifest(db);
  owner.assert(); installTerminalSettlementCompositionSchema(db); initializeHostDurableBindings(db, () => owner.assert());
  db.exec("CREATE TABLE fixture_accepted (operation_id TEXT PRIMARY KEY, writer TEXT NOT NULL, state TEXT NOT NULL)");
  const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new OwnedSqlite(owner)));
  const manager = SessionManager.inMemory(dir, { id: "copied-session" });
  manager.appendMessage({ role: "system", content: "baseline", timestamp: 0 });
  manager.appendMessage({ role: "user", content: "shared", timestamp: 1 });
  const anchor = manager.getLeafId()!;
  manager.appendMessage({ role: "user", content: "left", timestamp: 2 }); const left = manager.getLeafId()!;
  manager.branch(anchor); manager.appendMessage({ role: "user", content: "right", timestamp: 3 }); const right = manager.getLeafId()!;
  const sourceJSONL = [manager.getHeader(), ...manager.getEntries()].map(x => JSON.stringify(x)).join("\n") + "\n";
  const original = join(dir, "original.jsonl"), copied = join(dir, "copied.jsonl"); await writeFile(original, sourceJSONL);
  const bindings = Object.fromEntries([left, right].map((leaf, i) => [leaf, { chatJid: "web:existing", chatIncarnation: "chat-A", branchId: `existing-${i}`, hostBaseline: "" }]));
  // Importer requires a nonempty caller-validated baseline.
  for (const binding of Object.values(bindings)) binding.hostBaseline = "baseline";
  const plannedBranches = [left, right].sort().map(sourceLeafId => ({ sourceLeafId, ...bindings[sourceLeafId]! }));
  const sourceDigest = sha(sourceJSONL), importHash = sha(JSON.stringify({ importerVersion: 1, sourceJSONL, plannedBranches, ...DEFAULT_TREE_IMPORT_LIMITS }));
  const request = { requestKey: "cutover:one", sourceDigest, importHash };
  const identity = { domain: "fixture-domain", incarnation: "host-A", ownerGeneration: owner.token.generation, sourceEngineId: "legacy", candidateStoreRef: "candidate:one" };
  let currentDigest = sourceDigest;
  let onDrain: (() => void) | undefined;
  const expectedIdentity = { ...identity };
  const ports = {
    assertOwner(id: typeof identity) { owner.assert(); if (id.incarnation !== "host-A" || id.ownerGeneration !== owner.token.generation || id.domain !== expectedIdentity.domain) throw Error("secret owner"); },
    assertCurrentWriter(writer: string) {
      const row = db.query("SELECT manifest FROM qualification_cutover_v1").get() as { manifest: string } | null;
      if (writer !== (row ? JSON.parse(row.manifest).writer : "legacy")) throw Error("secret writer");
    },
    checkDrained() {
      onDrain?.();
      const count = (state: string) => (db.query("SELECT COUNT(*) AS n FROM fixture_accepted WHERE writer='legacy' AND state=?").get(state) as { n: number }).n;
      return { sourceDigest: currentDigest, pending: count("pending"), inflight: count("inflight") };
    },
  };
  const controller = new HostCutoverController(db, identity, ports);
  const receipt: Receipt = { sourceDigest, receiptHash: importHash };
  const preparation = {
    async copy() { expect(sha(await readFile(original, "utf8"))).toBe(sourceDigest); await copyFile(original, copied); expect(sha(await readFile(copied, "utf8"))).toBe(sourceDigest); return receipt; },
    async importCopied() {
      const binding = await importCopiedLegacyTree(base.root, { sourceJSONL: await readFile(copied, "utf8"), hostBranchBindings: bindings }, bridge, () => owner.assert(), context);
      expect(binding.sourceHash).toBe(importHash); return { sourceDigest, receiptHash: binding.sourceHash };
    },
  };
  async function verifier() {
    const binding = (await base.harness.snapshot(LegacyTreeImportManifest, base.root.id, context))!.binding!;
    expect(binding.branches).toHaveLength(2);
    for (const branch of binding.branches) {
      expect(branch.chatJid).toBe("web:existing"); expect(branch.chatIncarnation).toBe("chat-A");
      const conversation = (await base.harness.conversation(branch.engineConversationId as ConversationId, context))!;
      expect((await conversation.context(context)).messages).toEqual(json(convertToLlm(buildSessionContext(manager.getEntries(), branch.sourceLeafId).messages)));
      expect(branch.entries.map(e => e.sourceEntryId)).toEqual(manager.getBranch(branch.sourceLeafId).map(e => e.id));
    }
    expect(await base.harness.inspect(context)).toEqual({ scheduling: "paused", tasks: [], submissions: [] });
    expect(base.host.effects + base.host.modelCalls + base.host.credentialLookups).toBe(0);
    expect(await readFile(original, "utf8")).toBe(sourceJSONL); return receipt;
  }
  function accept(writer: string, operationId: string, state = "pending") {
    return db.transaction(() => {
      owner.assert(); ports.assertCurrentWriter(writer);
      db.query("INSERT INTO fixture_accepted VALUES (?,?,?)").run(operationId, writer, state);
      if (writer === "candidate:one") controller.recordPostCutoverWork(controller.inspect()!.revision, { operationId, contentHash: sha(operationId) });
    }).immediate();
  }
  async function ready() { const m = controller.preflight(request); const copied = await controller.begin(m.revision, preparation); return controller.verify(copied.revision, verifier); }
  return { dir, db, base, owner, controller, request, identity, ports, preparation, verifier, receipt, ready, accept, setDigest: (d: string) => { currentDigest = d; }, setDrainHook: (hook: () => void) => { onDrain = hook; } };
}

test("cutover: real public JSONL tree import remains offline; explicit flip fences source; rollback before new work", () => fixture(async f => {
  expect(f.db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(f.controller.inspect()).toBeNull(); const verified = await f.ready();
  expect(verified.phase).toBe("verified"); expect(verified.writer).toBe("legacy");
  expect(() => f.accept("candidate:one", "too-early")).toThrow();
  const active = f.controller.commitWriter(verified.revision); expect(active.phase).toBe("active");
  expect(() => f.accept("legacy", "late-source")).toThrow();
  expect(f.controller.rollback(active.revision).writer).toBe("legacy");
  await f.verifier();
}));
test("cutover: intent survives lost acknowledgement after importer commit; retry and reopened controller have no duplicate branches", () => fixture(async f => {
  const m = f.controller.preflight(f.request);
  await expect(f.controller.begin(m.revision, { ...f.preparation, async importCopied() { await f.preparation.importCopied(); throw Error("secret token /auth/path"); } })).rejects.toThrow(/^Cutover rejected$/);
  expect(f.controller.inspect()!.phase).toBe("copying"); expect(f.controller.inspect()!.receipt).toBeNull();
  const other = new HostCutoverController(f.db, f.identity, f.ports);
  const retried = await other.begin(other.inspect()!.revision, f.preparation);
  await other.verify(retried.revision, f.verifier);
  expect((await f.base.root.commit(tx => tx.scanConversations({}, 100), context)).items).toHaveLength(2);
}));
test("cutover: detached request, identity and callbacks survive mutation across await", () => fixture(async f => {
  const entered = barrier(), held = barrier(), original = { ...f.request };
  const m = f.controller.preflight(f.request);
  const prep = { ...f.preparation, async copy() { entered.release(); await held.promise; return f.preparation.copy(); } };
  const pending = f.controller.begin(m.revision, prep); await entered.promise;
  f.request.sourceDigest = "f".repeat(64); f.identity.incarnation = "rogue";
  prep.importCopied = async () => { throw Error("mutated callback"); };
  held.release(); const done = await pending;
  expect(done.request).toEqual(original); expect(done.receipt).toEqual(f.receipt);
}));
test("cutover: pending/inflight admission blocks preflight and final flip; source digest revalidated in SQL TX", () => fixture(async f => {
  f.accept("legacy", "pending"); expect(() => f.controller.preflight(f.request)).toThrow(/^Cutover rejected$/);
  f.db.exec("UPDATE fixture_accepted SET state='inflight'"); expect(() => f.controller.preflight(f.request)).toThrow();
  f.db.exec("UPDATE fixture_accepted SET state='done'"); const m = await f.ready();
  f.accept("legacy", "late"); expect(() => f.controller.commitWriter(m.revision)).toThrow();
  f.db.exec("UPDATE fixture_accepted SET state='done'"); f.setDigest("a".repeat(64)); expect(() => f.controller.commitWriter(m.revision)).toThrow();
  f.setDigest(f.request.sourceDigest); expect(f.controller.commitWriter(m.revision).writer).toBe("candidate:one");
}));
test("cutover: new accepted work is durable, deduplicated, preserved and blocks rollback without reverse conversion", () => fixture(async f => {
  const m = await f.ready(); f.controller.commitWriter(m.revision); f.accept("candidate:one", "actual-operation");
  let active = f.controller.inspect()!;
  active = f.controller.recordPostCutoverWork(active.revision, { operationId: "actual-operation", contentHash: sha("actual-operation") });
  expect(active.postCutoverCount).toBe(1);
  expect(() => f.controller.recordPostCutoverWork(active.revision, { operationId: "actual-operation", contentHash: sha("changed") })).toThrow();
  expect(() => f.controller.rollback(active.revision)).toThrow("Reconciliation required");
  expect(f.controller.inspect()!.writer).toBe("candidate:one"); expect(f.controller.inspect()).toEqual(active);
  expect((f.db.query("SELECT COUNT(*) AS n FROM fixture_accepted").get() as { n: number }).n).toBe(1);
  expect((f.db.query("SELECT COUNT(*) AS n FROM qualification_cutover_work_v1").get() as { n: number }).n).toBe(1);
}));
test("cutover: rollback preflight pins actual original snapshot and final SQL switch rechecks it", () => fixture(async f => {
  const verified = await f.ready(), active = f.controller.commitWriter(verified.revision);
  const journal = f.controller.inspect();
  const plan = f.controller.prepareRollback(active.revision);
  expect(plan.disposition).toBe("safe_to_restore");
  expect(plan.checkpointDigest).toBe(plan.currentDigest);
  expect(f.controller.inspect()).toEqual(journal);
  f.setDigest("f".repeat(64));
  expect(f.controller.prepareRollback(active.revision).reasons).toEqual(["source_changed"]);
  expect(() => f.controller.rollback(active.revision)).toThrow("Reconciliation required");
  expect(f.controller.inspect()).toEqual(journal);
  f.setDigest(f.request.sourceDigest);
  // Drift after the advisory plan and initial body checks, at the final SQL fence.
  let calls = 0;
  f.setDrainHook(() => { if (++calls === 4) f.setDigest("a".repeat(64)); });
  expect(() => f.controller.rollback(active.revision)).toThrow("Cutover rejected");
  expect(f.controller.inspect()).toEqual(journal);
  f.setDrainHook(() => {}); f.setDigest(f.request.sourceDigest);
  expect(f.controller.rollback(active.revision).writer).toBe("legacy");
}));

test("cutover: old/missing actual-host checkpoint cannot authorize active rollback", () => fixture(async f => {
  const verified = await f.ready();
  f.db.exec("DROP TABLE piclaw_durable_intent_bindings_v1");
  const active = f.controller.commitWriter(verified.revision);
  expect(active.rollbackCheckpoint).toBeNull();
  const reopened = new HostCutoverController(f.db, f.identity, f.ports);
  expect(reopened.prepareRollback(active.revision).reasons).toContain("checkpoint_unavailable");
  expect(() => reopened.rollback(active.revision)).toThrow("Reconciliation required");
  expect(reopened.inspect()).toEqual(active);
}));

test("cutover: competing revision, changed request and exact owner fail closed with sanitized errors", () => fixture(async f => {
  const m = f.controller.preflight(f.request); expect(f.controller.preflight(f.request)).toEqual(m);
  expect(() => f.controller.preflight({ ...f.request, importHash: "b".repeat(64) })).toThrow(/^Cutover rejected$/);
  const other = new HostCutoverController(f.db, f.identity, f.ports);
  const pending = f.controller.begin(m.revision, f.preparation);
  await expect(other.begin(m.revision, f.preparation)).rejects.toThrow(/^Cutover rejected$/); await pending;
  const bad = new HostCutoverController(f.db, { ...f.identity, ownerGeneration: f.identity.ownerGeneration + 1 }, f.ports);
  expect(() => bad.preflight(f.request)).toThrow(/^Cutover rejected$/);
  const verified = await f.controller.verify(f.controller.inspect()!.revision, f.verifier);
  const held = barrier(), entered = barrier();
  // Owner loss while awaited verification must deny acknowledgement and writer flip.
  const replay = f.controller.rollback(verified.revision); const copied = await f.controller.begin(replay.revision, f.preparation);
  const verifying = f.controller.verify(copied.revision, async () => { entered.release(); await held.promise; return f.receipt; });
  await entered.promise; f.owner.releaseAfterClose(); held.release();
  await expect(verifying).rejects.toThrow(/^Cutover rejected$/);
  expect(() => f.controller.commitWriter(copied.revision)).toThrow(/^Cutover rejected$/);
  const raw = f.db.query("SELECT manifest FROM qualification_cutover_v1").get() as { manifest: string };
  expect((JSON.parse(raw.manifest) as Manifest).writer).toBe("legacy"); expect(raw.manifest).not.toContain("secret");
}));
