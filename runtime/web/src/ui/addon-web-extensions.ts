import { paneRegistry } from '../panes/index.js';
import { registerSettingsPane, unregisterSettingsPane, notifySettingsPanesChanged } from '../components/settings/pane-registry.js';
import {
  registerShellSurface,
  unregisterShellSurface,
  type ShellSurfaceDefinition,
  type ShellSurfaceSlot,
} from './shell-surface-registry.js';

export interface AddonStandaloneTabUrlContext {
  hasPopOutTab?: boolean;
}

export interface AddonAttachmentPreviewDefinition {
  id: string;
  label: string;
  match: (contentType: unknown, filename?: unknown) => boolean;
  buildFrameUrl: (mediaId: number | string, filename?: string) => string | null;
  note?: string | null;
}

export type AddonShellSurfaceDefinition = Partial<Omit<ShellSurfaceDefinition, 'owner' | 'kind' | 'order' | 'defaultVisible'>> & {
  id?: string;
  slot?: ShellSurfaceSlot;
  order?: number;
  defaultVisible?: boolean;
  owner?: unknown;
  kind?: unknown;
};

export interface AddonWebApiSurface {
  registerPane: (extension: any) => boolean;
  registerWorkspacePane: (extension: any) => boolean;
  registerSettingsPane: (definition: any) => () => void;
  registerStandaloneTabUrlResolver: (resolver: (path: string, context?: AddonStandaloneTabUrlContext) => string | null | undefined) => () => void;
  registerAttachmentPreview: (definition: AddonAttachmentPreviewDefinition) => () => void;
  registerShellSurface: (definition: AddonShellSurfaceDefinition) => () => void;
  getCurrentChatJid: () => string;
}

const ADDON_SHELL_SURFACE_SLOTS = new Set<ShellSurfaceSlot>([
  'timeline.above',
  'timeline.below',
  'compose.before',
  'compose.after',
  'app.overlay',
  'status.extension',
  'timeline.quick-actions',
]);

const addonPaneIds = new Set<string>();
const addonSettingsPaneIds = new Set<string>();
const addonShellSurfaceIds = new Set<string>();
const standaloneTabUrlResolvers = new Set<(path: string, context?: AddonStandaloneTabUrlContext) => string | null | undefined>();
const attachmentPreviewDefinitions = new Map<string, AddonAttachmentPreviewDefinition>();
let addonWebApiInstalled = false;
let addonWebEntryLoadPromise: Promise<void> | null = null;

function resolveCurrentChatJid(runtimeWindow: (Window & typeof globalThis) | null = typeof window !== 'undefined' ? window : null): string {
  const globalValue = typeof (runtimeWindow as any)?.__piclawCurrentChatJid === 'string'
    ? (runtimeWindow as any).__piclawCurrentChatJid.trim()
    : '';
  if (globalValue) return globalValue;
  try {
    const href = runtimeWindow?.location?.href || 'http://localhost/';
    const fromUrl = new URL(href).searchParams.get('chat_jid')?.trim() || '';
    if (fromUrl) return fromUrl;
  } catch (e) {
    // ignore and fall back
    void e;
  }
  return 'web:default';
}

function normalizeUrl(value: unknown, base: string): string | null {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) return null;
  try {
    return new URL(input, base).href;
  } catch {
    return null;
  }
}

export function registerAddonWorkspacePane(extension: any): boolean {
  if (!extension || typeof extension.id !== 'string' || !extension.id.trim()) return false;
  paneRegistry.register(extension);
  addonPaneIds.add(extension.id);
  return true;
}

export function registerAddonPane(extension: any): boolean {
  return registerAddonWorkspacePane(extension);
}

export function registerAddonSettingsPane(definition: any): () => void {
  if (!definition || typeof definition.id !== 'string' || !definition.id.trim()) {
    return () => {};
  }
  registerSettingsPane(definition);
  addonSettingsPaneIds.add(definition.id);
  notifySettingsPanesChanged();
  return () => {
    unregisterSettingsPane(definition.id);
    addonSettingsPaneIds.delete(definition.id);
    notifySettingsPanesChanged();
  };
}

