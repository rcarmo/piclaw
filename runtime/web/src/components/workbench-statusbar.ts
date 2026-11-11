// @ts-nocheck
/**
 * workbench-statusbar.ts — Visual-style status bar for the Classic workbench.
 *
 * Holds the system meters whenever the workbench side bar is not shown (it
 * is collapsed, on a narrow screen, or absent in chat-only windows). While the
 * side bar is shown, the meters sit at its foot instead.
 */
import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { SystemMetersHud } from './system-meters-hud.js';
import { WORKBENCH_TOGGLE_EVENT } from './workbench-sidebar.js';

function readSidebarShown(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('.app-shell')?.getAttribute('data-workbench-sidebar') === 'shown';
}

export function WorkbenchStatusBar() {
  const [sidebarShown, setSidebarShown] = useState(readSidebarShown);

  useEffect(() => {
    const sync = (event) => setSidebarShown(typeof event?.detail?.open === 'boolean' ? event.detail.open : readSidebarShown());
    window.addEventListener(WORKBENCH_TOGGLE_EVENT, sync);
    sync();
    return () => window.removeEventListener(WORKBENCH_TOGGLE_EVENT, sync);
  }, []);

  if (sidebarShown) return null;
  return html`
    <footer class="workbench-statusbar" role="contentinfo" aria-label="Status bar">
      <span class="workbench-statusbar-spacer"></span>
      <${SystemMetersHud} mode="statusbar" />
    </footer>
  `;
}
