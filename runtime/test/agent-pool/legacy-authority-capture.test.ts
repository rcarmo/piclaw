import { afterEach, expect, spyOn, test } from "bun:test";
import Database from "bun:sqlite";
import { SessionManager, buildSessionContext, convertToLlm, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDatabase, getDb } from "../../src/db/connection.js";
import { acquireRuntimeLock } from "../../src/runtime/single-instance.js";
import { AgentQueue } from "../../src/queue.js";
import { AgentPool } from "../../src/agent-pool.js";
import { AgentSessionManager } from "../../src/agent-pool/session-manager.js";
import type { PoolEntry } from "../../src/agent-pool/session-manager.js";
import { captureResidentLegacyUpgradeBindings } from "../../src/agent-pool/legacy-authority-capture.js";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function fixture(externalAlias = false, persistedBaseline = false) {
  initDatabase();
  const dir = mkdtempSync(join(tmpdir(), "resident-capture-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const root = Database.deserialize(getDb().serialize());
  cleanup.push(() => root.close());
  root.exec("DELETE FROM messages; DELETE FROM chat_branches; DELETE FROM chats;");
  const legacySessionRoot = join(dir, "legacy"); mkdirSync(legacySessionRoot);
  for (const id of ["a", "b"]) {
    root.query("INSERT INTO chats(jid) VALUES (?)").run(id);
    root.query("INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,agent_name,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(`branch-${id}`, id, id, id, "2026-01-01", "2026-01-01");
    mkdirSync(join(legacySessionRoot, id));
  }
  const time = "2026-01-01T00:00:00.000Z", file = join(legacySessionRoot, "a", "selected.jsonl");
  const records = [{ type: "session", version: 3, id: "original", timestamp: time, cwd: dir },
    { type: "message", id: "base", parentId: null, timestamp: time, message: { role: "user", content: "base", timestamp: 1 } },
    ...["left", "right"].map(id => ({ type: "message", id, parentId: "base", timestamp: time,
      message: { role: "user", content: id, timestamp: 2 } }))];
  let leaves = ["left", "right"];
  if (persistedBaseline) {
    // Fixture creation ONLY. Capture must never invent or persist this baseline.
    const original = SessionManager.inMemory(dir, { id: "original" });
    original.appendMessage({ role: "system", content: "exact resident dynamic tools baseline", timestamp: 1 });
    const base = original.appendMessage({ role: "user", content: "base", timestamp: 2 });
    const answer = () => original.appendMessage({ role: "assistant", api: "openai-completions", provider: "never", model: "never",
      content: [{ type: "text", text: "historical" }], stopReason: "stop", timestamp: 3,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const left = answer(); original.branch(base); leaves = [left, answer()];
    writeFileSync(file, [original.getHeader(), ...original.getEntries()].map(record => JSON.stringify(record)).join("\n") + "\n");
  } else writeFileSync(file, records.map(record => JSON.stringify(record)).join("\n") + "\n");
  symlinkSync(file, join(legacySessionRoot, "b", "shared.jsonl"));
  // Deliberately newer, NOT the selected session. Capture must not continueRecent.
  writeFileSync(join(legacySessionRoot, "a", "newer.jsonl"), records.map((record, i) => JSON.stringify(i ? record : { ...record, id: "newer" })).join("\n"));
  const alias = join(dir, "external-resident.jsonl"), other = join(dir, "outside.jsonl");
  if (externalAlias) symlinkSync(file, alias);
  const managers = [SessionManager.open(externalAlias ? alias : file), SessionManager.open(file)];
  managers[0]!.branch(leaves[0]!); managers[1]!.branch(leaves[1]!);
  let baseline = "exact resident dynamic tools baseline";
  const pool = new Map<string, PoolEntry>(managers.map((sessionManager, i) => {
    const session = { sessionManager, get systemPrompt() { return baseline; },
      get messages() { return sessionManager.buildSessionContext().messages; },
      isStreaming: false, isCompacting: false, isRetrying: false, isBashRunning: false,
      hasPendingBashMessages: false, pendingMessageCount: 0 };
    return [i ? "b" : "a", { runtime: { session } as unknown as AgentSessionRuntime, lastUsed: 0 }];
  }));
  const owner = acquireRuntimeLock({ lockPath: join(dir, "owner.lock"), strictOwnership: true });
  cleanup.push(() => owner.release());
  const queue = new AgentQueue();
  let sealed = true;
  const options = { root, legacySessionRoot, owner, queue, coordinator: {
    assertSealedAndDrained() { if (!sealed) throw Error("admission open"); }, migrationIncarnation() { return "trusted-cutover-scope"; },
  } };
  const lifecycle = new AgentSessionManager({ pool, sidePool: new Map() } as ConstructorParameters<typeof AgentSessionManager>[0]);
  const capture = () => AgentPool.prototype.captureLegacyUpgradeBindings.call({ pool, sessionManager: lifecycle } as unknown as AgentPool, options);
  return { root, file, pool, options, queue, managers, capture, retarget() {
    writeFileSync(other, readFileSync(file)); unlinkSync(alias); symlinkSync(other, alias);
  }, changeBaseline() { baseline += " changed"; }, unseal() { sealed = false; } };
}

test("existing pool captures exact resident selection, baseline and new migration scope without any SDK open/write", async () => {
  const f = fixture(), before = f.root.serialize(), bytes = readFileSync(f.file);
  const open = spyOn(SessionManager, "open").mockImplementation(() => { throw Error("must not open"); });
  const recent = spyOn(SessionManager, "continueRecent").mockImplementation(() => { throw Error("must not select"); });
  const create = spyOn(SessionManager, "create").mockImplementation(() => { throw Error("must not construct"); });
  cleanup.push(() => { open.mockRestore(); recent.mockRestore(); create.mockRestore(); });
  const capture = await f.capture();
  expect(capture.inputs).toHaveLength(1);
  expect(capture.unselectedSourcePaths).toHaveLength(1);
  expect(capture.inputs[0]!.sourceJSONL).toBe(bytes.toString());
  const manifest = JSON.parse(capture.inputs[0]!.manifestJSON);
  expect(manifest.hostBranchBindings.left.hostBaseline).toBe("exact resident dynamic tools baseline");
  expect(manifest.hostBranchBindings.left.chatIncarnation).toBe("trusted-cutover-scope");
  expect(capture.legacyIncarnation).toBeNull();
  expect(capture.identities.map(identity => identity.selectedLeafId)).toEqual(["left", "right"]);
  expect(capture.identities.every(identity => identity.originalSessionId === "original")).toBe(true);
  expect(Object.isFrozen(capture.inputs[0])).toBe(true);
  capture.revalidate();
  expect(f.root.serialize()).toEqual(before); expect(readFileSync(f.file)).toEqual(bytes);
  expect(open).not.toHaveBeenCalled(); expect(recent).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
});

test("missing resident authority, non-strict owner, unsealed admission and actual queued work fail closed", async () => {
  const f = fixture(); f.pool.delete("b");
  await expect(f.capture()).rejects.toThrow("Missing resident legacy authority");
  const g = fixture(); g.unseal(); await expect(g.capture()).rejects.toThrow("admission open");
  const h = fixture(); h.queue.enqueue(async () => {});
  await expect(h.capture()).rejects.toThrow("queue has not drained");
  const k = fixture();
  await expect(captureResidentLegacyUpgradeBindings({ ...k.options, owner: { ...k.options.owner, strictOwnership: false } }, k.pool, () => {}))
    .rejects.toThrow("Strict runtime owner required");
});

test("returned revalidator rejects later authority replacement and public context divergence", async () => {
  const f = fixture(), result = await f.capture();
  f.pool.set("a", { ...f.pool.get("a")! });
  expect(result.revalidate).toThrow("authority replaced");
  const g = fixture();
  Object.defineProperty(g.pool.get("a")!.runtime.session, "messages", { get() { return []; } });
  await expect(g.capture()).rejects.toThrow("model context differs");
});

test("memory-only manager and active legacy compaction fail closed", async () => {
  const f = fixture();
  Object.assign(f.pool.get("a")!.runtime.session, { sessionManager: SessionManager.inMemory() });
  await expect(f.capture()).rejects.toThrow("Missing file-backed legacy authority");
  const g = fixture(); Object.assign(g.pool.get("a")!.runtime.session, { isCompacting: true });
  await expect(g.capture()).rejects.toThrow("pool lifecycle/agent work has not drained");
});

for (const later of [false, true]) {
  test(`external resident alias retarget ${later ? "after capture" : "during filesystem await"} rejects with original source unchanged`, async () => {
    const f = fixture(true), bytes = readFileSync(f.file), before = f.root.serialize();
    expect(f.managers[0]!.getSessionFile()).not.toBe(f.file); // Actual public SDK retains alias.
    const pending = f.capture();
    if (later) {
      const captured = await pending;
      captured.revalidate();
      f.retarget();
      expect(captured.revalidate).toThrow("Resident source canonical target changed");
    } else {
      f.retarget();
      await expect(pending).rejects.toThrow("Resident source canonical target changed");
    }
    expect(readFileSync(f.file)).toEqual(bytes);
    expect(f.root.serialize()).toEqual(before);
  });
}

const hasDurableEngine = existsSync(new URL("../../durable-engine/node_modules/@earendil-works/pi-durable/package.json", import.meta.url));
if (process.env.PICLAW_REQUIRE_DURABLE_ENGINE === "1") {
  test("resident capture requires the installed application durable engine", () => expect(hasDurableEngine).toBe(true));
}
for (const persisted of [false, true]) {
  test.skipIf(!hasDurableEngine)(`capture feeds actual copied application preparation: ${persisted ? "persisted original baseline prepares" : "current-only baseline is rejected"}`, async () => {
    const f = fixture(false, persisted), bytes = readFileSync(f.file), before = f.root.serialize();
    const captured = await f.capture(), input = captured.inputs[0]!;
    const { prepareCopiedApplicationUpgrade } = await import("../../durable-engine/src/copied-upgrade.js");
    const prepare = () => prepareCopiedApplicationUpgrade(Buffer.from(input.sourceJSONL), Buffer.from(input.manifestJSON), input.expected,
      (entries, leaf) => JSON.parse(JSON.stringify({
        messages: convertToLlm(buildSessionContext([...entries], leaf).messages),
        projected: entries.map(entry => ({ sourceEntryId: entry.id, messages: convertToLlm(sessionEntryToContextMessages(entry)) })),
      })));
    if (persisted) {
      const plan = prepare();
      plan.assertApplicationBranches(f.root);
      plan.assertApplicationScope(captured.migrationIncarnation, "original");
      expect(plan.sourceSHA256).toBe(input.expected.sourceSHA256);
    } else expect(prepare).toThrow("missing/mismatched persisted host baseline");
    captured.revalidate();
    expect(readFileSync(f.file)).toEqual(bytes);
    expect(f.root.serialize()).toEqual(before);
  });
}

for (const change of ["leaf", "baseline", "root", "fence", "pending", "source"] as const) {
  test(`rejects ${change} change during filesystem await without persistence`, async () => {
    const f = fixture();
    const pending = f.capture();
    if (change === "leaf") f.managers[0]!.branch("right");
    if (change === "baseline") f.changeBaseline();
    if (change === "root") f.root.query("UPDATE chats SET name='changed' WHERE jid='a'").run();
    if (change === "fence") f.unseal();
    if (change === "pending") Object.assign(f.pool.get("a")!.runtime.session, { pendingMessageCount: 1 });
    if (change === "source") writeFileSync(f.file, readFileSync(f.file, "utf8") + "\n");
    await expect(pending).rejects.toThrow();
  });
}
