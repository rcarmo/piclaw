/** Pi 1.5.2 receipt measurement. Prerequisites and output paths: docs/development/pi-1.5.2-qualification.md. */
if (process.argv.includes('--help')) { console.log('See docs/development/pi-1.5.2-qualification.md; writes current 152 receipts only.'); process.exit(0); }
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const root=resolve(import.meta.dir, '../../..'), evidence=join(root,'docs/design/earendil-agent-harness-integration-adr/evidence'), fixtures=join(root,'runtime/test/fixtures/earendil-package-admission');
if (!process.argv.includes('--allow-network')) throw Error('Registry/archive/attestation fetch requires explicit --allow-network');
const names=['chord','pi-ai','pi-agent-core','pi-codemode','pi-coding-agent','pi-mcp','pi-schema','pi-telemetry','pi-tui'].map(n=>'@earendil-works/'+n);
const hash=(b:Uint8Array|string,algo='sha256',encoding:any='hex')=>createHash(algo).update(b).digest(encoding);
const lock=JSON.parse(readFileSync(join(root,'bun.lock'),'utf8').replace(/,\s*([}\]])/g,'$1'));
function payloadTree(base:string) {
 const rows:string[]=[]; let files=0;
 const walk=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  if(entry.name==='node_modules')continue;
  const path=join(dir,entry.name),relative=path.slice(base.length+1);
  if(entry.isDirectory())walk(path);
  else if(entry.isFile()){rows.push(`f\t${relative}\t${hash(readFileSync(path))}`);files++;}
  else throw Error('Unexpected package payload entry '+path);
 }};
 walk(base); return {sha256:hash(rows.join('\n')),files};
}
const metadata:any[]=[],packages:any[]=[];
const scratch=mkdtempSync(join(tmpdir(), 'pi152-contract-'));
try {for(const name of names){
 const response=await fetch('https://registry.npmjs.org/'+name.replace('/','%2f')+'/1.5.2'); if(!response.ok)throw Error('registry '+response.status); const pkg:any=await response.json(); metadata.push(pkg);
 const archive=new Uint8Array(await (await fetch(pkg.dist.tarball)).arrayBuffer()); const sha512=hash(archive,'sha512','base64'); if('sha512-'+sha512!==pkg.dist.integrity||hash(archive,'sha1')!==pkg.dist.shasum)throw Error('archive identity '+name);
 const tgz=join(scratch,'package.tgz'); await Bun.write(tgz,archive); const child=Bun.spawnSync(['tar','xzf',tgz,'-C',scratch]);if(child.exitCode)throw Error('tar');
 const packed=JSON.parse(readFileSync(join(scratch,'package/package.json'),'utf8'));const installed=JSON.parse(readFileSync(join(root,'node_modules',name,'package.json'),'utf8'));
 for(const field of ['name','version','engines','exports','main','types','dependencies'])if(!isDeepStrictEqual(packed[field],installed[field])||!isDeepStrictEqual(packed[field],pkg[field]))throw Error(name+' manifest '+field);
 const exports:any[]=[];const walk=async(value:any,key:string)=>{if(typeof value==='string'){const paths=value.includes('*')?Array.from(new Bun.Glob(value).scanSync({cwd:join(scratch,'package'),onlyFiles:true})): [value]; if(!paths.length)throw Error('empty export '+value);for(const path of paths){if(key.endsWith('/source')&&!existsSync(join(scratch,'package',path))){if(existsSync(join(root,'node_modules',name,path)))throw Error('source mismatch');exports.push({condition:key,target:path,status:'advertised_source_not_shipped'});continue;}const packedBytes=readFileSync(join(scratch,'package',path)); const installedBytes=readFileSync(join(root,'node_modules',name,path));if(!packedBytes.equals(installedBytes))throw Error('installed export mismatch '+path); exports.push({condition:key,target:path,sha256:hash(packedBytes)});}}else if(value)for(const [k,v]of Object.entries(value))await walk(v,key+'/'+k);}; await walk(pkg.exports??{main:pkg.main,types:pkg.types},'');
 const attestResponse=await fetch(pkg.dist.attestations.url);if(!attestResponse.ok)throw Error('attestation');const raw=await attestResponse.text();const attest=JSON.parse(raw);const statements=attest.attestations.map((a:any)=>JSON.parse(Buffer.from(a.bundle.dsseEnvelope.payload,'base64').toString()));const provenance=statements.find((s:any)=>s.predicateType==='https://slsa.dev/provenance/v1');if(!provenance||provenance.subject[0].digest.sha512!==Buffer.from(sha512,'base64').toString('hex'))throw Error('subject');const workflow=provenance.predicate.buildDefinition.externalParameters.workflow;const commit=provenance.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit;if(workflow.ref!=='refs/tags/v1.5.2'||commit!=='b4afdddf44e059c67ccf5097e5317d913521b470')throw Error('provenance');
 const publishedTree=payloadTree(join(scratch,'package')),installedTree=payloadTree(join(root,'node_modules',name));
 if(!isDeepStrictEqual(publishedTree,installedTree))throw Error('Full published payload mismatch '+name);
 packages.push({name,version:pkg.version,tarball:pkg.dist.tarball,integrity:pkg.dist.integrity,shasum:pkg.dist.shasum,archiveTreeSha256:publishedTree.sha256,archiveFileCount:publishedTree.files,archiveSha256:hash(archive),archiveBytes:archive.length,engines:pkg.engines,publicExports:pkg.exports??null,main:pkg.main,types:pkg.types,dependencies:pkg.dependencies??{},lockEntry:lock.packages[name],exportFingerprints:exports,provenance:{attestationUrl:pkg.dist.attestations.url,bundleSha256:hash(raw),statements,verification:'registry-served statement decoded; subject digest/ref/commit matched; signature not independently verified'}});
 rmSync(join(scratch,'package'),{recursive:true});console.log(name+' verified');
}
await Bun.write(join(fixtures,'registry-1.5.2.json'),JSON.stringify(metadata,null,2)+'\n');await Bun.write(join(evidence,'receipts/earendil-152-registry.json'),JSON.stringify(metadata,null,2)+'\n');
const manifest={schemaVersion:1,currentVersion:'1.5.2',referenceGitHead:'b4afdddf44e059c67ccf5097e5317d913521b470',scope:'current installed Root nine-package loop including SDK-owned pi-schema; historical receipts unchanged; private engine has separate provenance',packages};
await Bun.write(join(evidence,'dependency-manifest.json'),JSON.stringify(manifest,null,2)+'\n');await Bun.write(join(evidence,'receipts/earendil-152-current-lock.json'),JSON.stringify({version:'1.5.2',packages:packages.map(({name,lockEntry,integrity})=>({name,lockEntry,integrity}))},null,2)+'\n');
}finally{rmSync(scratch,{recursive:true,force:true});}
