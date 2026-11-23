import type { RendererFunctionResponseMessage } from '@a2ui/web_core/v1_0';
import type { CanonicalJsonValue } from '../../../service-effects/contracts/common.js';
import type { A2uiMetadata } from './surface.js';

export const MAX_RPC_VALUE = 16 * 1024;
export const A2UI_RPC_RECEIPT_TTL_MS = 60_000;

export function malformedRendererInvocation(functionCallId: string) {
  return {version:'1.0',error:{code:'INVALID_FUNCTION_CALL',functionCallId,message:'The renderer rejected a malformed invocation.'}} as const;
}
export type RendererReplyMessage = RendererFunctionResponseMessage | ReturnType<typeof malformedRendererInvocation>;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function boundedJson(input: unknown, opaque: boolean, depth = 0): CanonicalJsonValue {
  if (depth > 20) throw Error('A2UI JSON nested too deeply');
  if (input === null) return null;
  if (typeof input === 'boolean' || (typeof input === 'string' && input.length <= MAX_RPC_VALUE)
    || (typeof input === 'number' && Number.isFinite(input))) return input;
  if (Array.isArray(input) && input.length <= 128) return input.map(value => boundedJson(value, opaque, depth + 1));
  if (record(input) && (Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null) && Object.keys(input).length <= 128) {
    return Object.fromEntries(Object.keys(input).sort().map(key => {
      if (key.length > 256 || (!opaque && ['__proto__','constructor','prototype'].includes(key))) throw Error('Invalid A2UI JSON key');
      return [key,boundedJson(input[key],opaque,depth+1)];
    }));
  }
  throw Error('Invalid A2UI JSON value');
}

export function boundedRpcJson(input: unknown): CanonicalJsonValue {
  return boundedJson(input,false);
}

/** Event names and context keys are wire strings; keep them safe in a timeline line. */
export function isA2uiEventString(value:unknown): value is string {
  return typeof value==='string' && value.length>0 && value.length<=128 && !/[\x00-\x1f\x7f\u2028\u2029]/.test(value);
}

export function a2uiActionEvaluationSite(componentId: string, instancePath: string | undefined, field: string): string {
  return JSON.stringify([componentId,instancePath ?? '',field]);
}

/** A scoped call's comparable resolved arguments, not its client call ID. */
export function a2uiRpcArgumentKey(catalogId: string, name: string, args: Record<string, unknown>): string {
  return JSON.stringify([catalogId,name,boundedRpcJson(args)]);
}

/** Extensions remain JSON data; their nested keys have no reserved directive semantics. */
export function readA2uiActionMetadata(input: unknown): A2uiMetadata | undefined {
  if (input === undefined) return;
  const metadata=boundedJson(input,true);
  if (!record(metadata) || Object.keys(metadata).some(key=>key!=='extensions')
    || new TextEncoder().encode(JSON.stringify(metadata)).length > 4 * 1024) throw Error('Invalid A2UI action metadata');
  const { extensions }=metadata;
  if (extensions===undefined) return {};
  if (!record(extensions) || Object.keys(extensions).some(key=>!/^[_\p{XID_Start}][\p{XID_Continue}]*$/u.test(key)))
    throw Error('Invalid A2UI action extensions');
  return {extensions};
}
