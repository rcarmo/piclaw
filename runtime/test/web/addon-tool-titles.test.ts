import { describe, expect, test } from 'bun:test';
import { formatToolTitle, createToolTitleTracker } from '../../src/channels/web/agent/agent-utils.js';
import { projectTurnActivity } from '../../src/channels/web/agent/turn-activity.js';
import inventory from './fixtures/addon-tool-inventory.json';

const samples: Record<string, Record<string, unknown>> = {
  delegate: { prompt: 'Review the queue behaviour.' }, plan: { action: 'read' }, exec_command: { cmd: 'git status' },
  proxmox: { action: 'workflow', workflow: 'vm.status', vmid: 100 },
  portainer: { action: 'workflow', workflow: 'container.inspect', endpoint_id: 2, name: 'api' },
  imap: { action: 'search', account: 'work', folder: 'INBOX' },
  image_process: { action: 'resize', input: 'photo.png' },
  ava: { command: 'sensors' }, git_history: { mode: 'log' },
  cheapskate: { action: 'status' }, restic: { action: 'status', config: null },
  remote_peer: { action: 'status' }, code_review: { action: 'threads' },
  stealth_browser: { action: 'status' }, linkr: { action: 'status' },
};

for (const name of new Set(inventory.addons.flatMap(addon => addon.tools))) {
  test(`${name} has a human summary in the audited add-on inventory`, () => {
    const title = formatToolTitle(name, samples[name] ?? {});
    expect(title.startsWith(`${name}: `)).toBe(true);
    expect(title.slice(name.length + 2).trim().length).toBeGreaterThan(3);
    expect(title).not.toMatch(/[\r\n]/);
    expect(title.length).toBeLessThanOrEqual(name.length + 123);
  });
}

test('inventory accounts for the complete pinned catalogue, including add-ons without tools', () => {
  expect(inventory.addons).toHaveLength(49);
  expect(inventory.addons.filter(addon => addon.tools.length)).toHaveLength(29);
  expect(new Set(inventory.addons.flatMap(addon => addon.tools)).size).toBe(79);
});

for (const [tool, api] of Object.entries(inventory.apis)) {
  for (const action of api.actions) test(`${tool} action ${action} has a non-empty operation summary`, () => {
    const title = formatToolTitle(tool, { action });
    expect(title).not.toBe(tool);
    expect(title).not.toContain('undefined');
    expect(title).not.toContain('manage API connection');
  });
  for (const workflow of api.workflows) test(`${tool} workflow ${workflow} names the operation and targets`, () => {
    const title = formatToolTitle(tool, { action: 'workflow', workflow, vmid: 101, node: 'pve', endpoint_id: 2, name: 'api' });
    expect(title).not.toBe(tool);
    expect(title).not.toContain(workflow);
    expect(title).not.toContain('run workflow');
    expect(title).not.toContain('undefined');
    expect(title).not.toMatch(/[\r\n]/);
  });
}

for (const [tool, operations] of Object.entries(inventory.operations)) {
  for (const operation of operations.values) test(`${tool} operation ${operation} has a human summary`, () => {
    const title = formatToolTitle(tool, { ...samples[tool], [operations.field]: operation });
    expect(title.startsWith(`${tool}: `)).toBe(true);
    expect(title).not.toContain('undefined');
    expect(title).not.toMatch(/[\r\n]/);
    expect(title.slice(tool.length + 2).split(' · ')[0]).not.toMatch(/[_.]/);
    expect(title).not.toMatch(/: (?:manage|control|run workflow)/);
  });
}

