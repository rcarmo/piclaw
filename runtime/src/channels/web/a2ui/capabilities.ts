import { CLASSIC_A2UI_CATALOG } from './surface.js';

const supportedCatalogIds = Object.freeze([CLASSIC_A2UI_CATALOG]);
export const CLASSIC_A2UI_RENDERER_CAPABILITIES = Object.freeze({
  '1.0': Object.freeze({ supportedCatalogIds }),
});
export const CLASSIC_A2UI_AGENT_CAPABILITIES = Object.freeze({
  '1.0': Object.freeze({ supportedCatalogIds, acceptsInlineCatalogs: false }),
});

export type ClassicA2uiRendererCapabilities = { readonly '1.0': { readonly supportedCatalogIds: readonly string[] } };

export class InvalidA2uiCapabilitiesError extends Error {
  constructor() { super('Invalid A2UI renderer capabilities.'); }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Read version-scoped IDs, never interpreting them as URLs or accepting inline catalogue code. */
export function readA2uiCatalogueOffer(metadata: unknown): readonly string[] | undefined {
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
  return offer.supportedCatalogIds;
}

/** Ordinary Classic messages negotiate the Basic Catalogue on this accepted input only. */
export function negotiateClassicA2ui(metadata: unknown): ClassicA2uiRendererCapabilities | undefined {
  return readA2uiCatalogueOffer(metadata)?.includes(CLASSIC_A2UI_CATALOG) ? CLASSIC_A2UI_RENDERER_CAPABILITIES : undefined;
}
