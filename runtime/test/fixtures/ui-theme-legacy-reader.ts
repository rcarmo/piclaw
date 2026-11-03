import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPathWithinTestFilesystemIsolation } from '../../scripts/test-filesystem-isolation.js';
const workspace = process.env.PICLAW_WORKSPACE!;
assertPathWithinTestFilesystemIsolation(workspace, process.env, { allowRoot: false });
const path = join(workspace, '.piclaw/config.json'), bytes = JSON.stringify({ ui: { theme: 'Solarized-Light', tint: ' #345 ' }, marker: 'historical bytes' });
mkdirSync(join(workspace, '.piclaw'), { recursive: true }); writeFileSync(path, bytes);
const identity = await import('../../src/core/config-identity.js');
const ui = await import('../../src/channels/web/ui-state.js');
const db = await import('../../src/db.js');
assert.deepEqual(ui.getServerUiThemeConfig(), { theme: 'solarized-light', tint: '#345' });
assert.equal(readFileSync(path, 'utf8'), bytes);
db.initDatabase();
try {
  assert.deepEqual(ui.getServerUiThemeConfig(), { theme: 'solarized-light', tint: '#345' });
  const next = await ui.admitServerUiState({ ui_theme: { tint: null } }, () => {});
  assert.deepEqual(next.ui_theme, { theme: 'solarized-light', tint: null });
  assert.deepEqual(ui.getServerUiThemeConfig(), next.ui_theme);
  assert.deepEqual(identity.getUiThemeConfig(), { theme: 'Solarized-Light', tint: '#345' });
  assert.equal(readFileSync(path, 'utf8'), bytes);
  assert.deepEqual(db.extensionKvGet('piclaw-ui', 'theme', 'global'), next.ui_theme);
} finally { db.closeDatabase(); }
console.log(JSON.stringify({ kind: 'ui-theme-legacy-reader', configUnchanged: true, sqlitePrimary: true, legacyFallback: true }));
