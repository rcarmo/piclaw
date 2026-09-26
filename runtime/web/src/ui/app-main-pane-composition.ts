import { useRef } from '../vendor/preact-htm.js';
import { useEditorState } from './use-editor-state.js';
import { usePaneRuntimeOrchestration } from './app-pane-runtime-orchestration.js';
import type { RemoveFileReference, RemoveFileReferenceRef } from './app-compose-reference-orchestration.js';

export function buildMainAppPaneCompositionResult(options: {
  removeFileRefRef: RemoveFileReferenceRef;
  editorState: Record<string, any>;
  paneRuntime: Record<string, any>;
}) {
  return {
    removeFileRefRef: options.removeFileRefRef,
    editorState: options.editorState,
    paneRuntime: options.paneRuntime,
  };
}

export function usePaneComposeReferenceRemoval() {
  const removeFileRefRef = useRef<RemoveFileReference | null>(null);
  const onTabClosed = (path: string) => removeFileRefRef.current?.(path);
  return { removeFileRefRef, onTabClosed };
}

export function useMainAppPaneComposition(options: {
  panePopoutMode: boolean;
  panePopoutPath: string | null;
  panePopoutLabel: string | null;
  chatOnlyMode: boolean;
  terminalTabPath: string;
  vncTabPrefix: string;
  getWorkspaceFile: (path: string, maxBytes: number, mode: string) => Promise<any>;
}) {
  const { removeFileRefRef, onTabClosed } = usePaneComposeReferenceRemoval();

  const editorState = useEditorState({ onTabClosed });

  const paneRuntime = usePaneRuntimeOrchestration({
    panePopoutMode: options.panePopoutMode,
    panePopoutPath: options.panePopoutPath,
    panePopoutLabel: options.panePopoutLabel,
    chatOnlyMode: options.chatOnlyMode,
    editorOpen: editorState.editorOpen,
    tabStripTabs: editorState.tabStripTabs,
    tabStripActiveId: editorState.tabStripActiveId,
    previewTabs: editorState.previewTabs,
    diffTabs: editorState.diffTabs,
    tabPaneOverrides: editorState.tabPaneOverrides,
    terminalTabPath: options.terminalTabPath,
    vncTabPrefix: options.vncTabPrefix,
    openEditor: editorState.openEditor,
    closeEditor: editorState.closeEditor,
    getWorkspaceFile: options.getWorkspaceFile,
  });

  return buildMainAppPaneCompositionResult({
    removeFileRefRef,
    editorState,
    paneRuntime,
  });
}
