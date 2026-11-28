import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { Harness, UserEntry, createRegistry, defineEntry } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { BunSqliteDatabase } from "../src/bun-sqlite.ts";
import { reclaimOfflineSdkHistory } from "../src/offline-sdk-history-reclaim.ts";

const removedText = "remove this transcript\n".repeat(16_384);
const retainedText = "retain this transcript exactly";
function sha(path: string) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
async function fixture(mode: 'history' | 'done' | 'placed' = 'history') {
  const dir = mkdtempSync(join(tmpdir(), "offline-sdk-reclaim-")); chmodSync(dir, 0o700);
  const source = join(dir, "source.sqlite"), adapter = new BunSqliteDatabase(source, undefined, { create: true, checkpoint: "builtin" });
  const storage = await SqliteStorage.open(adapter);
  const models = createModels(), faux = fauxProvider({ tokensPerSecond: 100_000 });
  models.setProvider(faux.provider);
  const harness = await Harness.open(storage, { registry: createRegistry(), models }, context);
  // Avoid deliberately conservative collisions with small scalar values (for example document versions).
  for (let i = 0; i < 32; i++) await storage.mintId();
  const target = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
  const survivor = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
  const created = await harness.commit(async tx => ({
    removed: await tx.appendEntry(UserEntry, target.id, { model: [{ role: "user", content: removedText, timestamp: 0 }] }),
    retained: await tx.appendEntry(UserEntry, survivor.id, { model: [{ role: "user", content: retainedText, timestamp: 0 }] }),
  }), context);
  if (mode !== 'history') {
    await target.configure({ model: { provider: 'faux', modelId: 'faux-1' } }, context);
    faux.setResponses([fauxAssistantMessage('completed synthetic reply')]);
    const submission = await target.submit({ type: 'input', content: 'erase submitted material' }, context);
    if (mode === 'done') {
      harness.resume();
      expect((await submission.wait(context)).status).toBe('done');
    } else {
      expect((await submission.status(context)).status).toBe('placed');
    }
  }
  await harness.close(context); chmodSync(source, 0o600);
  return { dir, source, target: target.id, survivor: survivor.id, created };
}

