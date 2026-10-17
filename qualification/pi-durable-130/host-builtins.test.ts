import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context, withAbortSignal } from "../../runtime/durable-engine/qualification/context.ts";
import { createHostBuiltinTools } from "../../runtime/durable-engine/src/host-builtins.ts";

import { listTrackedProcesses, killProcessTree } from "../../runtime/src/utils/process-tracker.js";

const api = { callId: "builtin-test", output() {}, async details() {} };

for (const cancellation of ["invocation", "lifetime", "overflow"] as const) test(`find is responsive, bounded and joins its tracked process on ${cancellation}`, async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-find-'$-"));
  const previousPath = process.env.PATH;
  const before = listTrackedProcesses();
  const controller = new AbortController();
  const pidFile = join(cwd, "fd.pid");
  writeFileSync(join(cwd, "fd"), `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n${cancellation === "overflow" ? "setInterval(() => process.stdout.write('x'.repeat(65536)), 1);" : "setInterval(() => {}, 1000);"}\n`);
  chmodSync(join(cwd, "fd"), 0o700);
  process.env.PATH = cwd;
  const [tool] = createHostBuiltinTools({ cwd, names: ["find"], signal: cancellation === "lifetime" ? controller.signal : undefined, authority: { assertAllowed() {} } });
  let pid: number | undefined;
  const watchdog = setTimeout(() => controller.abort(), 3000);
  try {
    const execution = tool!.execute({ pattern: "*.txt" } as never, api as never,
      cancellation === "invocation" ? withAbortSignal(controller.signal, context) : context).then(() => null, error => error);
    // This timer cannot run with the former spawnSync implementation.
    for (let i = 0; i < 200 && !existsSync(pidFile); i++) await Bun.sleep(5);
    expect(existsSync(pidFile)).toBe(true);
    pid = Number(readFileSync(pidFile, "utf8"));
    expect(pid).toBeGreaterThan(0);
    if (cancellation !== "overflow") {
      expect(listTrackedProcesses()).toContain(pid);
      controller.abort();
    }
    expect(await execution).toBeInstanceOf(Error);
    expect(() => process.kill(pid!, 0)).toThrow();
    expect(listTrackedProcesses()).toEqual(before);
  } finally {
    clearTimeout(watchdog); controller.abort();
    if (pid) { try { process.kill(pid, 0); killProcessTree(pid); } catch {} }
    process.env.PATH = previousPath;
    rmSync(cwd, { recursive: true, force: true });
  }
}, 5000);

test("find rechecks owner after SDK exists await and never starts fd on owner loss", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-find-owner-"));
  const previousPath = process.env.PATH;
  const sentinel = join(cwd, "spawned");
  writeFileSync(join(cwd, "fd"), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'forbidden');\n`);
  chmodSync(join(cwd, "fd"), 0o700);
  process.env.PATH = cwd;
  let allowed = true, checks = 0;
  const before = listTrackedProcesses();
  const [tool] = createHostBuiltinTools({ cwd, names: ["find"], authority: { assertAllowed() {
    if (!allowed) throw Error("PRIVATE_OWNER");
    if (++checks === 3) queueMicrotask(() => { allowed = false; });
  } } });
  try {
    await expect(tool!.execute({ pattern: "*" } as never, api as never, context)).rejects.toThrow("Host tool authority unavailable");
    expect(checks).toBe(3);
    expect(existsSync(sentinel)).toBe(false);
    expect(listTrackedProcesses()).toEqual(before);
  } finally { process.env.PATH = previousPath; rmSync(cwd, { recursive: true, force: true }); }
});

test("existing host builtins execute read/write/edit/ls/find/bash with actual files and native results", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-builtins-"));
  const tools = createHostBuiltinTools({ cwd, authority: { assertAllowed() {} } });
  const run = (name: string, args: unknown) => tools.find(tool => tool.name === name)!.execute(args as never, api as never, context);
  try {
    expect(tools.map(tool => tool.name)).toEqual(["read", "bash", "edit", "write", "find", "ls", "grep"]);
    await run("write", { path: "nested/a.txt", content: "before" });
    expect((await run("read", { path: "nested/a.txt" })).output).toEqual([{ type: "text", text: "before" }]);
    const edited = await run("edit", { path: "nested/a.txt", edits: [{ oldText: "before", newText: "after" }] });
    expect(readFileSync(join(cwd, "nested/a.txt"), "utf8")).toBe("after");
    expect(JSON.stringify(edited.details)).toContain("before");
    expect(JSON.stringify((await run("ls", { path: "nested" })).output)).toContain("a.txt");
    expect(JSON.stringify((await run("find", { pattern: "*.txt" })).output)).toContain("nested/a.txt");
    expect(JSON.stringify((await run("bash", { command: "printf host-builtin-bash" })).output)).toContain("host-builtin-bash");
    for (const tool of tools) expect(tool.replay).toBe("unsafe");
    expect(JSON.stringify((await run("grep", { pattern: "after", path: "nested" })).output)).toContain("a.txt:1: after");
    expect(createHostBuiltinTools({ cwd, authority: { assertAllowed() {} }, names: ["read"] }).map(tool => tool.name)).toEqual(["read"]);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("revocation after SDK read await prevents actual edit write; no private errors escape", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-edit-fence-"));
  const file = join(cwd, "a.txt"); writeFileSync(file, "original");
  let checks = 0, allowed = true;
  const [tool] = createHostBuiltinTools({ cwd, names: ["edit"], authority: { assertAllowed() {
    if (!allowed) throw Error("PRIVATE_OWNER_CONTEXT");
    checks++;
    // initial bridge, invocation, access, readFile. Revoke in the SDK's
    // await continuation gap, AFTER the actual read but BEFORE its write.
    if (checks === 4) queueMicrotask(() => { allowed = false; });
  } } });
  try {
    await expect(tool!.execute({ path: "a.txt", edits: [{ oldText: "original", newText: "changed" }] } as never, api as never, context)).rejects.toThrow("Host tool authority unavailable");
    expect(checks).toBe(4);
    expect(readFileSync(file, "utf8")).toBe("original");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("caller mutation cannot replace captured authority during an SDK await", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-captured-fence-"));
  let allowed = true;
  const authority = { assertAllowed() { if (!allowed) throw Error("PRIVATE"); } };
  const options = { cwd, names: ["write"], authority };
  const [tool] = createHostBuiltinTools(options);
  try {
    const execution = tool!.execute({ path: "new/a.txt", content: "denied" } as never, api as never, context);
    allowed = false;
    authority.assertAllowed = () => {};
    options.authority = { assertAllowed() {} };
    await expect(execution).rejects.toThrow("Host tool authority unavailable");
    expect(existsSync(join(cwd, "new"))).toBe(false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("revocation while SDK mutation queue awaits prevents mkdir and file creation", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-write-fence-"));
  let allowed = true;
  const [tool] = createHostBuiltinTools({ cwd, names: ["write"], authority: { assertAllowed() { if (!allowed) throw Error("PRIVATE"); } } });
  try {
    const execution = tool!.execute({ path: "new/a.txt", content: "denied" } as never, api as never, context);
    allowed = false;
    await expect(execution).rejects.toThrow("Host tool authority unavailable");
    expect(existsSync(join(cwd, "new"))).toBe(false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
