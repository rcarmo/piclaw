import { CLASSIC_A2UI_CATALOG, type A2uiSurfaceBlock } from './surface.js';

export function buildRecoverySurface(): A2uiSurfaceBlock {
  const fallback = 'Review earlier tool results before continuing; no work is replayed automatically.';
  return { type: 'a2ui_surface', owner: 'recovery', state: 'active', revision: 1, fallback_text: fallback,
    surface: { surfaceId: crypto.randomUUID(), catalogId: CLASSIC_A2UI_CATALOG, dataModel: {}, components: [
      { id: 'root', component: 'Column', children: ['warning', 'actions'] },
      { id: 'warning', component: 'Text', text: fallback },
      { id: 'actions', component: 'Row', children: ['continue', 'retry'] },
      { id: 'continue', component: 'Button', child: 'continue_label', variant: 'primary', action: { event: { name: 'recovery-continue' } } },
      { id: 'continue_label', component: 'Text', text: 'Continue' },
      { id: 'retry', component: 'Button', child: 'retry_label', action: { event: { name: 'recovery-retry-clean' } } },
      { id: 'retry_label', component: 'Text', text: 'Retry cleanly' },
    ] } };
}

/** A new admitted message, never an SDK replay or on-click tool execution. */
export function recoveryPrompt(name: string, postId: number): string | undefined {
  const prompt = name === 'recovery-continue'
    ? 'Continue the previous answer from the last partial output without repeating completed parts.'
    : name === 'recovery-retry-clean' ? 'Retry the previous request cleanly with a fresh answer. Do not continue a partial answer inline.' : undefined;
  return prompt && `${prompt} This refers to the failed turn at timeline post ${postId} in this thread. Use the current recorded state and do not rerun side-effecting tools automatically.`;
}
