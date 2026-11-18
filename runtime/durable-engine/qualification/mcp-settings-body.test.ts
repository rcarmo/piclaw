import {expect,test} from 'bun:test';
import {readSettingsBody} from '../src/mcp/settings.ts';
const request=(body:BodyInit|null,signal?:AbortSignal)=>new Request('https://fixture/agent/settings/mcp',{method:'POST',body,signal});
test('MCP settings require an object with strictly decoded UTF-8',async()=>{
 expect(await readSettingsBody(request(JSON.stringify({action:'save'})))).toEqual({action:'save'});
 for(const body of [null,'null','[]','"scalar"','{not json}',new Uint8Array([0x7b,0x22,0x61,0x22,0x3a,0x22,0xff,0x22,0x7d])])await expect(readSettingsBody(request(body))).rejects.toMatchObject({status:400});
});
test('MCP body bound counts bytes across chunks and cancels overflow',async()=>{
 let cancelled=false;const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(40000));controller.enqueue(new Uint8Array(30000));},cancel(){cancelled=true;}});
 await expect(readSettingsBody(request(body))).rejects.toMatchObject({status:413});expect(cancelled).toBe(true);
});
test('MCP body abort interrupts a stalled read and never waits on an uncooperative stream cancellation',async()=>{
 const abort=new AbortController();let cancelled=false;const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;return new Promise(()=>{});}});
 const pending=readSettingsBody(request(body,abort.signal));abort.abort();await expect(pending).rejects.toMatchObject({status:400});expect(cancelled).toBe(true);
});
test('MCP settings retain the existing five-second stalled-body deadline',async()=>{
 let cancelled=false;const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});const start=performance.now();
 await expect(readSettingsBody(request(body))).rejects.toMatchObject({status:408});expect(performance.now()-start).toBeGreaterThanOrEqual(4900);expect(cancelled).toBe(true);
},10000);
