import { WEB_THEME_PRESETS, normaliseWebThemeId, type ThemePalette, type ThemePreset, type ThemeMode } from '../../../src/core/ui-theme-catalogue.js';
import { paletteVariables, themeForeground } from './theme-palette.js';
import { applyThemeChrome, watchThemeChrome } from './theme-chrome.js';
import { getLocalStorageItem, setLocalStorageItem } from '../utils/storage.js';

const THEME_STORAGE_KEY = 'piclaw_theme';
const TINT_STORAGE_KEY = 'piclaw_tint';
const MODE_STORAGE_KEY = 'piclaw_theme_mode';
let appliedKeys = new Set<string>();

const DEFAULT_LIGHT = WEB_THEME_PRESETS[0].light!;
const DEFAULT_DARK = WEB_THEME_PRESETS[0].dark!;
const THEME_PRESETS = Object.fromEntries(WEB_THEME_PRESETS.map(p=>[p.id,p]));

type ParsedColor = {r:number;g:number;b:number;hex:string};
interface ThemeState {theme:string;tint:string|null}
let currentTheme: ThemeState = {
    theme: 'default',
    tint: null,
};
let currentMode: ThemeMode = 'light';
let mediaListenerAttached = false;

function normalizeThemeName(value: unknown) {return normaliseWebThemeId(value) || 'default';}

