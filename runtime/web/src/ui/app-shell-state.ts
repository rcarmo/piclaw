import { getLocalStorageItem, setLocalStorageItem } from '../utils/storage.js';

/** Shared localStorage key for the BTW side-conversation session cache. */
export const BTW_SESSION_KEY = 'piclaw_btw_session';

/** Shared localStorage key for the last main chat session opened in the shell/PWA. */
export const LAST_MAIN_CHAT_JID_KEY = 'piclaw_last_main_chat';

/** Cooldown window that prevents duplicate branch-rename submits. */
export const RENAME_BRANCH_FORM_GUARD_MS = 900;

/** Window-global lock key used to share rename-submit state across reloads/HMR. */
export const RENAME_BRANCH_FORM_LOCK_KEY = '__piclawRenameBranchFormLock__';

/** Shared rename-form lock state stored on `window`. */
export interface RenameBranchFormLock {
  inFlight: boolean;
  cooldownUntil: number;
}

/** Minimal script element shape used by the asset-version resolver. */
interface ScriptLike {
  getAttribute(name: string): string | null | undefined;
}

/** Minimal document shape needed for app shell helper tests and runtime use. */
export interface DocumentLike {
  querySelectorAll?(selector: string): ArrayLike<ScriptLike> | null | undefined;
}

/** Minimal location param reader used by the shell boot parser. */
export interface LocationParamsLike {
  get(key: string): string | null;
}

/** Persisted BTW side-conversation snapshot recovered from local storage. */
export interface StoredBtwSession {
  question: string;
  answer: string;
  thinking: string;
  error: string | null;
  model: null;
  status: 'success' | 'error';
}

/** Parsed shell-mode flags derived from the current location. */
export interface AppLocationModes {
  currentChatJid: string;
  panePopoutMode: boolean;
  panePopoutPath: string;
  panePopoutLabel: string;
  branchLoaderMode: boolean;
  branchLoaderSourceChatJid: string;
}

/** Options for resolving the current app bundle version. */
export interface CurrentAppAssetVersionOptions {
  importMetaUrl?: string | null;
  document?: DocumentLike | null;
  origin?: string | null;
}

/** Optional overrides for recovering a persisted BTW session. */
export interface LoadStoredBtwSessionOptions {
  readItem?: (key: string) => string | null | undefined;
  storageKey?: string;
}

/** Optional overrides for recovering the persisted last main chat id. */
export interface LoadStoredLastMainChatJidOptions {
  readItem?: (key: string) => string | null | undefined;
  storageKey?: string;
}

/** Optional overrides for persisting the last main chat id. */
export interface SaveStoredLastMainChatJidOptions {
  writeItem?: (key: string, value: string) => void;
  storageKey?: string;
}

/** Optional overrides for parsing location-driven app shell modes. */
export interface ReadAppLocationModesOptions {
  defaultChatJid?: string;
}

/** Optional override for the window-global rename form lock carrier. */
export interface RenameBranchFormLockOptions {
  window?: (Window & typeof globalThis & Record<string, unknown>) | null;
}

function getDefaultImportMetaUrl(): string | null {
  try {
    return import.meta.url;
  } catch {
    return null;
  }
}

function readModeParam(raw: string | null | undefined): boolean {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return value === '1' || value === 'true' || value === 'yes';
}

function readAssetVersionFromImportMeta(importMetaUrl: string | null | undefined): string | null {
  try {
    const direct = importMetaUrl ? new URL(importMetaUrl).searchParams.get('v') : null;
    return direct && direct.trim() ? direct.trim() : null;
  } catch {
    return null;
  }
}

function readTextParam(locationParams: LocationParamsLike, key: string, fallback = ''): string {
  const raw = locationParams?.get?.(key);
  return raw && raw.trim() ? raw.trim() : fallback;
}

