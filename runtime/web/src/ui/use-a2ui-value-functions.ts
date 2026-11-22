import { useLayoutEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { readClassicFunctionCall } from '../../../src/channels/web/a2ui/function-call.js';
import type { projectA2uiTemplates } from '../../../src/channels/web/a2ui/templates.js';
import { evaluateA2uiFunction, reportA2uiRendererError, type A2uiFunctionContext } from './a2ui-agent-function.js';
import { A2UI_LOCAL_EXPRESSION_ERROR, evaluateA2uiValue, hasA2uiAgentFunction } from '../../../src/channels/web/a2ui/functions.js';

type Projection = ReturnType<typeof projectA2uiTemplates>;
type Expressions = Map<object,A2uiFunctionContext['instance']>;

function collectProperties(projection: Projection | undefined) {
    const local: Expressions=new Map(), remote: Expressions=new Map();
    if (!projection) return {local,remote};
    for (const item of projection.snapshot.components) {
        const instance=projection.instances.get(item.id)!;
        const visit=(value:unknown) => {
            if (!value || typeof value!=='object') return;
            if (readClassicFunctionCall(value)) {
                (hasA2uiAgentFunction(value) ? remote : local).set(value,instance);
                return;
            }
            Object.values(value).forEach(visit);
        };
        for (const [key,value] of Object.entries(item)) {
            // Action effects are never evaluated during rendering.
            if (key!=='action' && key!=='@metadata') visit(value);
        }
    }
    return {local,remote};
}

/** One cancellable, bounded queue per active surface/edit generation. */
export function useA2uiValueFunctions(projection: Projection | undefined, edits: ReadonlyMap<string,unknown>, source: A2uiFunctionContext['source'], enabled:boolean) {
    const {chat_jid,post_id,thread_id,revision}=source;
    const {local,remote:expressions}=useMemo(()=>collectProperties(projection),[projection]);
    const localResults=useMemo(()=>{
        const values=new Map<object,unknown>(), failures=new Map<object,string>();
        if (enabled && projection) for (const [value,instance] of local) {
            try { values.set(value,evaluateA2uiValue(projection.snapshot,value,edits,instance.instancePath,instance.scope)); }
            catch { values.set(value,null); failures.set(value,A2UI_LOCAL_EXPRESSION_ERROR); }
        }
        return {values,failures};
    },[projection,edits,enabled,local]);
    const surfaceId=projection?.snapshot.surfaceId;
    const hasLocalFailure=localResults.failures.size>0;
    const lastReport=useRef<string | undefined>(undefined);
    useLayoutEffect(()=>{
        if (!enabled || !projection || !hasLocalFailure) return;
        const key=JSON.stringify([chat_jid,post_id,thread_id,revision,surfaceId]);
        if (lastReport.current===key) return;
        lastReport.current=key;
        const lifetime=new AbortController();
        void reportA2uiRendererError({source:{chat_jid,post_id,thread_id,revision},snapshot:projection.snapshot,signal:lifetime.signal},
            {code:'EXPRESSION_ERROR',surfaceId:projection.snapshot.surfaceId,message:A2UI_LOCAL_EXPRESSION_ERROR});
        return ()=>lifetime.abort();
    },[hasLocalFailure,chat_jid,post_id,thread_id,revision,surfaceId,enabled]);
    const generation=useMemo(()=>({}),[expressions,edits,chat_jid,post_id,thread_id,revision,enabled]);
    const [state,setState]=useState<{generation:object;values: Map<object,unknown>;failures: Map<object,string>;receipts: NonNullable<A2uiFunctionContext['receipts']>} | null>(null);
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
                let resolved:unknown, failure:string | undefined;
                try {
                    resolved=await evaluateA2uiFunction(value,{snapshot:projection!.snapshot,edits,source:{chat_jid,post_id,thread_id,revision},instance,signal,memo,receipts});
                } catch (error) { resolved=null; failure=error instanceof Error ? error.message : A2UI_LOCAL_EXPRESSION_ERROR; }
                if (signal.aborted) return;
                setState(previous=>{
                    const current=previous?.generation===generation ? previous : undefined;
                    const failures=new Map(current?.failures);
                    if (failure!==undefined) failures.set(value,failure);
                    return {generation,values:new Map(current?.values).set(value,resolved),failures,receipts:new Map(receipts)};
                });
            }
        }
        for (let i=0;i<Math.min(4,expressions.size);i++) void worker();
        return ()=>lifetime.abort();
    },[generation]);
    return { expressions,values,localResults,failures:active?.failures,receipts:active?.receipts,busy:enabled && (values?.size ?? 0)<expressions.size };
}
