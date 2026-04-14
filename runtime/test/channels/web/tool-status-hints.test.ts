import { beforeEach, expect, test } from 'bun:test';
import '../../helpers.js';

import { withResolvedToolStatusHints } from '../../../src/channels/web/handlers/agent.ts';
import { resolveToolStatusHints } from '../../../src/tool-status-hints.ts';
import { setPortainerToolHandlers } from '../../../src/extensions/portainer.ts';
import { setProxmoxToolHandlers } from '../../../src/extensions/proxmox.ts';
import { setSshToolHandlers } from '../../../src/extensions/ssh.ts';
import '../../../src/extensions/keychain-tools.ts';
import '../../../src/extensions/bun-runner.ts';
import '../../../extensions/browser/cdp-browser/index.ts';
import '../../../extensions/integrations/office-tools/index.ts';
import '../../../extensions/viewers/office-viewer/index.ts';
import '../../../extensions/viewers/drawio-editor/index.ts';
import '../../../extensions/platform/windows/win-ui/index.ts';
import '../../../extensions/platform/windows/powershell/index.ts';
import {
  buildMcpStatusHintLabel,
  buildMcpToolServerIndex,
  resolveMcpServerName,
} from '../../../extensions/integrations/mcp-status-hints/index.ts';
import '../../../extensions/experimental/m365/index.ts';

beforeEach(() => {
  setSshToolHandlers({
    get: (chatJid: string) => chatJid === 'web:ssh' ? {
      chat_jid: chatJid,
      ssh_target: 'agent@example.com:/srv/project',
      ssh_port: 22,
      private_key_keychain: 'ssh/piclaw',
      known_hosts_keychain: 'ssh/known-hosts',
      strict_host_key_checking: 'yes',
      created_at: '2026-04-14T00:00:00.000Z',
      updated_at: '2026-04-14T00:00:00.000Z',
    } : null,
    set: async () => { throw new Error('not used'); },
    clear: async () => ({ deleted: false, apply_timing: 'next_session' as const }),
  });

  setProxmoxToolHandlers({
    get: (chatJid: string) => chatJid === 'web:pve' ? {
      chat_jid: chatJid,
      base_url: 'https://pve.example.com:8006/api2/json',
      api_token_keychain: 'proxmox/piclaw-management-token',
      allow_insecure_tls: false,
      created_at: '2026-04-14T00:00:00.000Z',
      updated_at: '2026-04-14T00:00:00.000Z',
    } : null,
    set: async () => { throw new Error('not used'); },
    clear: async () => ({ deleted: false, apply_timing: 'immediate' as const }),
    request: async () => ({ status: 200, method: 'GET', path: '/', body: {} }),
    workflow: async () => ({ workflow: 'cluster.status', body: {} } as any),
  });

  setPortainerToolHandlers({
    get: (chatJid: string) => chatJid === 'web:portainer' ? {
      chat_jid: chatJid,
      base_url: 'https://portainer.example.com:9443',
      api_token_keychain: 'portainer/relay',
      allow_insecure_tls: false,
      created_at: '2026-04-14T00:00:00.000Z',
      updated_at: '2026-04-14T00:00:00.000Z',
    } : null,
    set: async () => { throw new Error('not used'); },
    clear: async () => ({ deleted: false, apply_timing: 'immediate' as const }),
    request: async () => ({ status: 200, method: 'GET', path: '/', body: {} }),
    workflow: async () => ({ workflow: 'endpoint.list', body: {} } as any),
  });
});

test('withResolvedToolStatusHints attaches extension-provided SSH hint metadata', () => {
  const payload = withResolvedToolStatusHints('web:ssh', {
    type: 'tool_call',
    tool_name: 'bash',
    title: 'Running: bash',
  });

  expect(Array.isArray((payload as any).status_hints)).toBe(true);
  expect((payload as any).status_hints).toEqual([
    expect.objectContaining({
      key: 'ssh',
      label: 'agent@example.com',
      title: 'SSH target',
      kind: 'remote',
    }),
  ]);
  expect(String((payload as any).status_hints[0].icon_svg)).toContain('<svg');
});

