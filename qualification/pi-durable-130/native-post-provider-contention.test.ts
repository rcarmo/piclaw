import {historicalExpenseRows} from '../../runtime/test/fixtures/historical-expense.js';
import './src/test-guard.js';
import {expect,spyOn} from 'bun:test';
import {Database} from 'bun:sqlite';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
import {isSqliteContention} from '../../runtime/src/db/sqlite-async-admission.js';
const applicationTest=isolatedApplicationTest(import.meta.url);

for(const stop of [false,true])applicationTest(`actual native SDK post-provider writer wait without financial ownership: ${stop?'stop/reopen/abort':'beyond ten seconds'}`,async()=>{
  let writer:Database|undefined,releaseTimer:ReturnType<typeof setTimeout>|undefined,releasedAt=0,startedAt=0;
  let failures=0,firstFailure=0,lastFailure=0,acquiredAt=0,candidate:Database|undefined,ticks=0;
  const exec=Database.prototype.exec;
  const f=await nativeGoalFixture(false,false,()=>{
    const path=(f.root.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file;
    writer=new Database(path);writer.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE');startedAt=performance.now();
    releaseTimer=setTimeout(()=>{writer!.exec('COMMIT');releasedAt=performance.now();},10500);
    return [{type:'text',text:'Original native response after contention'}];
  });
  const spy=spyOn(Database.prototype,'exec').mockImplementation(function(this:Database,...args:Parameters<typeof exec>){
    const begin=/^BEGIN IMMEDIATE\s*;?$/i.test(args[0]),sdk=begin&&writer?.inTransaction&&this!==f.root&&this!==writer&&/bun-sqlite\.[tj]s/.test(new Error().stack??'');
    try{const result=exec.apply(this,args);if(this===candidate&&begin)acquiredAt=performance.now();return result;}
    catch(error){if(sdk&&isSqliteContention(error)){candidate=this;failures++;lastFailure=performance.now();firstFailure||=lastFailure;if(stop&&failures===1)queueMicrotask(()=>f.backend.stop());}throw error;}
  });
  const pulse=setInterval(()=>{ticks++;},10);
  try{
    const accepted=await f.send('Approved ordinary input; one provider response');await f.entered.promise;f.held.release();
    if(stop){
      await f.until(()=>failures>0);expect(writer?.inTransaction).toBe(true);expect(releasedAt).toBe(0);expect(f.calls()).toBe(1);
      expect(f.root.query('SELECT * FROM messages WHERE is_bot_message=1').all()).toEqual([]);
      // Stop fences the failed acquisition before it can enter a write body.
      // The unpersisted response is not reconstructed from a financial receipt.
      while(!releasedAt)await new Promise(resolve=>setTimeout(resolve,10));
      const original=f.root.query('SELECT record FROM submissions WHERE id=?').get(accepted.submission_id);
      await f.reopen();expect(f.calls()).toBe(1);
      // Deferred SDK recovery may finish before or after open returns. Join its
      // interrupted original attempt; never replay or invent an abort receipt.
      await f.until(()=>f.status(accepted.submission_id)==='unanswered');
      const terminal=f.root.query('SELECT record FROM submissions WHERE id=?').get(accepted.submission_id) as {record:string};
      const previous=JSON.parse((original as {record:string}).record),interrupted=JSON.parse(terminal.record);
      expect(interrupted).toMatchObject({id:accepted.submission_id,entry:previous.entry,conversationId:previous.conversationId,requestId:previous.requestId,status:'unanswered',reason:'interrupted'});
      if(previous.status==='unanswered')expect(terminal).toEqual(original);else expect(previous.status).toBe('placed');
      const position=f.backend.sessionOptions.getDurableSession!('web:default')!,scope=await position.readAbortScope!();
      expect(await position.abort!(scope??undefined)).toBe(false);
      expect(f.root.query('SELECT record FROM submissions WHERE id=?').get(accepted.submission_id)).toEqual(terminal);expect(f.calls()).toBe(1);
      expect(historicalExpenseRows(f.root,['budget_request_reservations'])[0]).toEqual([]);expect(historicalExpenseRows(f.root,['budget_usage_events'])[0]).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
      return;
    }
    const deadline=Date.now()+22000;
    while(!f.root.query('SELECT 1 FROM messages WHERE is_bot_message=1 AND content=?').get('Original native response after contention')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    expect(f.root.query('SELECT content FROM messages WHERE is_bot_message=1').all()).toEqual([{content:'Original native response after contention'}]);
    expect(f.calls()).toBe(1);expect(f.status(accepted.submission_id)).toBe('done');expect(failures).toBeGreaterThan(1);
    const assistant=f.root.query("SELECT record FROM entries WHERE json_extract(record,'$.kind')='pi.assistant'").get() as {record:string};
    expect(JSON.parse(assistant.record).model[0]).toMatchObject({role:'assistant',stopReason:'stop',content:[{type:'text',text:'Original native response after contention'}],usage:{totalTokens:2}});
    expect(firstFailure).toBeGreaterThan(startedAt);expect(releasedAt-firstFailure).toBeGreaterThanOrEqual(10200);expect(lastFailure-firstFailure).toBeGreaterThanOrEqual(9800);expect(acquiredAt).toBeGreaterThanOrEqual(releasedAt);expect(ticks).toBeGreaterThan(20);
    const record=f.root.query('SELECT record FROM submissions WHERE id=?').get(accepted.submission_id),calls=f.calls();
    expect(historicalExpenseRows(f.root,['budget_request_reservations'])[0]).toEqual([]);expect(historicalExpenseRows(f.root,['budget_usage_events'])[0]).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
    await f.reopen();expect(f.calls()).toBe(calls);expect(f.root.query('SELECT record FROM submissions WHERE id=?').get(accepted.submission_id)).toEqual(record);
  }finally{clearInterval(pulse);clearTimeout(releaseTimer);if(writer?.inTransaction)writer.exec('ROLLBACK');writer?.close();spy.mockRestore();await f.close();}
},30000);
