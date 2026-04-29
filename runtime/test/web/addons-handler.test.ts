import { afterEach, expect, test } from 'bun:test';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import '../helpers.js';
import { withTempWorkspaceEnv } from '../helpers.js';
import {
  getInstalledAddonWebEntries,
  handleAddonAssetRequest,
  handleAddonConfigApiRequest,
  handleGetAddons,
  handleInstallAddon,
  handleRestartAddonRuntime,
  isAddonFsLockError,
  mergeCatalogs,
  parseCatalogUrlList,
  removeAddonDirRobustly,
  resolveAddonInstallSpec,
  resolveRequestedCatalogUrls,
  setAddonInstallTestHooksForTests,
  WEB_RESTART_DELAY_MS,
} from '../../src/channels/web/handlers/addons.js';
import {
  registerAddonConfigApi,
  resetAddonConfigApiRegistryForTests,
} from '../../src/channels/web/handlers/addon-config-api.js';

afterEach(() => {
  resetAddonConfigApiRegistryForTests();
});

function createAddonTarball(baseDir: string, fileName: string, files: Record<string, string>): string {
  const sourceDir = join(baseDir, `${fileName}-src`);
  const tarballPath = join(baseDir, fileName);
  mkdirSync(sourceDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(sourceDir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
  const packed = Bun.spawnSync(['tar', 'czf', tarballPath, '-C', sourceDir, '.'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(packed.exitCode).toBe(0);
  return tarballPath;
}

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
    'https://raw.githubusercontent.com/rcarmo/piclaw-addons/main/catalog.json',
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

test('resolveAddonInstallSpec prefers explicit public tarball install spec', () => {
  expect(resolveAddonInstallSpec({
    name: '@rcarmo/piclaw-addon-code-validator',
    version: '0.1.0',
    install: {
      kind: 'tarball',
      spec: 'https://rcarmo.github.io/piclaw-addons/packages/piclaw-addon-code-validator-0.1.0.tgz',
    },
  })).toEqual({
    kind: 'tarball',
    spec: 'https://rcarmo.github.io/piclaw-addons/packages/piclaw-addon-code-validator-0.1.0.tgz',
  });
});

test('resolveAddonInstallSpec falls back to package spec when catalog install metadata is missing', () => {
  expect(resolveAddonInstallSpec({
    name: '@rcarmo/piclaw-addon-eml-viewer',
    version: '1.2.3',
  })).toEqual({
    kind: 'package',
    spec: '@rcarmo/piclaw-addon-eml-viewer',
  });
});

test('handleGetAddons merges add-ons from multiple catalog URLs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.includes('rcarmo/piclaw-addons/main/catalog.json')) {
      return new Response(JSON.stringify({
        source: 'default',
        addons: [
          { slug: 'proxmox', name: 'piclaw-addon-proxmox', version: '0.1.3', description: 'proxmox' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
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
    const data = await response.json();
    // Default catalog is always included + custom ones merged
    expect(data.sources).toEqual([
      'https://raw.githubusercontent.com/rcarmo/piclaw-addons/main/catalog.json',
      'https://example.com/catalog-a.json',
      'https://example.com/catalog-b.json',
    ]);
    expect(data.failed_sources).toEqual([]);
    // Addons from all three catalogs are merged
    const slugs = data.addons.map((a: any) => a.slug).sort();
    expect(slugs).toEqual(['drawio', 'eml', 'proxmox']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handleInstallAddon installs public tarball addons without repo-tree fallback', async () => {
  await withTempWorkspaceEnv('piclaw-addon-install-tarball-', {}, async (workspace) => {
    const originalFetch = globalThis.fetch;
    const bunCalls: Array<{ args: string[]; cwd: string }> = [];
    const tarballPath = createAddonTarball(workspace.workspace, 'piclaw-addon-observability-0.1.2.tgz', {
      'package.json': JSON.stringify({
        name: '@rcarmo/piclaw-addon-observability',
        version: '0.1.2',
        dependencies: { zod: '^3.25.0' },
        pi: { extensions: ['index.ts'] },
      }, null, 2),
      'index.ts': 'export default function observability() {}\n',
    });

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes('catalog-observability.json')) {
        return new Response(JSON.stringify({
          source: 'catalog-observability',
          addons: [{
            slug: 'observability',
            name: '@rcarmo/piclaw-addon-observability',
            version: '0.1.2',
            description: 'obs',
            install: {
              kind: 'tarball',
              spec: 'https://rcarmo.github.io/piclaw-addons/packages/piclaw-addon-observability-0.1.2.tgz',
            },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (href.includes('rcarmo/piclaw-addons/main/catalog.json')) {
        return new Response(JSON.stringify({ source: 'default', addons: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    setAddonInstallTestHooksForTests({
      async runBunCommand(args, cwd) {
        bunCalls.push({ args, cwd });
        return args.join(' ') === 'bun install --force'
          ? { ok: true, exitCode: 0, stdout: 'installed', stderr: '' }
          : { ok: false, exitCode: 1, stdout: '', stderr: 'unexpected bun command' };
      },
      async downloadUrlToFile(_url, destPath) {
        writeFileSync(destPath, readFileSync(tarballPath));
      },
    });

    try {
      const res = await handleInstallAddon(
        new Request('https://example.test/agent/addons/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: 'observability' }),
        }),
        (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
        new URL('https://example.test/agent/addons/install?catalog_url=https://example.com/catalog-observability.json'),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(expect.objectContaining({
        ok: true,
        slug: 'observability',
        installedVersion: '0.1.2',
        installKind: 'tarball',
      }));
      expect(bunCalls).toHaveLength(1);
      expect(bunCalls[0]?.args).toEqual(['bun', 'install', '--force']);
      expect(bunCalls[0]?.cwd).toContain(join('.pi', 'extensions', '.staging'));
      expect(JSON.parse(readFileSync(join(workspace.workspace, '.pi', 'extensions', 'package.json'), 'utf8')).dependencies).toEqual({
        '@rcarmo/piclaw-addon-observability': 'https://rcarmo.github.io/piclaw-addons/packages/piclaw-addon-observability-0.1.2.tgz',
      });
    } finally {
      setAddonInstallTestHooksForTests(null);
      globalThis.fetch = originalFetch;
    }
  });
});


test('handleInstallAddon installs peer-only tarball addons without bun install', async () => {
  await withTempWorkspaceEnv('piclaw-addon-install-peer-tarball-', {}, async (workspace) => {
    const originalFetch = globalThis.fetch;
    const bunCalls: Array<{ args: string[]; cwd: string }> = [];
    const packageJson = {
      name: '@rcarmo/piclaw-addon-peerless',
      version: '0.2.0',
      peerDependencies: { '@mariozechner/pi-coding-agent': '*' },
      pi: { extensions: ['index.ts'] },
    };
    const tarballPath = createAddonTarball(workspace.workspace, 'piclaw-addon-peerless-0.2.0.tgz', {
      'package.json': JSON.stringify(packageJson, null, 2),
      'index.ts': 'export const peerless = true;\n',
    });

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes('catalog-peerless.json')) {
        return new Response(JSON.stringify({
          source: 'catalog-peerless',
          addons: [{
            slug: 'peerless',
            name: '@rcarmo/piclaw-addon-peerless',
            version: '0.2.0',
            description: 'peer only',
            install: {
              kind: 'tarball',
              spec: 'https://rcarmo.github.io/piclaw-addons/packages/piclaw-addon-peerless-0.2.0.tgz',
            },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (href.includes('rcarmo/piclaw-addons/main/catalog.json')) {
        return new Response(JSON.stringify({ source: 'default', addons: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    setAddonInstallTestHooksForTests({
      async runBunCommand(args, cwd) {
        bunCalls.push({ args, cwd });
        return { ok: false, exitCode: 1, stdout: '', stderr: 'bun install should be skipped for peer-only addons' };
      },
      async downloadUrlToFile(_url, destPath) {
        writeFileSync(destPath, readFileSync(tarballPath));
      },
    });

    try {
      const res = await handleInstallAddon(
        new Request('https://example.test/agent/addons/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: 'peerless' }),
        }),
        (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
        new URL('https://example.test/agent/addons/install?catalog_url=https://example.com/catalog-peerless.json'),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(expect.objectContaining({
        ok: true,
        slug: 'peerless',
        installedVersion: '0.2.0',
        installKind: 'tarball',
      }));
      expect(bunCalls).toHaveLength(0);
      expect(lstatSync(join(workspace.workspace, '.pi', 'extensions', 'node_modules', '@rcarmo', 'piclaw-addon-peerless', 'node_modules')).isSymbolicLink()).toBe(true);
      expect(JSON.parse(readFileSync(join(workspace.workspace, '.pi', 'extensions', 'package.json'), 'utf8')).dependencies).toEqual({
        '@rcarmo/piclaw-addon-peerless': 'https://rcarmo.github.io/piclaw-addons/packages/piclaw-addon-peerless-0.2.0.tgz',
      });
    } finally {
      setAddonInstallTestHooksForTests(null);
      globalThis.fetch = originalFetch;
    }
  });
});


test('handleInstallAddon rejects legacy direct-download specs', async () => {
  await withTempWorkspaceEnv('piclaw-addon-install-direct-download-', {}, async () => {
    const originalFetch = globalThis.fetch;
    const bunCalls: Array<{ args: string[]; cwd: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes('catalog-direct-download.json')) {
        return new Response(JSON.stringify({
          source: 'catalog-direct-download',
          addons: [{
            slug: 'legacy-direct',
            name: '@rcarmo/piclaw-addon-legacy-direct',
            version: '0.4.0',
            description: 'legacy direct download',
            install: {
              kind: 'direct-download',
              spec: '@rcarmo/piclaw-addon-legacy-direct',
            },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (href.includes('rcarmo/piclaw-addons/main/catalog.json')) {
        return new Response(JSON.stringify({ source: 'default', addons: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    setAddonInstallTestHooksForTests({
      async runBunCommand(args, cwd) {
        bunCalls.push({ args, cwd });
        return { ok: false, exitCode: 1, stdout: '', stderr: 'bun add should not run for rejected direct-download specs' };
      },
    });

    try {
      const res = await handleInstallAddon(
        new Request('https://example.test/agent/addons/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: 'legacy-direct' }),
        }),
        (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
        new URL('https://example.test/agent/addons/install?catalog_url=https://example.com/catalog-direct-download.json'),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Catalog add-on installs must provide a tarball URL or package spec. Direct repo downloads are no longer supported.',
      });
      expect(bunCalls).toHaveLength(0);
    } finally {
      setAddonInstallTestHooksForTests(null);
      globalThis.fetch = originalFetch;
    }
  });
});

test('handleInstallAddon falls back to bun add when catalog install metadata is missing', async () => {
  await withTempWorkspaceEnv('piclaw-addon-install-package-', {}, async (workspace) => {
    const originalFetch = globalThis.fetch;
    const bunCalls: Array<{ args: string[]; cwd: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes('catalog-package.json')) {
        return new Response(JSON.stringify({
          source: 'catalog-package',
          addons: [{
            slug: 'direct-peerless',
            name: '@rcarmo/piclaw-addon-direct-peerless',
            version: '0.3.0',
            description: 'package fallback',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (href.includes('rcarmo/piclaw-addons/main/catalog.json')) {
        return new Response(JSON.stringify({ source: 'default', addons: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    setAddonInstallTestHooksForTests({
      async runBunCommand(args, cwd) {
        bunCalls.push({ args, cwd });
        if (args.join(' ') === 'bun add --force @rcarmo/piclaw-addon-direct-peerless') {
          const addonDir = join(cwd, 'node_modules', '@rcarmo', 'piclaw-addon-direct-peerless');
          mkdirSync(addonDir, { recursive: true });
          writeFileSync(join(addonDir, 'package.json'), JSON.stringify({
            name: '@rcarmo/piclaw-addon-direct-peerless',
            version: '0.3.0',
          }, null, 2));
          return { ok: true, exitCode: 0, stdout: 'installed', stderr: '' };
        }
        return { ok: false, exitCode: 1, stdout: '', stderr: 'unexpected bun command' };
      },
    });

    try {
      const res = await handleInstallAddon(
        new Request('https://example.test/agent/addons/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: 'direct-peerless' }),
        }),
        (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
        new URL('https://example.test/agent/addons/install?catalog_url=https://example.com/catalog-package.json'),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(expect.objectContaining({
        ok: true,
        slug: 'direct-peerless',
        installedVersion: '0.3.0',
        installKind: 'package',
      }));
      expect(bunCalls).toHaveLength(1);
      expect(bunCalls[0]).toEqual({
        args: ['bun', 'add', '--force', '@rcarmo/piclaw-addon-direct-peerless'],
        cwd: join(workspace.workspace, '.pi', 'extensions'),
      });
    } finally {
      setAddonInstallTestHooksForTests(null);
      globalThis.fetch = originalFetch;
    }
  });
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

test('handleAddonAssetRequest accepts Windows-style resolved paths inside the addon root', async () => {
  const originalResolve = require('node:path').resolve;
  const pathModule = require('node:path');
  pathModule.resolve = ((...parts: string[]) => {
    const joined = parts.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
    if (joined.endsWith('/web/index.ts')) return 'C:\\workspace\\.pi\\extensions\\node_modules\\piclaw-addon-example\\web\\index.ts';
    if (joined.endsWith('/piclaw-addon-example')) return 'C:\\workspace\\.pi\\extensions\\node_modules\\piclaw-addon-example';
    return originalResolve(...parts);
  }) as typeof originalResolve;

  try {
    await withTempWorkspaceEnv('piclaw-addon-web-asset-win-', {}, async (workspace) => {
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
      writeFileSync(join(addonDir, 'web', 'index.ts'), 'export const windowsOk: boolean = true;\n');

      const response = await handleAddonAssetRequest(
        new Request('http://localhost/agent/addons/assets/piclaw-addon-example/web/index.ts', { method: 'GET' }),
        '/agent/addons/assets/piclaw-addon-example/web/index.ts',
      );

      expect(response?.status).toBe(200);
      expect(await response?.text()).toContain('const windowsOk = true');
    });
  } finally {
    pathModule.resolve = originalResolve;
  }
});

test('removeAddonDirRobustly retries transient Windows lock errors and then quarantines locked directories', async () => {
  const target = 'C:\\workspace\\.pi\\extensions\\node_modules\\piclaw-addon-example';
  const addonsDir = 'C:\\workspace\\.pi\\extensions';
  let attempts = 0;
  const removed: string[] = [];
  const renamed: Array<{ from: string; to: string }> = [];

  const result = await removeAddonDirRobustly(target, addonsDir, {
    platform: 'win32',
    existsSync: (path) => path === target,
    rmSync: (path) => {
      removed.push(String(path));
      attempts += 1;
      const error = new Error('resource busy or locked') as Error & { code?: string };
      error.code = 'EBUSY';
      throw error;
    },
    mkdirSync: () => undefined,
    renameSync: (from, to) => { renamed.push({ from: String(from), to: String(to) }); },
    sleep: async () => undefined,
    now: () => 12345,
  });

  expect(attempts).toBe(4);
  expect(removed).toHaveLength(4);
  expect(result).toEqual({
    removed: true,
    deferred: true,
    movedTo: 'C:\\workspace\\.pi\\extensions/.trash/piclaw-addon-example-12345',
  });
  expect(renamed).toEqual([
    {
      from: target,
      to: 'C:\\workspace\\.pi\\extensions/.trash/piclaw-addon-example-12345',
    },
  ]);
});

test('removeAddonDirRobustly rethrows non-lock errors', async () => {
  const target = '/workspace/.pi/extensions/node_modules/piclaw-addon-example';
  const addonsDir = '/workspace/.pi/extensions';
  const error = new Error('boom') as Error & { code?: string };
  error.code = 'ENOENT';

  await expect(removeAddonDirRobustly(target, addonsDir, {
    platform: 'linux',
    existsSync: () => true,
    rmSync: () => { throw error; },
    sleep: async () => undefined,
  })).rejects.toBe(error);
});

test('isAddonFsLockError matches common Windows lock errors', () => {
  const busy = new Error('resource busy or locked') as Error & { code?: string };
  busy.code = 'EBUSY';
  expect(isAddonFsLockError(busy)).toBe(true);
  expect(isAddonFsLockError(new Error('Access is denied'))).toBe(true);
  expect(isAddonFsLockError(new Error('plain failure'))).toBe(false);
});

test('handleAddonConfigApiRequest prefers directly registered addon config handlers', async () => {
  registerAddonConfigApi('observability', 'config', {
    get: async () => ({ enabled: true, source: 'direct' }),
    set: async (body) => ({ ok: true, body, source: 'direct' }),
  }, 'test-addon');

  let slashCalls = 0;
  const getRes = await handleAddonConfigApiRequest(
    new Request('https://example.test/agent/addons/api/observability/config'),
    '/agent/addons/api/observability/config',
    (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
    {
      async applySlashCommand() {
        slashCalls += 1;
        return { status: 'error', message: 'slash should not be called' };
      },
    },
    'web:test',
  );
  expect(getRes?.status).toBe(200);
  expect(await getRes?.json()).toEqual({ enabled: true, source: 'direct' });

  const postRes = await handleAddonConfigApiRequest(
    new Request('https://example.test/agent/addons/api/observability/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    }),
    '/agent/addons/api/observability/config',
    (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
    {
      async applySlashCommand() {
        slashCalls += 1;
        return { status: 'error', message: 'slash should not be called' };
      },
    },
    'web:test',
  );
  expect(postRes?.status).toBe(200);
  expect(await postRes?.json()).toEqual({ ok: true, body: { enabled: false }, source: 'direct' });
  expect(slashCalls).toBe(0);
});

test('handleAddonConfigApiRequest loads direct addon config handlers from installed addon extension entries', async () => {
  await withTempWorkspaceEnv('piclaw-addon-config-direct-', {}, async (workspace) => {
    const addonDir = join(workspace.workspace, '.pi', 'extensions', 'node_modules', 'piclaw-addon-example');
    mkdirSync(addonDir, { recursive: true });
    writeFileSync(join(addonDir, 'package.json'), JSON.stringify({
      name: 'piclaw-addon-example',
      version: '0.1.0',
      type: 'module',
      pi: { extensions: ['index.ts'] },
    }, null, 2));
    writeFileSync(join(addonDir, 'index.ts'), [
      'const registerAddonConfigApi = globalThis.__piclaw_registerAddonConfigApi;',
      'if (typeof registerAddonConfigApi === "function") {',
      '  registerAddonConfigApi("example-addon", "config", {',
      '    get: async () => ({ ok: true, source: "loaded-direct" }),',
      '    set: async (body) => ({ ok: true, body, source: "loaded-direct" }),',
      '  }, import.meta.dir);',
      '}',
      'export default function noop() {}',
      '',
    ].join('\n'));

    let slashCalls = 0;
    const res = await handleAddonConfigApiRequest(
      new Request('https://example.test/agent/addons/api/example-addon/config'),
      '/agent/addons/api/example-addon/config',
      (body, status = 200) => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
      {
        async applySlashCommand() {
          slashCalls += 1;
          return { status: 'error', message: 'slash should not be called' };
        },
      },
      'web:test',
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true, source: 'loaded-direct' });
    expect(slashCalls).toBe(0);
  });
});

test('handleAddonConfigApiRequest maps GET config requests to addon slash commands', async () => {
  await withTempWorkspaceEnv('piclaw-addon-config-slash-get-', {}, async () => {
    const invocations: Array<{ chatJid: string; rawText: string }> = [];
    const res = await handleAddonConfigApiRequest(
      new Request('https://example.test/agent/addons/api/observability/config'),
      '/agent/addons/api/observability/config',
      (body, status = 200) => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
      {
        async applySlashCommand(chatJid: string, rawText: string) {
          invocations.push({ chatJid, rawText });
          return {
            status: 'success',
            message: '{"enabled":true}',
            messages: [{ customType: 'observability', text: '{"enabled":true}' }],
          };
        },
      },
      'web:test',
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ enabled: true });
    expect(invocations).toEqual([{ chatJid: 'web:test', rawText: '/observability-config-get' }]);
  });
});

test('handleAddonConfigApiRequest maps arbitrary GET addon API requests to addon slash commands', async () => {
  await withTempWorkspaceEnv('piclaw-addon-config-slash-browser-', {}, async () => {
    const invocations: Array<{ chatJid: string; rawText: string }> = [];
    const res = await handleAddonConfigApiRequest(
      new Request('https://example.test/agent/addons/api/observability/browser-config'),
      '/agent/addons/api/observability/browser-config',
      (body, status = 200) => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
      {
        async applySlashCommand(chatJid: string, rawText: string) {
          invocations.push({ chatJid, rawText });
          return {
            status: 'success',
            messages: [{ customType: 'observability', text: '{"ok":true,"enabled":true}' }],
          };
        },
      },
      'web:test',
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true, enabled: true });
    expect(invocations).toEqual([{ chatJid: 'web:test', rawText: '/observability-browser-config-get' }]);
  });
});

test('handleAddonConfigApiRequest falls back to suffixed addon slash commands when duplicates exist', async () => {
  await withTempWorkspaceEnv('piclaw-addon-config-slash-suffix-', {}, async () => {
    const invocations: Array<{ chatJid: string; rawText: string }> = [];
    const res = await handleAddonConfigApiRequest(
      new Request('https://example.test/agent/addons/api/proxmox/config'),
      '/agent/addons/api/proxmox/config',
      (body, status = 200) => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
      {
        async applySlashCommand(chatJid: string, rawText: string) {
          invocations.push({ chatJid, rawText });
          if (rawText === '/proxmox-config-get') {
            return {
              status: 'error',
              message: 'Unknown extension command: /proxmox-config-get',
            };
          }
          if (rawText === '/proxmox-config-get:1') {
            return {
              status: 'success',
              messages: [{ customType: 'proxmox', text: '{"host":"pve.local"}' }],
            };
          }
          return {
            status: 'error',
            message: 'unexpected invocation',
          };
        },
      },
      'web:test',
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ host: 'pve.local' });
    expect(invocations).toEqual([
      { chatJid: 'web:test', rawText: '/proxmox-config-get' },
      { chatJid: 'web:test', rawText: '/proxmox-config-get:1' },
    ]);
  });
});

test('handleAddonConfigApiRequest maps POST config requests to addon slash commands', async () => {
  await withTempWorkspaceEnv('piclaw-addon-config-slash-post-', {}, async () => {
    const invocations: Array<{ chatJid: string; rawText: string }> = [];
    const res = await handleAddonConfigApiRequest(
      new Request('https://example.test/agent/addons/api/observability/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false, graphite_port: 2004 }),
      }),
      '/agent/addons/api/observability/config',
      (body, status = 200) => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
      {
        async applySlashCommand(chatJid: string, rawText: string) {
          invocations.push({ chatJid, rawText });
          return {
            status: 'success',
            messages: [{ customType: 'observability', text: '{"ok":true,"config":{"enabled":false,"graphite_port":2004}}' }],
          };
        },
      },
      'web:test',
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true, config: { enabled: false, graphite_port: 2004 } });
    expect(invocations).toEqual([{ chatJid: 'web:test', rawText: '/observability-config-set {"enabled":false,"graphite_port":2004}' }]);
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
