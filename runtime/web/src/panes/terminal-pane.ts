// @ts-nocheck
/**
 * terminal-pane.ts — xterm.js terminal pane for Piclaw.
 *
 * Core/default terminal renderer. Uses Piclaw's existing /terminal/session +
 * /terminal/ws JSON protocol and vendored xterm.js browser assets. Ghostty is
 * available only through the optional ghostty-terminal add-on.
 */

const ASSET_BASE = "/static/common/js/vendor/xterm";
export const TERMINAL_TAB_PATH = "piclaw://terminal";
const TERMINAL_ANON_CLIENT_HEADER = "x-piclaw-terminal-client";
const TERMINAL_ANON_CLIENT_STORAGE_KEY = "piclaw_terminal_client";
const RENDERER_STORAGE_KEY = "piclaw:terminal:renderer";
const STYLE_ID = "piclaw-terminal-style";
const XTERM_CSS_ID = "piclaw-terminal-xterm-css";
const TERMINAL_FONT_FAMILY = 'FiraCode Nerd Font Mono, JetBrainsMono Nerd Font Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const TERMINAL_HEARTBEAT_MS = 25_000;
const TERMINAL_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];
const KITTY_APC_START = "\x1b_G";
const KITTY_APC_START_ALT = "\x9fG";
const KITTY_APC_END = "\x1b\\";
const KITTY_APC_END_ALT = "\x9c";
const KITTY_GRAPHICS_PENDING_LIMIT = 24 * 1024 * 1024;

const LIGHT_TERMINAL_PALETTE = {
  yellow: "#9a6700",
  magenta: "#8250df",
  cyan: "#1b7c83",
  brightBlack: "#57606a",
  brightRed: "#cf222e",
  brightGreen: "#1a7f37",
  brightYellow: "#bf8700",
  brightBlue: "#0550ae",
  brightMagenta: "#6f42c1",
  brightCyan: "#0a7b83",
};

const DARK_TERMINAL_PALETTE = {
  yellow: "#d29922",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  brightBlack: "#8b949e",
  brightRed: "#ff7b72",
  brightGreen: "#7ee787",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
};

let xtermRuntimePromise = null;
let fontsReadyPromise = null;

function asset(path) {
  return `${ASSET_BASE}/${path.replace(/^\/+/, "")}`;
}

function debugTerminalCleanup(label, error) {
  console.debug(`[terminal-pane] ${label} failed`, error);
}

function stripTerminalControl(text) {
  return String(text || "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b_[^\x1b\x9c]*(?:\x1b\\|\x9c)/g, "")
    .replace(/\x9f[^\x1b\x9c]*(?:\x1b\\|\x9c)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "\n");
}

export function createKittyGraphicsState() {
  return {
    pending: "",
    activeImageId: null,
    transfers: new Map(),
  };
}

function findNextKittyStart(input, fromIndex = 0) {
  const escIndex = input.indexOf(KITTY_APC_START, fromIndex);
  const c1Index = input.indexOf(KITTY_APC_START_ALT, fromIndex);
  if (escIndex < 0) return c1Index;
  if (c1Index < 0) return escIndex;
  return Math.min(escIndex, c1Index);
}

function parseKittyGraphicsFrame(framePayload) {
  const payload = String(framePayload || "");
  if (!payload.startsWith("G")) return null;
  const body = payload.slice(1);
  const separator = body.indexOf(";");
  const header = separator >= 0 ? body.slice(0, separator) : body;
  const data = separator >= 0 ? body.slice(separator + 1) : "";
  const fields = {};
  for (const part of header.split(",")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) fields[key] = value;
  }
  return { fields, data };
}