test('withResolvedToolStatusHints attaches extension-provided Proxmox and Portainer hints', () => {
  const proxmoxPayload = withResolvedToolStatusHints('web:pve', {
    type: 'tool_status',
    tool_name: 'proxmox',
    title: 'Running: proxmox request',
    status: 'Working...',
    tool_args: { base_url: 'https://pve.example.com:8006/api2/json' },
  });
  const portainerPayload = withResolvedToolStatusHints('web:portainer', {
    type: 'tool_status',
    tool_name: 'portainer',
    title: 'Running: portainer request',
    status: 'Working...',
    tool_args: { base_url: 'https://portainer.example.com:9443/api' },
  });

  expect((proxmoxPayload as any).status_hints).toEqual([
    expect.objectContaining({ key: 'proxmox', label: 'pve.example.com:8006', title: 'Proxmox host' }),
  ]);
  expect((portainerPayload as any).status_hints).toEqual([
    expect.objectContaining({ key: 'portainer', label: 'portainer.example.com:9443', title: 'Portainer host' }),
  ]);
});

test('resolveToolStatusHints uses M365 extension-owned provider metadata', () => {
  const hints = resolveToolStatusHints({
    chatJid: 'web:m365',
    toolName: 'm365_sharepoint_search',
    args: { siteUrl: 'https://contoso.sharepoint.com/sites/TeamA' },
    payload: {},
  });

  expect(hints).toEqual([
    expect.objectContaining({
      key: 'm365',
      label: 'contoso.sharepoint.com',
      title: 'Microsoft 365 target',
      kind: 'service',
    }),
  ]);
  expect(String(hints[0]?.icon_svg)).toContain('<rect');
});

test('resolveToolStatusHints recognizes SharePoint sync-specific M365 URL fields', () => {
  const hints = resolveToolStatusHints({
    chatJid: 'web:m365-sync',
    toolName: 'm365_spo_sync',
    args: { folderUrl: 'https://contoso.sharepoint.com/sites/Docs/Shared%20Documents' },
    payload: {},
  });

  expect(hints).toEqual([
    expect.objectContaining({
      key: 'm365',
      label: 'contoso.sharepoint.com',
      title: 'Microsoft 365 target',
      kind: 'service',
    }),
  ]);
});

