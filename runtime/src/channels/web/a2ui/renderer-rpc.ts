import { createHash } from 'node:crypto';
import type { CallRendererFunctionMessage, RendererFunctionResponseMessage } from '@a2ui/web_core/v1_0';
import type { A2uiRendererDataModel } from './input-metadata.js';

export interface RendererPeerScope {
  chatJid: string;
  conversationId: number;
  sessionId: string | null;
}
export interface RendererSurfaceRevision { post_id: number; thread_id: number; revision: number }
export interface RendererRpcPacket {
  message: CallRendererFunctionMessage;
  source?: RendererSurfaceRevision;
}

export interface RendererRpcResult {
  message: RendererFunctionResponseMessage;
  metadata?: {a2uiRendererDataModel: A2uiRendererDataModel};
}

type Pending = {
  assertCurrent: () => void;
  finish: (reply: RendererFunctionResponseMessage, metadata?: RendererRpcResult['metadata']) => void;
};
type Peer = RendererPeerScope & {
  assertCurrent: () => void;
  send: (packet: RendererRpcPacket) => void;
  close: () => void;
  pending: Map<string, Pending>;
  used: Set<string>;
};

const leasePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = (lease: string) => createHash('sha256').update(lease).digest('hex');
export function rendererRpcError(functionCallId: string, code: string, message: string): RendererFunctionResponseMessage {
  return { version:'1.0', rendererFunctionResponse:{functionCallId,error:{code,message}} };
}

/** One process-owned rendezvous. Packets are unicast to the stream that issued the lease. */
export class RendererRpcBroker {
  private readonly peers = new Map<string, Peer>();
  constructor(private readonly timeoutMs = 8_000) {}

  register(scope: RendererPeerScope, assertCurrent: () => void, send: Peer['send'], close: () => void) {
    assertCurrent();
    if (this.peers.size >= 50) throw Error('Too many A2UI renderer peers');
    const lease = crypto.randomUUID();
    const key = digest(lease);
    this.peers.set(key, {...scope,assertCurrent,send,close,pending:new Map(),used:new Set()});
    return {lease, disconnect: () => this.disconnect(key)};
  }

  private disconnect(key: string) {
    const peer = this.peers.get(key);
    if (!peer) return;
    this.peers.delete(key);
    for (const [id,pending] of peer.pending) pending.finish(rendererRpcError(id,'CANCELLED','The renderer disconnected.'));
    peer.close();
  }

  private current(key: string): Peer | undefined {
    const peer = this.peers.get(key);
    if (!peer) return;
    try { peer.assertCurrent(); return peer; }
    catch { this.disconnect(key); }
  }

  /** Bind to a live renderer at input admission. Persist only the digest. */
  bind(lease: unknown, scope: RendererPeerScope): string | undefined {
    if (typeof lease !== 'string' || !leasePattern.test(lease)) return;
    const key = digest(lease);
    const peer = this.current(key);
    if (peer?.chatJid === scope.chatJid && peer.conversationId === scope.conversationId && peer.sessionId === scope.sessionId) return key;
  }

  async invoke(key: string, chatJid: string, conversationId: number, packet: RendererRpcPacket, assertCurrent: () => void, signal?: AbortSignal): Promise<RendererRpcResult> {
    const id = packet.message.callRendererFunction.functionCallId;
    const peer = this.current(key);
    if (!peer || peer.chatJid !== chatJid || peer.conversationId !== conversationId)
      return {message:rendererRpcError(id,'INVALID_FUNCTION_CALL','The accepted renderer is no longer connected.')};
    if (peer.used.has(id) || peer.used.size >= 1024 || peer.pending.size >= 16)
      return {message:rendererRpcError(id,'INVALID_FUNCTION_CALL','This call ID is already used or the renderer is at capacity.')};
    assertCurrent();
    signal?.throwIfAborted();
    peer.used.add(id);
    return new Promise(resolve => {
      const finish = (reply: RendererFunctionResponseMessage, metadata?: RendererRpcResult['metadata']) => {
        peer.pending.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener('abort',onAbort);
        resolve({message:reply,...(metadata ? {metadata} : {})});
      };
      const onAbort = () => finish(rendererRpcError(id,'CANCELLED','The agent cancelled the call.'));
      const timer = setTimeout(() => finish(rendererRpcError(id,'TIMEOUT','The renderer did not reply.')),this.timeoutMs);
      peer.pending.set(id,{assertCurrent,finish});
      signal?.addEventListener('abort',onAbort,{once:true});
      try { peer.send(packet); }
      catch { this.disconnect(key); }
    });
  }

  reply(lease: unknown, scope: RendererPeerScope, message: RendererFunctionResponseMessage, project?: () => RendererRpcResult['metadata']): boolean {
    const key = this.bind(lease,scope);
    if (!key) return false;
    const id = message.rendererFunctionResponse.functionCallId;
    const pending = this.peers.get(key)?.pending.get(id);
    if (!pending) return false;
    try { pending.assertCurrent(); }
    catch {
      pending.finish(rendererRpcError(id,'INVALID_FUNCTION_CALL','The call owner or surface changed.'));
      return false;
    }
    const metadata=project?.(); // Projection must succeed before consuming the correlation.
    pending.finish(message,metadata);
    return true;
  }
}
