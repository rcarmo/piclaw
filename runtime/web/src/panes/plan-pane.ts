// @ts-nocheck
/**
 * plan-pane.ts — the session plan as a work-area tab (Classic workbench).
 *
 * Shows the current chat's plan checklist with progress, and edits it as
 * Markdown. Storage, the model-facing `plan` tool and prompt injection still
 * come from the plan-sidebar add-on (see #1991); this pane uses its API and
 * replaces the add-on's floating panel in Classic.
 */
import { html, render, useCallback, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import type { PaneContext, PaneInstance, WebPaneExtension } from './pane-types.js';

export const PLAN_TAB_PATH = 'piclaw://plan';
const PLAN_API = '/agent/addons/api/plan-sidebar/plan';
const PLAN_CHANGE_KEYS = new Set(['plan.changes', 'plan-sidebar.plan-updated']);

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed';
export interface PlanItem { step: string; status: PlanItemStatus }

/** Checklist items from plan Markdown: `[ ]` pending, `[-]` in progress, `[x]` completed. */
export function parsePlanChecklist(markdown: unknown): PlanItem[] {
  const items: PlanItem[] = [];
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const match = /^\s*[-*+]\s+\[([ xX-])\]\s+(.*\S)\s*$/.exec(line);
    if (!match) continue;
    const mark = match[1];
    items.push({ step: match[2], status: mark === '-' ? 'in_progress' : mark === ' ' ? 'pending' : 'completed' });
  }
  return items;
}

export function summarisePlan(items: PlanItem[]): { total: number; completed: number; percent: number } {
  const total = items.length;
  const completed = items.filter((item) => item.status === 'completed').length;
  return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 };
}

/** The same submission prompt the add-on panel sends. */
export function buildPlanSubmissionPrompt(markdown: string): string {
  return [
    'Use this `plan` tool checklist as the working plan.',
    '',
    '- Continue with the next relevant item.',
    '- Update the plan as work changes or completes.',
    '- Prefer `plan` `action=update` with structured items for full-plan updates.',
    '- Use `action=edit` with exact whole-line replacements for small checklist updates.',
    '- Use `action=write` only for a full raw Markdown rewrite.',
    '- Keep at most one item in progress (`[-]`).',
    '- Report periodically on progress and next steps.',
    '',
    '```markdown',
    markdown,
    '```',
  ].join('\n');
}

function currentChatJid(): string {
  return new URL(location.href).searchParams.get('chat_jid')?.trim() || 'web:default';
}

async function planRequest(chatJid: string, init?: RequestInit) {
  const response = await fetch(`${PLAN_API}?chat_jid=${encodeURIComponent(chatJid)}`, { credentials: 'same-origin', ...init });
  // Without the add-on the route is unknown: 404, or a non-JSON server error page.
  const json = (response.headers.get('content-type') || '').includes('json');
  if (response.status === 404 || (!response.ok && !json)) {
    if (init?.method === 'POST') throw new Error('Plan API unavailable. Edits were not saved or submitted.');
    return { unavailable: true };
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `${response.status} ${response.statusText}`);
  return payload?.plan || payload;
}

// Drawn rather than typed: symbol-font fallbacks gave the half-circle glyph
// different metrics from the others and clipped it.
const statusIcon = path => html`<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${path}</svg>`;
const STATUS_ICONS = {
  completed: statusIcon(html`<path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`),
  in_progress: statusIcon(html`<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor"/>`),
  pending: statusIcon(html`<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/>`),
};
const STATUS_LABELS = { completed: 'Completed', in_progress: 'In progress', pending: 'Pending' };

function PlanPaneView({ onDirtyChange }) {
  const [chatJid, setChatJid] = useState(currentChatJid);
  const drafts = useRef(new Map());
  useEffect(() => {
    const sync = () => setChatJid(currentChatJid());
    window.addEventListener('popstate', sync);
    window.addEventListener('piclaw:current-chat-changed', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('piclaw:current-chat-changed', sync); };
  }, []);
  return html`<${ChatPlanPane} key=${chatJid} chatJid=${chatJid} drafts=${drafts.current} onDirtyChange=${onDirtyChange} />`;
}