function normalizeChatJid(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

/** Resolve the current authenticated app bundle version from import.meta or the loaded script tag. */
export function getCurrentAppAssetVersion(options: CurrentAppAssetVersionOptions = {}): string | null {
  const importMetaUrl = options.importMetaUrl === undefined ? getDefaultImportMetaUrl() : options.importMetaUrl;
  const doc = options.document === undefined ? (typeof document !== 'undefined' ? document : null) : options.document;
  const origin = options.origin === undefined
    ? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
    : (options.origin || 'http://localhost');

  const direct = readAssetVersionFromImportMeta(importMetaUrl);
  if (direct) return direct;

  try {
    const script = Array.from(doc?.querySelectorAll?.('script[type="module"][src]') || [])
      .find((node) => String(node?.getAttribute?.('src') || '').includes('/static/classic/dist/app.bundle.js'));
    const src = script?.getAttribute?.('src') || '';
    if (!src) return null;
    const resolved = new URL(src, origin);
    const fallback = resolved.searchParams.get('v');
    return fallback && fallback.trim() ? fallback.trim() : null;
  } catch {
    return null;
  }
}

/** Return the shared cross-reload branch-rename form lock. */
export function getRenameBranchFormLock(options: RenameBranchFormLockOptions = {}): RenameBranchFormLock | null {
  const win = options.window === undefined
    ? ((typeof window !== 'undefined' ? window : null) as RenameBranchFormLockOptions['window'])
    : options.window;
  if (!win) return null;
  const existing = win[RENAME_BRANCH_FORM_LOCK_KEY];
  if (existing && typeof existing === 'object') {
    return existing as RenameBranchFormLock;
  }
  const created: RenameBranchFormLock = { inFlight: false, cooldownUntil: 0 };
  win[RENAME_BRANCH_FORM_LOCK_KEY] = created;
  return created;
}

/** Human-readable label for the active timeline search scope. */
export function describeSearchScope(scope: string | null | undefined): string {
  if (scope === 'root') return 'Branch family';
  if (scope === 'all') return 'All chats';
  return 'Current branch';
}

/** Load the persisted BTW side-conversation snapshot from local storage. */
export function loadStoredBtwSession(options: LoadStoredBtwSessionOptions = {}): StoredBtwSession | null {
  const readItem = typeof options.readItem === 'function' ? options.readItem : getLocalStorageItem;
  const storageKey = options.storageKey || BTW_SESSION_KEY;
  const raw = readItem(storageKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    const question = typeof parsed.question === 'string' ? parsed.question : '';
    const answer = typeof parsed.answer === 'string' ? parsed.answer : '';
    const thinking = typeof parsed.thinking === 'string' ? parsed.thinking : '';
    const error = typeof parsed.error === 'string' && parsed.error.trim() ? parsed.error : null;
    const status = parsed.status === 'running'
      ? 'error'
      : (parsed.status === 'success' || parsed.status === 'error' ? parsed.status : 'success');
    return {
      question,
      answer,
      thinking,
      error: status === 'error' ? (error || 'BTW stream interrupted. You can retry.') : error,
      model: null,
      status,
    };
  } catch {
    return null;
  }
}

/** Load the last main chat/session JID persisted for shell/PWA relaunch. */
export function loadStoredLastMainChatJid(options: LoadStoredLastMainChatJidOptions = {}): string | null {
  const readItem = typeof options.readItem === 'function' ? options.readItem : getLocalStorageItem;
  const storageKey = options.storageKey || LAST_MAIN_CHAT_JID_KEY;
  return normalizeChatJid(readItem(storageKey));
}

/** Persist the last main chat/session JID for shell/PWA relaunch. */
export function saveStoredLastMainChatJid(chatJid: unknown, options: SaveStoredLastMainChatJidOptions = {}): string | null {
  const normalized = normalizeChatJid(chatJid);
  if (!normalized) return null;
  const writeItem = typeof options.writeItem === 'function' ? options.writeItem : setLocalStorageItem;
  const storageKey = options.storageKey || LAST_MAIN_CHAT_JID_KEY;
  writeItem(storageKey, normalized);
  return normalized;
}

/** Parse location-driven shell modes for the main app. */
export function readAppLocationModes(
  locationParams: LocationParamsLike,
  options: ReadAppLocationModesOptions = {},
): AppLocationModes {
  const defaultChatJid = options.defaultChatJid || 'web:default';
  const currentChatJid = readTextParam(locationParams, 'chat_jid', defaultChatJid);
  const panePopoutMode = readModeParam(locationParams?.get?.('pane_popout'));
  const panePopoutPath = readTextParam(locationParams, 'pane_path');
  const panePopoutLabel = readTextParam(locationParams, 'pane_label');
  const branchLoaderMode = readModeParam(locationParams?.get?.('branch_loader'));
  const branchLoaderSourceChatJid = readTextParam(locationParams, 'branch_source_chat_jid', currentChatJid);

  return {
    currentChatJid,
    panePopoutMode,
    panePopoutPath,
    panePopoutLabel,
    branchLoaderMode,
    branchLoaderSourceChatJid,
  };
}
