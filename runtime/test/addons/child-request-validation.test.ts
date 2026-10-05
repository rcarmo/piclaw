import {expect,test} from 'bun:test';
import type {Context} from '@earendil-works/pi-ai';
import {createReadToolDefinition} from '@earendil-works/pi-coding-agent';
import {validateChildRequest} from '../../src/addons/child-request-validation.js';
const context=():Context=>({systemPrompt:'synthetic',messages:[{role:'user',content:[{type:'text',text:'synthetic'}],timestamp:1}]});
test('host validates cloned bounded context and applies trusted output default',()=>{const raw=context();const result=validateChildRequest(raw,{},10);expect(result.options.maxTokens).toBe(10);expect(result.context).toEqual(raw);expect(result.context).not.toBe(raw);});
test('unknown authority options, executable tools, invalid images and unsupported reasoning fail before provider',()=>{
 for(const raw of [{...context(),workId:'spoof'},{...context(),tools:[{name:'mcp',description:'spoof',parameters:{},execute:'spoof'}]},{messages:[{role:'user',content:[{type:'image',data:'abc',mimeType:'image/png'}],timestamp:1}]}])expect(()=>validateChildRequest(raw as Context,{},10)).toThrow('invalid_request');
 for(const options of [{apiKey:'spoof'},{baseUrl:'spoof'},{maxTokens:11},{reasoning:'off'},{temperature:Infinity}])expect(()=>validateChildRequest(context(),options as any,10)).toThrow('invalid_request');
});
test('historic usage is structurally checked but cannot inject accounting authority',()=>{
 const message={role:'assistant',content:[{type:'text',text:'synthetic'}],api:'openai-completions',provider:'history',model:'history',stopReason:'stop',timestamp:1,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:1,output:1,cacheRead:0,cacheWrite:0,total:2}}};
 expect(validateChildRequest({messages:[message]} as Context,{},10).context.messages).toHaveLength(1);
 for(const usage of [{...message.usage,workId:'spoof'},{...message.usage,input:-1},{...message.usage,cost:{...message.usage.cost,total:'spoof'}}])expect(()=>validateChildRequest({messages:[{...message,usage}]} as Context,{},10)).toThrow('invalid_request');
 expect(()=>validateChildRequest({messages:[{...message,content:[{type:'text',text:'synthetic',arguments:{key:'spoof'}}]}]} as Context,{},10)).toThrow('invalid_request');
});
test('public transcript tool declarations, removal and images admit data without execution authority',()=>{
 const read={name:'read',description:'synthetic',parameters:{type:'object',properties:{path:{type:'string'}}},constrainedSampling:{type:'json_schema',strict:'prefer'}};
 const raw={tools:[read],messages:[{role:'system',content:[{type:'text',text:'synthetic'}],toolsAdded:[read],toolsRemoved:[{name:'old'}],timestamp:1},{role:'user',content:[{type:'image',data:'aGVsbG8=',mimeType:'image/png'}],timestamp:1},{role:'toolResult',toolCallId:'read-1',toolName:'read',content:[{type:'image',data:'aGVsbG8=',mimeType:'image/png'}],isError:false,timestamp:2}]}as Context;
 const admitted=validateChildRequest(raw,{},10);expect(admitted.context).toEqual(raw);expect(admitted.context).not.toBe(raw);
 for(const constrainedSampling of [false,{type:'json_schema',strict:'require'},{type:'grammar',variants:{openai_regex:'[a-z]+'}},{type:'grammar',variants:{openai_lark:'start: "ok"'}}])expect(validateChildRequest({tools:[{...read,constrainedSampling}],messages:[]}as Context,{},10).context.tools).toHaveLength(1);
 for(const tool of [{...read,account:'spoof'},{...read,constrainedSampling:{type:'json_schema',strict:'unknown'}},{...read,constrainedSampling:{type:'grammar',variants:{unsupported:'bad'}}}])expect(()=>validateChildRequest({tools:[tool],messages:[]}as Context,{},10)).toThrow('invalid_request');
 for(const image of [{type:'image',data:'https://external.invalid/x',mimeType:'image/png'},{type:'image',data:'aGVsbG8=',mimeType:'text/plain'},{type:'image',data:'aGVsbG8=',mimeType:'image/png',accountRef:'spoof'}])expect(()=>validateChildRequest({messages:[{role:'user',content:[image],timestamp:1}]}as Context,{},10)).toThrow('invalid_request');
});

test('non JSON, excessive depth, prototype keys and request byte cap reject',()=>{
 const raw=context();(raw as any).constructor='spoof';expect(()=>validateChildRequest(raw,{},10)).toThrow('invalid_request');
 let deep:any={};for(let n=0;n<34;n++)deep={x:deep};expect(()=>validateChildRequest({...context(),messages:[deep]} as Context,{},10)).toThrow('invalid_request');
 expect(()=>validateChildRequest({messages:[{role:'user',content:'x'.repeat(4*1024*1024),timestamp:1}]},{},10)).toThrow('invalid_request');
 expect(()=>validateChildRequest({...context(),systemPrompt:()=> 'bad'} as any,{},10)).toThrow('invalid_request');
});
test('published read declaration admits without serialising its executable definition',()=>{
 const {name,description,parameters,constrainedSampling}=createReadToolDefinition('/synthetic');
 // The pipe carries JSON, which strips TypeBox's local symbol metadata.
 const declaration=JSON.parse(JSON.stringify({name,description,parameters,constrainedSampling}));
 expect(validateChildRequest({tools:[declaration],messages:[]},{},10).context.tools?.[0]?.constrainedSampling).toEqual({type:'json_schema',strict:'prefer'});
});
test('large canonical image admits and malformed suffix/padding rejects within the byte bound',()=>{
 const image=(data:string)=>({messages:[{role:'user',content:[{type:'image',data,mimeType:'image/png'}],timestamp:1}]} as Context);
 const data=Buffer.alloc(512*1024,1).toString('base64');expect(validateChildRequest(image(data),{},10).context.messages).toHaveLength(1);
 for(const invalid of [data+'!', 'aGVsbG9=', 'a===', 'aGVsbG8'])expect(()=>validateChildRequest(image(invalid),{},10)).toThrow('invalid_request');
});