function ChatPlanPane({ chatJid, drafts, onDirtyChange }) {
  const retained = drafts.get(chatJid);
  const [markdown, setMarkdown] = useState(retained?.markdown || '');
  const [draft, setDraft] = useState(retained?.draft ?? null);
  const active = useRef(true);
  const requestSequence = useRef(0);
  useEffect(() => () => { active.current = false; }, []);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [status, setStatus] = useState({ text: 'Loading…', kind: 'info' });
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const editing = draft !== null;
  const warnChanged = () => setStatus({ text: 'Plan changed; save or cancel your edits.', kind: 'warning' });
  const showError = error => setStatus({ text: String(error?.message || error), kind: 'error' });

  useEffect(() => {
    if (editing && draft !== markdown) drafts.set(chatJid, { draft, markdown });
    onDirtyChange?.(drafts.size > 0);
  }, [chatJid, draft, drafts, editing, markdown, onDirtyChange]);

  const load = useCallback(async (label = '') => {
    if (draftRef.current !== null) {
      warnChanged();
      return;
    }
    const sequence = ++requestSequence.current;
    setBusy(true);
    try {
      const plan = await planRequest(chatJid);
      if (!active.current || sequence !== requestSequence.current) return;
      if (draftRef.current !== null) { warnChanged(); return; }
      if (plan.unavailable) {
        setUnavailable(true);
        return;
      }
      setUnavailable(false);
      setMarkdown(plan.markdown || '');
      setUpdatedAt(plan.updated_at || null);
      setStatus({ text: label || (plan.updated_at ? 'Loaded' : 'Default plan'), kind: 'info' });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }, [chatJid]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onStatus = (event) => {
      const payload = event?.detail?.payload || event?.detail || {};
      if (!PLAN_CHANGE_KEYS.has(payload?.key)) return;
      if ((payload.chat_jid || 'web:default') !== chatJid) return;
      void load(payload.source === 'tool' ? 'Updated by the model' : 'Updated');
    };
    window.addEventListener('piclaw-extension-ui:status', onStatus);
    return () => {
      window.removeEventListener('piclaw-extension-ui:status', onStatus);
    };
  }, [chatJid, load]);

  const save = useCallback(async () => {
    const next = draftRef.current ?? markdown;
    setBusy(true);
    try {
      const plan = await planRequest(chatJid, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_jid: chatJid, markdown: next }) });
      if (!active.current) return null;
      setMarkdown(plan.markdown ?? next);
      setUpdatedAt(plan.updated_at || null);
      drafts.delete(chatJid);
      setDraft(null);
      setStatus({ text: 'Saved', kind: 'ok' });
      return plan.markdown ?? next;
    } catch (error) {
      showError(error);
      return null;
    } finally {
      setBusy(false);
    }
  }, [chatJid, markdown]);

  const reset = useCallback(async () => {
    if (!window.confirm('Reset this chat plan to the default checklist?')) return;
    setBusy(true);
    try {
      const plan = await planRequest(chatJid, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_jid: chatJid, action: 'reset' }) });
      if (!active.current) return;
      setMarkdown(plan.markdown || '');
      setUpdatedAt(plan.updated_at || null);
      drafts.delete(chatJid);
      setDraft(null);
      setStatus({ text: 'Reset', kind: 'ok' });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }, [chatJid]);

  const submit = useCallback(async () => {
    const saved = editing ? await save() : markdown;
    if (saved === null || !active.current) return;
    if (!String(saved).trim()) {
      setStatus({ text: 'Plan is empty.', kind: 'error' });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/agent/default/message?chat_jid=${encodeURIComponent(chatJid)}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: buildPlanSubmissionPrompt(String(saved)), mode: 'auto' }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `${response.status} ${response.statusText}`);
      }
      if (!active.current) return;
      setStatus({ text: 'Submitted to model', kind: 'ok' });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }, [chatJid, editing, markdown, save]);

  if (unavailable) {
    return html`<div class="plan-pane plan-pane-unavailable" role="status">Plans need the plan-sidebar add-on. Install it from Settings → Add-ons, then reopen this tab.</div>`;
  }

  const items = parsePlanChecklist(markdown);
  const summary = summarisePlan(items);
  return html`
    <section class="plan-pane" aria-label=${`Plan for ${chatJid}`}>
      <header class="plan-pane-header">
        <div class="plan-pane-title">
          <span>Plan</span>
          <span class="plan-pane-chat">${chatJid}</span>
        </div>
        <div class="plan-pane-progress" role="meter" aria-label="Plan progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${summary.percent}>
          <span class="plan-pane-progress-bar"><span style=${`width:${summary.percent}%`}></span></span>
          <span class="plan-pane-progress-text">${summary.completed}/${summary.total}</span>
        </div>
      </header>
      ${editing
        ? html`<textarea class="plan-pane-editor" aria-label="Plan Markdown" spellcheck="false" value=${draft}
            onInput=${(event) => {
              const next = event.currentTarget.value;
              drafts.set(chatJid, { draft: next, markdown });
              setDraft(next);
            }}
            onKeyDown=${(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); void save(); } }}></textarea>`
        : html`
          <ol class="plan-pane-items">
            ${items.length === 0 && html`<li class="plan-pane-empty">No checklist items yet. Use Edit to add some, or ask the model to plan.</li>`}
            ${items.map((item, index) => html`
              <li key=${index} class=${`plan-pane-item ${item.status}`}>
                <span class="plan-pane-item-icon" role="img" aria-label=${STATUS_LABELS[item.status]}>${STATUS_ICONS[item.status]}</span>
                <span class="plan-pane-item-step">${item.step}</span>
              </li>
            `)}
          </ol>`}
      <div class="plan-pane-toolbar">
        ${editing
          ? html`<button type="button" class="plan-pane-primary" disabled=${busy} onClick=${() => void save()}>Save</button>
                 <button type="button" disabled=${busy} onClick=${() => { drafts.delete(chatJid); setDraft(null); setStatus({ text: 'Edits discarded', kind: 'info' }); }}>Cancel</button>`
          : html`<button type="button" disabled=${busy} onClick=${() => setDraft(markdown)}>Edit</button>`}
        <button type="button" disabled=${busy || editing} onClick=${() => void load('Refreshed')}>Refresh</button>
        <button type="button" disabled=${busy} onClick=${() => void reset()}>Reset</button>
        <span class="plan-pane-spacer"></span>
        <button type="button" class="plan-pane-primary" disabled=${busy} onClick=${() => void submit()}>Submit to model</button>
      </div>
      <footer class=${`plan-pane-status ${status.kind}`} role="status">${status.text}${updatedAt && !editing ? html` · ${new Date(updatedAt).toLocaleTimeString()}` : ''}</footer>
    </section>
  `;
}

