import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SessionManager, buildSessionContext, convertToLlm } from "@earendil-works/pi-coding-agent";
import { RehearsalSqliteDatabase } from "../../runtime/durable-engine/src/rehearsal-sqlite.js";

const cli = resolve(import.meta.dir, "../../runtime/durable-engine/src/rehearse.ts");
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const baseline = "Explicit persisted rehearsal baseline";
// Each CLI keeps a strict deadline; serial batches need a matching parent budget.
const cliTimeoutMs = 5_000;
const cliTestBudget = (calls: number) => calls * cliTimeoutMs + 5_000;

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (tool = false) => ({ role: "assistant" as const, api: "openai-completions" as const,
  provider: "never-registered", model: "never-executed", usage, timestamp: 1000,
  stopReason: tool ? "toolUse" as const : "stop" as const,
  content: tool ? [{ type: "toolCall" as const, id: "historical", name: "never_execute", arguments: {} }]
    : [{ type: "text" as const, text: "Historical answer" }] });
function fixture() {
  const manager = SessionManager.inMemory(process.env.PICLAW_WORKSPACE!, { id: "original-session" });
  manager.appendMessage({ role: "system", content: baseline, timestamp: 1000 });
  const early = manager.appendMessage({ role: "user", content: "Original private prompt", timestamp: 1000 });
  manager.appendMessage(assistant(true));
  manager.appendMessage({ role: "toolResult", toolCallId: "historical", toolName: "never_execute",
    content: [{ type: "text", text: "Already completed" }], isError: false, timestamp: 1000 });
  manager.appendMessage(assistant());
  const compact = manager.appendCompaction("Existing summary, not regenerated", early, 123);
  const main = manager.appendMessage(assistant());
  manager.branch(compact);
  const sibling = manager.appendMessage({ role: "user", content: [{ type: "text", text: "Image" },
    { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }], timestamp: 1000 });
  const siblingLeaf = manager.appendMessage(assistant());
  manager.branch(sibling);
  manager.appendMessage({ role: "user", content: "Grandchild", timestamp: 1000 });
  const grandchild = manager.appendMessage(assistant());
  manager.branch(early);
  const earlyLeaf = manager.appendMessage(assistant());
  const leaves = [main, siblingLeaf, grandchild, earlyLeaf];
  const source = [manager.getHeader(), ...manager.getEntries()].map(record => JSON.stringify(record)).join("\n") + "\n";
  return { manager, source, manifest: { version: 2, sourceCopied: true, expectedSourceSHA256: sha(source), pending: 0, inflight: 0,
    hostBranchBindings: Object.fromEntries(leaves.map((leaf, index) => [leaf, { chatJid: `web:original-${index}`,
      chatIncarnation: `original-incarnation-${index}`, branchId: `original-branch-${index}`, hostBaseline: baseline }])) } };
}
async function using(run: (dir: string, f: ReturnType<typeof fixture>) => Promise<void>) {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "rehearsal-"));
  try {
    await mkdir(join(dir, "home"));
    const f = fixture();
    await writeFile(join(dir, "copied.jsonl"), f.source);
    await writeFile(join(dir, "manifest.json"), JSON.stringify(f.manifest));
    // Child gets no ambient provider keys, auth directory, preload or production config.
    // Guard SDK public imports and CLI execution against accidental network/credential IO.
    await writeFile(join(dir, "guard.ts"), `
      import fs from "node:fs";
      import net from "node:net";
      import tls from "node:tls";
      import http from "node:http";
      import https from "node:https";
      const deny = () => { throw new Error("REHEARSAL_SIDE_EFFECT_DENIED"); };
      globalThis.fetch = deny; globalThis.WebSocket = class { constructor() { deny(); } };
      net.connect = net.createConnection = tls.connect = http.request = http.get = https.request = https.get = deny;
      for (const name of ["readFileSync", "openSync", "readFile", "open"]) {
        const original = fs[name];
        fs[name] = function(path, ...args) {
          if (typeof path !== "number" && /(?:auth\\.json|credentials|\\/workspace\\/\\.(?:pi|piclaw)\\/)/.test(String(path))) deny();
          return original.call(this, path, ...args);
        };
      }
    `);
    await run(dir, f);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
async function invoke(dir: string, destination: string, extra: string[] = [], source = join(dir, "copied.jsonl")) {
  const child = Bun.spawn([process.execPath, "--preload", join(dir, "guard.ts"), cli,
    "--source", source, "--manifest", join(dir, "manifest.json"), "--destination", destination, ...extra], {
    cwd: dir, env: { PICLAW_LOG_LEVEL: "debug", HOME: join(dir, "home"), PATH: "/usr/bin:/bin", PI_CODING_AGENT_DIR: join(dir, "home", "agent"),
      PICLAW_WORKSPACE: dir, PICLAW_STORE: join(dir, "unused-store") }, stdout: "pipe", stderr: "pipe",
  });
  let timedOut = false;
  const started = performance.now();
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, cliTimeoutMs);
  try {
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (timedOut) throw new Error(`Rehearsal CLI exceeded ${cliTimeoutMs}ms`);
    return { stdout, stderr, exit };
  } finally {
    clearTimeout(timer);
    console.info(`[rehearsal-cli] ${Math.round(performance.now() - started)}ms`);
  }
}

