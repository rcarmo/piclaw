import "./src/test-guard.js";
import { expect, test, spyOn } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGrepTool, createGrepToolDefinition } from "../../node_modules/@earendil-works/pi-coding-agent";
import { createHostGrepDefinition } from "../../runtime/src/agent-pool/host-grep.js";
import { createHostBuiltinTools } from "../../runtime/durable-engine/src/host-builtins.js";
import { BACKGROUND_CONTEXT as context, withAbortSignal } from "../../runtime/durable-engine/qualification/context.ts";
import { listTrackedProcesses } from "../../runtime/src/utils/process-tracker.js";
import { AgentToolFactory } from "../../runtime/src/agent-pool/tool-factory.js";
const api = { callId: "grep-test", output() {}, async details() {} };

test("one root override matches public Pi grep schema, output and details oracle", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-grep-oracle-"));
  try {
    mkdirSync(join(cwd, "nested"));
    writeFileSync(join(cwd, "nested/a.txt"), "first\r\nHello a.b\r\nhello axb\r\nlast\n");
    writeFileSync(join(cwd, "large.txt"), Array.from({ length: 180 }, (_, i) => `hit ${i} ${"x".repeat(480)}`).join("\n"));
    writeFileSync(join(cwd, "long.txt"), "hit " + "y".repeat(700));
    const host = createHostGrepDefinition(cwd), oracle = createGrepTool(cwd);
    expect(host.parameters).toEqual(createGrepToolDefinition(cwd).parameters);
    expect(Object.keys(host.parameters.properties)).toEqual(["pattern", "path", "glob", "ignoreCase", "literal", "context", "limit"]);
    expect(host.description).toBe(oracle.description);
    expect(new AgentToolFactory({ workspaceDir: cwd }).createCustomToolOverrides().map(t => t.name)).toContain("grep");
    for (const args of [
      { pattern: "hello", path: "nested" }, { pattern: "Hello", path: "nested/a.txt" },
      { pattern: "a.b", literal: true, ignoreCase: true, glob: "*.txt", path: "nested" },
      { pattern: "hello", ignoreCase: true, context: 2, path: "nested" },
      { pattern: "Hello", context: 20, path: "nested/a.txt" }, { pattern: "absent" },
      { pattern: "hit", path: "large.txt", limit: 150 }, { pattern: "hit", path: "large.txt", limit: 2 },
      { pattern: "hit", path: "long.txt" },
    ]) expect(await oracle.execute("oracle", args)).toEqual(await host.execute("host", args));
    for (const args of [{ pattern: "[", path: "nested" }, { pattern: "x", path: "missing" }, { pattern: "Hello\\nhello", path: "nested" }]) {
      const failure = (p: Promise<unknown>) => p.then(() => "success", e => e.message);
      expect(await failure(host.execute("host", args))).toBe(await failure(oracle.execute("oracle", args)));
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("owner revoked after path stat denies actual spawn and sanitizes private error", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-grep-fence-"));
  let allowed = true, checks = 0;
  const before = listTrackedProcesses(), spawn = spyOn(Bun, "spawn");
  const [tool] = createHostBuiltinTools({ cwd, names: ["grep"], authority: { assertAllowed() {
    if (!allowed) throw Error("PRIVATE_OWNER");
    if (++checks === 4) queueMicrotask(() => { allowed = false; });
  } } });
  try {
    await expect(tool!.execute({ pattern: "x" } as never, api as never, context)).rejects.toThrow("Host tool authority unavailable");
    expect(checks).toBe(4); expect(spawn).not.toHaveBeenCalled();
    expect(listTrackedProcesses()).toEqual(before);
  } finally { spawn.mockRestore(); rmSync(cwd, { recursive: true, force: true }); }
});

for (const mode of ["abort", "timeout", "overflow", "stderr"] as const) test(`grep joins child on ${mode}`, async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-grep-process-")), previous = process.env.PATH;
  const pidFile = join(cwd, "pid"), before = listTrackedProcesses(), controller = new AbortController();
  writeFileSync(join(cwd, "rg"), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));\nsetInterval(()=>{${mode === "overflow" ? "process.stdout.write('x'.repeat(65536))" : mode === "stderr" ? "process.stderr.write('x'.repeat(65536))" : ""}},1);`);
  chmodSync(join(cwd, "rg"), 0o700); process.env.PATH = cwd;
  try {
    const signal = mode === "timeout" ? AbortSignal.timeout(200) : controller.signal;
    const [tool] = createHostBuiltinTools({ cwd, names: ["grep"], authority: { assertAllowed() {} } });
    const run = tool!.execute({ pattern: "x" } as never, api as never, withAbortSignal(signal, context)).catch(e => e);
    for (let n = 0; n < 200 && !existsSync(pidFile); n++) await Bun.sleep(5);
    expect(existsSync(pidFile)).toBe(true);
    if (mode === "abort") controller.abort();
    expect(await run).toBeInstanceOf(Error);
    expect(() => process.kill(Number(readFileSync(pidFile, "utf8")), 0)).toThrow();
    expect(listTrackedProcesses()).toEqual(before);
  } finally { controller.abort(); process.env.PATH = previous; rmSync(cwd, { recursive: true, force: true }); }
}, 5000);

test("grep snapshots validated arguments before its asynchronous handoff", async () => {
  const dir = await mkdtemp(join(tmpdir(), "host-grep-snapshot-"));
  try {
    await writeFile(join(dir, "original.ts"), "original\n");
    await writeFile(join(dir, "replacement.json"), "replacement\n");
    const expected = await createGrepTool(dir).execute("oracle", { pattern: "original", glob: "*.ts" });
    const input = { pattern: "original", glob: "*.ts" };
    const pending = createHostGrepDefinition(dir).execute("host", input);
    input.pattern = "replacement";
    input.glob = "*.json";
    expect(expected).toEqual(await pending);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
