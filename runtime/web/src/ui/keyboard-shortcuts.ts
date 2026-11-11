import { getLocalStorageJSON, setLocalStorageItem } from '../utils/storage.js';

export type KeyboardShortcutActionId =
  | 'openHelp'
  | 'openSettings'
  | 'previousChat'
  | 'nextChat'
  | 'toggleDock'
  | 'toggleWorkspace'
  | 'toggleSessions'
  | 'toggleZenMode';

export interface KeyboardShortcutActionDefinition {
  id: KeyboardShortcutActionId;
  label: string;
  description: string;
  defaultBindings: string[];
}

const STORAGE_KEY = 'piclaw_keyboard_shortcuts_v1';

export const KEYBOARD_SHORTCUT_ACTIONS: KeyboardShortcutActionDefinition[] = [
  {
    id: 'openHelp',
    label: 'Open keyboard help',
    description: 'Open Settings → Keyboard. Default: question mark and quote when focus is outside compose and other editable fields.',
    defaultBindings: ['?', '"'],
  },
  {
    id: 'openSettings',
    label: 'Open settings',
    description: 'Open the settings dialog.',
    defaultBindings: ['ctrl+,', 'meta+,', 'alt+,'],
  },
  {
    id: 'previousChat',
    label: 'Previous session',
    description: 'Switch to the previous visible chat/session.',
    defaultBindings: ['['],
  },
  {
    id: 'nextChat',
    label: 'Next session',
    description: 'Switch to the next visible chat/session.',
    defaultBindings: [']'],
  },
  {
    id: 'toggleDock',
    label: 'Toggle dock',
    description: 'Show or hide the bottom dock panes.',
    defaultBindings: ['ctrl+`'],
  },
  {
    id: 'toggleWorkspace',
    label: 'Toggle file tree',
    description: 'Show or hide the workspace file tree.',
    defaultBindings: ['ctrl+shift+e', 'meta+shift+e'],
  },
  {
    id: 'toggleSessions',
    label: 'Toggle sessions',
    description: 'Show or hide the sessions pane on wide screens.',
    defaultBindings: ['ctrl+shift+b', 'meta+shift+b'],
  },
  {
    id: 'toggleZenMode',
    label: 'Toggle zen mode',
    description: 'Collapse surrounding chrome for a focused chat view.',
    defaultBindings: ['ctrl+shift+z', 'meta+shift+z'],
  },
];

const ACTION_MAP = new Map(KEYBOARD_SHORTCUT_ACTIONS.map((action) => [action.id, action] as const));

const MODIFIER_ALIASES: Record<string, 'ctrl' | 'meta' | 'alt' | 'shift'> = {
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
};

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  spacebar: 'space',
};

const NAMED_KEYS = new Set([
  'tab',
  'enter',
  'space',
  'backspace',
  'delete',
  'insert',
  'clear',
  'home',
  'end',
  'pageup',
  'pagedown',
  'up',
  'down',
  'left',
  'right',
]);

interface ParsedBinding {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function normalizeKeyToken(token: string): string | null {
  const trimmed = String(token || '').trim().toLowerCase();
  if (!trimmed) return null;
  const aliased = KEY_ALIASES[trimmed] || trimmed;
  if (/^f(?:[1-9]|1[0-2])$/.test(aliased)) return aliased;
  if (NAMED_KEYS.has(aliased)) return aliased;
  if (aliased.length === 1) return aliased;
  if (/^[a-z0-9]+$/.test(aliased)) return aliased;
  return null;
}

export function normalizeShortcutBindingString(value: string): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;

  const parsed: ParsedBinding = {
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: '',
  };

  for (const part of parts) {
    const normalizedPart = part.toLowerCase();
    const modifier = MODIFIER_ALIASES[normalizedPart];
    if (modifier) {
      parsed[modifier] = true;
      continue;
    }
    if (parsed.key) return null;
    const key = normalizeKeyToken(part);
    if (!key || key === 'escape') return null;
    parsed.key = key;
  }

  if (!parsed.key) return null;

  const segments: string[] = [];
  if (parsed.ctrl) segments.push('ctrl');
  if (parsed.meta) segments.push('meta');
  if (parsed.alt) segments.push('alt');
  if (parsed.shift) segments.push('shift');
  segments.push(parsed.key);
  return segments.join('+');
}

