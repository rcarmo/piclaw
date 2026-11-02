import {test,expect} from 'bun:test';
import {assertModelContextFits} from '../../runtime/durable-engine/src/host-model-context.js';
const registry={sections:()=>[],tools:()=>[]} as any;
const target={contextWindow:500000,maxTokens:128000};
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
function message(text:string,signature:string='') {return {role:'assistant',content:[{type:'thinking',thinking:text,thinkingSignature:signature}],usage,api:'openai-codex-responses',provider:'openai-codex',model:'gpt-6.1-sol',stopReason:'stop',timestamp:0} as any;}
test('SDK estimate admits signature-heavy unmeasured history without turning bytes into tokens',()=>{
 const messages=[message('t'.repeat(225274),'s'.repeat(1064649))];
 expect(()=>assertModelContextFits(messages, target)).not.toThrow();
});
test('actual large text still rejects',()=>expect(()=>assertModelContextFits([message('x'.repeat(1800000))], target)).toThrow('context estimate exceeded'));
test('actual large tool schema still rejects',()=>expect(()=>assertModelContextFits([...[], { role: "system", content: "", toolsAdded: [{name:'tool',description:'x'.repeat(1800000),parameters:{type:'object'}} as any], timestamp: 2 }] as any, target)).toThrow('context estimate exceeded'));
test('incoherent usage is not accepted as a tiny measurement',()=>{const m=message('');m.usage={...usage,input:200000,totalTokens:1};expect(()=>assertModelContextFits([m], target)).toThrow('usage unavailable')});
test('coherent measured input fits when output is unknown, but a known oversized reserve still rejects',()=>{const m=message('');m.usage={...usage,input:450000,totalTokens:450000};expect(()=>assertModelContextFits([m],target)).not.toThrow();expect(()=>assertModelContextFits([m],target,{status:'bounded',maxOutputTokens:128000,reserveTokens:132096,authIndependent:true})).toThrow('context estimate exceeded')});
test('genuinely oversized coherent measured input still rejects with unknown output',()=>{const m=message('');m.usage={...usage,input:500001,totalTokens:500001};expect(()=>assertModelContextFits([m],target)).toThrow('context estimate exceeded')});
