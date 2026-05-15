import { afterEach, expect, test } from 'bun:test';

import { getAttachmentPreviewKind, getAttachmentPreviewLabel } from '../../web/src/ui/attachment-preview.js';
import { paneRegistry } from '../../web/src/panes/index.js';
import {
  buildAddonAttachmentPreviewFrameUrl,
  createAddonWebApi,
  getAddonAttachmentPreviewNote,
  installAddonWebApi,
  registerAddonAttachmentPreview,
  registerAddonPane,
  registerAddonSettingsPane,
  registerAddonShellSurface,
  registerAddonStandaloneTabUrlResolver,
  resolveAddonStandaloneTabUrl,
  resetAddonWebRegistriesForTests,
} from '../../web/src/ui/addon-web-extensions.ts';
import { getRegisteredSettingsPanes } from '../../web/src/components/settings/pane-registry.js';
import { getShellSurface, listShellSurfaces, renderShellSlot } from '../../web/src/ui/shell-surface-registry.js';

afterEach(() => {
  resetAddonWebRegistriesForTests();
});

test('addon web API exposes the current chat jid to add-on settings panes', () => {
  const runtimeWindow = {
    __piclawCurrentChatJid: 'web:branch-123',
    location: { href: 'http://localhost/?chat_jid=web%3Adefault' },
  } as any;
  const api = createAddonWebApi(runtimeWindow);
  expect(api.getCurrentChatJid()).toBe('web:branch-123');

  runtimeWindow.__piclawCurrentChatJid = '';
  runtimeWindow.location.href = 'http://localhost/?chat_jid=web%3Abranch-456';
  expect(api.getCurrentChatJid()).toBe('web:branch-456');

  runtimeWindow.location.href = 'http://localhost/';
  expect(api.getCurrentChatJid()).toBe('web:default');
});

test('addon web registries support workspace panes, settings panes, standalone URLs, and attachment previews', () => {
  registerAddonPane({
    id: 'example-addon-pane',
    label: 'Example Addon Pane',
    capabilities: ['edit'],
    placement: 'tabs',
    canHandle: () => 60,
    mount() {
      return {
        getContent() { return undefined; },
        isDirty() { return false; },
        focus() {},
        dispose() {},
      };
    },
  });
  registerAddonSettingsPane({
    id: 'example-addon-settings',
    label: 'Example Addon Settings',
    icon: '⚙️',
    component() { return null; },
    order: 210,
  });
  registerAddonStandaloneTabUrlResolver((path, { hasPopOutTab } = {}) => {
    if (!/\.example$/i.test(String(path || '')) || hasPopOutTab) return null;
    return '/example-addon/view?path=' + encodeURIComponent(path);
  });
  registerAddonAttachmentPreview({
    id: 'example-preview',
    label: 'Example add-on preview',
    match(contentType, filename) {
      return String(contentType || '').toLowerCase() === 'application/x-example' || /\.example$/i.test(String(filename || ''));
    },
    buildFrameUrl(mediaId, filename) {
      return `/example-addon/view?media=${encodeURIComponent(String(mediaId))}&name=${encodeURIComponent(filename || 'sample.example')}`;
    },
    note: 'Example add-on preview note.',
  });

  expect(paneRegistry.get('example-addon-pane')).toBeTruthy();
  expect(getRegisteredSettingsPanes().some((pane) => pane.id === 'example-addon-settings')).toBe(true);
  expect(resolveAddonStandaloneTabUrl('/workspace/sample.example', { hasPopOutTab: false })).toBe('/example-addon/view?path=%2Fworkspace%2Fsample.example');
  expect(resolveAddonStandaloneTabUrl('/workspace/sample.example', { hasPopOutTab: true })).toBeNull();
  expect(getAttachmentPreviewKind('application/x-example', 'sample.example')).toBe('example-preview');
  expect(getAttachmentPreviewLabel('example-preview')).toBe('Example add-on preview');
  expect(buildAddonAttachmentPreviewFrameUrl('example-preview', 7, 'sample.example')).toContain('/example-addon/view?media=7');
  expect(getAddonAttachmentPreviewNote('example-preview')).toContain('Example add-on preview note.');
});

