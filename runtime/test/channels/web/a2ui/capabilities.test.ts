import { expect, test } from 'bun:test';
import { CLASSIC_A2UI_RENDERER_CAPABILITIES, negotiateClassicA2ui } from '../../../../src/channels/web/a2ui/capabilities.js';
import { CLASSIC_A2UI_CATALOG } from '../../../../src/channels/web/a2ui/surface.js';

const offer = (catalogues: unknown) => ({ a2uiRendererCapabilities: { '1.0': { supportedCatalogIds: catalogues } } });

test('a turn gets only the overlap with registered v1.0 catalogues', () => {
  expect(negotiateClassicA2ui(undefined)).toBeUndefined();
  expect(negotiateClassicA2ui({a2uiRendererCapabilities:{'0.9':{supportedCatalogIds:[CLASSIC_A2UI_CATALOG]}}})).toBeUndefined();
  expect(negotiateClassicA2ui(offer(['https://example.test/custom']))).toBeUndefined();
  expect(negotiateClassicA2ui(offer(['https://example.test/custom', CLASSIC_A2UI_CATALOG]))).toEqual(CLASSIC_A2UI_RENDERER_CAPABILITIES);
});

test('malformed offers and unsolicited inline catalogues cannot grant capability', () => {
  for (const malformed of [null, [], { a2uiRendererCapabilities: true }, offer(CLASSIC_A2UI_CATALOG), offer([true]),
    {a2uiRendererCapabilities:{'1.0':{supportedCatalogIds:[CLASSIC_A2UI_CATALOG],inlineCatalogs:[{}]}}}]) {
    expect(() => negotiateClassicA2ui(malformed)).toThrow('Invalid A2UI renderer capabilities.');
  }
});
