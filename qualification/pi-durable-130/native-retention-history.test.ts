import {historicalExpenseRows} from '../../runtime/test/fixtures/historical-expense.js';
import './src/test-guard.js';
import {expect,test} from 'bun:test';
import {nativeMessageFixture} from './src/native-message-fixture.js';
import {seedRetentionHistoryFixture} from './native-retention-unit-fixture.js';
import {planUsageReportRetention,applyUsageReportRetention} from '../../runtime/src/db/usage-report-retention.js';

// This proves the literal seed/protected-history part of the larger offline
// recovery fixture. It does NOT certify its factory/capture/restore aggregate.
test('retention fixture keeps historical work, holds, caps and recorded windows inert while retiring only unlinked observations',async()=>{
  const f=await nativeMessageFixture();
  try{
    const sdk=f.sdkSnapshot();seedRetentionHistoryFixture(f.root);
    const schema=f.root.query('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();
    const history=()=>historicalExpenseRows(f.root,['budget_work','budget_caps','budget_cap_revisions','budget_cap_windows','budget_request_reservations','budget_usage_events']);
    const original=history();
    expect(f.root.query('SELECT count(*) n FROM token_usage').get()).toEqual({n:8});
    expect(f.root.query('SELECT state,terminal_receipt_json FROM budget_request_reservations').all()).toEqual([{state:'reserved',terminal_receipt_json:null}]);
    let cursor=0,removed=0;
    for(;;){
      const plan=planUsageReportRetention(f.root,{before:'2026-01-01T00:00:00.000Z',after:cursor,limit:2});
      expect(plan.examined).toBeLessThanOrEqual(2);
      const data=JSON.parse(JSON.stringify(plan)),result=applyUsageReportRetention(f.root,data);removed+=result.removed.length;
      expect(applyUsageReportRetention(f.root,data).removed).toEqual([]);
      if(plan.next===null)break;cursor=plan.next;
    }
    expect(removed).toBe(5);
    expect(f.root.query('SELECT work_id,run_at FROM token_usage ORDER BY id').all()).toEqual([
      {work_id:'retention-held-work',run_at:'2000-01-01T00:00:00.000Z'},
      {work_id:'retention-long-work',run_at:'2000-01-01T00:00:00.000Z'},
      {work_id:null,run_at:'2001-02-01T00:00:00.000Z'},
    ]);
    expect(history()).toEqual(original);expect(f.sdkSnapshot()).toEqual(sdk);
    expect(f.root.query('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all()).toEqual(schema);
    expect(f.root.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(f.base.host.modelCalls).toBe(0);expect(f.base.host.credentialLookups).toBe(0);
  }finally{await f.close();}
},12000);
