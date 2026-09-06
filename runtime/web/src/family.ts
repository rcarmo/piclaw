import { FamilyApi, fetchFamilyIdentity, prepareFamilyBrowser } from './family-api.js';
import { FamilyAccount } from './family-account.js';
import { FamilySessions } from './family-sessions.js';
import { FamilyAdministration } from './family-administration.js';
import { FamilyWorkspace } from './family-workspace.js';
import { FamilyPreferences } from './family-preferences.js';
import { FamilyResults } from './family-results.js';
import { FamilyTasks } from './family-tasks.js';
import { FamilyMemory, validMemorySource } from './family-memory.js';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing family shell element: ${id}`);
  return value as T;
}
const account = element<HTMLElement>('account-name'), status = element<HTMLElement>('family-status'), error = element<HTMLElement>('family-error');
const timeline = element<HTMLElement>('timeline'), select = element<HTMLSelectElement>('session-select');
const form = element<HTMLFormElement>('compose-form'), compose = element<HTMLTextAreaElement>('message-text'), send = element<HTMLButtonElement>('send-message');
const home = element<HTMLButtonElement>('go-home'), refresh = element<HTMLButtonElement>('refresh'), logout = element<HTMLButtonElement>('sign-out');
const recovery = element<HTMLElement>('message-recovery'), recoveryStatus = element<HTMLElement>('recovery-status'), recoveryActions = element<HTMLElement>('recovery-actions');
const retry = element<HTMLButtonElement>('retry-message'), skip = element<HTMLButtonElement>('skip-message'), confirmSkip = element<HTMLInputElement>('confirm-skip');
let heldRow: number | null = null;
let legacyHeld = false;
let recoveryRequest: { row: number; action: 'retry' | 'skip' | 'dismiss-legacy'; requestId: string } | null = null;
let api: FamilyApi | null = null, current = '', stopped = false, busy = false, paused = false, generation = 0;
let settings: FamilyAccount | null = null;
let sessionSettings: FamilySessions | null = null;
let administration: FamilyAdministration | null = null;
let workspacePolicy: FamilyWorkspace | null = null;
let preferences: FamilyPreferences | null = null;
let results: FamilyResults | null = null;
let tasks: FamilyTasks | null = null;
let memory: FamilyMemory | null = null;
let directoryGeneration = 0;
let refreshing: symbol | null = null, polling: ReturnType<typeof setInterval> | undefined;
let pending: { text: string; chat: string; requestId: string } | null = null;
function controls(enabled: boolean): void {
  tasks?.setExecutionBlocked(busy);
  memory?.setBlocked(busy);
  for (const button of timeline.querySelectorAll<HTMLButtonElement>('.memory-preview')) button.disabled = !enabled;
  for (const control of [select, compose, send, home, refresh]) control.disabled = !enabled;
  retry.disabled = !enabled || heldRow === null || legacyHeld; confirmSkip.disabled = !enabled || heldRow === null;
  skip.disabled = !enabled || heldRow === null || !confirmSkip.checked;
}
function mask(): void {
  // Backgrounded tabs retain no visible conversation/draft until the cookie is revalidated.
  generation++; refreshing = null; timeline.replaceChildren(); account.textContent = ''; status.textContent = ''; error.textContent = '';
  directoryGeneration++;
  confirmSkip.checked = false;
  element('recovery-warning').textContent = ''; recoveryStatus.textContent = '';
  form.hidden = true; select.hidden = true; recovery.hidden = true; controls(false);
  settings?.suspend(); element<HTMLButtonElement>('open-account').disabled = true;
  sessionSettings?.suspend(); element<HTMLButtonElement>('open-sessions').disabled = true;
  administration?.suspend();
  workspacePolicy?.suspend();
  preferences?.suspend();
  results?.suspend();
  tasks?.suspend();
  memory?.suspend();
}
function invalidate(): void {
  if (stopped) return;
  stopped = true; mask(); api?.stop();
  settings?.stop();
  sessionSettings?.stop();
  administration?.stop();
  workspacePolicy?.stop();
  preferences?.stop();
  results?.stop();
  tasks?.stop();
  memory?.stop();
  if (polling) clearInterval(polling);
  select.replaceChildren(); compose.value = ''; pending = null; heldRow = null; recoveryRequest = null; confirmSkip.checked = false; recoveryStatus.textContent = ''; logout.disabled = true;
  status.textContent = 'This page is no longer bound to its original account.';
  error.textContent = 'Sign in again or reload. No previous conversation or draft is retained.';
}
function renderPosts(posts: unknown): void {
  if (!Array.isArray(posts)) throw new Error('Invalid conversation response.');
  const fragment = document.createDocumentFragment();
  for (const post of posts) {
    const article = document.createElement('article'); article.className = 'post';
    const meta = document.createElement('div'); meta.className = 'post-meta';
    meta.textContent = `${post.id} · ${post.data?.sender_name ?? (post.data?.is_bot_message ? 'Assistant' : 'User')} · ${post.timestamp ?? ''}`;
    const text = document.createElement('div'); text.className = 'post-text'; text.textContent = typeof post.data?.content === 'string' ? post.data.content : '';
    article.append(meta, text);
    const source = post.memory_source;
    if (validMemorySource(source) && source.chat_jid === current && source.message_rowid === post.id) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'memory-preview'; button.textContent = 'Preview for family memory';
      button.disabled = busy || paused || stopped; button.addEventListener('click', () => { if (!busy && !paused && !stopped) void memory?.previewSource(source); }); article.append(button);
    }
    fragment.append(article);
  }
  timeline.replaceChildren(fragment);
}
function renderRecovery(value: any): void {
  if (!['idle', 'working', 'queued', 'held', 'legacy-held', 'blocked'].includes(value?.state)
    || (['held','legacy-held'].includes(value.state) && (!Number.isSafeInteger(value.message_rowid) || value.message_rowid <= 0))) throw new Error('Invalid recovery response.');
  const next = ['held','legacy-held'].includes(value.state) ? value.message_rowid : null;
  if (heldRow !== next || legacyHeld !== (value.state==='legacy-held')) { recoveryRequest = null; confirmSkip.checked = false; }
  legacyHeld = value.state==='legacy-held'; retry.hidden = legacyHeld;
  skip.textContent = legacyHeld ? 'Dismiss legacy input without running' : 'Skip held message';
  element('recovery-warning').textContent = legacyHeld ? 'This migrated input has no current execution authority. Dismiss it to unblock the queue; review its history and send a new plain-text prompt if you want it to run. Original content and authorship stay unchanged. A sign-in within five minutes is required.' : 'Retry or skip requires a sign-in within the last five minutes. Skipping leaves the message in history but prevents execution.';
  heldRow = next; recovery.hidden = value.state === 'idle'; recoveryActions.hidden = heldRow === null;
  recoveryStatus.textContent = legacyHeld ? `Legacy input ${heldRow} is held by migration and cannot be retried.` : value.state === 'held' ? `Input ${heldRow} is held. Choose whether to retry or skip.`
    : value.state === 'blocked' ? 'Recovery is blocked. Ask the operator to inspect the stored input.'
    : value.state === 'working' ? 'A message is running.' : value.state === 'queued' ? 'A message is queued.' : '';
}
async function loadTimeline(): Promise<void> {
  if (!api || stopped || !current || refreshing || busy || paused || document.hidden) return;
  const flight = Symbol(), expected = ++generation, target = current; refreshing = flight;
  try {
    const [result, recoveryState, preferenceState] = await Promise.all([
      api.request(`/timeline?chat_jid=${encodeURIComponent(target)}&limit=100`),
      api.request(`/agent/message-recovery?chat_jid=${encodeURIComponent(target)}`),
      api.request('/account/preferences'),
    ]);
    if (stopped || expected !== generation || current !== target || paused || document.hidden) return;
    renderPosts(result.posts); renderRecovery(recoveryState); status.textContent = `Session: ${target}${result.has_more ? ' · Showing the most recent messages' : ''}`;
    account.textContent = `${api.identity.displayName} (@${api.identity.username})`;
    element<HTMLButtonElement>('open-account').disabled = false; settings?.resume();
    element<HTMLButtonElement>('open-sessions').disabled = false; sessionSettings?.resume();
    administration?.resume();
    workspacePolicy?.resume();
    results?.resume();
    tasks?.resume();
    memory?.resume();
    preferences?.resume(); preferences?.applyAppearance(preferenceState);
    form.hidden = false; select.hidden = false; controls(!busy);
  } catch (failure) {
    if (!stopped && expected === generation) {
      timeline.replaceChildren(); controls(false); home.disabled = false; refresh.disabled = false;
      error.textContent = (failure as Error).message;
      // An archived/foreign conversation must not prevent own-account or restore controls.
      // Revalidate independently; a denied target response has not verified the cookie.
      try {
        const preferenceState = await api.request('/account/preferences');
        if (!stopped && expected === generation && !paused && !document.hidden) {
          element<HTMLButtonElement>('open-account').disabled = false; settings?.resume();
          element<HTMLButtonElement>('open-sessions').disabled = false; sessionSettings?.resume();
          administration?.resume();
          workspacePolicy?.resume();
          results?.resume();
          tasks?.resume();
          memory?.resume();
          preferences?.resume(); preferences?.applyAppearance(preferenceState);
        }
      } catch { /* Identity invalidation clears the page; network errors keep controls masked. */ }
    }
  } finally { if (refreshing === flight) refreshing = null; }
}
async function switchSession(chat: string): Promise<void> {
  if (stopped || busy || !api) return;
  mask(); current = chat; pending = null; heldRow = null; recoveryRequest = null; confirmSkip.checked = false; compose.value = ''; error.textContent = '';
  const url = new URL(location.href); url.search = ''; url.searchParams.set('chat_jid', chat); url.hash = '';
  history.replaceState(null, '', url.pathname + url.search); select.value = chat;
  await loadTimeline();
}

async function refreshDirectory(): Promise<void> {
  if (!api || stopped || paused || document.hidden) return;
  const expected = ++directoryGeneration;
  const directory = await api.request('/agent/branches');
  if (stopped || paused || document.hidden || expected !== directoryGeneration) return;
  if (!Array.isArray(directory.branches)) throw new Error('Invalid session directory.');
  select.replaceChildren();
  for (const branch of directory.branches) {
    const option = document.createElement('option'); option.value = branch.chat_jid; option.textContent = `${branch.agent_name} · ${branch.root_chat_jid}`; select.append(option);
  }
  select.value = current;
}

async function start(): Promise<void> {
  try {
    await prepareFamilyBrowser();
    const identity = await fetchFamilyIdentity(AbortSignal.timeout(15_000));
    if (stopped) return;
    api = new FamilyApi(identity, invalidate); logout.disabled = false;
    settings = new FamilyAccount(api);
    administration = new FamilyAdministration(api);
    workspacePolicy = new FamilyWorkspace(api);
    preferences = new FamilyPreferences(api);
    tasks = new FamilyTasks(api, {
      lock: value => {
        if (value && (busy || paused || stopped)) return false;
        busy = value; generation++; refreshing = null; controls(false); return true;
      },
      changed: async () => { await loadTimeline(); },
    });
    results = new FamilyResults(api, {
      beforeCancel: () => { tasks?.disarmRun(); memory?.disarm(); },
      lock: value => {
        if (value && (busy || paused || stopped)) return false;
        busy = value; generation++; refreshing = null; controls(false); return true;
      },
      changed: async () => { await loadTimeline(); },
    });
    memory = new FamilyMemory(api, {
      beforeWithdraw: () => { tasks?.disarmRun(); memory?.disarm(); },
      lock: value => {
        if (value && (busy || paused || stopped)) return false;
        busy = value; generation++; refreshing = null; controls(false); return true;
      },
      changed: async () => { await loadTimeline(); },
    });
    sessionSettings = new FamilySessions(api, {
      lock: value => {
        if (value && (busy || paused || stopped)) return false;
        busy = value; generation++; refreshing = null; controls(false); return true;
      },
      navigate: switchSession,
      changed: async () => {
        try { await refreshDirectory(); await loadTimeline(); }
        catch (failure) { if (!stopped && !paused) error.textContent = (failure as Error).message; }
      },
    });
    const requested = new URL(location.href).searchParams.getAll('chat_jid');
    if (requested.length > 1 || (requested.length === 1 && !requested[0]?.trim())) throw new Error('Invalid session selection. Use Go home.');
    current = requested[0] ?? identity.homeChatJid;
    await refreshDirectory();
    // An explicit inaccessible URL is tested by the server, never silently rewritten to home.
    select.value = current; home.disabled = false; refresh.disabled = false; select.disabled = false;
    await loadTimeline();
    polling = setInterval(() => { void loadTimeline(); }, 5000);
  } catch (failure) { if (!stopped) { error.textContent = (failure as Error).message; status.textContent = 'Unable to open this session.'; if (api) home.disabled = false; } }
}

select.addEventListener('change', () => { void switchSession(select.value); });
home.addEventListener('click', () => { if (api) void switchSession(api.identity.homeChatJid); });
refresh.addEventListener('click', () => { error.textContent = ''; void loadTimeline(); });
addEventListener('blur', () => { paused = true; mask(); });
async function resumeVisiblePage(): Promise<void> {
  paused = false;
  if (!busy) { await loadTimeline(); return; }
  if (!api || stopped || document.hidden) return;
  // Cancellation must remain reachable after focus loss even while another mutation holds the shell lock.
  // Revalidate only the account, not the busy conversation; leave all other private UI masked.
  const expected = generation;
  try {
    await api.verifyIdentity();
    if (!stopped && !paused && !document.hidden && expected === generation) { results?.resume(); memory?.resume(); }
  } catch (failure) {
    if (!stopped && !paused && !document.hidden && expected === generation) error.textContent = (failure as Error).message;
  }
}
addEventListener('focus', () => { void resumeVisiblePage(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { paused = true; mask(); } else { void resumeVisiblePage(); } });
addEventListener('pagehide', invalidate);
addEventListener('pageshow', event => { if ((event as PageTransitionEvent).persisted) invalidate(); });

form.addEventListener('submit', async event => {
  event.preventDefault(); if (!api || stopped || busy || send.disabled || !current) return;
  const text = compose.value;
  if (!text.trim() || /^[\s]*[/@]/.test(text)) { error.textContent = 'Enter plain text; commands and mentions are not yet supported.'; return; }
  if (!pending || pending.text !== text || pending.chat !== current) pending = { text, chat: current, requestId: crypto.randomUUID() };
  busy = true; generation++; controls(false);
  try {
    await api.request(`/agent/default/message?chat_jid=${encodeURIComponent(current)}`, 'POST', { content: text, request_id: pending.requestId });
    if (stopped) return;
    pending = null; compose.value = ''; error.textContent = ''; status.textContent = 'Message queued.';
  } catch (failure) { if (!stopped) error.textContent = `${(failure as Error).message} Resend unchanged text to reuse the request ID; do not assume it was rejected.`; }
  finally { busy = false; if (!stopped) { refreshing = null; await loadTimeline(); } }
});
logout.addEventListener('click', async () => {
  if (!api || stopped || busy) return;
  busy = true; controls(false); logout.disabled = true;
  try {
    await api.logout(); invalidate(); location.replace('/login');
  } catch (failure) { if (!stopped) { error.textContent = (failure as Error).message; logout.disabled = false; } }
  finally { busy = false; if (!stopped) void loadTimeline(); }
});
confirmSkip.addEventListener('change', () => { skip.disabled = busy || heldRow === null || !confirmSkip.checked; });
async function recover(action: 'retry' | 'skip' | 'dismiss-legacy'): Promise<void> {
  if (!api || stopped || busy || paused || heldRow === null || (action !== 'retry' && !confirmSkip.checked) || (legacyHeld ? action!=='dismiss-legacy' : action==='dismiss-legacy')) return;
  if (!recoveryRequest || recoveryRequest.row !== heldRow || recoveryRequest.action !== action) recoveryRequest = { row: heldRow, action, requestId: crypto.randomUUID() };
  busy = true; generation++; controls(false);
  try {
    await api.request('/agent/message-recovery', 'POST', { chat_jid: current, message_rowid: heldRow, action, request_id: recoveryRequest.requestId });
    if (!stopped) { recoveryRequest = null; confirmSkip.checked = false; error.textContent = ''; }
  } catch (failure) {
    if (!stopped) error.textContent = `${(failure as Error).message} Retry the same action to reuse its request ID; refresh before choosing another input.`;
  } finally { busy = false; if (!stopped) { refreshing = null; await loadTimeline(); } }
}
retry.addEventListener('click', () => { void recover('retry'); });
skip.addEventListener('click', () => { void recover(legacyHeld?'dismiss-legacy':'skip'); });
void start();
