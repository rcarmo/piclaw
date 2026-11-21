import type { DurableTurnEntry } from '../../../agent-pool/durable-runtime-adapter.js';

export const optimizerOperationKind = 'piclaw.token-optimizer.operation';
export const optimizerFactContextKind = 'token-economizer.fact-context';

const titles = new Map([
  ['optimizer.learn', 'Learn from recent work'], ['optimizer.fold', 'Review session evidence'],
  ['optimizer.fact-review', 'Update learned facts'], ['optimizer.nudge', 'Nudge the Agent'],
  ['optimizer.goal-check', 'Check task progress'], ['optimizer.prepare-tools', 'Pick tools for the task'],
  ['optimizer.apply-tools', 'Hide unused tools'], ['optimizer.restore-tools', 'Restore hidden tools'],
  ['optimizer.fit', 'Train local classifiers'], ['optimizer.proposer', 'Suggest repository facts'],
  ['optimizer.loop-judge', 'Check whether the run is stuck'], ['optimizer.writer', 'Write a nudge'],
  ['optimizer.tool-judge', 'Judge which tools the task needs'], ['optimizer.classifier', 'Classify a decision'],
  ['optimizer.audit', 'Double-check a local decision'], ['optimizer.output-summary', 'Summarise a long tool output'],
]);
const goalReasons = new Map([
  ['goal-reminder', 'Recalled the current task'], ['hypothesis-change', 'Suggested a different hypothesis'],
  ['verification-debt', 'Flagged unverified edits'], ['completion-check', 'Checked remaining deliverables'],
]);
const statuses = new Map([
  ['queued', 'running'], ['running', 'running'], ['complete', 'ok'],
  ['failed', 'error'], ['unknown', 'error'], ['cancelled', 'aborted'],
] as const);
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const count = (value: unknown) => Array.isArray(value) ? value.length : 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function operation(entry: DurableTurnEntry) {
  if (entry.kind !== optimizerOperationKind) return null;
  const data = record(entry.data);
  if (!data || typeof data.id !== 'string' || !data.id || typeof data.name !== 'string' || !titles.has(data.name)) return null;
  const state = data.status as Parameters<typeof statuses.get>[0];
  return statuses.has(state) ? { id: data.id, name: data.name, state, started: data.startedAt, at: data.at, input: record(data.input), output: record(data.output) } : null;
}

/** Read receipts only. Use bounded, allowlisted facts, not evidence, side prompts,
 * model responses, or provider diagnostics from the recorded operation. */
export function optimizerActivityRows(entries: readonly DurableTurnEntry[]) {
  const operations = new Map<string, { entryId: number; first: NonNullable<ReturnType<typeof operation>>; last: NonNullable<ReturnType<typeof operation>> }>();
  const rows = new Map<number, { name: string; title: string; status: 'running' | 'ok' | 'error' | 'aborted'; duration_ms: number | null; details: string }>();
  for (const entry of entries) {
    if (entry.kind === optimizerFactContextKind) {
      const facts = count(record(entry.data)?.injectedIds);
      if (facts) rows.set(entry.id, { name: 'optimizer.facts', title: 'Optimiser · Applied learned facts', status: 'ok', duration_ms: null, details: `${facts} learned fact${facts === 1 ? '' : 's'} applied to the request.` });
      continue;
    }
    const receipt = operation(entry);
    if (!receipt) continue;
    const previous = operations.get(receipt.id);
    if (previous) previous.last = receipt;
    else operations.set(receipt.id, { entryId: entry.id, first: receipt, last: receipt });
  }
  for (const { entryId, first, last } of operations.values()) {
    const { name, output, state } = last;
    const input = last.input ?? first.input;
    const status = statuses.get(state)!;
    let title = titles.get(name)!;
    const lines = [state === 'unknown' ? 'Interrupted.' : `${state[0]!.toUpperCase()}${state.slice(1)}.`];
    if (name === 'optimizer.learn' || name === 'optimizer.fold') {
      const changes = record(output?.changes), learning = record(output?.learning);
      const changed = count(changes?.facts), suggested = count(changes?.suggestedTools), withdrawn = count(changes?.withdrawnTools);
      // Match Kintsugi: completed checks with no visible change stay in history only.
      if (status === 'ok' && changes && !changed && !suggested && !withdrawn && !count(learning?.notes) && !['failed', 'unknown', 'cancelled'].includes(String(learning?.proposer))) continue;
      if (changed) lines.push(`Facts updated: ${changed}.`);
      if (suggested || withdrawn) lines.push(`Tool suggestions: ${suggested} added, ${withdrawn} withdrawn.`);
      if (learning?.proposer === 'failed') lines.push('Fact proposal failed.');
    }
    if (name === 'optimizer.goal-check' && typeof input?.reason === 'string') title = goalReasons.get(input.reason) ?? title;
    if (output?.delivery === 'simulated') { title += ' (Watch only)'; lines.splice(0, lines.length, 'Observed only. No advice was sent.'); }
    else if (input?.mode === 'observe') title += ' (Watch only)';
    if (output?.delivery === 'undelivered') lines.push('Advice was not delivered.');
    if (name === 'optimizer.apply-tools' || name === 'optimizer.prepare-tools') {
      const hidden = count(output?.hidden);
      if (hidden) lines.push(`${output?.applied === false ? 'Would hide' : 'Tools hidden:'} ${hidden}.`);
    }
    if (name === 'optimizer.restore-tools' && count(output?.restored)) lines.push(`Tools restored: ${count(output?.restored)}.`);
    rows.set(entryId, { name, title: `Optimiser · ${title}`, status, duration_ms: status !== 'running' && finite(first.started) && finite(last.at) ? Math.max(0, last.at - first.started) : null, details: lines.join('\n') });
  }
  return rows;
}
