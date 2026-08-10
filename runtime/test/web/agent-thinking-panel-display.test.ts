import { expect, test } from 'bun:test';

import {
  resolveThinkingPanelDisplayText,
  truncateThinkingPanelLines,
} from '../../web/src/components/status.js';

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n');
}

test('collapsed thoughts render a stable bottom window instead of the full growing text', () => {
  const sourceText = numberedLines(20);
  const result = resolveThinkingPanelDisplayText({
    sourceText,
    panelKey: 'thought',
    isExpanded: false,
    maxLines: 9,
    totalLines: 20,
  });

  expect(result.displayText).toBe(numberedLines(20).split('\n').slice(-9).join('\n'));
  const visibleLines = result.displayText.split('\n');
  expect(visibleLines).toContain('line 20');
  expect(visibleLines).not.toContain('line 1');
  expect(result.truncated.omitted).toBe(11);
});

test('expanded thoughts render the full text', () => {
  const sourceText = numberedLines(20);
  const result = resolveThinkingPanelDisplayText({
    sourceText,
    panelKey: 'thought',
    isExpanded: true,
    maxLines: 9,
    totalLines: 20,
  });

  expect(result.displayText).toBe(sourceText);
  expect(result.truncated.omitted).toBe(11);
});

test('collapsed drafts render the latest lines', () => {
  const sourceText = numberedLines(12);
  const result = resolveThinkingPanelDisplayText({
    sourceText,
    panelKey: 'draft',
    isExpanded: false,
    maxLines: 4,
    totalLines: 12,
  });

  expect(result.displayText).toBe(['line 9', 'line 10', 'line 11', 'line 12'].join('\n'));
});

test('plan panels keep head truncation semantics', () => {
  const result = truncateThinkingPanelLines(numberedLines(8), 3, 8, { direction: 'head' });

  expect(result.text).toBe(['line 1', 'line 2', 'line 3'].join('\n'));
  expect(result.omitted).toBe(5);
});
