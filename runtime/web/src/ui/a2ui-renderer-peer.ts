import type { RendererFunctionResponseMessage } from '@a2ui/web_core/v1_0';
import type { RendererCallOptions } from './a2ui-renderer-executor.js';
import { CLASSIC_A2UI_RENDERER_CAPABILITIES, type ClassicA2uiRendererCapabilities } from '../../../src/channels/web/a2ui/capabilities.js';
import { CLASSIC_A2UI_CATALOG } from '../../../src/channels/web/a2ui/surface.js';

type Options = RendererCallOptions & {
    reply: (body: {chat_jid:string;renderer_peer:string;message:RendererFunctionResponseMessage}, signal: AbortSignal) => Promise<unknown>;
    onLost?: () => void;
};
type PeerOffer = {lease:string;capabilities:ClassicA2uiRendererCapabilities};
const connected = new Map<string, PeerOffer>();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Keep the opaque lease in this tab, never in timeline state or public connection events. */
export function a2uiRendererContext(chatJid: string) {
    const peer = connected.get(chatJid);
    return {metadata:{a2uiRendererCapabilities:peer?.capabilities ?? CLASSIC_A2UI_RENDERER_CAPABILITIES},
        ...(peer ? {renderer_peer:peer.lease} : {})};
}

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value==='object' && !Array.isArray(value);
}
/** Subsidiary private stream owned by one connection generation of Classic's main SSE client. */
export function openA2uiRendererPeer(options: Options): () => void {
    const { chatJid }=options;
    const stream=new EventSource(`/agent/a2ui-peer?chat_jid=${encodeURIComponent(chatJid)}`);
    let peer: (PeerOffer & {lifetime:AbortController;seen:Set<string>}) | undefined;
    const dropLease=()=>{
        if (!peer) return;
        peer.lifetime.abort();
        if (connected.get(chatJid)===peer) connected.delete(chatJid);
        peer=undefined;
    };
    const close=()=>{ stream.close(); dropLease(); };
    const fail=()=>{ close(); options.onLost?.(); };
    stream.onerror=()=>{
        dropLease();
        // EventSource retries transient stream loss; permanent HTTP errors still
        // leave acquisition to the next main-stream connection or accepted post.
        if (stream.readyState===EventSource.CLOSED) fail();
    };
    stream.addEventListener('a2ui_peer',event=>{
        if (stream.readyState!==EventSource.OPEN || peer) return;
        try {
            const {renderer_peer:lease}=JSON.parse((event as MessageEvent<string>).data);
            if (typeof lease!=='string' || !uuid.test(lease)) return fail();
            const ids=[...new Set([CLASSIC_A2UI_CATALOG,...(options.catalogues ?? []).filter(c=>c.protocolVersion==='1.0').map(c=>c.id)])].slice(0,32);
            peer={lease,capabilities:{'1.0':{supportedCatalogIds:ids}},lifetime:new AbortController(),seen:new Set()};
            connected.set(chatJid,peer);
        } catch { fail(); }
    });
    stream.addEventListener('a2ui_call',event=>{
        const accepted=peer;
        if (!accepted || connected.get(chatJid)!==accepted) return;
        const {lifetime,seen}=accepted;
        let raw: unknown;
        try { raw=JSON.parse((event as MessageEvent<string>).data); }
        catch { return; }
        const call=record(raw)&&record(raw.message)&&record(raw.message.callRendererFunction) ? raw.message.callRendererFunction : undefined;
        const id=call?.functionCallId;
        if (typeof id!=='string' || !id || id.length>128 || seen.has(id) || seen.size>=1024) return;
        seen.add(id);
        void (async()=>{
            let message: RendererFunctionResponseMessage | undefined;
            try { message=await (await import('./a2ui-renderer-executor.js')).runRendererCall(raw,options,lifetime.signal); }
            catch { message={version:'1.0',rendererFunctionResponse:{functionCallId:id,error:{code:'EXECUTION_ERROR',message:'The renderer could not complete the request.'}}}; }
            if (!message || lifetime.signal.aborted || connected.get(chatJid)!==accepted) return;
            try { await options.reply({chat_jid:chatJid,renderer_peer:accepted.lease,message},lifetime.signal); }
            catch { return; } // Do not retry a reply after transport loss or expiry.
        })();
    });
    return close;
}
