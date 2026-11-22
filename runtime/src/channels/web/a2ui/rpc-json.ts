import type { CanonicalJsonValue } from '../../../service-effects/contracts/common.js';
import type { A2uiMetadata } from './surface.js';

export const MAX_RPC_VALUE = 16 * 1024;

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
