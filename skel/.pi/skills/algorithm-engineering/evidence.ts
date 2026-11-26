import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function fail(message: string): never { throw new Error(message); }
const object = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected a JSON object');
  return value as Record<string, unknown>;
};
const text = (value: unknown, label: string) =>
  typeof value === 'string' && value.trim() ? value : fail(`Missing ${label}`);
const number = (value: unknown, label: string, min = 0) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fail(`Invalid ${label}`);
const integer = (value: unknown, label: string, min: number, max: number) => {
  const n = number(value, label, min);
  return Number.isSafeInteger(n) && n <= max ? n : fail(`Invalid ${label}`);
};
const commit = (value: unknown) => {
  const id = text(value, 'full Git commit');
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(id) ? id : fail('Expected a full Git commit');
};
const list = (value: unknown, label: string) => {
  if (!Array.isArray(value) || !value.length) fail(`Missing ${label}`);
  return value.map(item => text(item, label));
};
const read = (file: string) => object(JSON.parse(readFileSync(file, 'utf8')));
const marker = (id: number, kind: 'plan' | 'result') => `${String(id).padStart(3, '0')}.${kind}.json`;

// A reader sees either the whole record or no record. linkSync never replaces
// an existing receipt, even if a second invocation races this one.
function publish(dir: string, name: string, value: unknown) {
  const staged = join(dir, `.write-${crypto.randomUUID()}`);
  const fd = openSync(staged, 'wx', 0o600);
  try {
    try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); }
    finally { closeSync(fd); }
    linkSync(staged, join(dir, name));
    const directory = openSync(dir, 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { unlinkSync(staged); }
  return value;
}

function contract(raw: Record<string, unknown>) {
  const metric = object(raw.metric);
  const direction = metric.direction;
  if (direction !== 'lower' && direction !== 'higher') fail('Metric direction must be lower or higher');
  const deadline = text(raw.deadline, 'deadline');
  if (!deadline.endsWith('Z') || !Number.isFinite(Date.parse(deadline))) fail('Use a UTC deadline ending in Z');
  const repetitions = integer(raw.repetitions, 'repetitions', 3, 99);
  if (repetitions % 2 !== 1) fail('Use an odd repetition count');
  const inputs = object(raw.inputSha256);
  if (!Object.keys(inputs).length || Object.values(inputs).some(hash => typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash))) {
    fail('Record SHA-256 hashes for the fixed harness, checks and fixtures');
  }
  return {
    schema: 1, title: text(raw.title, 'title'), baseline: commit(raw.baseline), deadline,
    maxExperiments: integer(raw.maxExperiments, 'maxExperiments', 1, 999), repetitions,
    maxExperimentMs: integer(raw.maxExperimentMs, 'maxExperimentMs', 1, Number.MAX_SAFE_INTEGER),
    maxPeakBytes: integer(raw.maxPeakBytes, 'maxPeakBytes', 1, Number.MAX_SAFE_INTEGER),
    editable: list(raw.editable, 'editable paths'), correctness: text(raw.correctness, 'correctness command'),
    assertions: list(raw.assertions, 'correctness assertions'), benchmark: text(raw.benchmark, 'benchmark command'),
    environment: text(raw.environment, 'environment'), inputSha256: inputs,
    metric: { name: text(metric.name, 'metric name'), unit: text(metric.unit, 'metric unit'), direction,
      minImprovement: number(metric.minImprovement, 'minimum improvement') },
  };
}

function status(dir: string, c: ReturnType<typeof contract>) {
  let best = c.baseline, completed = 0, pending: ReturnType<typeof read> | null = null, baselineFailed = false;
  for (let id = 1; id <= c.maxExperiments; id++) {
    const planFile = join(dir, marker(id, 'plan'));
    if (!existsSync(planFile)) break;
    const plan = read(planFile);
    const resultFile = join(dir, marker(id, 'result'));
    if (!existsSync(resultFile)) { pending = plan; break; }
    const result = read(resultFile);
    completed++;
    if (result.verdict === 'keep') best = commit(result.candidate);
    if (id === 1 && result.verdict !== 'baseline') baselineFailed = true;
  }
  return { best, completed, remaining: c.maxExperiments - completed - Number(pending !== null),
    pending, baselineFailed, deadline: c.deadline, expired: Date.now() >= Date.parse(c.deadline) };
}

