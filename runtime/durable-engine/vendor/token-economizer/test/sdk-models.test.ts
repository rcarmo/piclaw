import { expect, test } from "bun:test";
import { createModels, fauxProvider, fauxAssistantMessage, type ClassifierModel, type ClassifierApi } from "@earendil-works/pi-ai";
import { createSdkModelTransport } from "../src/pi-durable/sdk-models.ts";
test("SDK-only transport sends isolated prompts, accounts real identity and never falls back from an unsupported classifier",async () => {
  const models = createModels(), faux = fauxProvider({tokensPerSecond:100_000});models.setProvider(faux.provider);
  faux.setResponses([(context,options) => {expect(context.messages).toHaveLength(1);expect(context.messages[0]?.content).toBe("bounded evidence");expect(options?.maxTokens).toBe(32);return fauxAssistantMessage("ok");}]);
  const transport = createSdkModelTransport(models), request = {id:"isolated",purpose:"loop-judge" as const,model:{provider:"faux",id:"faux-1"},prompt:"bounded evidence",maxOutputTokens:32,deadlineMs:1000};
  const result = await transport.sideCall(request,new AbortController().signal);
  expect(result.text).toBe("ok");expect(result.model).toEqual(request.model);expect(result.usage).not.toBeNull();expect(result.cost).toBeNull();
  const classified = await transport.decisionClassifier({id:"unsupported",model:request.model,purpose:"loop",state:"evidence",labels:{stuck:"stuck",productive:"productive"},deadlineMs:1000},new AbortController().signal);
  expect(classified.label).toBeNull();expect(classified.cost).toBe(0);expect(classified.error).toContain("unsupported");expect(faux.state.callCount).toBe(1);
  expect(transport.maximumCost(request)).toBeNull();
});
test("SDK classifier transport makes one explicit question and preserves missing usage as unknown",async () => {
  const models = createModels(), faux = fauxProvider(), classifier:ClassifierModel<ClassifierApi> = {...faux.models[0],type:"classifier",id:"classifier"};let calls = 0;
  models.setProvider({...faux.provider,getAllModels:() => [...faux.models,classifier],classify:async (model,context) => {
    calls++;expect(context.state).toEqual({evidence:"frozen digest"});expect(Object.keys(context.questions)).toEqual(["decision"]);
    return {api:model.api,provider:model.provider,model:model.id,answers:{decision:{type:"choice",choice:"productive",confidence:.9,probabilities:{productive:.9,stuck:.05,uncertain:.05}}},stopReason:"stop",timestamp:Date.now()};
  }});
  const result = await createSdkModelTransport(models).decisionClassifier({id:"classification",model:{provider:"faux",id:"classifier"},purpose:"loop",state:"frozen digest",labels:{productive:"making progress",stuck:"dead-end",uncertain:"missing evidence"},deadlineMs:1000},new AbortController().signal);
  expect(calls).toBe(1);expect(result.label).toBe("productive");expect(result.model.id).toBe("classifier");expect(result.usage).toBeNull();expect(result.cost).toBeNull();
});

test("optimizer side calls retain scoped cache affinity without sharing the Agent's session",async()=>{
  const models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
  const optionsSeen:{sessionId:string|undefined;cacheRetention:string|undefined}[]=[];
  faux.setResponses(Array.from({length:4},()=> (_request,options)=>{optionsSeen.push({sessionId:options?.sessionId,cacheRetention:options?.cacheRetention});return fauxAssistantMessage("ok");}));
  const transport=createSdkModelTransport(models),base={id:"one",cacheScope:"workspace-a/agent-a",purpose:"loop-judge" as const,model:{provider:"faux",id:"faux-1"},prompt:"bounded evidence",maxOutputTokens:32,deadlineMs:1000};
  for(const request of [base,{...base,id:"two",model:{id:"faux-1",provider:"faux"}},{...base,id:"three",cacheScope:"workspace-b/agent-a"},{...base,id:"four",purpose:"writer" as const}])await transport.sideCall(request,new AbortController().signal);
  expect(optionsSeen[0]!.sessionId).toBe(optionsSeen[1]!.sessionId);expect(optionsSeen[0]!.sessionId).not.toBe(optionsSeen[2]!.sessionId);expect(optionsSeen[0]!.sessionId).not.toBe(optionsSeen[3]!.sessionId);
  expect(optionsSeen.every(options=>options.cacheRetention==="short")).toBe(true);expect(optionsSeen[0]!.sessionId!.length).toBeLessThanOrEqual(64);expect(optionsSeen[0]!.sessionId).not.toContain(base.cacheScope);
});

test("side calls choose low effort without expanding the configured token cap",async()=>{
 for(const api of ["faux","anthropic-messages","bedrock-converse-stream"] as const){
  const models=createModels(),faux=fauxProvider({tokensPerSecond:100000}),model={...faux.models[0],api,reasoning:true,thinkingLevelMap:{off:null,minimal:null,low:"low"}};
  models.setProvider({...faux.provider,getModels:()=>[model],getAllModels:()=>[model]});
  faux.setResponses([(_input,options)=>{expect(options?.maxTokens).toBe(64);expect(options?.reasoning).toBe(api==="faux"?"low":undefined);return fauxAssistantMessage("ok");}]);
  const result=await createSdkModelTransport(models).sideCall({id:api,purpose:"proposer",model:{provider:"faux",id:model.id},prompt:"bounded",maxOutputTokens:64,deadlineMs:1000},new AbortController().signal);
  expect(result.error).toBeNull();expect(faux.state.callCount).toBe(1);
 }
});
test("length and empty replies fail visibly without losing usage or making extra calls",async()=>{
 const models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 faux.setResponses([fauxAssistantMessage('{"facts":',{stopReason:"length"}),fauxAssistantMessage("")]);
 const transport=createSdkModelTransport(models),request={id:"limited",purpose:"proposer" as const,model:{provider:"faux",id:"faux-1"},prompt:"bounded",maxOutputTokens:1024,deadlineMs:1000};
 const limited=await transport.sideCall(request,new AbortController().signal);expect(limited.error).toContain("1024-token limit");expect(limited.usage).not.toBeNull();expect(limited.authUnavailable).toBe(false);
 expect((await transport.sideCall({...request,id:"empty"},new AbortController().signal)).error).toContain("no text");expect(faux.state.callCount).toBe(2);
});
