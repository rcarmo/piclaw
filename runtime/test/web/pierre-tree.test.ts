import { expect, test } from 'bun:test';

import { PLACEHOLDER_NAME, buildTreePaths, fromTreePath, isPlaceholderPath, toTreePath } from '../../web/src/workspace-tree/pierre-tree.js';

test('explorer and tree paths convert both ways; directories end with a slash', () => {
  expect(toTreePath('demo', 'dir')).toBe('demo/');
  expect(toTreePath('demo/config.json', 'file')).toBe('demo/config.json');
  expect(fromTreePath('demo/')).toEqual({ path: 'demo', type: 'dir' });
  expect(fromTreePath('demo/data.csv')).toEqual({ path: 'demo/data.csv', type: 'file' });
});

test('loaded nodes flatten to tree paths, with placeholders only for unloaded non-empty directories', () => {
  const root = {
    path: '.', type: 'dir' as const, children: [
      { path: 'demo', type: 'dir' as const, child_count: 2, children: [{ path: 'demo/config.json', type: 'file' as const }, { path: 'demo/data.csv', type: 'file' as const }] },
      { path: 'notes', type: 'dir' as const, child_count: 4 },
      { path: 'empty', type: 'dir' as const, child_count: 0 },
      { path: 'AGENTS.md', type: 'file' as const },
    ],
  };
  const { paths, counts } = buildTreePaths(root);
  expect(paths).toEqual(['demo/', 'demo/config.json', 'demo/data.csv', 'notes/', `notes/${PLACEHOLDER_NAME}`, 'empty/', 'AGENTS.md']);
  expect(counts.get('notes/')).toBe(4);
  expect(isPlaceholderPath(`notes/${PLACEHOLDER_NAME}`)).toBe(true);
  expect(isPlaceholderPath('notes/today.md')).toBe(false);
  expect(buildTreePaths(null)).toEqual({ paths: [], counts: new Map() });
});