describe('operation and target summaries', () => {
  for (const [name, args, expected] of [
    ['proxmox', { action: 'workflow', workflow: 'vm.start', vmid: 101, node: 'pve' }, 'proxmox: start VM · 101 · pve'],
    ['proxmox', { action: 'workflow', workflow: 'storage.content.list', storage: 'local', node: 'pve' }, 'proxmox: list storage content · local · pve'],
    ['proxmox', { action: 'workflow_help', workflow: 'vm.start' }, 'proxmox: workflow help · start VM'],
    ['portainer', { action: 'workflow', workflow: 'container.restart', endpoint_id: 2, name: 'api' }, 'portainer: restart container · api · endpoint 2'],
    ['portainer', { action: 'workflow', workflow: 'stack.update', endpoint_id: 2, stack_id: 8 }, 'portainer: update stack · 8 · endpoint 2'],
    ['portainer', { action: 'workflow', workflow: 'container.upgrade_many', names: ['api', 'worker'], endpoint_id: 2 }, 'portainer: upgrade containers · 2 containers · endpoint 2'],
    ['proxmox', { action: 'request', method: 'GET', path: '/nodes/pve/status' }, 'proxmox: GET /nodes/pve/status'],
    ['portainer', { action: 'request', requests: [{ method: 'POST', path: '/endpoints/2/docker/containers/api/restart' }, { path: '/endpoints/2/docker/info' }] }, 'portainer: 2 API requests · POST /endpoints/2/docker/containers/api/restart'],
    ['restic', { action: 'set_config', config: { enabled: true } }, 'restic: update backup configuration'],
    ['remote_peer', { action: 'work_send', peer: 'alice', agent: 'reviewer' }, 'remote_peer: send work request · alice · reviewer'],
    ['code_review', { action: 'reply', threadId: 'thread-7' }, 'code_review: reply to review thread · thread-7'],
    ['imap', { action: 'move', account: 'work', folder: 'INBOX', targetFolder: 'Archive' }, 'imap: move mail · work · INBOX → Archive'],
    ['image_process', { action: 'resize', input: 'photo.png', output: 'small.png' }, 'image_process: resize image · photo.png → small.png'],
    ['office_write', { path: 'report.docx', markdown: '# Report' }, 'office_write: write Office document · report.docx'],
    ['editable_table', { title: 'Release checklist', markdown: '| Task |' }, 'editable_table: edit Markdown table · Release checklist'],
    ['stealth_browser', { action: 'goto', url: 'https://example.com/docs' }, 'stealth_browser: open page · https://example.com/docs'],
    ['git_history', { mode: 'blame', file: 'src/main.ts' }, 'git_history: show line authorship · src/main.ts'],
    ['json_query', { expression: '.items[]', input: '{"items":[]}' }, 'json_query: query inline JSON'],
    ['win_screenshot', { titleMatch: 'Editor', outPath: 'screen.png' }, 'win_screenshot: capture window · Editor · screen.png'],
    ['win_type', { text: 'private text' }, 'win_type: type text'],
    ['ava', { command: 'announce', text: 'private announcement' }, 'ava: announce text'],
    ['m365_mail', { action: 'read', messageId: 'mail-7' }, 'm365_mail: read mail · mail-7'],
    ['m365_teams_send', { chatId: 'chat-7', message: 'private message' }, 'm365_teams_send: send Teams message · chat-7'],
    ['m365_graph_query', { method: 'PATCH', path: '/me/events/7?$select=subject', body: 'private body' }, 'm365_graph_query: PATCH /me/events/7'],
    ['m365_todo_task', { action: 'complete', listId: 'list-1', taskId: 'task-7' }, 'm365_todo_task: complete task · list-1 · task-7'],
    ['write_stdin', { session_id: 7, chars: '' }, 'write_stdin: read session output · 7'],
    ['write_stdin', { session_id: 7, chars: 'secret' }, 'write_stdin: send input to session · 7'],
    ['apply_patch', { input: '*** Begin Patch\n*** Update File: src/main.ts\n@@\n-old\n+new\n*** End Patch' }, 'apply_patch: apply patch · src/main.ts'],
  ] as const) test(expected, () => expect(formatToolTitle(name, args)).toBe(expected));
});

test('secret-bearing fields and URL credentials never become summary text', () => {
  const secret = 'DONOTPUBLISHTHISVALUE938475';
  const payload = {
    password: secret, pass: secret, api_token_keychain: secret, username: secret,
    headers: { Authorization: secret }, body: secret, config: { passwordRef: secret },
    text: secret, draftBody: secret, thought: secret, markdown: secret, notes: secret,
    prompt: secret, result: secret, ticket: secret, confirmation: secret,
    command: secret, command_args: [secret], input_data: secret, stack_file_content: secret,
    query: secret, args: secret, parameters: secret,
  };
  for (const tool of new Set(inventory.addons.flatMap(addon => addon.tools))) {
    if (['delegate', 'plan', 'exec_command'].includes(tool)) continue;
    const title = formatToolTitle(tool, { ...samples[tool], ...payload });
    expect(title).not.toContain(secret);
    expect(title).not.toBe(tool);
  }
  for (const tool of ['proxmox', 'portainer', 'm365_graph_query', 'stealth_browser', 'm365_document_link_metadata']) {
    const url = `https://user:${secret}@example.com/path?token=${secret}#${secret}`;
    expect(formatToolTitle(tool, { action: tool === 'stealth_browser' ? 'goto' : 'request', method: 'GET', path: url, url })).not.toContain(secret);
  }
  expect(formatToolTitle('image_process', { action: 'info', input: `https://user:${secret}@example.com/photo.png?token=${secret}` })).not.toContain(secret);
  for (const [tool, operations] of Object.entries(inventory.operations)) {
    expect(formatToolTitle(tool, { [operations.field]: secret })).not.toContain(secret);
  }
  expect(formatToolTitle('proxmox', { action: 'workflow', workflow: `vm.${secret}` })).not.toContain(secret);
  expect(formatToolTitle('portainer', { action: 'workflow', workflow: 'image.pull', image: `user:${secret}@registry.example/image` })).not.toContain(secret);
});

