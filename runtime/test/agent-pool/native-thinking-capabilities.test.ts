import '../helpers.js';
import { beforeEach, expect, test } from 'bun:test';
import { getSupportedThinkingLevels, type Api, type Model } from '@earendil-works/pi-ai';
import { initDatabase } from '../../src/db.js';
import { createNativeControlFixture } from '../agent-control/native-control-fixture.ts';
beforeEach(()=>initDatabase());
const base={provider:'fixture',id:'thinking',name:'Thinking fixture',api:'openai-completions',reasoning:true,input:['text'],contextWindow:100000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}} as Model<Api>;
function fixture(thinkingLevelMap:Model<Api>['thinkingLevelMap']){
 const model={...base,thinkingLevelMap},writes:string[]=[];let level='xhigh';
 const state={sessionId:'native-capabilities',sessionManager:{getLeafId:()=>null},model,get thinkingLevel(){return level;},set thinkingLevel(value:string){writes.push(value);level=value;}};
 const registry={getAll:()=>[model],getAvailable:()=>[model],find:()=>model};
 const f=createNativeControlFixture(state,registry);
 return {...f,model,writes,state};
}
const disabled={off:null,minimal:null,low:null,medium:null,high:null,xhigh:null,max:null};
const options={includeProviderUsage:false,includeProviderDiagnostics:false};
test('native API refuses explicitly disabled max instead of silently selecting legacy xhigh',async()=>{
 const f=fixture({...disabled,xhigh:'max'});
 try{
  expect(getSupportedThinkingLevels(f.model)).toEqual(['xhigh']);
  const result=await f.facade.applyControlCommand('web:default',{type:'thinking',level:'max',raw:'/thinking max'});
  expect(result.status).toBe('error');expect(f.writes).toEqual([]);expect(f.state.thinkingLevel).toBe('xhigh');
  expect((await f.facade.applyControlCommand('web:default',{type:'thinking',level:'xhigh',raw:'/thinking xhigh'})).status).toBe('success');
  expect(f.writes).toEqual(['xhigh']);
 }finally{f.dispose();}
});
test('native model API labels SDK keys without rewriting xhigh to a disabled max',async()=>{
 const f=fixture({...disabled,xhigh:'max'});
 try{
  const result=await f.facade.getAvailableModels('web:default',options);
  expect(result.available_thinking_levels).toEqual(getSupportedThinkingLevels(f.model));
  expect(result.available_thinking_level_labels).toEqual(['xhigh']);
  expect(result.thinking_level_label).toBe('xhigh');
  expect(result.model_options[0]!.thinking_level_labels).toEqual(['xhigh']);
 }finally{f.dispose();}
});
test('native model API does not invent off when the SDK reports no supported thinking levels',async()=>{
 const f=fixture(disabled);
 try{
  expect(getSupportedThinkingLevels(f.model)).toEqual([]);
  const result=await f.facade.getAvailableModels('web:default',options);
  expect(result.available_thinking_levels).toEqual([]);
  expect(result.model_options[0]!.thinking_levels).toEqual([]);
  expect((await f.facade.applyControlCommand('web:default',{type:'cycle_thinking',raw:'/cycle-thinking'})).status).toBe('error');
  expect(f.writes).toEqual([]);
 }finally{f.dispose();}
});
