import './src/test-guard.js';
import {expect,test} from 'bun:test';
import {assertModelContextFits} from '../../runtime/durable-engine/src/host-model-context.ts';
import {outputPreview} from './src/output-preview.ts';
const registry={sections:()=>[],tools:()=>[]} as any;
const usage={input:1000,output:100,cacheRead:500,cacheWrite:0,totalTokens:1100,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const assistant=(u=usage)=>({role:'assistant',api:'bedrock-converse-stream',provider:'amazon-bedrock',model:'fixture',timestamp:1,content:[{type:'text',text:'done'}],stopReason:'stop',usage:u} as any);
test('Bedrock fallback totals excluding cache-read tokens are valid SDK usage',()=>expect(()=>assertModelContextFits([assistant()], {contextWindow:20000,maxTokens:1000})).not.toThrow());
test('Bedrock fallback totals excluding cache-write tokens are valid SDK usage',()=>expect(()=>assertModelContextFits([assistant({...usage,cacheRead:0,cacheWrite:500})], {contextWindow:20000,maxTokens:1000})).not.toThrow());
test('cache-inclusive SDK totals remain valid',()=>expect(()=>assertModelContextFits([assistant({...usage,totalTokens:1600})], {contextWindow:20000,maxTokens:1000})).not.toThrow());
test('missing cache components in reported total do not hide their measured capacity', async () => {
  const target = { contextWindow: 6400, maxTokens: 1000 };
  const output = await outputPreview([assistant()], target);
  expect(output).toMatchObject({ status: 'bounded', maxOutputTokens: 1000, reserveTokens: 5096 });
  // SDK's1100 reported total fits; corrected1600(cache-inclusive) input does not.
  // This threshold uses the actual producer allowance, not the retired8192 margin.
  expect(1100 + 5096).toBeLessThan(target.contextWindow);
  expect(() => assertModelContextFits([assistant()], target, output)).toThrow('context estimate exceeded');
});
test('unmeasured system sections contribute provider-visible text',()=>expect(()=>assertModelContextFits([{role:'system',content:'',sections:{context:'x'.repeat(600000)},timestamp:1}] as any, {contextWindow:100000,maxTokens:10000})).toThrow('context estimate exceeded'));
test('unmeasured tool-result names forwarded by Google contribute framing text',()=>expect(()=>assertModelContextFits([{role:'toolResult',toolCallId:'call',toolName:'x'.repeat(500000),content:[{type:'text',text:'done'}],isError:false,timestamp:1}] as any, {contextWindow:100000,maxTokens:10000})).toThrow('context estimate exceeded'));
test('unmeasured assistant call IDs contribute framing text',()=>expect(()=>assertModelContextFits([{...assistant({...usage,input:0,output:0,cacheRead:0,totalTokens:0}),content:[{type:'toolCall',id:'x'.repeat(500000),name:'tool',arguments:{}}]}] as any, {contextWindow:100000,maxTokens:10000})).toThrow('context estimate exceeded'));
