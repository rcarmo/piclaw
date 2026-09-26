import { expect, test } from 'bun:test';

import {
  bindComposeReferenceRemoval,
  composeMainInteractionResult,
} from '../../web/src/ui/app-main-interaction-composition.js';

test('bindComposeReferenceRemoval exposes the latest removal action through a stable ref bridge', () => {
  const removeFileRefRef: { current: ((path: unknown) => void) | null } = { current: null };
  const removed: string[] = [];
  const closeTab = (path: string) => removeFileRefRef.current?.(path);

  closeTab('before-binding.md');
  bindComposeReferenceRemoval({
    removeFileRefRef,
    composeReferenceActions: { removeFileRef: path => removed.push(`first:${path}`) },
  });
  closeTab('first.md');
  bindComposeReferenceRemoval({
    removeFileRefRef,
    composeReferenceActions: { removeFileRef: path => removed.push(`latest:${path}`) },
  });
  closeTab('second.md');

  expect(removed).toEqual(['first:first.md', 'latest:second.md']);
});

test('composeMainInteractionResult preserves grouped interaction outputs', () => {
  const applyBranding = () => {};
  const result = composeMainInteractionResult({
    applyBranding,
    composeReferenceActions: { addFileRef: () => {} },
    agentActivity: { clearAgentRunState: () => {} },
    chatPaneRuntime: { setActiveTurn: () => {} },
    recoveryCallbacks: { removeStalledPost: () => {} },
  });

  expect(result.applyBranding).toBe(applyBranding);
  expect(typeof result.composeReferenceActions.addFileRef).toBe('function');
  expect(typeof result.clearAgentRunState).toBe('function');
  expect(typeof result.setActiveTurn).toBe('function');
  expect(typeof result.recoveryCallbacks.removeStalledPost).toBe('function');
});
