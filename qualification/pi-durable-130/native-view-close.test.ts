import './src/test-guard.js';
import {expect,spyOn} from 'bun:test';
import {nativeMessageFixture} from './src/native-message-fixture.js';
import {barrier} from './src/fixture.js';
import type {Harness} from '../../runtime/durable-engine/qualification/durable.js';
import {Database} from 'bun:sqlite';
import {join} from 'node:path';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {addLogSink,removeLogSink,type LogRecord} from '../../runtime/src/utils/logger.js';
const applicationTest=isolatedApplicationTest(import.meta.url);

applicationTest('actual native factory joins initial/reopened view handshakes before closing SDK and preserves accepted history',async()=>{
  const f=await nativeGoalFixture();let closed=false;
  const failures:LogRecord[]=[];
  const sink=(record:LogRecord)=>{if(record.module==='native.turn-view'&&(record.operation==='native.input_delivery_pending'||record.message==='Conversation watch failed'))failures.push(record);};
  try{
    const accepted=await f.send('One independently accepted native input');await f.entered.promise;f.held.release();
    await f.until(()=>f.root.query('SELECT 1 FROM messages WHERE is_bot_message=1').get()!==null);
    expect(f.status(accepted.submission_id)).toBe('done');expect(f.calls()).toBe(1);
    const history=()=>['entries','submissions','messages','service_effect_s01_sources'].map(table=>f.root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const original=history();addLogSink(sink);
    await f.reopen();await f.close();closed=true;
    const database=new Database(join(process.env.PICLAW_STORE!,'messages.db'),{readonly:true,strict:true});
    try{expect(['entries','submissions','messages','service_effect_s01_sources'].map(table=>database.query(`SELECT * FROM ${table} ORDER BY rowid`).all())).toEqual(original);}finally{database.close();}
    expect(f.calls()).toBe(1);expect(failures).toEqual([]);
  }finally{if(!closed)await f.close();removeLogSink(sink);}
},30000);

applicationTest('native view setup racing close stops its allocated SDK watch before rejecting without publishing',async()=>{
  const f=await nativeMessageFixture(),entered=barrier(),held=barrier();let stopped=0,published=0;
  await f.open();const harness=Reflect.get(f.runtime,'harness') as Harness,conversation=harness.conversation.bind(harness);
  const intercept=spyOn(harness,'conversation').mockImplementation(async(id,context)=>{
    const handle=await conversation(id,context);return handle&&new Proxy(handle,{get(target,key){
      if(key==='watch')return async(context:any)=>{const watch=await target.watch(context);entered.release();await held.promise;return new Proxy(watch,{get(target,key){if(key==='stop')return async()=>{stopped++;await target.stop();};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
  });
  try{
    const watching=f.runtime.watchSession(f.binding,()=>{published++;});void watching.catch(()=>{});await entered.promise;
    const closing=f.controller.close();held.release();await expect(watching).rejects.toThrow('Runtime closed');await closing;expect(stopped).toBe(1);expect(published).toBe(0);
  }finally{held.release();intercept.mockRestore();await f.close();}
},30000);
