// @ts-nocheck
/**
 * terminal-pane.ts — Terminal dock pane extension.
 *
 * Bootstraps the vendored ghostty-web frontend and connects it to the
 * authenticated web terminal backend when available.
 */

import type { WebPaneExtension, PaneContext, PaneInstance, PaneCapability } from './pane-types.js';
import { consumePanePopoutTransferToken } from './editor-popout-transfer.js';
import {
    clearContainerContentBestEffort,
    detachTerminalHostListenersBestEffort,
    disposeTerminalRuntimeBestEffort,
    resizeTerminalRuntimeBestEffort,
} from './terminal-lifecycle-runtime.js';
import { applyTerminalThemeBestEffort } from './terminal-theme-runtime.js';

const GHOSTTY_WEB_MODULE = '/static/js/vendor/ghostty-web.js';
const GHOSTTY_WASM_MODULE = '/static/js/vendor/ghostty-vt.wasm';
export const TERMINAL_TAB_PATH = 'piclaw://terminal';
const TERMINAL_FONT_FAMILY = 'FiraCode Nerd Font Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const TERMINAL_FONT_LOAD_SPEC = '400 13px "FiraCode Nerd Font Mono"';
const TERMINAL_FONT_LOAD_SPEC_BOLD = '700 13px "FiraCode Nerd Font Mono"';
const LIGHT_TERMINAL_PALETTE = {
    yellow: '#9a6700',
    magenta: '#8250df',
    cyan: '#1b7c83',
    brightBlack: '#57606a',
    brightRed: '#cf222e',
    brightGreen: '#1a7f37',
    brightYellow: '#bf8700',
    brightBlue: '#0550ae',
    brightMagenta: '#6f42c1',
    brightCyan: '#0a7b83',
};
const DARK_TERMINAL_PALETTE = {
    yellow: '#d29922',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    brightBlack: '#8b949e',
    brightRed: '#ff7b72',
    brightGreen: '#7ee787',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
};

let ghosttyInitPromise = null;
let terminalFontsReadyPromise = null;