test("rehearsal SQLite keeps FULL durability, rolls back, expires handles and drains admitted work before close", () => using(async dir => {
  const path = join(dir, "adapter.sqlite");
  await writeFile(path, "", { mode: 0o600, flag: "wx" });
  const db = new RehearsalSqliteDatabase(path);
  try {
    expect(await db.get("PRAGMA journal_mode")).toEqual({ journal_mode: "wal" });
    expect(await db.get("PRAGMA synchronous")).toEqual({ synchronous: 2 });
    expect(await db.get("PRAGMA foreign_keys")).toEqual({ foreign_keys: 1 });
    expect(await db.get("PRAGMA secure_delete")).toEqual({ secure_delete: 1 });
    expect(await db.get("PRAGMA busy_timeout")).toEqual({ timeout: 0 });
    expect(await db.get("PRAGMA wal_autocheckpoint")).toEqual({ wal_autocheckpoint: 1000 });
    await db.exec("CREATE TABLE evidence (id INTEGER PRIMARY KEY)");
    await expect(db.transaction(async tx => {
      await tx.run("INSERT INTO evidence VALUES (?)", 1);
      throw new Error("injected rollback");
    })).rejects.toThrow("injected rollback");
    expect(await db.all("SELECT * FROM evidence")).toEqual([]);
    let expired!: Parameters<Parameters<typeof db.transaction>[0]>[0];
    await db.transaction(async tx => {
      expired = tx;
      await expect(db.get("SELECT 1")).rejects.toThrow("transaction handle");
      await expect(db.close()).rejects.toThrow("transaction handle");
      await tx.run("INSERT INTO evidence VALUES (?)", 2);
    });
    await expect(expired.get("SELECT 1")).rejects.toThrow("expired");
    const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const write = db.transaction(async tx => {
      started.resolve();
      await release.promise;
      await tx.run("INSERT INTO evidence VALUES (?)", 3);
    });
    await started.promise;
    const read = db.all("SELECT * FROM evidence ORDER BY id");
    const closing = db.close();
    await expect(db.get("SELECT 1")).rejects.toThrow("closed");
    release.resolve();
    await write;
    expect(await read).toEqual([{ id: 2 }, { id: 3 }]);
    await closing;
    expect(db.close()).toBe(closing);
  } finally { await db.close(); }
  const reopened = new RehearsalSqliteDatabase(path);
  try { expect(await reopened.all("SELECT * FROM evidence ORDER BY id")).toEqual([{ id: 2 }, { id: 3 }]); }
  finally { await reopened.close(); }
}));

test("CLI imports all four leaves with original identities, tools/images/compaction; closes and publicly reopens paused", () => using(async (dir, f) => {
  const before = await readFile(join(dir, "copied.jsonl"));
  const first = join(dir, "first"), second = join(dir, "second");
  const result = await invoke(dir, first);
  expect(result.stderr).toBe(""); expect(result.exit).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "verified", sourceSHA256: sha(before), branches: 4, tasks: 0, submissions: 0, scheduling: "paused" });
  const receipt = JSON.parse(await readFile(join(first, "receipt.json"), "utf8"));
  expect(receipt.entries).toHaveLength(f.manager.getEntries().length);
  expect(new Set(receipt.entries.map((entry: { durableEntryId: number }) => entry.durableEntryId)).size).toBe(receipt.entries.length);
  for (const branch of receipt.branches) {
    const binding = f.manifest.hostBranchBindings[branch.sourceLeafId]!;
    expect([branch.chatJid, branch.chatIncarnation, branch.branchId]).toEqual([binding.chatJid, binding.chatIncarnation, binding.branchId]);
    expect(branch.contextSHA256).toBe(sha(JSON.stringify([{ role: "system", content: binding.hostBaseline, timestamp: 0 }, ...convertToLlm(buildSessionContext(f.manager.getEntries(), branch.sourceLeafId).messages)])));
  }
  expect(await readFile(join(dir, "copied.jsonl"))).toEqual(before);
  expect((await stat(first)).mode & 0o777).toBe(0o700);
  for (const file of ["receipt.json", "rehearsal.json", "rehearsal.sqlite"]) expect((await stat(join(first, file))).mode & 0o777).toBe(0o600);
  expect((await readdir(join(dir, "home"))).filter(name => name !== ".bun")).toEqual([]);
  expect(existsSync(join(dir, "unused-store"))).toBe(false);
  expect(JSON.stringify(receipt)).not.toContain(baseline);
  expect(result.stdout + result.stderr).not.toContain("Original private prompt");
  expect((await invoke(dir, second)).exit).toBe(0);
  expect(JSON.parse(await readFile(join(second, "receipt.json"), "utf8"))).toEqual(receipt);
  const saved = await readFile(join(first, "rehearsal.sqlite"));
  expect((await invoke(dir, first)).stderr).toContain('"code":"destination_exists"');
  expect(await readFile(join(first, "rehearsal.sqlite"))).toEqual(saved);
}), cliTestBudget(3));

