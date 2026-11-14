import {afterEach,expect,test} from 'bun:test';
import * as context from '../../web/src/ui/app-status-refresh-orchestration.js';

const original=(globalThis as any).window;
afterEach(()=>{(globalThis as any).window=original;context.resetContextSessionGenerationsForTests();});
const usage={tokens:777,contextWindow:1000,percent:77.7,sessionGeneration:'same'};
const unknown={tokens:null,contextWindow:null,percent:null,sessionGeneration:'same',contextUpdate:'replace'};

test('Classic never persists or restores context projections from browser storage',()=>{
 let reads=0,writes=0;(globalThis as any).window={localStorage:{getItem(){reads++;return JSON.stringify(usage);},setItem(){writes++;}}};
 expect(context.restoreContextUsage('chat')).toBeNull();
 const value=context.reconcileContextUsageForChat('chat',null,{...usage,contextUpdate:'replace'},{authoritative:true});
 expect(context.restoreContextUsage('chat')).toEqual(value);expect(reads).toBe(0);expect(writes).toBe(0);
 expect(context).not.toHaveProperty('persistContextUsage');
});

test('Classic accepted context cache is bounded and evicted request revisions never alias a newer boundary',()=>{
 context.reconcileContextUsageForChat('old',null,usage,{authoritative:true});const revision=context.getContextUsageRevision('old');
 for(let i=0;i<128;i++)context.reconcileContextUsageForChat('chat:'+i,null,usage,{authoritative:true});
 expect(context.restoreContextUsage('old')).toBeNull();expect(context.getContextUsageRevision('old')).toBeGreaterThan(revision);
});

test('connection invalidation clears same-identity meters and rejects an older in-flight response',async()=>{
 let state=context.reconcileContextUsageForChat('chat',null,usage,{authoritative:true});
 let resolve!:(value:unknown)=>void;const response=new Promise<unknown>(done=>{resolve=done;});
 const pending=context.refreshContextUsageForChat({currentChatJid:'chat',activeChatJidRef:{current:'chat'},getAgentContext:()=>response,setContextUsage:next=>{state=typeof next==='function'?next(state):next;}});
 const revision=context.getContextUsageRevision('chat');state=context.invalidateContextUsageForChat('chat');
 expect(state?.tokens).toBeNull();expect(context.getContextUsageRevision('chat')).toBeGreaterThan(revision);
 resolve({...usage,contextUpdate:'replace'});await pending;
 expect(state?.tokens).toBeNull();expect(context.restoreContextUsage('chat')?.tokens).toBeNull();
});

test('authoritative loss of a bound SDK session clears Classic counts and fences an older poll',async()=>{
 let state=context.reconcileContextUsageForChat('lost',null,usage,{authoritative:true});
 let resolve!:(value:unknown)=>void;const response=new Promise<unknown>(done=>{resolve=done;});
 const pending=context.refreshContextUsageForChat({currentChatJid:'lost',activeChatJidRef:{current:'lost'},getAgentContext:()=>response,setContextUsage:next=>{state=typeof next==='function'?next(state):next;}});
 state=context.reconcileContextUsageForChat('lost',state,{...unknown,sessionGeneration:null},{authoritative:true});
 expect(state?.tokens).toBeNull();
 resolve(usage);await pending;expect(state?.tokens).toBeNull();
});
