#!/usr/bin/env bun
/** Offline native qualification. Provisioning belongs outside this command. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyProvenance } from '../qualification/pi-durable-130/src/provenance.ts';

export const ROOT = resolve(import.meta.dir, '..');
export type NativeContract = {
  version: number;
  fixtures: Record<string, { repository: string; ref: string }>;
  roots: Record<string, string>;
  catalogDependencies: string;
  typeProjects: string[];
  integrationTests: string[];
  tests: string[];
  fileTimeoutMs: Record<string, number>;
};
export type NativeResult = { file: string; exitCode: number; timedOut: boolean; elapsedMs: number; error?: string };
export type Stage = { name: string; cwd: string; command: string[] };
export const readContract = (root = ROOT): NativeContract => JSON.parse(readFileSync(join(root, 'scripts/native-gate-contract.json'), 'utf8'));
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
export function candidateFingerprint(root = ROOT): string {
  const hash = createHash('sha256').update(git(root, 'rev-parse', 'HEAD')).update(git(root, 'status', '--porcelain'));
  // Build output can produce multi-megabyte textual diffs. Capture only path
  // inventories from Git and hash current bytes directly, without a diff buffer.
  const changed = git(root, 'diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', 'HEAD', '--');
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z');
  for (const file of [...new Set([...changed.split('\0'), ...untracked.split('\0')].filter(Boolean))].sort()) {
    const path = join(root, file);
    hash.update(file).update('\0');
    try {
      const stat = lstatSync(path);
      hash.update(String(stat.mode & 0o777)).update('\0');
      hash.update(stat.isSymbolicLink() ? `link:${readlinkSync(path)}` : `file:${digest(path)}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      hash.update('<deleted>');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}
const selectionKeys = ['PICLAW_APPLICATION_CASE', 'PICLAW_DEFAULT_FACTORY_CASE', 'PICLAW_ISOLATED_APPLICATION_CASE',
  'PICLAW_NATIVE_CORE_CHILD', 'PICLAW_PLAN_QUALIFICATION_CASE', 'PICLAW_WORKFLOW_CASE', 'BUN_OPTIONS', 'DURABLE_CORE_ROOT'];

function git(directory: string, ...args: string[]): string {
  const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw Error(`Local Git inspection failed for ${directory}: ${args.join(' ')}`);
  return args.includes('-z') ? result.stdout : result.stdout.trim();
}

export function assertNativeInventory(expected: string[], actual: string[]): void {
  if (!expected.length || new Set(expected).size !== expected.length || JSON.stringify(expected) !== JSON.stringify([...expected].sort())
    || JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw Error('Native inventory mismatch: update/review the complete sorted contract and isolated discovery; filtered/empty qualification is not permitted');
  }
}

export function assertNativeOutcomes(expected: string[], results: NativeResult[]): void {
  if (JSON.stringify(results.map(result => result.file)) !== JSON.stringify(expected)
    || results.some(result => result.exitCode !== 0 || result.timedOut !== false || result.error || !Number.isFinite(result.elapsedMs) || result.elapsedMs < 0)) {
    throw Error('Incomplete/failed native qualification: every contract file must finish successfully exactly once in discovery order');
  }
}

export function nativeStages(contract: NativeContract, root = ROOT): Stage[] {
  if (contract.version !== 1
    || JSON.stringify(contract.typeProjects) !== JSON.stringify(['runtime/durable-engine', 'qualification/pi-durable-130'])
    || JSON.stringify(contract.integrationTests) !== JSON.stringify(['./test/channels/web/input-source-admission.test.ts', './test/agent-pool/legacy-authority-capture.test.ts', './test/native-gate-contract.test.ts', './test/scripts/local-test-priority.test.ts'])) {
    throw Error('Native contract must retain both private type projects and required accepted-source integration');
  }
  const launcher = join(root, 'runtime/scripts/local-test-priority.ts');
  return [
    ...contract.typeProjects.map(project => ({ name: `type:${project}`, cwd: root,
      command: [process.execPath, launcher, '--cwd', join(root, project), '--', 'bun', 'run', 'typecheck'] })),
    // Required integration enters local-test-priority with its normal filesystem preload.
    { name: 'accepted-source', cwd: root, command: [process.execPath, launcher, '--cwd', join(root, 'runtime'), '--env', 'PICLAW_DB_IN_MEMORY=1', '--env', 'PICLAW_REQUIRE_DURABLE_ENGINE=1', '--', 'bun', 'test', ...contract.integrationTests] },
    { name: 'native-isolated', cwd: join(root, 'qualification/pi-durable-130'),
      command: [process.execPath, './scripts/test-isolated.ts'] },
  ];
}

export async function nativePreflight(contract: NativeContract, env: Record<string, string | undefined>, root = ROOT) {
  const problems: string[] = [];
  const fixtures: Record<string, { path: string; repository: string; commit: string; lockSha256: string }> = {};
  for (const key of selectionKeys) if (env[key]) problems.push(`unset ${key}: canonical qualification cannot inherit selection/dependency-root overrides/child mode/options`);
  if (Bun.version !== readFileSync(join(root, 'BUN_VERSION'), 'utf8').trim()) problems.push('Use the repository BUN_VERSION before qualification');
  const requiredRoots = { DURABLE_ADDONS_ROOT: 'native', DURABLE_CORE_ADDONS_ROOT: 'native', DURABLE_GOAL_ADDON_ROOT: 'native', DURABLE_CONTRACT_ADDONS_ROOT: 'contract' };
  if (JSON.stringify(Object.entries(contract.roots).sort()) !== JSON.stringify(Object.entries(requiredRoots).sort())) problems.push('Contract must retain all four explicit fixture roots');
  for (const [key, fixtureName] of Object.entries(requiredRoots)) {
    const pin = contract.fixtures[fixtureName];
    if (!pin || pin.repository !== 'rcarmo/piclaw-addons' || !/^[0-9a-f]{40}$/.test(pin.ref)) {
      problems.push(`Invalid immutable ${fixtureName} fixture selection`); continue;
    }
    const directory = env[key];
    if (!directory || !existsSync(directory)) {
      problems.push(`${key}: export an existing disposable ${pin.repository} checkout at ${pin.ref} (offline preparation: docs/native-validation.md)`); continue;
    }
    try {
      const path = realpathSync(directory);
      if (realpathSync(git(path, 'rev-parse', '--show-toplevel')) !== path || git(path, 'rev-parse', 'HEAD') !== pin.ref) throw Error(`expected checkout root at ${pin.ref}`);
      const changed = git(path, 'status', '--porcelain', '--untracked-files=normal');
      if (changed) throw Error('fixture has modified/untracked source; prepare a clean disposable checkout, never reset another working tree');
      if (fixtureName === 'native') for (const dependencyRoot of ['node_modules', 'addons/code-review/node_modules']) {
        if (!existsSync(join(path, dependencyRoot))) throw Error(`native add-on frozen dependencies are missing at ${dependencyRoot}; provision outside the offline gate`);
      }
      fixtures[key] = { path, repository: pin.repository, commit: pin.ref, lockSha256: digest(join(path, 'bun.lock')) };
    } catch (error) { problems.push(`${key}: ${String(error)}`); }
  }
  const nativePaths = new Set(Object.entries(fixtures).filter(([key]) => key !== 'DURABLE_CONTRACT_ADDONS_ROOT').map(([, value]) => value.path));
  if (nativePaths.size > 1) problems.push('DURABLE_ADDONS_ROOT, DURABLE_CORE_ADDONS_ROOT and DURABLE_GOAL_ADDON_ROOT must select the same physical native checkout');
  const catalog = env.DURABLE_CATALOG_DEPENDENCIES;
  const expectedCatalog = join(root, contract.catalogDependencies);
  if (contract.catalogDependencies !== 'qualification/pi-durable-130/node_modules'
    || !catalog || !existsSync(catalog) || !existsSync(expectedCatalog)
    || realpathSync(catalog) !== realpathSync(expectedCatalog)) {
    problems.push('DURABLE_CATALOG_DEPENDENCIES: export this checkout\'s frozen qualification/pi-durable-130/node_modules; installed/live profile fallbacks are forbidden');
  }
  for (const project of ['', ...contract.typeProjects]) {
    if (!existsSync(join(root, project, 'node_modules/typescript/bin/tsc'))) problems.push(`${project || 'root'}: frozen tooling dependencies missing; provision outside the gate`);
  }
  if (problems.length) throw Error(`Native prerequisites failed (nothing installed/fetched):\n- ${problems.join('\n- ')}`);
  const packages = await verifyProvenance(); // Imported verification only; never acquisition/--record.
  const listed = Bun.spawnSync([process.execPath, './scripts/test-isolated.ts', '--list'], {
    cwd: join(root, 'qualification/pi-durable-130'), env, stdout: 'pipe', stderr: 'pipe',
  });
  if (listed.exitCode !== 0) throw Error(`Isolated inventory discovery failed: ${listed.stderr.toString()}`);
  const inventory = listed.stdout.toString().split('\n').filter(line => line.startsWith('[isolated] file ')).map(line => line.slice(16));
  assertNativeInventory(contract.tests, inventory);
  return { fixtures, catalogDependencies: realpathSync(catalog!), packages: packages.packages.map(pkg => ({ name: pkg.name, version: pkg.version, integrity: pkg.integrity })), inventory, fileTimeoutMs: contract.fileTimeoutMs };
}

export async function runRequiredStages(stages: Stage[], run: (stage: Stage) => Promise<number>): Promise<void> {
  for (const stage of stages) {
    const code = await run(stage);
    if (code !== 0) throw Error(`${stage.name} failed (exit ${code}); qualification is incomplete`);
  }
}

export async function drainStageOutput(child: { stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array>; exited: Promise<number> }, collect?: (result: NativeResult) => void): Promise<number> {
  const readers = [child.stdout.getReader(), child.stderr.getReader()];
  let problem: unknown;
  const pumps = readers.map((reader, index) => (async () => {
    const decoder = new TextDecoder(); let pending = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await (index === 0 ? Bun.stdout : Bun.stderr).write(value);
        if (index !== 0 || !collect) continue;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n'); pending = lines.pop()!;
        for (const line of lines) if (line.startsWith('[isolated] RESULT ')) collect(JSON.parse(line.slice(18)));
      }
    } finally { reader.releaseLock(); }
  })().catch(error => { problem = error; }));
  const code = await child.exited;
  const stopped = Promise.withResolvers<void>(); let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    for (const reader of readers) void reader.cancel().catch(error => { problem ??= error; });
    stopped.resolve();
  }, 2000);
  try { await Promise.race([Promise.all(pumps), stopped.promise]); }
  finally { clearTimeout(timer); }
  if (expired) throw Error('Incomplete stage stdout/stderr after process exit: leaked descriptor or stalled output; refusing qualification');
  if (problem) throw problem;
  return code;
}

export function nativeScratchRoot(root = ROOT, env: Record<string, string | undefined> = process.env): string {
  let scratch = env.TMPDIR;
  if (!scratch) {
    // Reuse the existing read-only portable policy; do not duplicate its host/CI rules.
    const policy = Bun.spawnSync(['make', '-s', 'policy-config'], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' });
    if (policy.exitCode !== 0) throw Error('Cannot resolve scratch policy; run make policy-config and export its TMPDIR');
    scratch = policy.stdout.toString().split('\n').find(line => line.startsWith('TMPDIR='))?.slice(7);
  }
  if (!scratch) throw Error('Scratch policy did not provide TMPDIR');
  const absolute = resolve(scratch), candidate = realpathSync(root);
  const inside = relative(candidate, absolute);
  if (!inside || (!inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside))) throw Error('TMPDIR must be outside the candidate source checkout; use make policy-config');
  return absolute;
}

export async function main(): Promise<number> {
  const scratch = nativeScratchRoot();
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, 'native-gate-'));
  const path = join(directory, 'receipt.json');
  const receipt: Record<string, any> = { scope: 'native-only', complete: false, startedAt: new Date().toISOString(), bun: Bun.version, stages: [], results: [] };
  const save = () => writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  save();
  console.log(`[native-gate] receipt ${path}`);
  let active: ReturnType<typeof Bun.spawn> | undefined;
  let aborted = false;
  const handlers = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map(signal => {
    const handler = () => { aborted = true; active?.kill(signal); };
    process.on(signal, handler); return { signal, handler };
  });
  try {
    if (process.argv.length > 2) throw Error('Canonical native gate takes no filters/options; use the isolated runner for focused development');
    const contract = readContract();
    const stages = nativeStages(contract);
    const initialFingerprint = candidateFingerprint();
    receipt.candidate = { fingerprint: initialFingerprint, commit: git(ROOT, 'rev-parse', 'HEAD'), engineCommit: git(ROOT, 'rev-parse', 'HEAD'), qualificationCommit: git(ROOT, 'rev-parse', 'HEAD'),
      status: git(ROOT, 'status', '--porcelain'), contractSha256: digest(join(ROOT, 'scripts/native-gate-contract.json')),
      locks: Object.fromEntries(['bun.lock', 'runtime/durable-engine/bun.lock', 'qualification/pi-durable-130/bun.lock'].map(file => [file, digest(join(ROOT, file))])) };
    receipt.preflight = await nativePreflight(contract, process.env);
    save();
    await runRequiredStages(stages, async stage => {
      if (aborted) return 130;
      const started = Date.now();
      const record = { ...stage, passed: false, exitCode: null as number | null, elapsedMs: 0 };
      receipt.stages.push(record); save();
      console.log(`[native-gate] START ${stage.name}`);
      const child = active = Bun.spawn(stage.command, { cwd: stage.cwd, env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
      const code = await drainStageOutput(child, stage.name === 'native-isolated' ? result => { receipt.results.push(result); save(); } : undefined);
      active = undefined;
      Object.assign(record, { exitCode: code, passed: code === 0 && !aborted, elapsedMs: Date.now() - started }); save();
      console.log(`[native-gate] ${record.passed ? 'PASS' : 'FAIL'} ${stage.name}`);
      return aborted ? 130 : code;
    });
    assertNativeOutcomes(contract.tests, receipt.results);
    // Hosted fixture checkouts are ignored candidate scratch, but retain their own
    // exact Git/source/provenance checks at both ends of the run.
    await nativePreflight(contract, process.env);
    if (candidateFingerprint() !== initialFingerprint) throw Error('Candidate source/status changed during qualification; receipt cannot qualify a mixed revision');
    receipt.complete = !aborted;
    return aborted ? 130 : 0;
  } catch (error) {
    if (active) { active.kill('SIGTERM'); await active.exited; active = undefined; }
    receipt.error = String(error); console.error(`[native-gate] FAIL ${String(error)}`); return aborted ? 130 : 1;
  } finally {
    receipt.finishedAt = new Date().toISOString(); save();
    for (const { signal, handler } of handlers) process.off(signal, handler);
    console.log(`[native-gate] ${receipt.complete ? 'COMPLETE' : 'INCOMPLETE'} ${path}`);
  }
}

if (import.meta.main) process.exit(await main());
