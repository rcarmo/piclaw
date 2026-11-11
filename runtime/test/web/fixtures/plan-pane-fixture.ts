import { planPaneExtension } from '../../../web/src/panes/plan-pane.js';

const host = document.getElementById('pane')!;
const instance = planPaneExtension.mount(host, { path: 'piclaw://plan', mode: 'edit' });
const dirty: boolean[] = [];
instance.onDirtyChange?.((value) => dirty.push(value));
(window as any).planPane = { instance, dirty };
