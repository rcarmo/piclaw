import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { loadCorpus, type Corpus } from './scoring.js';

export function loadAnchorCorpus(root: string, dataset: 'original'|'hard', split: 'development'|'held-out'): Corpus {
  if (dataset === 'original') { const c = loadCorpus(root); return { ...c, queries: c.queries.filter(q => q.split === split) }; }
  const hard = join(root, 'hard-v2');
  const manifest = JSON.parse(readFileSync(join(hard, 'manifest.json'), 'utf8'));
  const hashes = { 'development.json': manifest.files['development.json'], 'held-out.json': manifest.files['held-out.json'], ...manifest.files.notes } as Record<string,string>;
  for (const [name, expected] of Object.entries(hashes)) {
    const full = resolve(hard, name);
    if (!full.startsWith(resolve(hard) + sep) || createHash('sha256').update(readFileSync(full)).digest('hex') !== expected) throw Error('Hard corpus hash mismatch');
  }
  // Only parse selected labels. Other-split bytes are hashed but not interpreted.
  const corpus = JSON.parse(readFileSync(join(hard, `${split}.json`), 'utf8')) as Corpus;
  const ids = new Set<string>();
  for (const q of corpus.queries) {
    if (q.split !== split || ids.has(q.id)) throw Error('Invalid split/duplicate ID'); ids.add(q.id);
    for (const r of q.relevant) {
      if (!Object.hasOwn(manifest.files.notes, r.path) || r.lineStart < 1 || r.lineEnd < r.lineStart) throw Error('Invalid label');
      if (readFileSync(join(hard,r.path),'utf8').split(/\r?\n/).slice(r.lineStart-1,r.lineEnd).join('\n') !== r.quote) throw Error('Label quote mismatch');
    }
  }
  return corpus;
}
