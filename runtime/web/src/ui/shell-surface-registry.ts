import type { ComponentChildren, VNode } from 'preact';

export type ShellSurfaceRenderResult = ComponentChildren | VNode | null;

export type ShellSurfaceSlot =
  | 'app.overlay'
  | 'workspace.sidebar'
  | 'workspace.toggle'
  | 'workspace.splitter'
  | 'editor.region'
  | 'editor.tabbar'
  | 'editor.host'
  | 'editor.preview'
  | 'editor.splitter'
  | 'dock.splitter'
  | 'dock.panel'
  | 'dock.header'
  | 'dock.body'
  | 'timeline.menu'
  | 'timeline.quick-actions'
  | 'timeline.header'
  | 'timeline.above'
  | 'timeline.core'
  | 'timeline.below'
  | 'status.core'
  | 'status.extension'
  | 'compose.before'
  | 'compose.box'
  | 'compose.after'
  | 'settings.loader'
  | 'app.modal';

export type ShellSurfaceOwner = 'core' | 'addon';
export type ShellSurfaceKind = 'required' | 'configurable' | 'additive';

export interface ShellSurfaceRenderContext<TOptions = Record<string, unknown>> {
  slot: ShellSurfaceSlot;
  surface: ShellSurfaceDefinition<TOptions>;
  options: TOptions;
  addonContext?: unknown;
}

export interface ShellSurfaceDefinition<TOptions = Record<string, unknown>> {
  id: string;
  slot: ShellSurfaceSlot;
  label: string;
  owner: ShellSurfaceOwner;
  kind: ShellSurfaceKind;
  order: number;
  defaultVisible: boolean;
  render(context: ShellSurfaceRenderContext<TOptions>): ShellSurfaceRenderResult;
  canRender?(context: ShellSurfaceRenderContext<TOptions>): boolean;
  persistVisibility?: boolean;
  persistGeometry?: boolean;
}

export interface ShellSurfacePublicInfo {
  id: string;
  slot: ShellSurfaceSlot;
  label: string;
  owner: ShellSurfaceOwner;
  kind: ShellSurfaceKind;
  order: number;
  visible: boolean;
  configurable: boolean;
}

type ShellSurfaceGeometry = Record<string, unknown>;
type ShellSurfaceChangedListener = () => void;
type ShellSlotRenderInput<TOptions = Record<string, unknown>> = Partial<Omit<ShellSurfaceRenderContext<TOptions>, 'slot' | 'surface'>>;

const SHELL_SURFACE_SLOTS: ShellSurfaceSlot[] = [
  'app.overlay',
  'workspace.sidebar',
  'workspace.toggle',
  'workspace.splitter',
  'editor.region',
  'editor.tabbar',
  'editor.host',
  'editor.preview',
  'editor.splitter',
  'dock.splitter',
  'dock.panel',
  'dock.header',
  'dock.body',
  'timeline.menu',
  'timeline.quick-actions',
  'timeline.header',
  'timeline.above',
  'timeline.core',
  'timeline.below',
  'status.core',
  'status.extension',
  'compose.before',
  'compose.box',
  'compose.after',
  'settings.loader',
  'app.modal',
];

const VALID_SHELL_SURFACE_SLOTS = new Set<string>(SHELL_SURFACE_SLOTS);
const STORAGE_PREFIX = 'piclaw.shell.surface.';
const VISIBLE_SUFFIX = '.visible';
const GEOMETRY_SUFFIX = '.geometry';

const registry = new Map<string, ShellSurfaceDefinition>();
const subscribers = new Set<ShellSurfaceChangedListener>();
const createdStorageKeys = new Set<string>();

function assertValidDefinition(definition: ShellSurfaceDefinition): void {
  if (typeof definition.id !== 'string' || definition.id.trim().length === 0) {
    throw new Error('Shell surface id must be a non-empty string');
  }
  if (!VALID_SHELL_SURFACE_SLOTS.has(definition.slot)) {
    throw new Error(`Invalid shell surface slot: ${String(definition.slot)}`);
  }
}

function sortSurfaces(a: ShellSurfaceDefinition, b: ShellSurfaceDefinition): number {
  const orderDiff = a.order - b.order;
  if (orderDiff !== 0) return orderDiff;
  return a.id.localeCompare(b.id);
}

function toPublicInfo(definition: ShellSurfaceDefinition): ShellSurfacePublicInfo {
  return {
    id: definition.id,
    slot: definition.slot,
    label: definition.label,
    owner: definition.owner,
    kind: definition.kind,
    order: definition.order,
    visible: getShellSurfaceVisible(definition.id, definition.defaultVisible),
    configurable: definition.kind !== 'required',
  };
}

function getStorage(): Storage | null {
  const candidate = globalThis.localStorage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!candidate) return null;
  try {
    const probeKey = `${STORAGE_PREFIX}probe`;
    candidate.getItem(probeKey);
    return candidate;
  } catch {
    return null;
  }
}

function visibilityKey(id: string): string {
  return `${STORAGE_PREFIX}${id}${VISIBLE_SUFFIX}`;
}

function geometryKey(id: string): string {
  return `${STORAGE_PREFIX}${id}${GEOMETRY_SUFFIX}`;
}

