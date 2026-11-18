/** Argument-only titles for first-party add-ons, shared by live and historical activity.
 * Keep selectors explicit: bodies, credentials, scripts and configuration objects
 * must never be promoted into a collapsed timeline title.
 */
type Args = Record<string, unknown>;

function value(input: unknown): string | null {
  const text = typeof input === 'string' ? input.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()
    : typeof input === 'number' && Number.isFinite(input) ? String(input) : '';
  if (!text) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|https?:|\/\/)/i.test(text)) {
    try {
      const url = new URL(text.startsWith('//') ? `https:${text}` : text);
      url.username = ''; url.password = ''; url.search = ''; url.hash = '';
      return text.startsWith('//') ? url.toString().slice('https:'.length) : url.toString();
    } catch { return '[invalid URL]'; }
  }
  return text.replace(/^[^\s/:@\\]+:[^\s/@\\]*@(?=[^/\s]+\/)/, '');
}
const first = (args: Args, ...keys: string[]) => keys.map(key => value(args[key])).find(Boolean) ?? null;
const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');
const fields = (args: Args, ...keys: string[]) => keys.map(key => value(args[key])).filter(Boolean).join(' · ');
const token = (input: unknown) => typeof input === 'string' && /^[a-z][a-z0-9_.-]{0,100}$/i.test(input) ? input : '';
const choice = (input: unknown, allowed: string) => typeof input === 'string' && allowed.split(' ').includes(input.trim().toLowerCase()) ? input.trim().toLowerCase() : '';
const words = (text: string) => text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.-]+/g, ' ');
const path = (input: unknown) => value(input)?.split(/[?#]/)[0] ?? null;
const method = (input: unknown) => typeof input === 'string' && /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/i.test(input) ? input.toUpperCase() : 'GET';

const lookup = (map: Record<string, string>, key: string) => Object.hasOwn(map, key) ? map[key] : undefined;
const WORDS: Record<string, string> = { vm: 'VM', lxc: 'LXC', iso: 'ISO', ip: 'IP address', agent: 'guest', docker: 'Docker', fsinfo: 'filesystem info', osinfo: 'OS info' };
const labelWords = (text: string) => words(text).split(' ').map(word => lookup(WORDS, word) ?? word).join(' ');
const WORKFLOW_WORDS = new Set(('agent attach backup batch cancel capabilities click clone cluster combo compose container content create create_standalone cycle delete detach device disk docker_info docker_version download_url drag eject endpoint entry exec file firmware fsinfo help image input inspect ip iso job key list log logs lxc media metrics migrate mount mounts mouse move network node osinfo ping plan power press profile prune pull pull_and_update reboot release remove repeat reset resize resolve resolve_node restart restore resume rollback scroll select shutdown snapshot stack start status stop storage system_df tap task template text update update_check upgrade upgrade_many users vm volume wait wait_state').split(' '));
function workflowLabel(workflow: string): string {
  const parts = workflow.split('.');
  if (!parts.every(part => WORKFLOW_WORDS.has(part))) return 'run workflow';
  if (parts[0] === 'metrics') return `show ${labelWords(parts.slice(1).join(' '))} metrics`;
  const operation = parts.pop()!;
  const noun = labelWords(parts.join(' '));
  if (operation === 'status') return `show ${noun} status`;
  if (operation === 'ip') return `show ${noun} IP address`;
  if (operation === 'log' || operation === 'logs') return `read ${noun} logs`;
  if (operation === 'users') return `list ${noun} users`;
  if (operation === 'osinfo' || operation === 'fsinfo') return `read ${noun} ${labelWords(operation)}`;
  if (operation === 'docker_info') return `read ${noun} Docker info`;
  if (operation === 'docker_version') return `read ${noun} Docker version`;
  if (operation === 'system_df') return `show ${noun} disk usage`;
  if (operation === 'compose') return `read ${noun} Compose configuration`;
  if (operation === 'update_check') return `check ${noun} updates`;
  if (operation === 'wait' || operation === 'wait_state') return `wait for ${noun}${operation === 'wait_state' ? ' state' : ''}`;
  if (operation === 'resolve_node') return `locate ${noun}`;
  if (operation === 'exec') return `run ${noun} command`;
  if (operation === 'file') return `read ${noun} file`;
  if (operation === 'upgrade_many') return `upgrade ${noun}s`;
  if (operation === 'list') return `list ${noun}${/^(VM|LXC|node|endpoint|container|stack|image|network|volume|backup|task|profile)$/.test(noun) || noun.endsWith('snapshot') ? 's' : ''}`;
  return `${labelWords(operation)} ${noun}`;
}

function apiTitle(tool: string, args: Args): string {
  const action = token(args.action);
  const workflow = token(args.workflow);
  if (action === 'request') {
    const requests = Array.isArray(args.requests) ? args.requests : [];
    const request = requests.length ? requests[0] : args;
    const endpoint = request && typeof request === 'object' ? path(request.path) : null;
    const requestLabel = endpoint ? `${method(request.method)} ${endpoint}` : 'API request';
    return requests.length ? join(`${requests.length} API request${requests.length === 1 ? '' : 's'}`, requestLabel) : requestLabel;
  }
  if (action === 'workflow' || action === 'workflow_help') {
    const operation = workflow ? workflowLabel(workflow) : 'workflow';
    if (action === 'workflow_help') return join('workflow help', workflow ? operation : null);
    if (tool === 'proxmox') {
      const target = /^(vm\.|lxc\.|backup\.|metrics\.vm)/.test(workflow) ? first(args, 'vmid', 'name', 'hostname')
        : workflow.startsWith('task.') ? first(args, 'upid') : first(args, 'storage');
      return join(workflow ? operation : 'run workflow', target, first(args, 'node'));
    }
    const family = workflow.split('.')[0];
    const target = family === 'stack' ? first(args, 'stack_id', 'stack_name')
      : family === 'container' ? (Array.isArray(args.names) && args.names.length ? `${args.names.length} containers` : first(args, 'name', 'container_id'))
        : family === 'image' ? first(args, 'image', 'name')
          : family === 'network' ? first(args, 'name', 'network_id')
            : family === 'volume' ? first(args, 'volume_name', 'name') : first(args, 'name');
    const endpoint = value(args.endpoint_id);
    return join(workflow ? operation : 'run workflow', target, endpoint ? `endpoint ${endpoint}` : null);
  }
  const actions: Record<string, string> = {
    get: 'read API profile', set: 'update API profile', clear: 'clear API profile', discover: 'discover API profiles',
    contract: 'read API contract', capabilities: 'list workflow capabilities', request_help: 'show API request help', recommend: 'recommend workflows',
  };
  return join(lookup(actions, action) ?? 'manage API connection', action === 'capabilities' || action === 'recommend' ? first(args, 'category') : null,
    action === 'set' ? first(args, 'base_url') : null);
}

// Fixed-purpose tools: the label supplies intent, the fields supply the target.
const SIMPLE: Record<string, readonly [string, ...string[]]> = {
  office_read: ['read Office document', 'path'], office_write: ['write Office document', 'path'],
  open_office_viewer: ['open Office document', 'path'], open_drawio_editor: ['open Draw.io diagram', 'path'],
  editable_table: ['edit Markdown table', 'title'],
  code_search: ['search code', 'lang', 'path'], code_rewrite: ['rewrite code', 'lang', 'path'],
  start_autoresearch: ['start experiment', 'project_dir'], stop_autoresearch: ['stop experiment'], autoresearch_status: ['show experiment status'],
  sample_test: ['run sample add-on check'], regrets_review: ['review recent human feedback'], vent: ['record feedback', 'trigger'],
  web_search: ['search the web'], image_generation: ['generate image'], view_image: ['view image', 'path'],
  get_goal: ['read current goal'], create_goal: ['create goal'], goal_complete: ['mark goal complete'], goal_stop: ['stop goal loop'], update_goal: ['update goal'],
  win_list_windows: ['list windows'], win_list_monitors: ['list monitors'],
  win_screenshot: ['capture window', 'titleMatch', 'outPath'], win_desktop_screenshot: ['capture desktop', 'outPath'],
  win_monitor_screenshot: ['capture monitor', 'monitorIndex', 'deviceName', 'outPath'], win_region_screenshot: ['capture screen region', 'outPath'],
  win_find_elements: ['find window elements', 'windowTitle', 'elementName'], win_click: ['click window element', 'windowTitle', 'elementName'],
  win_type: ['type text'], win_tree: ['inspect window elements', 'windowTitle'], win_kill: ['close window', 'titleMatch'],
  m365_teams_chats: ['list Teams chats'], m365_teams_messages: ['read Teams messages', 'chatId'],
  m365_teams_send: ['send Teams message', 'chatId'], m365_teams_send_rich_text: ['send Teams rich-text message', 'chatId'],
  m365_teams_send_markdown_card: ['send Teams Markdown card', 'chatId', 'fileName'],
  m365_teams_upload_file_card: ['upload Teams file card', 'chatId', 'localPath'],
  m365_teams_send_link_card: ['send Teams link card', 'chatId', 'url'], m365_teams_send_file_card: ['send Teams file card', 'chatId', 'localPath'],
  m365_people: ['search people'], m365_calendar_svg: ['draw calendar', 'date'],
  m365_document_link_metadata: ['inspect document link', 'url'], m365_onedrive_share_local_file: ['share OneDrive file', 'localPath'],
  m365_spo_search: ['search SharePoint', 'siteUrl'], m365_spo_browse: ['browse SharePoint', 'siteUrl', 'folderPath'],
  m365_spo_download: ['download SharePoint file', 'siteUrl', 'filePath'], m365_spo_upload: ['upload SharePoint file', 'localPath', 'folderId'],
  m365_spo_sync: ['sync SharePoint folder', 'localDir', 'folderId'], m365_spo_move: ['move SharePoint item', 'filePath', 'itemId'],
  m365_spo_move_many: ['move SharePoint items'],
};

const REVIEW: Record<string, string> = {
  dispatches: 'list assigned review batches', dispatch: 'read review batch', thread: 'read review thread', threads: 'list review threads',
  reply: 'reply to review thread', edit: 'edit review reply', deleteMessage: 'delete review reply', resolve: 'resolve review thread', work: 'update review progress',
};
const PEER: Record<string, string> = {
  status: 'show peer status', identity: 'show client identity', ticket: 'create pairing ticket', pair: 'pair client', accept: 'accept pairing', deny: 'deny pairing',
  revoke: 'revoke peer access', forget: 'forget peer', rotate: 'rotate client identity', alias: 'set peer alias', policy: 'update peer permissions',
  remote_permissions: 'read remote permissions', advertise: 'advertise discovery', unadvertise: 'stop discovery', session_targets: 'list session targets',
  session_advertise: 'advertise session', session_unadvertise: 'stop advertising session', ping: 'ping peer', retry: 'retry delivery',
  work_send: 'send work request', work_review: 'review work request',
};

/** Return null for tools whose existing Core formatter owns their presentation. */
export function summariseAddonToolCall(tool: string, args: Args): string | null {
  if (tool === 'proxmox' || tool === 'portainer') return apiTitle(tool, args);
  if (tool === 'restic') return lookup({ get_config: 'read backup configuration', set_config: 'update backup configuration', status: 'show backup status' }, token(args.action)) ?? 'manage backup configuration';
  if (tool === 'remote_peer') return join(lookup(PEER, token(args.action)) ?? 'manage peers', first(args, 'peer', 'client_id'), first(args, 'agent', 'session_alias', 'request_id', 'message_id'));
  if (tool === 'code_review') return join(lookup(REVIEW, token(args.action)) ?? 'inspect code reviews', first(args, 'threadId', 'dispatchId', 'reviewId', 'requestId'), first(args, 'state'));
  if (tool === 'exec_command') return typeof args.cmd === 'string' && args.cmd.trim() ? null : 'run shell command';
  if (tool === 'write_stdin') return join(typeof args.chars === 'string' && args.chars ? 'send input to session' : 'read session output', value(args.session_id));
  if (tool === 'apply_patch') {
    const files = typeof args.input === 'string' ? [...args.input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].slice(0, 3).map(match => value(match[1])) : [];
    return join('apply patch', files.filter(Boolean).join(', '));
  }
  if (tool === 'diagnostics') return join(args.file ? 'validate code' : 'list code validators', value(args.file));
  if (tool === 'json_query') return join(args.file ? 'query JSON file' : 'query inline JSON', value(args.file));
  if (tool === 'git_history') return join(lookup({ log: 'read commit history', content_search: 'search code history', message_search: 'search commit messages', blame: 'show line authorship' }, token(args.mode)) ?? 'read commit history', fields(args, 'file', 'ref'));
  if (tool === 'image_process') {
    const action = choice(args.action, 'resize crop convert optimize trim rotate flip blur sharpen composite greyscale modulate contrast gamma tint normalize negate clahe threshold median extend extract_channel remove_alpha unflatten text svg_render affine tile metadata frames spritesheet_to_gif info');
    const operation = lookup({ info: 'inspect image', metadata: 'read image metadata', text: 'add text to image', svg_render: 'render SVG', spritesheet_to_gif: 'convert spritesheet to GIF', clahe: 'enhance local image contrast' }, action) ?? `${words(action || 'process')} image`;
    return join(operation, [value(args.input), value(args.output)].filter(Boolean).join(' → '));
  }
  if (tool === 'imap') {
    const action = choice(args.action, 'list_accounts get_account save_account delete_account set_default_account list_folders search fetch move copy flag create_draft file_message create_folder delete_folder');
    const operation = action === 'list_folders' ? 'list mail folders' : /account/.test(action) ? words(action) : `${words(action || 'manage')} mail`;
    return join(operation, value(args.account), [value(args.folder), value(args.targetFolder)].filter(Boolean).join(' → '));
  }
  if (tool === 'cheapskate') return lookup({ status: 'show provider rotation status', list: 'list routing models', usage: 'show routing usage', rotate: 'rotate routing provider' }, token(args.action)) ?? 'manage provider rotation';
  if (tool === 'stealth_browser') {
    const action = token(args.action);
    const operation = lookup({ goto: 'open page', click: 'click page element', type: 'type text', scroll: 'scroll page', screenshot: 'capture page', evaluate: 'run browser script', text: 'read page text', fetch: 'fetch page', cookies: 'inspect browser cookies', status: 'show browser status', close: 'close browser' }, action) ?? 'control browser';
    return join(operation, ['goto', 'fetch'].includes(action) ? value(args.url) : first(args, 'selector'));
  }
  if (tool === 'ava') {
    const action = token(args.command);
    const operation = lookup({ announce: 'announce text', subtitle: 'set subtitle', sensors: 'read sensors', entities: 'list device entities', snapshot: 'capture camera image', volume: 'set volume', scene: 'show scene', play: 'play media', pause: 'pause media', stop: 'stop playback', mute: 'mute device', unmute: 'unmute device', wake: 'wake display' }, action) ?? 'control ThinkSmart';
    return join(operation, action === 'scene' ? value(args.scene) : action === 'volume' ? value(args.level) : null);
  }
  if (tool === 'linkr') {
    const action = token(args.action);
    const operation = lookup({ help: 'show device help', capabilities: 'list device capabilities', status: 'show device status', snapshot: 'capture device screen', text: 'type text', 'input.batch': 'send input batch' }, action) ?? (action ? workflowLabel(action) : 'control device');
    return join(operation, fields(args, 'device_id', 'job_id'));
  }
  if (tool === 'm365_graph_query') return join(path(args.path) ? `${method(args.method)} ${path(args.path)}` : 'query Microsoft Graph');
  const action = token(args.action);
  if (tool === 'm365_mail') {
    const action = choice(args.action, 'list search read draft reply forward delete move flag mark_read mark_unread folders batch_delete batch_move batch_archive batch_flag');
    return join(action === 'folders' ? 'list mail folders' : `${words(action || 'manage')} mail`, fields(args, 'messageId', 'folder'));
  }
  if (tool === 'm365_onedrive') return join(`${words(choice(args.action, 'list search info mkdir delete') || 'browse')} OneDrive items`, first(args, 'itemPath', 'folderPath', 'itemId'));
  if (tool === 'm365_calendar') {
    const action = choice(args.action, 'list create update delete rsvp availability');
    return join(action === 'availability' ? 'find calendar availability' : `${words(action || 'manage')} calendar events`, fields(args, 'eventId', 'date'));
  }
  if (tool === 'm365_profile') return lookup({ profile: 'read user profile', manager: 'read manager profile', calendar_today: 'read today’s calendar', calendar_upcoming: 'read upcoming calendar' }, action) ?? 'read user profile';
  if (tool === 'm365_todo') return join('list tasks and flagged mail', Array.isArray(args.listIds) ? `${args.listIds.length} lists` : null);
  if (tool === 'm365_todo_lists') return join(`${words(choice(args.action, 'list get create rename delete') || 'manage')} task lists`, value(args.listId));
  if (tool === 'm365_todo_task') return join(`${words(choice(args.action, 'get create update complete reopen delete') || 'manage')} task`, fields(args, 'listId', 'taskId'));
  if (tool === 'm365_todo_step') return join(`${words(choice(args.action, 'list create update delete') || 'manage')} checklist steps`, fields(args, 'listId', 'taskId', 'stepId'));
  const spec = Object.hasOwn(SIMPLE, tool) ? SIMPLE[tool] : null;
  return spec ? join(spec[0], fields(args, ...spec.slice(1))) : null;
}