export function registerAddonStandaloneTabUrlResolver(
  resolver: (path: string, context?: AddonStandaloneTabUrlContext) => string | null | undefined,
): () => void {
  if (typeof resolver !== 'function') return () => {};
  standaloneTabUrlResolvers.add(resolver);
  return () => {
    standaloneTabUrlResolvers.delete(resolver);
  };
}

export function resolveAddonStandaloneTabUrl(path: string, context: AddonStandaloneTabUrlContext = {}): string | null {
  const normalizedPath = typeof path === 'string' ? path.trim() : '';
  if (!normalizedPath) return null;
  for (const resolver of [...standaloneTabUrlResolvers].reverse()) {
    try {
      const resolved = resolver(normalizedPath, context);
      if (typeof resolved === 'string' && resolved.trim()) return resolved.trim();
    } catch (error) {
      console.warn('[addon-web] standalone tab URL resolver failed:', error);
    }
  }
  return null;
}

export function registerAddonAttachmentPreview(definition: AddonAttachmentPreviewDefinition): () => void {
  if (!definition || typeof definition.id !== 'string' || !definition.id.trim() || typeof definition.match !== 'function' || typeof definition.buildFrameUrl !== 'function') {
    return () => {};
  }
  attachmentPreviewDefinitions.set(definition.id, definition);
  return () => {
    if (attachmentPreviewDefinitions.get(definition.id) === definition) {
      attachmentPreviewDefinitions.delete(definition.id);
    }
  };
}

function assertAddonShellSurfaceDefinition(definition: AddonShellSurfaceDefinition): asserts definition is AddonShellSurfaceDefinition & { id: string; slot: ShellSurfaceSlot; render: ShellSurfaceDefinition['render'] } {
  if (!definition || typeof definition.id !== 'string' || !definition.id.trim()) {
    throw new Error('Add-on shell surface id must be a non-empty string');
  }
  if (definition.id.trim().toLowerCase().startsWith('piclaw')) {
    throw new Error('Add-on shell surface ids must not start with piclaw');
  }
  if (!ADDON_SHELL_SURFACE_SLOTS.has(definition.slot as ShellSurfaceSlot)) {
    throw new Error(`Add-on shell surface slot is not allowed: ${String(definition.slot)}`);
  }
  if (definition.owner === 'core') {
    throw new Error('Add-on shell surfaces cannot use owner core');
  }
  if (definition.kind === 'required' || definition.kind === 'configurable') {
    throw new Error('Add-on shell surfaces must be additive');
  }
  if (typeof definition.render !== 'function') {
    throw new Error('Add-on shell surface render must be a function');
  }
}

export function registerAddonShellSurface(definition: AddonShellSurfaceDefinition): () => void {
  assertAddonShellSurfaceDefinition(definition);
  const id = definition.id.trim();
  const shellSurfaceDefinition: ShellSurfaceDefinition = {
    ...definition,
    id,
    slot: definition.slot,
    label: typeof definition.label === 'string' && definition.label.trim() ? definition.label : id,
    owner: 'addon',
    kind: 'additive',
    order: typeof definition.order === 'number' && Number.isFinite(definition.order) ? definition.order : 300,
    defaultVisible: definition.defaultVisible === false ? false : true,
    render: definition.render,
  };
  const unregister = registerShellSurface(shellSurfaceDefinition);
  addonShellSurfaceIds.add(id);
  return () => {
    unregister();
    addonShellSurfaceIds.delete(id);
  };
}

export function resolveAddonAttachmentPreview(contentType: unknown, filename?: unknown): AddonAttachmentPreviewDefinition | null {
  for (const definition of Array.from(attachmentPreviewDefinitions.values()).reverse()) {
    try {
      if (definition.match(contentType, filename)) return definition;
    } catch (error) {
      console.warn('[addon-web] attachment preview matcher failed:', error);
    }
  }
  return null;
}

export function getAddonAttachmentPreviewLabel(kind: string | null | undefined): string | null {
  const normalizedKind = typeof kind === 'string' ? kind.trim() : '';
  if (!normalizedKind) return null;
  return attachmentPreviewDefinitions.get(normalizedKind)?.label || null;
}

export function getAddonAttachmentPreviewNote(kind: string | null | undefined): string | null {
  const normalizedKind = typeof kind === 'string' ? kind.trim() : '';
  if (!normalizedKind) return null;
  return attachmentPreviewDefinitions.get(normalizedKind)?.note || null;
}

