#!/usr/bin/env bun
// The classic frontend has pre-existing TS errors outside this vertical slice.
// Compare exact diagnostics for the imported graph; a new or resolved error fails.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const runtimeDir = resolve(import.meta.dir, '..');
const compiler = resolve(runtimeDir, '../node_modules/typescript/bin/tsc');
const result = Bun.spawnSync([process.execPath, compiler, '--noEmit', '--pretty', 'false', '-p', 'tsconfig.web-compose.json'], {
  cwd: runtimeDir,
  stdout: 'pipe',
  stderr: 'pipe',
});
const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
const actual = [...new Set(output.split('\n')
  .filter(line => /^.+\(\d+,\d+\): error TS\d+: /.test(line))
  .map(line => line.replace(/^runtime\//, '')))].sort();
if (result.exitCode !== 0 && actual.length === 0) {
  throw new Error(`Frontend compiler failed without TypeScript diagnostics:\n${output}`);
}
const baseline = JSON.parse(readFileSync(resolve(runtimeDir, 'scripts/web-compose-type-baseline.json'), 'utf8')) as string[];
const additions = actual.filter(item => !baseline.includes(item));
const resolved = baseline.filter(item => !actual.includes(item));
if (additions.length || resolved.length) {
  if (additions.length) console.error('New frontend type diagnostics:\n' + additions.join('\n'));
  if (resolved.length) console.error('Resolved baseline diagnostics (update the audited baseline):\n' + resolved.join('\n'));
  process.exit(1);
}
console.log(`Compose-reference contract and six explicit frontend modules checked; ${baseline.length} unchanged pre-existing transitive diagnostics.`);
