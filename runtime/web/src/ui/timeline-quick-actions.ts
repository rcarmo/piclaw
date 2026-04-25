export interface TimelineQuickActionsSettingsData {
  workspaceCommands?: string[] | null;
  slashCommands?: string[] | null;
}

export interface TimelineQuickActionAgentLike {
  chat_jid?: unknown;
  agent_name?: unknown;
  session_name?: unknown;
  archived_at?: unknown;
  is_active?: unknown;
}

export interface TimelineQuickActionWorkspaceCommand {
  id: string;
  label: string;
  description: string;
  keywords?: string[];
}

export interface TimelineQuickActionSlashCommand {
  name?: unknown;
  description?: unknown;
  source?: unknown;
}

export interface TimelineQuickActionItem {
  key: string;
  kind: 'agent' | 'workspace' | 'slash';
  title: string;
  subtitle: string;
  searchText: string;
  imageUrl?: string;
  visualHint?: string;
  categoryLabel?: string;
  actionHint?: string;
  chatJid?: string;
  commandId?: string;
  commandName?: string;
}

export const WORKSPACE_QUICK_ACTIONS_CATALOG: TimelineQuickActionWorkspaceCommand[] = [
  {
    id: 'toggle-workspace',
    label: 'Toggle workspace',
    description: 'Show or hide the workspace sidebar.',
    keywords: ['workspace', 'sidebar', 'explorer'],
  },
  {
    id: 'open-explorer',
    label: 'Open explorer',
    description: 'Open the workspace explorer sidebar.',
    keywords: ['workspace', 'explorer', 'sidebar'],
  },
  {
    id: 'toggle-chat-only',
    label: 'Chat-only mode',
    description: 'Toggle chat-only mode.',
    keywords: ['chat', 'mode', 'layout'],
  },
  {
    id: 'open-terminal-tab',
    label: 'Open terminal in tab',
    description: 'Open the terminal pane in a workspace tab.',
    keywords: ['terminal', 'shell', 'tab'],
  },
  {
    id: 'open-vnc-tab',
    label: 'Open VNC in tab',
    description: 'Open the VNC viewer in a workspace tab.',
    keywords: ['vnc', 'remote', 'desktop', 'tab'],
  },
  {
    id: 'toggle-terminal-dock',
    label: 'Toggle terminal dock',
    description: 'Show or hide the terminal dock.',
    keywords: ['terminal', 'dock', 'shell'],
  },
  {
    id: 'open-settings',
    label: 'Settings',
    description: 'Open the settings dialog.',
    keywords: ['settings', 'preferences', 'config'],
  },
];

