import { html, render } from '../../../web/src/vendor/preact-htm.js';
import { TimelineMenu } from '../../../web/src/components/timeline-menu.js';
import { WorkspaceExplorer } from '../../../web/src/components/workspace-explorer.js';
import { addRecentFile } from '../../../web/src/ui/recent-files.js';
const surface = new URLSearchParams(location.search).get('surface') || 'workspace';
(window as any).opened = [];
const open = (path: string) => { (window as any).opened.push(path); addRecentFile(path); };
render(surface === 'workspace'
  ? html`<div class="app-shell" style="height:100vh"><${WorkspaceExplorer} visible=${true} onOpenEditor=${open} /><${TimelineMenu} workspaceOpen=${true} toggleWorkspace=${() => {}} openEditor=${open} /><div class="container"></div></div>`
  : html`<${TimelineMenu} workspaceOpen=${false} toggleWorkspace=${() => {}} openEditor=${open} />`, document.getElementById('app')!);
