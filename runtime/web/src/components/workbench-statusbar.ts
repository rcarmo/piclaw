// @ts-nocheck
/**
 * workbench-statusbar.ts — Status bar for the Classic workbench.
 *
 * The left side holds the current model, its usage and the context meter
 * (rendered here by the compose box, which keeps the model picker and
 * compaction behaviour). The right side holds the system meters while the
 * side bar is not shown and the meters are switched on; while the side bar is
 * shown they sit at its foot instead. Narrow layouts stack the two groups.
 */
import { html, useEffect, useLayoutEffect, useRef, useState } from '../vendor/preact-htm.js';
import { SystemMetersHud } from './system-meters-hud.js';
import { WORKBENCH_TOGGLE_EVENT } from './workbench-sidebar.js';
import { announceStatusbarComposeSlot } from './workbench-statusbar-slot.js';
import { METERS_COLLAPSED_EVENT_NAME, readStoredMetersCollapsed } from '../ui/meters.js';

function readSidebarShown(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('.app-shell')?.getAttribute('data-workbench-sidebar') === 'shown';
}

export function WorkbenchStatusBar() {
  const barRef = useRef(null);
  const [sidebarShown, setSidebarShown] = useState(readSidebarShown);
  const [metersOn, setMetersOn] = useState(() => !readStoredMetersCollapsed(false));

  useEffect(() => {
    const sync = (event) => setSidebarShown(typeof event?.detail?.open === 'boolean' ? event.detail.open : readSidebarShown());
    const syncMeters = (event) => setMetersOn(!(typeof event?.detail?.collapsed === 'boolean' ? event.detail.collapsed : readStoredMetersCollapsed(false)));
    window.addEventListener(WORKBENCH_TOGGLE_EVENT, sync);
    window.addEventListener(METERS_COLLAPSED_EVENT_NAME, syncMeters);
    sync();
    return () => {
      window.removeEventListener(WORKBENCH_TOGGLE_EVENT, sync);
      window.removeEventListener(METERS_COLLAPSED_EVENT_NAME, syncMeters);
    };
  }, []);

  // The compose box renders its model and context indicators into the slot.
  useLayoutEffect(() => {
    announceStatusbarComposeSlot();
    return () => { queueMicrotask(announceStatusbarComposeSlot); };
  }, []);

  // Wrapping stats and optional meter rows reserve only their actual height.
  // Keep the safe-area padding separate: layout and keyboard placement add it.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const root = document.documentElement;
    const syncHeight = () => {
      const height = `${bar.clientHeight - parseFloat(getComputedStyle(bar).paddingBottom)}px`;
      if (root.style.getPropertyValue('--workbench-statusbar-height') !== height) {
        root.style.setProperty('--workbench-statusbar-height', height);
      }
    };
    syncHeight();
    // Reserve space outside the observer's delivery cycle (Safari otherwise
    // reports an undelivered resize when the shell changes around the footer).
    let frame = null;
    const observer = new ResizeObserver(() => {
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; syncHeight(); });
    });
    observer.observe(bar);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      root.style.removeProperty('--workbench-statusbar-height');
    };
  }, []);

  return html`
    <footer ref=${barRef} class="workbench-statusbar" role="contentinfo" aria-label="Status bar">
      <div class="workbench-statusbar-compose"></div>
      <span class="workbench-statusbar-spacer"></span>
      ${!sidebarShown && metersOn && html`<${SystemMetersHud} mode="statusbar" />`}
    </footer>
  `;
}