function samples(value: unknown, count: number) {
  if (!Array.isArray(value) || value.length !== count) fail(`Expected ${count} finite samples`);
  return value.map(item => number(item, 'metric sample', -Infinity));
}

function run(action: string, dir: string, input?: string) {
  const required = () => read(input ?? fail(`A JSON input file is required for ${action}`));
  if (action === 'init') {
    const c = contract(required());
    if (Date.now() >= Date.parse(c.deadline)) fail('Campaign deadline has expired');
    mkdirSync(dir, { mode: 0o700 }); // Fresh directory only; never take over an existing run.
    return publish(dir, 'contract.json', c);
  }
  const c = contract(read(join(dir, 'contract.json')));
  const s = status(dir, c);
  if (action === 'status') return s;
  if (action === 'begin') {
    if (s.pending) fail('Unresolved experiment; verify its outcome before recording a result');
    if (s.expired || s.baselineFailed || s.remaining < 1) fail('Campaign has stopped');
    const raw = required(), id = s.completed + 1;
    if (commit(raw.parent) !== s.best) fail('Plan parent must match the current best commit');
    return publish(dir, marker(id, 'plan'), { id, parent: s.best, startedAt: new Date().toISOString(),
      hypothesis: text(raw.hypothesis, 'hypothesis'), prediction: text(raw.prediction, 'prediction'),
      falsifier: text(raw.falsifier, 'falsifier') });
  }
  if (action !== 'finish') fail('Expected init, status, begin or finish');
  const pending = s.pending ?? fail('No pending experiment');
  const raw = required(), id = s.completed + 1;
  if (raw.id !== id || raw.startedAt !== pending.startedAt) fail('Result does not match the pending plan');
  const outcome = raw.outcome;
  if (outcome !== 'measured' && outcome !== 'failed' && outcome !== 'interrupted') fail('Invalid experiment outcome');
  const candidate = outcome === 'measured' || raw.candidate != null ? commit(raw.candidate) : null;
  if (candidate && id === 1 && candidate !== c.baseline) fail('Baseline candidate must match the contract');
  if (id > 1 && outcome === 'measured' && candidate === s.best) fail('Candidate must differ from the current best');
  const elapsedMs = number(raw.elapsedMs, 'elapsedMs');
  const peakBytes = raw.peakBytes == null && outcome !== 'measured' ? null : number(raw.peakBytes, 'peakBytes', 1);
  const evidence = list(raw.evidence, 'evidence references');
  const reason = text(raw.reason, 'verdict reason');
  let verdict: string = outcome;
  let measurements: Record<string, unknown> | null = null;
  if (outcome === 'measured') {
    const current = samples(raw.samples, c.repetitions);
    const control = id === 1 ? null : samples(raw.control, c.repetitions);
    const gains = control?.map((value, i) => (value - current[i]!) * (c.metric.direction === 'higher' ? -1 : 1));
    if (gains?.some(gain => !Number.isFinite(gain))) fail('Paired improvement overflow');
    const gain = gains ? [...gains].sort((a, b) => a - b)[Math.floor(gains.length / 2)]! : null;
    measurements = { samples: current, control, medianPairedImprovement: gain };
    if (raw.checksPassed !== true || peakBytes! > c.maxPeakBytes || elapsedMs > c.maxExperimentMs || s.expired) verdict = 'failed';
    else if (id === 1) verdict = 'baseline';
    else if (raw.retain === true && gain! > 0 && gain! >= c.metric.minImprovement) verdict = 'keep';
    else verdict = 'discard';
  }
  return publish(dir, marker(id, 'result'), { id, candidate, outcome, verdict, elapsedMs, peakBytes, measurements,
    evidence, reason, checksPassed: raw.checksPassed === true, finishedAt: new Date().toISOString() });
}

if (import.meta.main) {
  try {
    const [action, dir, input, ...extra] = Bun.argv.slice(2);
    if (!action || !dir || extra.length || (action === 'status' && input)) fail('Usage: bun evidence.ts <init|status|begin|finish> <run-dir> [input.json]');
    console.log(JSON.stringify(run(action, resolve(dir), input), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
