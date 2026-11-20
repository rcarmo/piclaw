import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SettingsManager } from '../../node_modules/@earendil-works/pi-coding-agent';
import { loadApplicationExtensionCatalog, assertApplicationExtensionCatalogSupported, auditInstalledApplicationAddonSources, bindInstalledAddon, qualifyInstalledAddon, type InstalledAddonBindingReceipt } from '../../runtime/durable-engine/src/host-extension-catalog.js';
import { installedAddonProfiles } from '../../runtime/durable-engine/src/host-installed-addon-profiles.js';
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

test('installed binding receipts require the original qualified source and catalogue', async () => {
  const source = process.env.DURABLE_ADDONS_ROOT;
  if (!source) throw Error('Frozen add-on fixture required');
  const cwd = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'installed-binding-'));
  const profile = installedAddonProfiles['yolo-vibe'];
  const agentDir = join(cwd, 'agent'), pkg = join(cwd, '.pi/extensions/node_modules', profile.name);
  let catalog: Awaited<ReturnType<typeof loadApplicationExtensionCatalog>> | undefined;
  try {
    mkdirSync(agentDir);
    for (const file of Object.keys(profile.files)) {
      const target = join(pkg, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(source, 'addons/yolo-vibe', file), target);
    }
    catalog = await loadApplicationExtensionCatalog({ cwd, agentDir, settingsManager: SettingsManager.inMemory() });
    const qualified = (await qualifyInstalledAddon(catalog, cwd, 'yolo-vibe'))!;
    const empty = { tools: [], lifecycle: {}, commands: {} };
    const assertSupported = (receipts: readonly InstalledAddonBindingReceipt[], target = catalog!) =>
      assertApplicationExtensionCatalogSupported(target, undefined, undefined, undefined, undefined, undefined, undefined, undefined, receipts);
    expect(() => assertSupported([])).not.toThrow(); // The static profile needs no native effects.
    expect(() => bindInstalledAddon({ ...qualified }, empty)).toThrow('Qualified installed add-on identity required');
    expect(() => bindInstalledAddon(qualified, { ...empty, lifecycle: { extra() {} } })).toThrow('Incomplete native capability binding');
    const receipt = bindInstalledAddon(qualified, empty);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(() => assertSupported([receipt])).not.toThrow();
    expect(() => assertSupported([{ ...receipt }])).toThrow('Native receipt catalog identity required');
    expect(() => assertSupported([receipt], { ...catalog! })).toThrow('Native receipt catalog identity required');
  } finally { catalog?.runtime.invalidate(); rmSync(cwd, { force: true, recursive: true }); }
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