test('resolveToolStatusHints covers local core tools, powershell, keychain, bun_run, browser, windows UI, and office-file extensions', () => {
  const readHints = resolveToolStatusHints({
    chatJid: 'web:local',
    toolName: 'read',
    args: { path: 'notes/plan.md' },
    payload: {},
  });
  expect(readHints).toEqual([
    expect.objectContaining({ key: 'read', label: 'notes/plan.md', title: 'Local read • notes/plan.md', kind: 'file' }),
  ]);
  expect(String(readHints[0]?.icon_svg)).toContain('fill-rule="evenodd"');

  const writeHints = resolveToolStatusHints({
    chatJid: 'web:local',
    toolName: 'write',
    args: { path: 'notes/out.md' },
    payload: {},
  });
  expect(writeHints).toEqual([
    expect.objectContaining({ key: 'write', label: 'notes/out.md', title: 'Local write • notes/out.md', kind: 'file' }),
  ]);
  expect(writeHints[0]?.icon_svg).toBe(readHints[0]?.icon_svg);

  const editHints = resolveToolStatusHints({
    chatJid: 'web:local',
    toolName: 'edit',
    args: { path: 'notes/out.md' },
    payload: {},
  });
  expect(editHints).toEqual([
    expect.objectContaining({ key: 'edit', label: 'notes/out.md', title: 'Local edit • notes/out.md', kind: 'file' }),
  ]);
  expect(editHints[0]?.icon_svg).toBe(readHints[0]?.icon_svg);

  expect(resolveToolStatusHints({
    chatJid: 'web:local',
    toolName: 'bash',
    args: { command: 'ls -la', cwd: '/workspace/piclaw/runtime' },
    payload: {},
  })).toEqual([
    expect.objectContaining({ key: 'bash', label: '/workspace/piclaw/runtime', title: 'Local shell • /workspace/piclaw/runtime', kind: 'service' }),
  ]);

  expect(resolveToolStatusHints({
    chatJid: 'web:ssh',
    toolName: 'read',
    args: { path: 'notes/plan.md' },
    payload: {},
  })).toEqual([
    expect.objectContaining({ key: 'ssh', label: 'agent@example.com', title: 'SSH target', kind: 'remote' }),
  ]);

  expect(resolveToolStatusHints({
    chatJid: 'web:win',
    toolName: 'powershell',
    args: { command: 'Get-ChildItem', cwd: 'C:/src/demo' },
    payload: {},
  })).toEqual([
    expect.objectContaining({ key: 'powershell', label: 'C:/src/demo', title: 'PowerShell • C:/src/demo', kind: 'service' }),
  ]);

  expect(resolveToolStatusHints({
    chatJid: 'web:ssh',
    toolName: 'powershell',
    args: { command: 'Get-ChildItem', cwd: 'C:/src/demo' },
    payload: {},
  })).toEqual([
    expect.objectContaining({ key: 'ssh', label: 'agent@example.com', title: 'SSH target', kind: 'remote' }),
  ]);

  expect(resolveToolStatusHints({
    chatJid: 'web:keychain',
    toolName: 'keychain',
    args: { name: 'github/piclaw-bot' },
    payload: {},
  })).toEqual([
    expect.objectContaining({ key: 'keychain', label: 'github/piclaw-bot', title: 'Keychain entry • github/piclaw-bot', kind: 'profile' }),
  ]);

  expect(resolveToolStatusHints({
    chatJid: 'web:bun',
    toolName: 'bun_run',
    args: { script: 'runtime/scripts/playwright/terminal-reopen.ts' },
    payload: {},
  })).toEqual([
    expect.objectContaining({ key: 'bun_run', label: 'runtime/scripts/playwright/terminal-reopen.ts', title: 'Bun script • runtime/scripts/playwright/terminal-reopen.ts', kind: 'script' }),
  ]);

  expect(resolveToolStatusHints({
    chatJid: 'web:browser',
    toolName: 'cdp_browser',
    args: { action: 'navigate', url: 'https://example.com/path?q=1' },
    payload: {},
  })).toEqual([
    expect.objectContaining({ key: 'cdp_browser', label: 'example.com', title: 'Browser target • example.com', kind: 'service' }),
  ]);

  expect(resolveToolStatusHints({
    chatJid: 'web:windows-ui',
    toolName: 'win_click',
    args: { windowTitle: 'Calculator', elementName: 'Seven' },
    payload: {},
  })).toEqual([
    expect.objectContaining({ key: 'win_ui', label: 'Calculator', title: 'Windows UI target • Calculator', kind: 'service' }),
  ]);

  expect(resolveToolStatusHints({
    chatJid: 'web:office-tools',
    toolName: 'office_write',
    args: { path: 'notes/report.docx' },
    payload: {},
  })).toEqual([
    expect.objectContaining({ key: 'office_write', label: 'notes/report.docx', title: 'Office write • notes/report.docx', kind: 'file' }),
  ]);

  expect(resolveToolStatusHints({
    chatJid: 'web:viewer',
    toolName: 'open_office_viewer',
    args: { path: 'docs/roadmap.xlsx' },
    payload: {},
  })).toEqual([
    expect.objectContaining({ key: 'open_office_viewer', label: 'docs/roadmap.xlsx', title: 'Office viewer • docs/roadmap.xlsx', kind: 'file' }),
  ]);

  expect(resolveToolStatusHints({
    chatJid: 'web:drawio',
    toolName: 'open_drawio_editor',
    args: { path: 'diagrams/infra.drawio' },
    payload: {},
  })).toEqual([
    expect.objectContaining({ key: 'open_drawio_editor', label: 'diagrams/infra.drawio', title: 'Draw.io editor • diagrams/infra.drawio', kind: 'file' }),
  ]);
});

test('local MCP wrapper resolves server hints for proxy and direct MCP tools', () => {
  const config = {
    settings: { toolPrefix: 'server', directTools: true },
    mcpServers: {
      github: { url: 'https://mcp.github.example.com' },
      filesystem: { command: 'npx', args: ['@modelcontextprotocol/server-filesystem'] },
    },
  } as any;
  const cache = {
    version: 1,
    servers: {
      github: {
        configHash: 'a',
        cachedAt: Date.now(),
        tools: [{ name: 'search_repositories' }],
        resources: [],
      },
      filesystem: {
        configHash: 'b',
        cachedAt: Date.now(),
        tools: [{ name: 'read_file' }],
        resources: [],
      },
    },
  } as any;
  const index = buildMcpToolServerIndex(config, cache);

  expect(resolveMcpServerName('mcp', { server: 'github' }, index)).toBe('github');
  expect(resolveMcpServerName('mcp', { tool: 'read_file' }, index)).toBe('filesystem');
  expect(resolveMcpServerName('github_search_repositories', {}, index)).toBe('github');
  expect(buildMcpStatusHintLabel('github', config)).toEqual({
    label: 'github',
    title: 'MCP server • github • mcp.github.example.com',
  });
});
