import { paneRegistry } from '../panes/index.js';

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

export interface AddonWebApiSurface {
  registerPane: (extension: any) => boolean;
  registerStandaloneTabUrlResolver: (resolver: (path: string, context?: AddonStandaloneTabUrlContext) => string | null | undefined) => () => void;
  registerAttachmentPreview: (definition: AddonAttachmentPreviewDefinition) => () => void;
}

const addonPaneIds = new Set<string>();
const standaloneTabUrlResolvers = new Set<(path: string, context?: AddonStandaloneTabUrlContext) => string | null | undefined>();
const attachmentPreviewDefinitions = new Map<string, AddonAttachmentPreviewDefinition>();
let addonWebApiInstalled = false;
let addonWebEntryLoadPromise: Promise<void> | null = null;

function normalizeUrl(value: unknown, base: string): string | null {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) return null;
  try {
    return new URL(input, base).href;
  } catch {
    return null;
  }
}

export function registerAddonPane(extension: any): boolean {
  if (!extension || typeof extension.id !== 'string' || !extension.id.trim()) return false;
  paneRegistry.register(extension);
  addonPaneIds.add(extension.id);
  return true;
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

export function createAddonWebApi(): AddonWebApiSurface {
  return {
    registerPane: registerAddonPane,
    registerStandaloneTabUrlResolver: registerAddonStandaloneTabUrlResolver,
    registerAttachmentPreview: registerAddonAttachmentPreview,
  };
}

export function installAddonWebApi(runtimeWindow: (Window & typeof globalThis) | null = typeof window !== 'undefined' ? window : null): AddonWebApiSurface {
  const api = createAddonWebApi();
  if (!runtimeWindow || addonWebApiInstalled) return api;
  (runtimeWindow as any).__piclaw_web = api;
  (runtimeWindow as any).__piclaw_registerPane = api.registerPane;
  (runtimeWindow as any).__piclaw_registerStandaloneTabUrlResolver = api.registerStandaloneTabUrlResolver;
  (runtimeWindow as any).__piclaw_registerAttachmentPreview = api.registerAttachmentPreview;
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
  addonPaneIds.clear();
  standaloneTabUrlResolvers.clear();
  attachmentPreviewDefinitions.clear();
  addonWebEntryLoadPromise = null;
  addonWebApiInstalled = false;
}
