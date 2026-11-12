/**
 * panes/index.ts — Pane system barrel export.
 *
 * Re-exports types, registry, and built-in pane extensions.
 * The editor extension is lazy-loaded (CodeMirror stays out of core bundle).
 */

export type { PanePlacement, PaneCapability, PaneContext, PaneHostAttachContext, PaneHostDetachContext, PaneInstance, WebPaneExtension } from './pane-types.js';
export { paneRegistry } from './pane-registry.js';
export { editorPaneExtension, preloadEditorBundle } from './editor-loader.js';
export { terminalPaneExtension, terminalTabPaneExtension, TERMINAL_TAB_PATH } from './terminal-pane.js';
export { vncPaneExtension, VNC_TAB_PREFIX, buildVncTabPath } from './vnc-pane.js';
export { workspacePreviewPaneExtension, workspaceMarkdownPreviewPaneExtension } from './workspace-preview-pane.js';
export { officeViewerPaneExtension } from './office-viewer-pane.js';
export { dataViewerPaneExtension } from './data-viewer-pane.js';
export { webViewerPaneExtension } from './web-viewer-pane.js';
export { highlightPreviewerPaneExtension } from './highlight-previewer-pane.js';
export type { TabState, TabViewState } from './tab-store.js';
export { tabStore } from './tab-store.js';

export { cdpPaneExtension, CDP_TAB_PATH } from './cdp-pane.js';
export { planPaneExtension, PLAN_TAB_PATH } from './plan-loader.js';
export { createSettingsPane, SETTINGS_TAB_PATH } from './settings-pane.js';
