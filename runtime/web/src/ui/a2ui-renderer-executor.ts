import { CallRendererFunctionMessageSchema, type RendererFunctionResponseMessage } from '@a2ui/web_core/v1_0';
import { a2uiLiteralKey } from '../../../src/channels/web/a2ui/function-call.js';
import { readA2uiDraft } from './a2ui-drafts.js';
import { CLASSIC_A2UI_CATALOG, isA2uiSurfaceBlock, type A2uiSnapshot } from '../../../src/channels/web/a2ui/surface.js';
import { boundedRpcJson, malformedRendererInvocation, MAX_RPC_VALUE, type RendererReplyMessage } from '../../../src/channels/web/a2ui/rpc-json.js';
import { overlayA2uiModel } from '../../../src/channels/web/a2ui/templates.js';
import { evaluateA2uiValue, isClassicValueFunction } from '../../../src/channels/web/a2ui/functions.js';

export interface RendererCallOptions {
    chatJid: string;
    catalogues?: readonly {
        id:string; protocolVersion:'1.0';
        functions: Readonly<Record<string,{
            allowedCallers?: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';
            requiresUserActivation?: boolean;
            parseArgs(args:Record<string,unknown>): Record<string,unknown> | undefined;
            execute(args:Record<string,unknown>, signal:AbortSignal): unknown | Promise<unknown>;
        }>>;
    }[];
    readPost: (id:number, signal:AbortSignal)=>Promise<unknown>;
}

type Source = {post_id:number;thread_id:number;revision:number};

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value==='object' && !Array.isArray(value);
}
const positive = (value: unknown): value is number => typeof value==='number' && Number.isSafeInteger(value) && value>0;
function readSource(value: unknown): Source | undefined {
    if (record(value) && positive(value.post_id) && positive(value.thread_id) && positive(value.revision))
        return {post_id:value.post_id,thread_id:value.thread_id,revision:value.revision};
}
function selectSurface(payload: unknown, chatJid: string, source: Source, surfaceId: string) {
    if (!record(payload) || !Array.isArray(payload.thread)) return;
    const row = payload.thread.find((item: unknown) => record(item) && item.id===source.post_id && item.chat_jid===chatJid);
    if (!record(row) || !record(row.data) || row.data.thread_id!==source.thread_id || !Array.isArray(row.data.content_blocks)) return;
    const surface = row.data.content_blocks.find(isA2uiSurfaceBlock);
    if (surface?.owner==='agent' && surface.state==='active' && surface.revision===source.revision && surface.surface.surfaceId===surfaceId)
        return surface.surface;
}

function errorReply(functionCallId: string, code: string, message: string): RendererFunctionResponseMessage {
    return {version:'1.0',rendererFunctionResponse:{functionCallId,error:{code,message}}};
}

/** Browser execution uses registered functions only and never supplies user activation. */
export async function runRendererCall(raw: unknown, options: RendererCallOptions, signal: AbortSignal): Promise<RendererReplyMessage | undefined> {
    if (!record(raw) || !record(raw.message) || !record(raw.message.callRendererFunction)) return;
    const rawId=raw.message.callRendererFunction.functionCallId;
    if (typeof rawId!=='string' || !rawId || rawId.length>128 || /[\x00-\x1f\x7f]/.test(rawId)) return;
    const invalid = (message:string) => errorReply(rawId,'INVALID_FUNCTION_CALL',message);
    let envelope: ReturnType<typeof boundedRpcJson>;
    try { envelope=boundedRpcJson(raw.message); }
    catch { return malformedRendererInvocation(rawId); }
    if (new TextEncoder().encode(JSON.stringify(envelope)).length>MAX_RPC_VALUE) return malformedRendererInvocation(rawId);
    const parsed=CallRendererFunctionMessageSchema.safeParse(envelope);
    if (!parsed.success || !parsed.data.callRendererFunction.callFunction.catalogId) return malformedRendererInvocation(rawId);
    const { surfaceId,callFunction } = parsed.data.callRendererFunction;
    if (callFunction['@call']==='@index') return errorReply(rawId,'EXECUTION_ERROR','@index requires a template instance.');
    // The Basic Catalogue does not grant agent invocation; openUrl is never registered here.
    const target = options.catalogues?.find(catalogue=>catalogue.id===callFunction.catalogId && catalogue.protocolVersion==='1.0');
    const name = callFunction['@call'];
    const implementation = target && Object.hasOwn(target.functions,name) ? target.functions[name] : undefined;
    if (!target || target.id===CLASSIC_A2UI_CATALOG || !implementation || implementation.requiresUserActivation
        || (implementation.allowedCallers!=='agentOnly' && implementation.allowedCallers!=='rendererOrAgent')) return invalid('The function is not registered for agent calls.');
    let snapshot: A2uiSnapshot | undefined, source: Source | undefined;
    if (surfaceId !== undefined) {
        source=readSource(raw.source);
        if (!source) return invalid('The active surface revision is unavailable.');
        try { snapshot=selectSurface(await options.readPost(source.post_id,signal),options.chatJid,source,surfaceId); }
        catch { return invalid('The active surface revision is unavailable.'); }
        if (!snapshot) return invalid('The active surface revision is unavailable.');
    } else if (raw.source !== undefined) return invalid('An unbound call has no surface source.');

    // Only the admitted, pure Basic evaluator can resolve nested argument expressions.
    let context:A2uiSnapshot=snapshot ?? {surfaceId:'isolated',components:[],dataModel:{}};
    if (snapshot && source) {
        const draft=readA2uiDraft(options.chatJid,snapshot.surfaceId,source.revision);
        if (draft) try { context=overlayA2uiModel(snapshot,new Map([...draft].map(([path,edit])=>[path,edit.value]))); }
        catch { return invalid('The renderer’s draft model could not be resolved.'); }
    }
    const resolve=(value:unknown): unknown => {
        if (Array.isArray(value)) return value.map(resolve);
        if (!record(value)) return value;
        if (Object.hasOwn(value,'@call')) {
            const name=value['@call'];
            if (name==='@index' || !isClassicValueFunction(name) || (value.catalogId ?? context.catalogId)!==CLASSIC_A2UI_CATALOG)
                throw Error('Unsupported argument expression');
            return evaluateA2uiValue(context,value);
        }
        if (Object.hasOwn(value,'@path')) {
            if (Object.keys(value).length!==1 || typeof value['@path']!=='string') throw Error('Invalid argument binding');
            return evaluateA2uiValue(context,value);
        }
        return Object.fromEntries(Object.entries(value).map(([key,item])=>[a2uiLiteralKey(key),resolve(item)]));
    };
    let resolved: Record<string,unknown>;
    try { resolved=Object.fromEntries(Object.entries(callFunction.args ?? {}).map(([key,value])=>[key,resolve(value)])); }
    catch { return invalid('The renderer function arguments could not be resolved.'); }
    const args=implementation.parseArgs(resolved);
    if (args===undefined) return invalid('The renderer function arguments are invalid.');
    signal.throwIfAborted();
    const value=await implementation.execute(args,signal);
    const response = {functionCallId:rawId,value:boundedRpcJson(value ?? null)};
    if (new TextEncoder().encode(JSON.stringify(response)).length>MAX_RPC_VALUE)
        return errorReply(rawId,'EXECUTION_ERROR','The renderer returned too much data.');
    return {version:'1.0',rendererFunctionResponse:response};
}
