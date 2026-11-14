import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeSettingsSectionId } from '../../web/src/components/settings-dialog-events.js';
const web = join(import.meta.dir, '../../web');
const source = (path: string) => readFileSync(join(web, path), 'utf8');

test('General no longer owns authentication, API tokens or recovery saves', () => {
  for (const path of ['src/components/settings/general.ts']) {
    const text = source(path);
    for (const field of ['automaticRecovery', 'instanceTotp', 'widgetToken', 'totpSetup']) expect(text).not.toContain(field);
    expect(text).not.toContain('composeUploadLimitMb');
    expect(text).toContain('workspaceUploadLimitMb');
  }
});

test('Authentication retains TOTP display and passkeys without unsupported TOTP mutation', () => {
  for (const path of ['src/components/settings/authentication.ts']) {
    const text = source(path);
    expect(text).toContain('instanceTotp');
    expect(text).toContain('PasskeySettings');
    expect(text).not.toContain('enableTotp');
    expect(text).not.toContain('disableTotp');
    expect(text).not.toContain('widgetToken');
  }
});

test('embedded API access uses the existing token rotation endpoint in Classic', () => {
  for (const path of ['src/components/settings/api-access.ts']) {
    const text = source(path);
    expect(text).toContain('/agent/settings/widget-token/regenerate');
    expect(text).toContain('GET /api/state');
    expect(text).toContain('GET /api/state/events');
    expect(text).not.toContain('instanceTotp');
  }
});

test('Authentication and Sessions names and IDs remain unchanged and API access is embedded', () => {
  const classic = source('src/components/settings-dialog.ts');
  expect(classic).toContain("id: 'authentication', label: 'Authentication'");
  expect(classic).toContain("id: 'sessions', label: 'Sessions'");
  expect(classic).not.toContain("case 'api-access'");
  expect(classic).not.toContain("id: 'api-access'");
  expect(source('src/components/settings/authentication.ts')).toContain('<${ApiAccessSection}');

});

test('old API access section links resolve to Authentication without changing other IDs', () => {
  expect(normalizeSettingsSectionId('api-access')).toBe('authentication');
  expect(normalizeSettingsSectionId(' authentication ')).toBe('authentication');
  expect(normalizeSettingsSectionId('sessions')).toBe('sessions');
  expect(normalizeSettingsSectionId('keychain')).toBe('keychain');
  expect(normalizeSettingsSectionId('')).toBeNull();
});
