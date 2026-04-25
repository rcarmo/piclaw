// @ts-nocheck
/**
 * editor-extension.ts — Standalone editor pane extension.
 *
 * Creates and manages a CodeMirror 6 editor directly — no Preact wrapper.
 * Owns its own DOM lifecycle (mount/dispose), dirty tracking, file I/O,
 * vim/whitespace toggles, theming, and status bar.
 *
 * Communicates with the host exclusively via the PaneInstance contract:
 *   Host → Extension: setContent(), focus(), resize()
 *   Extension → Host: onDirtyChange(), onSaveRequest(), onClose()
 */

import {
    EditorState,
    EditorView,
    Compartment,
    minimalSetup,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightWhitespace,
    scrollPastEnd,
    showPanel,
    javascript,
    python,
    markdown,
    markdownLanguage,
    go,
    cpp,
    json,
    css,
    html as htmlLang,
    rust,
    yaml,
    sql,
    xml,
    StreamLanguage,
    HighlightStyle,
    syntaxHighlighting,
    indentOnInput,
    indentUnit,
    tags,
    classHighlighter,
    shell,
    keymap,
    indentWithTab,
    search,
    searchKeymap,
    highlightSelectionMatches,
    autocompletion,
    completionKeymap,
    closeBrackets,
    closeBracketsKeymap,
    vim,
    indentationMarkers,
    githubLight,
    githubDark,
    MergeView,
} from '#editor-vendor/codemirror';
import { getWorkspaceBranch, getWorkspaceFile, getWorkspaceFileStat, updateWorkspaceFile } from '../../../web/src/api.js';
import { createFileConflictMonitor, type FileConflictMonitor } from '../../../web/src/panes/file-conflict-monitor.js';
import type { WebPaneExtension, PaneContext, PaneInstance, PaneCapability, PaneHostAttachContext, PaneHostDetachContext } from '../../../web/src/panes/pane-types.js';
import { frontmatterExtension } from './markdown/frontmatter.js';
import { footnoteExtension } from './markdown/footnote.js';
import { hashtagExtension } from './markdown/tag.js';
import {
    getLocalBoolWithFallback,
    restoreEditorViewStateBestEffort,
    setLocalBoolBestEffort,
} from './editor-safety.ts';

// ── Constants ───────────────────────────────────────────────────

const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const EDITOR_MAX_BYTES = 256 * 1024;

const shellLanguage = StreamLanguage.define(shell);

const headingStyle = HighlightStyle.define([
    { tag: tags.heading1, fontWeight: 'bold', fontSize: '1.3em', textDecoration: 'none' },
    { tag: tags.heading2, fontWeight: 'bold', fontSize: '1.2em', textDecoration: 'none' },
    { tag: tags.heading3, fontWeight: 'bold', fontSize: '1.1em', textDecoration: 'none' },
    { tag: tags.heading4, fontWeight: 'bold', textDecoration: 'none' },
    { tag: tags.heading5, fontWeight: 'bold', textDecoration: 'none' },
    { tag: tags.heading6, fontWeight: 'bold', textDecoration: 'none' },
]);

// ── Helpers ─────────────────────────────────────────────────────

function getThemeMode(doc: Document): 'dark' | 'light' {
    return doc.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function getLocalBool(key: string, fallback: boolean): boolean {
    return getLocalBoolWithFallback(() => localStorage, key, fallback);
}

function setLocalBool(key: string, value: boolean): void {
    setLocalBoolBestEffort(() => localStorage, key, value);
}

/** Map file extension → CodeMirror language extension. */
interface EditorHostTransferState {
    kind?: string;
    path?: string;
    content?: string;
    initialContent?: string;
    mtime?: string | null;
    dirty?: boolean;
    diffMode?: 'saved' | null;
    viewState?: {
        cursorLine?: number;
        cursorCol?: number;
        scrollTop?: number;
    } | null;
}

function normalizeEditorHostTransferState(value: unknown): EditorHostTransferState | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    const kind = typeof raw.kind === 'string' ? raw.kind.trim() : '';
    if (kind && kind !== 'editor') return null;
    return {
        kind: kind || 'editor',
        path: typeof raw.path === 'string' ? raw.path : undefined,
        content: typeof raw.content === 'string' ? raw.content : undefined,
        initialContent: typeof raw.initialContent === 'string' ? raw.initialContent : undefined,
        mtime: typeof raw.mtime === 'string' ? raw.mtime : (raw.mtime === null ? null : undefined),
        dirty: typeof raw.dirty === 'boolean' ? raw.dirty : undefined,
        diffMode: raw.diffMode === 'saved' ? 'saved' : null,
        viewState: raw.viewState && typeof raw.viewState === 'object'
            ? {
                cursorLine: typeof (raw.viewState as any).cursorLine === 'number' ? (raw.viewState as any).cursorLine : undefined,
                cursorCol: typeof (raw.viewState as any).cursorCol === 'number' ? (raw.viewState as any).cursorCol : undefined,
                scrollTop: typeof (raw.viewState as any).scrollTop === 'number' ? (raw.viewState as any).scrollTop : undefined,
            }
            : null,
    };
}

