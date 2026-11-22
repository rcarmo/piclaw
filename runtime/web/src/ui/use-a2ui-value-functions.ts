import { useLayoutEffect, useMemo, useState } from '../vendor/preact-htm.js';
import { readClassicFunctionCall } from '../../../src/channels/web/a2ui/function-call.js';
import type { projectA2uiTemplates } from '../../../src/channels/web/a2ui/templates.js';
import { evaluateA2uiFunction, hasA2uiAgentFunction, type A2uiFunctionContext } from './a2ui-agent-function.js';

type Projection = ReturnType<typeof projectA2uiTemplates>;
type Expressions = Map<object,A2uiFunctionContext['instance']>;

function collectProperties(projection: Projection | undefined): Expressions {
    const properties: Expressions = new Map();
    if (!projection) return properties;
    for (const item of projection.snapshot.components) {
        const instance=projection.instances.get(item.id)!;
        const visit=(value:unknown) => {
            if (!value || typeof value!=='object') return;
            if (readClassicFunctionCall(value)) {
                if (hasA2uiAgentFunction(value)) properties.set(value,instance);
                return;
            }
            Object.values(value).forEach(visit);
        };
        for (const [key,value] of Object.entries(item)) {
            // Action effects are never evaluated during rendering.
            if (key!=='action' && key!=='@checks') visit(value);
        }
    }
    return properties;
}

/** One cancellable, bounded queue per active surface/edit generation. */
export function useA2uiValueFunctions(projection: Projection | undefined, edits: ReadonlyMap<string,unknown>, source: A2uiFunctionContext['source'], enabled:boolean) {
    const {chat_jid,post_id,thread_id,revision}=source;
    const expressions=useMemo(()=>collectProperties(projection),[projection]);
    const generation=useMemo(()=>({}),[expressions,edits,chat_jid,post_id,thread_id,revision,enabled]);
    const [state,setState]=useState<{generation:object;values: Map<object,unknown>} | null>(null);
    const values=enabled && state?.generation===generation ? state.values : undefined;
    useLayoutEffect(()=>{
        if (!enabled || !projection || !expressions.size) return;
        const lifetime=new AbortController();
        const {signal}=lifetime;
        const memo=new Map<string,Promise<unknown>>();
        const work=expressions.entries();
        async function worker() {
            for (const [value,instance] of work) {
                if (signal.aborted) return;
                let resolved:unknown;
                try {
                    resolved=await evaluateA2uiFunction(value,{snapshot:projection!.snapshot,edits,source:{chat_jid,post_id,thread_id,revision},instance,signal,memo});
                } catch { resolved=null; }
                if (signal.aborted) return;
                setState(previous=>({generation,values:new Map(previous?.generation===generation ? previous.values : []).set(value,resolved)}));
            }
        }
        for (let i=0;i<Math.min(4,expressions.size);i++) void worker();
        return ()=>lifetime.abort();
    },[generation]);
    return { expressions,values,busy:enabled && (values?.size ?? 0)<expressions.size };
}
