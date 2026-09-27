/** An owned corpus/index only; no production writer or tool registration. */
import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPassageIndex, POLICY, retrievePassages, VARIANTS } from './passage-experiment.js';
import { loadCorpus, percentile } from './scoring.js';
import { scoreDeliveredEvidence, summariseDelivered, type DeliveredHit } from './passage-score.js';
import { assertPathWithinTestFilesystemIsolation, getActiveTestFilesystemIsolationRoot } from '../../../scripts/test-filesystem-isolation.js';

if (!getActiveTestFilesystemIsolationRoot()) throw Error('Requires isolated local launcher');
const workspace = process.env.PICLAW_WORKSPACE!;
for (const path of [workspace, process.env.PICLAW_STORE!, process.env.PICLAW_DATA!]) assertPathWithinTestFilesystemIsolation(path);
const [mode, split, scaleArg, direction] = process.argv.slice(2);
const scale = Number(scaleArg);
if (!['build', 'reopen'].includes(mode!) || !['development', 'held-out'].includes(split!)
  || ![0, 500].includes(scale) || !['forward', 'reverse'].includes(direction!)) throw Error('Invalid experiment arguments');
const corpus = loadCorpus(import.meta.dir);
const queries = corpus.queries.filter(query => query.split === split);
const sources = readdirSync(join(import.meta.dir, 'notes')).sort().map(name => ({
  path: `notes/${name}`, bytes: readFileSync(join(import.meta.dir, 'notes', name)),
}));
for (let i = 0; i < scale; i++) sources.push({ path: `notes/scale-${String(i).padStart(4, '0')}.md`,
  bytes: Buffer.from(`# Synthetic filler ${i}\n\n${'Neutral inventory padding about trays and baskets. '.repeat(150)}\n`) });
if (direction === 'reverse') sources.reverse();
process.env.PICLAW_DB_IN_MEMORY = '0';
process.env.PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX = '1';
if (mode === 'build') {
  mkdirSync(join(workspace, '.piclaw'), { recursive: true }); mkdirSync(join(workspace, 'notes'), { recursive: true });
  writeFileSync(join(workspace, '.piclaw/config.json'), JSON.stringify({ domains: { access: { mode: 'single-user' }, tools: { workspaceSearchRoots: ['notes'], searchMatchMode: 'or' } } }));
  for (const source of sources) writeFileSync(join(workspace, source.path), source.bytes);
}
const dbModule = await import('../../../src/db.js'); dbModule.initDatabase();
const search = await import('../../../src/workspace-search.js');
search.setBackgroundWorkspaceIndexRefreshRequesterForTests(() => {});
if (mode === 'build') {
  const status = await search.refreshWorkspaceIndex({ scope: 'notes', max_kb: 512 });
  if (status.state !== 'ready' || status.indexed_file_count !== sources.length) throw Error('Incomplete baseline index');
}
const { workspaceSearch } = await import('../../../src/extensions/workspace-search.js');
let executeTool: ((...args: any[]) => Promise<any>) | undefined;
workspaceSearch({ on() {}, registerTool(tool: any) { if (tool.name === 'search_workspace') executeTool = tool.execute; } } as any);
if (!executeTool) throw Error('Missing production tool');
const db = new Database(join(workspace, 'passage.sqlite'));
const start = performance.now();
if (mode === 'build') createPassageIndex(db, sources);
const indexMs = performance.now() - start;
const results = [];
for (const query of queries) {
  // Score and measure the SAME production tool response; no second search and
  // no full-file read is credited as delivered evidence.
  const response = await executeTool('fixture', { query: query.query, scope: 'notes', limit: POLICY.limit }, undefined, undefined, { hasUI: false });
  if (!response.content[0].text.startsWith('Found ') && response.content[0].text !== 'No matching workspace files found.') throw Error('Baseline search error');
  const payload = response.content.map((part: { text: string }) => part.text).join('\n');
  const hits: DeliveredHit[] = response.details.results.map((row: {path: string; snippet: string}) => {
    const source = sources.find(item => item.path === row.path)!;
    // Production uses ambiguous [highlight] markers. Only remove them where
    // the frozen source has no literal brackets; otherwise credit no evidence.
    const ambiguousHighlight = /[\[\]]/.test(source.bytes.toString('utf8'));
    if (!payload.includes(`• ${row.path} — ${row.snippet}`)) throw Error('Scoring hidden content or mismatched path');
    return { path: row.path, text: ambiguousHighlight ? row.snippet : row.snippet.replace(/[\[\]]/g, ''), ambiguousHighlight };
  });
  results.push({ variant: 'current-tool', query, hits, payload, stable: true,
    score: scoreDeliveredEvidence(query, hits), warmP95Ms: null as number | null });
  const baseline = results.at(-1)!;
  for (let repeat = 0; repeat < 5; repeat++) {
    const again = await executeTool('fixture', { query: query.query, scope: 'notes', limit: POLICY.limit }, undefined, undefined, { hasUI: false });
    if (again.content.map((part: { text: string }) => part.text).join('\n') !== payload) baseline.stable = false;
  }
  for (const variant of VARIANTS) {
    const output = retrievePassages(db, query.query, variant), encoded = JSON.stringify(output);
    const observed = JSON.parse(encoded) as typeof output, timings: number[] = [];
    let stable = true;
    for (let repeat = 0; repeat < 5; repeat++) {
      const t = performance.now(); const again = JSON.stringify(retrievePassages(db, query.query, variant));
      timings.push(performance.now() - t); if (again !== encoded) stable = false;
    }
    results.push({ variant, query, hits: observed.hits, payload: encoded, stable,
      score: scoreDeliveredEvidence(query, observed.hits), warmP95Ms: percentile(timings, .95) });
  }
}
const summary = Object.fromEntries(['current-tool', ...VARIANTS].map(variant => [variant,
  summariseDelivered(results.filter(row => row.variant === variant))]));
const report = { split, mode, scale, direction, versions: { bun: Bun.version, sqlite: db.query('SELECT sqlite_version() AS version').get() },
  policy: POLICY, indexMs, rssBytes: process.memoryUsage().rss,
  passageDatabaseBytes: Number((db.query('PRAGMA page_count').get() as {page_count: number}).page_count)
    * Number((db.query('PRAGMA page_size').get() as {page_size: number}).page_size), summary,
  results: results.map(({ query, ...result }) => ({ id: query.id, ...result })) };
db.close(); dbModule.closeDatabase();
console.log('PASSAGE_REPORT=' + JSON.stringify(report));
