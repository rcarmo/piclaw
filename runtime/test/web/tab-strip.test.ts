import { afterEach, expect, test } from 'bun:test';

import { getStandaloneTabUrl } from '../../web/src/components/tab-strip.js';
import {
  registerAddonStandaloneTabUrlResolver,
  resetAddonWebRegistriesForTests,
} from '../../web/src/ui/addon-web-extensions.ts';

afterEach(() => {
  resetAddonWebRegistriesForTests();
});

test('getStandaloneTabUrl honors addon-provided standalone routes', () => {
  registerAddonStandaloneTabUrlResolver((path, { hasPopOutTab } = {}) => {
    if (!/\.example$/i.test(String(path || '')) || hasPopOutTab) return null;
    return '/example-addon/view?path=' + encodeURIComponent(path);
  });

  expect(getStandaloneTabUrl('/workspace/foo.example', { hasPopOutTab: true })).toBeNull();
  expect(getStandaloneTabUrl('/workspace/foo.example', { hasPopOutTab: false })).toBe('/example-addon/view?path=%2Fworkspace%2Ffoo.example');
});

test('getStandaloneTabUrl still resolves standalone viewer routes for non-addon files', () => {
  expect(getStandaloneTabUrl('/workspace/report.docx', { hasPopOutTab: true })).toBe(
    '/office-viewer/?url=' + encodeURIComponent('/workspace/raw?path=%2Fworkspace%2Freport.docx') + '&name=report.docx',
  );
  expect(getStandaloneTabUrl('/workspace/chart.csv', { hasPopOutTab: true })).toBe('/csv-viewer/?path=%2Fworkspace%2Fchart.csv');
  expect(getStandaloneTabUrl('/workspace/manual.pdf', { hasPopOutTab: true })).toBe('/workspace/raw?path=%2Fworkspace%2Fmanual.pdf');
  expect(getStandaloneTabUrl('/workspace/image.png', { hasPopOutTab: true })).toBe('/image-viewer/?path=%2Fworkspace%2Fimage.png');
});
