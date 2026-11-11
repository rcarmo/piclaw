import { html, render, useRef, useState, useCallback } from '../../../web/src/vendor/preact-htm.js';
import { ChatSurface } from '../../../web/src/components/chat-surface.js';
import { SessionsSidebar } from '../../../web/src/components/sessions-sidebar.js';
import { useSplitters, setEditorPaneCollapsed } from '../../../web/src/ui/use-splitters.js';
import { useAppShellShortcuts } from '../../../web/src/ui/app-shell-shortcuts.js';
import { buildMainShellClassName } from '../../../web/src/ui/app-main-shell-render.js';

// Mirrors the pane order and class names rendered by app-main-shell-render (#1987): sessions | chat | tree | editor.
const posts = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, type: 'user', data: { content: `Message ${i + 1} with a path /workspace/example/source-file.ts`, timestamp: '2026-11-10T00:00:00Z' } }));
const services = { fetchCommands: async () => ({ commands: [] }), getAgentModels: async () => ({ current: 'provider/model', thinking_level: 'high', supports_thinking: true, model_options: [] }) };
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const chats = ['default', 'release-notes', 'proxmox', 'tree-eval', 'steering-latency', 'lunch'].map((name, i) => ({
  chat_jid: `web:${name}`, agent_name: name, root_chat_jid: `web:${name}`, is_active: i === 2,
  activity_status: i === 2 ? 'working' : 'idle',
  last_activity_at: minutesAgo(i * 7 + 3),
  last_reply: i === 2 ? 'Previous proxmox reply' : `## Summary for ${name}\n\nThe **${name}** session finished its last task.`,
  context_percent: i === 0 ? 42 : null,
}));
// Session activity probes (#1987): status polls, list refreshes and new-tab opens.
const probes = { statusCalls: [] as string[], refreshes: 0, opened: [] as string[] };
const loadSessionStatus = async (jid: string) => {
  probes.statusCalls.push(jid);
  return { status: 'active', data: { type: 'tool_call', turn_id: 't1', tool_name: 'bash', tool_args: { command: 'make test' } } };
};
window.open = ((url: string) => { probes.opened.push(String(url)); return null; }) as typeof window.open;
const params = new URLSearchParams(location.search);

function Fixture() {
  const shell = useRef(null), timeline = useRef(null), sidebar = useRef(280), editor = useRef(320), dock = useRef(200);
  const [workspaceOpen, setWorkspaceOpen] = useState(params.get('tree') === '1');
  const [editorOpen] = useState(params.get('editor') === '1');
  const [current, setCurrent] = useState('web:default');
  const toggleWorkspace = useCallback(() => setWorkspaceOpen((open) => !open), []);
  const splitters = useSplitters({ appShellRef: shell, sidebarWidthRef: sidebar, editorWidthRef: editor, dockHeightRef: dock });
  useAppShellShortcuts({ hasDockPanes: false, chatOnlyMode: false, toggleDock: () => {}, toggleZenMode: () => {}, exitZenMode: () => {}, zenMode: false, toggleWorkspace });
  (window as any).threePane = { shell: () => shell.current, current: () => current, workspaceOpen: () => workspaceOpen, probes };
  return html`<div class=${buildMainShellClassName({ workspaceOpen, editorOpen, chatOnlyMode: false, zenMode: false })} ref=${shell} style="--editor-width:320px;--sidebar-width:280px">
    <${SessionsSidebar} activeChatAgents=${chats} currentChatJid=${current} onSwitchChat=${setCurrent} appShellRef=${shell}
      loadSessionStatus=${loadSessionStatus} onRefreshSessions=${() => { probes.refreshes += 1; }} />
    <div class="container"><${ChatSurface} currentChatJid=${current} posts=${posts} timelineRef=${timeline} hasMore=${false}
      composeProps=${{ currentChatJid: current, onPost: () => {}, services, activeChatAgents: chats, agentModels: { current: 'provider/model', thinking_level: 'high' }, capabilities: { speech: true, media: true, location: false, notifications: false, modelPicker: true, commands: false } }} /></div>
    <div class="workspace-splitter" onMouseDown=${splitters.handleSplitterMouseDown} onTouchStart=${splitters.handleSplitterTouchStart} onKeyDown=${splitters.handleSplitterKeyDown} onDblClick=${splitters.handleSplitterDoubleClick} role="separator" aria-orientation="vertical" aria-label="Resize file tree" tabIndex="0"></div>
    <button class=${`workspace-toggle-tab${workspaceOpen ? ' open' : ' closed'}`} onClick=${toggleWorkspace} aria-label=${workspaceOpen ? 'Hide workspace' : 'Show workspace'} aria-expanded=${workspaceOpen ? 'true' : 'false'}>
      <svg class="workspace-toggle-tab-icon" viewBox="0 0 16 16"><polyline points="6 3 11 8 6 13" /></svg>
    </button>
    <aside class="workspace-sidebar"><div class="workspace-header"><div class="workspace-header-left"><span>Workspace</span></div></div><div class="workspace-tree">notes.md</div></aside>
    ${workspaceOpen && html`<div class="workspace-drawer-backdrop" onClick=${toggleWorkspace} aria-hidden="true"></div>`}
    ${editorOpen && html`
      <div class="editor-splitter" onMouseDown=${splitters.handleEditorSplitterMouseDown} onTouchStart=${splitters.handleEditorSplitterTouchStart} onKeyDown=${splitters.handleEditorSplitterKeyDown} onDblClick=${splitters.handleEditorSplitterDoubleClick} role="separator" aria-orientation="vertical" aria-label="Resize editor" tabIndex="0"></div>
      <div class="editor-pane-container"><div class="tab-strip"><button class="tab-item active">notes.md</button></div><div class="editor-pane-host"><pre>Editor content</pre></div></div>
      <button type="button" class="editor-pane-back" onClick=${() => setEditorPaneCollapsed(shell.current, true)} aria-label="Back to chat"><span>Chat</span></button>
      <button type="button" class="editor-pane-restore" onClick=${() => setEditorPaneCollapsed(shell.current, false)} aria-label="Show editor"><span>Editor</span></button>
    `}
  </div>`;
}
render(html`<${Fixture} />`, document.getElementById('app')!);
