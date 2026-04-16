function formatNotificationTitle(title, sourceLabel) {
  const normalizedTitle = String(title || '').trim() || 'PiClaw';
  const normalizedSource = String(sourceLabel || '').trim();
  return normalizedSource ? `${normalizedTitle} [${normalizedSource}]` : normalizedTitle;
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const defaultNotification = {
    title: 'PiClaw',
    body: 'You have a new update.',
    tag: 'piclaw',
    url: '/',
    sourceLabel: '',
  };

  let payload = defaultNotification;
  try {
    const next = event.data?.json?.();
    if (next && typeof next === 'object') {
      payload = {
        ...defaultNotification,
        ...next,
      };
    }
  } catch {
    const text = event.data?.text?.();
    if (text) {
      payload = {
        ...defaultNotification,
        body: text,
      };
    }
  }

  event.waitUntil(self.registration.showNotification(formatNotificationTitle(payload.title, payload.sourceLabel), {
    body: payload.body,
    tag: payload.tag,
    data: {
      url: payload.url || '/',
    },
    icon: '/static/icon-192.png',
    badge: '/static/icon-192.png',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      const clientUrl = client.url || '';
      if (clientUrl === targetUrl || clientUrl.startsWith(targetUrl) || targetUrl === '/') {
        if ('focus' in client) {
          await client.focus();
        }
        if ('navigate' in client && targetUrl && clientUrl !== targetUrl) {
          await client.navigate(targetUrl).catch(() => {});
        }
        return;
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
