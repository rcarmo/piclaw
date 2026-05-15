import { beforeEach, expect, mock, test } from 'bun:test';

import {
  clearShellSurfaceGeometry,
  clearShellSurfaceVisible,
  getShellSurface,
  getShellSurfaceGeometry,
  getShellSurfaceVisible,
  listShellSurfaces,
  registerShellSurface,
  renderShellSlot,
  resetShellSurfaceRegistryForTests,
  setShellSurfaceGeometry,
  setShellSurfaceVisible,
  subscribeShellSurfacesChanged,
  unregisterShellSurface,
  type ShellSurfaceDefinition,
} from '../../web/src/ui/shell-surface-registry.js';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function surface(overrides: Partial<ShellSurfaceDefinition> = {}): ShellSurfaceDefinition {
  return {
    id: 'surface.one',
    slot: 'timeline.core',
    label: 'Surface One',
    owner: 'addon',
    kind: 'configurable',
    order: 10,
    defaultVisible: true,
    render: () => 'surface one',
    ...overrides,
  };
}

beforeEach(() => {
  resetShellSurfaceRegistryForTests();
  globalThis.localStorage = createMemoryStorage();
  globalThis.window = {
    localStorage: globalThis.localStorage,
    dispatchEvent: mock(() => true),
  } as any;
});

test('registers, replaces same ids idempotently, and unregisters surfaces', () => {
  const unregister = registerShellSurface(surface());
  expect(getShellSurface('surface.one')?.label).toBe('Surface One');

  registerShellSurface(surface({ label: 'Replacement', order: 5, render: () => 'replacement' }));
  expect(listShellSurfaces()).toHaveLength(1);
  expect(getShellSurface('surface.one')?.label).toBe('Replacement');
  expect(renderShellSlot('timeline.core')).toEqual(['replacement']);

  unregister();
  expect(getShellSurface('surface.one')).toBeUndefined();
});

test('unregisterShellSurface removes by id', () => {
  registerShellSurface(surface());
  unregisterShellSurface('surface.one');
  expect(listShellSurfaces()).toEqual([]);
});

test('listShellSurfaces filters by slot and sorts by order then id', () => {
  registerShellSurface(surface({ id: 'b', slot: 'timeline.core', order: 2 }));
  registerShellSurface(surface({ id: 'a', slot: 'timeline.core', order: 2 }));
  registerShellSurface(surface({ id: 'c', slot: 'timeline.header', order: 1 }));
  registerShellSurface(surface({ id: 'first', slot: 'timeline.core', order: 1 }));

  expect(listShellSurfaces('timeline.core').map((info) => info.id)).toEqual(['first', 'a', 'b']);
  expect(listShellSurfaces('timeline.header').map((info) => info.id)).toEqual(['c']);
});

test('renderShellSlot renders only visible matching surfaces', () => {
  registerShellSurface(surface({ id: 'visible', slot: 'compose.before', order: 2, render: () => 'visible' }));
  registerShellSurface(surface({ id: 'hidden', slot: 'compose.before', order: 1, defaultVisible: false, render: () => 'hidden' }));
  registerShellSurface(surface({ id: 'other', slot: 'compose.after', render: () => 'other' }));

  expect(renderShellSlot('compose.before')).toEqual(['visible']);
});

test('renderShellSlot suppresses canRender false surfaces', () => {
  registerShellSurface(surface({ id: 'blocked', canRender: () => false, render: () => 'blocked' }));
  registerShellSurface(surface({ id: 'allowed', order: 20, canRender: () => true, render: () => 'allowed' }));

  expect(renderShellSlot('timeline.core')).toEqual(['allowed']);
});

test('renderShellSlot catches canRender and render errors', () => {
  const originalError = console.error;
  const error = mock(() => {});
  console.error = error;

  try {
    registerShellSurface(surface({ id: 'canRender.error', order: 1, canRender: () => { throw new Error('bad canRender'); } }));
    registerShellSurface(surface({ id: 'render.error', order: 2, render: () => { throw new Error('bad render'); } }));
    registerShellSurface(surface({ id: 'ok', order: 3, render: () => 'ok' }));

    expect(renderShellSlot('timeline.core')).toEqual(['ok']);
    expect(error).toHaveBeenCalledTimes(2);
  } finally {
    console.error = originalError;
  }
});

