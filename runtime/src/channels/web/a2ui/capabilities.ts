import { CLASSIC_A2UI_CATALOG } from './surface.js';

const supportedCatalogIds = Object.freeze([CLASSIC_A2UI_CATALOG]);
export const CLASSIC_A2UI_RENDERER_CAPABILITIES = Object.freeze({
  '1.0': Object.freeze({ supportedCatalogIds }),
});
export const CLASSIC_A2UI_AGENT_CAPABILITIES = Object.freeze({
  '1.0': Object.freeze({ supportedCatalogIds, acceptsInlineCatalogs: false }),
});

export type ClassicA2uiRendererCapabilities = typeof CLASSIC_A2UI_RENDERER_CAPABILITIES;

export class InvalidA2uiCapabilitiesError extends Error {
  constructor() { super('Invalid A2UI renderer capabilities.'); }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** A Classic offer is scoped to one accepted input. Never resolve catalogue IDs as URLs. */
export function negotiateClassicA2ui(metadata: unknown): ClassicA2uiRendererCapabilities | undefined {
  if (metadata === undefined) return;
  if (!record(metadata)) throw new InvalidA2uiCapabilitiesError();
  const capabilities = metadata.a2uiRendererCapabilities;
  if (capabilities === undefined) return;
  if (!record(capabilities)) throw new InvalidA2uiCapabilitiesError();
  const offer = capabilities['1.0'];
  if (offer === undefined) return; // Capabilities for another protocol version are not a v1.0 offer.
  if (!record(offer) || !Array.isArray(offer.supportedCatalogIds) || offer.supportedCatalogIds.length > 32
    || offer.supportedCatalogIds.some(id => typeof id !== 'string' || !id || id.length > 512)
    || (offer.inlineCatalogs !== undefined && (!Array.isArray(offer.inlineCatalogs) || offer.inlineCatalogs.length > 0))) {
    throw new InvalidA2uiCapabilitiesError();
  }
  return offer.supportedCatalogIds.includes(CLASSIC_A2UI_CATALOG) ? CLASSIC_A2UI_RENDERER_CAPABILITIES : undefined;
}
