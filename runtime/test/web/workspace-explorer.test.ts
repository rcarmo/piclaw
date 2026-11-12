import { expect, test } from 'bun:test';

import {
  buildWorkspaceMoveConfirmationMessage,
  confirmWorkspaceEntryMove,
  mergeWorkspaceTreeUpdates,
} from '../../web/src/components/workspace-explorer.ts';

test('workspace move confirmation describes file and folder destinations', () => {
  expect(buildWorkspaceMoveConfirmationMessage('notes/report.md', 'archive', 'file')).toBe(
    'Move file "report.md" from "notes" to "archive"?',
  );
  expect(buildWorkspaceMoveConfirmationMessage('projects/demo', '.', 'dir')).toBe(
    'Move folder "demo" from "projects" to the workspace root?',
  );
});

test('workspace move confirmation supports localized labels and root copy', () => {
  const messages: Record<string, string> = {
    'workspace.moveConfirm': 'MOVER {entry} {name}: {source} -> {target}',
    'workspace.root': 'RAIZ',
    'workspace.file': 'FICHEIRO',
    'workspace.folder': 'PASTA',
  };
  const translate = (key: string, values: Record<string, string> = {}) => Object.entries(values)
    .reduce((text, [name, value]) => text.replace(`{${name}}`, value), messages[key] || key);

  expect(buildWorkspaceMoveConfirmationMessage('projects/demo', '.', 'dir', translate)).toBe(
    'MOVER PASTA demo: "projects" -> RAIZ',
  );
});

test('workspace move confirmation respects cancel and confirm responses', () => {
  const prompts: string[] = [];
  const cancel = confirmWorkspaceEntryMove('notes/report.md', 'archive', 'file', (message: string) => {
    prompts.push(message);
    return false;
  });
  const confirm = confirmWorkspaceEntryMove('projects/demo', '.', 'dir', (message: string) => {
    prompts.push(message);
    return true;
  });

  expect(cancel).toBe(false);
  expect(confirm).toBe(true);
  expect(prompts).toEqual([
    'Move file "report.md" from "notes" to "archive"?',
    'Move folder "demo" from "projects" to the workspace root?',
  ]);
});

test('workspace root updates preserve descendants loaded beyond the watcher depth', () => {
  const previous = {
    path: '.', type: 'dir', children: [{
      path: 'notes', type: 'dir', children: [{
        path: 'notes/days', type: 'dir', children: [{
          path: 'notes/days/2026', type: 'dir', children: [{
            path: 'notes/days/2026/07', type: 'dir', children: [
              { path: 'notes/days/2026/07/09.md', type: 'file' },
            ],
          }],
        }],
      }],
    }],
  };
  const watcherRoot = {
    path: '.', type: 'dir', children: [{
      path: 'notes', type: 'dir', children: [{
        path: 'notes/days', type: 'dir', children: [{
          path: 'notes/days/2026', type: 'dir', children: [{
            path: 'notes/days/2026/07', type: 'dir',
          }],
        }],
      }],
    }],
  };

  const merged = mergeWorkspaceTreeUpdates(previous, [{ path: '.', root: watcherRoot, truncated: false }]);

  expect(merged.children[0].children[0].children[0].children[0].children).toEqual([
    { path: 'notes/days/2026/07/09.md', type: 'file' },
  ]);
});

test('truncated workspace updates defer replacement until a targeted reload', () => {
  const previous = {
    path: '.', type: 'dir', children: [
      { path: 'a', type: 'dir', children: [] },
      { path: 'b', type: 'dir', children: [] },
      { path: 'c', type: 'dir', children: [] },
    ],
  };
  const partialRoot = {
    path: '.', type: 'dir', children: [
      { path: 'a', type: 'dir', children: [] },
    ],
  };

  const merged = mergeWorkspaceTreeUpdates(previous, [{ path: '.', root: partialRoot, truncated: true }]);

  expect(merged).toBe(previous);
  expect(merged.children.map((child) => child.path)).toEqual(['a', 'b', 'c']);
});