function shouldRewriteGhosttyWasmRequest(url) {
    if (!url) return false;
    return url.startsWith('data:application/wasm') || /(^|\/)ghostty-vt\.wasm(?:[?#].*)?$/.test(url);
}

async function withGhosttyWasmFetchShim(run) {
    const originalFetch = globalThis.fetch?.bind(globalThis);
    if (!originalFetch) {
        return await run();
    }
    const wasmUrl = new URL(GHOSTTY_WASM_MODULE, window.location.origin).href;
    const patchedFetch = (input, init) => {
        const requestUrl = input instanceof Request
            ? input.url
            : input instanceof URL
                ? input.href
                : String(input);
        if (!shouldRewriteGhosttyWasmRequest(requestUrl)) {
            return originalFetch(input, init);
        }
        if (input instanceof Request) {
            return originalFetch(new Request(wasmUrl, input));
        }
        return originalFetch(wasmUrl, init);
    };
    globalThis.fetch = patchedFetch;
    try {
        return await run();
    } finally {
        globalThis.fetch = originalFetch;
    }
}

async function loadGhosttyWeb() {
    const moduleUrl = new URL(GHOSTTY_WEB_MODULE, window.location.origin).href;
    const mod = await import(moduleUrl);
    if (!ghosttyInitPromise) {
        ghosttyInitPromise = withGhosttyWasmFetchShim(() => Promise.resolve(mod.init?.())).catch((error) => {
            ghosttyInitPromise = null;
            throw error;
        });
    }
    await ghosttyInitPromise;
    return mod;
}

async function ensureTerminalFontsReady() {
    if (typeof document === 'undefined' || !('fonts' in document) || !document.fonts) {
        return;
    }
    if (!terminalFontsReadyPromise) {
        terminalFontsReadyPromise = Promise.allSettled([
            document.fonts.load(TERMINAL_FONT_LOAD_SPEC),
            document.fonts.load(TERMINAL_FONT_LOAD_SPEC_BOLD),
            document.fonts.ready,
        ]).then(() => undefined).catch(() => undefined);
    }
    await terminalFontsReadyPromise;
}

async function fetchTerminalSession() {
    const response = await fetch('/terminal/session', {
        method: 'GET',
        credentials: 'same-origin',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body?.error || `HTTP ${response.status}`);
    }
    return body;
}

async function requestTerminalHandoff() {
    const response = await fetch('/terminal/handoff', {
        method: 'POST',
        credentials: 'same-origin',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body?.error || `HTTP ${response.status}`);
    }
    return typeof body?.handoff?.token === 'string' && body.handoff.token.trim()
        ? body.handoff.token.trim()
        : null;
}

function buildTerminalWebSocketUrl(path, handoffToken = null) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = new URL(`${protocol}//${window.location.host}${path}`);
    if (handoffToken) {
        url.searchParams.set('handoff', String(handoffToken));
    }
    return url.toString();
}

function detectDarkTheme(runtimeWindow = typeof window !== 'undefined' ? window : null, runtimeDocument = typeof document !== 'undefined' ? document : null) {
    if (!runtimeWindow || !runtimeDocument) return false;
    const root = runtimeDocument.documentElement;
    const body = runtimeDocument.body;
    const rootTheme = root?.getAttribute?.('data-theme')?.toLowerCase?.() || '';
    if (rootTheme === 'dark') return true;
    if (rootTheme === 'light') return false;
    if (root?.classList?.contains('dark') || body?.classList?.contains('dark')) return true;
    if (root?.classList?.contains('light') || body?.classList?.contains('light')) return false;
    return Boolean(runtimeWindow.matchMedia?.('(prefers-color-scheme: dark)')?.matches);
}

function readThemeVar(name, fallback = '', runtimeDocument = typeof document !== 'undefined' ? document : null) {
    if (!runtimeDocument) return fallback;
    const value = getComputedStyle(runtimeDocument.documentElement).getPropertyValue(name)?.trim();
    return value || fallback;
}

function parseThemeColor(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const hex = raw.startsWith('#') ? raw.slice(1) : raw;
    if (/^[0-9a-fA-F]{3}$/.test(hex) || /^[0-9a-fA-F]{6}$/.test(hex)) {
        const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
        const int = parseInt(full, 16);
        return {
            r: (int >> 16) & 255,
            g: (int >> 8) & 255,
            b: int & 255,
        };
    }
    const rgbMatch = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgbMatch) {
        return {
            r: parseInt(rgbMatch[1], 10),
            g: parseInt(rgbMatch[2], 10),
            b: parseInt(rgbMatch[3], 10),
        };
    }
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
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

function getHighestContrastTextColor(background) {
    const bg = parseThemeColor(background);
    if (!bg) return '#ffffff';
    const white = { r: 255, g: 255, b: 255 };
    const black = { r: 0, g: 0, b: 0 };
    return contrastRatio(bg, white) >= contrastRatio(bg, black) ? '#ffffff' : '#000000';
}

function withAlpha(hexColor, alphaHex) {
    if (!hexColor || !hexColor.startsWith('#')) return hexColor;
    const value = hexColor.slice(1);
    if (value.length === 3) {
        return `#${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}${alphaHex}`;
    }
    if (value.length === 6) {
        return `#${value}${alphaHex}`;
    }
    return hexColor;
}

export function buildTerminalTheme(runtimeWindow = typeof window !== 'undefined' ? window : null, runtimeDocument = typeof document !== 'undefined' ? document : null) {
    const isDark = detectDarkTheme(runtimeWindow, runtimeDocument);
    const palette = isDark ? DARK_TERMINAL_PALETTE : LIGHT_TERMINAL_PALETTE;
    const background = readThemeVar('--bg-primary', isDark ? '#000000' : '#ffffff', runtimeDocument);
    const foreground = getHighestContrastTextColor(background);
    const secondary = readThemeVar('--text-secondary', isDark ? '#71767b' : '#536471', runtimeDocument);
    const accent = readThemeVar('--accent-color', '#1d9bf0', runtimeDocument);
    const danger = readThemeVar('--danger-color', isDark ? '#ff7b72' : '#cf222e', runtimeDocument);
    const success = readThemeVar('--success-color', isDark ? '#7ee787' : '#1a7f37', runtimeDocument);
    const hover = readThemeVar('--bg-hover', isDark ? '#1d1f23' : '#e8ebed', runtimeDocument);
    const border = readThemeVar('--border-color', isDark ? '#2f3336' : '#eff3f4', runtimeDocument);
    const selectionBackground = readThemeVar('--accent-soft-strong', withAlpha(accent, isDark ? '47' : '33'), runtimeDocument);

    return {
        background,
        foreground,
        cursor: accent,
        cursorAccent: background,
        selectionBackground,
        selectionForeground: foreground,
        black: hover,
        red: danger,
        green: success,
        yellow: palette.yellow,
        blue: accent,
        magenta: palette.magenta,
        cyan: palette.cyan,
        white: foreground,
        brightBlack: palette.brightBlack,
        brightRed: palette.brightRed,
        brightGreen: palette.brightGreen,
        brightYellow: palette.brightYellow,
        brightBlue: palette.brightBlue,
        brightMagenta: palette.brightMagenta,
        brightCyan: palette.brightCyan,
        brightWhite: foreground,
    };
}

export function relocateTerminalPaneRoot(root: HTMLElement | null | undefined, container: HTMLElement | null | undefined): boolean {
    if (!root || !container || typeof container.appendChild !== 'function') return false;
    clearContainerContentBestEffort(container);
    container.appendChild(root);
    return true;
}

class TerminalPaneInstance implements PaneInstance {
    private container: HTMLElement;
    private ownerDocument: Document;
    private ownerWindow: Window & typeof globalThis;
    private disposed = false;
    private termEl: HTMLElement;
    private bodyEl: HTMLElement;
    private statusEl: HTMLElement;
    private terminal = null;
    private fitAddon = null;
    private socket = null;
    private themeObserver = null;
    private themeChangeListener = null;
    private mediaQuery = null;
    private mediaQueryListener = null;
    private resizeObserver = null;
    private dockResizeListener = null;
    private windowResizeListener = null;
    private resizeFrame = 0;
    private resizeRetryTimers = new Set<number>();
    private lastAppliedThemeSignature = null;
    private lastResizeSignature: string | null = null;
    private pendingHandoffToken: string | null = null;
    private standbyHandoffToken: string | null = null;
    private standbyHandoffRequest: Promise<string | null> | null = null;

    constructor(container: HTMLElement, context: PaneContext) {
        this.container = container;
        this.ownerDocument = container.ownerDocument || document;
        this.ownerWindow = (this.ownerDocument.defaultView || window) as Window & typeof globalThis;
        const transferHandoffToken = typeof context?.transferState?.handoffToken === 'string' && context.transferState.handoffToken.trim()
            ? context.transferState.handoffToken.trim()
            : null;
        const popoutHandoffToken = consumePanePopoutTransferToken('terminal_handoff');
        this.pendingHandoffToken = transferHandoffToken || popoutHandoffToken || null;

        this.termEl = this.ownerDocument.createElement('div');
        this.termEl.className = 'terminal-pane-content';
        this.termEl.setAttribute('tabindex', '0');

        this.statusEl = this.ownerDocument.createElement('span');
        this.statusEl.className = 'terminal-pane-status';
        this.statusEl.textContent = 'Loading terminal…';

        this.bodyEl = this.ownerDocument.createElement('div');
        this.bodyEl.className = 'terminal-pane-body';
        this.bodyEl.style.display = 'flex';
        this.bodyEl.style.flex = '1 1 auto';
        this.bodyEl.style.minHeight = '0';
        this.bodyEl.innerHTML = '<div class="terminal-placeholder">Bootstrapping ghostty-web…</div>';

        this.termEl.append(this.bodyEl);
        container.appendChild(this.termEl);

        void this.bootstrapGhostty();
    }

    private setStatus(message: string): void {
        this.statusEl.textContent = message;
        this.termEl.dataset.connectionStatus = message;
        this.termEl.setAttribute('aria-label', `Terminal ${message}`);
    }

    private getResizeSignature(): string {
        try {
            const containerRect = this.container?.getBoundingClientRect?.();
            const bodyRect = this.bodyEl?.getBoundingClientRect?.();
            const cWidth = Number.isFinite(containerRect?.width) ? containerRect.width : 0;
            const cHeight = Number.isFinite(containerRect?.height) ? containerRect.height : 0;
            const bWidth = Number.isFinite(bodyRect?.width) ? bodyRect.width : 0;
            const bHeight = Number.isFinite(bodyRect?.height) ? bodyRect.height : 0;
            return `${Math.round(cWidth)}x${Math.round(cHeight)}:${Math.round(bWidth)}x${Math.round(bHeight)}`;
        } catch {
            return "0x0:0x0";
        }
    }

    private syncHostLayout(): void {
        const host = this.bodyEl.querySelector('.terminal-live-host');
        if (!(host instanceof HTMLElement)) return;

        host.style.display = 'flex';
        host.style.flex = '1 1 auto';
        host.style.width = '100%';
        host.style.height = '100%';
        host.style.minWidth = '0';
        host.style.minHeight = '0';
        host.style.overflow = 'hidden';

        const primaryChild = host.firstElementChild;
        if (primaryChild instanceof HTMLElement) {
            primaryChild.style.width = '100%';
            primaryChild.style.height = '100%';
            primaryChild.style.maxWidth = '100%';
            primaryChild.style.minWidth = '0';
            primaryChild.style.minHeight = '0';
            primaryChild.style.flex = '1 1 auto';
            primaryChild.style.display = 'block';
        }

        const canvas = host.querySelector('canvas');
        if (canvas instanceof HTMLElement) {
            canvas.style.display = 'block';
            canvas.style.maxWidth = 'none';
            canvas.style.maxHeight = 'none';
        }
    }

    private queueResizeRetries(delays: number[] = [32, 96, 180, 320, 520, 900]): void {
        if (this.disposed || !this.ownerWindow) return;
        this.clearResizeRetries();
        for (const delay of delays) {
            const timer = this.ownerWindow.setTimeout(() => {
                this.resizeRetryTimers.delete(timer);
                if (this.disposed) return;
                this.scheduleResize(true);
            }, delay);
            this.resizeRetryTimers.add(timer);
        }
    }

    private clearResizeRetries(): void {
        if (!this.ownerWindow || this.resizeRetryTimers.size === 0) return;
        for (const timer of Array.from(this.resizeRetryTimers)) {
            try {
                this.ownerWindow.clearTimeout(timer);
            } catch {
                /* expected: timeout may already be cleared while a resize retry is draining. */
            }
        }
        this.resizeRetryTimers.clear();
    }

    private scheduleResize(force = false): void {
        if (this.disposed) return;

        const signature = this.getResizeSignature();
        if (!force && this.lastResizeSignature === signature) {
            return;
        }

        if (this.resizeFrame) {
            cancelAnimationFrame(this.resizeFrame);
        }
        this.resizeFrame = requestAnimationFrame(() => {
            this.resizeFrame = 0;
            this.lastResizeSignature = this.getResizeSignature();
            this.resize();
        });
    }

    private async bootstrapGhostty(): Promise<void> {
        try {
            const mod = await loadGhosttyWeb();
            await ensureTerminalFontsReady();
            if (this.disposed) return;

            this.bodyEl.innerHTML = '';
            const terminalHost = this.ownerDocument.createElement('div');
            terminalHost.className = 'terminal-live-host';
            terminalHost.style.display = 'flex';
            terminalHost.style.flex = '1 1 auto';
            terminalHost.style.width = '100%';
            terminalHost.style.height = '100%';
            terminalHost.style.minWidth = '0';
            terminalHost.style.minHeight = '0';
            this.bodyEl.appendChild(terminalHost);

            const terminal = new mod.Terminal({
                cols: 120,
                rows: 30,
                cursorBlink: true,
                fontFamily: TERMINAL_FONT_FAMILY,
                fontSize: 13,
                theme: buildTerminalTheme(this.ownerWindow, this.ownerDocument),
            });

            let fitAddon = null;
            if (typeof mod.FitAddon === 'function') {
                fitAddon = new mod.FitAddon();
                terminal.loadAddon?.(fitAddon);
            }

            await terminal.open(terminalHost);
            (terminalHost as any).__terminal = terminal;
            this.syncHostLayout();
            terminal.loadFonts?.();
            fitAddon?.observeResize?.();

            this.terminal = terminal;
            this.fitAddon = fitAddon;
            this.installThemeSync();
            this.installResizeSync();
            this.scheduleResize(true);
            this.queueResizeRetries([32, 96, 180, 320]);

            await this.connectBackend();
        } catch (error) {
            console.error('[terminal-pane] Failed to bootstrap ghostty-web:', error);
            if (this.disposed) return;
            this.bodyEl.innerHTML = '<div class="terminal-placeholder">Terminal failed to load. Check vendored assets and backend wiring.</div>';
            this.setStatus('Load failed');
        }
    }

    private applyTheme() {
        if (!this.terminal) return;
        const theme = buildTerminalTheme(this.ownerWindow, this.ownerDocument);
        const themeSignature = JSON.stringify(theme);
        const themeChanged = this.lastAppliedThemeSignature !== null && this.lastAppliedThemeSignature !== themeSignature;
        applyTerminalThemeBestEffort({
            termEl: this.termEl,
            bodyEl: this.bodyEl,
            terminal: this.terminal,
            theme,
            themeChanged,
            socket: this.socket,
            resize: () => this.resize(),
        });
        this.lastAppliedThemeSignature = themeSignature;
    }

    private installThemeSync() {
        if (!this.ownerWindow || !this.ownerDocument) return;
        const syncTheme = () => requestAnimationFrame(() => this.applyTheme());
        syncTheme();

        const onThemeChange = () => syncTheme();
        this.ownerWindow.addEventListener('piclaw-theme-change', onThemeChange);
        this.themeChangeListener = onThemeChange;

        const media = this.ownerWindow.matchMedia?.('(prefers-color-scheme: dark)');
        const onMediaChange = () => syncTheme();
        if (media?.addEventListener) media.addEventListener('change', onMediaChange);
        else if (media?.addListener) media.addListener(onMediaChange);
        this.mediaQuery = media;
        this.mediaQueryListener = onMediaChange;

        const observer = typeof MutationObserver !== 'undefined'
            ? new MutationObserver(() => syncTheme())
            : null;
        observer?.observe(this.ownerDocument.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'data-theme', 'style'],
        });
        if (this.ownerDocument.body) {
            observer?.observe(this.ownerDocument.body, {
                attributes: true,
                attributeFilter: ['class', 'data-theme'],
            });
        }
        this.themeObserver = observer;
    }

    private installResizeSync() {
        if (!this.ownerWindow) return;

        const onDockResize = () => this.scheduleResize();
        const onWindowResize = () => this.scheduleResize();
        this.ownerWindow.addEventListener('dock-resize', onDockResize);
        this.ownerWindow.addEventListener('resize', onWindowResize);
        this.dockResizeListener = onDockResize;
        this.windowResizeListener = onWindowResize;

        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(() => {
                if (this.disposed) return;
                this.scheduleResize();
            });
            observer.observe(this.container);
            observer.observe(this.termEl);
            observer.observe(this.bodyEl);
            this.resizeObserver = observer;
        }
    }

    private consumeStandbyHandoffToken(): string | null {
        const token = this.standbyHandoffToken || null;
        this.standbyHandoffToken = null;
        return token;
    }

    private async ensureStandbyHandoffToken(force = false): Promise<string | null> {
        if (this.disposed) return null;
        if (!force && this.standbyHandoffToken) {
            return this.standbyHandoffToken;
        }
        if (this.standbyHandoffRequest) {
            return await this.standbyHandoffRequest;
        }
        this.standbyHandoffRequest = requestTerminalHandoff()
            .then((token) => {
                if (!token || this.disposed) {
                    return null;
                }
                this.standbyHandoffToken = token;
                return token;
            })
            .catch((error) => {
                console.warn('[terminal-pane] Failed to prepare standby handoff token:', error);
                return null;
            })
            .finally(() => {
                this.standbyHandoffRequest = null;
            });
        return await this.standbyHandoffRequest;
    }

    private async connectBackend() {
        const terminal = this.terminal;
        if (!terminal) return;

        try {
            const session = await fetchTerminalSession();
            if (this.disposed) return;

            if (!session?.enabled) {
                terminal.write?.(`Terminal backend unavailable: ${session?.error || 'disabled'}\r\n`);
                this.setStatus('Unavailable');
                return;
            }

            const handoffToken = this.pendingHandoffToken || null;
            const socket = new WebSocket(buildTerminalWebSocketUrl(session.ws_path || '/terminal/ws', handoffToken));
            this.socket = socket;
            this.setStatus(handoffToken ? 'Transferring…' : 'Connecting…');

            terminal.onData?.((data) => {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'input', data }));
                }
            });

            terminal.onResize?.(({ cols, rows }) => {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'resize', cols, rows }));
                }
            });

            socket.addEventListener('open', () => {
                if (this.disposed) return;
                if (handoffToken && this.pendingHandoffToken === handoffToken) {
                    this.pendingHandoffToken = null;
                }
                void this.ensureStandbyHandoffToken(false);
                this.setStatus('Connected');
                this.scheduleResize(true);
                this.queueResizeRetries([24, 72, 160, 320]);
            });

            socket.addEventListener('message', (event) => {
                if (this.disposed) return;
                let payload = null;
                try {
                    payload = JSON.parse(String(event.data));
                } catch {
                    payload = { type: 'output', data: String(event.data) };
                }

                if (payload?.type === 'session') {
                    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : null;
                    (terminal as any).__piclawSessionMeta = {
                        sessionId,
                        createdAt: typeof payload.created_at === 'string' ? payload.created_at : null,
                        processPid: typeof payload.process_pid === 'number' ? payload.process_pid : null,
                    };
                    if (!this.standbyHandoffToken) {
                        void this.ensureStandbyHandoffToken(false);
                    }
                    return;
                }
                if (payload?.type === 'output' && typeof payload.data === 'string') {
                    terminal.write?.(payload.data);
                    return;
                }
                if (payload?.type === 'exit') {
                    terminal.write?.(`\r\n[terminal exited]\r\n`);
                    this.setStatus('Exited');
                }
            });

            socket.addEventListener('close', () => {
                if (this.disposed) return;
                this.setStatus('Disconnected');
            });

            socket.addEventListener('error', () => {
                if (this.disposed) return;
                this.setStatus('Connection error');
            });
        } catch (error) {
            terminal.write?.(`Terminal backend unavailable: ${error instanceof Error ? error.message : String(error)}\r\n`);
            this.setStatus('Unavailable');
        }
    }

    private sendResize() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.fitAddon?.proposeDimensions) {
            return;
        }
        const dims = this.fitAddon.proposeDimensions();
        if (!dims) return;
        this.socket.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
    }

    private detachHostListeners(): void {
        detachTerminalHostListenersBestEffort({
            ownerWindow: this.ownerWindow,
            themeChangeListener: this.themeChangeListener,
            mediaQuery: this.mediaQuery,
            mediaQueryListener: this.mediaQueryListener,
            dockResizeListener: this.dockResizeListener,
            windowResizeListener: this.windowResizeListener,
            themeObserver: this.themeObserver,
            resizeObserver: this.resizeObserver,
        });
        this.themeChangeListener = null;
        this.mediaQuery = null;
        this.mediaQueryListener = null;
        this.themeObserver = null;
        this.resizeObserver = null;
        this.dockResizeListener = null;
        this.windowResizeListener = null;
    }

    beforeDetachFromHost(): void {
        this.setStatus('Moving terminal…');
    }

    afterAttachToHost(context?: { transferState?: Record<string, unknown> | null }): void {
        const transferHandoffToken = typeof context?.transferState?.handoffToken === 'string' && context.transferState.handoffToken.trim()
            ? context.transferState.handoffToken.trim()
            : null;
        if (transferHandoffToken) {
            this.pendingHandoffToken = transferHandoffToken;
        }
        this.installThemeSync();
        this.installResizeSync();
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.setStatus('Connected');
        } else if (this.pendingHandoffToken) {
            this.setStatus('Transferring…');
        } else if (this.socket?.readyState === WebSocket.CONNECTING) {
            this.setStatus('Connecting…');
        }
        this.scheduleResize(true);
        this.queueResizeRetries([32, 96, 180, 320]);
        requestAnimationFrame(() => this.focus());
    }

    moveHost(_container: HTMLElement): boolean {
        return false;
    }

    exportHostTransferState(): Record<string, unknown> | null {
        const handoffToken = this.standbyHandoffToken || this.pendingHandoffToken || null;
        return handoffToken
            ? {
                kind: 'terminal',
                live: false,
                handoffToken,
            }
            : null;
    }

    async preparePopoutTransfer(): Promise<Record<string, string> | null> {
        let handoffToken = this.consumeStandbyHandoffToken();
        if (!handoffToken) {
            await this.ensureStandbyHandoffToken(true);
            handoffToken = this.consumeStandbyHandoffToken();
        }
        if (!handoffToken) return null;
        this.pendingHandoffToken = handoffToken;
        return { terminal_handoff: handoffToken };
    }

    getContent(): string | undefined {
        return undefined;
    }

    isDirty(): boolean {
        return false;
    }

    focus(): void {
        if (this.terminal?.focus) {
            this.terminal.focus();
            return;
        }
        this.termEl?.focus();
    }

    resize(): void {
        resizeTerminalRuntimeBestEffort({
            syncHostLayout: () => this.syncHostLayout(),
            terminal: this.terminal,
            fitAddon: this.fitAddon,
            sendResize: () => this.sendResize(),
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.standbyHandoffToken = null;
        this.standbyHandoffRequest = null;
        this.clearResizeRetries();
        this.detachHostListeners();
        this.resizeFrame = disposeTerminalRuntimeBestEffort({
            resizeFrame: this.resizeFrame,
            socket: this.socket,
            fitAddon: this.fitAddon,
            terminal: this.terminal,
            termEl: this.termEl,
        });
    }
}

export const terminalPaneExtension: WebPaneExtension = {
    id: 'terminal',
    label: 'Terminal',
    icon: 'terminal',
    capabilities: ['terminal'] as PaneCapability[],
    placement: 'dock',

    mount(container: HTMLElement, context: PaneContext): PaneInstance {
        return new TerminalPaneInstance(container, context);
    },
};

export const terminalTabPaneExtension: WebPaneExtension = {
    id: 'terminal-tab',
    label: 'Terminal',
    icon: 'terminal',
    capabilities: ['terminal'] as PaneCapability[],
    placement: 'tabs',

    canHandle(context: PaneContext): boolean | number {
        return context?.path === TERMINAL_TAB_PATH ? 10_000 : false;
    },

    mount(container: HTMLElement, context: PaneContext): PaneInstance {
        return new TerminalPaneInstance(container, context);
    },
};