test("CLI rejects digest, manifest, flags and active-profile paths before ANY destination creation", () => using(async (dir, f) => {
  const destination = join(dir, "never-created");
  for (const patch of [{ expectedSourceSHA256: "0".repeat(64) }, { sourceCopied: false }, { version: 1 }, { version: 3 }, { pending: 1 }, { unexpected: true }]) {
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ ...f.manifest, ...patch }));
    const result = await invoke(dir, destination);
    expect(result.exit).toBe(1); expect(result.stderr).toMatch(/"code":"(?:invalid_input|source_digest)"/);
    expect(existsSync(destination)).toBe(false);
  }
  await writeFile(join(dir, "manifest.json"), JSON.stringify(f.manifest));
  for (const extra of [["--force"], ["--verify-only"], ["--source", "duplicate"], ["--unknown", "value"]]) {
    expect((await invoke(dir, destination, extra)).stderr).toContain('"code":"invalid_input"');
    expect(existsSync(destination)).toBe(false);
  }
  const active = join(dir, ".pi"); await mkdir(active);
  const live = join(active, "session.jsonl"); await writeFile(live, f.source);
  expect((await invoke(dir, destination, [], live)).stderr).toContain('"code":"invalid_input"');
  await symlink(live, join(dir, "disguised.jsonl"));
  expect((await invoke(dir, destination, [], join(dir, "disguised.jsonl"))).stderr).toContain('"code":"invalid_input"');
  expect((await invoke(dir, join(active, "destination"))).stderr).toContain('"code":"invalid_input"');
  expect(existsSync(destination)).toBe(false);
}), cliTestBudget(13));

test("CLI rejects unsupported or non-quiescent leaves, incomplete/duplicate bindings and conflicting/missing continuation instructions before storage", () => using(async (dir, f) => {
  const destination = join(dir, "never-created");
  const leaves = Object.keys(f.manifest.hostBranchBindings);
  const variants = Array.from({ length: 5 }, () => structuredClone(f.manifest));
  delete variants[0]!.hostBranchBindings[leaves[0]!];
  variants[1]!.hostBranchBindings[leaves[1]!] = { ...variants[1]!.hostBranchBindings[leaves[0]!]! };
  variants[2]!.hostBranchBindings[leaves[0]!]!.hostBaseline = "Different captured current instructions";
  variants[3]!.hostBranchBindings[leaves[0]!]!.hostBaseline = "";
  delete (variants[4]!.hostBranchBindings[leaves[0]!] as Partial<{ hostBaseline: string }>).hostBaseline;
  for (const manifest of variants) {
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
    expect((await invoke(dir, destination)).stderr).toContain('"code":"import_unsupported"');
    expect(existsSync(destination)).toBe(false);
  }
  for (const message of [{ role: "user", content: "Queued/unanswered", timestamp: 1000 }, assistant(true)]) {
    const records = f.source.trim().split("\n").map(line => JSON.parse(line));
    records.at(-1).message = message;
    const source = records.map(record => JSON.stringify(record)).join("\n");
    await writeFile(join(dir, "copied.jsonl"), source);
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ ...f.manifest, expectedSourceSHA256: sha(source) }));
    const result = await invoke(dir, destination);
    expect(result.stderr).toContain('"code":"import_unsupported"');
    expect(result.stderr).not.toContain("Queued/unanswered"); expect(existsSync(destination)).toBe(false);
  }
}), cliTestBudget(7));
