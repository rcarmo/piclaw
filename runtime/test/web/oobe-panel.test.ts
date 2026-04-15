import { expect, test } from 'bun:test';

import { OobePanel } from '../../web/src/components/oobe-panel.ts';

test('OobePanel renders provider setup guidance', () => {
  const vnode = OobePanel({ kind: 'provider-missing' });
  const serialized = JSON.stringify(vnode);
  expect(serialized).toContain('Connect an AI provider');
  expect(serialized).toContain('Set up with /login');
  expect(serialized).toContain('The workspace is running');
  expect(serialized).toContain('not web-app sign-in');
});

test('OobePanel renders ready-state next steps', () => {
  const vnode = OobePanel({ kind: 'provider-ready' });
  const serialized = JSON.stringify(vnode);
  expect(serialized).toContain('You’re ready to chat');
  expect(serialized).toContain('Try /model');
  expect(serialized).toContain('Open workspace');
  expect(serialized).toContain('Got it');
});
