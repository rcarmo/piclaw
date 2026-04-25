import { describe, expect, test } from 'bun:test';

import {
  MAX_EDITABLE_PREVIEW_BYTES,
  hasSpecializedWorkspaceTab,
  isEditableWorkspacePreview,
  shouldAutoOpenWorkspaceFile,
} from '../../web/src/ui/workspace-auto-open.js';

describe('workspace auto-open gating', () => {
  test('treats text previews under the edit limit as editable', () => {
    expect(isEditableWorkspacePreview({ kind: 'text', size: 1024 })).toBe(true);
    expect(isEditableWorkspacePreview({ kind: 'text', size: MAX_EDITABLE_PREVIEW_BYTES })).toBe(true);
  });

  test('rejects binary and oversized previews for generic editor auto-open', () => {
    expect(isEditableWorkspacePreview({ kind: 'binary', size: 64 })).toBe(false);
    expect(isEditableWorkspacePreview({ kind: 'text', size: MAX_EDITABLE_PREVIEW_BYTES + 1 })).toBe(false);
  });

  test('recognises specialized panes but excludes the generic editor fallback', () => {
    const resolvePane = ({ path }: any) => {
      if (String(path).endsWith('.pdf')) return { id: 'pdf-viewer' };
      return { id: 'editor' };
    };

    expect(hasSpecializedWorkspaceTab('docs/file.pdf', resolvePane)).toBe(true);
    expect(hasSpecializedWorkspaceTab('notes/file.md', resolvePane)).toBe(false);
  });

  test('auto-opens viewer-supported files even without a preview', () => {
    const resolvePane = ({ path }: any) => String(path).endsWith('.widget') ? { id: 'custom-widget' } : { id: 'editor' };
    expect(shouldAutoOpenWorkspaceFile('widgets/sample.widget', null, { resolvePane })).toBe(true);
  });

  test('auto-opens generic files only when the loaded preview is editable text', () => {
    const resolvePane = () => ({ id: 'editor' });
    expect(shouldAutoOpenWorkspaceFile('notes/todo.md', { kind: 'text', size: 2048 }, { resolvePane })).toBe(true);
    expect(shouldAutoOpenWorkspaceFile('assets/archive.bin', { kind: 'binary', size: 2048 }, { resolvePane })).toBe(false);
  });
});
