import { afterEach, expect, test } from 'bun:test';

import { getAttachmentPreviewKind, getAttachmentPreviewLabel } from '../../web/src/ui/attachment-preview.js';
import { paneRegistry } from '../../web/src/panes/index.js';
import {
  buildAddonAttachmentPreviewFrameUrl,
  getAddonAttachmentPreviewNote,
  registerAddonAttachmentPreview,
  registerAddonPane,
  registerAddonStandaloneTabUrlResolver,
  resolveAddonStandaloneTabUrl,
  resetAddonWebRegistriesForTests,
} from '../../web/src/ui/addon-web-extensions.ts';

afterEach(() => {
  resetAddonWebRegistriesForTests();
});

test('addon web registries support pane, standalone URL, and attachment preview registration', () => {
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
  expect(resolveAddonStandaloneTabUrl('/workspace/sample.example', { hasPopOutTab: false })).toBe('/example-addon/view?path=%2Fworkspace%2Fsample.example');
  expect(resolveAddonStandaloneTabUrl('/workspace/sample.example', { hasPopOutTab: true })).toBeNull();
  expect(getAttachmentPreviewKind('application/x-example', 'sample.example')).toBe('example-preview');
  expect(getAttachmentPreviewLabel('example-preview')).toBe('Example add-on preview');
  expect(buildAddonAttachmentPreviewFrameUrl('example-preview', 7, 'sample.example')).toContain('/example-addon/view?media=7');
  expect(getAddonAttachmentPreviewNote('example-preview')).toContain('Example add-on preview note.');
});
