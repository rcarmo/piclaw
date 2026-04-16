import { expect, test } from 'bun:test';

import {
  formatNotificationTitle,
  WEB_PUSH_NOTIFICATION_SOURCE_LABEL,
} from '../../web/src/ui/use-notifications.js';

test('formatNotificationTitle appends a visible source marker', () => {
  expect(formatNotificationTitle('PiClaw', WEB_PUSH_NOTIFICATION_SOURCE_LABEL)).toBe('PiClaw [Web Push]');
});

test('formatNotificationTitle falls back cleanly when no source marker is provided', () => {
  expect(formatNotificationTitle('Pi', '')).toBe('Pi');
  expect(formatNotificationTitle('', '')).toBe('PiClaw');
});
