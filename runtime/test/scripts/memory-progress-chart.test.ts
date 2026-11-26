import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
const history = 'docs/performance/memory-footprint-history.md';
const artifact = 'docs/performance/memory-progress-2026-11-25.svg';

test('memory chart separates installed readiness from historical and synthetic series', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'memory-progress-chart-'));
  try {
    const output = join(scratch, 'chart.svg');
    const render = (input: string) => Bun.spawnSync([process.execPath, 'runtime/scripts/render-memory-progress-chart.ts', '--input', input, '--output', output], { cwd: root });
    const run = render(history);
    expect(run.stderr.toString()).toBe('');
    expect(run.exitCode).toBe(0);
    const svg = readFileSync(output, 'utf8');
    expect(svg).toBe(readFileSync(join(root, artifact), 'utf8'));
    expect(svg).toContain('Installed service at readiness');
    expect(svg).toContain('313.86 MiB RSS');
    expect(svg).toContain('2026-11-25 · 5d850c4d');
    expect(svg).toContain('Post-web-start sample; idle unmeasured');
    expect(svg).toContain('10 historical snapshots');
    expect(svg).toContain('Matched synthetic RSS comparisons');
    expect(svg.match(/<circle[^>]* fill="#60a5fa"/g)).toHaveLength(10);
    expect(svg.match(/<circle[^>]* fill="#a78bfa"/g)).toHaveLength(9);

    const oldInput = join(scratch, 'old.md');
    const markdown = readFileSync(join(root, history), 'utf8');
    writeFileSync(oldInput, markdown.replace(/## Installed-service readiness\n[\s\S]*?(?=## Historical installed-service observation)/, ''));
    expect(render(oldInput).exitCode).toBe(0);
    expect(readFileSync(output, 'utf8')).not.toContain('Installed service at readiness');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
