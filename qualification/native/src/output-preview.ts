import type { Message, SimpleStreamOptions } from '../../../runtime/durable-engine/qualification/ai.ts';
import { normalizeContext } from '../../../runtime/src/durable-legacy-sdk.ts';
import { previewSdkRequest } from '../../../runtime/src/agent-pool/model-request-preview.ts';

// Stock SDK public adapter wrapper; actual Root ModelRuntime/wire handoffs are
// independently covered in model-request-output.test.ts.
export function outputPreview(messages: readonly Message[], target: { contextWindow: number; maxTokens: number }, api: 'openai-completions' | 'openai-responses' = 'openai-completions', options?: SimpleStreamOptions) {
  return previewSdkRequest({ api, provider: 'unit-output-preview', id: 'unit', name: 'Unit', baseUrl: 'https://offline.invalid/v1',
    input: ['text'], reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ...target,
    ...(api === 'openai-completions' ? { compat: { maxTokensField: 'max_completion_tokens' as const } } : {}),
  }, normalizeContext({ messages: [...messages] }), options);
}
