import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dir,'../../..');
const doc=(path:string)=>readFileSync(resolve(root,path),'utf8');
test('current usage guidance has no removed financial reconstruction or admission contract',()=>{
 const text=doc('docs/development/usage-report-projections.md');
 expect(text).toContain('Usage reporting is passive');expect(text).toContain('Mixed or unknown units produce an unknown total');
 expect(text).toContain('Old financial tables, payload/hash bytes, receipts, constraints and foreign keys remain untouched');
 expect(text).not.toContain('reconcileUsageReports(database');expect(text).not.toContain('enabled native caps still deny');
});
test('older reservation and operation designs are explicitly archived rather than current APIs',()=>{
 for(const path of ['shared-model-request-reservations.md','delegate-request-reservations.md','native-background-operations.md']){
  const text=doc('docs/development/'+path);expect(text).toContain('## Archived design and qualification');expect(text.split('## Archived design and qualification')[0]).toContain('removed');
 }
});
test('current runtime overview describes source and lease ownership independently of expense work',()=>{
 expect(doc('docs/runtime-flows.md')).toContain('exact source/lease bindings');expect(doc('docs/runtime-flows.md')).not.toContain('exact source/lease/budget bindings');
 expect(doc('docs/architecture.md')).toContain('cancellation, passive usage reporting and recovery');
});
