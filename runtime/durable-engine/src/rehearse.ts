#!/usr/bin/env bun
/** INACTIVE, source-executed copied-store rehearsal. Never imports the host application. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { Harness, createRegistry, type ConversationId } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { BunSqliteDatabase } from "./bun-sqlite.js";
import { importCopiedLegacyTree, prepareLegacyTreeImport, LegacyImportManifest, LegacyTreeImportManifest,
  type CopiedLegacyTreeInput, type GetLegacyContext } from "./legacy-import.js";

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
type FailureCode = "invalid_input" | "source_digest" | "destination_exists" | "import_unsupported" | "context_mismatch" | "storage_failure";
class Failure extends Error { constructor(readonly code: FailureCode) { super(code); } }
function check(condition: unknown, code: FailureCode = "invalid_input"): asserts condition {
  if (!condition) throw new Failure(code);
}
function parseJSON(bytes: Buffer): unknown {
  return JSON.parse(bytes.toString("utf8"), (_key, value: unknown) => {
    check(typeof value !== "number" || Number.isFinite(value)); return value;
  });
}
function object(value: unknown): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
}
function fields(value: Record<string, unknown>, names: string[]) {
  check(Object.keys(value).length === names.length && names.every(key => Object.hasOwn(value, key)));
}
function options(args: string[]) {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    check(["--source", "--manifest", "--destination"].includes(key) && !Object.hasOwn(result, key));
    check(value && !value.startsWith("--")); result[key] = value;
  }
  check(Object.keys(result).length === 3);
  return { source: result["--source"]!, manifest: result["--manifest"]!, destination: result["--destination"]! };
}
// Reject both lexical paths and symlink-resolved targets. No force, profile override,
// or exception for fixtures: copies must live outside ALL .pi/.piclaw directories.
function safePath(path: string) {
  const absolute = resolve(path);
  check(!absolute.split(sep).some(part => part === ".pi" || part === ".piclaw"));
  const roots = ["/workspace/.pi", "/workspace/.piclaw", process.env.PI_CODING_AGENT_DIR, process.env.PICLAW_STORE,
    ...[process.env.HOME, process.env.PICLAW_WORKSPACE].filter((root): root is string => !!root)
      .flatMap(root => [join(root, ".pi"), join(root, ".piclaw")])];
  for (const root of roots) {
    if (!root) continue;
    let canonical = resolve(root);
    try { canonical = realpathSync(canonical); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    check(absolute !== canonical && !absolute.startsWith(canonical + sep));
  }
  return path;
}

export async function rehearse(args: string[]) {
  let stage: FailureCode = "invalid_input";
  try {
    const opts = options(args);
    const source = safePath(realpathSync(safePath(opts.source)));
    const manifestPath = safePath(realpathSync(safePath(opts.manifest)));
    const destination = safePath(join(safePath(realpathSync(safePath(dirname(resolve(opts.destination))))), basename(resolve(opts.destination))));
    // Single immutable snapshots; digest and full manifest/tree validation precede mkdir.
    const bytes = readFileSync(source), manifestBytes = readFileSync(manifestPath);
    const sourceSHA256 = sha(bytes), manifestSHA256 = sha(manifestBytes);
    check(Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes));
    check(Buffer.from(manifestBytes.toString("utf8"), "utf8").equals(manifestBytes));
    const manifest = parseJSON(manifestBytes); object(manifest);
    fields(manifest, ["version", "sourceCopied", "expectedSourceSHA256", "pending", "inflight", "hostBranchBindings"]);
    check(manifest.version === 1 && manifest.sourceCopied === true && manifest.pending === 0 && manifest.inflight === 0);
    check(typeof manifest.expectedSourceSHA256 === "string" && /^[a-f0-9]{64}$/.test(manifest.expectedSourceSHA256));
    check(sourceSHA256 === manifest.expectedSourceSHA256, "source_digest");
    object(manifest.hostBranchBindings);
    const input: CopiedLegacyTreeInput = { sourceJSONL: bytes.toString("utf8"),
      hostBranchBindings: manifest.hostBranchBindings as CopiedLegacyTreeInput["hostBranchBindings"] };

    stage = "import_unsupported";
    // Root Pi120 public export, anchored OUTSIDE the candidate dependency graph.
    // Only detached JSON crosses this bridge; no contexts, engines or SDK runtimes.
    const rootRequire = createRequire(new URL("../../../package.json", import.meta.url));
    const packagePath = rootRequire.resolve("@earendil-works/pi-coding-agent/package.json");
    const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
    check(pkg.version === "1.2.0", "import_unsupported");
    const legacy: typeof import("../../../node_modules/@earendil-works/pi-coding-agent") =
      await import(pathToFileURL(resolve(dirname(packagePath), pkg.exports["."].import)).href);
    const bridge: GetLegacyContext = (entries, leaf) => {
      const detached = json([...entries]);
      const messages = json(legacy.convertToLlm(legacy.buildSessionContext(detached, leaf).messages));
      // Rehearsal is quiescent, not an admission/queue reconciliation or effect replay.
      const last = messages.at(-1);
      check(last?.role === "assistant" && last.stopReason === "stop", "import_unsupported");
      return { messages, projected: detached.map(entry => ({ sourceEntryId: entry.id,
        messages: json(legacy.convertToLlm(legacy.sessionEntryToContextMessages(entry))) })) };
    };
    const plan = prepareLegacyTreeImport(input, bridge); // Validates EVERY leaf and pending tool call.
    for (const branch of plan.prepared) {
      const systems = branch.projection.messages.filter(message => message.role === "system");
      check(systems.length === 1 && systems[0]!.content === branch.identity.hostBaseline, "import_unsupported");
    }
    stage = "storage_failure";
    try { mkdirSync(destination, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Failure("destination_exists");
      throw error;
    }
    // Exclusive mkdir is the process ownership fence. No existing directory is ever
    // opened, retried, deleted or stolen. Crashes leave an offline incomplete store.
    const markerPath = join(destination, "rehearsal.json");
    const marker = { version: 1, domain: "piclaw.inactive-copied-rehearsal", sourceSHA256, manifestSHA256, status: "incomplete" };
    writeFileSync(markerPath, JSON.stringify(marker) + "\n", { mode: 0o600, flag: "wx" });
    writeFileSync(join(destination, "rehearsal.sqlite"), "", { mode: 0o600, flag: "wx" });
    const denied = async (): Promise<never> => { throw new Error("Rehearsal denies credential access"); };
    const open = async () => {
      const db = new BunSqliteDatabase(join(destination, "rehearsal.sqlite"));
      try {
        const storage = await SqliteStorage.open(db);
        return await Harness.open(storage, { models: createModels({ authContext: { env: denied, fileExists: denied } }),
          registry: createRegistry(), settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
      } catch (error) { await db.close(); throw error; }
    };
    let harness = await open();
    try {
      const root = await harness.root(context, { agent: { extensions: [], tools: [] } });
      const receipt = await importCopiedLegacyTree(root, input, bridge, () => {}, context);
      await harness.close(context);
      harness = await open(); // Public open may normalize storage: NOT a read-only verification.
      stage = "context_mismatch";
      assert.deepEqual(await harness.snapshot(LegacyTreeImportManifest, root.id, context), { binding: receipt });
      for (const [index, branch] of receipt.branches.entries()) {
        const conversation = await harness.conversation(branch.engineConversationId as ConversationId, context);
        check(conversation, "context_mismatch");
        assert.deepEqual((await conversation.context(context)).messages, plan.prepared[index]!.projection.messages);
        assert.deepEqual(await harness.snapshot(LegacyImportManifest, conversation.id, context), { binding: branch });
        assert.deepEqual(branch.originalEntries, plan.prepared[index]!.entries);
        const expected = plan.plannedBranches[index]!;
        assert.deepEqual([branch.chatJid, branch.chatIncarnation, branch.branchId],
          [expected.chatJid, expected.chatIncarnation, expected.branchId]);
      }
      assert.deepEqual(await harness.inspect(context), { scheduling: "paused", tasks: [], submissions: [] });
      await harness.close(context);
      stage = "storage_failure";
      const summary = { ...marker, status: "verified", importerHash: receipt.sourceHash,
        sourceSessionId: receipt.sourceSessionId, entries: receipt.entries,
        branches: receipt.branches.map((branch, index) => ({ sourceLeafId: branch.sourceLeafId, chatJid: branch.chatJid,
          chatIncarnation: branch.chatIncarnation, branchId: branch.branchId, engineConversationId: branch.engineConversationId,
          contextSHA256: sha(JSON.stringify(plan.prepared[index]!.projection.messages)) })) };
      writeFileSync(join(destination, "receipt.json"), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      writeFileSync(markerPath, JSON.stringify({ ...marker, status: "verified" }) + "\n", { mode: 0o600 });
      return { status: "verified", sourceSHA256, importerHash: receipt.sourceHash, branches: receipt.branches.length,
        entries: receipt.entries.length, scheduling: "paused", tasks: 0, submissions: 0 };
    } finally { await harness.close(context); }
  } catch (error) { throw error instanceof Failure ? error : new Failure(stage); }
}

if (import.meta.main) {
  try { console.log(JSON.stringify(await rehearse(process.argv.slice(2)))); }
  catch (error) {
    // Never print raw exceptions: SDK/assertion errors can contain prompts or paths.
    console.error(JSON.stringify({ status: "failed", code: error instanceof Failure ? error.code : "storage_failure" }));
    process.exitCode = 1;
  }
}
