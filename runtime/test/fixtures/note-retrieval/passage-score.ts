import type { Query } from './scoring.js';

export interface DeliveredHit { path: string; text: string; ambiguousHighlight?: boolean }
export function scoreDeliveredEvidence(query: Query, hits: DeliveredHit[]) {
  const normal = (text: string) => text.replaceAll('\r\n', '\n');
  // Labels never influence ranking or passage selection. Do not read full files
  // here, remove headings, use words in any order, or award filename-only credit.
  const texts = (path: string) => hits.filter(hit => hit.path === path && !hit.ambiguousHighlight).map(hit => normal(hit.text));
  const covered = query.relevant.filter(ref => texts(ref.path).some(text => text.includes(normal(ref.quote)))).length;
  const coveredLines = query.relevant.map(ref => {
    const lines = normal(ref.quote).split('\n').filter(line => line.trim());
    return lines.filter(line => texts(ref.path).some(text => text.split('\n').includes(line))).length / lines.length;
  });
  const usefulHits = hits.filter(hit => !hit.ambiguousHighlight && query.relevant.some(ref => ref.path === hit.path
    && normal(ref.quote).split('\n').filter(line => line.trim()).some(line => normal(hit.text).split('\n').includes(line)))).length;
  return {
    labelledSpanRecall: query.relevant.length ? covered / query.relevant.length : null,
    labelledLineCoverage: query.relevant.length ? coveredLines.reduce((sum, value) => sum + value, 0) / coveredLines.length : null,
    fileSectionUpperBound: query.relevant.length ? query.relevant.filter(ref => hits.some(hit => hit.path === ref.path)).length / query.relevant.length : null,
    usefulHitFraction: hits.length ? usefulHits / hits.length : 0,
    unanswerableFalsePositive: !query.relevant.length && hits.length > 0,
    allLabelledSpansDelivered: query.relevant.length > 0 && covered === query.relevant.length,
    abstained: hits.length === 0,
    conflictingHits: hits.filter(hit => query.conflictingPaths?.includes(hit.path)).length,
    ambiguousHits: hits.filter(hit => hit.ambiguousHighlight).length,
  };
}

export function summariseDelivered(rows: Array<{ query: Query; hits: DeliveredHit[]; payload: string }>) {
  const scores = rows.map(row => ({ ...scoreDeliveredEvidence(row.query, row.hits), bytes: Buffer.byteLength(row.payload) }));
  const answerable = scores.filter(score => score.labelledSpanRecall !== null);
  const empty = scores.filter(score => score.labelledSpanRecall === null);
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return {
    queries: rows.length, answerable: answerable.length, unanswerable: empty.length,
    labelledSpanRecall: mean(answerable.map(score => score.labelledSpanRecall!)),
    labelledLineCoverage: mean(answerable.map(score => score.labelledLineCoverage!)),
    fileSectionUpperBound: mean(answerable.map(score => score.fileSectionUpperBound!)),
    usefulHitFraction: mean(answerable.map(score => score.usefulHitFraction)),
    queriesWithAllLabelledSpans: answerable.filter(score => score.allLabelledSpansDelivered).length,
    answerableAbstentions: answerable.filter(score => score.abstained).length,
    falsePositives: empty.filter(score => score.unanswerableFalsePositive).length,
    unanswerableFalsePositiveRate: mean(empty.map(score => Number(score.unanswerableFalsePositive))),
    conflictingHits: scores.reduce((sum, score) => sum + score.conflictingHits, 0),
    ambiguousHighlights: scores.reduce((sum, score) => sum + score.ambiguousHits, 0),
    meanPayloadBytes: mean(scores.map(score => score.bytes)), maxPayloadBytes: Math.max(0, ...scores.map(score => score.bytes)),
  };
}
