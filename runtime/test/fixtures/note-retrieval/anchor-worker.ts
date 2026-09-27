/** Harder fixture-only ablation worker. Production search is comparison-only. */
import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPassageIndex, retrievePassages } from './passage-experiment.js';
import { ANCHOR_POLICY, ANCHOR_VARIANTS, buildAnchorIndex, retrieveAnchored } from './anchor-experiment.js';
import { loadAnchorCorpus } from './anchor-corpus.js';
import { percentile } from './scoring.js';
import { scoreDeliveredEvidence, summariseDelivered, type DeliveredHit } from './passage-score.js';
import { assertPathWithinTestFilesystemIsolation, getActiveTestFilesystemIsolationRoot } from '../../../scripts/test-filesystem-isolation.js';

if (!getActiveTestFilesystemIsolationRoot()) throw Error('Requires isolated local launcher');
const workspace = process.env.PICLAW_WORKSPACE!;
for (const path of [workspace, process.env.PICLAW_STORE!, process.env.PICLAW_DATA!]) assertPathWithinTestFilesystemIsolation(path);
const [mode, split, scaleArg, direction, dataset] = process.argv.slice(2);
const scale = Number(scaleArg);
if (!['build', 'reopen'].includes(mode!) || !['development', 'held-out'].includes(split!)
  || ![0, 500].includes(scale) || !['forward', 'reverse'].includes(direction!) || !['original','hard'].includes(dataset!)) throw Error('Invalid experiment arguments');
const corpus = loadAnchorCorpus(import.meta.dir, dataset as 'original'|'hard', split as 'development'|'held-out');
const corpusRoot = dataset === 'hard' ? join(import.meta.dir,'hard-v2') : import.meta.dir;
const sources = readdirSync(join(corpusRoot, 'notes')).sort().map(name => ({ path: `notes/${name}`, bytes: readFileSync(join(corpusRoot, 'notes', name)) }));
// Realistic bounded lines/paragraphs: unlike v1, all filler content can be indexed.
for (let i = 0; i < scale; i++) sources.push({ path: `notes/scale-${String(i).padStart(4,'0')}.md`,
  bytes: Buffer.from(`# Synthetic filler ${i}\n\n${('Neutral inventory padding about trays and baskets.\n'.repeat(4) + '\n').repeat(6)}`) });