export function parseShortcutBindingList(value: string): string[] {
  return String(value || '')
    .split(/[\n,]/)
    .map((entry) => normalizeShortcutBindingString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

export function formatShortcutBindingList(bindings: string[]): string {
  return bindings.join(', ');
}

function readStoredShortcutConfig(): Partial<Record<KeyboardShortcutActionId, string[]>> {
  const stored = getLocalStorageJSON<Partial<Record<KeyboardShortcutActionId, string[]>>>(STORAGE_KEY);
  if (!stored || typeof stored !== 'object') return {};
  const next: Partial<Record<KeyboardShortcutActionId, string[]>> = {};
  for (const action of KEYBOARD_SHORTCUT_ACTIONS) {
    const raw = stored[action.id];
    if (!Array.isArray(raw)) continue;
    const normalized = raw
      .map((entry) => normalizeShortcutBindingString(String(entry || '')))
      .filter((entry): entry is string => Boolean(entry));
    next[action.id] = [...new Set(normalized)];
  }
  return next;
}

function writeStoredShortcutConfig(config: Partial<Record<KeyboardShortcutActionId, string[]>>): void {
  setLocalStorageItem(STORAGE_KEY, JSON.stringify(config));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('piclaw:keyboard-shortcuts-changed', { detail: { config } }));
  }
}

export function getKeyboardShortcutAction(actionId: KeyboardShortcutActionId): KeyboardShortcutActionDefinition {
  return ACTION_MAP.get(actionId)!;
}

export function getKeyboardShortcutBindings(actionId: KeyboardShortcutActionId): string[] {
  const stored = readStoredShortcutConfig()[actionId];
  if (Array.isArray(stored)) return stored;
  return [...getKeyboardShortcutAction(actionId).defaultBindings];
}

export function saveKeyboardShortcutBindings(actionId: KeyboardShortcutActionId, bindings: string[]): void {
  const config = readStoredShortcutConfig();
  const defaults = getKeyboardShortcutAction(actionId).defaultBindings;
  const normalized = [...new Set(bindings.map((entry) => normalizeShortcutBindingString(entry)).filter((entry): entry is string => Boolean(entry)))];
  if (normalized.length === defaults.length && normalized.every((entry, index) => entry === defaults[index])) {
    delete config[actionId];
  } else {
    config[actionId] = normalized;
  }
  writeStoredShortcutConfig(config);
}

export function resetKeyboardShortcutBindings(actionId?: KeyboardShortcutActionId): void {
  if (!actionId) {
    writeStoredShortcutConfig({});
    return;
  }
  const config = readStoredShortcutConfig();
  delete config[actionId];
  writeStoredShortcutConfig(config);
}

export function readAllKeyboardShortcutBindings(): Record<KeyboardShortcutActionId, string[]> {
  const result = {} as Record<KeyboardShortcutActionId, string[]>;
  for (const action of KEYBOARD_SHORTCUT_ACTIONS) {
    result[action.id] = getKeyboardShortcutBindings(action.id);
  }
  return result;
}

function normalizeEventKey(key: unknown): string {
  const raw = typeof key === 'string' ? key : '';
  if (!raw) return '';
  if (raw.length === 1) return raw.toLowerCase();
  return normalizeKeyToken(raw) || raw.toLowerCase();
}

function parseNormalizedBinding(binding: string): ParsedBinding | null {
  const normalized = normalizeShortcutBindingString(binding);
  if (!normalized) return null;
  const parsed: ParsedBinding = {
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: '',
  };
  for (const part of normalized.split('+')) {
    if (part === 'ctrl' || part === 'meta' || part === 'alt' || part === 'shift') {
      parsed[part] = true;
      continue;
    }
    parsed.key = part;
  }
  return parsed.key ? parsed : null;
}

export function matchesShortcutBinding(event: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  key?: string;
}, binding: string): boolean {
  const parsed = parseNormalizedBinding(binding);
  if (!parsed) return false;
  const normalizedEventKey = normalizeEventKey(event?.key);
  if (normalizedEventKey !== parsed.key) return false;
  const symbolKeyAllowsImplicitShift = !parsed.shift && parsed.key.length === 1 && /[^a-z0-9]/i.test(parsed.key);
  return Boolean(event?.ctrlKey) === parsed.ctrl
    && Boolean(event?.metaKey) === parsed.meta
    && Boolean(event?.altKey) === parsed.alt
    && (symbolKeyAllowsImplicitShift || Boolean(event?.shiftKey) === parsed.shift);
}

export function matchesKeyboardShortcutAction(event: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  key?: string;
}, actionId: KeyboardShortcutActionId): boolean {
  return getKeyboardShortcutBindings(actionId).some((binding) => matchesShortcutBinding(event, binding));
}
