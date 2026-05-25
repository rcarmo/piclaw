/**
 * plannotator-pane.ts — WebPaneExtension for piclaw://plannotator
 *
 * Mounts a full-page plan review pane using Preact/HTM.
 * The transferState carries a PlannotatorSession snapshot.
 */

import type { PaneCapability, PaneContext, PaneInstance, WebPaneExtension } from './pane-types.js';

export const PLANNOTATOR_TAB_PATH = 'piclaw://plannotator';

export const plannotatorPaneExtension: WebPaneExtension = {
  id: 'plannotator',
  label: 'Plan Review',
  capabilities: ['readonly'] as PaneCapability[],
  placement: 'tabs',

  canHandle(context: PaneContext): boolean {
    return context.path === PLANNOTATOR_TAB_PATH;
  },

  mount(container: HTMLElement, context: PaneContext): PaneInstance {
    const session = context.transferState as any;

    // Render using Preact/HTM via dynamic import to keep bundle lean
    let disposePreact: (() => void) | null = null;

    import('../vendor/preact-htm.js').then(({ render, html }) => {
      import('../components/plannotator-panel.js').then(({ PlannotatorPanel }) => {
        function PlannotatorPaneRoot() {
          return html`
            <div class="plannotator-pane-host">
              <${PlannotatorPanel}
                session=${session}
                onClose=${null}
                onApprove=${null}
                onReject=${null}
                onOpenTab=${null}
                fullPane=${true}
              />
            </div>
          `;
        }
        render(html`<${PlannotatorPaneRoot} />`, container);
        disposePreact = () => {
          try { render(null, container); } catch { /* ignore */ }
        };
      });
    });

    return {
      getContent() { return undefined; },
      isDirty() { return false; },
      focus() { container.focus(); },
      dispose() {
        disposePreact?.();
        container.innerHTML = '';
      },
    };
  },
};
