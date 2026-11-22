import{expect,test}from'bun:test';import{existsSync,readFileSync}from'node:fs';import{resolve}from'node:path';import{createHash}from'node:crypto';
const root=resolve(import.meta.dir,'../../..');
const manifestBytes=readFileSync(resolve(root,'docs/development/receipts/expense-final-retention-1875.json'));
const manifest=JSON.parse(manifestBytes.toString('utf8'));
const priorPath='docs/development/receipts/kintsugi-cutover-retention-overlay.json';
const priorBytes=readFileSync(resolve(root,priorPath));
const overlay=JSON.parse(priorBytes.toString('utf8'));
const a2ui=JSON.parse(readFileSync(resolve(root,'docs/development/receipts/a2ui-v1-retention-overlay.json'),'utf8'));
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
test('removal/retention witness binds every original Core path through explicit later source transformations',()=>{
 expect(a2ui.previousOverlay).toBe(priorPath);
 expect(a2ui.previousOverlaySha256).toBe(sha(priorBytes));
 expect(manifest.baselineEntries).toBe(105);expect(manifest.rows).toHaveLength(105);expect(manifest.deletedPaths).toBe(37);
 expect(new Set(manifest.rows.map((r:{repo:string;path:string})=>r.repo+':'+r.path)).size).toBe(105);
 const expected=new Map<string,string>();
 for(const row of manifest.rows){
  if(row.repo!=='core')continue;
  if(row.state==='deleted')expect(existsSync(resolve(root,row.path)),row.path).toBe(false);
  else{expected.set(row.path,row.currentSha256);expect(row.currentPurpose.length).toBeGreaterThan(20);}
 }
 for(const layer of [overlay,a2ui]){
  expect(layer.version).toBe(1);
  expect(layer.baseManifest).toBe('docs/development/receipts/expense-final-retention-1875.json');
  expect(layer.baseManifestSha256).toBe(sha(manifestBytes));
  expect(new Set(layer.rows.map((row:{path:string})=>row.path)).size).toBe(layer.rows.length);
  for(const change of layer.rows){
   expect(expected.has(change.path),change.path).toBe(true);
   expect(change.beforeSha256,change.path).toBe(expected.get(change.path));
   expect(change.afterSha256).toMatch(/^[0-9a-f]{64}$/);
   expect(change.afterSha256).not.toBe(change.beforeSha256);
   expect(change.purpose.length).toBeGreaterThan(20);
   expected.set(change.path,change.afterSha256);
  }
 }
 for(const [path,digest] of expected)expect(sha(readFileSync(resolve(root,path))),path).toBe(digest);
});
test('retirement accounting charges current additions and does not credit unrelated/generated/test changes',()=>{
 const r=manifest.reduction;expect(r.conservativeAttributedNet).toBe(r.accepted1881.physical+r.accepted1878.physical+r.currentCoreHandwrittenProduction.net+r.addon236Runtime.net);
 expect(r.currentCoreHandwrittenProduction.net).toBe(29);expect(r.addon236Runtime.net).toBe(20);
 expect(r.accounting).toContain('credited once');expect(r.accounting).toContain('no backend deletion credit');
 expect(manifest.scopeExclusion).toContain('Cheapskate explicitly deferred');
});
