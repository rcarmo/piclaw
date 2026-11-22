import { AgentFunctionResponseMessageSchema } from '@a2ui/web_core/v1_0';
import { readClassicFunctionCall } from '../../../src/channels/web/a2ui/function-call.js';
import { isClassicValueFunction, readA2uiValue } from '../../../src/channels/web/a2ui/functions.js';
import { boundedRpcJson, MAX_RPC_VALUE } from '../../../src/channels/web/a2ui/rpc-json.js';
import { type A2uiSnapshot } from '../../../src/channels/web/a2ui/surface.js';
import { requestA2uiAgentFunction } from '../api.js';

interface EvaluationContext {
    snapshot: A2uiSnapshot;
    edits: ReadonlyMap<string,unknown>;
    instance: {scope:string;instancePath?:string};
    source: Parameters<typeof requestA2uiAgentFunction>[0];
    signal: AbortSignal;
}

/** Route an admitted function to Classic's pure evaluator or the owning agent, never by URL. */
export async function evaluateA2uiFunction(value: unknown, context: EvaluationContext): Promise<unknown> {
    const {snapshot,edits,instance,source,signal}=context;
    signal.throwIfAborted();
    const call=readClassicFunctionCall(value);
    const catalogId=call?.catalogId ?? snapshot.catalogId;
    if (!call || call.name==='openUrl' || (call.name!=='@index' && !catalogId)) throw Error('The function has no available catalogue.');
    if (isClassicValueFunction(call.name)) {
        const result=readA2uiValue(snapshot,value,edits,instance.instancePath,instance.scope);
        if (result===undefined) throw Error('The renderer could not evaluate the function.');
        return result;
    }
    const args=boundedRpcJson(readA2uiValue(snapshot,call.args ?? {},edits,instance.instancePath,instance.scope,true)) as Record<string,unknown>;
    if (new TextEncoder().encode(JSON.stringify(args)).length>MAX_RPC_VALUE) throw Error('The function arguments are too large.');
    const functionCallId=crypto.randomUUID();
    const response=await requestA2uiAgentFunction(source,{version:'1.0',callAgentFunction:{
        surfaceId:snapshot.surfaceId,functionCallId,callFunction:{'@call':call.name,catalogId,args},
    }},signal);
    signal.throwIfAborted();
    const parsed=AgentFunctionResponseMessageSchema.safeParse(response);
    if (!parsed.success || parsed.data.agentFunctionResponse.functionCallId!==functionCallId || parsed.data.agentFunctionResponse.error) {
        throw Error('The agent function did not complete.');
    }
    return boundedRpcJson(parsed.data.agentFunctionResponse.value ?? null);
}