test('argument wrappers are objects; legitimate string input fields survive', () => {
  const args = { action: 'resize', input: 'photo.png' };
  const expected = 'image_process: resize image · photo.png';
  expect(formatToolTitle('image_process', args)).toBe(expected);
  expect(formatToolTitle('image_process', JSON.stringify(args))).toBe(expected);
  for (const key of ['arguments', 'input', 'params', 'parameters', 'args', 'payload']) {
    expect(formatToolTitle('image_process', { [key]: args })).toBe(expected);
    expect(formatToolTitle('image_process', JSON.stringify({ [key]: args }))).toBe(expected);
  }
  expect(formatToolTitle('proxmox', { action: 'workflow', workflow: 'vm.start', vmid: 101, payload: { password: 'secret' } }))
    .toBe('proxmox: start VM · 101');
});

test('live status, historical activity and nested calls share the summary formatter', () => {
  const args = { action: 'workflow', workflow: 'vm.status', vmid: 101 };
  const title = 'proxmox: show VM status · 101';
  const tracker = createToolTitleTracker();
  expect(tracker.remember('pve-1', 'proxmox', args)).toBe(title);
  expect(tracker.lookup('pve-1', 'proxmox')).toBe(title);
  const turn = { entries: [
    { id: 1, kind: 'pi.assistant', model: [{ role: 'assistant', content: [{ type: 'toolCall', id: 'pve-1', name: 'proxmox', arguments: args }] }] },
    { id: 2, kind: 'pi.tool-result', model: [{ role: 'toolResult', toolCallId: 'pve-1', content: [], details: { calls: [{ name: 'proxmox', args, status: 'ok' }] } }] },
  ], tasks: {}, truncated: false };
  const result = projectTurnActivity(turn as any, null);
  expect(result.steps[0].tool?.title).toBe(title);
  expect(result.steps[0].tool?.nested?.[0].title).toBe(title);
});

test('summaries are bounded and tolerate malformed fields and inherited property names', () => {
  const title = formatToolTitle('proxmox', { action: 'workflow', workflow: 'vm.start', vmid: 101, node: `pve\n${'x'.repeat(200)}` });
  expect(title).not.toMatch(/[\r\n]/);
  expect(title).toEndWith('…');
  expect(title.length).toBe('proxmox: '.length + 121);
  for (const tool of ['proxmox', 'portainer', 'restic', 'remote_peer', 'code_review', 'git_history', 'ava', 'cheapskate', 'stealth_browser', 'm365_profile']) {
    for (const key of ['constructor', 'toString', '__proto__']) expect(() => formatToolTitle(tool, { action: key, command: key, mode: key })).not.toThrow();
  }
  for (const requests of [[null], ['body'], [7], [{}]]) expect(() => formatToolTitle('proxmox', { action: 'request', requests })).not.toThrow();
});

test('unknown tools retain the existing command and path fallbacks', () => {
  expect(formatToolTitle('custom', { path: 'src/main.ts' })).toBe('custom: src/main.ts');
  expect(formatToolTitle('custom', { command: 'pwd' })).toBe('custom: pwd');
  expect(formatToolTitle('exec_command', { cmd: 'pwd' })).toBe('exec_command: pwd');
  expect(formatToolTitle('toString', {})).toBe('toString');
  expect(formatToolTitle('constructor', {})).toBe('constructor');
  expect(formatToolTitle('custom', {})).toBe('custom');
  for (const args of [null, [], 7, 'not JSON']) expect(() => formatToolTitle('proxmox', args)).not.toThrow();
});
