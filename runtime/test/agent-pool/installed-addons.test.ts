import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withTempWorkspaceEnv } from '../helpers.js';
import { getInstalledAddonExtensionPaths } from '../../src/addons/package-entries.js';

test('getInstalledAddonExtensionPaths discovers package pi.extensions from .pi/extensions/node_modules', async () => {
  await withTempWorkspaceEnv('piclaw-installed-addon-scan-', {}, async (workspace) => {
    const addonDir = join(workspace.workspace, '.pi', 'extensions', 'node_modules', 'piclaw-addon-example');
    mkdirSync(addonDir, { recursive: true });
    writeFileSync(join(addonDir, 'package.json'), JSON.stringify({
      name: 'piclaw-addon-example',
      version: '0.1.0',
      type: 'module',
      pi: { extensions: ['index.ts'] },
    }, null, 2));
    writeFileSync(join(addonDir, 'index.ts'), 'export default function noop() {}\n');

    expect(getInstalledAddonExtensionPaths(workspace.workspace)).toEqual([
      join(addonDir, 'index.ts'),
    ]);
  });
});
