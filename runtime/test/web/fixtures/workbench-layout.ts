import { html, render, useRef, useState, useCallback } from '../../../web/src/vendor/preact-htm.js';
import { ChatSurface } from '../../../web/src/components/chat-surface.js';
import { WorkbenchSidebar } from '../../../web/src/components/workbench-sidebar.js';
import { WorkbenchStatusBar } from '../../../web/src/components/workbench-statusbar.js';
import { TimelineMenu } from '../../../web/src/components/timeline-menu.js';
import { SettingsTabBridge } from '../../../web/src/components/settings-tab-bridge.js';
import { requestOpenSettingsDialog } from '../../../web/src/components/settings-dialog-events.js';
import { useSplitters, setEditorPaneCollapsed } from '../../../web/src/ui/use-splitters.js';
import { useAppShellShortcuts } from '../../../web/src/ui/app-shell-shortcuts.js';
import { buildMainShellClassName } from '../../../web/src/ui/app-main-shell-render.js';

// Mirrors the structure rendered by app-main-shell-render: activity bar and side bar
// (Sessions or Explorer) | chat | editor and viewer tabs, plus the status bar.
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
// Probes: status polls, list refreshes, new-tab opens and settings requests.
const probes = { statusCalls: [] as string[], refreshes: 0, opened: [] as string[], settings: 0, plans: 0, actions: [] as string[], editors: [] as string[], widthRequests: [] as number[] };
window.addEventListener('piclaw:editor-min-width', (event) => probes.widthRequests.push((event as CustomEvent).detail.width));
(window as any).requestOpenSettingsDialog = requestOpenSettingsDialog;
chats.push({ chat_jid: 'web:attic', agent_name: 'attic', root_chat_jid: 'web:attic', is_active: false, archived_at: '2026-11-01T00:00:00Z' } as any);
const sessionActions = {
  createRoot: async (name: string) => { probes.actions.push(`create:${name}`); },
  fork: async () => { probes.actions.push('fork'); },
  rename: () => { probes.actions.push('rename'); },
  archive: async (jid: string) => { probes.actions.push(`archive:${jid}`); },
  restore: async (jid: string) => { probes.actions.push(`restore:${jid}`); },
  purge: async (jid: string) => { probes.actions.push(`purge:${jid}`); },
};
const loadSessionStatus = async (jid: string) => {
  probes.statusCalls.push(jid);
  return { status: 'active', data: { type: 'tool_call', turn_id: 't1', tool_name: 'bash', tool_args: { command: 'make test' } } };
};
window.open = ((url: string) => { probes.opened.push(String(url)); return null; }) as typeof window.open;
const params = new URLSearchParams(location.search);
// ?running=1: a turn is running a tool, so the agent status line is live.
const runningStatus = params.get('running') === '1'
  ? { type: 'tool_call', title: 'bash: make test', tool_name: 'bash', tool_args: { command: 'cd /workspace/piclaw && make test' }, started_at: new Date(Date.now() - 4000).toISOString(), turn_id: 'turn-1' }
  : null;
const contextUsage = { tokens: 42000, contextWindow: 100000, percent: 42 };

function Fixture() {
  const shell = useRef(null), timeline = useRef(null), sidebar = useRef(280), editor = useRef(320), dock = useRef(200);
  const [workspaceOpen, setWorkspaceOpen] = useState(params.get('tree') === '1');
  const [editorOpen] = useState(params.get('editor') === '1');
  const [current, setCurrent] = useState('web:default');
  const toggleWorkspace = useCallback(() => setWorkspaceOpen((open) => !open), []);
  const setWorkspaceVisible = useCallback((next: boolean) => setWorkspaceOpen(Boolean(next)), []);
  const splitters = useSplitters({ appShellRef: shell, sidebarWidthRef: sidebar, editorWidthRef: editor, dockHeightRef: dock });
  useAppShellShortcuts({ hasDockPanes: false, toggleDock: () => {}, toggleZenMode: () => {}, exitZenMode: () => {}, zenMode: false, toggleWorkspace });
  (window as any).workbench = { shell: () => shell.current, current: () => current, workspaceOpen: () => workspaceOpen, probes };
  return html`<div class=${buildMainShellClassName({ workspaceOpen, editorOpen, zenMode: false })} ref=${shell} style="--editor-width:320px;--sidebar-width:280px">
    <${WorkbenchSidebar} activeChatAgents=${chats} currentChatJid=${current} onSwitchChat=${setCurrent} appShellRef=${shell}
      loadSessionStatus=${loadSessionStatus} onRefreshSessions=${() => { probes.refreshes += 1; }}
      workspaceOpen=${workspaceOpen} setWorkspaceVisible=${setWorkspaceVisible} onOpenSettings=${() => { probes.settings += 1; }} onOpenPlan=${() => { probes.plans += 1; }} sessionActions=${sessionActions}
      explorer=${html`<aside class="workspace-sidebar"><div class="workspace-header"><div class="workspace-header-left"><span>Workspace</span></div></div><div class="workspace-tree">notes.md</div></aside>`} />
    <${TimelineMenu} workspaceOpen=${workspaceOpen} toggleWorkspace=${toggleWorkspace} openEditor=${(path: string) => probes.editors.push(path)}
      onOpenTerminalTab=${() => probes.actions.push('terminal')} />
    <div class="container"><${ChatSurface} currentChatJid=${current} posts=${posts} timelineRef=${timeline} hasMore=${false}
      agentStatus=${runningStatus} currentTurnId=${runningStatus ? 'turn-1' : null} loadStatusWorkspaceBranch=${async () => ({ branch: 'main', repo_path: 'piclaw' })}
      composeProps=${{ currentChatJid: current, onPost: () => {}, services, activeChatAgents: chats, activeModel: 'provider/model', contextUsage, agentModels: { current: 'provider/model', thinking_level: 'high' }, capabilities: { speech: true, media: true, location: false, notifications: false, modelPicker: true, commands: false } }} /></div>
    ${editorOpen && html`
      <div class="editor-splitter" onMouseDown=${splitters.handleEditorSplitterMouseDown} onTouchStart=${splitters.handleEditorSplitterTouchStart} onKeyDown=${splitters.handleEditorSplitterKeyDown} onDblClick=${splitters.handleEditorSplitterDoubleClick} role="separator" aria-orientation="vertical" aria-label="Resize editor" tabIndex="0"></div>
      <div class="editor-pane-container"><div class="tab-strip"><button class="tab-item active">notes.md</button></div><div class="editor-pane-host"><pre>Editor content</pre></div></div>
      <button type="button" class="editor-pane-back" onClick=${() => setEditorPaneCollapsed(shell.current, true)} aria-label="Back to chat"><span>Chat</span></button>
      <button type="button" class="editor-pane-restore" onClick=${() => setEditorPaneCollapsed(shell.current, false)} aria-label="Show editor"><span>Editor</span></button>
    `}
    <${WorkbenchStatusBar} />
    <${SettingsTabBridge} openEditor=${(path: string) => probes.editors.push(path)} />
  </div>`;
}
render(html`<${Fixture} />`, document.getElementById('app')!);
