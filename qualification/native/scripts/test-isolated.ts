#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { nativeFileTimeout } from "../../../scripts/native-test-deadlines.ts";

const qualification = resolve(import.meta.dir, "..");
const launcher = resolve(qualification, "../../runtime/scripts/local-test-priority.ts");
// Disposable fixture copies are not candidate test sources.
const excluded = /^(?:node_modules|\.git|tempfixtures|tmp|fixtures|.*fixture.*|pinned-addon-copy-.*|\.qualification-.*)$/i;
async function discover(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory() && !excluded.test(entry.name)) files.push(...await discover(path));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files.sort();
}
const all = await discover(qualification);
const nameOf = (file: string) => relative(qualification, file).replaceAll('\\', '/');
const inventory = all.map(nameOf);
const overrides = (await Bun.file(resolve(qualification, '../../scripts/native-gate-contract.json')).json()).fileTimeoutMs;
const budgets = new Map(all.map(file => [file, nativeFileTimeout(nameOf(file), overrides, inventory)]));
const args = process.argv.slice(2);
const list = args.includes("--list");
const filters = args.filter(arg => arg !== "--list");
for (const arg of filters) {
  if (arg.startsWith("--") || !all.includes(resolve(qualification, arg))) {
    throw new Error(`Unknown candidate test file: ${arg}`);
  }
}
const files = filters.length ? all.filter(file => filters.some(arg => resolve(qualification, arg) === file)) : all;
console.log(`[isolated] ${files.length} files (discovered ${all.length})`);
for (const file of files) console.log(`[isolated] file ${nameOf(file)}`);
if (list) process.exit(0);

const failures: string[] = [];
let active: ReturnType<typeof Bun.spawn> | undefined;
let aborted = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    aborted = true;
    active?.kill(signal); // The existing launcher forwards signals and cleans its process group/root.
  });
}
for (const [index, file] of files.entries()) {
  if (aborted) break;
  const name = nameOf(file);
  const timeoutMs = budgets.get(file)!;
  console.log(`[isolated] START ${index + 1}/${files.length} ${name}`);
  const env = { ...process.env };
  delete env.PICLAW_TEST_FS_ISOLATION_ACTIVE;
  delete env.PICLAW_TEST_FS_ISOLATION_ROOT;
  // Ensure the child launcher owns a process group even under an outer launcher.
  delete env.PICLAW_LOCAL_TEST_PRIORITY_ACTIVE;
  let timedOut = false;
  const started = Date.now();
  try {
    // Every file enters local-test-priority with its fresh filesystem boundary.
  active = Bun.spawn([process.execPath, launcher, "--cwd", qualification, "--", "bun", "test", file], {
      cwd: qualification, env, stdin: "ignore", stdout: "inherit", stderr: "inherit",
    });
    const child = active;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    let code: number;
    try { code = await child.exited; }
    finally { clearTimeout(timer); active = undefined; }
    if (code !== 0 || timedOut) failures.push(`${name}: exit ${code}${timedOut ? ` (${timeoutMs / 1000}s timeout)` : ""}`);
    console.log(`[isolated] ${code === 0 && !timedOut ? "PASS" : "FAIL"} ${name}`);
    console.log(`[isolated] RESULT ${JSON.stringify({ file: name, exitCode: code, timedOut, timeoutMs, elapsedMs: Date.now() - started })}`);
  } catch (error) {
    active = undefined;
    failures.push(`${name}: ${String(error)}`);
    console.error(`[isolated] FAIL ${failures.at(-1)}`);
    console.log(`[isolated] RESULT ${JSON.stringify({ file: name, exitCode: 127, timedOut, timeoutMs, elapsedMs: Date.now() - started, error: String(error) })}`);
  }
}
console.log(`[isolated] ${failures.length} failed${aborted ? "; aborted" : ""}`);
for (const failure of failures) console.error(`[isolated] FAILURE ${failure}`);
process.exit(aborted ? 130 : failures.length ? 1 : 0);
