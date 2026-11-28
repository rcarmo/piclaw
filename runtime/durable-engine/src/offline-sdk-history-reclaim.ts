import Database from "bun:sqlite";
import { createHash } from "node:crypto";
import { constants, closeSync, copyFileSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, writeSync, type Stats } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";
import { verifySqliteBackup } from "../../src/db/backup.js";
import { assertPiclawArchiveSchema, erasePiclawArchiveRows, retirePiclawArchiveRoute, verifyPiclawArchiveRows, type PiclawArchiveTarget } from "./offline-piclaw-history-scope.js";

const SIDECARS = ["-wal", "-shm", "-journal"] as const;
const SDK_TABLES = ["conversations", "entries", "tasks", "submissions", "documents", "document_revisions"] as const;
type RemovedCounts = Record<(typeof SDK_TABLES)[number], number>;
type SupportedSdkVersion = "1.6.1" | "1.7.0";
export interface OfflineSdkHistoryReclaimOptions {
  sourcePath: string;
  /** Lower-case SHA-256 of the complete, closed main SQLite file. */
  expectedSourceSha256: string;
  outputPath: string;
  conversationId: number;
  /** Opt into the stricter Piclaw application archive profile. */
  piclawArchive?: Omit<PiclawArchiveTarget, 'conversationId'>;
}
export interface OfflineSdkHistoryReclaimReceipt {
  version: 1;
  kind: "piclaw.offline-sdk-history-reclaim";
  conversationId: number;
  /** SDK used to validate and reopen the output, not the source's creation version. */
  sdkVersion: SupportedSdkVersion;
  sourceSha256: string;
  outputSha256: string;
  outputBytes: number;
  removed: RemovedCounts;
  piclawArchive?: { removedHostRows: Record<string, number> };
  publication: 'durable' | 'linked-durability-unconfirmed';
  warnings: ('directory-sync-failed' | 'post-publication-cleanup-failed')[];
}

