import { CLASSIC_A2UI_CATALOG } from './surface.js';

export function isClassicEntityName(value: unknown): value is string {
  return typeof value==='string' && value.length<=128 && /^[_\p{XID_Start}][\p{XID_Continue}]*$/u.test(value);
}

export function isClassicFunctionName(value: unknown): value is string {
  return value==='@index' || isClassicEntityName(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Decode an authored literal key once. Resolved model and RPC values never pass through here. */
export function a2uiLiteralKey(key: string): string {
  if (!key.startsWith('@')) return key;
  if (key.startsWith('@@')) return key.slice(1);
  throw Error('Unrecognised A2UI directive');
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

/** Only a top-level binding or call in Event.context is an expression. */
export function isA2uiContextExpression(value: unknown): boolean {
  return record(value) && (Object.hasOwn(value,'@path') || Object.hasOwn(value,'@call'));
}

export function mapA2uiActionExpressions(action: unknown, map: (value:unknown)=>unknown): unknown {
  if (!record(action) || !record(action.event)) return map(action);
  const event=action.event;
  const context=record(event.context) ? Object.fromEntries(Object.entries(event.context).map(([key,value])=>
    [key,isA2uiContextExpression(value) ? map(value) : value])) : event.context;
  return {...action,event:{...event,...(Object.hasOwn(event,'context') ? {context} : {}),
    ...(Object.hasOwn(event,'userMessage') ? {userMessage:map(event.userMessage)} : {})}};
}

export function readClassicActionFunction(action: unknown) {
  return record(action) && Object.keys(action).length===1 && readClassicFunctionCall(action.functionCall) || undefined;
}
