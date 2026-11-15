import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsManager } from '../../node_modules/@earendil-works/pi-coding-agent';
import { loadApplicationExtensionCatalog, assertApplicationExtensionCatalogSupported, inspectAddonInstall } from '../../runtime/durable-engine/src/host-extension-catalog.js';
import { getInstalledAddonConfigEntryPaths } from '../../runtime/src/channels/web/handlers/addon-config-api.js';
import { resolveActiveAddonEntries } from '../../runtime/src/addons/package-entries.js';

// Source/handler/declaration qualification is retired, not weakened. Every old
// package variant must be ignored BEFORE evaluation; the Core tool is independent.
for (const mode of ['approved', 'shadow', 'dirty', 'version', 'handler', 'execute', 'schema'] as const) {
  test(`retired Delegate package cannot register capabilities: ${mode}`, async () => {
    const dir = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'retired-delegate-'));
    const pkg = join(dir, '.pi/extensions/node_modules/@rcarmo/piclaw-addon-delegate'), marker = join(dir, 'evaluated');
    mkdirSync(pkg, { recursive: true }); mkdirSync(join(dir, 'agent'));
    const manifest = { name: '@rcarmo/piclaw-addon-delegate', version: mode === 'version' ? '99.0.0' : '0.2.22', type: 'module',
      pi: { extensions: ['index.ts'], web: { entries: ['web.ts'] } } };
    writeFileSync(join(pkg, 'package.json'), JSON.stringify(manifest));
    const poison = `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(mode)}); throw Error('RETIRED_DELEGATE_EVALUATED');`;
    for (const file of ['index.ts', 'delegate.ts', 'web.ts', ...(mode === 'shadow' ? ['index.js', 'delegate.js'] : [])]) writeFileSync(join(pkg, file), poison);
    let catalog: Awaited<ReturnType<typeof loadApplicationExtensionCatalog>> | undefined;
    try {
      expect(getInstalledAddonConfigEntryPaths(dir)).toEqual([]);
      expect(resolveActiveAddonEntries(pkg, manifest, manifest.pi.web.entries)).toEqual([]);
      catalog = await loadApplicationExtensionCatalog({ cwd: dir, agentDir: join(dir, 'agent'), settingsManager: SettingsManager.inMemory() });
      expect(catalog.extensions).toHaveLength(0);
      expect(catalog.errors).toHaveLength(0);
      expect(() => assertApplicationExtensionCatalogSupported(catalog!)).not.toThrow();
      expect(existsSync(marker)).toBe(false);
      expect(inspectAddonInstall(manifest.name, manifest.version)?.supportedVersion).toBe('built-in');
    } finally { catalog?.runtime.invalidate('fixture ended'); rmSync(dir, { recursive: true, force: true }); }
  });
}