function refuse(message: string): never { throw new Error(message); }
function canonicalOfflinePath(path: string) {
  const absolute = resolve(path);
  const active = [process.env.PICLAW_STORE, process.env.PICLAW_DATA, process.env.PICLAW_PI_AGENT_DIR, process.env.PI_CODING_AGENT_DIR]
    .filter((value): value is string => !!value).flatMap(value => {
      const configured = resolve(value);
      try { return [configured, realpathSync(configured)]; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [configured]; throw error; }
    });
  if (absolute === "/workspace" || absolute === resolve(process.env.PICLAW_WORKSPACE ?? "/workspace") ||
      active.some(root => absolute === root || absolute.startsWith(root + sep)) ||
      absolute.split(sep).some(part => part === ".pi" || part === ".piclaw"))
    refuse("Explicit offline copies outside runtime profiles are required");
  if (SIDECARS.some(suffix => basename(absolute).endsWith(suffix))) refuse('Reserved SQLite sidecar filename');
  return absolute;
}
function assertPrivateParent(path: string) {
  const parent = dirname(path), info = lstatSync(parent);
  if (!info.isDirectory() || realpathSync(parent) !== parent || (info.mode & 0o077) !== 0 ||
      (info.mode & 0o700) !== 0o700 || (process.getuid && info.uid !== process.getuid()))
    refuse("A canonical owned private 0700 parent is required");
  return parent;
}
function pathPresent(path: string) {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
function assertNoSidecars(path: string) {
  for (const suffix of SIDECARS) if (pathPresent(path + suffix)) refuse(`SQLite sidecar is not permitted: ${basename(path) + suffix}`);
}
function openBoundSource(path: string) {
  if (realpathSync(path) !== path) refuse("Source symlink is not permitted");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid()))
      refuse("Source must be an owned regular 0600 unique-link file");
    return { fd, identity: info };
  } catch (error) { closeSync(fd); throw error; }
}
function fingerprintFd(fd: number, path: string, identity: Stats, destination?: number) {
  const hash = createHash("sha256"), buffer = Buffer.allocUnsafe(64 * 1024); let bytes = 0, length: number;
  while (bytes < identity.size && (length = readSync(fd, buffer, 0, Math.min(buffer.length, identity.size - bytes), bytes)) > 0) {
    hash.update(buffer.subarray(0, length));
    if (destination !== undefined) for (let offset = 0; offset < length;) {
      const n = writeSync(destination, buffer, offset, length - offset);
      if (!n) refuse("Could not write offline copy");
      offset += n;
    }
    bytes += length;
  }
  const after = fstatSync(fd), named = lstatSync(path);
  if (after.dev !== identity.dev || after.ino !== identity.ino || after.size !== identity.size || after.nlink !== identity.nlink ||
      after.ctimeMs !== identity.ctimeMs || after.mtimeMs !== identity.mtimeMs || bytes !== identity.size || named.dev !== identity.dev || named.ino !== identity.ino)
    refuse("File changed while fingerprinting");
  return { sha256: hash.digest("hex"), bytes };
}
function schemaRowsSql() { return "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name,tbl_name,sql"; }
async function installedContract() {
  const packageUrl = new URL(import.meta.resolve("@earendil-works/pi-durable/package.json"));
  const { name, version: sdkVersion } = JSON.parse(readFileSync(packageUrl, "utf8")) as { name?: unknown; version?: unknown };
  // Temporary offline overlay pending https://github.com/earendil-works/pi/issues/12641.
  // Audit the storage and ownership checks again before accepting a new SDK release.
  // These two releases have byte-identical SQLite storage and migration modules.
  // Use the installed SDK to generate the exact schema rather than guessing from the input.
  if (name !== "@earendil-works/pi-durable" || (sdkVersion !== "1.6.1" && sdkVersion !== "1.7.0"))
    refuse("Installed SDK must be exactly 1.6.1 or 1.7.0");
  const adapter = await openNodeSqliteDatabase(":memory:", { walAutoCheckpointPages: 0 });
  const storage = await SqliteStorage.open(adapter);
  try {
    const schema = await adapter.all<{ type: string; name: string; tbl_name: string; sql: string | null }>(schemaRowsSql()), ledger = await adapter.all("SELECT singleton,version FROM durable_schema ORDER BY singleton,version");
    const applicationId = await adapter.get<{ application_id: number }>("PRAGMA application_id");
    const userVersion = await adapter.get<{ user_version: number }>("PRAGMA user_version");
    return { sdkVersion, schema, ledger, applicationId: applicationId?.application_id, userVersion: userVersion?.user_version } as const;
  } finally { await storage.close(context); }
}
function tableDigest(db: Database, query: string, ...params: number[]) {
  const checksum = createHash("sha256");
  for (const row of db.query(query).iterate(...params)) {
    checksum.update(JSON.stringify(row, (_key, value) => typeof value === "bigint" ? { integer: String(value) } : value));
    checksum.update("\n");
  }
  return checksum.digest("hex");
}
function sameSchema(db: Database, contract: Awaited<ReturnType<typeof installedContract>>, piclaw = false) {
  const rows = db.query<(typeof contract.schema)[number], []>(schemaRowsSql()).all();
  const sdkTables = new Set(contract.schema.filter(row => row.type === 'table').map(row => row.name));
  const schema = piclaw ? rows.filter(row => sdkTables.has(row.tbl_name)) : rows;
  const ledger = (db.query("SELECT singleton,version FROM durable_schema ORDER BY singleton,version").all() as { singleton: bigint; version: bigint }[])
    .map(row => ({ singleton: Number(row.singleton), version: Number(row.version) }));
  const app = db.query("PRAGMA application_id").get() as { application_id: number } | null;
  const user = db.query("PRAGMA user_version").get() as { user_version: number } | null;
  if (JSON.stringify(schema) !== JSON.stringify(contract.schema) || JSON.stringify(ledger) !== JSON.stringify(contract.ledger) ||
      (!piclaw && (Number(app?.application_id) !== contract.applicationId || Number(user?.user_version) !== contract.userVersion)))
    refuse(`Database is not the exact unprefixed SDK ${contract.sdkVersion} SQLite schema and migration ledger`);
}
function count(db: Database, query: string, params: number[] = []) {
  const row = db.query(query).get(...params) as { count: number | bigint } | null;
  return Number(row?.count ?? 0);
}
// A numbered SQL parameter lets every owner selector share the same exact conversation ID.
const ownsDocument = `((scope_kind='conversation' AND owner_id=?1) OR
  (scope_kind='task' AND owner_id IN (SELECT id FROM tasks WHERE conversation_id=?1)))`;
