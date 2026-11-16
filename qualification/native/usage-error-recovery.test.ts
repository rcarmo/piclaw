import './src/test-guard.js';
import {expect,test} from 'bun:test';
import {HostConversationRuntime} from '../../runtime/durable-engine/src/host-runtime.js';
import {openFixture,context} from './src/fixture.js';

test('SDK usage reads skip empty error attempts, retain measured failures and reject invalid successful provenance',async()=>{
 const owner={acquired:true}; const f=await openFixture(owner);
 // Exercise the host validator against real public SDK entries/tasks. No SDK private APIs.
 const read=(entries:any[],conversationId=f.root.id):Promise<any[]> =>
  (HostConversationRuntime.prototype as any).readUsageEntries.call({harness:f.harness,context},conversationId,entries);
 const assistants=async()=>(await f.root.entries({order:'ascending'},100,undefined,context)).items.filter(e=>e.kind==='pi.assistant');
 try{
  f.host.modelAllowed=false;
  const failed=await f.root.submit({type:'input',content:'zero usage failure',requestId:'zero-failure'},context);
  expect((await failed.wait(context)).status).toBe('unanswered');
  const failures=await assistants(); expect(failures).toHaveLength(1);
  expect(failures[0]!.model![0]!.usage.totalTokens).toBe(0);
  expect(await read(failures)).toEqual([]);
  const aborted=structuredClone(failures[0]!); (aborted.model![0] as any).stopReason='aborted';
  expect(await read([aborted])).toEqual([]);
  f.host.modelAllowed=true; f.host.tokens=7;
  const next=await f.root.submit({type:'input',content:'continue safely',requestId:'next'},context);
  expect((await next.wait(context)).status).toBe('done');
  const entries=await assistants(),success=entries.at(-1)!;
  expect(await read(entries)).toEqual([{conversationId:f.root.id,entryId:success.id,tokens:7}]);
  await expect(read([success],(f.root.id+1) as any)).rejects.toThrow('Invalid committed usage task');
  const forged=structuredClone(success); forged.id=failures[0]!.id;
  await expect(read([forged])).rejects.toThrow('Invalid committed usage task');
  const missing=structuredClone(failures[0]!); delete (missing as any).byTaskId;
  await expect(read([missing])).rejects.toThrow('Invalid committed usage entry');
  const malformed=structuredClone(failures[0]!); (malformed.model![0] as any).usage.totalTokens=-1;
  await expect(read([malformed])).rejects.toThrow('Invalid committed usage tokens');
  f.host.modelAllowed=false; f.host.tokens=3;
  const priced=await f.root.submit({type:'input',content:'nonzero failure',requestId:'nonzero-failure'},context);
  expect((await priced.wait(context)).status).toBe('unanswered');
  const measuredFailure=(await assistants()).at(-1)!;
  expect(measuredFailure.model![0]!.stopReason).toBe('error');
  expect(await read([measuredFailure])).toEqual([{conversationId:f.root.id,entryId:measuredFailure.id,tokens:3}]);
  await expect(read([measuredFailure],(f.root.id+1) as any)).rejects.toThrow('Invalid committed usage task');
 }finally{await f.close();owner.acquired=false;}
});
