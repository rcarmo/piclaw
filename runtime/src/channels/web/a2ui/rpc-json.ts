import type { CanonicalJsonValue } from '../../../service-effects/contracts/common.js';

export const MAX_RPC_VALUE = 16 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function boundedRpcJson(input: unknown, depth = 0): CanonicalJsonValue {
  if (depth > 20) throw Error('RPC JSON nested too deeply');
  if (input === null) return null;
  if (typeof input === 'boolean' || (typeof input === 'string' && input.length <= MAX_RPC_VALUE)
    || (typeof input === 'number' && Number.isFinite(input))) return input;
  if (Array.isArray(input) && input.length <= 128) return input.map(value => boundedRpcJson(value, depth + 1));
  if (record(input) && (Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null) && Object.keys(input).length <= 128) {
    return Object.fromEntries(Object.keys(input).sort().map(key => {
      if (key.length > 256 || ['__proto__','constructor','prototype'].includes(key)) throw Error('Invalid RPC JSON key');
      return [key,boundedRpcJson(input[key],depth+1)];
    }));
  }
  throw Error('Invalid RPC JSON value');
}
