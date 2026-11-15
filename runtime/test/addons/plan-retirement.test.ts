import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempWorkspace } from '../helpers.js';
import { getInstalledAddonExtensionPaths, resolveActiveAddonEntries } from '../../src/addons/package-entries.js';
import { getInstalledAddonConfigEntryPaths } from '../../src/channels/web/handlers/addon-config-api.js';

for (const slug of ['plan-sidebar', 'delegate']) test(`individual and aggregate discovery exclude retired ${slug} before extension/config/web import, preserving other declared entries`, () => {
  const ws = createTempWorkspace('core-addon-retirement-');
  try {
    const individual = join(ws.workspace, `.pi/extensions/node_modules/@rcarmo/piclaw-addon-${slug}`);
    const aggregate = join(ws.workspace, '.pi/extensions/node_modules/@rcarmo/piclaw-addons');
    for (const path of [join(individual, 'index.ts'), join(individual, 'web.js'), join(aggregate, 'index.ts'), join(aggregate, `addons/${slug}/index.ts`), join(aggregate, `addons/${slug}/web.js`), join(aggregate, 'addons/goal/index.ts'), join(aggregate, 'addons/goal/web.js')]) {
      mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, 'throw Error("MUST_NOT_IMPORT_DURING_DISCOVERY")');
    }
    const retired = { name: `@rcarmo/piclaw-addon-${slug}`, pi: { extensions: ['index.ts'] } };
    const bundle = { name: '@rcarmo/piclaw-addons', pi: { extensions: ['index.ts', `addons/${slug}/index.ts`, 'addons/goal/index.ts'] } };
    writeFileSync(join(individual, 'package.json'), JSON.stringify(retired)); writeFileSync(join(aggregate, 'package.json'), JSON.stringify(bundle));
    expect(getInstalledAddonExtensionPaths(ws.workspace)).toEqual([join(aggregate, 'addons/goal/index.ts')]);
    expect(getInstalledAddonConfigEntryPaths(ws.workspace)).toEqual([join(aggregate, 'addons/goal/index.ts')]);
    expect(resolveActiveAddonEntries(individual, retired, ['web.js'])).toEqual([]);
    expect(resolveActiveAddonEntries(aggregate, bundle, [`addons/${slug}/web.js`, 'addons/goal/web.js'])).toEqual([join(aggregate, 'addons/goal/web.js')]);
  } finally { ws.cleanup(); }
});