function numericKittyField(fields, key) {
  const value = Number.parseInt(String(fields?.[key] || ""), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function estimateBase64DecodedBytes(base64) {
  const compact = String(base64 || "").replace(/\s+/g, "");
  if (!compact) return 0;
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(compact.length * 3 / 4) - padding);
}

function buildItermInlineImageFromKittyTransfer(transfer) {
  const fields = transfer?.fields || {};
  const base64 = (transfer?.chunks || []).join("").replace(/\s+/g, "");
  if (!base64) return "";
  const args = [
    "inline=1",
    `size=${estimateBase64DecodedBytes(base64)}`,
  ];
  const cols = numericKittyField(fields, "c");
  const rows = numericKittyField(fields, "r");
  if (cols) args.push(`width=${cols}`);
  if (rows) args.push(`height=${rows}`);
  args.push("preserveAspectRatio=1");
  return `\x1b]1337;File=${args.join(";")}:${base64}\x07`;
}

function translateKittyGraphicsFrame(state, framePayload) {
  const parsed = parseKittyGraphicsFrame(framePayload);
  if (!parsed) return null;
  const fields = parsed.fields;
  const explicitId = String(fields.i || "").trim();
  const imageId = explicitId || state.activeImageId || "default";
  const existing = state.transfers.get(imageId);
  const isNewTransfer = Boolean(fields.a || fields.f || fields.t || fields.s || fields.v || fields.c || fields.r || !existing);
  const transfer = isNewTransfer
    ? { fields: { ...(existing?.fields || {}), ...fields }, chunks: [] }
    : { fields: { ...(existing?.fields || {}), ...fields }, chunks: existing?.chunks || [] };
  transfer.chunks.push(parsed.data || "");
  state.activeImageId = imageId;

  const more = String(fields.m || "0") === "1";
  if (more) {
    state.transfers.set(imageId, transfer);
    return "";
  }

  state.transfers.delete(imageId);
  if (state.activeImageId === imageId) state.activeImageId = null;
  return buildItermInlineImageFromKittyTransfer(transfer);
}

export function translateKittyGraphicsOutput(state, chunk) {
  if (!state) state = createKittyGraphicsState();
  const writes = [];
  let input = `${state.pending || ""}${String(chunk || "")}`;
  state.pending = "";

  while (input) {
    const start = findNextKittyStart(input);
    if (start < 0) {
      writes.push(input);
      break;
    }

    if (start > 0) writes.push(input.slice(0, start));

    const usesC1Start = input.startsWith(KITTY_APC_START_ALT, start);
    const payloadStart = start + (usesC1Start ? 1 : 2);
    const escEnd = input.indexOf(KITTY_APC_END, payloadStart);
    const c1End = input.indexOf(KITTY_APC_END_ALT, payloadStart);
    const hasEscEnd = escEnd >= 0;
    const hasC1End = c1End >= 0;
    const end = hasEscEnd && hasC1End ? Math.min(escEnd, c1End) : hasEscEnd ? escEnd : c1End;

    if (end < 0) {
      state.pending = input.slice(start);
      if (state.pending.length > KITTY_GRAPHICS_PENDING_LIMIT) {
        writes.push(state.pending);
        state.pending = "";
      }
      break;
    }

    const endLength = hasEscEnd && end === escEnd ? KITTY_APC_END.length : KITTY_APC_END_ALT.length;
    const framePayload = input.slice(payloadStart, end);
    const translated = translateKittyGraphicsFrame(state, framePayload);
    if (translated === null) {
      writes.push(input.slice(start, end + endLength));
    } else if (translated) {
      writes.push(translated);
    }
    input = input.slice(end + endLength);
  }

  return writes.filter((part) => part !== "");
}

function injectStyles(ownerDocument = document) {
  if (!ownerDocument?.head) return;
  if (!ownerDocument.getElementById(XTERM_CSS_ID)) {
    const link = ownerDocument.createElement("link");
    link.id = XTERM_CSS_ID;
    link.rel = "stylesheet";
    link.href = asset("xterm.css");
    ownerDocument.head.appendChild(link);
  }
  if (!ownerDocument.getElementById(STYLE_ID)) {
    const style = ownerDocument.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .terminal-pane-xterm {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        width: 100%;
        height: 100%;
        position: relative;
        overflow: hidden;
        background: var(--bg-primary, #0d1117);
        color: var(--text-primary, #e6edf3);
        font-family: var(--font-family-terminal, ${TERMINAL_FONT_FAMILY});
      }
      .terminal-pane-xterm .terminal-body {
        display: flex;
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        padding: 6px;
        box-sizing: border-box;
      }
      .terminal-pane-xterm .terminal-host {
        display: flex;
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
        width: 100%;
        height: 100%;
      }
      .terminal-pane-xterm .xterm {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
        width: 100%;
        height: 100%;
        padding: 0;
      }
      .terminal-pane-xterm .xterm-viewport,
      .terminal-pane-xterm .xterm-screen {
        background: transparent !important;
      }
      .terminal-pane-xterm .xterm-viewport {
        scrollbar-color: color-mix(in srgb, var(--terminal-foreground, var(--text-secondary, #8b949e)) 36%, transparent) var(--terminal-background, var(--bg-primary, #0d1117));
        scrollbar-width: thin;
      }
      .terminal-pane-xterm .xterm-viewport::-webkit-scrollbar {
        width: 2px;
        height: 2px;
        background: var(--terminal-background, var(--bg-primary, #0d1117));
      }
      .terminal-pane-xterm .xterm-viewport::-webkit-scrollbar-track,
      .terminal-pane-xterm .xterm-viewport::-webkit-scrollbar-corner {
        background: var(--terminal-background, var(--bg-primary, #0d1117));
      }
      .terminal-pane-xterm .xterm-viewport::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--terminal-foreground, var(--text-secondary, #8b949e)) 36%, transparent);
        border: 0;
      }
      .terminal-pane-xterm .xterm-decoration-overview-ruler {
        background: var(--terminal-background, var(--bg-primary, #0d1117));
      }
      .terminal-pane-xterm .terminal-status {
        position: absolute;
        top: 8px;
        right: 10px;
        z-index: 20;
        padding: 3px 7px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--bg-secondary, #161b22) 88%, transparent);
        border: 1px solid var(--border-color, rgba(148,163,184,.24));
        color: var(--text-secondary, #8b949e);
        font: 11px/1.3 var(--font-family-ui, system-ui, sans-serif);
        pointer-events: none;
        opacity: .82;
      }
      .terminal-pane-xterm[data-connection-status="Connected"] .terminal-status,
      .terminal-pane-xterm[data-connection-status="Connected"] .terminal-status {
        opacity: 0;
        transition: opacity .4s ease 1.4s;
      }
      .terminal-pane-xterm:focus-within .terminal-status {
        opacity: .82;
        transition-delay: 0s;
      }
      .terminal-placeholder {
        margin: auto;
        color: var(--text-secondary, #8b949e);
        font: 13px/1.5 var(--font-family-ui, system-ui, sans-serif);
        text-align: center;
      }
      .terminal-output-mirror {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: pre-wrap;
        pointer-events: none;
      }
    `;
    ownerDocument.head.appendChild(style);
  }
}

function detectDarkTheme(runtimeWindow = window, runtimeDocument = document) {
  const root = runtimeDocument?.documentElement;
  const body = runtimeDocument?.body;
  const rootTheme = root?.getAttribute?.("data-theme")?.toLowerCase?.() || "";
  if (rootTheme === "dark") return true;
  if (rootTheme === "light") return false;
  if (root?.classList?.contains("dark") || body?.classList?.contains("dark")) return true;
  if (root?.classList?.contains("light") || body?.classList?.contains("light")) return false;
  return Boolean(runtimeWindow?.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
}

function readThemeVar(name, fallback = "", runtimeDocument = document) {
  const value = getComputedStyle(runtimeDocument.documentElement).getPropertyValue(name)?.trim();
  return value || fallback;
}

function parseThemeColor(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{3}$/.test(hex) || /^[0-9a-fA-F]{6}$/.test(hex)) {
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const int = parseInt(full, 16);
    return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
  }
  const rgbMatch = raw.match(/rgba?\(\s*(\d+)[,\s]\s*(\d+)[,\s]\s*(\d+)/i);
  if (rgbMatch) return { r: parseInt(rgbMatch[1], 10), g: parseInt(rgbMatch[2], 10), b: parseInt(rgbMatch[3], 10) };
  return null;
}

function relativeLuminance(color) {
  const toLinear = (value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function toHexColor(color) {
  const clamp = (value) => Math.max(0, Math.min(255, Math.round(value || 0)));
  return `#${[color.r, color.g, color.b].map((value) => clamp(value).toString(16).padStart(2, "0")).join("")}`;
}

function getHighestContrastTextColor(background) {
  const bg = parseThemeColor(background);
  if (!bg) return "#ffffff";
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  return contrastRatio(bg, white) >= contrastRatio(bg, black) ? "#ffffff" : "#000000";
}

function mixThemeColors(base, target, amount) {
  const ratio = Math.max(0, Math.min(1, Number.isFinite(amount) ? amount : 0));
  return {
    r: base.r + ((target.r - base.r) * ratio),
    g: base.g + ((target.g - base.g) * ratio),
    b: base.b + ((target.b - base.b) * ratio),
  };
}

function ensureTerminalColorContrast(background, color, minimumRatio = 4.5) {
  const bg = parseThemeColor(background);
  const fg = parseThemeColor(color);
  if (!bg || !fg) return color;
  if (contrastRatio(bg, fg) >= minimumRatio) return toHexColor(fg);
  const targetColor = parseThemeColor(getHighestContrastTextColor(background));
  if (!targetColor) return toHexColor(fg);
  let best = targetColor;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 14; index += 1) {
    const mid = (low + high) / 2;
    const mixed = mixThemeColors(fg, targetColor, mid);
    if (contrastRatio(bg, mixed) >= minimumRatio) {
      best = mixed;
      high = mid;
    } else {
      low = mid;
    }
  }
  const result = toHexColor(best);
  const resultColor = parseThemeColor(result);
  if (resultColor && contrastRatio(bg, resultColor) >= minimumRatio) return result;
  return toHexColor(targetColor);
}

function withAlpha(hexColor, alphaHex) {
  if (!hexColor || !hexColor.startsWith("#")) return hexColor;
  const value = hexColor.slice(1);
  if (value.length === 3) return `#${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}${alphaHex}`;
  if (value.length === 6) return `#${value}${alphaHex}`;
  return hexColor;
}

export function buildTerminalTheme(runtimeWindow = window, runtimeDocument = document) {
  const isDark = detectDarkTheme(runtimeWindow, runtimeDocument);
  const palette = isDark ? DARK_TERMINAL_PALETTE : LIGHT_TERMINAL_PALETTE;
  const background = readThemeVar("--bg-terminal", readThemeVar("--bg-primary", isDark ? "#000000" : "#ffffff", runtimeDocument), runtimeDocument);
  const themeTextPrimary = readThemeVar("--text-primary", isDark ? "#e7e9ea" : "#0f1419", runtimeDocument);
  const foreground = ensureTerminalColorContrast(background, themeTextPrimary || getHighestContrastTextColor(background), 7);
  const accent = readThemeVar("--accent-color", "#1d9bf0", runtimeDocument);
  const danger = readThemeVar("--danger-color", isDark ? "#ff7b72" : "#cf222e", runtimeDocument);
  const success = readThemeVar("--success-color", isDark ? "#7ee787" : "#1a7f37", runtimeDocument);
  const hover = readThemeVar("--bg-hover", isDark ? "#1d1f23" : "#e8ebed", runtimeDocument);
  const selectionBackground = readThemeVar("--accent-soft-strong", withAlpha(accent, isDark ? "47" : "33"), runtimeDocument);

  return {
    background,
    foreground,
    cursor: ensureTerminalColorContrast(background, accent, 3),
    cursorAccent: background,
    selectionBackground,
    selectionForeground: foreground,
    black: ensureTerminalColorContrast(background, readThemeVar("--term-black", hover, runtimeDocument), 3),
    red: ensureTerminalColorContrast(background, readThemeVar("--term-red", danger, runtimeDocument), 4.5),
    green: ensureTerminalColorContrast(background, readThemeVar("--term-green", success, runtimeDocument), 4.5),
    yellow: ensureTerminalColorContrast(background, readThemeVar("--term-yellow", palette.yellow, runtimeDocument), 4.5),
    blue: ensureTerminalColorContrast(background, readThemeVar("--term-blue", accent, runtimeDocument), 4.5),
    magenta: ensureTerminalColorContrast(background, readThemeVar("--term-magenta", palette.magenta, runtimeDocument), 4.5),
    cyan: ensureTerminalColorContrast(background, readThemeVar("--term-cyan", palette.cyan, runtimeDocument), 4.5),
    white: foreground,
    brightBlack: ensureTerminalColorContrast(background, readThemeVar("--term-bright-black", palette.brightBlack, runtimeDocument), 3),
    brightRed: ensureTerminalColorContrast(background, readThemeVar("--term-bright-red", palette.brightRed, runtimeDocument), 4.5),
    brightGreen: ensureTerminalColorContrast(background, readThemeVar("--term-bright-green", palette.brightGreen, runtimeDocument), 4.5),
    brightYellow: ensureTerminalColorContrast(background, readThemeVar("--term-bright-yellow", palette.brightYellow, runtimeDocument), 4.5),
    brightBlue: ensureTerminalColorContrast(background, readThemeVar("--term-bright-blue", palette.brightBlue, runtimeDocument), 4.5),
    brightMagenta: ensureTerminalColorContrast(background, readThemeVar("--term-bright-magenta", palette.brightMagenta, runtimeDocument), 4.5),
    brightCyan: ensureTerminalColorContrast(background, readThemeVar("--term-bright-cyan", palette.brightCyan, runtimeDocument), 4.5),
    brightWhite: foreground,
  };
}

export function buildTerminalWebSocketUrl(path, handoffToken = null, clientToken = null, runtimeWindow = window) {
  const protocol = runtimeWindow.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${runtimeWindow.location.host}${path || "/terminal/ws"}`);
  if (handoffToken) url.searchParams.set("handoff", String(handoffToken));
  if (clientToken) url.searchParams.set("client", String(clientToken));
  return url.toString();
}

function createTerminalClientToken(runtimeWindow = window) {
  try {
    if (typeof runtimeWindow?.crypto?.randomUUID === "function") return runtimeWindow.crypto.randomUUID();
  } catch (error) {
    console.debug("[terminal-pane] randomUUID unavailable", error);
  }
  return `terminal-client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getOrCreateAnonymousTerminalClientToken(runtimeWindow = window) {
  if (!runtimeWindow) return null;
  try {
    const storage = runtimeWindow.localStorage;
    const existing = typeof storage?.getItem === "function" ? String(storage.getItem(TERMINAL_ANON_CLIENT_STORAGE_KEY) || "").trim() : "";
    if (existing) return existing;
    const created = createTerminalClientToken(runtimeWindow);
    storage?.setItem?.(TERMINAL_ANON_CLIENT_STORAGE_KEY, created);
    return created;
  } catch {
    return createTerminalClientToken(runtimeWindow);
  }
}

async function fetchTerminalSession(clientToken = getOrCreateAnonymousTerminalClientToken()) {
  const response = await fetch("/terminal/session", {
    method: "GET",
    credentials: "same-origin",
    headers: clientToken ? { [TERMINAL_ANON_CLIENT_HEADER]: clientToken } : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
  return body;
}

async function requestTerminalHandoff(clientToken = getOrCreateAnonymousTerminalClientToken()) {
  const response = await fetch("/terminal/handoff", {
    method: "POST",
    credentials: "same-origin",
    headers: clientToken ? { [TERMINAL_ANON_CLIENT_HEADER]: clientToken } : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
  return typeof body?.handoff?.token === "string" && body.handoff.token.trim() ? body.handoff.token.trim() : null;
}

async function ensureFontsReady(ownerDocument = document) {
  if (!ownerDocument || !("fonts" in ownerDocument) || !ownerDocument.fonts) return;
  if (!fontsReadyPromise) {
    fontsReadyPromise = Promise.allSettled([
      ownerDocument.fonts.load('400 13px "FiraCode Nerd Font Mono"'),
      ownerDocument.fonts.load('700 13px "FiraCode Nerd Font Mono"'),
      ownerDocument.fonts.ready,
    ]).then(() => undefined).catch(() => undefined);
  }
  await fontsReadyPromise;
}

async function importAddon(name) {
  return import(asset(`addon-${name}.mjs`));
}

async function importCanvasAddon() {
  await import(asset("addon-canvas.js"));
  return globalThis.CanvasAddon || globalThis.canvasAddon || null;
}

async function loadXtermRuntime() {
  if (xtermRuntimePromise) return xtermRuntimePromise;
  xtermRuntimePromise = (async () => {
    const [xterm, fit, ligatures, webgl, clipboard, image, search, serialize, unicode11, webLinks, progress, unicodeGraphemes, attach] = await Promise.all([
      import(asset("xterm.mjs")),
      importAddon("fit"),
      importAddon("ligatures"),
      importAddon("webgl"),
      importAddon("clipboard"),
      importAddon("image"),
      importAddon("search"),
      importAddon("serialize"),
      importAddon("unicode11"),
      importAddon("web-links"),
      importAddon("progress"),
      importAddon("unicode-graphemes"),
      importAddon("attach"),
    ]);
    const canvas = await importCanvasAddon().catch(() => null);
    return { xterm, fit, ligatures, webgl, canvas, clipboard, image, search, serialize, unicode11, webLinks, progress, unicodeGraphemes, attach };
  })().catch((error) => {
    xtermRuntimePromise = null;
    throw error;
  });
  return xtermRuntimePromise;
}

function getTerminalFontFamily(runtimeDocument = document) {
  try {
    const token = getComputedStyle(runtimeDocument.documentElement).getPropertyValue("--font-family-terminal")?.trim();
    return token || TERMINAL_FONT_FAMILY;
  } catch {
    return TERMINAL_FONT_FAMILY;
  }
}

function normalizeShortcutCode(event) {
  const code = String(event?.code || "").trim().toLowerCase();
  if (code) return code;
  const key = String(event?.key || "").trim().toLowerCase();
  if (key.length === 1 && /[a-z]/.test(key)) return `key${key}`;
  return key;
}

function isCopyShortcut(event) {
  return Boolean(event?.shiftKey && !event?.altKey && (event?.ctrlKey || event?.metaKey) && normalizeShortcutCode(event) === "keyc");
}

function isPasteShortcut(event) {
  if (event?.shiftKey && !event?.ctrlKey && !event?.metaKey && !event?.altKey && normalizeShortcutCode(event) === "insert") return true;
  return Boolean(event?.shiftKey && !event?.altKey && (event?.ctrlKey || event?.metaKey) && normalizeShortcutCode(event) === "keyv");
}

function isFindShortcut(event) {
  return Boolean(event?.shiftKey && !event?.altKey && (event?.ctrlKey || event?.metaKey) && normalizeShortcutCode(event) === "keyf");
}

function getPreferredRenderer(runtimeWindow = window) {
  try {
    const value = String(runtimeWindow.localStorage?.getItem(RENDERER_STORAGE_KEY) || "").trim().toLowerCase();
    if (value === "webgl") return "webgl";
  } catch (error) {
    console.debug("[terminal-pane] renderer preference unavailable", error);
  }
  return "canvas";
}

class TerminalPaneInstance {
  constructor(container, context = {}) {
    this.container = container;
    this.context = context;
    this.ownerDocument = container.ownerDocument || document;
    this.ownerWindow = this.ownerDocument.defaultView || window;
    this.disposed = false;
    this.resizeFrame = 0;
    this.resizeObserver = null;
    this.themeObserver = null;
    this.themeChangeListener = null;
    this.mediaQuery = null;
    this.mediaQueryListener = null;
    this.resizeListener = null;
    this.socket = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.manualSocketClose = false;
    this.terminalExited = false;
    this.inputDisposable = null;
    this.resizeDisposable = null;
    this.terminal = null;
    this.fitAddon = null;
    this.searchAddon = null;
    this.serializeAddon = null;
    this.rendererAddon = null;
    this.outputMirror = null;
    this.outputMirrorText = "";
    this.kittyGraphicsState = createKittyGraphicsState();
    this.loadedAddons = [];
    this.pendingHandoffToken = typeof context?.transferState?.handoffToken === "string" && context.transferState.handoffToken.trim()
      ? context.transferState.handoffToken.trim()
      : null;
    this.standbyHandoffToken = null;
    this.standbyHandoffRequest = null;

    injectStyles(this.ownerDocument);

    this.root = this.ownerDocument.createElement("div");
    this.root.className = "terminal-pane-xterm";
    this.root.tabIndex = 0;
    this.body = this.ownerDocument.createElement("div");
    this.body.className = "terminal-body";
    this.body.innerHTML = '<div class="terminal-placeholder">Bootstrapping xterm.js…</div>';
    this.status = this.ownerDocument.createElement("span");
    this.status.className = "terminal-status";
    this.status.textContent = "Loading…";
    this.root.append(this.body, this.status);
    container.appendChild(this.root);

    void this.bootstrap();
  }

  setStatus(message) {
    this.status.textContent = message;
    this.root.dataset.connectionStatus = message;
    this.root.setAttribute("aria-label", `Terminal ${message}`);
  }

  async bootstrap() {
    try {
      const runtime = await loadXtermRuntime();
      await ensureFontsReady(this.ownerDocument);
      if (this.disposed) return;

      const { Terminal } = runtime.xterm;
      const terminal = new Terminal({
        allowProposedApi: true,
        convertEol: false,
        cursorBlink: true,
        cursorStyle: "block",
        drawBoldTextInBrightColors: true,
        fontFamily: getTerminalFontFamily(this.ownerDocument),
        fontSize: 13,
        lineHeight: 1.12,
        overviewRuler: { width: 0 },
        scrollback: 10_000,
        tabStopWidth: 8,
        theme: buildTerminalTheme(this.ownerWindow, this.ownerDocument),
        windowsMode: false,
      });

      this.terminal = terminal;
      this.installPreOpenAddons(runtime);

      this.body.innerHTML = "";
      this.host = this.ownerDocument.createElement("div");
      this.host.className = "terminal-host";
      this.body.appendChild(this.host);
      terminal.open(this.host);
      this.installOutputMirror();
      this.installPostOpenAddons(runtime);
      this.installClipboardAndSearchShortcuts();
      this.installResizeSync();
      this.installThemeSync();
      this.scheduleResize(true);
      this.queueResizeRetries();

      await this.connectBackend();
    } catch (error) {
      console.error("[terminal-pane] failed to bootstrap xterm.js", error);
      if (!this.disposed) {
        this.body.innerHTML = `<div class="terminal-placeholder">Terminal failed to load: ${String(error?.message || error)}</div>`;
        this.setStatus("Load failed");
      }
    }
  }

  loadAddon(addon, name) {
    if (!addon || !this.terminal) return null;
    try {
      this.terminal.loadAddon(addon);
      this.loadedAddons.push(name);
      return addon;
    } catch (error) {
      console.warn(`[terminal-pane] failed to load xterm addon ${name}`, error);
      return null;
    }
  }

  installPreOpenAddons(runtime) {
    const terminal = this.terminal;
    if (!terminal) return;

    this.fitAddon = this.loadAddon(new runtime.fit.FitAddon(), "fit");

    this.loadAddon(new runtime.unicode11.Unicode11Addon(), "unicode11");
    this.loadAddon(new runtime.unicodeGraphemes.UnicodeGraphemesAddon(), "unicode-graphemes");
    try {
      terminal.unicode.activeVersion = "15-graphemes";
    } catch {
      try { terminal.unicode.activeVersion = "11"; } catch (error) { debugTerminalCleanup("unicode fallback", error); }
    }

    this.loadAddon(new runtime.webLinks.WebLinksAddon(), "web-links");
    this.searchAddon = this.loadAddon(new runtime.search.SearchAddon(), "search");
    this.serializeAddon = this.loadAddon(new runtime.serialize.SerializeAddon(), "serialize");
    this.loadAddon(new runtime.progress.ProgressAddon(), "progress");

    try {
      const provider = typeof runtime.clipboard.BrowserClipboardProvider === "function"
        ? new runtime.clipboard.BrowserClipboardProvider()
        : undefined;
      this.loadAddon(new runtime.clipboard.ClipboardAddon(undefined, provider), "clipboard");
    } catch (error) {
      console.warn("[terminal-pane] clipboard addon unavailable", error);
    }

    try {
      this.loadAddon(new runtime.image.ImageAddon({ enableSizeReports: true, pixelLimit: 16_777_216, storageLimit: 10 }), "image");
    } catch (error) {
      console.warn("[terminal-pane] image addon unavailable", error);
    }

    // AttachAddon is intentionally not activated: Piclaw's terminal socket uses
    // JSON control frames rather than a raw PTY byte stream. Keep it vendored and
    // import-validated with the rest of the xterm family.
    this.attachAddonModule = runtime.attach;
  }

  installOutputMirror() {
    if (!this.host || this.outputMirror) return;
    const mirror = this.ownerDocument.createElement("pre");
    mirror.className = "terminal-output-mirror";
    mirror.setAttribute("data-testid", "terminal-output");
    mirror.setAttribute("aria-hidden", "true");
    this.outputMirror = mirror;
    const textLayer = this.host.querySelector?.(".xterm-screen") || this.host.querySelector?.(".xterm") || this.host;
    textLayer.insertBefore(mirror, textLayer.firstChild);
  }

  appendOutputMirror(data) {
    if (!this.outputMirror) return;
    const next = `${this.outputMirrorText}${stripTerminalControl(data)}`;
    this.outputMirrorText = next.length > 65_536 ? next.slice(-65_536) : next;
    this.outputMirror.textContent = this.outputMirrorText;
  }

  installPostOpenAddons(runtime) {
    this.loadAddon(new runtime.ligatures.LigaturesAddon(), "ligatures");
    // Renderer add-ons should be activated after ligatures so the renderer can
    // pick up font-feature settings and the already-open terminal dimensions.
    this.installRendererAddon(runtime);
  }

  installRendererAddon(runtime) {
    const preferred = getPreferredRenderer(this.ownerWindow);
    if (preferred === "webgl") {
      try {
        const addon = new runtime.webgl.WebglAddon(false);
        addon.onContextLoss?.(() => {
          console.warn("[terminal-pane] WebGL context lost; disposing renderer addon.");
          try { addon.dispose(); } catch (error) { debugTerminalCleanup("webgl dispose after context loss", error); }
        });
        this.rendererAddon = this.loadAddon(addon, "webgl");
        if (this.rendererAddon) return;
      } catch (error) {
        console.warn("[terminal-pane] webgl renderer unavailable; falling back to canvas", error);
      }
    }

    const CanvasAddon = runtime.canvas?.CanvasAddon || runtime.canvas?.default?.CanvasAddon || null;
    if (typeof CanvasAddon === "function") {
      try {
        this.rendererAddon = this.loadAddon(new CanvasAddon(), "canvas");
        if (this.rendererAddon) return;
      } catch (error) {
        console.warn("[terminal-pane] canvas renderer unavailable; using xterm default renderer", error);
      }
    }
  }

  installClipboardAndSearchShortcuts() {
    const terminal = this.terminal;
    if (!terminal?.attachCustomKeyEventHandler) return;
    terminal.attachCustomKeyEventHandler((event) => {
      if (isCopyShortcut(event)) {
        try {
          const selected = typeof terminal.getSelection === "function" ? String(terminal.getSelection() || "") : "";
          if (selected) void this.ownerWindow.navigator?.clipboard?.writeText?.(selected);
        } catch (error) {
          console.debug("[terminal-pane] copy shortcut failed", error);
        }
        return true;
      }
      if (isPasteShortcut(event)) {
        if (typeof this.ownerWindow.navigator?.clipboard?.readText === "function") {
          void this.ownerWindow.navigator.clipboard.readText().then((text) => {
            if (!this.disposed && text) terminal.paste?.(text);
          }).catch((error) => console.debug("[terminal-pane] paste shortcut failed", error));
          return true;
        }
      }
      if (isFindShortcut(event)) {
        const query = this.ownerWindow.prompt?.("Find in terminal buffer", "");
        if (query) this.searchAddon?.findNext?.(query);
        return true;
      }
      return undefined;
    });
  }

  applyTheme() {
    if (!this.terminal) return;
    const theme = buildTerminalTheme(this.ownerWindow, this.ownerDocument);
    this.terminal.options.theme = theme;
    this.root.style.setProperty("--terminal-background", theme.background);
    this.root.style.setProperty("--terminal-foreground", theme.foreground);
    this.root.style.backgroundColor = theme.background;
    this.root.style.color = theme.foreground;
    if (this.body) this.body.style.backgroundColor = theme.background;
    if (this.host) {
      this.host.style.backgroundColor = theme.background;
      const xtermElement = this.host.querySelector?.(".xterm");
      if (xtermElement) {
        xtermElement.style.backgroundColor = theme.background;
        xtermElement.style.color = theme.foreground;
      }
    }
    try { this.terminal.refresh?.(0, this.terminal.rows - 1); } catch (error) { debugTerminalCleanup("terminal refresh", error); }
    this.scheduleResize(true);
  }

  installThemeSync() {
    const sync = () => this.ownerWindow.requestAnimationFrame(() => this.applyTheme());
    this.themeChangeListener = sync;
    this.ownerWindow.addEventListener("piclaw-theme-change", sync);
    this.mediaQuery = this.ownerWindow.matchMedia?.("(prefers-color-scheme: dark)");
    this.mediaQueryListener = sync;
    if (this.mediaQuery?.addEventListener) this.mediaQuery.addEventListener("change", sync);
    else if (this.mediaQuery?.addListener) this.mediaQuery.addListener(sync);
    this.themeObserver = typeof MutationObserver !== "undefined" ? new MutationObserver(sync) : null;
    this.themeObserver?.observe(this.ownerDocument.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    if (this.ownerDocument.body) this.themeObserver?.observe(this.ownerDocument.body, { attributes: true, attributeFilter: ["class", "data-theme"] });
    sync();
  }

  installResizeSync() {
    this.resizeListener = () => this.scheduleResize();
    this.ownerWindow.addEventListener("resize", this.resizeListener);
    this.ownerWindow.addEventListener("dock-resize", this.resizeListener);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
      this.resizeObserver.observe(this.container);
      this.resizeObserver.observe(this.root);
      this.resizeObserver.observe(this.body);
    }
  }

  scheduleResize(force = false) {
    if (this.disposed) return;
    if (this.resizeFrame) this.ownerWindow.cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = this.ownerWindow.requestAnimationFrame(() => {
      this.resizeFrame = 0;
      this.resize(force);
    });
  }

  queueResizeRetries(delays = [24, 72, 160, 320, 640]) {
    for (const delay of delays) {
      this.ownerWindow.setTimeout(() => {
        if (!this.disposed) this.scheduleResize(true);
      }, delay);
    }
  }

  resize(_force = false) {
    if (!this.terminal) return;
    try { this.fitAddon?.fit?.(); } catch (error) { console.debug("[terminal-pane] fit failed", error); }
    this.sendResize();
  }

  sendResize() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.terminal) return;
    const cols = this.terminal.cols;
    const rows = this.terminal.rows;
    if (cols > 0 && rows > 0) this.socket.send(JSON.stringify({ type: "resize", cols, rows }));
  }

  async ensureStandbyHandoffToken(force = false) {
    if (this.disposed) return null;
    if (!force && this.standbyHandoffToken) return this.standbyHandoffToken;
    if (this.standbyHandoffRequest) return await this.standbyHandoffRequest;
    this.standbyHandoffRequest = requestTerminalHandoff()
      .then((token) => {
        if (token && !this.disposed) this.standbyHandoffToken = token;
        return token || null;
      })
      .catch((error) => {
        console.warn("[terminal-pane] failed to prepare handoff token", error);
        return null;
      })
      .finally(() => { this.standbyHandoffRequest = null; });
    return await this.standbyHandoffRequest;
  }

  consumeStandbyHandoffToken() {
    const token = this.standbyHandoffToken || null;
    this.standbyHandoffToken = null;
    return token;
  }

  installTerminalSocketBridge() {
    const terminal = this.terminal;
    if (!terminal || this.inputDisposable || this.resizeDisposable) return;
    this.inputDisposable = terminal.onData((data) => {
      const socket = this.socket;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
    });
    this.resizeDisposable = terminal.onResize(({ cols, rows }) => {
      const socket = this.socket;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", cols, rows }));
    });
  }

  clearHeartbeat() {
    if (!this.heartbeatTimer) return;
    this.ownerWindow.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  startHeartbeat() {
    this.clearHeartbeat();
    this.heartbeatTimer = this.ownerWindow.setInterval(() => {
      if (this.disposed || this.terminalExited) return;
      const socket = this.socket;
      if (socket?.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      } catch (error) {
        console.debug("[terminal-pane] heartbeat send failed", error);
      }
    }, TERMINAL_HEARTBEAT_MS);
  }

  clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    this.ownerWindow.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  scheduleReconnect(reason = "socket close") {
    if (this.disposed || this.terminalExited) return;
    this.clearHeartbeat();
    this.clearReconnectTimer();
    const index = Math.min(this.reconnectAttempt, TERMINAL_RECONNECT_DELAYS_MS.length - 1);
    const delay = TERMINAL_RECONNECT_DELAYS_MS[index];
    this.reconnectAttempt += 1;
    this.setStatus(`Reconnecting…`);
    this.reconnectTimer = this.ownerWindow.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed || this.terminalExited) return;
      console.info("[terminal-pane] reconnecting terminal websocket", { reason, attempt: this.reconnectAttempt });
      void this.connectBackend({ reconnect: true });
    }, delay);
  }

  async connectBackend(options = {}) {
    const terminal = this.terminal;
    if (!terminal) return;
    this.installTerminalSocketBridge();
    try {
      const clientToken = getOrCreateAnonymousTerminalClientToken(this.ownerWindow);
      const session = await fetchTerminalSession(clientToken);
      if (this.disposed) return;
      if (!session?.enabled) {
        terminal.write(`Terminal backend unavailable: ${session?.error || "disabled"}\r\n`);
        this.setStatus("Unavailable");
        return;
      }

      const handoffToken = this.pendingHandoffToken || null;
      const socket = new WebSocket(buildTerminalWebSocketUrl(session.ws_path || "/terminal/ws", handoffToken, clientToken, this.ownerWindow));
      this.socket = socket;
      this.manualSocketClose = false;
      this.setStatus(handoffToken ? "Transferring…" : options.reconnect ? "Reconnecting…" : "Connecting…");

      socket.addEventListener("open", () => {
        if (this.disposed) return;
        this.reconnectAttempt = 0;
        this.clearReconnectTimer();
        this.startHeartbeat();
        if (handoffToken && this.pendingHandoffToken === handoffToken) this.pendingHandoffToken = null;
        void this.ensureStandbyHandoffToken(false);
        this.setStatus("Connected");
        terminal.focus();
        this.scheduleResize(true);
        this.queueResizeRetries([24, 72, 160, 320]);
      });

      socket.addEventListener("message", (event) => this.handleSocketMessage(event));
      socket.addEventListener("close", (event) => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.clearHeartbeat();
        if (this.disposed || this.manualSocketClose || this.terminalExited) return;
        console.warn("[terminal-pane] terminal websocket closed; scheduling reconnect", { code: event.code, reason: event.reason });
        this.scheduleReconnect(event.reason || `close ${event.code}`);
      });
      socket.addEventListener("error", () => {
        if (this.disposed || this.terminalExited) return;
        this.setStatus("Connection error");
      });
    } catch (error) {
      if (options.reconnect) {
        console.warn("[terminal-pane] reconnect failed", error);
        this.scheduleReconnect(error instanceof Error ? error.message : String(error));
        return;
      }
      terminal.write(`Terminal backend unavailable: ${error instanceof Error ? error.message : String(error)}\r\n`);
      this.setStatus("Unavailable");
    }
  }

  handleSocketMessage(event) {
    if (this.disposed || !this.terminal) return;
    let payload;
    try { payload = JSON.parse(String(event.data)); }
    catch { payload = { type: "output", data: String(event.data) }; }

    if (payload?.type === "session") {
      this.terminal.__piclawSessionMeta = {
        sessionId: typeof payload.session_id === "string" ? payload.session_id : null,
        createdAt: typeof payload.created_at === "string" ? payload.created_at : null,
        processPid: typeof payload.process_pid === "number" ? payload.process_pid : null,
      };
      void this.ensureStandbyHandoffToken(false);
      return;
    }
    if (payload?.type === "output" && typeof payload.data === "string") {
      const writes = translateKittyGraphicsOutput(this.kittyGraphicsState, payload.data);
      for (const write of writes) {
        this.appendOutputMirror(write);
        this.terminal.write(write);
      }
      return;
    }
    if (payload?.type === "exit") {
      this.terminalExited = true;
      this.clearHeartbeat();
      this.clearReconnectTimer();
      this.appendOutputMirror("\r\n[terminal exited]\r\n");
      this.terminal.write("\r\n[terminal exited]\r\n");
      this.setStatus("Exited");
    }
  }

  beforeDetachFromHost() {
    this.setStatus("Moving…");
  }

  afterAttachToHost(context = {}) {
    const token = typeof context?.transferState?.handoffToken === "string" && context.transferState.handoffToken.trim()
      ? context.transferState.handoffToken.trim()
      : null;
    if (token) this.pendingHandoffToken = token;
    this.scheduleResize(true);
    this.queueResizeRetries();
    this.ownerWindow.requestAnimationFrame(() => this.focus());
  }

  moveHost(_container) {
    return false;
  }

  exportHostTransferState() {
    const handoffToken = this.standbyHandoffToken || this.pendingHandoffToken || null;
    return handoffToken ? { kind: "terminal", live: false, handoffToken } : null;
  }

  async preparePopoutTransfer() {
    let handoffToken = this.consumeStandbyHandoffToken();
    if (!handoffToken) {
      await this.ensureStandbyHandoffToken(true);
      handoffToken = this.consumeStandbyHandoffToken();
    }
    if (!handoffToken) return null;
    this.pendingHandoffToken = handoffToken;
    return { terminal_handoff: handoffToken };
  }

  getContent() {
    try { return this.serializeAddon?.serialize?.(); } catch { return undefined; }
  }

  isDirty() { return false; }

  focus() {
    try { this.terminal?.focus?.(); } catch { this.root?.focus?.(); }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.resizeFrame) this.ownerWindow.cancelAnimationFrame(this.resizeFrame);
    this.manualSocketClose = true;
    this.clearHeartbeat();
    this.clearReconnectTimer();
    try { this.inputDisposable?.dispose?.(); } catch (error) { debugTerminalCleanup("input disposable cleanup", error); }
    try { this.resizeDisposable?.dispose?.(); } catch (error) { debugTerminalCleanup("resize disposable cleanup", error); }
    try { this.socket?.close?.(); } catch (error) { debugTerminalCleanup("socket close", error); }
    try { this.resizeObserver?.disconnect?.(); } catch (error) { debugTerminalCleanup("resize observer cleanup", error); }
    try { this.themeObserver?.disconnect?.(); } catch (error) { debugTerminalCleanup("theme observer cleanup", error); }
    if (this.resizeListener) {
      this.ownerWindow.removeEventListener("resize", this.resizeListener);
      this.ownerWindow.removeEventListener("dock-resize", this.resizeListener);
    }
    if (this.themeChangeListener) this.ownerWindow.removeEventListener("piclaw-theme-change", this.themeChangeListener);
    if (this.mediaQuery && this.mediaQueryListener) {
      if (this.mediaQuery.removeEventListener) this.mediaQuery.removeEventListener("change", this.mediaQueryListener);
      else if (this.mediaQuery.removeListener) this.mediaQuery.removeListener(this.mediaQueryListener);
    }
    try { this.rendererAddon?.dispose?.(); } catch (error) { debugTerminalCleanup("renderer addon cleanup", error); }
    try { this.fitAddon?.dispose?.(); } catch (error) { debugTerminalCleanup("fit addon cleanup", error); }
    try { this.terminal?.dispose?.(); } catch (error) { debugTerminalCleanup("terminal cleanup", error); }
    this.root?.remove?.();
  }
}

export const terminalPaneExtension = {
  id: "terminal",
  label: "Terminal",
  icon: "terminal",
  capabilities: ["terminal"],
  placement: "dock",
  mount(container, context) {
    return new TerminalPaneInstance(container, context);
  },
};

export const terminalTabPaneExtension = {
  id: "terminal-tab",
  label: "Terminal",
  icon: "terminal",
  capabilities: ["terminal"],
  placement: "tabs",
  canHandle(context) {
    return context?.path === TERMINAL_TAB_PATH ? 10_000 : false;
  },
  mount(container, context) {
    return new TerminalPaneInstance(container, context);
  },
};

export function isCoreTerminalRenderer() {
  return true;
}
