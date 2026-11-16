import { expect, test, spyOn } from 'bun:test';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { handleCliOptions } from '../../src/cli.js';
const timestamp = '2026-01-01T00:00:00.000Z';
const jsonl = [
  { type: 'session', version: 3, id: 'offline-cli', timestamp, cwd: '/offline' },
  { type: 'message', id: 'user', parentId: null, timestamp, message: { role: 'user', content: 'CLI_PRIVATE_HISTORY', timestamp: 1 } },
].map(entry => JSON.stringify(entry)).join('\n') + '\n';

test('CLI one-shot import takes explicit offline source/fresh destination and emits counts/provenance without history content', async () => {
  const dir = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'import-cli-'));
  const source = join(dir, 'source.jsonl'), destination = join(dir, 'new.sqlite');
  writeFileSync(source, jsonl); const before = readFileSync(source);
  const output: unknown[] = [], errors: unknown[] = [];
  const stdout = spyOn(console, 'log').mockImplementation(value => { output.push(value); });
  const stderr = spyOn(console, 'error').mockImplementation(value => { errors.push(value); });
  const exit = process.exitCode ?? 0;
  try {
    expect(await handleCliOptions(['session-import', '--source', source, '--destination', destination])).toBe(true);
    expect(errors).toEqual([]); expect(output).toHaveLength(1);
    expect(JSON.parse(String(output[0]))).toMatchObject({ format: 4, sourceVersion: 3, importedEntries: 1, excludedEntries: 0 });
    expect(String(output[0])).not.toContain('CLI_PRIVATE_HISTORY'); expect(readFileSync(source).equals(before)).toBe(true);
    expect(existsSync(destination)).toBe(true);
  } finally { stdout.mockRestore(); stderr.mockRestore(); process.exitCode = exit; rmSync(dir, { recursive: true, force: true }); }
});

for (const args of [[], ['--source', 'missing.jsonl'], ['--source', 'x', '--source', 'y', '--destination', 'z'], ['--unknown', 'x', '--destination', 'z']]) test('CLI rejects missing or ambiguous import options without selecting a default source/store', async () => {
  const errors: unknown[] = [], exit = process.exitCode ?? 0;
  const stderr = spyOn(console, 'error').mockImplementation(value => { errors.push(value); });
  try { expect(await handleCliOptions(['session-import', ...args])).toBe(true); expect(process.exitCode).toBe(1); expect(errors).toHaveLength(1); }
  finally { stderr.mockRestore(); process.exitCode = exit; }
});

test('CLI help offers explicit fresh-destination import and removes the retired in-place access-migration commands', async () => {
  const output: unknown[] = []; const stdout = spyOn(console, 'log').mockImplementation(value => { output.push(value); });
  try { await handleCliOptions(['--help']); expect(String(output[0])).toContain('session-import --source <v3.jsonl> --destination <fresh-v4.sqlite>'); expect(String(output[0])).not.toContain('access-migration'); }
  finally { stdout.mockRestore(); }
});
