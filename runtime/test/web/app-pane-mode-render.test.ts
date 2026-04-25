import { expect, test } from 'bun:test';

import {
  renderBranchLoaderMode,
  renderPanePopoutMode,
  resolveAppShellRenderMode,
  resolveBranchLoaderHeading,
} from '../../web/src/ui/app-pane-mode-render.js';

test('resolveAppShellRenderMode prioritizes branch-loader mode over pane popout', () => {
  expect(resolveAppShellRenderMode({ branchLoaderMode: true, panePopoutMode: true })).toBe('branch-loader');
  expect(resolveAppShellRenderMode({ branchLoaderMode: false, panePopoutMode: true })).toBe('pane-popout');
  expect(resolveAppShellRenderMode({ branchLoaderMode: false, panePopoutMode: false })).toBe('main');
});

test('resolveBranchLoaderHeading reflects error state copy', () => {
  expect(resolveBranchLoaderHeading('error')).toBe('Could not open branch window');
  expect(resolveBranchLoaderHeading('running')).toBe('Opening branch…');
});

test('renderBranchLoaderMode includes the branch-loader message body', () => {
  const vnode = renderBranchLoaderMode({ status: 'running', message: 'Preparing branch' });
  const serialized = JSON.stringify(vnode);
  expect(serialized).toContain('Opening branch…');
  expect(serialized).toContain('Preparing branch');
});

test('renderPanePopoutMode renders fallback copy when no pane is mounted', () => {
  const vnode = renderPanePopoutMode({
    appShellRef: { current: null },
    editorOpen: false,
    hidePanePopoutControls: false,
    panePopoutHasMenuActions: false,
    panePopoutTitle: 'Pane',
    tabStripTabs: [],
    tabStripActiveId: null,
    handleTabActivate: () => undefined,
    previewTabs: new Set(),
    diffTabs: new Set(),
    handleTabTogglePreview: () => undefined,
    handleTabToggleDiff: () => undefined,
    editorContainerRef: { current: null },
    getPaneContent: () => '',
    panePopoutPath: null,
  });

  expect(JSON.stringify(vnode)).toContain('No pane path provided.');
});

test('renderPanePopoutMode hides controls entirely when the only action would be manual reattach', () => {
  const vnode = renderPanePopoutMode({
    appShellRef: { current: null },
    editorOpen: true,
    hidePanePopoutControls: false,
    panePopoutHasMenuActions: false,
    panePopoutTitle: 'Terminal',
    tabStripTabs: [{ id: 'piclaw://terminal', label: 'Terminal' }],
    tabStripActiveId: 'piclaw://terminal',
    handleTabActivate: () => undefined,
    previewTabs: new Set(),
    diffTabs: new Set(),
    handleTabTogglePreview: () => undefined,
    handleTabToggleDiff: () => undefined,
    editorContainerRef: { current: null },
    getPaneContent: () => '',
    panePopoutPath: 'piclaw://terminal',
    canReattachPane: true,
    handleReattachPane: () => undefined,
  });

  const serialized = JSON.stringify(vnode);
  expect(serialized).not.toContain('pane-popout-hover-zone');
  expect(serialized).not.toContain('pane-popout-controls-icon-button');
  expect(serialized).not.toContain('Reattach Terminal to the main window');
});

test('renderPanePopoutMode keeps pane actions inside the overflow menu when multiple controls exist', () => {
  const vnode = renderPanePopoutMode({
    appShellRef: { current: null },
    editorOpen: true,
    hidePanePopoutControls: false,
    panePopoutHasMenuActions: true,
    panePopoutTitle: 'Diagram',
    tabStripTabs: [
      { id: '/workspace/foo.widget', label: 'foo.widget' },
      { id: '/workspace/bar.widget', label: 'bar.widget' },
    ],
    tabStripActiveId: '/workspace/foo.widget',
    handleTabActivate: () => undefined,
    previewTabs: new Set(['/workspace/foo.widget']),
    diffTabs: new Set(['/workspace/foo.widget']),
    handleTabTogglePreview: () => undefined,
    handleTabToggleDiff: () => undefined,
    editorContainerRef: { current: null },
    getPaneContent: () => '',
    panePopoutPath: '/workspace/foo.widget',
    canReattachPane: true,
    handleReattachPane: () => undefined,
  });

  const serialized = JSON.stringify(vnode);
  expect(serialized).toContain('pane-popout-controls-menu');
  expect(serialized).toContain('pane-popout-controls-icon-button');
  expect(serialized).toContain('Open panes');
  expect(serialized).toContain('Hide diff');
  expect(serialized).toContain('Hide preview');
  expect(serialized).not.toContain('Reattach to main window');
  expect(serialized).not.toContain('>Diagram<');
});
