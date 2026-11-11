import { html } from '../vendor/preact-htm.js';
import { MarkdownPreview } from '../components/markdown-preview.js';

export type AppShellRenderMode = 'branch-loader' | 'pane-popout' | 'main';

export interface ResolveAppShellRenderModeOptions {
  branchLoaderMode: boolean;
  panePopoutMode: boolean;
}

export function resolveAppShellRenderMode(options: ResolveAppShellRenderModeOptions): AppShellRenderMode {
  if (options.branchLoaderMode) return 'branch-loader';
  if (options.panePopoutMode) return 'pane-popout';
  return 'main';
}

export function resolveBranchLoaderHeading(status: string | null | undefined): string {
  return status === 'error' ? 'Could not open branch window' : 'Opening branch…';
}

export interface BranchLoaderState {
  status: string;
  message: string;
}

export function renderBranchLoaderMode(branchLoaderState: BranchLoaderState): any {
  return html`
    <div class="app-shell branch-loader-shell">
      <div class="container" style=${{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px' }}>
        <div class="card" style=${{ width: 'min(560px, 100%)', padding: '24px' }}>
          <h1 style=${{ margin: '0 0 12px', fontSize: '1.1rem' }}>
            ${resolveBranchLoaderHeading(branchLoaderState.status)}
          </h1>
          <p style=${{ margin: 0, lineHeight: 1.6 }}>${branchLoaderState.message}</p>
        </div>
      </div>
    </div>
  `;
}

interface PanePopoutTab {
  id: string;
  label: string;
}

export interface RenderPanePopoutModeOptions {
  appShellRef: { current: any };
  editorOpen: boolean;
  hidePanePopoutControls: boolean;
  panePopoutHasMenuActions: boolean;
  panePopoutTitle: string;
  tabStripTabs: PanePopoutTab[];
  tabStripActiveId: string | null;
  handleTabActivate: (tabId: string) => void;
  previewTabs: Set<string>;
  diffTabs: Set<string>;
  handleTabTogglePreview: (tabId: string) => void;
  handleTabToggleDiff: (tabId: string) => void;
  editorContainerRef: { current: any };
  getPaneContent: () => string | null | undefined;
  subscribePaneContentChange?: (cb: (content: string) => void) => (() => void) | void;
  panePopoutPath: string | null;
  canReattachPane?: boolean;
  handleReattachPane?: () => void;
}

export function renderPanePopoutMode(options: RenderPanePopoutModeOptions): any {
  const {
    appShellRef,
    editorOpen,
    hidePanePopoutControls,
    panePopoutHasMenuActions,
    panePopoutTitle,
    tabStripTabs,
    tabStripActiveId,
    handleTabActivate,
    previewTabs,
    diffTabs,
    handleTabTogglePreview,
    handleTabToggleDiff,
    editorContainerRef,
    getPaneContent,
    subscribePaneContentChange,
    panePopoutPath,
  } = options;

  const showControls = editorOpen && !hidePanePopoutControls && panePopoutHasMenuActions;
  const controlsLabel = panePopoutTitle ? `Pane window controls for ${panePopoutTitle}` : 'Pane window controls';

  return html`
    <div class=${`app-shell pane-popout${editorOpen ? ' editor-open' : ''}`} ref=${appShellRef}>
      <div class="editor-pane-container pane-popout-container">
        ${showControls && html`
          <div class="pane-popout-hover-zone" aria-hidden="true"></div>
          <div class="pane-popout-controls" role="toolbar" aria-label=${controlsLabel}>
            <details class="pane-popout-controls-menu">
              <summary
                class="pane-popout-controls-trigger pane-popout-controls-icon-button"
                aria-label=${controlsLabel}
                title=${controlsLabel}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 4.75h10" />
                  <path d="M5 8h8" />
                  <path d="M7 11.25h6" />
                </svg>
              </summary>
              <div class="pane-popout-controls-panel">
                ${tabStripTabs.length > 1 && html`
                  <div class="pane-popout-controls-section">
                    <div class="pane-popout-controls-section-title">Open panes</div>
                    <div class="pane-popout-controls-list">
                      ${tabStripTabs.map((tab) => html`
                        <button
                          type="button"
                          class=${`pane-popout-controls-item${tab.id === tabStripActiveId ? ' active' : ''}`}
                          onClick=${(event: any) => {
                            handleTabActivate(tab.id);
                            event.currentTarget.closest('details')?.removeAttribute('open');
                          }}
                        >
                          ${tab.label}
                        </button>
                      `)}
                    </div>
                  </div>
                `}
                ${tabStripActiveId && diffTabs.has(tabStripActiveId) && html`
                  <button
                    type="button"
                    class="pane-popout-controls-action"
                    onClick=${(event: any) => {
                      handleTabToggleDiff(tabStripActiveId);
                      event.currentTarget.closest('details')?.removeAttribute('open');
                    }}
                  >
                    Hide diff
                  </button>
                `}
                ${tabStripActiveId && previewTabs.has(tabStripActiveId) && html`
                  <button
                    type="button"
                    class="pane-popout-controls-action"
                    onClick=${(event: any) => {
                      handleTabTogglePreview(tabStripActiveId);
                      event.currentTarget.closest('details')?.removeAttribute('open');
                    }}
                  >
                    Hide preview
                  </button>
                `}
              </div>
            </details>
          </div>
        `}
        ${editorOpen
          ? html`<div class="editor-pane-host" ref=${editorContainerRef}></div>`
          : html`
            <div class="card" style=${{ margin: '24px', padding: '24px', maxWidth: '640px' }}>
              <h1 style=${{ margin: '0 0 12px', fontSize: '1.1rem' }}>Opening pane…</h1>
              <p style=${{ margin: 0, lineHeight: 1.6 }}>${panePopoutPath || 'No pane path provided.'}</p>
            </div>
          `}
        ${editorOpen && tabStripActiveId && previewTabs.has(tabStripActiveId) && html`
          <${MarkdownPreview}
            getContent=${getPaneContent}
            subscribeContentChange=${subscribePaneContentChange}
            path=${tabStripActiveId}
            onClose=${() => handleTabTogglePreview(tabStripActiveId)}
          />
        `}
      </div>
    </div>
  `;
}
