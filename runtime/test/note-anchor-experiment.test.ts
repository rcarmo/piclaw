import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { buildAnchorIndex, retrieveAnchored, exactAnchor, ANCHOR_POLICY } from './fixtures/note-retrieval/anchor-experiment.js';
import { createPassageIndex, retrievePassages } from './fixtures/note-retrieval/passage-experiment.js';
import { loadAnchorCorpus } from './fixtures/note-retrieval/anchor-corpus.js';
import { verifyAnchorFreeze } from './fixtures/note-retrieval/anchor-fingerprint.js';
import './helpers.js';
const source=(path:string,text:string)=>({path:`notes/${path}.md`,bytes:Buffer.from(text)});

test('hard corpus development labels and hashes were authored before ranking',()=>{
 const corpus=loadAnchorCorpus(join(import.meta.dir,'fixtures/note-retrieval'),'hard','development');
 expect(corpus.queries).toHaveLength(12);expect(corpus.queries.filter(q=>q.relevant.length)).toHaveLength(7);
});
test('exact anchors require token boundaries, literal punctuation and surface form',()=>{
 expect(exactAnchor('unit Blue Finch has ID', 'Blue Finch')).toBe(true);
 for(const text of ['Blue Finches','Finch Blue','Blue-Finch','blue finch'])expect(exactAnchor(text,'Blue Finch')).toBe(false);
 expect(exactAnchor('ID AB-12X','AB-12')).toBe(false);expect(exactAnchor('ID AB-12-34','AB-12')).toBe(false);
 expect(exactAnchor('ID AB-12. Next sentence.','AB-12')).toBe(true);expect(exactAnchor('ID AB-12.extra','AB-12')).toBe(false);
 expect(exactAnchor('cafe\u0301','cafe')).toBe(false);
 const db=new Database(':memory:');
 try{buildAnchorIndex(db,[source('exact','## Device\nBlue Finch AB-12 shelf seven.\n'),source('near','## Device\nBlue Finches AB-12X shelf seven.\n')]);
  expect(retrieveAnchored(db,'"Blue Finch" AB-12 shelf').hits.map(h=>h.path)).toEqual(['notes/exact.md']);
  expect(retrieveAnchored(db,'"Missing Bird" shelf').hits).toHaveLength(0);
 }finally{db.close();}
});
test('adjacent context expansion keeps complete source lines and deduplicates overlapping hits',()=>{
 const text='# Workshop\n\nThe card applies to press Wren.\n\nIts key is in cabinet E7.\n\nOther work waits.\n';
 const db=new Database(':memory:');
 try{buildAnchorIndex(db,[source('workshop',text)]);
  const result=retrieveAnchored(db,'press Wren key cabinet');
  expect(result.hits).toHaveLength(1);expect(result.hits[0]!.text).toContain('press Wren.\n\nIts key');
  for(const h of result.hits)expect(h.text).toBe(text.split(/(?<=\n)/).slice(h.lineStart-1,h.lineEnd).join(''));
  expect(retrieveAnchored(db,'press Wren key cabinet','without-expansion').hits).toHaveLength(0);
 }finally{db.close();}
});
test('all-term stream rescues a qualifying long passage below the first fifty OR hits',()=>{
 const sources=[...Array.from({length:120},(_,i)=>source(`d${i}`,i<60?'alpha alpha alpha\n':'beta beta beta\n')),
 source('answer','# Instructions\nalpha beta '+ 'neutral '.repeat(170)+'\n')];
 const db=new Database(':memory:');
 try{buildAnchorIndex(db,sources);createPassageIndex(db,sources);
  const next=retrieveAnchored(db,'alpha beta');expect(next.hits.some(h=>h.path==='notes/answer.md')).toBe(true);
  expect(next.limited).toBe(true);
  // This fixture must actually demonstrate starvation, not merely assert v2 hits.
  expect(retrievePassages(db,'alpha beta','passage-two-thirds').hits.some(h=>h.path==='notes/answer.md')).toBe(false);
 }finally{db.close();}
});
test('proximity orders equally covered passages while metadata is preserved without a recency boost',()=>{
 const near='# Card\nStatus: archived\nDate: 2011-01-01\n\nalpha beta '+ 'neutral '.repeat(15)+'\n';
 const far='# Card\nStatus: current\nDate: 2030-01-01\n\nalpha '+ 'neutral '.repeat(15)+'beta\n';
 const db=new Database(':memory:');
 try{buildAnchorIndex(db,[source('a-far',far),source('z-near',near)]);
  const result=retrieveAnchored(db,'alpha beta');expect(result.hits[0]!.path).toBe('notes/z-near.md');
  expect(result.hits[0]!.sourceStatus).toBe('archived');expect(result.hits[0]!.sourceDate).toBe('2011-01-01');
  expect(result.hits.some(h=>h.sourceStatus==='current')).toBe(true);
 }finally{db.close();}
});
test('weighted coverage does not claim absent facts are knowable; output is bounded and deterministic',()=>{
 const sources=Array.from({length:8},(_,i)=>source(`p${i}`,'# Alpha\nalpha support phone number is not recorded.\n'));
 const a=new Database(':memory:'),b=new Database(':memory:');
 try{buildAnchorIndex(a,sources);buildAnchorIndex(b,[...sources].reverse());
  const result=retrieveAnchored(a,'alpha support phone number');
  expect(result.hits.length).toBeGreaterThan(0); // semantic no-answer limitation, not a pass claim
  expect(result).toEqual(retrieveAnchored(b,'alpha support phone number'));
  expect(result.hits.length).toBeLessThanOrEqual(ANCHOR_POLICY.maxHits);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(ANCHOR_POLICY.responseBytes);
  expect(retrieveAnchored(a,'alpha absent unusual concept').hits).toHaveLength(0);
  expect(retrieveAnchored(a,'bad "').status).toBe('invalid_query');
 }finally{a.close();b.close();}
});
test('source/window omissions and fingerprint drift are explicit',()=>{
 const db=new Database(':memory:');
 try{buildAnchorIndex(db,[source('large','# Title\n\n'+'w'.repeat(2000)+'\n')]);
  expect(retrieveAnchored(db,'Title').reasons).toContain('source_window_exclusion');
  expect(retrieveAnchored(db,'missing').status).toBe('incomplete');
 }finally{db.close();}
 const hash={experimentSha256:'v1',productionSourceSha256:'src',corpusSha256:'old',dependenciesSha256:'deps',anchorCodeSha256:'v2',hardCorpusSha256:'hard'};
 expect(()=>verifyAnchorFreeze(hash,hash)).not.toThrow();
 for(const key of Object.keys(hash))expect(()=>verifyAnchorFreeze({...hash,[key]:'drift'},hash)).toThrow('freeze mismatch');
});
test('bridge expansion never leaves overlapping hits and quoted anchors get no guessed stem proximity',()=>{
 const text='# Links\n\nalpha '+ 'filler '.repeat(12)+'\n\nbeta '+ 'filler '.repeat(12)+'\n\ngamma '+ 'filler '.repeat(12)+'\n\ndelta '+ 'filler '.repeat(12)+'\n';
 const db=new Database(':memory:');
 try{buildAnchorIndex(db,[source('links',text),source('near-form','# Record\nExact Bird is recorded here. Birds nearer alpha are a different phrase.\n')]);
  const result=retrieveAnchored(db,'alpha beta gamma delta');
  for(let i=0;i<result.hits.length;i++)for(let j=i+1;j<result.hits.length;j++){
   const a=result.hits[i]!,b=result.hits[j]!;
   expect(a.path!==b.path||a.lineEnd<b.lineStart||b.lineEnd<a.lineStart).toBe(true);
  }
  for(const hit of result.hits)expect(hit.text).toBe(text.split(/(?<=\n)/).slice(hit.lineStart-1,hit.lineEnd).join(''));
  const anchored=retrieveAnchored(db,'"Exact Bird" alpha');expect(anchored.hits.length).toBeGreaterThan(0);expect(anchored.hits[0]!.proximityTokens).toBeNull();
 }finally{db.close();}
});
test('long complete-line prose is searchable; multibyte output stays inside serialized budget',()=>{
 const text='# Long topic\n\n'+('Silver passage '+ '漢字 '.repeat(12)+'\n').repeat(90);
 const db=new Database(':memory:');
 try{buildAnchorIndex(db,[source('long',text)]);
  const result=retrieveAnchored(db,'silver passage');expect(result.hits.length).toBeGreaterThan(0);
  expect(result.reasons).not.toContain('source_window_exclusion');expect(result.limited).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(ANCHOR_POLICY.responseBytes);
  for(const hit of result.hits)expect(hit.text).toBe(text.split(/(?<=\n)/).slice(hit.lineStart-1,hit.lineEnd).join(''));
 }finally{db.close();}
});
test('development v2 payloads survive fresh-process reopen and independent reversed builds',async()=>{
 const child=Bun.spawn([process.execPath,join(import.meta.dir,'../scripts/note-anchor-experiment.ts'),'--small'],{env:{...process.env},stdout:'pipe',stderr:'pipe'});
 const timer=setTimeout(()=>child.kill(),90000);
 try{const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(code!==0)throw Error(err);
  const report=JSON.parse(out);expect(report.split).toBe('development');expect(report.dataset).toBe('hard');expect(report.stable).toBe(true);expect(report.reports).toHaveLength(4);
  for(const run of report.reports){expect(run.summary['anchors-v2'].queries).toBe(12);expect(run.summary['anchors-v2'].invalidQueries).toBe(0);expect(run.summary['anchors-v2'].maxPayloadBytes).toBeLessThanOrEqual(ANCHOR_POLICY.responseBytes);expect(run.results.every((r:any)=>r.stable)).toBe(true);}
 }finally{clearTimeout(timer);}
},120000);