function languageForPath(path: string) {
    const lower = String(path || '').toLowerCase();
    if (lower.endsWith('.py')) return python();
    if (lower.endsWith('.rs')) return rust();
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return javascript({ typescript: true, jsx: lower.endsWith('.tsx') });
    if (lower.endsWith('.js') || lower.endsWith('.jsx')) return javascript({ jsx: lower.endsWith('.jsx') });
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return markdown({
        base: markdownLanguage,
        extensions: [frontmatterExtension, footnoteExtension, hashtagExtension],
    });
    if (lower.endsWith('.go')) return go();
    if (lower.endsWith('.c++') || lower.endsWith('.cc') || lower.endsWith('.cp') || lower.endsWith('.cpp') || lower.endsWith('.cxx')
        || lower.endsWith('.hh') || lower.endsWith('.hpp') || lower.endsWith('.hxx')) return cpp();
    if (lower.endsWith('.json') || lower.endsWith('.jsonl')) return json();
    if (lower.endsWith('.css') || lower.endsWith('.scss')) return css();
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return htmlLang();
    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return yaml();
    if (lower.endsWith('.sql') || lower.endsWith('.sqlite')) return sql();
    if (lower.endsWith('.xml') || lower.endsWith('.svg') || lower.endsWith('.plist')) return xml();
    if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh') || lower.endsWith('.env')) return shellLanguage;
    return null;
}

// ── Status bar panel ────────────────────────────────────────────

function createStatusPanel(doc: Document, vimEnabledRef: { current: boolean }) {
    return (view: EditorView) => {
        const dom = doc.createElement('div');
        dom.className = 'cm-statusbar';

        const left = doc.createElement('div');
        left.className = 'cm-statusbar-left';

        const right = doc.createElement('div');
        right.className = 'cm-statusbar-right';

        dom.append(left, right);

        const update = () => {
            const state = view.state;
            const pos = state.selection.main.head;
            const line = state.doc.lineAt(pos);
            const col = pos - line.from + 1;
            const unit = state.facet(indentUnit) || '  ';
            const indentLabel = unit === '\t' ? 'Tabs' : `Spaces:${unit.length}`;
            left.textContent = `Ln ${line.number}, Col ${col}`;
            const vimLabel = vimEnabledRef.current ? 'Vim' : 'Insert';
            right.textContent = `${indentLabel} • ${vimLabel}`;
        };

        update();

        return {
            dom,
            update: (updateEvent: any) => {
                if (updateEvent.docChanged || updateEvent.selectionSet || updateEvent.viewportChanged) {
                    update();
                }
            },
            destroy: () => {},
        };
    };
}

// ── EditorPaneInstance ──────────────────────────────────────────

/**
 * Self-contained editor pane instance. Creates CodeMirror directly,
 * manages file I/O, dirty tracking, and theming internally.
 */
export class StandaloneEditorInstance implements PaneInstance {
    // DOM
    private container: HTMLElement;
    private ownerDocument: Document;
    private ownerWindow: Window & typeof globalThis;
    private paneEl: HTMLElement;
    private headerEl: HTMLElement | null = null;
    private bodyEl: HTMLElement;
    private cmHost: HTMLElement;
    private diffShellEl: HTMLElement;
    private diffMergeHost: HTMLElement;
    private statusEl: HTMLElement;

    // CodeMirror
    private view: EditorView | null = null;
    private baselineView: EditorView | null = null;
    private mergeView: MergeView | null = null;
    private vimCompartment = new Compartment();
    private themeCompartment = new Compartment();
    private accentCompartment = new Compartment();
    private whitespaceCompartment = new Compartment();
    private livePreviewCompartment = new Compartment();
    private wrappingCompartment = new Compartment();
    private baselineThemeCompartment = new Compartment();
    private baselineAccentCompartment = new Compartment();
    private baselineWhitespaceCompartment = new Compartment();

    // State
    private path: string;
    private initialContent = '';
    private currentMtime: string | null = null;
    private dirty = false;
    private saving = false;
    private disposed = false;
    private vimEnabled: boolean;
    private showWhitespace: boolean;
    private livePreviewEnabled: boolean;
    private diffMode: 'saved' | null = null;
    private vimEnabledRef: { current: boolean };

    // Callbacks (PaneInstance contract)
    private dirtyChangeCb: ((dirty: boolean) => void) | null = null;
    private saveRequestCb: ((content: string) => void) | null = null;
    private closeCb: (() => void) | null = null;
    private viewStateChangeCb: ((state: { cursorLine: number; cursorCol: number; scrollTop: number }) => void) | null = null;

    // External change detection
    private conflictMonitor: FileConflictMonitor | null = null;

    constructor(container: HTMLElement, context: PaneContext) {
        this.container = container;
        this.ownerDocument = container.ownerDocument || document;
        this.ownerWindow = (this.ownerDocument.defaultView || window) as Window & typeof globalThis;
        this.path = context.path || '';

        this.vimEnabled = getLocalBool('piclaw_vim_mode', false);
        this.showWhitespace = getLocalBool('piclaw_show_whitespace', true);
        this.livePreviewEnabled = getLocalBool('piclaw_md_live_preview', true);
        this.vimEnabledRef = { current: this.vimEnabled };

        this.handleThemeChange = this.handleThemeChange.bind(this);
        this.handleGlobalKeydown = this.handleGlobalKeydown.bind(this);

        this.initializeHostDom(container);
        this.bindHostListeners();
        this.bootstrapInitialContext(context);
    }

    // ── DOM builders ────────────────────────────────────────────

