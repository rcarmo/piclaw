import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { experimentFingerprint } from './passage-fingerprint.js';
export function anchorFingerprint(root:string){
 const base=experimentFingerprint(root),fixture='runtime/test/fixtures/note-retrieval';
 const hash=(paths:string[])=>{const h=createHash('sha256');for(const p of paths.sort())h.update(p).update('\0').update(readFileSync(join(root,p))).update('\0');return h.digest('hex');};
 const hard=`${fixture}/hard-v2`;
 return{...base,anchorCodeSha256:hash(['runtime/scripts/note-anchor-experiment.ts','runtime/test/note-anchor-experiment.test.ts',...['anchor-experiment.ts','anchor-corpus.ts','anchor-worker.ts','anchor-fingerprint.ts'].map(n=>`${fixture}/${n}`)]),
 hardCorpusSha256:hash([`${hard}/manifest.json`,`${hard}/development.json`,`${hard}/held-out.json`,...readdirSync(join(root,hard,'notes')).map(n=>`${hard}/notes/${n}`)])};
}
export function verifyAnchorFreeze(actual:ReturnType<typeof anchorFingerprint>,expected:ReturnType<typeof anchorFingerprint>){
 for(const key of Object.keys(actual) as Array<keyof typeof actual>)if(actual[key]!==expected[key])throw Error(`Anchor freeze mismatch: ${key}`);
}