function parseHexColor(input: unknown): ParsedColor | null {
    if (!input) return null;
    const raw = String(input).trim();
    if (!raw) return null;
    const hex = raw.startsWith('#') ? raw.slice(1) : raw;
    if (!/^[0-9a-fA-F]{3}$/.test(hex) && !/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    const full = hex.length === 3
        ? hex.split('').map((c) => c + c).join('')
        : hex;
    const int = parseInt(full, 16);
    return {
        r: (int >> 16) & 255,
        g: (int >> 8) & 255,
        b: int & 255,
        hex: `#${full.toLowerCase()}`,
    };
}

function resolveComputedCssColor(el: HTMLElement, fallbackColor: string) {
    try {
        if (document.body) {
            el.style.display = 'none';
            document.body.appendChild(el);
            const computed = getComputedStyle(el).color || el.style.color;
            document.body.removeChild(el);
            return computed;
        }
    } catch {
        return fallbackColor;
    }
    return fallbackColor;
}

function parseCssColor(input: unknown): ParsedColor | null {
    if (!input || typeof document === 'undefined') return null;
    const raw = String(input).trim();
    if (!raw) return null;

    const el = document.createElement('div');
    el.style.color = '';
    el.style.color = raw;
    if (!el.style.color) return null;

    const computed = resolveComputedCssColor(el, el.style.color);

    const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return null;
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    if (![r, g, b].every((v) => Number.isFinite(v))) return null;
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    return { r, g, b, hex };
}

function parseColor(input: unknown): ParsedColor | null {
    return parseHexColor(input) || parseCssColor(input);
}

function mixColors(base: ParsedColor, overlay: ParsedColor, ratio: number) {
    const r = Math.round(base.r + (overlay.r - base.r) * ratio);
    const g = Math.round(base.g + (overlay.g - base.g) * ratio);
    const b = Math.round(base.b + (overlay.b - base.b) * ratio);
    return `rgb(${r} ${g} ${b})`;
}

function rgbaColor(color: ParsedColor, alpha: number) {
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

/** Return white or black text for maximum contrast against the given background. */
function contrastTextColor(bg: ParsedColor) {
    return themeForeground(bg.hex || `#${[bg.r,bg.g,bg.b].map(v=>v.toString(16).padStart(2,'0')).join('')}`);
}

function resolveSystemMode(): ThemeMode {
    if (typeof window === 'undefined') return 'light';
    try {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
    } catch {
        return 'light';
    }
}

function resolvePreset(themeName: string): ThemePreset {
    return THEME_PRESETS[themeName] || THEME_PRESETS.default;
}

function resolveModeForPreset(preset: ThemePreset): ThemeMode {
    const preference = getLocalStorageItem(MODE_STORAGE_KEY);
    return preset.mode === 'auto' ? (preference === 'light' || preference === 'dark' ? preference : resolveSystemMode()) : preset.mode;
}

function resolvePalette(themeName: string, mode: ThemeMode): ThemePalette {
    const preset = resolvePreset(themeName);
    if (mode === 'dark' && preset.dark) return preset.dark;
    if (mode === 'light' && preset.light) return preset.light;
    return preset.dark || preset.light || DEFAULT_LIGHT;
}

function tintPaletteColor(value: string | undefined, tint: ParsedColor, ratio: number) {
    const base = parseColor(value);
    if (!base) return value || '#000000';
    return mixColors(base, tint, ratio);
}

function buildTintedPalette(basePalette: ThemePalette, tintHex: string, mode: ThemeMode): ThemePalette {
    const tint = parseColor(tintHex);
    if (!tint) return basePalette;

    const contrastColor = mode === 'dark' ? '#ffffff' : '#000000';
    const contrast = parseHexColor(contrastColor);

    return {
        ...basePalette,
        bgPrimary: tintPaletteColor(basePalette.bgPrimary, tint, 0.08),
        bgSecondary: tintPaletteColor(basePalette.bgSecondary, tint, 0.12),
        bgHover: tintPaletteColor(basePalette.bgHover, tint, 0.16),
        textPrimary: tintPaletteColor(basePalette.textPrimary, tint, mode === 'dark' ? 0.08 : 0.06),
        textSecondary: tintPaletteColor(basePalette.textSecondary, tint, mode === 'dark' ? 0.12 : 0.1),
        borderColor: tintPaletteColor(basePalette.borderColor, tint, 0.1),
        accent: tint.hex,
        accentHover: contrast ? mixColors(tint, contrast, 0.18) : tint.hex,
        warning: tintPaletteColor(basePalette.warning || DEFAULT_LIGHT.warning, tint, 0.14),
        danger: tintPaletteColor(basePalette.danger, tint, 0.16),
        success: tintPaletteColor(basePalette.success, tint, 0.16),
    };
}

function resolveWarningColor(palette: ThemePalette, mode: ThemeMode) {
    const explicit = parseColor(palette?.warning);
    if (explicit) return explicit.hex;

    const defaultWarning = parseColor(mode === 'dark' ? DEFAULT_DARK.warning : DEFAULT_LIGHT.warning)
        || parseColor(DEFAULT_LIGHT.warning);
    const accent = parseColor(palette?.accent);

    if (defaultWarning && accent) {
        return mixColors(defaultWarning, accent, mode === 'dark' ? 0.18 : 0.14);
    }

    return mode === 'dark' ? DEFAULT_DARK.warning : DEFAULT_LIGHT.warning;
}

function applyCssVariables(palette: ThemePalette, mode: ThemeMode) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const accentColor = palette.accent;
    const accentHex = parseColor(accentColor);
    const searchHighlight = accentHex ? rgbaColor(accentHex, mode === 'dark' ? 0.35 : 0.2) : undefined;
    const accentSoft = accentHex
        ? rgbaColor(accentHex, mode === 'dark' ? 0.16 : 0.12)
        : 'rgba(29, 155, 240, 0.12)';
    const accentSoftStrong = accentHex
        ? rgbaColor(accentHex, mode === 'dark' ? 0.28 : 0.2)
        : 'rgba(29, 155, 240, 0.2)';
    const accentContrastText = accentHex
        ? contrastTextColor(accentHex)
        : (mode === 'dark' ? '#000000' : '#ffffff');
    const accentColorAlpha = accentHex
        ? rgbaColor(accentHex, mode === 'dark' ? 0.35 : 0.25)
        : 'rgba(29, 155, 240, 0.25)';
    const warningColor = resolveWarningColor(palette, mode);

    const vars = {
        '--bg-primary': palette.bgPrimary,
        '--bg-secondary': palette.bgSecondary,
        '--bg-hover': palette.bgHover,
        '--text-primary': palette.textPrimary,
        '--text-secondary': palette.textSecondary,
        '--border-color': palette.borderColor,
        '--accent-color': accentColor,
        '--accent-hover': palette.accentHover || accentColor,
        '--accent-color-alpha': accentColorAlpha,
        '--accent-soft': accentSoft,
        '--accent-soft-strong': accentSoftStrong,
        '--accent-contrast-text': accentContrastText,
        '--warning-color': warningColor,
        '--danger-color': palette.danger || DEFAULT_LIGHT.danger,
        '--success-color': palette.success || DEFAULT_LIGHT.success,
        '--search-highlight-color': searchHighlight || 'rgba(29, 155, 240, 0.2)',
    };

    const complete = paletteVariables({ ...palette, warning: warningColor }, mode);
    // Preserve existing computed highlight/tint values, but semantic foregrounds come from the complete palette.
    Object.assign(complete, { '--accent-soft': accentSoft, '--accent-soft-strong': accentSoftStrong,
        '--accent-color-alpha': accentColorAlpha, '--accent-contrast-text': accentContrastText,
        '--search-highlight-color': searchHighlight || vars['--search-highlight-color'] });
    appliedKeys.forEach(key => root.style.removeProperty(key));
    appliedKeys = new Set(Object.keys(complete));
    Object.entries(complete).forEach(([key,value]) => root.style.setProperty(key,value));
}

export function applyOutputPad(value: unknown) {
    if (typeof document === 'undefined') return;
    const parsed = Number(value);
    const clamped = Number.isFinite(parsed) ? Math.min(24, Math.max(0, Math.round(parsed))) : 0;
    document.documentElement.style.setProperty('--output-pad', `${clamped}px`);
    document.documentElement.dataset.outputPad = String(clamped);
}

function emitThemeChange() {
    if (typeof window === 'undefined') return;
    const detail = { ...currentTheme, mode: currentMode };
    window.dispatchEvent(new CustomEvent('piclaw-theme-change', { detail }));
}

function resolveCurrentChatJid() {
    if (typeof window === 'undefined') return 'web:default';
    try {
        const params = new URL(window.location.href).searchParams;
        const raw = params.get('chat_jid');
        return raw && raw.trim() ? raw.trim() : 'web:default';
    } catch {
        return 'web:default';
    }
}

function applyThemeState(nextTheme: Partial<ThemeState>, options: { persist?: boolean } = {}) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const themeName = normalizeThemeName(nextTheme?.theme || 'default');
    const tint = nextTheme?.tint ? String(nextTheme.tint).trim() : null;
    const preset = resolvePreset(themeName);
    const mode = resolveModeForPreset(preset);
    const paletteBase = resolvePalette(themeName, mode);

    currentTheme = { theme: themeName, tint };
    currentMode = mode;

    const root = document.documentElement;
    root.dataset.theme = mode;
    root.dataset.colorTheme = themeName;
    root.dataset.tint = tint ? String(tint) : '';
    root.style.colorScheme = mode;
    if (root.classList?.toggle) { root.classList.toggle('dark', mode === 'dark'); root.classList.toggle('light', mode === 'light'); }

    let palette = paletteBase;
    if (themeName === 'default' && tint) {
        palette = buildTintedPalette(paletteBase, tint, mode);
    }

    applyCssVariables(palette, mode);
    root.dataset.synthwaveGlow = preset.glow ? 'on' : 'off';
    updateThemeVisibility();

    applyThemeChrome(palette.bgPrimary);
    emitThemeChange();

    if (options.persist !== false) {
        setLocalStorageItem(THEME_STORAGE_KEY, themeName);
        if (tint) setLocalStorageItem(TINT_STORAGE_KEY, tint);
        else setLocalStorageItem(TINT_STORAGE_KEY, '');
    }
}

