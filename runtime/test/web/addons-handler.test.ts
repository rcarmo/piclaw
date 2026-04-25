import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import '../helpers.js';
import { withTempWorkspaceEnv } from '../helpers.js';
import {
  getInstalledAddonWebEntries,
  handleAddonAssetRequest,
  handleGetAddons,
  handleRestartAddonRuntime,
  mergeCatalogs,
  parseCatalogUrlList,
  resolveAddonInstallSpec,
  resolveRequestedCatalogUrls,
  WEB_RESTART_DELAY_MS,
} from '../../src/channels/web/handlers/addons.js';

test('parseCatalogUrlList normalizes newline and comma separated URLs', () => {
  expect(parseCatalogUrlList([
    ' https://example.com/a.json\nhttps://example.com/b.json ',
    'https://example.com/b.json, https://example.com/c.json',
    '',
  ])).toEqual([
    'https://example.com/a.json',
    'https://example.com/b.json',
    'https://example.com/c.json',
  ]);
});

test('resolveRequestedCatalogUrls falls back to the default catalog and preserves repeated params', () => {
  expect(resolveRequestedCatalogUrls(new URL('https://example.test/agent/addons'))).toEqual([
    'https://raw.githubusercontent.com/rcarmo/piclaw-addons/main/catalog.json',
  ]);
  expect(resolveRequestedCatalogUrls(new URL('https://example.test/agent/addons?catalog_url=https://example.com/a.json&catalog_url=https://example.com/b.json'))).toEqual([
    'https://example.com/a.json',
    'https://example.com/b.json',
  ]);
});

test('mergeCatalogs combines multiple catalogs and dedupes overlapping addons by slug/name', () => {
  expect(mergeCatalogs([
    {
      source: 'primary',
      addons: [
        { slug: 'drawio', name: 'piclaw-addon-drawio-editor', version: '1.0.0', description: 'primary drawio' },
      ],
    },
    {
      source: 'secondary',
      addons: [
        { slug: 'drawio', name: 'piclaw-addon-drawio-editor', version: '2.0.0', description: 'secondary drawio' },
        { slug: 'eml', name: 'piclaw-addon-eml-viewer', version: '1.0.0', description: 'eml' },
      ],
    },
  ])).toEqual({
    version: undefined,
    source: 'primary, secondary',
    addons: [
      { slug: 'drawio', name: 'piclaw-addon-drawio-editor', version: '1.0.0', description: 'primary drawio' },
      { slug: 'eml', name: 'piclaw-addon-eml-viewer', version: '1.0.0', description: 'eml' },
    ],
  });
});

test('resolveAddonInstallSpec prefers explicit catalog install spec', () => {
  expect(resolveAddonInstallSpec({
    name: 'piclaw-addon-code-validator',
    version: '0.1.0',
    install: {
      kind: 'npm',
      spec: 'piclaw-addon-code-validator@0.1.0',
      piSource: 'npm:piclaw-addon-code-validator@0.1.0',
    },
  })).toEqual({
    kind: 'npm',
    spec: 'piclaw-addon-code-validator@0.1.0',
    piSource: 'npm:piclaw-addon-code-validator@0.1.0',
  });
});

test('resolveAddonInstallSpec falls back to npm package@version', () => {
  expect(resolveAddonInstallSpec({
    name: 'piclaw-addon-eml-viewer',
    version: '1.2.3',
  })).toEqual({
    kind: 'npm',
    spec: 'piclaw-addon-eml-viewer@1.2.3',
    piSource: 'npm:piclaw-addon-eml-viewer@1.2.3',
  });
});

test('resolveAddonInstallSpec falls back to bare npm package name when version is missing', () => {
  expect(resolveAddonInstallSpec({
    name: 'piclaw-addon-dev-tools',
  })).toEqual({
    kind: 'npm',
    spec: 'piclaw-addon-dev-tools',
    piSource: 'npm:piclaw-addon-dev-tools',
  });
});

