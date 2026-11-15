import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsManager } from '../../node_modules/@earendil-works/pi-coding-agent';
import { loadApplicationExtensionCatalog, assertApplicationExtensionCatalogSupported, auditInstalledApplicationAddonSources } from '../../runtime/durable-engine/src/host-extension-catalog.js';
import { getInstalledAddonExtensionPaths } from '../../runtime/src/addons/package-entries.js';
import { getInstalledAddonConfigEntryPaths, handleRegisteredAddonConfigApiRequest } from '../../runtime/src/channels/web/handlers/addon-config-api.js';

for (const version of ['0.1.28', '99.0.0']) test(`retired Plan ${version} is excluded before module, tool, config API and global registration`, async () => {
  const dir = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'retired-plan-'));
  const pkg = join(dir, '.pi/extensions/node_modules/@rcarmo/piclaw-addon-plan-sidebar');
  const marker = join(dir, 'MODULE_MUST_NOT_RUN');
  let catalog: Awaited<ReturnType<typeof loadApplicationExtensionCatalog>> | undefined;
  try {
    mkdirSync(pkg, { recursive: true }); mkdirSync(join(dir, 'agent'));
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@rcarmo/piclaw-addon-plan-sidebar', version, type: 'module', pi: { extensions: ['index.ts'], web: { entries: ['web.js'] } } }));
    writeFileSync(join(pkg, 'index.ts'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'BAD'); globalThis.__piclaw_registerAddonConfigApi?.('plan-sidebar', {}); globalThis.__piclaw_planSidebarApi={}; export default function(){throw Error('RETIRED_FACTORY');}`);
    writeFileSync(join(pkg, 'web.js'), 'throw Error("RETIRED_WEB_ENTRY")');
    expect(getInstalledAddonExtensionPaths(dir)).toEqual([]);
    expect(getInstalledAddonConfigEntryPaths(dir)).toEqual([]);
    expect(auditInstalledApplicationAddonSources(dir).profiles).toEqual([]);
    catalog = await loadApplicationExtensionCatalog({ cwd: dir, agentDir: join(dir, 'agent'), settingsManager: SettingsManager.inMemory() });
    expect(catalog.errors).toEqual([]); expect(catalog.extensions).toEqual([]);
    expect(() => assertApplicationExtensionCatalogSupported(catalog!)).not.toThrow();
    expect(await Bun.file(marker).exists()).toBe(false);
    // Changing ignored bytes at the same path cannot acquire loader provenance.
    writeFileSync(join(pkg, 'index.ts'), 'throw Error("CHANGED_RETIRED_MODULE")');
    catalog.runtime.invalidate();
    catalog = await loadApplicationExtensionCatalog({ cwd: dir, agentDir: join(dir, 'agent'), settingsManager: SettingsManager.inMemory() });
    expect(catalog.extensions).toEqual([]); expect(await Bun.file(marker).exists()).toBe(false);
    expect(await handleRegisteredAddonConfigApiRequest(new Request('https://fixture/agent/addons/api/plan-sidebar/plan'), 'plan-sidebar', 'plan', (body, status) => Response.json(body, { status }))).toBeNull();
  } finally { catalog?.runtime.invalidate(); rmSync(dir, { recursive: true, force: true }); }
});

test('empty public registry passes; unknown factory still fails before top-level I/O', async () => {
  const dir = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'catalog-'));
  mkdirSync(join(dir, 'agent'));
  let catalog: Awaited<ReturnType<typeof loadApplicationExtensionCatalog>> | undefined;
  try {
    const options = { cwd: dir, agentDir: join(dir, 'agent'), settingsManager: SettingsManager.inMemory() };
    catalog = await loadApplicationExtensionCatalog(options);
    expect(() => assertApplicationExtensionCatalogSupported(catalog!)).not.toThrow(); catalog.runtime.invalidate();
    const pkg = join(dir, '.pi/extensions/node_modules/broken'); mkdirSync(pkg, { recursive: true });
    const marker = join(dir, 'unknown-module');
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'broken', pi: { extensions: ['index.ts'] } }));
    writeFileSync(join(pkg, 'index.ts'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'BAD'); export default function(){throw Error('PRIVATE_FACTORY_FAILURE');}`);
    await expect(loadApplicationExtensionCatalog(options)).rejects.toThrow('Unqualified installed add-on package before evaluation');
    expect(await Bun.file(marker).exists()).toBe(false);
  } finally { catalog?.runtime.invalidate(); rmSync(dir, { recursive: true, force: true }); }
});
