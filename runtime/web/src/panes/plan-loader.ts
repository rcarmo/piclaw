import type { PaneContext, PaneInstance, WebPaneExtension } from './pane-types.js';

export const PLAN_TAB_PATH = 'piclaw://plan';
let loading: Promise<{ planPaneExtension: WebPaneExtension }> | null = null;
function loadPlan() {
  if (!loading) {
    const url = '/static/classic/dist/plan-pane.bundle.js' + new URL(import.meta.url).search;
    loading = import(url).catch(error => { loading = null; throw error; });
  }
  return loading;
}

// Match the existing editor/tree lazy-loading pattern. Register the slot now;
// fetch the optional view only when opened, without relaxing the app size gate.
export const planPaneExtension: WebPaneExtension = {
  id: 'plan', label: 'Plan', placement: 'tabs', capabilities: ['readonly'],
  canHandle: context => context?.path === PLAN_TAB_PATH ? 9000 : false,
  mount(container: HTMLElement, context: PaneContext): PaneInstance {
    let disposed = false, pane: PaneInstance | undefined;
    const listeners: Array<(dirty: boolean) => void> = [];
    const status = document.createElement('div');
    status.className = 'plan-pane-status'; status.setAttribute('role', 'status');
    status.textContent = 'Loading plan…'; container.appendChild(status);
    void loadPlan().then(module => {
      if (disposed) return;
      status.remove(); pane = module.planPaneExtension.mount(container, context);
      for (const listener of listeners) pane.onDirtyChange?.(listener);
    }).catch(() => {
      if (!disposed) { status.textContent = 'Plan could not load. Close and reopen this tab to retry.'; status.setAttribute('role', 'alert'); }
    });
    return {
      getContent: () => pane?.getContent(),
      isDirty: () => pane?.isDirty() ?? false,
      focus: () => pane?.focus(),
      onDirtyChange(listener) { listeners.push(listener); pane?.onDirtyChange?.(listener); },
      dispose() { disposed = true; pane?.dispose(); status.remove(); },
    };
  },
};
