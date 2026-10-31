import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNativeInventory, assertNativeOutcomes, candidateFingerprint, drainStageOutput, nativePreflight, nativeScratchRoot, nativeStages, readContract, ROOT, runRequiredStages } from '../../scripts/native-test-suite.ts';

import { DEFAULT_NATIVE_FILE_TIMEOUT_MS, nativeFileTimeout } from '../../scripts/native-test-deadlines.ts';

const contract = readContract();
describe('canonical offline native contract', () => {
  test('full local gate composes fast host checks and mandatory native checks', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['ci:full']).toBe('bun run ci:fast && bun run ci:native');
    expect(pkg.scripts['ci:native']).toBe('bun scripts/native-test-suite.ts');
    const make = readFileSync(join(ROOT, 'Makefile'), 'utf8');
    expect(make).toContain('ci-full:'); expect(make).toContain('ci-native:');
    const integration = readFileSync(join(ROOT, 'scripts/integration-test-suite.ts'), 'utf8');
    expect(integration).toContain('await runStage("ci:native", ["bun", "run", "ci:native"]);');
    expect(integration.indexOf('await runStage("ci:native"')).toBeLessThan(integration.indexOf('const staticChecks'));
  });

  test('both private type projects and required engine integration precede all isolated files', () => {
    const stages = nativeStages(contract);
    expect(stages.map(stage => stage.name)).toEqual(['type:runtime/durable-engine', 'type:qualification/pi-durable-130', 'accepted-source', 'native-isolated']);
    for (const stage of stages.slice(0, 3)) expect(stage.command[1]).toBe(join(ROOT, 'runtime/scripts/local-test-priority.ts'));
    expect(stages[2].command).toContain('PICLAW_REQUIRE_DURABLE_ENGINE=1');
    expect(stages[2].command.slice(-contract.integrationTests.length)).toEqual(contract.integrationTests);
    expect(contract.integrationTests).toContain('./test/native-gate-contract.test.ts');
    expect(contract.integrationTests).toContain('./test/scripts/local-test-priority.test.ts');
    expect(stages[3].command).toEqual([process.execPath, './scripts/test-isolated.ts']);
    expect(stages[3].cwd).toBe(join(ROOT, 'qualification/pi-durable-130'));
    expect(() => nativeStages({ ...contract, typeProjects: [] })).toThrow('both private type projects');
    expect(() => nativeStages({ ...contract, integrationTests: [] })).toThrow('required accepted-source');
    for (const required of ['default-application-runtime.test.ts', 'runtime.test.ts', 'goal-tools.test.ts', 'goal-usage.test.ts', 'goal-settlement.test.ts', 'goal-terminal-race.test.ts', 'installed-goal-catalog.test.ts', 'native-compaction-settings.test.ts', 'routing-policy.test.ts', 'native-ui-projection.test.ts']) expect(contract.tests).toContain(required);
  });

  test('preflight requires the separately locked code-review parser graph', async () => {
    const root = mkdtempSync(join(tmpdir(), 'native-parser-prereq-'));
    try {
      writeFileSync(join(root, '.gitignore'), 'node_modules\n');
      writeFileSync(join(root, 'bun.lock'), '{}');
      mkdirSync(join(root, 'node_modules'));
      for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']]) {
        expect(Bun.spawnSync(['git', '-C', root, ...args]).exitCode).toBe(0);
      }
      const ref = new TextDecoder().decode(Bun.spawnSync(['git', '-C', root, 'rev-parse', 'HEAD']).stdout).trim();
      const prepared = { ...contract, fixtures: { ...contract.fixtures, native: { ...contract.fixtures.native, ref }, contract: { ...contract.fixtures.contract, ref } } };
      const env = { DURABLE_ADDONS_ROOT: root, DURABLE_CORE_ADDONS_ROOT: root, DURABLE_GOAL_ADDON_ROOT: root, DURABLE_CONTRACT_ADDONS_ROOT: root };
      const problems = () => nativePreflight(prepared, env).then(() => '', error => String(error));
      expect(await problems()).toContain('addons/code-review/node_modules');
      mkdirSync(join(root, 'addons/code-review/node_modules'), { recursive: true });
      expect(await problems()).not.toContain('addons/code-review/node_modules');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30_000);

  test('missing prerequisites and selection state fail actionably before any package or provider work', async () => {
    await expect(nativePreflight(contract, {})).rejects.toThrow('DURABLE_ADDONS_ROOT: export an existing disposable');
    await expect(nativePreflight(contract, {})).rejects.toThrow('DURABLE_CATALOG_DEPENDENCIES');
    await expect(nativePreflight(contract, { PICLAW_DEFAULT_FACTORY_CASE: 'one' })).rejects.toThrow('unset PICLAW_DEFAULT_FACTORY_CASE');
    await expect(nativePreflight(contract, { BUN_OPTIONS: '--test-name-pattern=one' })).rejects.toThrow('unset BUN_OPTIONS');
    await expect(nativePreflight(contract, { DURABLE_CORE_ROOT: '/unused-alternate-graph' })).rejects.toThrow('unset DURABLE_CORE_ROOT');
  });

  test('editing the bytes of an already-untracked source changes its receipt fingerprint', () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-gate-fingerprint-'));
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(['git', '-C', directory, ...args], { stdout: 'pipe', stderr: 'pipe' });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
    };
    try {
      git('init', '--quiet');
      writeFileSync(join(directory, '.gitignore'), readFileSync(join(ROOT, '.gitignore')));
      git('add', '.gitignore');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '--quiet', '-m', 'fixture');
      const source = join(directory, 'candidate.ts'); writeFileSync(source, 'export const value=1;');
      const before = candidateFingerprint(directory); writeFileSync(source, 'export const value=2;');
      expect(candidateFingerprint(directory)).not.toBe(before);
      const snapshot = candidateFingerprint(directory);
      for (const name of ['.qualification-native-addons', '.qualification-addons']) {
        const nested = join(directory, name); mkdirSync(nested);
        const init = Bun.spawnSync(['git', '-C', nested, 'init', '--quiet'], { stdout: 'pipe', stderr: 'pipe' });
        expect(init.exitCode).toBe(0);
        writeFileSync(join(nested, 'fixture.ts'), 'export const fixture=true;');
      }
      expect(candidateFingerprint(directory)).toBe(snapshot);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('large tracked build changes and deletions fingerprint without buffering a textual diff', () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-gate-large-diff-'));
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(['git', '-C', directory, ...args], { stdout: 'pipe', stderr: 'pipe' });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
    };
    try {
      git('init', '--quiet');
      const bundle = join(directory, 'bundle.js'); writeFileSync(bundle, 'a'.repeat(1_200_000));
      git('add', 'bundle.js');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture');
      const clean = candidateFingerprint(directory);
      writeFileSync(bundle, 'b'.repeat(1_200_000));
      const changed = candidateFingerprint(directory); expect(changed).not.toBe(clean);
      writeFileSync(bundle, 'c'.repeat(1_200_000)); expect(candidateFingerprint(directory)).not.toBe(changed);
      rmSync(bundle); expect(candidateFingerprint(directory)).not.toBe(clean);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('unset TMPDIR uses existing external project policy and source-local scratch fails before writing', () => {
    const before = candidateFingerprint();
    const scratch = nativeScratchRoot(ROOT, { ...process.env, TMPDIR: undefined });
    expect(scratch.startsWith(ROOT + '/')).toBe(false);
    expect(candidateFingerprint()).toBe(before);
    expect(() => nativeScratchRoot(ROOT, { TMPDIR: join(ROOT, 'tmp') })).toThrow('outside the candidate');
  });

  test('cold-start factory aggregate budget is bounded without relaxing scenario deadlines', () => {
    expect(DEFAULT_NATIVE_FILE_TIMEOUT_MS).toBe(300_000);
    expect(nativeFileTimeout('runtime.test.ts', contract.fileTimeoutMs, contract.tests)).toBe(300_000);
    expect(nativeFileTimeout('default-application-runtime.test.ts', contract.fileTimeoutMs, contract.tests)).toBe(900_000);
    expect(Object.keys(contract.fileTimeoutMs)).toEqual(['default-application-runtime.test.ts']);
    for (const value of [0, -1, Infinity, 900_001]) expect(() => nativeFileTimeout('runtime.test.ts', { 'runtime.test.ts': value }, contract.tests)).toThrow('Invalid bounded');
    expect(() => nativeFileTimeout('runtime.test.ts', { 'missing.test.ts': 1 }, contract.tests)).toThrow('Invalid bounded');
    expect(() => nativeFileTimeout('missing.test.ts', {}, contract.tests)).toThrow('Unknown native');
    const factory = readFileSync(join(ROOT, 'qualification/pi-durable-130/default-application-runtime.test.ts'), 'utf8');
    expect(factory).toContain("resolve(import.meta.dir, '../../runtime/scripts/local-test-priority.ts')");
    expect(factory).toContain('}, 30_000);');
  });

  test('discovery drift, missing suites, duplicates and filtered inventory cannot qualify', () => {
    const files = ['a.test.ts', 'b.test.ts'];
    expect(() => assertNativeInventory(files, files)).not.toThrow();
    for (const actual of [[], files.slice(0, 1), [...files, 'c.test.ts'], [...files].reverse()]) expect(() => assertNativeInventory(files, actual)).toThrow('Native inventory mismatch');
    expect(() => assertNativeInventory([], [])).toThrow();
    expect(() => assertNativeInventory(['a.test.ts', 'a.test.ts'], ['a.test.ts', 'a.test.ts'])).toThrow();
  });

  test('only complete ordered successful per-file receipts qualify', () => {
    const files = ['a.test.ts', 'b.test.ts'];
    const results = files.map(file => ({ file, exitCode: 0, timedOut: false, elapsedMs: 1 }));
    expect(() => assertNativeOutcomes(files, results)).not.toThrow();
    for (const changed of [[], results.slice(0, 1), [...results, results[0]], [...results].reverse(),
      [results[0], { ...results[1], exitCode: 1 }], [results[0], { ...results[1], timedOut: true }],
      [results[0], { ...results[1], error: 'spawn failed' }]]) expect(() => assertNativeOutcomes(files, changed)).toThrow('Incomplete/failed');
  });

  test('outer gate bounds inherited stdout after its stage process exits', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-gate-stdout-'));
    const metadata = join(directory, 'pid'); let pid: number | undefined;
    try {
      const script = `import{writeFileSync}from'node:fs';const child=Bun.spawn([process.execPath,'-e','setTimeout(()=>{},30000)'],{stdin:'ignore',stdout:'inherit',stderr:'ignore'});child.unref();writeFileSync(${JSON.stringify(metadata)},String(child.pid));process.exit(0);`;
      const child = Bun.spawn([process.execPath, '-e', script], { cwd: directory, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
      await expect(drainStageOutput(child)).rejects.toThrow('Incomplete stage stdout/stderr');
    } finally {
      try { pid = Number(readFileSync(metadata, 'utf8')); process.kill(pid, 'SIGKILL'); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ESRCH' && code !== 'ENOENT') throw error;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  }, 10000);

  test('deliberate type, integration or native failures propagate and cannot be downgraded/skipped', async () => {
    const stages = nativeStages(contract);
    for (let failed = 0; failed < stages.length; failed++) {
      const called: string[] = [];
      await expect(runRequiredStages(stages, async stage => { called.push(stage.name); return stage === stages[failed] ? 1 : 0; })).rejects.toThrow(`${stages[failed].name} failed (exit 1)`);
      expect(called).toEqual(stages.slice(0, failed + 1).map(stage => stage.name));
    }
  });
});
