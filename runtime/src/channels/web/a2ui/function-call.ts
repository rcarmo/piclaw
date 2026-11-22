import { CLASSIC_A2UI_CATALOG } from './surface.js';

export function isClassicFunctionName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && (value === '@index' || /^[_\p{XID_Start}][\p{XID_Continue}]*$/u.test(value));
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Read the canonical function descriptor, without granting catalogue or execution authority. */
export function readClassicFunctionCall(value: unknown) {
  if (!record(value) || Object.keys(value).some(key=>!['@call','args','catalogId'].includes(key))) return;
  const name=value['@call'];
  if (!isClassicFunctionName(name) || (value.args!==undefined && !record(value.args))
    || (value.catalogId!==undefined && (name==='@index' || value.catalogId!==CLASSIC_A2UI_CATALOG))) return;
  return {name,args:value.args as Record<string,unknown> | undefined,
    catalogId:value.catalogId===CLASSIC_A2UI_CATALOG ? CLASSIC_A2UI_CATALOG : undefined};
}

export function readClassicActionFunction(action: unknown) {
  return record(action) && Object.keys(action).length===1 && readClassicFunctionCall(action.functionCall) || undefined;
}
