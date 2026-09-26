// Checked by typecheck:web-compose. These negative assignments must remain compiler errors.
import type { ComposeReferenceActions, RemoveFileReference, RemoveFileReferenceRef, UseComposeReferenceOrchestrationOptions } from '../../../web/src/ui/app-compose-reference-orchestration.js';
import { bindComposeReferenceRemoval, composeMainInteractionResult } from '../../../web/src/ui/app-main-interaction-composition.js';
import { buildMainAppPaneCompositionResult } from '../../../web/src/ui/app-main-pane-composition.js';
import { composeMainAppShellOptions } from '../../../web/src/ui/app-main-shell-composition.js';

declare const actions: ComposeReferenceActions;
declare const removal: RemoveFileReference;
declare const ref: RemoveFileReferenceRef;
declare const options: UseComposeReferenceOrchestrationOptions;

const removeAction: RemoveFileReference = actions.removeFileRef;
const nullableRef: RemoveFileReferenceRef = { current: null };
const interactionInput: Parameters<typeof composeMainInteractionResult>[0] = {
  applyBranding() {}, composeReferenceActions: actions, agentActivity: {}, chatPaneRuntime: {}, recoveryCallbacks: {},
};
const paneInput: Parameters<typeof buildMainAppPaneCompositionResult>[0] = {
  removeFileRefRef: ref, editorState: {}, paneRuntime: {},
};
const shellInput: Parameters<typeof composeMainAppShellOptions>[0] = {
  routing: { branchLoaderMode: false, panePopoutMode: false, branchLoaderState: null },
  paneRuntime: {}, splitters: {}, branchPaneActions: {}, timelineViewActions: {},
  composeReferenceActions: actions, sidepanelActions: {}, shellState: {}, agentState: {}, composeState: {}, modelState: {},
};
void [removeAction, nullableRef, interactionInput, paneInput, shellInput, options];
bindComposeReferenceRemoval({ removeFileRefRef: ref, composeReferenceActions: actions });

// @ts-expect-error Removal bridge cannot hold a non-callable value.
const badRemoval: RemoveFileReferenceRef = { current: { path: 'file.ts' } };
// @ts-expect-error Pane close bridge requires the typed ref.
buildMainAppPaneCompositionResult({ removeFileRefRef: { current: 123 }, editorState: {}, paneRuntime: {} });
// @ts-expect-error The binding requires a callable removeFileRef action.
bindComposeReferenceRemoval({ removeFileRefRef: ref, composeReferenceActions: { removeFileRef: 123 } });
// @ts-expect-error MainApp interaction callers must supply all compose-reference actions.
const incompleteInteraction: Parameters<typeof composeMainInteractionResult>[0] = { ...interactionInput, composeReferenceActions: { removeFileRef: removal } };
// @ts-expect-error MainApp shell callers must supply all compose-reference actions.
const incompleteShell: Parameters<typeof composeMainAppShellOptions>[0] = { ...shellInput, composeReferenceActions: { addFileRef() {} } };
// @ts-expect-error Options require an actual editor opener.
const badOptions: UseComposeReferenceOrchestrationOptions = { ...options, openEditor: 123 };
void [badRemoval, incompleteInteraction, incompleteShell, badOptions];