    private initializeHostDom(container: HTMLElement): void {
        this.container = container;
        this.ownerDocument = container.ownerDocument || this.ownerDocument || document;
        this.ownerWindow = (this.ownerDocument.defaultView || this.ownerWindow || window) as Window & typeof globalThis;

        container.innerHTML = '';
        this.paneEl = this.ownerDocument.createElement('div');
        this.paneEl.className = 'editor-pane';

        this.bodyEl = this.ownerDocument.createElement('div');
        this.bodyEl.className = 'editor-body';

        this.cmHost = this.ownerDocument.createElement('div');
        this.cmHost.className = 'editor-codemirror';

        this.diffShellEl = this.ownerDocument.createElement('div');
        this.diffShellEl.className = 'editor-diff-shell';
        this.diffShellEl.hidden = true;

        const diffHeaders = this.ownerDocument.createElement('div');
        diffHeaders.className = 'editor-diff-headers';
        diffHeaders.innerHTML = `
            <div class="editor-diff-header editor-diff-header-saved">Saved</div>
            <div class="editor-diff-header editor-diff-header-current">Current</div>
        `;

        this.diffMergeHost = this.ownerDocument.createElement('div');
        this.diffMergeHost.className = 'editor-diff-merge';

        this.diffShellEl.appendChild(diffHeaders);
        this.diffShellEl.appendChild(this.diffMergeHost);

        this.bodyEl.appendChild(this.cmHost);
        this.bodyEl.appendChild(this.diffShellEl);

        this.statusEl = this.buildStatusBar();

        this.paneEl.appendChild(this.bodyEl);
        this.paneEl.appendChild(this.statusEl);
        container.appendChild(this.paneEl);
    }

    private bindHostListeners(): void {
        this.ownerWindow.addEventListener('piclaw-theme-change', this.handleThemeChange as EventListener);
        this.ownerDocument.addEventListener('keydown', this.handleGlobalKeydown as EventListener);
    }

    private unbindHostListeners(): void {
        this.ownerWindow.removeEventListener('piclaw-theme-change', this.handleThemeChange as EventListener);
        this.ownerDocument.removeEventListener('keydown', this.handleGlobalKeydown as EventListener);
    }

    private bootstrapInitialContext(context: PaneContext): void {
        const transferState = normalizeEditorHostTransferState(context.transferState);
        if (transferState?.diffMode === 'saved') {
            this.diffMode = 'saved';
        }

        if (context.content !== undefined) {
            this.mountEditor(context.content, context.mtime);
            if (transferState) {
                this.applyHostTransferState(transferState);
            }
        } else if (transferState?.content !== undefined) {
            this.mountEditor(transferState.content, transferState.mtime);
            this.applyHostTransferState(transferState);
        } else {
            void this.loadFile();
        }

        void this.refreshBranchHint();
    }