function getStorageItem(key: string): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function setStorageItem(key: string, value: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(key, value);
    createdStorageKeys.add(key);
  } catch {
    return;
  }
}

function removeStorageItem(key: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    return;
  }
}

function notifyBrowserEvent(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    const event = typeof CustomEvent === 'function'
      ? new CustomEvent('piclaw:shell-surfaces-changed')
      : new Event('piclaw:shell-surfaces-changed');
    window.dispatchEvent(event);
  } catch (error) {
    console.error('Failed to dispatch shell surfaces changed event', error);
  }
}

function buildRenderContext<TOptions>(
  slot: ShellSurfaceSlot,
  definition: ShellSurfaceDefinition<TOptions>,
  context: ShellSlotRenderInput<TOptions> = {},
): ShellSurfaceRenderContext<TOptions> {
  return {
    ...context,
    slot,
    surface: definition,
    options: (context.options ?? {}) as TOptions,
  };
}

export function registerShellSurface(definition: ShellSurfaceDefinition): () => void {
  assertValidDefinition(definition);
  registry.set(definition.id, definition);
  notifyShellSurfacesChanged();
  return () => unregisterShellSurface(definition.id);
}

export function unregisterShellSurface(id: string): void {
  if (!registry.delete(id)) return;
  notifyShellSurfacesChanged();
}

export function getShellSurface(id: string): (ShellSurfaceDefinition & ShellSurfacePublicInfo) | undefined {
  const definition = registry.get(id);
  if (!definition) return undefined;
  return {
    ...definition,
    visible: getShellSurfaceVisible(definition.id, definition.defaultVisible),
    configurable: definition.kind !== 'required',
  };
}

export function listShellSurfaces(slot?: ShellSurfaceSlot): ShellSurfacePublicInfo[] {
  return Array.from(registry.values())
    .filter((definition) => !slot || definition.slot === slot)
    .sort(sortSurfaces)
    .map(toPublicInfo);
}

export function renderShellSlot<TOptions = Record<string, unknown>>(
  slot: ShellSurfaceSlot,
  context: ShellSlotRenderInput<TOptions> = {},
): ShellSurfaceRenderResult[] {
  return Array.from(registry.values())
    .filter((definition) => definition.slot === slot)
    .sort(sortSurfaces)
    .flatMap((definition) => {
      if (!getShellSurfaceVisible(definition.id, definition.defaultVisible)) return [];
      const renderContext = buildRenderContext(slot, definition as ShellSurfaceDefinition<TOptions>, context);
      try {
        if (definition.canRender && !definition.canRender(renderContext as ShellSurfaceRenderContext)) return [];
      } catch (error) {
        console.error(`Shell surface canRender failed for ${definition.id}`, error);
        return [];
      }
      try {
        return [definition.render(renderContext as ShellSurfaceRenderContext)];
      } catch (error) {
        console.error(`Shell surface render failed for ${definition.id}`, error);
        return [];
      }
    });
}

export function getShellSurfaceVisible(id: string, fallback: boolean): boolean {
  const definition = registry.get(id);
  if (definition?.kind === 'required') return true;
  const raw = getStorageItem(visibilityKey(id));
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

export function setShellSurfaceVisible(id: string, visible: boolean): void {
  const definition = registry.get(id);
  if (definition?.kind === 'required' && !visible) return;
  setStorageItem(visibilityKey(id), String(visible));
  notifyShellSurfacesChanged();
}

export function clearShellSurfaceVisible(id: string): void {
  removeStorageItem(visibilityKey(id));
  createdStorageKeys.delete(visibilityKey(id));
  notifyShellSurfacesChanged();
}

export function getShellSurfaceGeometry(id: string): ShellSurfaceGeometry | null {
  const raw = getStorageItem(geometryKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ShellSurfaceGeometry;
  } catch {
    return null;
  }
}

export function setShellSurfaceGeometry(id: string, geometry: ShellSurfaceGeometry): void {
  setStorageItem(geometryKey(id), JSON.stringify(geometry));
  notifyShellSurfacesChanged();
}

export function clearShellSurfaceGeometry(id: string): void {
  removeStorageItem(geometryKey(id));
  createdStorageKeys.delete(geometryKey(id));
  notifyShellSurfacesChanged();
}

export function subscribeShellSurfacesChanged(listener: ShellSurfaceChangedListener): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function notifyShellSurfacesChanged(): void {
  for (const listener of Array.from(subscribers)) {
    try {
      listener();
    } catch (error) {
      console.error('Shell surface subscriber failed', error);
    }
  }
  notifyBrowserEvent();
}

export function resetShellSurfaceRegistryForTests(): void {
  registry.clear();
  subscribers.clear();
  const storage = getStorage();
  if (storage) {
    for (const key of Array.from(createdStorageKeys)) {
      removeStorageItem(key);
    }
    try {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith(STORAGE_PREFIX) && (key.endsWith(VISIBLE_SUFFIX) || key.endsWith(GEOMETRY_SUFFIX))) {
          storage.removeItem(key);
        }
      }
    } catch (error) {
      console.warn('Failed to clear shell surface test storage keys', error);
    }
  }
  createdStorageKeys.clear();
}
