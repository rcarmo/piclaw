# Classic workspace audit

> Historical source audit. Visual was removed in #1990; paths and counts below describe the inspected revision, not the current UI.

Scope audited from source only:

- `runtime/web/src/components/workspace-explorer.ts`
- `runtime/web/src/components/tab-strip.ts`
- `runtime/web/src/panes/tab-store.ts`
- `runtime/web/src/panes/workspace-preview-pane.ts`
- `runtime/web/src/panes/terminal-pane.ts`
- `runtime/web/src/panes/vnc-pane.ts`
- existing tests under `runtime/test/web/` and `tests/e2e/steps/`

No execution claims. No Visual parity claims.

| ID | Focus | Source evidence | Existing test | Notes |
| --- | --- | --- | --- | --- |
| `@ux-workspace-001` | create untitled file | `runtime/web/src/components/workspace-explorer.ts` — `createUntitledFile`, `handleCreateFileClick`, `resolveCreateTargetPath` | unavailable | Source creates `untitled.md` with numbered fallbacks and refreshes subtree/preview/index. |
| `@ux-workspace-002` | rename entry | `runtime/web/src/components/workspace-explorer.ts` — `beginRename`, `commitRename` | `tests/e2e/steps/us10-workspace-files.spec.ts` — `test('rename has clear affordance and works', ...)` | Source also dispatches `workspace-file-renamed` and remaps expanded descendants for renamed directories. |
| `@ux-workspace-003` | delete file | `runtime/web/src/components/workspace-explorer.ts` — `deleteFileAtPath`, `handleDeleteFile` | `tests/e2e/steps/us10-workspace-files.spec.ts` — `test('delete requires confirmation', ...)` | Source only exposes delete for files, not directories. |
| `@ux-workspace-004` | hidden toggle persistence | `runtime/web/src/components/workspace-explorer.ts` — `handleToggleHidden`, `flattenTree` | `tests/e2e/steps/us24-hamburger-menu-items.spec.ts` — `test('hamburger menu contains hidden files toggle', ...)` | Source persists `workspaceShowHidden` and reloads expanded subtrees. |
| `@ux-workspace-005` | reindex controls / search gap | `runtime/web/src/components/workspace-explorer.ts` — header menu render around `handleWorkspaceReindex`, `handleMenuToggleHidden`, `handleMenuCreateFile`, `handleMenuUploadFiles` | `tests/e2e/steps/us24-hamburger-menu-items.spec.ts` — `test('hamburger menu contains New file, Refresh tree, Reindex workspace', ...)` | No dedicated file-search field was verified in this inspected component. |
| `@ux-workspace-006` | click preview / double-click rename | `runtime/web/src/components/workspace-explorer.ts` — `handleTreeClick`, `handleTreeDblClick`, `onFileSelectRef.current`, `loadPreviewRef.current` | `tests/e2e/steps/us10-workspace-files.spec.ts` — `test('double-click file opens in editor', ...)` | Existing e2e name conflicts with current source, which double-clicks into rename mode. |
| `@ux-workspace-007` | upload flow | `runtime/web/src/components/workspace-explorer.ts` — `handleDrop`, `uploadFilesToTarget`, `handleUploadInputChange`<br>`runtime/web/src/ui/upload-transfers.ts` — `uploadFileBatch`, `uploadWorkspaceFile` | `tests/e2e/steps/us10-workspace-files.spec.ts` — `test('upload via drag-and-drop shows progress', ...)`<br>`runtime/web/src/ui/upload-transfers.test.ts` — `test('keeps the chunk protocol and reports cumulative byte progress', ...)` | Source prompts before overwrite on `409` / `file_exists`. |
| `@ux-workspace-008` | preview renderer branches | `runtime/web/src/panes/workspace-preview-pane.ts` — `renderWorkspacePreviewMarkup`, `workspaceMarkdownPreviewPaneExtension`, `workspacePreviewPaneExtension` | unavailable | Markdown, generic text, image, and binary preview branches are source-backed. |
| `@ux-workspace-009` | open-in-tab / open-in-editor gating | `runtime/web/src/components/workspace-explorer.ts` — `hasOpenableWorkspaceTab`, `selectedHasOpenableTab`, `canEdit`, `handleMenuOpenTab`, `handleMenuOpenEditor` | `tests/e2e/steps/us10-workspace-files.spec.ts` — `test('selecting AGENTS.md and clicking Open in editor opens the editor tab', ...)` | `Open in editor` is source-gated to text previews at `<= 256 * 1024` bytes. |
| `@ux-workspace-010` | dirty tab affordances | `runtime/web/src/components/tab-strip.ts` — dirty class render, close button title/aria, `contextMenuCanCompareToSaved`<br>`runtime/web/src/ui/tab-compare-saved.ts` — `canTabCompareToSaved` | `runtime/test/web/tab-store.test.ts` — `test('setDirty marks tab dirty', ...)`<br>`runtime/test/web/tab-compare-saved.test.ts` — `test('canTabCompareToSaved is available for generic editor tabs', ...)` | No inspected test specifically asserts the dirty-dot tab-strip rendering. |
| `@ux-workspace-011` | close / close others / close all | `runtime/web/src/panes/tab-store.ts` — `close`, `closeOthers`, `closeAll` | `runtime/test/web/tab-store.test.ts` — `test('closing active tab activates MRU', ...)`, `test('closes all except specified', ...)`, `test('closes all unpinned tabs', ...)`<br>`tests/e2e/steps/us10-workspace-files.spec.ts` — `test('clicking the close icon on the editor tab closes the AGENTS.md tab', ...)` | Source preserves pinned tabs in bulk close flows. |
| `@ux-workspace-012` | tab rename state | `runtime/web/src/panes/tab-store.ts` — `rename` | `runtime/test/web/tab-store.test.ts` — `test('renames tab path, id, and label', ...)`, `test('rename updates active id', ...)`, `test('rename preserves MRU position', ...)` | No inspected source listener wiring from `workspace-file-renamed` to `tabStore.rename` was audited. |
| `@ux-workspace-013` | dock / popout / standalone routing | `runtime/web/src/components/tab-strip.ts` — `getStandaloneTabUrl`, tab context menu render, dock toggle render | `runtime/test/web/tab-strip.test.ts` — `test('terminal dock menu item is only exposed from the active tab context menu', ...)`, `test('getStandaloneTabUrl honors addon-provided standalone routes', ...)`, `test('getStandaloneTabUrl still resolves standalone viewer routes for non-addon files', ...)`<br>`tests/e2e/steps/us24-hamburger-menu-items.spec.ts` — `test('terminal dock toggle is not shown in the hamburger workspace menu', ...)` | Existing inspected tests do not cover reattach or `Open in window` actions directly. |
| `@ux-workspace-014` | terminal availability / reconnect / exit | `runtime/web/src/panes/terminal-pane.ts` — bootstrap catch around xterm load, `connectBackend`, `scheduleReconnect`, terminal exit handling, `terminalPaneExtension`, `terminalTabPaneExtension` | `tests/e2e/steps/us13-15-terminal.spec.ts` — `test('open terminal without garbled output', ...)`, `test('close terminal via tab close button', ...)`, `test('toggle dock via Ctrl+Backtick', ...)` | No inspected test directly covers disabled backend, reconnect scheduling, or exit markers. |
| `@ux-workspace-015` | VNC manager / scoped history / hideaway controls / recovery | `runtime/web/src/panes/vnc-pane.ts`, `vnc-history.ts`, `vnc-viewer-ui.ts` | `runtime/test/web/vnc-history.test.ts`, `runtime/test/channels/web/vnc-history-scope.test.ts`, `runtime/test/web/vnc-viewer.playwright.optional.test.ts` | Updated with real disposable x11vnc execution; see [evidence](../../../../../docs/reviews/vnc-viewer-ux.md). Other rows remain source-only. |

