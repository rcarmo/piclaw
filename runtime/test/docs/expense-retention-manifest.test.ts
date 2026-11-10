import{expect,test}from'bun:test';import{existsSync,readFileSync}from'node:fs';import{resolve}from'node:path';import{createHash}from'node:crypto';
const root=resolve(import.meta.dir,'../../..');
const manifest=JSON.parse(readFileSync(resolve(root,'docs/development/receipts/expense-final-retention-1875.json'),'utf8'));
test('removal/retention witness binds every original Core path to current bytes or absence',()=>{
 expect(manifest.baselineEntries).toBe(105);expect(manifest.rows).toHaveLength(105);expect(manifest.deletedPaths).toBe(36);
 expect(new Set(manifest.rows.map((r:{repo:string;path:string})=>r.repo+':'+r.path)).size).toBe(105);
 for(const row of manifest.rows){if(row.repo!=='core')continue;const path=resolve(root,row.path);
  if(row.state==='deleted')expect(existsSync(path),row.path).toBe(false);else{expect(createHash('sha256').update(readFileSync(path)).digest('hex'),row.path).toBe(row.currentSha256);expect(row.currentPurpose.length).toBeGreaterThan(20);}
 }
});
test('retirement accounting charges current additions and does not credit unrelated/generated/test changes',()=>{
 const r=manifest.reduction;expect(r.conservativeAttributedNet).toBe(r.accepted1881.physical+r.accepted1878.physical+r.currentCoreHandwrittenProduction.net+r.addon236Runtime.net);
 expect(r.currentCoreHandwrittenProduction.net).toBe(28);expect(r.addon236Runtime.net).toBe(20);
 expect(r.accounting).toContain('credited once');expect(r.accounting).toContain('no backend deletion credit');
 expect(manifest.scopeExclusion).toContain('Cheapskate explicitly deferred');
});