test("offline SDK-only reclaim emits a compact verified sibling and retains survivor contents", async () => {
  const f = await fixture(), output = join(f.dir, "output.sqlite");
  try {
    const before = await Bun.file(f.source).arrayBuffer(), digest = sha(f.source);
    const result = await reclaimOfflineSdkHistory({ sourcePath: f.source, expectedSourceSha256: digest, outputPath: output, conversationId: f.target });
    expect(result.removed).toEqual({ conversations: 1, entries: 1, tasks: 0, submissions: 0, documents: 5, document_revisions: 5 });
    expect(result.sourceSha256).toBe(digest);
    expect(result.outputSha256).toBe(sha(output));
    expect(result.publication).toBe('durable');
    expect(result.warnings).toEqual([]);
    expect(sha(f.source)).toBe(digest);
    const db = new Database(output, { readonly: true, safeIntegers: true });
    try {
      expect(db.query("SELECT 1 FROM conversations WHERE id=?").get(f.target)).toBeNull();
      expect(JSON.parse((db.query("SELECT record FROM entries WHERE id=?").get(f.created.retained.id) as { record: string }).record).model[0].content)
        .toBe(retainedText);
      using original = new Database(f.source, { readonly: true, safeIntegers: true });
      expect(db.query("SELECT next_id,next_seq FROM durable_metadata").get()).toEqual(original.query("SELECT next_id,next_seq FROM durable_metadata").get());
      expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally { db.close(); }
    expect(Buffer.from(before)).toEqual(Buffer.from(await Bun.file(f.source).arrayBuffer()));
    expect(result.outputBytes).toBeLessThan(before.byteLength);
    expect(readFileSync(output).includes('remove this transcript')).toBe(false);
    const reopen = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(output)), { registry: createRegistry(), models: createModels() }, context);
    try {
      expect((await reopen.inspect(context)).scheduling).toBe("paused");
      expect(await reopen.conversation(f.target, context)).toBeUndefined();
      const survivor = await reopen.conversation(f.survivor, context);
      expect((await survivor!.context(context)).messages).toContainEqual({ role: 'user', content: retainedText, timestamp: 0 });
    } finally { await reopen.close(context); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
}, 15_000);

test("offline reclaim refuses forks, wrong digests, unknown schemas, and occupied final names", async () => {
  const f = await fixture();
  try {
    const forkDb = new BunSqliteDatabase(f.source, undefined, { create: false, checkpoint: "builtin" });
    const forkHarness = await Harness.open(await SqliteStorage.open(forkDb), { registry: createRegistry(), models: createModels() }, context);
    const target = await forkHarness.conversation(f.target, context);
    await target!.fork(f.created.removed.id, { ownership: { kind: "ownerless" } }, context);
    await forkHarness.close(context);
    const digest = sha(f.source), output = join(f.dir, "output.sqlite");
    await expect(reclaimOfflineSdkHistory({ sourcePath: f.source, expectedSourceSha256: "0".repeat(64), outputPath: output, conversationId: f.target }))
      .rejects.toThrow("SHA-256");
    await expect(reclaimOfflineSdkHistory({ sourcePath: f.source, expectedSourceSha256: digest, outputPath: output, conversationId: f.target }))
      .rejects.toThrow("surviving fork");
    expect(existsSync(output)).toBe(false);
    expect(sha(f.source)).toBe(digest);
    await Bun.write(output, "occupied"); chmodSync(output, 0o600);
    await expect(reclaimOfflineSdkHistory({ sourcePath: f.source, expectedSourceSha256: digest, outputPath: output, conversationId: f.target }))
      .rejects.toThrow("already exists");
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
}, 15_000);

test("offline reclaim refuses Piclaw or other schema additions", async () => {
  const f = await fixture(), output = join(f.dir, "output.sqlite");
  try {
    const db = new Database(f.source); db.exec("CREATE TABLE piclaw_extra(value TEXT)"); db.close();
    await expect(reclaimOfflineSdkHistory({ sourcePath: f.source, expectedSourceSha256: sha(f.source), outputPath: output, conversationId: f.target }))
      .rejects.toThrow("exact unprefixed");
    expect(existsSync(output)).toBe(false);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
}, 15_000);

test('closed SDK copy loses terminal task and submission history along with the transcript', async () => {
  const f = await fixture('done'), output = join(f.dir, 'output.sqlite');
  try {
    const result = await reclaimOfflineSdkHistory({ sourcePath: f.source, expectedSourceSha256: sha(f.source), outputPath: output, conversationId: f.target });
    expect(result.removed.tasks).toBeGreaterThan(0);
    expect(result.removed.submissions).toBe(1);
    const bytes = readFileSync(output);
    expect(bytes.includes('erase submitted material')).toBe(false);
    expect(bytes.includes('completed synthetic reply')).toBe(false);
    expect(bytes.includes(retainedText)).toBe(true);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
}, 15_000);

test('offline reclaim refuses unsettled SDK work and leaves the input byte-identical', async () => {
  const f = await fixture('placed'), output = join(f.dir, 'output.sqlite');
  try {
    const digest = sha(f.source);
    await expect(reclaimOfflineSdkHistory({ sourcePath: f.source, expectedSourceSha256: digest, outputPath: output, conversationId: f.target }))
      .rejects.toThrow('nonterminal');
    expect(sha(f.source)).toBe(digest);
    expect(existsSync(output)).toBe(false);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
}, 15_000);

test('offline reclaim rejects dangling SQLite sidecars before opening a database', async () => {
  const f = await fixture(), output = join(f.dir, 'output.sqlite');
  try {
    const digest = sha(f.source);
    symlinkSync(join(f.dir, 'absent'), f.source + '-wal');
    await expect(reclaimOfflineSdkHistory({ sourcePath: f.source, expectedSourceSha256: digest, outputPath: output, conversationId: f.target }))
      .rejects.toThrow('SQLite sidecar');
    expect(sha(f.source)).toBe(digest);
    expect(existsSync(output)).toBe(false);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
}, 15_000);

test('offline reclaim cannot publish using a SQLite sidecar name', async () => {
  const f = await fixture(), output = f.source + '-wal';
  try {
    const digest = sha(f.source);
    await expect(reclaimOfflineSdkHistory({ sourcePath: f.source, expectedSourceSha256: digest, outputPath: output, conversationId: f.target }))
      .rejects.toThrow('Reserved SQLite sidecar filename');
    expect(existsSync(output)).toBe(false);
    expect(sha(f.source)).toBe(digest);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
}, 15_000);

test('offline reclaim refuses the real path of an aliased runtime profile', async () => {
  const f = await fixture(), output = join(f.dir, 'output.sqlite');
  const alias = f.dir + '-profile-alias';
  const previous = process.env.PICLAW_STORE;
  try {
    const digest = sha(f.source);
    symlinkSync(f.dir, alias);
    process.env.PICLAW_STORE = alias;
    await expect(reclaimOfflineSdkHistory({ sourcePath: f.source, expectedSourceSha256: digest, outputPath: output, conversationId: f.target }))
      .rejects.toThrow('outside runtime profiles');
    expect(existsSync(output)).toBe(false);
    expect(sha(f.source)).toBe(digest);
  } finally {
    if (previous === undefined) delete process.env.PICLAW_STORE; else process.env.PICLAW_STORE = previous;
    rmSync(alias, { force: true }); rmSync(f.dir, { recursive: true, force: true });
  }
}, 15_000);

test('directory sync failure after publication reports the linked copy and its unconfirmed durability', async () => {
  const f = await fixture(), output = join(f.dir, 'output.sqlite');
  const fsync = fs.fsyncSync;
  const fault = spyOn(fs, 'fsyncSync').mockImplementation(fd => {
    if (fs.fstatSync(fd).isDirectory()) throw Error('fixture directory fsync failure');
    fsync(fd);
  });
  try {
    const digest = sha(f.source);
    const receipt = await reclaimOfflineSdkHistory({ sourcePath: f.source, expectedSourceSha256: digest, outputPath: output, conversationId: f.target });
    expect(receipt.publication).toBe('linked-durability-unconfirmed');
    expect(receipt.warnings).toEqual(['directory-sync-failed']);
    expect(receipt.outputSha256).toBe(sha(output));
    expect(sha(f.source)).toBe(digest);
  } finally { fault.mockRestore(); rmSync(f.dir, { recursive: true, force: true }); }
}, 15_000);

for (const kind of ['exact reference', 'unknown extension entry'] as const) test(`offline reclaim refuses ${kind} in surviving history`, async () => {
  const f = await fixture(), output = join(f.dir, 'output.sqlite');
  try {
    const harness = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(f.source, undefined, { checkpoint: 'builtin' })),
      { registry: createRegistry(), models: createModels() }, context);
    try {
      await harness.commit(async tx => {
        if (kind === 'exact reference') {
          await tx.appendEntry(UserEntry, f.survivor, { model: [{ role: 'user', content: String(f.target), timestamp: 0 }] });
        } else {
          await tx.appendEntry(defineEntry<{ names: string[] }>('fixture.extension'), f.survivor, { data: { names: ['might own hidden references'] } });
        }
      }, context);
    } finally { await harness.close(context); }
    const digest = sha(f.source);
    await expect(reclaimOfflineSdkHistory({ sourcePath: f.source, expectedSourceSha256: digest, outputPath: output, conversationId: f.target }))
      .rejects.toThrow(kind === 'exact reference' ? 'Ambiguous surviving JSON reference' : 'Unknown surviving SDK history kind');
    expect(sha(f.source)).toBe(digest);
    expect(existsSync(output)).toBe(false);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
}, 15_000);

test('error after staged deletes publishes nothing and leaves the original intact', async () => {
  const f = await fixture(), output = join(f.dir, 'output.sqlite');
  const originalQuery = Database.prototype.query;
  const fault = spyOn(Database.prototype, 'query').mockImplementation(function (this: Database, sql: string) {
    if (sql.startsWith('DELETE FROM entries ')) throw Error('fixture write interrupted after document deletion');
    return originalQuery.call(this, sql);
  } as typeof Database.prototype.query);
  try {
    const digest = sha(f.source);
    await expect(reclaimOfflineSdkHistory({ sourcePath: f.source, expectedSourceSha256: digest, outputPath: output, conversationId: f.target }))
      .rejects.toThrow('fixture write interrupted');
    expect(sha(f.source)).toBe(digest);
    expect(fs.readdirSync(f.dir)).toEqual(['source.sqlite']);
  } finally { fault.mockRestore(); rmSync(f.dir, { recursive: true, force: true }); }
}, 15_000);

test('offline reclaim CLI emits a digest and committed copy', async () => {
  const f = await fixture(), output = join(f.dir, 'output.sqlite');
  try {
    const cli = new URL('../../scripts/reclaim-offline-sdk-history.ts', import.meta.url).pathname;
    const child = Bun.spawn([process.execPath, cli, '--source', f.source, '--output', output,
      '--conversation-id', String(f.target), '--expected-sha256', sha(f.source)], { stdout: 'pipe', stderr: 'pipe' });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, stderr).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ publication: 'durable', outputSha256: sha(output), conversationId: f.target });
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
}, 15_000);
