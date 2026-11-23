import{expect,test}from'bun:test';import{existsSync,readFileSync}from'node:fs';import{resolve}from'node:path';import{createHash}from'node:crypto';
const root=resolve(import.meta.dir,'../../..');
const manifestBytes=readFileSync(resolve(root,'docs/development/receipts/expense-final-retention-1875.json'));
const manifest=JSON.parse(manifestBytes.toString('utf8'));
const overlayBytes=readFileSync(resolve(root,'docs/development/receipts/kintsugi-cutover-retention-overlay.json'));
const overlay=JSON.parse(overlayBytes.toString('utf8'));
const removal=JSON.parse(readFileSync(resolve(root,'docs/development/receipts/optimizer-removal-retention-overlay.json'),'utf8'));
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
test('removal/retention witness binds every original Core path through explicit later source transformations',()=>{
 expect(sha(manifestBytes)).toBe(overlay.baseManifestSha256);
 expect(sha(overlayBytes)).toBe(removal.previousOverlaySha256);
 expect(removal.baseManifestSha256).toBe(overlay.baseManifestSha256);
 expect(removal.rows).toHaveLength(8);
 const layers=[overlay,removal].map(layer=>{
  expect(layer.version).toBe(1);
  const rows=new Map<string,{beforeSha256:string;afterSha256:string;purpose:string}>(layer.rows.map((row:any)=>[row.path,row]));
  expect(rows.size).toBe(layer.rows.length);
  for(const path of rows.keys())expect(manifest.rows.some((prior:any)=>prior.repo==='core'&&prior.path===path&&prior.state!=='deleted')).toBe(true);
  return rows;
 });
 expect(manifest.baselineEntries).toBe(105);expect(manifest.rows).toHaveLength(105);expect(manifest.deletedPaths).toBe(37);
 expect(new Set(manifest.rows.map((r:{repo:string;path:string})=>r.repo+':'+r.path)).size).toBe(105);
 for(const row of manifest.rows){if(row.repo!=='core')continue;const path=resolve(root,row.path);
  if(row.state==='deleted'){
   expect(layers.some(layer=>layer.has(row.path))).toBe(false);expect(existsSync(path),row.path).toBe(false);
  }else{
   let expected=row.currentSha256;
   for(const layer of layers){const change=layer.get(row.path);if(!change)continue;expect(change.beforeSha256,row.path).toBe(expected);expect(change.purpose.length).toBeGreaterThan(20);expected=change.afterSha256;}
   expect(sha(readFileSync(path)),row.path).toBe(expected);expect(row.currentPurpose.length).toBeGreaterThan(20);
  }
 }
});
test('retirement accounting charges current additions and does not credit unrelated/generated/test changes',()=>{
 const r=manifest.reduction;expect(r.conservativeAttributedNet).toBe(r.accepted1881.physical+r.accepted1878.physical+r.currentCoreHandwrittenProduction.net+r.addon236Runtime.net);
 expect(r.currentCoreHandwrittenProduction.net).toBe(29);expect(r.addon236Runtime.net).toBe(20);
 expect(r.accounting).toContain('credited once');expect(r.accounting).toContain('no backend deletion credit');
 expect(manifest.scopeExclusion).toContain('Cheapskate explicitly deferred');
});
