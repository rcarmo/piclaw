import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempWorkspace } from '../helpers.js';
import { getInstalledAddonExtensionPaths, resolveActiveAddonEntries } from '../../src/addons/package-entries.js';
import { getInstalledAddonConfigEntryPaths } from '../../src/channels/web/handlers/addon-config-api.js';

test('individual and aggregate discovery exclude legacy Plan before extension/config/web import, preserving other declared entries', () => {
  const ws = createTempWorkspace('core-plan-retirement-');
  try {
    const individual = join(ws.workspace, '.pi/extensions/node_modules/@rcarmo/piclaw-addon-plan-sidebar');
    const aggregate = join(ws.workspace, '.pi/extensions/node_modules/@rcarmo/piclaw-addons');
    for (const path of [join(individual, 'index.ts'), join(individual, 'web.js'), join(aggregate, 'index.ts'), join(aggregate, 'addons/plan-sidebar/index.ts'), join(aggregate, 'addons/plan-sidebar/web.js'), join(aggregate, 'addons/goal/index.ts'), join(aggregate, 'addons/goal/web.js')]) {
      mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, 'throw Error("MUST_NOT_IMPORT_DURING_DISCOVERY")');
    }
    const retired = { name: '@rcarmo/piclaw-addon-plan-sidebar', pi: { extensions: ['index.ts'] } };
    const bundle = { name: '@rcarmo/piclaw-addons', pi: { extensions: ['index.ts', 'addons/plan-sidebar/index.ts', 'addons/goal/index.ts'] } };
    writeFileSync(join(individual, 'package.json'), JSON.stringify(retired)); writeFileSync(join(aggregate, 'package.json'), JSON.stringify(bundle));
    expect(getInstalledAddonExtensionPaths(ws.workspace)).toEqual([join(aggregate, 'addons/goal/index.ts')]);
    expect(getInstalledAddonConfigEntryPaths(ws.workspace)).toEqual([join(aggregate, 'addons/goal/index.ts')]);
    expect(resolveActiveAddonEntries(individual, retired, ['web.js'])).toEqual([]);
    expect(resolveActiveAddonEntries(aggregate, bundle, ['addons/plan-sidebar/web.js', 'addons/goal/web.js'])).toEqual([join(aggregate, 'addons/goal/web.js')]);
  } finally { ws.cleanup(); }
});
