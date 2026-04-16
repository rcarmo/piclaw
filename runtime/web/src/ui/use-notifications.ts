import { deleteWebPushSubscription, getWebPushPublicKey, saveWebPushSubscription } from '../api.js';
import { useCallback, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { getLocalStorageBoolean, setLocalStorageItem } from '../utils/storage.js';
import { focusWindowBestEffort } from './notification-focus.js';

export const LOCAL_NOTIFICATION_SOURCE_LABEL = 'Local';
export const WEB_PUSH_NOTIFICATION_SOURCE_LABEL = 'Web Push';

export function formatNotificationTitle(title, sourceLabel = '') {
  const normalizedTitle = typeof title === 'string' && title.trim() ? title.trim() : 'PiClaw';
  const normalizedSource = typeof sourceLabel === 'string' ? sourceLabel.trim() : '';
  return normalizedSource ? `${normalizedTitle} [${normalizedSource}]` : normalizedTitle;
}

function decodeBase64UrlToUint8Array(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function supportsWebPush(runtimeWindow = typeof window !== 'undefined' ? window : null) {
  if (!runtimeWindow || !runtimeWindow.isSecureContext) return false;
  return 'serviceWorker' in runtimeWindow.navigator && 'PushManager' in runtimeWindow;
}

async function ensureStoredWebPushSubscription(runtimeWindow) {
  await runtimeWindow.navigator.serviceWorker.register('/sw.js');
  const registration = await runtimeWindow.navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  const payload = await getWebPushPublicKey();
  const publicKey = typeof payload?.publicKey === 'string' ? payload.publicKey.trim() : '';
  if (!publicKey) {
    throw new Error('Missing web push public key.');
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64UrlToUint8Array(publicKey),
  });
}

async function syncWebPushSubscription(runtimeWindow, deviceId) {
  if (!supportsWebPush(runtimeWindow)) return false;
  const subscription = await ensureStoredWebPushSubscription(runtimeWindow);
  await saveWebPushSubscription(subscription.toJSON ? subscription.toJSON() : subscription, { deviceId });
  return true;
}

async function disableWebPushSubscription(runtimeWindow, deviceId) {
  if (!supportsWebPush(runtimeWindow)) return false;
  await runtimeWindow.navigator.serviceWorker.register('/sw.js');
  const registration = await runtimeWindow.navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  const serialized = subscription.toJSON ? subscription.toJSON() : subscription;
  try {
    await deleteWebPushSubscription(serialized, { deviceId });
  } catch (error) {
    console.warn('Failed to remove web push subscription from the server:', error);
  }
  try {
    await subscription.unsubscribe();
  } catch (error) {
    console.warn('Failed to unsubscribe from web push notifications:', error);
  }
  return true;
}

function getOrCreateNotificationDeviceId(runtimeWindow = typeof window !== 'undefined' ? window : null) {
  const storage = runtimeWindow?.localStorage;
  const existing = typeof storage?.getItem === 'function' ? storage.getItem('piclaw.notifications.deviceId') : null;
  if (existing) return existing;
  const created = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `device-${crypto.randomUUID()}`
    : `device-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  try {
    storage?.setItem?.('piclaw.notifications.deviceId', created);
  } catch (error) {
    console.debug('[use-notifications] Ignoring notification device-id persistence failure.', error);
  }
  return (typeof storage?.getItem === 'function' ? storage.getItem('piclaw.notifications.deviceId') : null) || created;
}

export function useNotifications() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState('default');
  const notificationsEnabledRef = useRef(false);
  const deviceIdRef = useRef(null);

  useEffect(() => {
    const enabled = getLocalStorageBoolean('notificationsEnabled', false);
    notificationsEnabledRef.current = enabled;
    setNotificationsEnabled(enabled);
    if (typeof window !== 'undefined') {
      deviceIdRef.current = getOrCreateNotificationDeviceId(window);
    }
    if (typeof Notification === 'undefined') {
      return;
    }

    const permission = Notification.permission;
    setNotificationPermission(permission);

    if (permission === 'denied' && enabled) {
      notificationsEnabledRef.current = false;
      setNotificationsEnabled(false);
      setLocalStorageItem('notificationsEnabled', 'false');
      return;
    }

    if (permission === 'granted' && enabled && typeof window !== 'undefined' && supportsWebPush(window)) {
      void syncWebPushSubscription(window, deviceIdRef.current || getOrCreateNotificationDeviceId(window)).catch((error) => {
        console.warn('Failed to refresh stored web push subscription:', error);
      });
    }
  }, []);

  useEffect(() => {
    notificationsEnabledRef.current = notificationsEnabled;
  }, [notificationsEnabled]);

  const requestNotificationPermission = useCallback(() => {
    if (typeof Notification === 'undefined') return Promise.resolve('denied');
    try {
      const result = Notification.requestPermission();
      if (result && typeof result.then === 'function') {
        return result;
      }
      return Promise.resolve(result);
    } catch (error) {
      console.debug('[use-notifications] Notification permission request threw; returning default permission state.', error);
      return Promise.resolve('default');
    }
  }, []);

  const toggleNotifications = useCallback(async () => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
    if (!window.isSecureContext) {
      alert('Notifications require a secure context (HTTPS or installed app).');
      return;
    }
    if (Notification.permission === 'denied') {
      setNotificationPermission('denied');
      alert('Browser notifications are blocked. Enable them in your browser settings.');
      return;
    }
    if (Notification.permission === 'default') {
      const result = await requestNotificationPermission();
      setNotificationPermission(result || 'default');
      if (result !== 'granted') {
        notificationsEnabledRef.current = false;
        setNotificationsEnabled(false);
        setLocalStorageItem('notificationsEnabled', 'false');
        return;
      }
    }
    const next = !notificationsEnabledRef.current;
    notificationsEnabledRef.current = next;
    setNotificationsEnabled(next);
    setLocalStorageItem('notificationsEnabled', String(next));

    const deviceId = deviceIdRef.current || getOrCreateNotificationDeviceId(window);
    deviceIdRef.current = deviceId;

    if (supportsWebPush(window)) {
      try {
        if (next) {
          await syncWebPushSubscription(window, deviceId);
        } else {
          await disableWebPushSubscription(window, deviceId);
        }
      } catch (error) {
        console.warn('Failed to sync web push notifications:', error);
        if (next) {
          alert('Notifications were enabled, but web push setup failed. If you are on iPhone or iPad, reopen PiClaw from the Home Screen and try again.');
        }
      }
    }
  }, [requestNotificationPermission]);

  const notify = useCallback((title, body, options = {}) => {
    if (!notificationsEnabledRef.current) return false;
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission !== 'granted') return false;
    try {
      const notification = new Notification(formatNotificationTitle(title, options?.sourceLabel || ''), { body });
      notification.onclick = () => {
        focusWindowBestEffort(window);
      };
      return true;
    } catch (error) {
      console.debug('[use-notifications] Local notification creation failed.', error, {
        title: typeof title === 'string' ? title : null,
      });
      return false;
    }
  }, []);

  return {
    notificationsEnabled,
    notificationPermission,
    toggleNotifications,
    notify,
  };
}