class PlanPaneInstance implements PaneInstance {
  private host: HTMLElement;
  private dirty = false;
  private dirtyListeners: Array<(dirty: boolean) => void> = [];

  constructor(container: HTMLElement) {
    this.host = document.createElement('div');
    this.host.className = 'plan-pane-host';
    container.appendChild(this.host);
    render(html`<${PlanPaneView} onDirtyChange=${(dirty) => this.setDirty(dirty)} />`, this.host);
  }

  private setDirty(dirty: boolean) {
    if (this.dirty === dirty) return;
    this.dirty = dirty;
    for (const listener of this.dirtyListeners) listener(dirty);
  }

  getContent() { return undefined; }
  isDirty() { return this.dirty; }
  onDirtyChange(cb: (dirty: boolean) => void) { this.dirtyListeners.push(cb); }
  focus() { (this.host.querySelector('textarea, button') as HTMLElement | null)?.focus(); }
  dispose() {
    render(null, this.host);
    this.host.remove();
    this.dirtyListeners = [];
  }
}

export const planPaneExtension: WebPaneExtension = {
  id: 'plan',
  label: 'Plan',
  placement: 'tabs',
  capabilities: ['readonly'],
  canHandle(context: PaneContext) {
    return context?.path === PLAN_TAB_PATH ? 9000 : false;
  },
  mount(container: HTMLElement) {
    return new PlanPaneInstance(container);
  },
};
