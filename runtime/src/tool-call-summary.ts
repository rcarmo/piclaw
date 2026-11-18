/** Display-only metadata owned by the registered tool. Never execution authority. */
import { createLogger } from './utils/logger.js';
import type { ToolCallSummary } from '../public/addon-hooks.js';
export type { ToolCallSummary } from '../public/addon-hooks.js';
const log = createLogger('tool-summary');
export type ToolCallSummaryResolver = (name: string, args: unknown) => string | null | undefined;
export interface ToolCallSummaryFact {
  readonly text?: string | null;
  readonly nested?: readonly (string | null | undefined)[];
}
export type ToolCallSummaryFacts = Readonly<Record<string, ToolCallSummaryFact>>;

/** Spread into an upstream tool definition without changing its SDK interface. */
export const toolCallSummary = (callSummary: ToolCallSummary) => ({ callSummary });

/** Inspect a data property only. Rendering never invokes a metadata getter. */
export function readToolCallSummary(tool: object): ToolCallSummary | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(tool, 'callSummary');
  const candidate = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  return typeof candidate === 'function' && Object.prototype.toString.call(candidate) === '[object Function]' ? candidate : undefined;
}

export function normaliseToolCallSummary(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.length > 120 ? `${text.slice(0, 120)}…` : text : null;
}
function readonlyCopy(value: unknown): unknown {
  const copy = structuredClone(typeof value === 'string' ? JSON.parse(value) : value ?? {});
  const seen = new WeakSet<object>();
  const freeze = (item: unknown) => {
    if (!item || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(copy); return copy;
}

/** A conversation-local snapshot, never a process-global tool-name registry.
 * undefined means no provider; null means a provider declined/failed, for which
 * the UI must not substitute a potentially sensitive argument preview.
 */
export function createToolCallSummaryResolver<T extends { readonly name: string }>(tools: readonly T[]): ToolCallSummaryResolver {
  const providers = new Map<string, { declared: boolean; provider?: ToolCallSummary; ambiguous?: boolean }>();
  for (const tool of tools) {
    const provider = readToolCallSummary(tool), declared = Object.hasOwn(tool, 'callSummary');
    const prior = providers.get(tool.name);
    providers.set(tool.name, prior && (prior.ambiguous || prior.provider !== provider || prior.declared !== declared)
      ? { declared: true, ambiguous: true } : { declared, provider });
  }
  return (name, args) => {
    const captured = providers.get(name);
    if (!captured?.declared) return undefined;
    if (!captured.provider) return null;
    try {
      const provider = captured.provider;
      const output: unknown = provider(readonlyCopy(args));
      if (Object.prototype.toString.call(output) === '[object Promise]') {
        // A malformed synchronous provider must not create an unhandled rejection.
        void Promise.resolve(output).catch(() => { log.debug('Discarded rejected asynchronous tool summary', { operation: 'tool.summary.async_rejected', tool: name }); });
        return null;
      }
      return normaliseToolCallSummary(output);
    } catch { return null; }
  };
}

/** Project callback results as bounded text facts; retain no callback in history. */
export function collectToolCallSummaries(entries: readonly { readonly kind: string; readonly model?: readonly unknown[] }[], resolve: ToolCallSummaryResolver): ToolCallSummaryFacts {
  const facts: Record<string, { text?: string | null; nested?: (string | null | undefined)[] }> = Object.create(null);
  for (const entry of entries) {
    const message = entry.model?.[0] as { role?: string; content?: unknown; toolCallId?: string; details?: { calls?: unknown } } | undefined;
    if (entry.kind === 'pi.assistant' && Array.isArray(message?.content)) {
      for (const block of message.content) {
        if (block?.type !== 'toolCall' || typeof block.id !== 'string' || typeof block.name !== 'string') continue;
        const text = resolve(block.name, block.arguments);
        if (text !== undefined) facts[block.id] = { ...facts[block.id], text };
      }
    }
    if (entry.kind === 'pi.tool-result' && typeof message?.toolCallId === 'string' && Array.isArray(message.details?.calls)) {
      const nested = message.details.calls.slice(0, 200).map((call: any) => typeof call?.name === 'string' ? resolve(call.name, call.args) : undefined);
      if (nested.some(text => text !== undefined)) facts[message.toolCallId] = { ...facts[message.toolCallId], nested };
    }
  }
  return facts;
}
