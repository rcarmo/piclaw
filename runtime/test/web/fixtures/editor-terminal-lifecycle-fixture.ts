import { html, render, useEffect, useState } from '../../../web/src/vendor/preact-htm.js';
import { usePaneRuntimeOrchestration } from '../../../web/src/ui/app-pane-runtime-orchestration.js';
import { tabStore } from '../../../web/src/panes/index.js';
import { StandaloneEditorInstance } from '../../../extensions/viewers/editor/editor-extension.js';

const terminal = 'piclaw://terminal';
const child = location.search.includes('child=1');
function App() {
  const [tabs, setTabs] = useState(tabStore.getTabs());
  const [active, setActive] = useState(tabStore.getActiveId());
  useEffect(() => tabStore.onChange((tabs, id) => { setTabs(tabs); setActive(id); }), []);
  const runtime = usePaneRuntimeOrchestration({
    panePopoutMode: false, panePopoutPath: '', panePopoutLabel: '',
    editorOpen: tabs.length > 0, tabStripTabs: tabs, tabStripActiveId: active,
    previewTabs: new Set(), diffTabs: new Set(), tabPaneOverrides: new Map(),
    terminalTabPath: terminal, vncTabPrefix: 'piclaw://vnc',
    openEditor: (path, opts) => tabStore.open(path, String(opts?.label || path)),
    closeEditor: () => {}, getWorkspaceFile: async () => ({ text: '', mtime: '1' }),
  });
  Object.assign(window, { lifecycle: { runtime, tabStore, terminal } });
  function detach(source: string) {
    if (source === 'tab') tabStore.open(terminal, 'Terminal');
    const transfer = runtime.buildPaneDetachTransfer(terminal)!;
    const params = new URLSearchParams({ child: '1', panePath: terminal, ...transfer.params });
    const popup = window.open('/?' + params, '_blank');
    (window as any).childHandle = popup;
    runtime.registerDetachedPaneWindow(terminal, 'Terminal', popup, transfer.params);
  }
  return html`<div><button id="tab" onClick=${() => detach('tab')}>Detach tab</button><button id="dock" onClick=${() => detach('dock')}>Detach dock</button><input id="focus"/><div id="tabs">${tabs.map(t => t.id).join(',')}</div><div id="dock-state">${String(runtime.dockVisible)}</div></div>`;
}
if (child) {
  const params = new URLSearchParams(location.search);
  window.opener.postMessage({ type: 'piclaw-pane-detach-claim', panePath: terminal,
    paneInstanceId: params.get('pane_instance_id'), paneWindowId: params.get('pane_window_id') }, location.origin);
  document.body.innerHTML = '<button id="close">Close</button>';
  document.querySelector('#close')!.addEventListener('click', () => window.close());
} else {
  render(html`<${App}/>`, document.querySelector('#app')!);
  localStorage.setItem('piclaw_vim_mode', 'false');
  const editor = new StandaloneEditorInstance(document.querySelector('#editor')!, {
    path: 'fixture.txt', content: 'original', mtime: '1',
  } as any);
  Object.assign(window, { editor });
}
