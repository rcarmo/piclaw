import { isPopoutWindow } from './workspace-visibility.js';
import { useCallback, useEffect, useMemo, useState } from '../vendor/preact-htm.js';
import { isStandaloneWebAppMode } from './chat-window.js';
import {
  loadStoredLastMainChatJid,
  readAppLocationModes,
  saveStoredLastMainChatJid,
} from './app-shell-state.js';

function readModeParam(raw: string | null | undefined): boolean {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return value === '1' || value === 'true' || value === 'yes';
}

function parseUrl(href: string): URL {
  try {
    return new URL(String(href || 'http://localhost/'));
  } catch {
    return new URL(String(href || '/'), 'http://localhost/');
  }
}

export function resolveNavigationUrl(nextUrl: unknown, baseHref: string): string {
  return new URL(String(nextUrl || ''), baseHref).toString();
}

export interface ResolveStandaloneLaunchHrefOptions {
  standalone?: boolean;
  storedChatJid?: string | null;
}

/**
 * In standalone/PWA mode, replace the launch chat with the last persisted main chat.
 * Use `preserve_launch_url=1` on explicit deep links to bypass this restore.
 */
export function resolveStandaloneLaunchHref(
  currentHref: string,
  options: ResolveStandaloneLaunchHrefOptions = {},
): string {
  const url = parseUrl(currentHref);
  const { standalone = false, storedChatJid = null } = options;
  const normalizedStoredChatJid = typeof storedChatJid === 'string' ? storedChatJid.trim() : '';

  if (!standalone || !normalizedStoredChatJid) {
    return url.toString();
  }

  if (readModeParam(url.searchParams.get('preserve_launch_url'))) {
    return url.toString();
  }

  const modes = readAppLocationModes(url.searchParams);
  if (modes.panePopoutMode || modes.branchLoaderMode) {
    return url.toString();
  }

  url.searchParams.delete('branch_loader');
  url.searchParams.delete('branch_source_chat_jid');
  url.searchParams.delete('pane_popout');
  url.searchParams.delete('pane_path');
  url.searchParams.delete('pane_label');

  if (normalizedStoredChatJid === 'web:default') {
    url.searchParams.delete('chat_jid');
  } else {
    url.searchParams.set('chat_jid', normalizedStoredChatJid);
  }

  return url.toString();
}

export interface PersistLastMainChatFromHrefOptions {
  standalone?: boolean;
}

/**
 * Persist the active main chat from the current location.
 * Skip popout/loader contexts so they do not clobber the remembered main session.
 * Also skip non-standalone pop-out windows so they do not overwrite the
 * remembered main shell/PWA session.
 */
export function persistLastMainChatFromHref(
  currentHref: string,
  options: PersistLastMainChatFromHrefOptions = {},
): string | null {
  const url = parseUrl(currentHref);
  const { standalone = false } = options;
  const modes = readAppLocationModes(url.searchParams);

  if (modes.panePopoutMode || modes.branchLoaderMode) {
    return null;
  }

  if (isPopoutWindow() && !standalone) {
    return null;
  }

  return saveStoredLastMainChatJid(modes.currentChatJid);
}

function resolveInitialLocationHref(): string {
  if (typeof window === 'undefined') return 'http://localhost/';

  const currentHref = window.location.href;
  const restoredHref = resolveStandaloneLaunchHref(currentHref, {
    standalone: isStandaloneWebAppMode({ window, navigator: window.navigator }),
    storedChatJid: loadStoredLastMainChatJid(),
  });

  if (restoredHref !== currentHref) {
    window.history.replaceState(null, '', restoredHref);
  }

  return window.location.href;
}

export function useAppLocationNavigation() {
  const [locationHref, setLocationHref] = useState(resolveInitialLocationHref);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handlePopState = () => setLocationHref(window.location.href);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    persistLastMainChatFromHref(locationHref, {
      standalone: isStandaloneWebAppMode({ window, navigator: window.navigator }),
    });
  }, [locationHref]);

  const navigate = useCallback((nextUrl: unknown, options: { replace?: boolean } = {}) => {
    if (typeof window === 'undefined') return;
    const { replace = false } = options || {};
    const resolved = resolveNavigationUrl(nextUrl, window.location.href);
    if (replace) {
      window.history.replaceState(null, '', resolved);
    } else {
      window.history.pushState(null, '', resolved);
    }
    setLocationHref(window.location.href);
  }, []);

  const locationParams = useMemo(() => new URL(locationHref).searchParams, [locationHref]);

  return {
    locationParams,
    navigate,
  };
}
