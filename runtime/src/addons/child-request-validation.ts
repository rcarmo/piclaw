import type { Context, ThinkingLevel } from '@earendil-works/pi-ai';
import { normalizeContext } from '@earendil-works/pi-ai';
import type { ChildRequestOptionsV1 } from './child-request-contracts.js';
import { ChildRequestError } from './child-request-scope.js';

function fail(): never { throw new ChildRequestError('invalid_request'); }
function json(value: unknown, depth = 0, count = { nodes: 0 }): void {
  if (depth > 32 || ++count.nodes > 100_000) fail();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail(); return; }
  if (!value || typeof value !== 'object') fail();
  if (Array.isArray(value)) { for (const item of value) json(item, depth + 1, count); return; }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail();
  for (const [key, entry] of Object.entries(value)) {
    if (['__proto__','constructor','prototype'].includes(key)) fail();
    json(entry, depth + 1, count);
  }
}
function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !allowed.includes(key))) fail();
  return result;
}
function usage(value: unknown): void {
  const raw = record(value, ['input','output','cacheRead','cacheWrite','cacheWrite1h','reasoning','totalTokens','cost']);
  for (const key of ['input','output','cacheRead','cacheWrite','totalTokens']) if (!Number.isSafeInteger(raw[key]) || (raw[key] as number) < 0) fail();
  for (const key of ['cacheWrite1h','reasoning']) if (raw[key] !== undefined && (!Number.isSafeInteger(raw[key]) || (raw[key] as number) < 0)) fail();
  const costs = record(raw.cost, ['input','output','cacheRead','cacheWrite','cacheWrite1h','reasoning','total']);
  for (const key of ['input','output','cacheRead','cacheWrite','total']) if (typeof costs[key] !== 'number' || (costs[key] as number) < 0) fail();
  for (const key of ['cacheWrite1h','reasoning']) if (costs[key] !== undefined && (typeof costs[key] !== 'number' || (costs[key] as number) < 0)) fail();
}
function declarations(value: unknown): void {
  if (!Array.isArray(value) || value.length > 256) fail();
  const names = new Set<string>();
  for (const item of value) {
    const tool = record(item, ['name','description','parameters','constrainedSampling']);
    if (typeof tool.name !== 'string' || !tool.name || tool.name.length > 256 || names.has(tool.name)
      || typeof tool.description !== 'string' || tool.description.length > 64*1024
      || !tool.parameters || typeof tool.parameters !== 'object' || Array.isArray(tool.parameters)) fail();
    names.add(tool.name);
    if (tool.constrainedSampling === undefined || tool.constrainedSampling === false) continue;
    const config = record(tool.constrainedSampling, ['type','strict','variants']);
    if (config.type === 'json_schema') {
      if (!['prefer','require'].includes(config.strict as string) || config.variants !== undefined) fail();
    } else if (config.type === 'grammar') {
      if (config.strict !== undefined) fail();
      const variants = record(config.variants, ['openai_lark','openai_regex']);
      if (!Object.keys(variants).length || Object.values(variants).some(v => typeof v !== 'string' || v.length > 64*1024)) fail();
    } else fail();
  }
}
function textContent(content: unknown, toolCall: boolean, images = false): void {
  if (typeof content === 'string' && !toolCall) return;
  if (!Array.isArray(content) || content.length > 4096) fail();
  for (const item of content) {
    const type = (item as { type?: unknown })?.type;
    const value = record(item, type === 'text' ? ['type','text','textSignature'] : type === 'thinking' ? ['type','thinking','thinkingSignature','redacted'] : type === 'image' ? ['type','data','mimeType'] : ['type','id','name','arguments','thoughtSignature','namespace']);
    if (value.type === 'text') { if (typeof value.text !== 'string') fail(); }
    else if (value.type === 'image' && images) {
      if (typeof value.data !== 'string' || !value.data || value.data.length % 4 !== 0
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data) || Buffer.from(value.data, 'base64').toString('base64') !== value.data
        || typeof value.mimeType !== 'string' || !/^image\/[A-Za-z0-9.+-]{1,64}$/.test(value.mimeType)) fail();
    }
    else if (value.type === 'thinking' && toolCall) { if (typeof value.thinking !== 'string' || value.redacted !== undefined && typeof value.redacted !== 'boolean') fail(); }
    else if (value.type === 'toolCall' && toolCall) {
      if (typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !value.name || !value.arguments || typeof value.arguments !== 'object' || Array.isArray(value.arguments)) fail();
    } else fail();
    for (const key of ['textSignature','thinkingSignature','thoughtSignature','namespace']) if (value[key] !== undefined && typeof value[key] !== 'string') fail();
  }
}
/** Bounded public provider context. Tool declarations are transcript data, not
 * executable host tools; trusted host policy/pricing separately admits models
 * and images. Historic messages never carry work/account/cost authority. */
