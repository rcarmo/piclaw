/**
 * workbench-statusbar-slot.ts — where the compose box renders its model and
 * context indicators when the workbench status bar is mounted.
 *
 * The status bar announces its slot; the compose box renders into it, or keeps
 * the indicators in its own footer when there is no status bar (zen mode,
 * fixture pages).
 */
export const STATUSBAR_COMPOSE_SLOT_EVENT = 'piclaw:statusbar-compose-slot';
const SLOT_SELECTOR = '.workbench-statusbar-compose';

export function findStatusbarComposeSlot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector(SLOT_SELECTOR) as HTMLElement | null;
}

export function announceStatusbarComposeSlot(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STATUSBAR_COMPOSE_SLOT_EVENT));
}
