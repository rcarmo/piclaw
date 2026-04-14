import { expect, test } from 'bun:test';

import { stripMarkdownCodeFenceMarkers, summarizeCommandStatusTitle } from '../../../src/channels/web/handlers/agent.ts';

test('stripMarkdownCodeFenceMarkers removes wrapping fenced block markers', () => {
  expect(stripMarkdownCodeFenceMarkers('```\n$ exit 2\n(exit code 2)\n```')).toBe('$ exit 2\n(exit code 2)');
  expect(stripMarkdownCodeFenceMarkers('```bash\n$ pwd\n/workspace\n```')).toBe('$ pwd\n/workspace');
});

test('summarizeCommandStatusTitle removes fences and collapses multiline shell output for status toasts', () => {
  expect(summarizeCommandStatusTitle('```\n$ exit 2\n(exit code 2)\n```')).toBe('$ exit 2 (exit code 2)');
  expect(summarizeCommandStatusTitle('boom')).toBe('boom');
  expect(summarizeCommandStatusTitle('', 'Command failed')).toBe('Command failed');
});
