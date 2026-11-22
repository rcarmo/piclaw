import { useLayoutEffect, useMemo, useState } from '../vendor/preact-htm.js';
import { readClassicFunctionCall } from '../../../src/channels/web/a2ui/function-call.js';
import type { projectA2uiTemplates } from '../../../src/channels/web/a2ui/templates.js';
import { evaluateA2uiFunction, type A2uiFunctionContext } from './a2ui-agent-function.js';
import { hasA2uiAgentFunction } from '../../../src/channels/web/a2ui/functions.js';

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
            if (key!=='action') visit(value);
        }
    }
    return properties;
}

/** One cancellable, bounded queue per active surface/edit generation. */
export function useA2uiValueFunctions(projection: Projection | undefined, edits: ReadonlyMap<string,unknown>, source: A2uiFunctionContext['source'], enabled:boolean) {
    const {chat_jid,post_id,thread_id,revision}=source;
    const expressions=useMemo(()=>collectProperties(projection),[projection]);
    const generation=useMemo(()=>({}),[expressions,edits,chat_jid,post_id,thread_id,revision,enabled]);
    const [state,setState]=useState<{generation:object;values: Map<object,unknown>;receipts: NonNullable<A2uiFunctionContext['receipts']>} | null>(null);
    const active=enabled && state?.generation===generation ? state : undefined;
    const values=active?.values;
    useLayoutEffect(()=>{
        if (!enabled || !projection || !expressions.size) return;
        const lifetime=new AbortController();
        const {signal}=lifetime;
        const memo=new Map<string,Promise<unknown>>();
        const receipts: NonNullable<A2uiFunctionContext['receipts']>=new Map();
        const work=expressions.entries();
        async function worker() {
            for (const [value,instance] of work) {
                if (signal.aborted) return;
                let resolved:unknown;
                try {
                    resolved=await evaluateA2uiFunction(value,{snapshot:projection!.snapshot,edits,source:{chat_jid,post_id,thread_id,revision},instance,signal,memo,receipts});
                } catch { resolved=null; }
                if (signal.aborted) return;
                setState(previous=>({generation,values:new Map(previous?.generation===generation ? previous.values : []).set(value,resolved),receipts:new Map(receipts)}));
            }
        }
        for (let i=0;i<Math.min(4,expressions.size);i++) void worker();
        return ()=>lifetime.abort();
    },[generation]);
    return { expressions,values,receipts:active?.receipts,busy:enabled && (values?.size ?? 0)<expressions.size };
}
