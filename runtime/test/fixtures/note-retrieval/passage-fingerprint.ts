import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Bind held-out runs to candidate, evaluator, imported production source and
 * frozen data. No result file participates in its own fingerprint. */
export function experimentFingerprint(repository: string) {
  const fixture = 'runtime/test/fixtures/note-retrieval';
  const hash = (names: string[]) => {
    const digest = createHash('sha256');
    for (const name of names.sort()) digest.update(name).update('\0').update(readFileSync(join(repository, name))).update('\0');
    return digest.digest('hex');
  };
  const walk = (directory: string): string[] => readdirSync(join(repository, directory), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(`${directory}/${entry.name}`) : entry.isFile() ? [`${directory}/${entry.name}`] : []);
  return {
    experimentSha256: hash(['runtime/scripts/note-passage-experiment.ts', 'runtime/test/note-passage-experiment.test.ts',
      ...['passage-experiment.ts', 'passage-score.ts', 'passage-worker.ts', 'passage-fingerprint.ts', 'scoring.ts'].map(name => `${fixture}/${name}`)]),
    productionSourceSha256: hash(walk('runtime/src')),
    corpusSha256: hash([`${fixture}/corpus.json`, `${fixture}/frozen-sha256.json`, ...walk(`${fixture}/notes`)]),
    dependenciesSha256: hash(['package.json', 'bun.lock']),
  };
}

export function verifyExperimentFreeze(actual: ReturnType<typeof experimentFingerprint>, expected: ReturnType<typeof experimentFingerprint>): void {
  for (const key of Object.keys(actual) as Array<keyof typeof actual>) {
    if (actual[key] !== expected[key]) throw Error(`Held-out freeze mismatch: ${key}`);
  }
}