test('addon shell surfaces register only additive allowlisted slots with safe defaults', () => {
  registerAddonShellSurface({
    id: 'example.shell.surface',
    slot: 'timeline.above',
    label: 'Example shell surface',
    render: () => 'example surface',
  });

  expect(getShellSurface('example.shell.surface')).toMatchObject({
    id: 'example.shell.surface',
    slot: 'timeline.above',
    label: 'Example shell surface',
    owner: 'addon',
    kind: 'additive',
    order: 300,
    defaultVisible: true,
  });
  expect(renderShellSlot('timeline.above')).toEqual(['example surface']);
});

test('addon shell surfaces allow configured additive slots and explicit visibility/order', () => {
  registerAddonShellSurface({
    id: 'example.quick.action',
    slot: 'timeline.quick-actions',
    order: 250,
    defaultVisible: false,
    render: () => 'quick action',
  });

  expect(listShellSurfaces('timeline.quick-actions')).toEqual([
    expect.objectContaining({
      id: 'example.quick.action',
      label: 'example.quick.action',
      owner: 'addon',
      kind: 'additive',
      order: 250,
      visible: false,
    }),
  ]);
  expect(renderShellSlot('timeline.quick-actions')).toEqual([]);
});

test('addon shell surfaces reject required, special, core, piclaw-owned, empty, and missing-render definitions', () => {
  expect(() => registerAddonShellSurface({ id: '', slot: 'timeline.above', render: () => null })).toThrow('id must be a non-empty string');
  expect(() => registerAddonShellSurface({ id: 'piclaw.addon.fake', slot: 'timeline.above', render: () => null })).toThrow('must not start with piclaw');
  expect(() => registerAddonShellSurface({ id: 'example.required', slot: 'timeline.above', kind: 'required', render: () => null })).toThrow('must be additive');
  expect(() => registerAddonShellSurface({ id: 'example.configurable', slot: 'timeline.above', kind: 'configurable', render: () => null })).toThrow('must be additive');
  expect(() => registerAddonShellSurface({ id: 'example.core', slot: 'timeline.above', owner: 'core', render: () => null })).toThrow('cannot use owner core');
  expect(() => registerAddonShellSurface({ id: 'example.core.slot', slot: 'timeline.core' as any, render: () => null })).toThrow('slot is not allowed');
  expect(() => registerAddonShellSurface({ id: 'example.special.slot', slot: 'app.modal' as any, render: () => null })).toThrow('slot is not allowed');
  expect(() => registerAddonShellSurface({ id: 'example.missing.render', slot: 'timeline.above' })).toThrow('render must be a function');
});

test('addon shell surface disposer and reset cleanup remove registered surfaces', () => {
  const dispose = registerAddonShellSurface({ id: 'example.disposable', slot: 'compose.before', render: () => 'dispose me' });
  expect(getShellSurface('example.disposable')).toBeTruthy();

  dispose();
  expect(getShellSurface('example.disposable')).toBeUndefined();

  registerAddonShellSurface({ id: 'example.reset', slot: 'compose.after', render: () => 'reset me' });
  resetAddonWebRegistriesForTests();
  expect(getShellSurface('example.reset')).toBeUndefined();
});

test('addon web API exposes registerShellSurface globally', () => {
  const runtimeWindow = {} as any;
  const api = createAddonWebApi(runtimeWindow);
  expect(api.registerShellSurface).toBe(registerAddonShellSurface);

  const installedApi = installAddonWebApi(runtimeWindow);
  expect(installedApi.registerShellSurface).toBe(registerAddonShellSurface);
  expect(runtimeWindow.__piclaw_web.registerShellSurface).toBe(registerAddonShellSurface);
  expect(runtimeWindow.__piclaw_registerShellSurface).toBe(registerAddonShellSurface);
});