test('handleGetAddons merges add-ons from multiple catalog URLs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.includes('catalog-a.json')) {
      return new Response(JSON.stringify({
        source: 'catalog-a',
        addons: [
          { slug: 'drawio', name: 'piclaw-addon-drawio-editor', version: '1.0.0', description: 'drawio' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (href.includes('catalog-b.json')) {
      return new Response(JSON.stringify({
        source: 'catalog-b',
        addons: [
          { slug: 'eml', name: 'piclaw-addon-eml-viewer', version: '1.0.0', description: 'eml' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const response = await handleGetAddons(
      (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
      new URL('https://example.test/agent/addons?catalog_url=https://example.com/catalog-a.json&catalog_url=https://example.com/catalog-b.json'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      source: 'catalog-a, catalog-b',
      sources: ['https://example.com/catalog-a.json', 'https://example.com/catalog-b.json'],
      failed_sources: [],
      addons: [
        expect.objectContaining({ slug: 'drawio' }),
        expect.objectContaining({ slug: 'eml' }),
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getInstalledAddonWebEntries discovers addon browser entrypoints', async () => {
  await withTempWorkspaceEnv('piclaw-addon-web-entries-', {}, async (workspace) => {
    const addonDir = join(workspace.workspace, '.pi', 'extensions', 'node_modules', 'piclaw-addon-example');
    mkdirSync(join(addonDir, 'web'), { recursive: true });
    writeFileSync(join(addonDir, 'package.json'), JSON.stringify({
      name: 'piclaw-addon-example',
      version: '0.1.0',
      type: 'module',
      pi: {
        extensions: ['index.ts'],
        web: { entries: ['web/index.ts'] },
      },
    }, null, 2));
    writeFileSync(join(addonDir, 'index.ts'), 'export default function noop() {}\n');
    writeFileSync(join(addonDir, 'web', 'index.ts'), 'globalThis.__exampleAddonLoaded = true;\n');

    expect(getInstalledAddonWebEntries(workspace.workspace)).toEqual([
      {
        packageName: 'piclaw-addon-example',
        entry: 'web/index.ts',
        url: '/agent/addons/assets/piclaw-addon-example/web/index.ts',
      },
    ]);
  });
});

test('handleAddonAssetRequest serves transpiled addon browser modules', async () => {
  await withTempWorkspaceEnv('piclaw-addon-web-asset-', {}, async (workspace) => {
    const addonDir = join(workspace.workspace, '.pi', 'extensions', 'node_modules', 'piclaw-addon-example');
    mkdirSync(join(addonDir, 'web'), { recursive: true });
    writeFileSync(join(addonDir, 'package.json'), JSON.stringify({
      name: 'piclaw-addon-example',
      version: '0.1.0',
      type: 'module',
      pi: {
        extensions: ['index.ts'],
        web: { entries: ['web/index.ts'] },
      },
    }, null, 2));
    writeFileSync(join(addonDir, 'web', 'index.ts'), 'const answer: number = 42;\nexport default answer;\n');

    const response = await handleAddonAssetRequest(
      new Request('http://localhost/agent/addons/assets/piclaw-addon-example/web/index.ts', { method: 'GET' }),
      '/agent/addons/assets/piclaw-addon-example/web/index.ts',
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get('Content-Type')).toContain('text/javascript');
    expect(await response?.text()).toContain('const answer = 42');
  });
});

test('handleRestartAddonRuntime returns success and schedules graceful restart', async () => {
  let scheduled = 0;
  (globalThis as any).__PICLAW_EXIT_SCHEDULER__ = () => {
    scheduled += 1;
  };

  try {
    const res = handleRestartAddonRuntime((body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      message: 'Restarting piclaw… The UI should reconnect automatically.',
    });

    await new Promise((resolve) => setTimeout(resolve, WEB_RESTART_DELAY_MS + 30));
    expect(scheduled).toBe(1);
  } finally {
    delete (globalThis as any).__PICLAW_EXIT_SCHEDULER__;
  }
});
