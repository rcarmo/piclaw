import { AgentFunctionResponseMessageSchema, type ErrorMessage } from '@a2ui/web_core/v1_0';
import { readClassicFunctionCall } from '../../../src/channels/web/a2ui/function-call.js';
import { a2uiBindingPath, evaluateClassicLocalFunction, isClassicValueFunction, readA2uiValue } from '../../../src/channels/web/a2ui/functions.js';
import { boundedRpcJson, MAX_RPC_VALUE } from '../../../src/channels/web/a2ui/rpc-json.js';
import type { A2uiSnapshot } from '../../../src/channels/web/a2ui/surface.js';
import { postA2uiRendererError, requestA2uiAgentFunction } from '../api.js';

export interface A2uiFunctionContext {
    snapshot: A2uiSnapshot;
    edits: ReadonlyMap<string,unknown>;
    instance: {scope:string;instancePath?:string};
    source: Parameters<typeof requestA2uiAgentFunction>[0];
    signal: AbortSignal;
    action?: true;
    /** Only reactive evaluations share results; every action click gets a new call ID. */
    memo?: Map<string,Promise<unknown>>;
}

function record(value: unknown): value is Record<string,unknown> {
    return !!value && typeof value==='object' && !Array.isArray(value);
}

/** Whether an admitted expression needs the owning agent, looking only at its syntax. */
export function hasA2uiAgentFunction(value: unknown): boolean {
    const call=readClassicFunctionCall(value);
    if (call) return call.name!=='openUrl' && (!isClassicValueFunction(call.name) || hasA2uiAgentFunction(call.args));
    if (a2uiBindingPath(value)!==undefined) return false;
    if (Array.isArray(value)) return value.some(hasA2uiAgentFunction);
    return record(value) && Object.values(value).some(hasA2uiAgentFunction);
}

class AgentEvaluationError extends Error {}

export async function reportA2uiRendererError(context: Pick<A2uiFunctionContext,'source'|'snapshot'|'signal'>, error: ErrorMessage['error']) {
    if (context.signal.aborted) return;
    const signal=AbortSignal.any([context.signal,AbortSignal.timeout(2000)]);
    try { await postA2uiRendererError(context.source,context.snapshot.surfaceId,{version:'1.0',error},signal); }
    catch { return; } // A diagnostic cannot change the failed evaluation or be replayed later.
}

async function invokeAgent(context: A2uiFunctionContext, name: string, catalogId: string, args: Record<string, unknown>) {
    const {snapshot,source,signal}=context;
    const functionCallId=crypto.randomUUID();
    try {
        const response=await requestA2uiAgentFunction(source,{version:'1.0',callAgentFunction:{
            surfaceId:snapshot.surfaceId,functionCallId,callFunction:{'@call':name,catalogId,args},
        }},signal);
        signal.throwIfAborted();
        const parsed=AgentFunctionResponseMessageSchema.safeParse(response);
        if (!parsed.success || parsed.data.agentFunctionResponse.functionCallId!==functionCallId || parsed.data.agentFunctionResponse.error)
            throw Error('Unusable function response');
        return boundedRpcJson(parsed.data.agentFunctionResponse.value ?? null);
    } catch {
        signal.throwIfAborted();
        const message='The agent function did not complete.';
        await reportA2uiRendererError(context,{code:'EXPRESSION_ERROR',functionCallId,message});
        throw new AgentEvaluationError(message);
    }
}

/** Resolve arguments in order and invoke the correct owner. Returned JSON is never executed. */
export async function evaluateA2uiFunction(value: unknown, context: A2uiFunctionContext): Promise<unknown> {
    const {snapshot,edits,instance,signal,memo}=context;
    const read=(part:unknown)=>readA2uiValue(snapshot,part,edits,instance.instancePath,instance.scope);
    let remaining=256;
    async function resolve(input: unknown, depth: number): Promise<unknown> {
        signal.throwIfAborted();
        if (--remaining<0 || depth>24) throw Error('A2UI expression limit exceeded.');
        if (a2uiBindingPath(input)!==undefined) return read(input);
        const call=readClassicFunctionCall(input);
        if (call) {
            const catalogId=call.catalogId ?? snapshot.catalogId;
            if (call.name==='openUrl' || (call.name!=='@index' && !catalogId)) throw Error('The function has no available catalogue.');
            const args=await resolve(call.args ?? {},depth+1) as Record<string,unknown>;
            if (isClassicValueFunction(call.name)) {
                const result=evaluateClassicLocalFunction(call.name,args,instance.instancePath,read);
                if (result===undefined) throw Error('The renderer could not evaluate the function.');
                return result;
            }
            const safeArgs=boundedRpcJson(args) as Record<string,unknown>;
            const fingerprint=JSON.stringify([catalogId,call.name,safeArgs]);
            if (new TextEncoder().encode(fingerprint).length>MAX_RPC_VALUE) throw Error('The function arguments are too large.');
            signal.throwIfAborted();
            const existing=memo?.get(fingerprint);
            if (existing) return existing;
            const pending=invokeAgent(context,call.name,catalogId!,safeArgs);
            memo?.set(fingerprint,pending);
            return pending;
        }
        if (Array.isArray(input)) {
            const items: unknown[]=[];
            for (const item of input) items.push(await resolve(item,depth+1));
            return items;
        }
        if (record(input)) {
            const entries: [string,unknown][]=[];
            for (const [key,item] of Object.entries(input)) entries.push([key,await resolve(item,depth+1)]);
            return Object.fromEntries(entries);
        }
        return input;
    }
    try { return await resolve(value,0); }
    catch (error) {
        if (!(error instanceof AgentEvaluationError) && !signal.aborted)
            await reportA2uiRendererError(context,{code:context.action ? 'EXECUTION_ERROR' : 'EXPRESSION_ERROR',surfaceId:snapshot.surfaceId,message:'The renderer could not evaluate the function.'});
        throw error;
    }
}
