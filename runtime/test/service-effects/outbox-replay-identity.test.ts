import {expect,spyOn,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {createTempWorkspace} from '../helpers.js';
import {join} from 'node:path';
import {installServiceOutboxSchema} from '../../src/service-effects/current-piclaw/service-outbox-schema.js';
import {createCurrentPiclawServiceOutboxStore,type ServiceOutboxAdapterRuntime} from '../../src/service-effects/current-piclaw/service-outbox-store.js';
import {hashCanonicalRequest,type CanonicalJsonValue} from '../../src/service-effects/contracts/common.js';
import type {EnqueueOutboxRequest} from '../../src/service-effects/contracts/service-outbox-store.js';

function enqueue(id:string):EnqueueOutboxRequest{
  const request:EnqueueOutboxRequest={effect:{idempotencyKey:'key:'+id,requestHash:'',operationId:null,sourceSeq:null,provenanceRef:'fixture:'+id,redactionClass:'private'},outboxId:id,kind:'maintenance',payloadRef:'payload:'+id,destinationRef:null,availableAt:'2026-08-13T10:00:00.000Z',enqueuedAt:'2026-08-13T09:00:00.000Z',repeatability:'repeatable'};
  (request.effect as {requestHash:string}).requestHash=hashCanonicalRequest(request as unknown as CanonicalJsonValue);return request;
}
function claim(token:string){return{kinds:['maintenance'] as const,workerId:'worker:'+token,leaseToken:'lease:'+token,now:'2026-08-13T10:00:01.000Z',leaseExpiresAt:'2026-08-13T10:01:00.000Z'};}
function fixture(runtime:ServiceOutboxAdapterRuntime={hitFault:()=>false,recordTrace(){}}){
  const ws=createTempWorkspace('outbox-single-admission-'),path=join(ws.store,'outbox.sqlite'),db=new Database(path);db.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA busy_timeout=0');installServiceOutboxSchema(db);const built=createCurrentPiclawServiceOutboxStore(db,runtime);if(!built.ok)throw Error(built.error._tag);
  return{ws,path,db,store:built.value,close(){db.close();ws.cleanup();}};
}

test('normalisation snapshots caller input before the async turn',async()=>{
  const f=fixture();try{
    const request=enqueue('snapshot'),pending=f.store.enqueue(request);expect(f.db.query('SELECT count(*) AS n FROM service_effect_s05_outbox').get()).toEqual({n:0});
    (request as {payloadRef:string}).payloadRef='mutated-after-call';(request.effect as {idempotencyKey:string}).idempotencyKey='changed';
    expect(await pending).toMatchObject({ok:true,value:{record:{outboxId:'snapshot',payloadRef:'payload:snapshot',idempotencyKey:'key:snapshot'}}});
  }finally{f.close();}
});

test('same-instance simultaneous claims retain due-order, one owner and exact replay',async()=>{
  const f=fixture();try{
    expect((await f.store.enqueue(enqueue('order:b'))).ok).toBe(true);expect((await f.store.enqueue(enqueue('order:a'))).ok).toBe(true);
    const one=claim('one'),two=claim('two'),[a,b]=await Promise.all([f.store.claimNext(one),f.store.claimNext(two)]);
    expect(a).toMatchObject({ok:true,value:{decision:'applied',lease:{record:{outboxId:'order:a',attempt:1}}}});expect(b).toMatchObject({ok:true,value:{decision:'applied',lease:{record:{outboxId:'order:b',attempt:1}}}});
    const replayA=await f.store.claimNext(one),replayB=await f.store.claimNext(two);expect(replayA).toMatchObject({ok:true,value:{decision:'replayed',lease:a.value?.lease}});expect(replayB).toMatchObject({ok:true,value:{decision:'replayed',lease:b.value?.lease}});
    expect(f.db.query('SELECT count(*) AS n FROM service_effect_s05_leases').get()).toEqual({n:2});expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{f.close();}
});

test('same-key concurrent enqueues commit exactly one durable row and replay identity',async()=>{
  const f=fixture();try{
    const request=enqueue('duplicate'),[a,b]=await Promise.all([f.store.enqueue(request),f.store.enqueue(request)]);expect(a.ok).toBe(true);expect(b.ok).toBe(true);
    expect([a.value?.decision,b.value?.decision].sort()).toEqual(['applied','replayed']);expect(a.value?.record).toEqual(b.value?.record);
    expect(f.db.query('SELECT count(*) AS n FROM service_effect_s05_outbox').get()).toEqual({n:1});expect(f.db.query('SELECT count(*) AS n FROM service_effect_s05_decisions').get()).toEqual({n:1});
  }finally{f.close();}
});

test('fault after entered SQL rolls back all outbox and decision state without callback replay',async()=>{
  const f=fixture({hitFault:(point)=>point==='before_effect'?'in_transaction':false,recordTrace(){}});let inserts=0;const query=f.db.query.bind(f.db),spy=spyOn(f.db,'query').mockImplementation((sql:any)=>{if(typeof sql==='string'&&sql.startsWith('INSERT INTO service_effect_s05_outbox'))inserts++;return query(sql);});
  try{
    expect(await f.store.enqueue(enqueue('rollback'))).toMatchObject({ok:false,error:{_tag:'storage_unavailable',certainty:'not_applied',retryable:true}});expect(inserts).toBe(1);
    expect(f.db.query('SELECT count(*) AS n FROM service_effect_s05_outbox').get()).toEqual({n:0});expect(f.db.query('SELECT count(*) AS n FROM service_effect_s05_decisions').get()).toEqual({n:0});expect(f.db.inTransaction).toBe(false);
  }finally{spy.mockRestore();f.close();}
});

test('lost acknowledgement preserves the exact committed receipt and hook semantics',async()=>{
  let mode:'true'|'throw'|'false'='true';const f=fixture({hitFault(point){if(point==='before_effect')return false;if(mode==='throw')throw Error('observer failure');return mode==='true';},recordTrace(){}});
  try{
    const request=enqueue('unknown'),outcome=await f.store.enqueue(request);expect(outcome).toMatchObject({ok:false,error:{_tag:'storage_unavailable',certainty:'unknown',retryable:true}});
    mode='false';const replay=await f.store.enqueue(request);expect(replay).toMatchObject({ok:true,value:{decision:'replayed',record:{outboxId:'unknown'}}});
    mode='throw';expect(await f.store.enqueue(enqueue('throwing-hook'))).toMatchObject({ok:true,value:{decision:'applied'}});
    expect(f.db.query('SELECT count(*) AS n FROM service_effect_s05_outbox').get()).toEqual({n:2});expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{f.close();}
});

test('same-store completed outcome observation precedes the next mutation call',async()=>{
  const events:Array<{method:string;tag:string;state:string|null}>=[];let database:Database|undefined;
  const f=fixture({hitFault:()=>false,recordTrace(trace){const row=database?.query("SELECT state FROM service_effect_s05_outbox WHERE outbox_id='ordered'").get() as {state:string}|null|undefined;events.push({method:trace.method,tag:trace.resultTag,state:row?.state??null});}});database=f.db;
  try{
    const [enqueued,claimed]=await Promise.all([f.store.enqueue(enqueue('ordered')),f.store.claimNext(claim('ordered'))]);expect(enqueued.ok).toBe(true);expect(claimed).toMatchObject({ok:true,value:{decision:'applied',lease:{record:{outboxId:'ordered'}}}});
    expect(events).toEqual([{method:'enqueue',tag:'call',state:null},{method:'enqueue',tag:'applied',state:'pending'},{method:'claimNext',tag:'call',state:'pending'},{method:'claimNext',tag:'applied',state:'started'}]);
  }finally{f.close();}
});

test('private identity alias has no separate execution path',async()=>{const source=await Bun.file(new URL('../../src/service-effects/current-piclaw/service-outbox-store.ts',import.meta.url)).text();expect(source).not.toContain('requireIdentityRecord');});