function normalizeToken(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/^[@/]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function matchesTimelineQuickActionQuery(query: string, ...parts: unknown[]): boolean {
  const normalizedQuery = normalizeToken(query);
  if (!normalizedQuery) return true;
  const haystack = parts
    .map((part) => normalizeToken(part))
    .filter(Boolean);
  for (const value of haystack) {
    if (value.startsWith(normalizedQuery) || value.includes(normalizedQuery)) {
      return true;
    }
  }
  return false;
}

function dedupeStringList(values: unknown): string[] | null {
  if (!Array.isArray(values)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function normalizeTimelineQuickActionsSettingsData(data: unknown): TimelineQuickActionsSettingsData {
  const source = data && typeof data === 'object' ? data as TimelineQuickActionsSettingsData : {};
  return {
    workspaceCommands: dedupeStringList(source.workspaceCommands),
    slashCommands: dedupeStringList(source.slashCommands),
  };
}

function isEnabledBySelection(selection: string[] | null | undefined, value: string): boolean {
  if (!Array.isArray(selection)) return true;
  return selection.some((entry) => entry.toLowerCase() === value.toLowerCase());
}

export function buildWorkspaceQuickActionItems(options: {
  commands?: TimelineQuickActionWorkspaceCommand[] | null;
  settings?: TimelineQuickActionsSettingsData | null;
  query?: string | null;
}): TimelineQuickActionItem[] {
  const commands = Array.isArray(options?.commands) ? options.commands : [];
  const settings = normalizeTimelineQuickActionsSettingsData(options?.settings);
  const query = String(options?.query || '');
  return commands
    .filter((command) => isEnabledBySelection(settings.workspaceCommands, command.id))
    .filter((command) => matchesTimelineQuickActionQuery(query, command.label, command.description, ...(command.keywords || [])))
    .map((command) => ({
      key: `workspace:${command.id}`,
      kind: 'workspace' as const,
      title: command.label,
      subtitle: `${command.description} · runs immediately`,
      searchText: `${command.label} ${command.description} ${(command.keywords || []).join(' ')}`.trim(),
      visualHint: command.label.slice(0, 1).toUpperCase() || 'W',
      categoryLabel: 'Workspace',
      actionHint: 'Run',
      commandId: command.id,
    }));
}

export function buildAgentQuickActionItems(options: {
  agents?: TimelineQuickActionAgentLike[] | null;
  query?: string | null;
}): TimelineQuickActionItem[] {
  const agents = Array.isArray(options?.agents) ? options.agents : [];
  const query = String(options?.query || '');
  const seen = new Set<string>();
  return agents
    .filter((agent) => {
      const chatJid = hasTrimmedString(agent?.chat_jid) ? agent.chat_jid.trim() : '';
      if (!chatJid || seen.has(chatJid)) return false;
      if (agent?.archived_at) return false;
      seen.add(chatJid);
      return true;
    })
    .filter((agent) => matchesTimelineQuickActionQuery(
      query,
      `@${String(agent?.agent_name || '').trim()}`,
      agent?.session_name,
      agent?.chat_jid,
    ))
    .map((agent) => {
      const agentName = hasTrimmedString(agent?.agent_name) ? agent.agent_name.trim() : String(agent?.chat_jid || '').replace(/^[^:]+:/, '');
      const sessionName = hasTrimmedString(agent?.session_name) ? agent.session_name.trim() : '';
      const chatJid = String(agent?.chat_jid || '').trim();
      return {
        key: `agent:${chatJid}`,
        kind: 'agent' as const,
        title: `@${agentName}`,
        subtitle: `${sessionName || chatJid} · switches immediately`,
        searchText: `@${agentName} ${sessionName} ${chatJid}`.trim(),
        visualHint: agentName.slice(0, 1).toUpperCase() || '@',
        categoryLabel: 'Agent',
        actionHint: 'Open',
        chatJid,
      };
    });
}

export function buildSlashQuickActionItems(options: {
  slashCommands?: TimelineQuickActionSlashCommand[] | null;
  settings?: TimelineQuickActionsSettingsData | null;
  query?: string | null;
}): TimelineQuickActionItem[] {
  const slashCommands = Array.isArray(options?.slashCommands) ? options.slashCommands : [];
  const settings = normalizeTimelineQuickActionsSettingsData(options?.settings);
  const query = String(options?.query || '');
  const seen = new Set<string>();
  return slashCommands
    .filter((command) => {
      const name = hasTrimmedString(command?.name) ? command.name.trim() : '';
      if (!name || seen.has(name.toLowerCase())) return false;
      seen.add(name.toLowerCase());
      return isEnabledBySelection(settings.slashCommands, name);
    })
    .filter((command) => matchesTimelineQuickActionQuery(query, command?.name, command?.description, command?.source))
    .map((command) => {
      const name = String(command?.name || '').trim();
      const description = hasTrimmedString(command?.description) ? command.description.trim() : 'slash command';
      const source = hasTrimmedString(command?.source) ? command.source.trim() : '';
      return {
        key: `slash:${name}`,
        kind: 'slash' as const,
        title: name,
        subtitle: `${description} · inserts into compose`,
        searchText: `${name} ${description} ${String(command?.source || '')}`.trim(),
        visualHint: '/',
        categoryLabel: source || 'Slash',
        actionHint: 'Insert',
        commandName: name,
      };
    });
}

export function buildTimelineQuickActionItems(options: {
  agents?: TimelineQuickActionAgentLike[] | null;
  workspaceCommands?: TimelineQuickActionWorkspaceCommand[] | null;
  slashCommands?: TimelineQuickActionSlashCommand[] | null;
  settings?: TimelineQuickActionsSettingsData | null;
  query?: string | null;
}): TimelineQuickActionItem[] {
  return [
    ...buildAgentQuickActionItems({ agents: options?.agents, query: options?.query }),
    ...buildWorkspaceQuickActionItems({ commands: options?.workspaceCommands, settings: options?.settings, query: options?.query }),
    ...buildSlashQuickActionItems({ slashCommands: options?.slashCommands, settings: options?.settings, query: options?.query }),
  ];
}