const ownedDocumentIds = `SELECT id FROM documents WHERE ${ownsDocument}`;
const owners = {
  conversations: "id=?1", entries: "conversation_id=?1", tasks: "conversation_id=?1", submissions: "conversation_id=?1",
  documents: ownsDocument, document_revisions: `document_id IN (${ownedDocumentIds})`,
} satisfies Record<keyof RemovedCounts, string>;
const knownEntries = new Set(["pi.user", "pi.assistant", "pi.system", "pi.tool-result", "pi.reset", "pi.compaction"]);
const knownTasks = new Set(["pi.generation", "pi.compaction", "pi.tool"]);
const knownDocuments = new Set(["pi.agent", "pi.inbox", "pi.live", "pi.provider", "pi.usage", "pi.tool.nested-call"]);

const numericToolSchemaConstraints = new Set([
  'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum',
  'maxLength', 'minLength', 'maxItems', 'minItems', 'maxContains', 'minContains',
  'maxProperties', 'minProperties',
]);
function exactJsonIdPath(value: unknown, ids: Set<string>, allowToolSchemaConstraints = false,
  path = '$', segments: (string | number)[] = []): string | undefined {
  if (typeof value === "number") {
    const keyword = segments.at(-1);
    if (allowToolSchemaConstraints && typeof keyword === 'string' && numericToolSchemaConstraints.has(keyword) &&
        segments.length >= 6 && segments[0] === 'model' && typeof segments[1] === 'number' &&
        segments[2] === 'toolsAdded' && typeof segments[3] === 'number' && segments[4] === 'parameters')
      return undefined;
    return Number.isSafeInteger(value) && ids.has(String(value)) ? path : undefined;
  }
  if (typeof value === "string") return ids.has(value) ? path : undefined;
  if (Array.isArray(value)) for (let index = 0; index < value.length; index++) {
    const match = exactJsonIdPath(value[index], ids, allowToolSchemaConstraints, `${path}[${index}]`, [...segments, index]);
    if (match) return match;
  } else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    if (ids.has(key)) return `${path}.${key}`;
    const match = exactJsonIdPath(item, ids, allowToolSchemaConstraints, `${path}.${key}`, [...segments, key]);
    if (match) return match;
  }
  return undefined;
}
function survivorsProof(db: Database, target: number) {
  return Object.fromEntries([
    ...["durable_metadata", "durable_schema", "record_ids"].map(table => [table, tableDigest(db, `SELECT * FROM ${table} ORDER BY 1`)]),
    ...SDK_TABLES.map(table => [table, tableDigest(db, `SELECT * FROM ${table} WHERE NOT (${owners[table]}) ORDER BY ${table === "document_revisions" ? "document_id,seq" : "id"}`, target)]),
  ]);
}
function assertNoOrphanRecords(db: Database) {
  const missing = db.query(`SELECT 1 FROM document_revisions WHERE document_id NOT IN (SELECT id FROM documents)
    UNION ALL SELECT 1 FROM documents WHERE scope_kind='conversation' AND owner_id NOT IN (SELECT id FROM conversations)
    UNION ALL SELECT 1 FROM documents WHERE scope_kind='task' AND owner_id NOT IN (SELECT id FROM tasks)
    UNION ALL SELECT 1 FROM entries WHERE conversation_id NOT IN (SELECT id FROM conversations)
    UNION ALL SELECT 1 FROM tasks WHERE conversation_id NOT IN (SELECT id FROM conversations)
    UNION ALL SELECT 1 FROM submissions WHERE conversation_id NOT IN (SELECT id FROM conversations) LIMIT 1`).get();
  if (missing || db.query("PRAGMA foreign_key_check").get()) refuse("Orphaned or invalid SQLite records");
}
function ownedCounts(db: Database, target: number): RemovedCounts {
  return Object.fromEntries(SDK_TABLES.map(table => [table, count(db, `SELECT COUNT(*) AS count FROM ${table} WHERE ${owners[table]}`, [target])])) as RemovedCounts;
}
function inspectEligibility(db: Database, target: number, piclaw = false) {
  const original = db.query(`SELECT record,owner_conversation_id,owner_task_id FROM conversations WHERE id=?`).get(target) as
    { record: string; owner_conversation_id: number | bigint | null; owner_task_id: number | bigint | null } | null;
  if (!original) refuse("Target must be an existing non-root SDK conversation");
  const record = JSON.parse(original.record) as { id?: unknown; parent?: unknown; owner?: unknown };
  if (original.owner_conversation_id !== null || original.owner_task_id !== null || record.parent !== undefined || record.owner !== undefined || record.id !== target)
    refuse("Target is not an ownerless standalone conversation");
  if (db.query(`SELECT 1 FROM conversations WHERE id<>?1 AND (owner_conversation_id=?1
      OR owner_task_id IN (SELECT id FROM tasks WHERE conversation_id=?1)
      OR json_extract(record,'$.parent.conversationId')=?1) LIMIT 1`).get(target))
    refuse("A surviving fork or owned conversation depends on the target");
  if (db.query(`SELECT 1 FROM tasks WHERE status<>'terminal' OR json_extract(record,'$.state.status') IS NOT 'terminal' LIMIT 1`).get())
    refuse("Active or nonterminal SDK tasks are present");
  if (db.query(`SELECT 1 FROM submissions WHERE status IS NULL OR status NOT IN ('done','unanswered')
    OR json_extract(record,'$.status') IS NOT status LIMIT 1`).get())
    refuse("Nonterminal or invalid SDK submissions are present");
  const ids = new Set<string>();
  for (const table of SDK_TABLES) {
    if (table === "document_revisions") continue;
    for (const row of db.query(`SELECT id FROM ${table} WHERE ${owners[table]}`).iterate(target) as Iterable<{ id: bigint }>)
      ids.add(String(row.id));
  }
  for (const table of SDK_TABLES) {
    const column = table === "document_revisions" ? "content" : "record";
    for (const row of db.query(`SELECT ${column} AS content FROM ${table} WHERE NOT (${owners[table]})`).iterate(target) as Iterable<{ content: string }>) {
      const json = JSON.parse(row.content);
      if ((table === "entries" && !knownEntries.has(json.kind) && !(piclaw && ['host.accepted', 'host.plan-context', 'host.goal-context'].includes(json.kind))) ||
          (table === "tasks" && !knownTasks.has(json.kind)) || (table === "documents" && !knownDocuments.has(json.kind) &&
          !(piclaw && ['app.application-conversations', 'app.application-identity', 'app.host-managed-instructions'].includes(json.kind))))
        refuse(`Unknown surviving SDK history kind in ${table}: ${String(json.kind)}`);
      // Do not guess which opaque scalar values are references. Exact ID matches are refused, including false positives.
      const allowToolSchemaConstraints = piclaw && table === 'entries' && json.kind === 'pi.system';
      const ambiguous = exactJsonIdPath(json, ids, allowToolSchemaConstraints);
      if (ambiguous) refuse(`Ambiguous surviving JSON reference to target-owned history in ${table} ${String(json.kind)} at ${ambiguous}`);
    }
  }
  return ownedCounts(db, target);
}
async function verifyReopensPaused(path: string) {
  const database = await openNodeSqliteDatabase(path, { walAutoCheckpointPages: 0, busyTimeoutMs: 0 });
  let storage: Awaited<ReturnType<typeof SqliteStorage.open>> | undefined;
  let harness: Harness | undefined;
  try {
    storage = await SqliteStorage.open(database);
    harness = await Harness.open(storage, { readOnly: true, registry: createRegistry(),
      models: createModels({ authContext: { env: async () => { refuse("Credential access is forbidden"); }, fileExists: async () => false } }) }, context);
    const inspection = await harness.inspect(context);
    if (inspection.scheduling !== "paused") refuse("Compacted SDK copy did not reopen paused");
  } finally {
    if (harness) await harness.close(context);
    else if (storage) await storage.close(context);
    else await database.close();
  }
}