if (direction === 'reverse') sources.reverse();
process.env.PICLAW_DB_IN_MEMORY = '0'; process.env.PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX = '1';
if (mode === 'build') {
  mkdirSync(join(workspace,'.piclaw'),{recursive:true}); mkdirSync(join(workspace,'notes'),{recursive:true});
  writeFileSync(join(workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'},tools:{workspaceSearchRoots:['notes'],searchMatchMode:'or'}}}));
  for (const source of sources) writeFileSync(join(workspace,source.path),source.bytes);
}
const dbModule = await import('../../../src/db.js'); dbModule.initDatabase();
const search = await import('../../../src/workspace-search.js'); search.setBackgroundWorkspaceIndexRefreshRequesterForTests(()=>{});
if(mode==='build'){
  const status=await search.refreshWorkspaceIndex({scope:'notes',max_kb:512});
  if(status.state!=='ready'||status.indexed_file_count!==sources.length)throw Error('Incomplete baseline index');
}
const {workspaceSearch}=await import('../../../src/extensions/workspace-search.js');
let executeTool:((...args:any[])=>Promise<any>)|undefined;
workspaceSearch({on(){},registerTool(tool:any){if(tool.name==='search_workspace')executeTool=tool.execute;}} as any);
if(!executeTool)throw Error('Missing production tool');
const db=new Database(join(workspace,'anchors.sqlite'));
const start=performance.now();
if(mode==='build'){createPassageIndex(db,sources);buildAnchorIndex(db,sources);}
const indexMs=performance.now()-start;
const results=[];
for(const query of corpus.queries){
  const response=await executeTool('fixture',{query:query.query,scope:'notes',limit:5},undefined,undefined,{hasUI:false});
  if(!response.content[0].text.startsWith('Found ')&&response.content[0].text!=='No matching workspace files found.')throw Error('Baseline search error');
  const payload=response.content.map((part:{text:string})=>part.text).join('\n');
  const hits:DeliveredHit[]=response.details.results.map((row:{path:string;snippet:string})=>{
    const source=sources.find(item=>item.path===row.path)!;
    const ambiguousHighlight=/[\[\]]/.test(source.bytes.toString('utf8'));
    if(!payload.includes(`• ${row.path} — ${row.snippet}`))throw Error('Hidden/mismatched snippet');
    return {path:row.path,text:ambiguousHighlight?row.snippet:row.snippet.replace(/[\[\]]/g,''),ambiguousHighlight};
  });
  let stable=true;
  for(let i=0;i<5;i++){
    const again=await executeTool('fixture',{query:query.query,scope:'notes',limit:5},undefined,undefined,{hasUI:false});
    if(again.content.map((part:{text:string})=>part.text).join('\n')!==payload)stable=false;
  }
  results.push({variant:'current-tool',query,hits,payload,stable,score:scoreDeliveredEvidence(query,hits),warmP95Ms:null as number|null,status:hits.length?'matches':'no_lexical_match',limited:false});
  for(const variant of ['v1-two-thirds',...ANCHOR_VARIANTS] as const){
    const retrieve=()=>variant==='v1-two-thirds'?retrievePassages(db,query.query,'passage-two-thirds'):retrieveAnchored(db,query.query,variant);
    const encoded=JSON.stringify(retrieve()),observed=JSON.parse(encoded),timings:number[]=[];
    let stable=true;
    for(let i=0;i<5;i++){const t=performance.now(),again=JSON.stringify(retrieve());timings.push(performance.now()-t);if(again!==encoded)stable=false;}
    results.push({variant,query,hits:observed.hits as DeliveredHit[],payload:encoded,stable,score:scoreDeliveredEvidence(query,observed.hits),warmP95Ms:percentile(timings,.95),status:observed.status,limited:observed.limited});
  }
}
const summary=Object.fromEntries(['current-tool','v1-two-thirds',...ANCHOR_VARIANTS].map(variant=>{
  const rows=results.filter(row=>row.variant===variant);
  return[variant,{...summariseDelivered(rows),invalidQueries:rows.filter(row=>row.status==='invalid_query').length,limitedQueries:rows.filter(row=>row.limited).length,
    unsupportedNegativeQueries:rows.filter(row=>!row.query.relevant.length&&row.status==='invalid_query').length,
    supportedNegativeQueries:rows.filter(row=>!row.query.relevant.length&&row.status!=='invalid_query').length,
    supportedNegativeFalsePositiveRate:(()=>{const negatives=rows.filter(row=>!row.query.relevant.length&&row.status!=='invalid_query');return negatives.length?negatives.filter(row=>row.hits.length>0).length/negatives.length:null;})()}];
}));
const bytes=Number((db.query('PRAGMA page_count').get() as {page_count:number}).page_count)*Number((db.query('PRAGMA page_size').get() as {page_size:number}).page_size);
const report={dataset,split,mode,scale,direction,versions:{bun:Bun.version,sqlite:db.query('SELECT sqlite_version() AS version').get()},policy:ANCHOR_POLICY,indexMs,
  sourceBytes:sources.reduce((s,row)=>s+row.bytes.length,0),databaseBytes:bytes,excludedWindows:(db.query('SELECT excluded FROM anchor_meta').get() as {excluded:number}).excluded,
  rssBytes:process.memoryUsage().rss,summary,results:results.map(({query,...result})=>({id:query.id,...result}))};
db.close();dbModule.closeDatabase();
console.log('ANCHOR_REPORT='+JSON.stringify(report));
