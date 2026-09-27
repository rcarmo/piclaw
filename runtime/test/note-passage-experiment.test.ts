import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { createPassageIndex, POLICY, queryUnits, retrievePassages } from './fixtures/note-retrieval/passage-experiment.js';
import { scoreDeliveredEvidence, summariseDelivered } from './fixtures/note-retrieval/passage-score.js';
import type { Query } from './fixtures/note-retrieval/scoring.js';
import { verifyExperimentFreeze } from './fixtures/note-retrieval/passage-fingerprint.js';
import './helpers.js';

const query: Query = { id: 'fixture', split: 'development', category: 'fixture', question: 'where?', query: 'alpha',
  relevant: [{ path: 'notes/a.md', lineStart: 1, lineEnd: 2, quote: '## Alpha\nThe answer is silver.' }] };
test('scoring uses only complete labelled text in a returned hit, never a filename', () => {
  const hit = { path: 'notes/a.md', text: 'Unrelated text' };
  expect(scoreDeliveredEvidence(query, [hit])).toMatchObject({ fileSectionUpperBound: 1, labelledSpanRecall: 0 });
  expect(scoreDeliveredEvidence(query, [{ ...hit, text: '## Alpha\r\nThe answer is silver.' }]).labelledSpanRecall).toBe(1);
  expect(scoreDeliveredEvidence(query, [{ ...hit, text: '## Alpha\nThe answer … silver.' }]).labelledSpanRecall).toBe(0);
  expect(scoreDeliveredEvidence(query, [{ ...hit, text: query.relevant[0]!.quote, ambiguousHighlight: true }]).labelledSpanRecall).toBe(0);
  expect(scoreDeliveredEvidence(query, [{ ...hit, text: 'The answer is silver.' }]).labelledLineCoverage).toBe(.5);
  const noAnswer = { ...query, relevant: [] };
  expect(scoreDeliveredEvidence(noAnswer, [hit]).unanswerableFalsePositive).toBe(true);
  expect(summariseDelivered([{ query: noAnswer, hits: [], payload: '{"hits":[]}' }])).toMatchObject({
    falsePositives: 0, unanswerable: 1, maxPayloadBytes: 11, labelledSpanRecall: null,
  });
});

test('unknown query terms are not discarded and quoted identifiers stay phrases', () => {
  expect(queryUnits('"ABC-123-X" rollout')).toEqual(['abc-123-x', 'rollout']);
  expect(queryUnits('alpha missing thing')).toEqual(['alpha', 'missing', 'thing']);
  expect(queryUnits('alpha "')).toBeNull(); expect(queryUnits('x'.repeat(513))).toBeNull();
  const db = new Database(':memory:');
  try {
    createPassageIndex(db, [{ path: 'notes/a.md', bytes: Buffer.from('## Alpha\nThe answer is silver.\n') }]);
    expect(retrievePassages(db, 'alpha missing thing', 'passage-or').hits).toHaveLength(1);
    expect(retrievePassages(db, 'alpha missing thing', 'passage-two-thirds')).toMatchObject({ status: 'insufficient_term_coverage', hits: [] });
    expect(retrievePassages(db, 'alpha silver', 'passage-all').hits).toHaveLength(1);
    expect(retrievePassages(db, 'missing', 'passage-all')).toMatchObject({ status: 'no_lexical_match', hits: [] });
    expect(retrievePassages(db, 'alpha "', 'passage-all').status).toBe('invalid_query');
  } finally { db.close(); }
});

test('lexical coverage is not proof of an answer even when every query term matches', () => {
  const db = new Database(':memory:');
  try {
    createPassageIndex(db, [{ path: 'notes/vocabulary.md', bytes: Buffer.from('# Vocabulary\nOrchid insurance price: these are vocabulary words, no price is recorded.\n') }]);
    const output = retrievePassages(db, 'orchid insurance price', 'passage-all');
    expect(output.hits.length).toBeGreaterThan(0);
    expect(scoreDeliveredEvidence({ ...query, relevant: [] }, output.hits).unanswerableFalsePositive).toBe(true);
  } finally { db.close(); }
});

test('duplicate snippets cannot substitute a wrong path or inflate labelled span coverage', () => {
  const refs = [query.relevant[0]!, { path: 'notes/a.md', lineStart: 4, lineEnd: 5, quote: '## Beta\nAnother answer.' }];
  expect(scoreDeliveredEvidence({ ...query, relevant: refs }, [{ path: 'notes/a.md', text: refs[0]!.quote }])).toMatchObject({ labelledSpanRecall: .5, fileSectionUpperBound: 1 });
  expect(scoreDeliveredEvidence(query, [{ path: 'notes/wrong.md', text: refs[0]!.quote }]).labelledSpanRecall).toBe(0);
  const bracket = { ...query, relevant: [{ ...refs[0]!, quote: 'A literal [link] belongs here.' }] };
  expect(scoreDeliveredEvidence(bracket, [{ path: 'notes/a.md', text: 'A literal [link] belongs here.' }]).labelledSpanRecall).toBe(1);
  expect(scoreDeliveredEvidence(bracket, [{ path: 'notes/a.md', text: 'A literal link belongs here.' }]).labelledSpanRecall).toBe(0);
});