test('required surfaces cannot be hidden and are not configurable', () => {
  registerShellSurface(surface({ id: 'required', kind: 'required', defaultVisible: true }));

  setShellSurfaceVisible('required', false);

  expect(getShellSurfaceVisible('required', false)).toBe(true);
  expect(listShellSurfaces()[0]).toMatchObject({ id: 'required', visible: true, configurable: false });
});

test('configurable visibility persists as booleans stored as strings', () => {
  registerShellSurface(surface({ id: 'configurable', kind: 'configurable', defaultVisible: true }));

  setShellSurfaceVisible('configurable', false);

  expect(globalThis.localStorage.getItem('piclaw.shell.surface.configurable.visible')).toBe('false');
  expect(getShellSurfaceVisible('configurable', true)).toBe(false);
  expect(listShellSurfaces()[0]).toMatchObject({ id: 'configurable', visible: false, configurable: true });
});

test('visibility and geometry can be cleared back to defaults', () => {
  registerShellSurface(surface({ id: 'configurable', kind: 'configurable', defaultVisible: true }));
  setShellSurfaceVisible('configurable', false);
  setShellSurfaceGeometry('configurable', { width: 320, collapsed: false });

  expect(globalThis.localStorage.getItem('piclaw.shell.surface.configurable.visible')).toBe('false');
  expect(globalThis.localStorage.getItem('piclaw.shell.surface.configurable.geometry')).toBe('{"width":320,"collapsed":false}');
  expect(getShellSurfaceGeometry('configurable')).toEqual({ width: 320, collapsed: false });

  clearShellSurfaceVisible('configurable');
  clearShellSurfaceGeometry('configurable');

  expect(globalThis.localStorage.getItem('piclaw.shell.surface.configurable.visible')).toBeNull();
  expect(globalThis.localStorage.getItem('piclaw.shell.surface.configurable.geometry')).toBeNull();
  expect(getShellSurfaceVisible('configurable', true)).toBe(true);
  expect(getShellSurfaceGeometry('configurable')).toBeNull();
});

test('invalid ids and slots reject registration with clear errors', () => {
  expect(() => registerShellSurface(surface({ id: '' }))).toThrow('Shell surface id must be a non-empty string');
  expect(() => registerShellSurface(surface({ slot: 'bad.slot' as any }))).toThrow('Invalid shell surface slot: bad.slot');
});

test('registration, visibility, geometry, unregister, and explicit notify trigger subscribers and browser events', () => {
  const listener = mock(() => {});
  const unsubscribe = subscribeShellSurfacesChanged(listener);
  const dispatchEvent = globalThis.window.dispatchEvent as ReturnType<typeof mock>;

  registerShellSurface(surface({ id: 'events' }));
  setShellSurfaceVisible('events', false);
  setShellSurfaceGeometry('events', { height: 42 });
  unregisterShellSurface('events');

  expect(listener).toHaveBeenCalledTimes(4);
  expect(dispatchEvent).toHaveBeenCalledTimes(4);

  unsubscribe();
  registerShellSurface(surface({ id: 'after.unsubscribe' }));
  expect(listener).toHaveBeenCalledTimes(4);
  expect(dispatchEvent).toHaveBeenCalledTimes(5);
});

test('resetShellSurfaceRegistryForTests clears registry, subscribers, and shell storage keys', () => {
  const listener = mock(() => {});
  subscribeShellSurfacesChanged(listener);
  registerShellSurface(surface({ id: 'reset' }));
  setShellSurfaceVisible('reset', false);
  setShellSurfaceGeometry('reset', { width: 1 });

  resetShellSurfaceRegistryForTests();
  registerShellSurface(surface({ id: 'after.reset' }));

  expect(listShellSurfaces().map((info) => info.id)).toEqual(['after.reset']);
  expect(listener).toHaveBeenCalledTimes(3);
  expect(globalThis.localStorage.getItem('piclaw.shell.surface.reset.visible')).toBeNull();
  expect(globalThis.localStorage.getItem('piclaw.shell.surface.reset.geometry')).toBeNull();
});
