import { createHash } from 'node:crypto';
import type { CallAgentFunctionMessage, AgentFunctionResponseMessage } from '@a2ui/web_core/v1_0';
import { boundedRpcJson, MAX_RPC_VALUE } from './rpc-json.js';
import type { A2uiRendererDataModel } from './input-metadata.js';
import type { RendererRpcBroker } from './renderer-rpc.js';

const RECEIPT_TTL = 60_000;

interface AgentFunctionContext {
  signal: AbortSignal;
  metadata: Readonly<{ a2uiRendererDataModel?: A2uiRendererDataModel }>;
  assertCurrent(): void;
}

interface FunctionDeclaration {
  catalogue: string;
  name: string;
  allowedCallers?: 'agentOnly' | 'rendererOnly' | 'rendererOrAgent';
  requiresUserActivation?: boolean;
}

export interface A2uiAgentFunction extends FunctionDeclaration {
  resolve(args: Record<string, unknown>): ((context: AgentFunctionContext) => unknown | Promise<unknown>) | undefined;
}

/** Host registration pairs the declaration with a schema parser and a trusted implementation. */
export function defineA2uiAgentFunction<T>(definition: FunctionDeclaration & {
  parseArgs(args: Record<string, unknown>): T | undefined;
  run(args: T, context: AgentFunctionContext): unknown | Promise<unknown>;
}): A2uiAgentFunction {
  const { parseArgs, run, ...declaration } = definition;
  return Object.freeze({ ...declaration, resolve(args: Record<string, unknown>) {
    const parsed = parseArgs(args);
    return parsed === undefined ? undefined : (context: AgentFunctionContext) => run(parsed, context);
  } });
}

export interface A2uiRpcRuntimeScope {
  conversationId: number;
  agent: A2uiAgentRpc;
  renderer?: RendererRpcBroker;
  signal?: AbortSignal;
  assertCurrent(): void;
}

type RpcCallScope = {
  conversationId: number;
  chatJid: string;
  rendererSession: string | null;
  revision: number;
  offered: readonly string[];
  metadata: AgentFunctionContext['metadata'];
  signal: AbortSignal;
  assertCurrent(): void;
};

class RpcConflict extends Error {}

function rpcError(functionCallId: string, code: string, message: string): AgentFunctionResponseMessage {
  return { version:'1.0', agentFunctionResponse:{functionCallId,error:{code,message}} };
}

/** Process-owned RPC receipts are short lived. A payload cannot register an implementation or grant host permissions. */
export class A2uiAgentRpc {
  private readonly functions = new Map<string, A2uiAgentFunction>();
  private readonly receipts = new Map<string, { fingerprint: string; expires: number; result: Promise<AgentFunctionResponseMessage> }>();

  constructor(functions: readonly A2uiAgentFunction[] = []) {
    for (const definition of functions) {
      const key = JSON.stringify([definition.catalogue,definition.name]);
      if (this.functions.has(key)) throw Error('Duplicate A2UI agent function registration');
      this.functions.set(key, Object.freeze({...definition}));
    }
  }

  async invoke(scope: RpcCallScope, message: CallAgentFunctionMessage): Promise<AgentFunctionResponseMessage> {
    scope.assertCurrent();
    const { surfaceId, functionCallId, callFunction } = message.callAgentFunction;
    const catalogue = callFunction.catalogId!; // The transport requires explicit, already resolved catalogue IDs.
    const key = JSON.stringify([scope.chatJid,scope.conversationId,scope.rendererSession,functionCallId]);
    const args = boundedRpcJson(callFunction.args ?? {}) as Record<string, unknown>;
    const fingerprint = createHash('sha256').update(JSON.stringify([
      surfaceId,scope.revision,catalogue,callFunction['@call'],args,[...scope.offered].sort(),scope.metadata,
    ])).digest('hex');
    const now = Date.now();
    for (const [id, receipt] of this.receipts) if (receipt.expires <= now) this.receipts.delete(id);
    let receipt = this.receipts.get(key);
    if (receipt && receipt.fingerprint !== fingerprint) throw new RpcConflict('RPC call identity changed');
    if (!receipt) {
      if (this.receipts.size >= 256) return rpcError(functionCallId,'EXECUTION_ERROR','The agent has too many pending calls.');
      const result = Promise.resolve().then(async () => {
        scope.assertCurrent();
        if (!scope.offered.includes(catalogue)) return rpcError(functionCallId,'INVALID_FUNCTION_CALL','The renderer did not offer this catalogue.');
        const implementation = this.functions.get(JSON.stringify([catalogue,callFunction['@call']]));
        if (!implementation) return rpcError(functionCallId,'UNKNOWN_FUNCTION','The agent has no registered function for this call.');
        if (implementation.allowedCallers === 'agentOnly' || implementation.requiresUserActivation)
          return rpcError(functionCallId,'INVALID_FUNCTION_CALL','This function cannot be invoked by the renderer over RPC.');
        let execute: ReturnType<A2uiAgentFunction['resolve']>;
        try { execute = implementation.resolve(args); } catch { return rpcError(functionCallId,'INVALID_FUNCTION_CALL','The function arguments are invalid.'); }
        if (!execute) return rpcError(functionCallId,'INVALID_FUNCTION_CALL','The function arguments are invalid.');
        const deadline = AbortSignal.timeout(8_000);
        const signal = AbortSignal.any([scope.signal,deadline]);
        try {
          const assertCurrent = () => { signal.throwIfAborted(); scope.assertCurrent(); };
          const value = boundedRpcJson(await abortableRpc(signal, () => {
            assertCurrent();
            return execute!({signal,metadata:scope.metadata,assertCurrent});
          }) ?? null);
          if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_RPC_VALUE) throw Error('RPC result too large');
          return { version:'1.0' as const, agentFunctionResponse:{functionCallId,value} };
        } catch {
          return rpcError(functionCallId,deadline.aborted ? 'TIMEOUT' : signal.aborted ? 'CANCELLED' : 'EXECUTION_ERROR','The agent function did not complete.');
        }
      });
      receipt = {fingerprint,expires:now+RECEIPT_TTL,result};
      this.receipts.set(key,receipt);
    }
    const response = await receipt.result;
    scope.assertCurrent();
    return response;
  }
}

async function abortableRpc<T>(signal: AbortSignal, run: () => T | Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
  });
  try { return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return run(); }),interrupted]); }
  finally { signal.removeEventListener('abort',abort); }
}