export function buildAddonAttachmentPreviewFrameUrl(kind: string | null | undefined, mediaId: number | string, filename?: string): string | null {
  const normalizedKind = typeof kind === 'string' ? kind.trim() : '';
  if (!normalizedKind) return null;
  const definition = attachmentPreviewDefinitions.get(normalizedKind);
  if (!definition) return null;
  try {
    return definition.buildFrameUrl(mediaId, filename) || null;
  } catch (error) {
    console.warn('[addon-web] attachment preview URL builder failed:', error);
    return null;
  }
}

export function createAddonWebApi(runtimeWindow: (Window & typeof globalThis) | null = typeof window !== 'undefined' ? window : null): AddonWebApiSurface {
  return {
    registerPane: registerAddonPane,
    registerWorkspacePane: registerAddonWorkspacePane,
    registerSettingsPane: registerAddonSettingsPane,
    registerStandaloneTabUrlResolver: registerAddonStandaloneTabUrlResolver,
    registerAttachmentPreview: registerAddonAttachmentPreview,
    registerShellSurface: registerAddonShellSurface,
    getCurrentChatJid: () => resolveCurrentChatJid(runtimeWindow),
  };
}

export function installAddonWebApi(runtimeWindow: (Window & typeof globalThis) | null = typeof window !== 'undefined' ? window : null): AddonWebApiSurface {
  const api = createAddonWebApi(runtimeWindow);
  if (!runtimeWindow || addonWebApiInstalled) return api;
  (runtimeWindow as any).__piclaw_web = api;
  (runtimeWindow as any).__piclaw_registerPane = api.registerPane;
  (runtimeWindow as any).__piclaw_registerWorkspacePane = api.registerWorkspacePane;
  (runtimeWindow as any).__piclaw_registerSettingsPane = api.registerSettingsPane;
  (runtimeWindow as any).__piclaw_registerStandaloneTabUrlResolver = api.registerStandaloneTabUrlResolver;
  (runtimeWindow as any).__piclaw_registerAttachmentPreview = api.registerAttachmentPreview;
  (runtimeWindow as any).__piclaw_registerShellSurface = api.registerShellSurface;
  // Aliases used by addons (observability, cheapskate, sample-addon)
  (runtimeWindow as any).__piclawSettingsPaneRegistry = {
    registerSettingsPane: api.registerSettingsPane,
    notifySettingsPanesChanged: () => runtimeWindow?.dispatchEvent?.(new CustomEvent('piclaw:settings-panes-changed')),
  };
  addonWebApiInstalled = true;
  return api;
}

export async function loadInstalledAddonWebEntries(runtimeWindow: (Window & typeof globalThis) | null = typeof window !== 'undefined' ? window : null): Promise<void> {
  if (!runtimeWindow) return;
  if (addonWebEntryLoadPromise) return addonWebEntryLoadPromise;

  addonWebEntryLoadPromise = (async () => {
    installAddonWebApi(runtimeWindow);
    try {
      const response = await fetch('/agent/addons/web-entries', { credentials: 'same-origin' });
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      const origin = runtimeWindow.location?.origin || 'http://localhost';
      for (const entry of entries) {
        const href = normalizeUrl(entry?.url, origin);
        if (!href) continue;
        try {
          await import(/* @vite-ignore */ href);
        } catch (error) {
          console.warn('[addon-web] Failed to load installed addon web entry:', href, error);
        }
      }
    } catch (error) {
      console.warn('[addon-web] Failed to fetch installed addon web entries:', error);
    }
  })();

  return addonWebEntryLoadPromise;
}

export function resetAddonWebRegistriesForTests(): void {
  for (const paneId of addonPaneIds) {
    paneRegistry.unregister(paneId);
  }
  for (const paneId of addonSettingsPaneIds) {
    unregisterSettingsPane(paneId);
  }
  for (const surfaceId of addonShellSurfaceIds) {
    unregisterShellSurface(surfaceId);
  }
  addonPaneIds.clear();
  addonSettingsPaneIds.clear();
  addonShellSurfaceIds.clear();
  notifySettingsPanesChanged();
  standaloneTabUrlResolvers.clear();
  attachmentPreviewDefinitions.clear();
  addonWebEntryLoadPromise = null;
  addonWebApiInstalled = false;
}
