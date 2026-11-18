import type {AssistantMessage} from '@earendil-works/pi-ai';
import {createHostModels,type ModelRef} from './host-models.ts';
import {captureOptimizerModelSource} from './token-optimizer-model-source.ts';
import {currentTaskExecutionScope} from './task-model-boundary-shim.ts';
type Source=Awaited<ReturnType<typeof captureOptimizerModelSource>>;
/** Reuse the existing JSON-only Root/private model bridge with an exact optimizer SDK-task grant. */
export function createOptimizerModels(host:Parameters<typeof createHostModels>[0],approved:readonly ModelRef[],options:Parameters<typeof captureOptimizerModelSource>[0]&{signal:AbortSignal;assertModel(ref:ModelRef):void;observeUsage?:(source:Source,message:AssistantMessage)=>void}){
 const bySignal=new WeakMap<AbortSignal,Source>(),byTask=new WeakMap<NonNullable<ReturnType<typeof currentTaskExecutionScope>>,Source>();
 const authority=(signal:AbortSignal)=>{const source=bySignal.get(signal);if(!source)throw Error('Optimizer model source was not captured');return source;};
 const capture=async(signal:AbortSignal|undefined)=>{const source=await captureOptimizerModelSource(options,signal);bySignal.set(signal!,source);const scope=currentTaskExecutionScope()!;byTask.set(scope,source);return source;};
 return createHostModels(host,approved,{
  signal:options.signal,optimizerRequestGuards:true,
  async captureSourceGuard(signal){const source=await capture(signal);return()=>source.check();},
  async authorize(ref,kind,signal){const source=bySignal.get(signal)??await capture(signal);source.check(ref);if(kind==='generateImages'||Boolean(source.job.request.classification)!==(kind==='classify'))throw Error('Optimizer request operation changed');options.assertModel(ref);},
  assertCurrent(ref,kind,signal){const source=authority(signal);source.check(ref);if(kind==='generateImages'||Boolean(source.job.request.classification)!==(kind==='classify'))throw Error('Optimizer request operation changed');options.assertModel(ref);},
  observeUsage(message){const scope=currentTaskExecutionScope(),source=scope&&byTask.get(scope);if(source)options.observeUsage?.(source,message);},
 });
}
