/** Provider-free, offline comparison. Run via bun run test:local -- bun runtime/scripts/note-passage-experiment.ts. */
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getActiveTestFilesystemIsolationRoot } from './test-filesystem-isolation.js';
import { experimentFingerprint, verifyExperimentFreeze } from '../test/fixtures/note-retrieval/passage-fingerprint.js';

const root = getActiveTestFilesystemIsolationRoot();
if (!root) throw Error('Requires filesystem-isolated local test launcher');
const args = process.argv.slice(2);
if (args.some(arg => !['--held-out', '--small'].includes(arg))) throw Error('Only --held-out and --small are supported');
const fixture = join(import.meta.dir, '../test/fixtures/note-retrieval');
const candidateSha256 = createHash('sha256').update(readFileSync(join(fixture, 'passage-experiment.ts'))).digest('hex');
const split = args.includes('--held-out') ? 'held-out' : 'development';
const fingerprint = experimentFingerprint(join(import.meta.dir, '../..'));
if (split === 'held-out') {
  const frozen = JSON.parse(readFileSync(join(fixture, 'passage-freeze.json'), 'utf8'));
  verifyExperimentFreeze(fingerprint, frozen.fingerprint);
}
const reports: any[] = [];
for (const scale of args.includes('--small') ? [0] : [0, 500]) {
  for (const direction of ['forward', 'reverse']) {
    const workspace = mkdtempSync(join(root, 'passage-experiment-'));
    for (const mode of ['build', 'reopen']) {
      const child = Bun.spawn([process.execPath, join(fixture, 'passage-worker.ts'), mode, split, String(scale), direction], {
        env: { ...process.env, PICLAW_WORKSPACE: workspace, PICLAW_STORE: join(workspace, '.piclaw/store'),
          PICLAW_DATA: join(workspace, '.piclaw/data'), PICLAW_DB_IN_MEMORY: '0', PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX: '1' },
        stdout: 'pipe', stderr: 'pipe',
      });
      const timer = setTimeout(() => child.kill(), 120_000);
      try {
        const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        if (code !== 0) throw Error(`Experiment worker failed ${code}: ${err.slice(-3000)}`);
        const result = out.split('\n').find(line => line.startsWith('PASSAGE_REPORT='));
        if (!result) throw Error('Missing experiment report');
        reports.push(JSON.parse(result.slice('PASSAGE_REPORT='.length)));
      } finally { clearTimeout(timer); }
    }
  }
}
for (const scale of [...new Set(reports.map(report => report.scale))]) {
  const runs = reports.filter(report => report.scale === scale);
  const output = (report: any) => JSON.stringify(report.results.map((row: any) => [row.variant, row.id, row.payload]));
  if (runs.some(run => output(run) !== output(runs[0]) || run.results.some((row: any) => !row.stable))) {
    throw Error('Agent-visible payload changed across repeat/reopen/reversed rebuild');
  }
}
console.log(JSON.stringify({ schema: 1, split, candidateSha256, fingerprint, stable: true,
  corpusSha256: createHash('sha256').update(readFileSync(join(fixture, 'corpus.json'))).digest('hex'),
  limitations: ['Exact labelled-span containment, not model answer accuracy or a calibrated probability.',
    'Frozen small synthetic set; known topics are not a statistically unseen evaluation.',
    'No production query/get admission, citations, refresh or ranking changes. Old budgets are not approved.'], reports }, null, 2));
