import { afterEach, expect, test } from 'bun:test';

import { paneRegistry } from '../../web/src/panes/pane-registry.js';
import { registerAppPaneExtensions } from '../../web/src/ui/app-shell-bootstrap.js';
import { registerAppShellSurfaces } from '../../web/src/ui/app-shell-builtins.js';
import { listShellSurfaces, resetShellSurfaceRegistryForTests } from '../../web/src/ui/shell-surface-registry.js';

const registeredByTest = new Set<string>();
let previousKanbanExtension: any = null;

afterEach(() => {
  resetShellSurfaceRegistryForTests();
  for (const id of registeredByTest) paneRegistry.unregister(id);
  registeredByTest.clear();
  if (previousKanbanExtension) {
    paneRegistry.register(previousKanbanExtension);
    previousKanbanExtension = null;
  }
});

test('registerAppPaneExtensions does not register addon-owned kanban/mindmap panes by default', () => {
  previousKanbanExtension = paneRegistry.get('kanban-editor') || null;
  if (previousKanbanExtension) paneRegistry.unregister('kanban-editor');

  registerAppPaneExtensions();

  for (const ext of paneRegistry.list()) registeredByTest.add(ext.id);

  expect(paneRegistry.get('editor')).toBeTruthy();
  expect(paneRegistry.get('mindmap-editor')).toBeUndefined();
  expect(paneRegistry.get('kanban-editor')).toBeUndefined();
});

test('registerAppShellSurfaces is idempotent and does not create addon-owned surfaces', () => {
  registerAppShellSurfaces();
  registerAppShellSurfaces();

  expect(listShellSurfaces().filter((surface) => surface.owner === 'addon')).toEqual([]);
});