## Remaining gaps

- No verified Classic in-pane workspace search control was found in the inspected explorer component; only refresh/reindex/index-status hooks were source-backed.
- No Visual frontend workspace parity was verified. `runtime/web/static/visual/frontend/` was not audited beyond discovery.
- Save and conflict callbacks are now covered by 016–018 below; edits made during an asynchronous save have no post-write snapshot guard in `handleSave`.
- No inspected source wiring was found here for converting `workspace-file-renamed` events into `tabStore.rename`; the store capability exists, but listener coverage was not audited.
- No inspected automated tests were found for workspace preview renderer branches, hidden-toggle persistence details, terminal disabled/reconnect/exit paths, or VNC pane behavior.
- Existing test naming currently diverges from source on workspace double-click behavior (`us10-workspace-files.spec.ts` says open-in-editor; current source enters rename mode).

## Editor continuation

| ID | Source | Disposition / evidence |
|---|---|---|
| ux-workspace-016 | `runtime/extensions/viewers/editor/editor-extension.ts` — handleSave | Captured write, saved baseline/mtime update and unconditional dirty clear after success; error status on failure. Related `runtime/test/web/editor-extension.test.ts`. |
| ux-workspace-017 | same — handleSave unchanged-text branch | No write when the current text equals the saved baseline. |
| ux-workspace-018 | same — initConflictMonitor callbacks | Reload restores view; save-copy writes copyPath; overwrite calls handleSave. |

Independent source review checked 001–018. Its objection to the save-race comment compared the pre-write unchanged-text guard with the post-write path; those are different branches. Comment clarified without inventing a concurrency guarantee. No browser execution.