function handleSystemThemeChange() {
    const preset = resolvePreset(currentTheme.theme);
    if (preset.mode !== 'auto') return;
    applyThemeState(currentTheme, { persist: false });
}

export function reapplyStoredTheme() {
    if (typeof window === 'undefined') return;

    const storedTheme = normalizeThemeName(getLocalStorageItem(THEME_STORAGE_KEY) || 'default');
    const storedTint = (() => { const raw = getLocalStorageItem(TINT_STORAGE_KEY); return raw ? raw.trim() : null; })();

    applyThemeState({ theme: storedTheme, tint: storedTint }, { persist: false });
}

/** Event-driven only: no timer/RAF is needed to pause CSS effects in a hidden tab. */
function updateThemeVisibility() {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.themeMotion = document.hidden ? 'paused' : 'running';
}

export function initTheme() {
    if (typeof window === 'undefined') return () => {};

    reapplyStoredTheme();
    updateThemeVisibility();
    document.addEventListener('visibilitychange', updateThemeVisibility);
    const stopChrome = watchThemeChrome();

    if (window.matchMedia && !mediaListenerAttached) {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        if (media.addEventListener) {
            media.addEventListener('change', handleSystemThemeChange);
        } else if (media.addListener) {
            media.addListener(handleSystemThemeChange);
        }
        mediaListenerAttached = true;
        return () => {
            if (media.removeEventListener) {
                media.removeEventListener('change', handleSystemThemeChange);
            } else if (media.removeListener) {
                media.removeListener(handleSystemThemeChange);
            }
            stopChrome();
            mediaListenerAttached = false;
            document.removeEventListener('visibilitychange', updateThemeVisibility);
        };
    }

    return () => { stopChrome(); document.removeEventListener('visibilitychange', updateThemeVisibility); };
}

export function applyThemeFromEvent(payload: any) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.outputPad !== undefined || payload.output_pad !== undefined) {
        applyOutputPad(payload.outputPad ?? payload.output_pad);
    }
    const hasThemeValue = payload.theme !== undefined || payload.name !== undefined || payload.colorTheme !== undefined;
    const hasTintValue = payload.tint !== undefined;
    if (!hasThemeValue && !hasTintValue) return;

    const currentChatJid = resolveCurrentChatJid();
    const eventChatJid = payload.chat_jid || payload.chatJid || null;
    const theme = payload.theme ?? payload.name ?? payload.colorTheme;
    const tint = payload.tint ?? null;

    // /theme and /tint are now instance-wide settings persisted server-side.
    // Apply immediately for global events and for chat-affined echoes that
    // target the currently viewed chat.
    if (!eventChatJid || eventChatJid === currentChatJid) {
        applyThemeState({ theme: theme || 'default', tint }, { persist: false });
    }

    setLocalStorageItem(THEME_STORAGE_KEY, theme || 'default');
    setLocalStorageItem(TINT_STORAGE_KEY, tint || '');
}

export function getThemeMode(): ThemeMode {
    if (typeof document === 'undefined') return 'light';
    const attr = document.documentElement?.dataset?.theme;
    if (attr === 'dark' || attr === 'light') return attr;
    return resolveSystemMode();
}

export function setThemeModePreference(mode: 'auto' | 'light' | 'dark'): void {
    setLocalStorageItem(MODE_STORAGE_KEY, mode);
    reapplyStoredTheme();
}
export function getThemeModePreference(): string {return getLocalStorageItem(MODE_STORAGE_KEY) || 'auto';}
