// Offline repository accounting. Never opens application state or runs measured source.
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [coreRoot,addonsRoot,run]=process.argv.slice(2);
if(!coreRoot||!addonsRoot||!run)throw Error('Usage: bun account-production.ts CORE_REPO ADDONS_REPO OUTPUT_DIR');
const require=createRequire(coreRoot+'/package.json');
mkdirSync(run,{recursive:true});
const parser=require('@babel/parser');
const babelTypes=require('@babel/types');
assert.equal(require('@babel/parser/package.json').version,'8.1.2','Pinned parser AST required');
assert.equal(require('@babel/types/package.json').version,'8.1.2','Pinned visitor keys required');
const repos=[
 {name:'core',path:coreRoot,base:'09ba20064965ba5f9fa5430e0721cfe106c343d7',head:'b9dd5ec79e938e3ddeed168472c0d4ac305486c3'},
 {name:'addons',path:addonsRoot,base:'de92bc95b5b3bb1505beec9617d3b8a5e4fa92d3',head:'d534f90e8507db71cdb736afdbd0539c8fa4f802'},
];
const git=(repo:string,args:string[])=>execFileSync('git',['-C',repo,...args],{maxBuffer:32*1024*1024}).toString();
function classify(repo:string,path:string):{area?:string,excluded?:string}{
 if(!/\.(?:[cm]?js|tsx?|sh|css|html)$/.test(path))return{excluded:'non-source/data'};
 if(/\.d\.ts$/.test(path))return{excluded:'declaration-only'};
 if(/(^|\/)(?:test|tests|__tests__|fixtures|__fixtures__|qualification|docs|documentation|specs|artifacts|reports|assets|node_modules|vendor|generated|dist|skel)(\/|$)/.test(path)||/(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(path))return{excluded:'test/docs/fixture/vendor/generated/template'};
 if(path==='runtime/durable-engine/src/host-installed-addon-profiles.ts'||/\.generated\.[jt]s$/.test(path))return{excluded:'generated catalogue'};
 if(/(^|\/)scripts\/playwright\//.test(path)||/(^|\/)[^/]*(?:test-suite|test-priority|test-bootstrap|test-isolation|test-preload|test-runner|feature-tests)[^/]*\.[cm]?[jt]s$/.test(path))return{excluded:'test tooling'};
 if(repo==='core'){
  if(/^runtime\/(?:src|durable-engine\/src|extensions\/(?:browser|experimental|integrations|platform))\//.test(path))return{area:'backend'};
  if(/^runtime\/(?:web\/(?:src|shared)|extensions\/viewers|assemblyscript)\//.test(path))return{area:'frontend'};
  if(/^(?:scripts\/|runtime\/(?:scripts|skills)\/|supervisor\/|entrypoint\.sh$|autoresearch(?:\.checks)?\.sh$)/.test(path))return{area:'tooling'};
  if(/^runtime\/web\/static\//.test(path))return{excluded:'static/generated/legacy assets; no source reduction credit'};
 }else{
  if(/^addons\//.test(path))return{area:/\/(?:web|ui)\//.test(path)||/\.(?:css|html)$/.test(path)?'frontend':'backend'};
  if(/^lib\//.test(path))return{area:'backend'};
  if(/^(?:scripts\/|build\.ts$)/.test(path))return{area:'tooling'};
 }
 return{excluded:'outside declared production roots'};
}
function runtimeMetric(text:string,path:string){
 if(path.startsWith('runtime/assemblyscript/'))return{runtimeTokenLines:null,runtimeTokens:null,metricNotApplicable:'AssemblyScript is a separate language; physical source counted, no JS/TS metric or credit'};
 if(!/\.[cm]?[jt]sx?$/.test(path))return null;
 const plugins=[];if(/\.[cm]?tsx?$/.test(path))plugins.push('typescript');if(/\.[jt]sx$/.test(path))plugins.push('jsx');
 let source:any;
 try {source=parser.parse(text,{sourceType:'unambiguous',plugins,tokens:true,allowReturnOutsideFunction:true,errorRecovery:true});}
 catch(error){throw new Error('Parser could not inspect '+path,{cause:error});}
 const spans:[number,number][]=[];
 const data=(node:any):boolean=>{
  if(!node)return true;
  if(['ParenthesizedExpression','TSAsExpression','TSSatisfiesExpression','TSTypeAssertion'].includes(node.type))return data(node.expression);
  if(['StringLiteral','NumericLiteral','BigIntLiteral','BooleanLiteral','NullLiteral'].includes(node.type))return true;
  if(node.type==='TemplateLiteral')return node.expressions.length===0;
  if(node.type==='UnaryExpression')return data(node.argument);
  if(node.type==='ArrayExpression')return node.elements.every(data);
  if(node.type==='ObjectExpression')return node.properties.every((p:any)=>p.type==='ObjectProperty'&&!p.computed&&data(p.value));
  return false;
 };
 const typeOnly=(node:any)=>node?.type?.startsWith('TS')&&!['TSAsExpression','TSSatisfiesExpression','TSTypeAssertion','TSNonNullExpression','TSInstantiationExpression','TSParameterProperty','TSModuleDeclaration','TSModuleBlock','TSExportAssignment','TSEnumDeclaration','TSEnumBody','TSEnumMember'].includes(node.type);
 const ambientOrEnumData=(node:any)=>node?.declare===true||(node?.type==='TSEnumDeclaration'&&node.body.members.every((member:any)=>data(member.initializer)));
 const staticVariable=(node:any)=>node?.type==='VariableDeclaration'&&node.declarations.every((d:any)=>data(d.init));
 function walk(node:any){
  if(!node)return;
  if(typeOnly(node)||ambientOrEnumData(node)||node.type==='ImportDeclaration'||node.type==='ExportAllDeclaration'||
    (node.type==='ExportNamedDeclaration'&&(!node.declaration||typeOnly(node.declaration)||ambientOrEnumData(node.declaration)||staticVariable(node.declaration)))||
    staticVariable(node)||
    (['ClassProperty','ClassPrivateProperty'].includes(node.type)&&data(node.value))||
    (node.type==='ObjectProperty'&&!node.computed&&data(node.value))){spans.push([node.start,node.end]);return;}
  for(const key of babelTypes.VISITOR_KEYS[node.type]??[]){const value=node[key];if(Array.isArray(value))value.forEach(walk);else walk(value);}
 }
 walk(source.program);spans.sort((a,b)=>a[0]-b[0]);
 // The metric discards types. Preserve parser diagnostics and accept one only
 // when its entire position is already inside an excluded declaration span.
 const ignoredTypeOnlyParseDiagnostics=(source.errors??[]).map((error:any)=>{
  if(error.reasonCode!=='UnexpectedReadonly'||!spans.some(([start,end])=>start<=error.pos&&error.pos<end))throw new Error('Runtime parse diagnostic in '+path+':'+error.loc.line+' '+error.reasonCode);
  return{reason:error.reasonCode,line:error.loc.line,column:error.loc.column};
 });
 const lines=new Set<number>(),tokens:string[]=[];let span=0;
 for(const token of source.tokens){
  if(typeof token.type==='string'||token.type.label==='eof')continue;
  const pos=token.start;while(span<spans.length&&spans[span][1]<=pos)span++;
  if(span<spans.length&&spans[span][0]<=pos&&pos<spans[span][1])continue;
  if(['{','}','[',']','(',')',';',',',':','.'].includes(token.type.label))continue;
  lines.add(token.loc.start.line);tokens.push(token.type.label);
 }
 return{runtimeTokenLines:lines.size,runtimeTokens:tokens.length,tokenKindsHash:createHash('sha256').update(tokens.join(',')).digest('hex'),ignoredTypeOnlyParseDiagnostics};
}
// Metric counterexamples: no credit for pure types/data or comments; token count resists formatting.
assert.equal(runtimeMetric('interface A {x:string}\ntype B = A;','a.ts')!.runtimeTokens,0);
assert.equal(runtimeMetric('const table = {a:1,b:[2,3],schema:`CREATE\nTABLE\nx`};','a.ts')!.runtimeTokens,0);
assert.equal(runtimeMetric('// comment\n/* another */','a.ts')!.runtimeTokens,0);
assert.equal(runtimeMetric('export const table = {a:1};','a.ts')!.runtimeTokens,0);
assert.equal(runtimeMetric('export interface A {x:readonly Array<string>}','a.ts')!.runtimeTokens,0);
assert.ok(runtimeMetric('namespace N {export function f(){return work();}}','a.ts')!.runtimeTokens>0);
assert.equal(runtimeMetric('declare namespace N {function f():void;}','a.ts')!.runtimeTokens,0);
assert.equal(runtimeMetric('export enum N {A=1,B=2}','a.ts')!.runtimeTokens,0);
assert.ok(runtimeMetric('enum N {A=work()}','a.ts')!.runtimeTokens>0);
assert.throws(()=>runtimeMetric('export const invalid = 0777;','a.ts'),/Runtime parse diagnostic/);
const compact=runtimeMetric('export function f(x:number){return x+1;}','a.ts')!;
const formatted=runtimeMetric('export function f(\n x:number\n) {\n return x + 1;\n}\n','a.ts')!;
assert.equal(compact.runtimeTokens,formatted.runtimeTokens);assert.ok(compact.runtimeTokens>0);
const rows:any[]=[],exclusions:Record<string,number>={},outsidePaths:any[]=[],rawDiffs:any[]=[];
for(const repo of repos){
 const objects=new Map<string,any>();
 for(const phase of ['base','head']as const){
  const revision=repo[phase];
  for(const entry of git(repo.path,['ls-tree','-r','-z',revision]).split('\0').filter(Boolean)){
   const tab=entry.indexOf('\t'),header=entry.slice(0,tab).split(' '),path=entry.slice(tab+1),classification=classify(repo.name,path);
   if(!classification.area){const key=repo.name+':'+classification.excluded;exclusions[key]=(exclusions[key]??0)+1;if(classification.excluded==='outside declared production roots')outsidePaths.push({repo:repo.name,phase,path});continue;}
   if(header[0]!=='100644'&&header[0]!=='100755')continue;
   const oid=header[2],cached=objects.get(oid);let measured=cached;
   if(!measured){const text=git(repo.path,['cat-file','blob',oid]);measured={physicalLines:text?text.split('\n').length-(text.endsWith('\n')?1:0):0,...runtimeMetric(text,path)};objects.set(oid,measured);}
   rows.push({repo:repo.name,phase,revision,path,area:classification.area,blob:oid,...measured});
  }
 }
}
for(const repo of repos){
 for(const row of git(repo.path,['diff','--numstat','--no-renames',repo.base,repo.head]).trim().split('\n').filter(Boolean)){
  const[added,deleted,path]=row.split('\t'),classification=classify(repo.name,path);
  if(classification.area&&added!=='-')rawDiffs.push({repo:repo.name,area:classification.area,path,added:Number(added),deleted:Number(deleted)});
 }
}
const totals:any[]=[];
for(const repo of repos)for(const area of ['backend','frontend','tooling']){
 const total=(phase:string)=>rows.filter(r=>r.repo===repo.name&&r.area===area&&r.phase===phase).reduce((a,r)=>({files:a.files+1,physicalLines:a.physicalLines+r.physicalLines,runtimeTokenLines:a.runtimeTokenLines+(r.runtimeTokenLines??0),runtimeTokens:a.runtimeTokens+(r.runtimeTokens??0),implementationFiles:a.implementationFiles+(r.runtimeTokens>0?1:0)}),{files:0,physicalLines:0,runtimeTokenLines:0,runtimeTokens:0,implementationFiles:0});
 const base=total('base'),head=total('head'),delta=Object.fromEntries(Object.keys(base).map(k=>[k,head[k]-base[k]]));
 const physicalDiff=rawDiffs.filter(row=>row.repo===repo.name&&row.area===area).reduce((sum,row)=>({added:sum.added+row.added,deleted:sum.deleted+row.deleted}),{added:0,deleted:0});
 assert.equal(physicalDiff.added-physicalDiff.deleted,delta.physicalLines,'Whole-range line conservation '+repo.name+'/'+area);
 totals.push({repo:repo.name,area,base,head,delta,physicalDiff});
}
assert.equal(outsidePaths.length,0,'Every candidate source path has an explicit measured/excluded classification');
const report={at:new Date().toISOString(),tools:{bun:Bun.version,babelParser:require('@babel/parser/package.json').version,babelTypes:require('@babel/types/package.json').version},baselines:'Last first-parent main before epic creation2026-10-15T21:16:24Z; all changes in each whole range are charged, no sum of child counters.',metric:'Physical source LoC plus runtime-token-bearing lines/tokens after excluding comments, TypeScript-only declarations/import-export declarations and static literal/enum data; runtime namespace bodies and dynamic enum initialisers remain measured. Runtime tokens are a formatting countercheck, not a behaviour proof. No causal credit is assigned by these measurements.',repos,totals,exclusions,outsidePaths,selfTestsPassed:12,rows,rawDiffs};
writeFileSync(run+'/production-accounting.json',JSON.stringify(report,null,2)+'\n');
writeFileSync(run+'/production-accounting.tsv','repo\tphase\tarea\tpath\tphysicalLines\truntimeTokenLines\truntimeTokens\tblob\n'+rows.map(r=>[r.repo,r.phase,r.area,r.path,r.physicalLines,r.runtimeTokenLines??'',r.runtimeTokens??'',r.blob].join('\t')).join('\n')+'\n');
console.log(JSON.stringify({...report,rows:undefined,rawDiffs:undefined},null,2));
