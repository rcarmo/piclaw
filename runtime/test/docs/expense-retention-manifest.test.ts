import{expect,test}from'bun:test';import{existsSync,readFileSync}from'node:fs';import{resolve}from'node:path';import{createHash}from'node:crypto';
const root=resolve(import.meta.dir,'../../..');
const manifestBytes=readFileSync(resolve(root,'docs/development/receipts/expense-final-retention-1875.json'));
const manifest=JSON.parse(manifestBytes.toString('utf8'));
const overlay=JSON.parse(readFileSync(resolve(root,'docs/development/receipts/kintsugi-cutover-retention-overlay.json'),'utf8'));
test('removal/retention witness binds every original Core path through explicit later source transformations',()=>{
 expect(createHash('sha256').update(manifestBytes).digest('hex')).toBe(overlay.baseManifestSha256);
 expect(overlay.version).toBe(1);const changes=new Map<string,{beforeSha256:string;afterSha256:string;purpose:string}>(overlay.rows.map((row:any)=>[row.path,row]));expect(changes.size).toBe(overlay.rows.length);
 for(const row of overlay.rows)expect(manifest.rows.some((prior:any)=>prior.repo==='core'&&prior.path===row.path&&prior.state!=='deleted')).toBe(true);
 expect(manifest.baselineEntries).toBe(105);expect(manifest.rows).toHaveLength(105);expect(manifest.deletedPaths).toBe(37);
 expect(new Set(manifest.rows.map((r:{repo:string;path:string})=>r.repo+':'+r.path)).size).toBe(105);
 for(const row of manifest.rows){if(row.repo!=='core')continue;const path=resolve(root,row.path);
  if(row.state==='deleted'){expect(changes.has(row.path)).toBe(false);expect(existsSync(path),row.path).toBe(false);}else{const change=changes.get(row.path);if(change){expect(change.beforeSha256,row.path).toBe(row.currentSha256);expect(change.purpose.length).toBeGreaterThan(20);}expect(createHash('sha256').update(readFileSync(path)).digest('hex'),row.path).toBe(change?.afterSha256??row.currentSha256);expect(row.currentPurpose.length).toBeGreaterThan(20);}
 }
});
test('retirement accounting charges current additions and does not credit unrelated/generated/test changes',()=>{
 const r=manifest.reduction;expect(r.conservativeAttributedNet).toBe(r.accepted1881.physical+r.accepted1878.physical+r.currentCoreHandwrittenProduction.net+r.addon236Runtime.net);
 expect(r.currentCoreHandwrittenProduction.net).toBe(29);expect(r.addon236Runtime.net).toBe(20);
 expect(r.accounting).toContain('credited once');expect(r.accounting).toContain('no backend deletion credit');
 expect(manifest.scopeExclusion).toContain('Cheapskate explicitly deferred');
});