test('binary path ties and payloads survive reversed insertion; budget retains complete source lines', () => {
  const sources = ['z', 'a', 'm'].map(name => ({ path: `notes/${name}.md`, bytes: Buffer.from('## Alpha\nThe answer is silver.\n') }));
  const first = new Database(':memory:'), second = new Database(':memory:');
  try {
    createPassageIndex(first, sources); createPassageIndex(second, [...sources].reverse());
    const a = retrievePassages(first, 'silver', 'passage-all'), b = retrievePassages(second, 'silver', 'passage-all');
    expect(a).toEqual(b); expect(a.hits.map(hit => hit.path)).toEqual(['notes/a.md', 'notes/m.md', 'notes/z.md']);
    expect(Buffer.byteLength(JSON.stringify(a))).toBeLessThanOrEqual(POLICY.responseBytes);
  } finally { first.close(); second.close(); }
  const db = new Database(':memory:'), text = '## Alpha\n' + 'silver line with exact source words\n'.repeat(160);
  try {
    createPassageIndex(db, [{ path: 'notes/long.md', bytes: Buffer.from(text) }]);
    const output = retrievePassages(db, 'silver', 'passage-all');
    expect(output.limited).toBe(true); expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(POLICY.responseBytes);
    for (const hit of output.hits) expect(hit.text).toBe(text.split(/(?<=\n)/).slice(hit.lineStart - 1, hit.lineEnd).join(''));
  } finally { db.close(); }
});

test('Porter/diacritic-equivalent units cannot inflate coverage and path-only matches abstain', () => {
  const db = new Database(':memory:');
  try {
    createPassageIndex(db, [{ path: 'notes/secret.md', bytes: Buffer.from('## Activity\nRunning in the café.\n') }]);
    expect(retrievePassages(db, 'run running absent', 'passage-two-thirds').hits).toHaveLength(0);
    expect(retrievePassages(db, 'cafe café absent', 'passage-two-thirds').hits).toHaveLength(0);
    expect(retrievePassages(db, 'secret', 'passage-or')).toMatchObject({ status: 'insufficient_term_coverage', hits: [] });
    expect(retrievePassages(db, 'run running cafe', 'passage-all').hits[0]).toMatchObject({ matchedTerms: 2, queryTerms: 2 });
  } finally { db.close(); }
});

test('candidate cutoff is explicit instead of claiming a definitive no match', () => {
  const db = new Database(':memory:');
  try {
    createPassageIndex(db, Array.from({ length: 51 }, (_, i) => ({ path: `notes/alpha-${i}.md`, bytes: Buffer.from('unrelated text\n') })));
    // Topic words in paths generate candidates but provide no delivered evidence.
    expect(retrievePassages(db, 'alpha absent', 'passage-two-thirds')).toMatchObject({ status: 'candidate_limit', limited: true, hits: [] });
    db.query('DELETE FROM passage_fts WHERE rowid=51').run();
    expect(retrievePassages(db, 'alpha absent', 'passage-two-thirds')).toMatchObject({ status: 'insufficient_term_coverage', limited: false, hits: [] });
  } finally { db.close(); }
});

test('result count is bounded independently of bytes; multi-byte text stays within the payload cap', () => {
  const db = new Database(':memory:');
  try {
    createPassageIndex(db, Array.from({ length: 6 }, (_, i) => ({ path: `notes/${i}.md`, bytes: Buffer.from('## Silver\nsmall\n') })));
    expect(retrievePassages(db, 'silver', 'passage-or')).toMatchObject({ limited: true });
    expect(retrievePassages(db, 'silver', 'passage-or').hits).toHaveLength(5);
  } finally { db.close(); }
  const unicode = new Database(':memory:');
  try {
    createPassageIndex(unicode, Array.from({ length: 8 }, (_, i) => ({ path: `notes/${i}.md`, bytes: Buffer.from('# Silver\n' + '漢字é '.repeat(170) + '\n') })));
    const output = retrievePassages(unicode, 'silver', 'passage-or');
    expect(output.limited).toBe(true); expect(output.hits.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(POLICY.responseBytes);
  } finally { unicode.close(); }
});

test('held-out freeze rejects drift in any candidate, evaluator, source, corpus or dependency fingerprint', () => {
  const expected = { experimentSha256: 'candidate', productionSourceSha256: 'source', corpusSha256: 'notes', dependenciesSha256: 'lockfile' };
  expect(() => verifyExperimentFreeze(expected, expected)).not.toThrow();
  for (const key of Object.keys(expected)) expect(() => verifyExperimentFreeze({ ...expected, [key]: 'changed' }, expected)).toThrow('freeze mismatch');
});

test('development experiment measures the actual tool and is stable across fresh-process reopen and reversed builds', async () => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '../scripts/note-passage-experiment.ts'), '--small'], {
    env: { ...process.env }, stdout: 'pipe', stderr: 'pipe',
  });
  const timer = setTimeout(() => child.kill(), 60_000);
  try {
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exit !== 0) throw Error(err);
    const report = JSON.parse(out);
    expect(report.split).toBe('development'); expect(report.stable).toBe(true); expect(report.reports).toHaveLength(4);
    for (const run of report.reports) {
      expect(run.results).toHaveLength(48);
      expect(run.results.every((row: {stable: boolean}) => row.stable)).toBe(true);
      expect(run.summary['passage-two-thirds'].labelledSpanRecall).toBeGreaterThan(run.summary['current-tool'].labelledSpanRecall);
      expect(run.summary['passage-two-thirds'].falsePositives).toBeLessThanOrEqual(run.summary['current-tool'].falsePositives);
      expect(run.summary['passage-two-thirds'].maxPayloadBytes).toBeLessThanOrEqual(POLICY.responseBytes);
      expect(run.summary['passage-two-thirds']).not.toHaveProperty('completeAnswers');
    }
  } finally { clearTimeout(timer); }
}, 90_000);