export function validateChildRequest(context: Context, options: ChildRequestOptionsV1, maxTokens: number) {
  try {
    json(context); json(options);
    if (Buffer.byteLength(JSON.stringify({ context, options })) > 4 * 1024 * 1024) fail();
    const raw = record(context, ['messages','systemPrompt','tools']);
    if (raw.systemPrompt !== undefined && typeof raw.systemPrompt !== 'string') fail();
    if (raw.tools !== undefined) declarations(raw.tools);
    if (!Array.isArray(raw.messages) || raw.messages.length > 4096) fail();
    for (const item of raw.messages) {
      const role = (item as { role?: unknown })?.role;
      if (role === 'user') {
        const value = record(item, ['role','content','timestamp']); textContent(value.content,false,true);
        if (typeof value.timestamp !== 'number' || value.timestamp < 0) fail();
      } else if (role === 'assistant') {
        const value = record(item, ['role','content','api','provider','model','usage','stopReason','timestamp','responseId','responseModel','thinkingLevel','providerThinkingLevel','endTurn','errorMessage','rawStopReason']);
        textContent(value.content,true);
        for (const key of ['api','provider','model']) if (typeof value[key] !== 'string') fail();
        if (!['pending','stop','length','toolUse','error','aborted'].includes(value.stopReason as string)) fail();
        usage(value.usage);
        for (const key of ['responseId','responseModel','providerThinkingLevel','errorMessage','rawStopReason']) if (value[key] !== undefined && typeof value[key] !== 'string') fail();
        if (value.thinkingLevel !== undefined && !['off','minimal','low','medium','high','xhigh','max'].includes(value.thinkingLevel as string)) fail();
        if (value.endTurn !== undefined && typeof value.endTurn !== 'boolean') fail();
        if (typeof value.timestamp !== 'number' || value.timestamp < 0) fail();
      } else if (role === 'toolResult') {
        const value = record(item, ['role','toolCallId','toolName','content','isError','timestamp']); textContent(value.content,false,true);
        if (typeof value.toolCallId !== 'string' || typeof value.toolName !== 'string' || typeof value.isError !== 'boolean' || typeof value.timestamp !== 'number' || value.timestamp < 0) fail();
      } else if (role === 'system') {
        const value = record(item, ['role','content','timestamp','sections','toolsAdded','toolsRemoved']);
        textContent(value.content,false);
        if (value.toolsAdded !== undefined) declarations(value.toolsAdded);
        if (value.toolsRemoved !== undefined) {
          if (!Array.isArray(value.toolsRemoved) || value.toolsRemoved.length > 256) fail();
          for (const ref of value.toolsRemoved) { const removal = record(ref,['name']); if (typeof removal.name !== 'string' || !removal.name || removal.name.length>256) fail(); }
        }
        if (typeof value.timestamp !== 'number' || value.timestamp < 0) fail();
        if (value.sections !== undefined && (!value.sections || typeof value.sections !== 'object' || Array.isArray(value.sections) || Object.values(value.sections).some(section=>section!==null && typeof section!=='string'))) fail();
      } else fail();
    }
    const request = record(options, ['temperature','maxTokens','reasoning']);
    if (request.temperature !== undefined && (typeof request.temperature !== 'number' || request.temperature < 0 || request.temperature > 2)) fail();
    if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) fail();
    if (request.maxTokens !== undefined && (!Number.isSafeInteger(request.maxTokens) || (request.maxTokens as number) <= 0 || (request.maxTokens as number) > maxTokens)) fail();
    if (request.reasoning !== undefined && !['minimal','low','medium','high','xhigh','max'].includes(request.reasoning as ThinkingLevel)) fail();
    // Apply the actual public SDK normalisation; no private branded cast.
    normalizeContext(structuredClone(context));
    return { context: structuredClone(context), options: { ...structuredClone(options), maxTokens: options.maxTokens ?? maxTokens } };
  } catch { throw new ChildRequestError('invalid_request'); }
}