    private buildStatusBar(): HTMLElement {
        const row = this.ownerDocument.createElement('div');
        row.className = 'editor-status editor-status-row';

        const meta = this.ownerDocument.createElement('div');
        meta.className = 'editor-status-meta';

        const branch = this.ownerDocument.createElement('span');
        branch.className = 'editor-branch-hint';
        branch.hidden = true;
        branch.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6 3v12"></path>
                <circle cx="18" cy="6" r="3"></circle>
                <circle cx="6" cy="18" r="3"></circle>
                <path d="M18 9a9 9 0 0 1-9 9"></path>
            </svg>
            <span class="editor-branch-label"></span>
        `;
        this._branchHint = branch;
        this._branchLabel = branch.querySelector('.editor-branch-label');

        const text = this.ownerDocument.createElement('span');
        text.className = 'editor-status-text';
        text.textContent = 'Ready';
        this._statusText = text;

        meta.appendChild(branch);
        meta.appendChild(text);

        const actionsDiv = this.ownerDocument.createElement('div');
        actionsDiv.className = 'editor-status-actions';

        const wsBtn = this.ownerDocument.createElement('button');
        wsBtn.className = `editor-status-button${this.showWhitespace ? ' active' : ''}`;
        wsBtn.title = 'Toggle whitespace (Alt+W)';
        wsBtn.textContent = 'Whitespace';
        wsBtn.addEventListener('click', () => this.toggleWhitespace());
        this._wsBtn = wsBtn;

        const lpBtn = this.ownerDocument.createElement('button');
        lpBtn.className = `editor-status-button${this.livePreviewEnabled ? ' active' : ''}`;
        lpBtn.title = 'Toggle live preview (Alt+P)';
        lpBtn.textContent = 'Live Preview';
        lpBtn.addEventListener('click', () => this.toggleLivePreview());
        this._lpBtn = lpBtn;

        const vimBtn = this.ownerDocument.createElement('button');
        vimBtn.className = `editor-status-button${this.vimEnabled ? ' active' : ''}`;
        vimBtn.title = 'Toggle Vim mode (Alt+V)';
        vimBtn.textContent = 'Vim';
        vimBtn.addEventListener('click', () => this.toggleVim());
        this._vimBtn = vimBtn;

        const saveBtn = this.ownerDocument.createElement('button');
        saveBtn.className = 'editor-status-button editor-save-btn';
        saveBtn.title = 'Save (Ctrl+S)';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', () => this.handleSave());
        this._saveBtn = saveBtn;

        actionsDiv.appendChild(wsBtn);
        actionsDiv.appendChild(lpBtn);
        actionsDiv.appendChild(vimBtn);
        actionsDiv.appendChild(saveBtn);
        row.appendChild(meta);
        row.appendChild(actionsDiv);

        this.updateLivePreviewControlState();
        this.updateWhitespaceControlState();
        return row;
    }
    private _branchHint: HTMLElement | null = null;
    private _branchLabel: HTMLElement | null = null;
    private _statusText: HTMLElement | null = null;
    private _wsBtn: HTMLButtonElement | null = null;
    private _lpBtn: HTMLButtonElement | null = null;
    private _vimBtn: HTMLButtonElement | null = null;
    private _saveBtn: HTMLButtonElement | null = null;
    private branchRequestToken = 0;

    // ── File I/O ────────────────────────────────────────────────

    /** Load file content from the workspace API. */
    private async loadFile(): Promise<void> {
        this.setLoadingUI(true);
        try {
            const data = await getWorkspaceFile(this.path, EDITOR_MAX_BYTES, 'edit');
            if (this.disposed) return;

            if (data?.error) {
                this.setErrorUI(data.error);
                return;
            }
            if (data?.kind && data.kind !== 'text') {
                this.setErrorUI('File is not editable');
                return;
            }

            this.mountEditor(data?.text || '', data?.mtime || null);
        } catch (err: any) {
            if (!this.disposed) {
                this.setErrorUI(err.message || 'Failed to load file');
            }
        }
    }

    /** Save current content to disk via workspace API. */
    private async handleSave(): Promise<void> {
        if (this.saving || !this.view || !this.dirty) return;

        const value = this.view.state.doc.toString();
        this.saving = true;
        this.updateSaveButton();
        this.updateStatusText('Saving…');

        // Notify host about save attempt (content for the tab store)
        this.saveRequestCb?.(value);

        try {
            const result = await updateWorkspaceFile(this.path, value);
            if (this.disposed) return;

            this.initialContent = value;
            this.currentMtime = result?.mtime || this.currentMtime;
            this.conflictMonitor?.onSaved(this.currentMtime);
            if (this.isDiffMode()) {
                const viewState = this.captureViewState();
                this.renderEditorSurface(value, 'saved', viewState);
            }
            this.setDirty(false);
            this.saving = false;
            this.updateSaveButton();
            this.updateStatusText('All changes saved');
        } catch (err: any) {
            if (this.disposed) return;
            this.saving = false;
            this.updateSaveButton();
            this.updateStatusText(`Save failed: ${err.message || 'Unknown error'}`);
        }
    }

    // ── CodeMirror lifecycle ────────────────────────────────────

    /** Create the CodeMirror editor with content. */
    private mountEditor(content: string, mtime?: string | null): void {
        this.initialContent = content;
        this.currentMtime = mtime || null;
        this.setLoadingUI(false);
        this.renderEditorSurface(content, this.diffMode === 'saved' ? 'saved' : null, null);
        this.setDirty(false);
        this.updateLivePreviewControlState();
        this.updateWhitespaceControlState();
        this.updateGutterWidth();
        this.initConflictMonitor();
    }

    private renderEditorSurface(content: string, diffMode: 'saved' | null, viewState: { cursorLine?: number; cursorCol?: number; scrollTop?: number } | null): void {
        this.destroyEditorViews();
        if (diffMode === 'saved') {
            this.renderFreshDiffEditor(content, this.initialContent, viewState);
            return;
        }
        this.renderFreshEditor(content, viewState);
    }

    private destroyEditorViews(): void {
        if (this.mergeView) {
            this.mergeView.destroy();
            this.mergeView = null;
            this.baselineView = null;
            this.view = null;
        } else if (this.view) {
            this.view.destroy();
            this.view = null;
        }
        this.baselineView = null;
        this.cmHost.innerHTML = '';
        this.diffMergeHost.innerHTML = '';
    }

    private setEditorSurfaceMode(diffMode: 'saved' | null): void {
        const enabled = diffMode === 'saved';
        this.cmHost.hidden = enabled;
        this.diffShellEl.hidden = !enabled;
        this.bodyEl.classList.toggle('editor-body-diff', enabled);
    }

    private buildSharedEditorTheme(): ReturnType<typeof EditorView.theme> {
        return EditorView.theme({
            '&': { height: '100%', fontFamily: MONO_STACK },
            '.cm-scroller': { fontFamily: MONO_STACK },
            '.cm-content': { fontFamily: MONO_STACK, fontSize: '12px' },
            '.cm-gutters': { fontFamily: MONO_STACK },
        });
    }

    private buildEditableEditorExtensions(options: { scrollPastEnd?: boolean } = {}): any[] {
        const isDark = getThemeMode(this.ownerDocument) === 'dark';
        const lang = languageForPath(this.path);
        const extensions: any[] = [
            minimalSetup,
            lineNumbers(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            this.whitespaceCompartment.of(this.showWhitespace ? highlightWhitespace() : []),
            this.livePreviewCompartment.of([]),
            this.wrappingCompartment.of(EditorView.lineWrapping),
            ...(options.scrollPastEnd === false ? [] : [scrollPastEnd()]),
            indentOnInput(),
            closeBrackets(),
            autocompletion(),
            highlightSelectionMatches(),
            indentationMarkers(),
            syntaxHighlighting(headingStyle),
            syntaxHighlighting(classHighlighter),
            search(),
            this.vimCompartment.of(this.vimEnabled ? vim() : []),
            this.themeCompartment.of(isDark ? githubDark : githubLight),
            this.accentCompartment.of(this.buildAccentTheme()),
            showPanel.of(createStatusPanel(this.ownerDocument, this.vimEnabledRef)),
            keymap.of([
                ...searchKeymap,
                ...completionKeymap,
                ...closeBracketsKeymap,
                indentWithTab,
                { key: 'Mod-s', run: () => { this.handleSave(); return true; } },
            ]),
            EditorView.updateListener.of((update: any) => {
                if (update.docChanged) this.checkDirty();
                if ((update.selectionSet || update.docChanged) && this.viewStateChangeCb) {
                    const pos = update.state.selection.main.head;
                    const line = update.state.doc.lineAt(pos);
                    const col = pos - line.from + 1;
                    const scrollTop = update.view.scrollDOM?.scrollTop || 0;
                    this.viewStateChangeCb({ cursorLine: line.number, cursorCol: col, scrollTop });
                }
            }),
            this.buildSharedEditorTheme(),
        ];
        if (lang) extensions.push(lang);
        return extensions;
    }

    private buildBaselineEditorExtensions(): any[] {
        const isDark = getThemeMode(this.ownerDocument) === 'dark';
        const lang = languageForPath(this.path);
        const extensions: any[] = [
            minimalSetup,
            lineNumbers(),
            this.baselineWhitespaceCompartment.of(this.showWhitespace ? highlightWhitespace() : []),
            this.baselineThemeCompartment.of(isDark ? githubDark : githubLight),
            this.baselineAccentCompartment.of(this.buildAccentTheme()),
            EditorView.lineWrapping,
            syntaxHighlighting(headingStyle),
            syntaxHighlighting(classHighlighter),
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            this.buildSharedEditorTheme(),
        ];
        if (lang) extensions.push(lang);
        return extensions;
    }

    private renderFreshEditor(content: string, viewState: { cursorLine?: number; cursorCol?: number; scrollTop?: number } | null): void {
        this.setEditorSurfaceMode(null);
        const state = EditorState.create({
            doc: content,
            extensions: this.buildEditableEditorExtensions({ scrollPastEnd: true }),
        });
        this.view = new EditorView({ state, parent: this.cmHost });
        if (viewState) requestAnimationFrame(() => this.restoreViewState(viewState));
        if (this.supportsMarkdownLivePreview() && this.livePreviewEnabled) {
            void this.applyLivePreview(true);
        }
    }

    private renderFreshDiffEditor(currentContent: string, baselineContent: string, viewState: { cursorLine?: number; cursorCol?: number; scrollTop?: number } | null): void {
        this.setEditorSurfaceMode('saved');
        this.mergeView = new MergeView({
            a: {
                doc: baselineContent,
                extensions: this.buildBaselineEditorExtensions(),
            },
            b: {
                doc: currentContent,
                extensions: this.buildEditableEditorExtensions({ scrollPastEnd: false }),
            },
            parent: this.diffMergeHost,
            root: this.ownerDocument,
            revertControls: false,
            highlightChanges: true,
            gutter: true,
            diffConfig: {
                scanLimit: 5000,
                timeout: 80,
            },
        });
        this.baselineView = this.mergeView.a;
        this.view = this.mergeView.b;
        if (viewState) requestAnimationFrame(() => this.restoreViewState(viewState));
    }

    /** Check if current file is Markdown. */
    private isMarkdownFile(): boolean {
        const lower = (this.path || '').toLowerCase();
        return lower.endsWith('.md') || lower.endsWith('.markdown');
    }

    private isDiffMode(): boolean {
        return this.diffMode === 'saved';
    }

    /** Some markdown-backed formats should open as raw source, not live preview. */
    private supportsMarkdownLivePreview(): boolean {
        const lower = (this.path || '').toLowerCase();
        if (lower.endsWith('.kanban.md')) return false;
        return this.isMarkdownFile();
    }

    private isLivePreviewAvailable(): boolean {
        return !this.isDiffMode() && this.supportsMarkdownLivePreview();
    }

    /** Lazy-load and apply/remove markdown live preview extensions. */
    private async applyLivePreview(enabled: boolean): Promise<void> {
        if (!this.view || this.disposed || this.isDiffMode()) return;
        const wrapEffect = this.wrappingCompartment.reconfigure(EditorView.lineWrapping);

        if (enabled) {
            try {
                const { markdownLivePreview } = await import('./markdown/index.js');
                if (this.disposed || !this.view || this.isDiffMode()) return;
                this.view.dispatch({
                    effects: [
                        this.livePreviewCompartment.reconfigure(markdownLivePreview),
                        wrapEffect,
                    ],
                });
            } catch (err) {
                console.error('[editor] Failed to load markdown live preview:', err);
            }
        } else {
            this.view.dispatch({
                effects: [
                    this.livePreviewCompartment.reconfigure([]),
                    wrapEffect,
                ],
            });
        }
    }

    /**
     * Toggle live preview mode. Called from tab context menu.
     * Only meaningful for Markdown files.
     */
    toggleLivePreview(): void {
        if (!this.isLivePreviewAvailable()) return;
        this.livePreviewEnabled = !this.livePreviewEnabled;
        setLocalBool('piclaw_md_live_preview', this.livePreviewEnabled);
        void this.applyLivePreview(this.livePreviewEnabled);
        this.updateLivePreviewControlState();
        this.updateWhitespaceControlState();
    }

    /** Whether live preview is currently on. */
    isLivePreview(): boolean {
        return this.livePreviewEnabled && this.isLivePreviewAvailable();
    }

    private isWhitespaceDisabledInCurrentMode(): boolean {
        return this.isLivePreview();
    }

    private updateLivePreviewControlState(): void {
        if (!this._lpBtn) return;
        const available = this.isLivePreviewAvailable();
        this._lpBtn.hidden = !available;
        this._lpBtn.disabled = !available;
        this._lpBtn.classList.toggle('active', available && this.livePreviewEnabled);
        this._lpBtn.title = available
            ? 'Toggle live preview (Alt+P)'
            : (this.isDiffMode() ? 'Live Preview is unavailable in Compare to Saved' : 'Live Preview is unavailable for this file');
    }

    private updateWhitespaceControlState(): void {
        if (!this._wsBtn) return;
        const disabled = this.isWhitespaceDisabledInCurrentMode();
        this._wsBtn.disabled = disabled;
        this._wsBtn.title = disabled
            ? 'Whitespace is unavailable in Live Preview'
            : 'Toggle whitespace (Alt+W)';
    }

    private captureViewState(): { cursorLine: number; cursorCol: number; scrollTop: number } | null {
        if (!this.view) return null;
        try {
            const pos = this.view.state.selection.main.head;
            const line = this.view.state.doc.lineAt(pos);
            const col = pos - line.from + 1;
            const scrollTop = this.view.scrollDOM?.scrollTop || 0;
            return { cursorLine: line.number, cursorCol: col, scrollTop };
        } catch {
            return null;
        }
    }

    private applyHostTransferState(state: EditorHostTransferState): void {
        if (!state) return;
        if (typeof state.path === 'string' && state.path) {
            this.path = state.path;
        }
        if (typeof state.initialContent === 'string') {
            this.initialContent = state.initialContent;
        }
        if (typeof state.mtime === 'string' || state.mtime === null) {
            this.currentMtime = state.mtime || null;
        }
        if ((state.diffMode || null) !== this.diffMode) {
            this.setDiffMode(state.diffMode || null);
        }
        if (this.isDiffMode() && typeof state.initialContent === 'string') {
            const viewState = this.captureViewState();
            this.renderEditorSurface(this.getContent() ?? state.content ?? this.initialContent, this.diffMode, viewState);
        }
        if (state.viewState) {
            requestAnimationFrame(() => this.restoreViewState(state.viewState || null));
        }
        if (typeof state.dirty === 'boolean') {
            this.setDirty(state.dirty);
        }
    }

    /** Compare content to baseline and update dirty state. */
    private checkDirty(): void {
        if (!this.view) return;
        const current = this.view.state.doc.toString();
        this.setDirty(current !== this.initialContent);
    }

    private setDirty(dirty: boolean): void {
        if (this.dirty === dirty) return;
        this.dirty = dirty;
        this.dirtyChangeCb?.(dirty);
        this.updateSaveButton();
        this.updateStatusText(dirty ? 'Unsaved changes' : 'All changes saved');
    }

    // ── Toggle features ─────────────────────────────────────────

    private toggleVim(): void {
        this.vimEnabled = !this.vimEnabled;
        this.vimEnabledRef.current = this.vimEnabled;
        setLocalBool('piclaw_vim_mode', this.vimEnabled);
        if (this._vimBtn) this._vimBtn.className = `editor-status-button${this.vimEnabled ? ' active' : ''}`;
        this.view?.dispatch({
            effects: this.vimCompartment.reconfigure(this.vimEnabled ? vim() : []),
        });
    }

    private toggleWhitespace(): void {
        if (this.isWhitespaceDisabledInCurrentMode()) {
            this.updateStatusText('Whitespace is disabled in Live Preview');
            return;
        }
        this.showWhitespace = !this.showWhitespace;
        setLocalBool('piclaw_show_whitespace', this.showWhitespace);
        if (this._wsBtn) this._wsBtn.className = `editor-status-button${this.showWhitespace ? ' active' : ''}`;
        this.view?.dispatch({
            effects: this.whitespaceCompartment.reconfigure(this.showWhitespace ? highlightWhitespace() : []),
        });
        this.baselineView?.dispatch({
            effects: this.baselineWhitespaceCompartment.reconfigure(this.showWhitespace ? highlightWhitespace() : []),
        });
    }

    // ── Theme ───────────────────────────────────────────────────

    /** Build an EditorView.theme override that uses the host's --accent-color. */
    private buildAccentTheme(): ReturnType<typeof EditorView.theme> {
        const style = getComputedStyle(this.ownerDocument.documentElement);
        const accent = style.getPropertyValue('--accent-color').trim() || '#1d9bf0';
        // Parse hex to extract RGB for alpha variants
        const hexToRgb = (hex: string): string => {
            const h = hex.replace('#', '');
            const r = parseInt(h.substring(0, 2), 16);
            const g = parseInt(h.substring(2, 4), 16);
            const b = parseInt(h.substring(4, 6), 16);
            return `${r}, ${g}, ${b}`;
        };
        let rgb: string;
        try { rgb = hexToRgb(accent); } catch { rgb = '29, 155, 240'; }

        return EditorView.theme({
            '.cm-cursor, .cm-dropCursor': { borderLeftColor: accent },
            '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
                backgroundColor: `rgba(${rgb}, 0.2) !important`,
            },
            '.cm-activeLine': { backgroundColor: `rgba(${rgb}, 0.06)` },
            '.cm-selectionMatch': { backgroundColor: `rgba(${rgb}, 0.15)` },
        });
    }

    private handleThemeChange(): void {
        if (!this.view || this.disposed) return;
        const isDark = getThemeMode(this.ownerDocument) === 'dark';

        this.view.dispatch({
            effects: [
                this.themeCompartment.reconfigure(isDark ? githubDark : githubLight),
                this.accentCompartment.reconfigure(this.buildAccentTheme()),
            ],
        });
        this.baselineView?.dispatch({
            effects: [
                this.baselineThemeCompartment.reconfigure(isDark ? githubDark : githubLight),
                this.baselineAccentCompartment.reconfigure(this.buildAccentTheme()),
            ],
        });
    }

    // ── Keyboard shortcuts ──────────────────────────────────────

    private handleGlobalKeydown(e: KeyboardEvent): void {
        // Mod+S → save
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            this.handleSave();
            return;
        }

        const isAltOnly = e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey;
        if (isAltOnly && (e.key === 'w' || e.key === 'W')) {
            e.preventDefault();
            e.stopPropagation();
            this.toggleWhitespace();
            return;
        }
        if (isAltOnly && (e.key === 'v' || e.key === 'V')) {
            e.preventDefault();
            e.stopPropagation();
            this.toggleVim();
            return;
        }
        if (isAltOnly && (e.key === 'p' || e.key === 'P')) {
            e.preventDefault();
            e.stopPropagation();
            this.toggleLivePreview();
            return;
        }
        if (isAltOnly && (e.key === 'q' || e.key === 'Q')) {
            e.preventDefault();
            e.stopPropagation();
            this.closeCb?.();
            return;
        }
        if (e.key === 'Escape' && !e.defaultPrevented && !this.dirty) {
            this.closeCb?.();
        }
    }

    // ── UI updates ──────────────────────────────────────────────

    private setLoadingUI(loading: boolean): void {
        if (loading) {
            this.bodyEl.classList.add('disabled');
            this.updateStatusText('Loading…');
        } else {
            this.bodyEl.classList.remove('disabled');
            this.updateStatusText('Ready');
        }
    }

    private setErrorUI(message: string): void {
        this.bodyEl.classList.add('disabled');
        // Insert error element before body
        let errEl = this.paneEl.querySelector('.editor-error');
        if (!errEl) {
            errEl = this.ownerDocument.createElement('div');
            errEl.className = 'editor-error';
            this.paneEl.insertBefore(errEl, this.bodyEl);
        }
        errEl.textContent = message;
    }

    private updateSaveButton(): void {
        if (!this._saveBtn) return;
        this._saveBtn.disabled = !this.dirty || this.saving;
        this._saveBtn.textContent = this.saving ? 'Saving…' : 'Save';
        this._saveBtn.title = this.dirty ? 'Save changes' : 'No changes to save';
    }

    private async refreshBranchHint(): Promise<void> {
        const token = ++this.branchRequestToken;
        const path = this.path || '';
        if (!path) {
            this.setBranchHint(null, null);
            return;
        }
        try {
            const payload = await getWorkspaceBranch(path);
            if (this.disposed || token !== this.branchRequestToken) return;
            this.setBranchHint(payload?.branch || null, payload?.repo_path || null);
        } catch {
            if (this.disposed || token !== this.branchRequestToken) return;
            this.setBranchHint(null, null);
        }
    }

    private setBranchHint(branch: string | null, repoPath: string | null): void {
        if (!this._branchHint || !this._branchLabel) return;
        const label = typeof branch === 'string' ? branch.trim() : '';
        if (!label) {
            this._branchHint.hidden = true;
            this._branchHint.removeAttribute('title');
            this._branchLabel.textContent = '';
            return;
        }
        this._branchLabel.textContent = label;
        this._branchHint.title = repoPath && repoPath !== '.'
            ? `Git branch: ${label} (${repoPath})`
            : `Git branch: ${label}`;
        this._branchHint.hidden = false;
    }

    // ── External change detection ───────────────────────────────

    private initConflictMonitor(): void {
        this.conflictMonitor?.dispose();
        if (!this.path) return;
        this.conflictMonitor = createFileConflictMonitor({
            path: this.path,
            getCurrentMtime: () => this.currentMtime,
            anchorParent: this.paneEl,
            anchorBefore: this.bodyEl,
            ownerDocument: this.ownerDocument,
            onReload: async () => {
                this.updateStatusText('Reloading…');
                try {
                    const data = await getWorkspaceFile(this.path, EDITOR_MAX_BYTES, 'edit');
                    if (this.disposed) return;
                    if (data?.error) { this.updateStatusText(`Reload failed: ${data.error}`); return; }
                    const viewState = this.captureViewState();
                    this.initialContent = data?.text || '';
                    this.currentMtime = data?.mtime || null;
                    this.renderEditorSurface(this.initialContent, this.diffMode, viewState);
                    this.setDirty(false);
                    this.updateStatusText('Reloaded from disk');
                    this.conflictMonitor?.onSaved(this.currentMtime);
                } catch (err: any) {
                    this.updateStatusText(`Reload failed: ${err?.message || 'Unknown error'}`);
                }
            },
            onSaveCopy: async (copyPath) => {
                if (!this.view) return;
                const content = this.view.state.doc.toString();
                this.updateStatusText(`Saving copy to ${copyPath}…`);
                try {
                    await updateWorkspaceFile(copyPath, content);
                    this.updateStatusText(`Copy saved as ${copyPath}`);
                } catch (err: any) {
                    this.updateStatusText(`Save copy failed: ${err?.message || 'Unknown error'}`);
                }
            },
            onOverwrite: () => this.handleSave(),
        });
        this.conflictMonitor.start();
    }

    private updateStatusText(text: string): void {
        if (this._statusText) this._statusText.textContent = text;
    }

    private updateGutterWidth(): void {
        if (!this.view) return;
        const gutters = this.view.dom.querySelector('.cm-gutters');
        if (!gutters) return;
        const width = Math.max(32, Math.round(gutters.getBoundingClientRect().width));
        this.paneEl.style.setProperty('--cm-gutter-width', `${width}px`);
    }

    // ── PaneInstance contract ────────────────────────────────────

    getContent(): string | undefined {
        return this.view?.state.doc.toString();
    }

    isDirty(): boolean {
        return this.dirty;
    }

    setContent(content: string, mtime: string): void {
        if (!this.view) {
            this.mountEditor(content, mtime);
            return;
        }
        const viewState = this.captureViewState();
        this.initialContent = content;
        this.currentMtime = mtime;
        this.renderEditorSurface(content, this.diffMode, viewState);
        this.setDirty(false);
    }

    focus(): void {
        const cm = this.view?.contentDOM;
        if (cm) cm.focus();
    }

    resize(): void {
        // CodeMirror handles resize internally
        this.updateGutterWidth();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.conflictMonitor?.dispose();
        this.unbindHostListeners();
        this.destroyEditorViews();
        this.container.innerHTML = '';
        this.dirtyChangeCb = null;
        this.saveRequestCb = null;
        this.closeCb = null;
        this.viewStateChangeCb = null;
    }

    onDirtyChange(cb: (dirty: boolean) => void): void {
        this.dirtyChangeCb = cb;
    }

    onSaveRequest(cb: (content: string) => void): void {
        this.saveRequestCb = cb;
    }

    onClose(cb: () => void): void {
        this.closeCb = cb;
    }

    beforeDetachFromHost(_context: PaneHostDetachContext): void {
        const viewState = this.captureViewState();
        if (viewState && this.viewStateChangeCb) {
            this.viewStateChangeCb(viewState);
        }
        this.updateStatusText('Moving pane…');
    }

    afterAttachToHost(_context: PaneHostAttachContext): void {
        this.updateLivePreviewControlState();
        this.updateWhitespaceControlState();
        this.updateGutterWidth();
        this.updateSaveButton();
        this.updateStatusText(this.dirty ? 'Unsaved changes' : 'All changes saved');
        requestAnimationFrame(() => this.focus());
    }

    moveHost(container: HTMLElement, context: PaneHostAttachContext): boolean {
        if (this.disposed) return false;
        const transferState = normalizeEditorHostTransferState(context.transferState) || normalizeEditorHostTransferState(this.exportHostTransferState());
        this.unbindHostListeners();
        if (this.container && this.container !== container) {
            this.container.innerHTML = '';
        }
        this.initializeHostDom(container);
        this.bindHostListeners();
        if (transferState?.content !== undefined) {
            this.mountEditor(transferState.content, transferState.mtime);
            this.applyHostTransferState(transferState);
        }
        this.afterAttachToHost(context);
        void this.refreshBranchHint();
        return true;
    }

    exportHostTransferState(): Record<string, unknown> | null {
        return {
            kind: 'editor',
            path: this.path,
            content: this.getContent() ?? '',
            initialContent: this.initialContent,
            mtime: this.currentMtime,
            dirty: this.dirty,
            diffMode: this.diffMode,
            viewState: this.captureViewState(),
        };
    }

    // ── Extended PaneInstance methods ────────────────────────────

    /** Register callback for view state changes (cursor, scroll). */
    onViewStateChange(cb: (state: { cursorLine: number; cursorCol: number; scrollTop: number }) => void): void {
        this.viewStateChangeCb = cb;
    }

    /** Restore view state (cursor position + scroll). */
    restoreViewState(viewState: { cursorLine?: number; cursorCol?: number; scrollTop?: number } | null): void {
        restoreEditorViewStateBestEffort(this.view, viewState, requestAnimationFrame);
    }

    /** Get the file path this instance is editing. */
    getPath(): string {
        return this.path;
    }

    /** Update the file path (after rename). */
    setPath(newPath: string): void {
        this.path = newPath;
        if (!this.isLivePreviewAvailable()) {
            void this.applyLivePreview(false);
        } else if (this.livePreviewEnabled) {
            void this.applyLivePreview(true);
        }
        this.updateLivePreviewControlState();
        this.updateWhitespaceControlState();
        void this.refreshBranchHint();
    }

    setDiffMode(mode: 'saved' | null): void {
        const nextMode = mode === 'saved' ? 'saved' : null;
        if (this.diffMode === nextMode) return;
        const content = this.getContent() ?? this.initialContent;
        const viewState = this.captureViewState();
        this.diffMode = nextMode;
        this.renderEditorSurface(content, this.diffMode, viewState);
        this.updateLivePreviewControlState();
        this.updateWhitespaceControlState();
        this.updateGutterWidth();
        this.checkDirty();
    }
}

// ── Extension registration ──────────────────────────────────────

/**
 * Standalone editor pane extension. Handles all text files.
 * Creates CodeMirror directly — no Preact component intermediary.
 */
export const editorPaneExtension: WebPaneExtension = {
    id: 'editor',
    label: 'Editor',
    icon: 'edit',
    capabilities: ['edit'] as PaneCapability[],
    placement: 'tabs',

    canHandle(context: PaneContext): boolean | number {
        // Default/fallback pane for all files with a path.
        // Low priority (1) so specialized viewers can override.
        if (!context.path) return false;
        return 1;
    },

    mount(container: HTMLElement, context: PaneContext): PaneInstance {
        return new StandaloneEditorInstance(container, context);
    },
};

/** Type alias for host-side access to extended methods. */
export type { StandaloneEditorInstance as EditorPaneInstance };