/** Make a compact sibling copy of a closed SDK or Piclaw store. Never opens the input in SQLite. */
export async function reclaimOfflineSdkHistory(options: OfflineSdkHistoryReclaimOptions): Promise<OfflineSdkHistoryReclaimReceipt> {
  const source = canonicalOfflinePath(options.sourcePath), output = canonicalOfflinePath(options.outputPath), target = options.conversationId;
  const archive = options.piclawArchive && { ...options.piclawArchive, conversationId: target };
  if (archive && (!archive.chatJid.startsWith('web:') || archive.chatJid.trim() !== archive.chatJid || !archive.branchId || archive.branchId.trim() !== archive.branchId))
    refuse('Exact Piclaw chat JID and branch ID are required');
  if (!Number.isSafeInteger(target) || target <= 1) refuse("Target must be an existing non-root SDK conversation");
  if (!/^[0-9a-f]{64}$/.test(options.expectedSourceSha256)) refuse("Expected source SHA-256 is required");
  if (source === output || dirname(source) !== dirname(output)) refuse("Output must be a different sibling name");
  const parent = assertPrivateParent(source);
  assertNoSidecars(source); assertNoSidecars(output);
  if (pathPresent(output)) refuse("Output name already exists");
  const bound = openBoundSource(source);
  let staging: string | undefined;
  let published: OfflineSdkHistoryReclaimReceipt | undefined;
  try {
    staging = mkdtempSync(resolve(parent, ".offline-sdk-history-reclaim-"));
    const mutable = resolve(staging, "snapshot.sqlite"), candidate = resolve(staging, "candidate.sqlite");
    const copyFd = openSync(mutable, "wx", 0o600);
    let sourceSha256: string;
    try { sourceSha256 = fingerprintFd(bound.fd, source, bound.identity, copyFd).sha256; }
    finally { closeSync(copyFd); }
    if (sourceSha256 !== options.expectedSourceSha256) refuse("Expected source SHA-256 does not match");
    assertNoSidecars(source);
    const contract = await installedContract();
    let domain: string | undefined, host: ReturnType<typeof erasePiclawArchiveRows> | undefined;
    if (archive) {
      if (contract.sdkVersion !== '1.7.0') refuse('Piclaw archive reclamation requires installed Durable SDK 1.7.0');
      {
        using preflight = new Database(mutable, { readonly: true, create: false, strict: true });
        sameSchema(preflight, contract, true);
        await assertPiclawArchiveSchema(preflight);
      }
      domain = await retirePiclawArchiveRoute(mutable, archive);
    }
    let expected: ReturnType<typeof survivorsProof>, removed: RemovedCounts;
    {
      using db = new Database(mutable, { create: false, strict: true, safeIntegers: true });
      db.exec("PRAGMA busy_timeout=0; PRAGMA trusted_schema=OFF; PRAGMA secure_delete=ON; PRAGMA foreign_keys=ON");
      sameSchema(db, contract, !!archive);
      // Piclaw's audited FTS triggers require trusted schema on this private copy.
      if (archive) db.exec("PRAGMA trusted_schema=ON");
      if ((db.query("PRAGMA integrity_check").get() as { integrity_check: string } | null)?.integrity_check !== "ok")
        refuse("Input SQLite integrity check failed");
      assertNoOrphanRecords(db);
      const erase = db.transaction(() => {
        const removed = inspectEligibility(db, target, !!archive);
        const expected = survivorsProof(db, target);
        if (archive && domain) host = erasePiclawArchiveRows(db, archive, domain);
        // Delete dependent documents while task ownership can still be resolved.
        for (const table of ["document_revisions", "documents", "entries", "submissions", "tasks", "conversations"] as const) {
          const change = db.query(`DELETE FROM ${table} WHERE ${owners[table]}`).run(target);
          if (Number(change.changes) !== removed[table]) refuse("Erasure scope changed");
        }
        if (Object.values(ownedCounts(db, target)).some(Boolean)) refuse("Target records remain after erasure");
        assertNoOrphanRecords(db);
        return { removed, expected };
      });
      ({ removed, expected } = erase.immediate());
      const fd = openSync(candidate, "wx", 0o600);
      try { db.query("VACUUM INTO ?").run(candidate); fsyncSync(fd); } finally { closeSync(fd); }
    }
    assertNoSidecars(candidate);
    verifySqliteBackup(candidate);
    {
      using compact = new Database(candidate, { readonly: true, strict: true, safeIntegers: true });
      sameSchema(compact, contract, !!archive);
      if (archive && host) {
        await assertPiclawArchiveSchema(compact);
        verifyPiclawArchiveRows(compact, archive, host.survivors);
      }
      if (Object.values(ownedCounts(compact, target)).some(Boolean) ||
          Object.entries(survivorsProof(compact, target)).some(([table, digest]) => expected[table] !== digest))
        refuse("Compacted survivor, identifier, or erasure scope differs");
      assertNoOrphanRecords(compact);
    }
    if (archive && host) {
      using validation = new Database(candidate, { readonly: true, create: false, strict: true });
      const { assertNativeApplicationHistory } = await import('./default-application-runtime.js');
      assertNativeApplicationHistory(validation);
    }
    // Reopen a probe copy; the published bytes have never been reopened for write.
    const probe = resolve(staging, "reopen.sqlite");
    copyFileSync(candidate, probe, constants.COPYFILE_EXCL);
    await verifyReopensPaused(probe);
    assertNoSidecars(source); assertNoSidecars(output);
    if (fingerprintFd(bound.fd, source, bound.identity).sha256 !== sourceSha256) refuse("Source changed after maintenance");
    canonicalOfflinePath(source); canonicalOfflinePath(output);
    assertPrivateParent(output);
    const out = openBoundSource(candidate);
    try {
      const proof = fingerprintFd(out.fd, candidate, out.identity);
      const directory = openSync(parent, "r");
      try {
        linkSync(candidate, output);
        published = { version: 1, kind: "piclaw.offline-sdk-history-reclaim", conversationId: target, sdkVersion: contract.sdkVersion,
          sourceSha256, outputSha256: proof.sha256, outputBytes: proof.bytes, removed,
          ...(host ? { piclawArchive: { removedHostRows: host.counts } } : {}), publication: 'linked-durability-unconfirmed', warnings: [] };
        try { fsyncSync(directory); published.publication = 'durable'; }
        catch { published.warnings.push('directory-sync-failed'); }
      } finally { closeSync(directory); }
    } finally { closeSync(out.fd); }
  } catch (error) {
    if (!published) throw error;
    published.warnings.push('post-publication-cleanup-failed');
  } finally {
    try { try { closeSync(bound.fd); } finally { if (staging) rmSync(staging, { recursive: true, force: true }); } }
    catch (error) { if (!published) throw error; published.warnings.push('post-publication-cleanup-failed'); }
  }
  return published;
}
