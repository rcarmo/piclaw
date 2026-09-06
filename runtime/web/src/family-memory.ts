import { FamilyApi } from './family-api.js';

const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const label = (v: unknown, max = 256): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !v.includes('\0') && new TextEncoder().encode(v).byteLength <= max;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export interface MemorySource { chat_jid: string; message_rowid: number; message_id: string }
export function validMemorySource(v: any): v is MemorySource {
  return !!v && label(v.chat_jid) && label(v.message_id) && Number.isSafeInteger(v.message_rowid) && v.message_rowid > 0;
}
interface Item { publication_id: string; request_id: string; published_at: string; withdrawn: boolean }
interface Draft extends MemorySource { source_hash: string; text: string; request_id: string; confirm: true }
const base = '/agent/family-memory';

/** Explicit memory actions only. No browser storage, automatic reload or publication. */
export class FamilyMemory {
  private root = node('family-memory'); private status = node('memory-status'); private list = node('memory-list');
  private editor = node<HTMLFormElement>('memory-form'); private excerpt = node<HTMLTextAreaElement>('memory-excerpt');
  private confirm = node<HTMLInputElement>('confirm-memory-publication'); private publish = node<HTMLButtonElement>('publish-memory');
  private detail = node('memory-detail'); private withdrawConfirm = node<HTMLInputElement>('confirm-memory-withdrawal'); private withdraw = node<HTMLButtonElement>('withdraw-memory');
  private opened = false; private paused = true; private stopped = false; private busy = false; private blocked = false;
  private generation = 0; private controller: AbortController | null = null;
  private source: (MemorySource & { source_hash: string; text: string }) | null = null;
  private retry: Draft | null = null; private selected: string | null = null;
  constructor(private api: FamilyApi, private hooks: { lock: (v: boolean) => boolean; changed: () => Promise<void>; beforeWithdraw: () => void }) {
    node('open-memory').addEventListener('click', () => {
      if (this.paused || this.stopped || this.busy) return;
      if (this.opened && !this.root.hidden) { node('memory-heading').focus(); return; }
      this.opened = true; void this.load(false, true);
    });
    node('close-memory').addEventListener('click', () => { this.opened = false; this.clear(); node('open-memory').focus(); });
    node('refresh-memory').addEventListener('click', () => { void this.load(false); });
    node('shared-memory').addEventListener('click', () => { void this.load(true); });
    node('discard-memory').addEventListener('click', () => { if (!this.busy && this.visible()) { this.resetDraft(); this.status.textContent = 'Draft discarded. Refresh memory history and inspect before creating another publication.'; } });
    this.excerpt.addEventListener('input', () => this.disarm());
    this.confirm.addEventListener('change', () => this.controls());
    this.withdrawConfirm.addEventListener('change', () => this.controls());
    this.editor.addEventListener('submit', e => { e.preventDefault(); void this.publishDraft(); });
    this.withdraw.addEventListener('click', () => { void this.withdrawSelected(); });
  }
  private visible(): boolean { return this.opened && !this.paused && !this.stopped && !document.hidden; }
  disarm(): void { this.confirm.checked = false; this.publish.disabled = true; }
  setBlocked(v: boolean): void { this.blocked = v; if (v) this.disarm(); this.controls(); }
  private controls(): void {
    this.confirm.disabled = !this.visible() || this.busy || this.blocked || !this.source;
    this.publish.disabled = this.confirm.disabled || !this.confirm.checked;
    this.withdrawConfirm.disabled = !this.visible() || this.busy || !this.selected;
    this.withdraw.disabled = this.withdrawConfirm.disabled || !this.withdrawConfirm.checked;
  }
  private resetDraft(): void {
    this.source = null; this.retry = null; this.excerpt.value = ''; this.excerpt.disabled = false; this.editor.hidden = true;
    node('memory-source-text').textContent = ''; node('memory-source-target').textContent = ''; this.disarm(); this.publish.textContent = 'Publish memory';
  }
  private resetDetail(): void {
    this.selected = null; this.withdrawConfirm.checked = false; this.detail.hidden = true;
    node('memory-detail-text').textContent = ''; node('memory-detail-meta').textContent = ''; this.controls();
  }
  private clear(): void {
    this.generation++; this.controller?.abort(); this.controller = null; this.root.hidden = true; this.list.replaceChildren(); this.status.textContent = '';
    this.resetDraft(); this.resetDetail(); this.controls();
  }
  suspend(): void { this.paused = true; this.clear(); node<HTMLButtonElement>('open-memory').disabled = true; }
  resume(): void {
    if (this.stopped) return;
    const wasPaused = this.paused; this.paused = false; node<HTMLButtonElement>('open-memory').disabled = this.busy;
    if (wasPaused && this.opened) { this.root.hidden = false; this.status.textContent = 'Private content cleared. Refresh memory history before another action.'; }
    this.controls();
  }
  stop(): void { this.stopped = true; this.opened = false; this.clear(); node<HTMLButtonElement>('open-memory').disabled = true; }
  private start() { this.controller?.abort(); this.controller = new AbortController(); return { generation: ++this.generation, signal: this.controller.signal }; }
  private active(g: number): boolean { return this.visible() && this.generation === g; }
  private validCopy(v: any): boolean {
    return uuid(v?.publication_id) && v.source_kind === 'message-excerpt' && label(v.publisher?.user_id) && label(v.publisher.username, 64)
      && label(v.publisher.display_name, 256) && date(v.published_at) && text(v.text, 16384) && !!v.text.trim();
  }
  private async load(shared: boolean, focus = false): Promise<void> {
    if (!this.visible() || this.busy) return;
    this.clear(); this.root.hidden = false; this.status.textContent = 'Loading memory…'; const request = this.start(); if (focus) node('memory-heading').focus();
    try {
      const value = await this.api.request(base + (shared ? '/shared' : '/own'), 'GET', undefined, request.signal); if (!this.active(request.generation)) return;
      if (!Array.isArray(value?.items) || value.items.length > (shared ? 20 : 100) || value.window_size !== (shared ? 20 : 100)
        || (!shared && value.owner_user_id !== this.api.identity.userId)) throw Error('Invalid memory list.');
      const fragment = document.createDocumentFragment(), ids = new Set<string>();
      for (const item of value.items) {
        if (!uuid(item?.publication_id) || ids.has(item.publication_id) || !date(item.published_at)
          || (shared ? !this.validCopy(item) : !uuid(item.request_id) || typeof item.withdrawn !== 'boolean')) throw Error('Invalid memory metadata.');
        ids.add(item.publication_id); const li = document.createElement('li'), meta = document.createElement('p');
        meta.textContent = shared ? `Published by ${item.publisher.display_name} (@${item.publisher.username}; ${item.publisher.user_id}) · ${item.published_at}`
          : `${item.publication_id} · Request ${item.request_id} · ${item.published_at} · ${item.withdrawn ? 'withdrawn' : 'published'}`;
        li.append(meta);
        if (shared) { const body = document.createElement('div'); body.className = 'post-text'; body.textContent = item.text; li.append(body); }
        else { const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Inspect memory'; button.addEventListener('click', () => { void this.inspect(item); }); li.append(button); }
        fragment.append(li);
      }
      this.list.replaceChildren(fragment); this.status.textContent = shared ? 'Newest 20 shared copies. Publisher attribution is not proof of authorship or truth.'
        : 'Your retained publication history (up to 100). Inspect uncertain requests before publishing again. Select Preview for family memory on a conversation message to start a new draft.';
    } catch (e) { if (this.active(request.generation)) { this.list.replaceChildren(); this.status.textContent = (e as Error).message; } }
  }
  async previewSource(source: MemorySource): Promise<void> {
    if (this.paused || this.stopped || this.busy || this.blocked || document.hidden || !validMemorySource(source)) return;
    this.opened = true; this.clear(); this.root.hidden = false; const request = this.start(); this.status.textContent = 'Loading exact owned source…'; node('memory-heading').focus();
    const target = { ...source };
    try {
      const value = await this.api.request(base + '/preview', 'POST', target, request.signal); if (!this.active(request.generation)) return;
      const sourceHash = value?.source_hash, sourceText = value?.text;
      if (!validMemorySource(value) || value.chat_jid !== target.chat_jid || value.message_id !== target.message_id || value.message_rowid !== target.message_rowid
        || !hash(sourceHash) || !text(sourceText, 102400) || !sourceText.length) throw Error('Invalid memory source response.');
      this.source = { ...target, source_hash: sourceHash, text: sourceText }; this.editor.hidden = false;
      node('memory-source-target').textContent = `Source: ${target.chat_jid} · Message ${target.message_rowid} (${target.message_id})`;
      node('memory-source-text').textContent = sourceText; this.status.textContent = 'Choose only the exact excerpt to share. The rest of this source stays outside the shared copy.'; this.controls(); this.excerpt.focus();
    } catch (e) { if (this.active(request.generation)) { this.resetDraft(); this.status.textContent = (e as Error).message; } }
  }
  private async inspect(item: Item): Promise<void> {
    if (!this.visible() || this.busy) return;
    this.resetDraft(); this.resetDetail(); const request = this.start(); this.status.textContent = 'Loading memory receipt…';
    try {
      const value = await this.api.request(`${base}/${item.publication_id}`, 'GET', undefined, request.signal); if (!this.active(request.generation)) return;
      if (!this.validCopy(value) || value.publication_id !== item.publication_id || value.request_id !== item.request_id || value.published_at !== item.published_at
        || value.publisher.user_id !== this.api.identity.userId || typeof value.withdrawn !== 'boolean' || !validMemorySource(value.source) || !hash(value.source.source_hash)) throw Error('Invalid memory receipt.');
      this.detail.hidden = false; node('memory-detail-text').textContent = value.text;
      node('memory-detail-meta').textContent = `${value.publication_id} · ${value.withdrawn ? 'withdrawn' : 'published'} · Published by ${value.publisher.display_name} (${value.publisher.user_id}) · Source ${value.source.chat_jid}, message ${value.source.message_rowid}`;
      if (!value.withdrawn) this.selected = value.publication_id;
      this.status.textContent = ''; this.controls(); node('memory-detail-heading').focus();
    } catch (e) { if (this.active(request.generation)) { this.resetDetail(); this.status.textContent = (e as Error).message; } }
  }
  private async publishDraft(): Promise<void> {
    if (!this.visible() || this.busy || this.blocked || !this.source || !this.confirm.checked) return;
    const s = this.source; let payload: Draft;
    try {
      if (this.retry) payload = this.retry;
      else {
        const excerpt = this.excerpt.value;
        if (!text(excerpt, 16384) || !excerpt.trim() || !s.text.includes(excerpt)) throw Error('Choose a non-empty verbatim excerpt up to 16 KiB UTF-8.');
        payload = { chat_jid: s.chat_jid, message_rowid: s.message_rowid, message_id: s.message_id, source_hash: s.source_hash, text: excerpt, request_id: crypto.randomUUID(), confirm: true };
        if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 131072) throw Error('Encoded publication exceeds 128 KiB.');
      }
    } catch (e) { this.disarm(); this.status.textContent = (e as Error).message; return; }
    if (!this.hooks.lock(true)) return;
    this.retry = payload; this.busy = true; this.excerpt.disabled = true; this.disarm(); this.controls(); const request = this.start(); this.status.textContent = 'Publishing memory…';
    try {
      const value = await this.api.request(base, 'POST', payload, request.signal); if (!this.active(request.generation)) return;
      if (value?.request_id !== payload.request_id || !uuid(value.publication_id) || typeof value.created !== 'boolean') throw Error('Invalid memory publication response.');
      this.resetDraft(); this.status.textContent = `${value.created ? 'Memory published' : 'Publication verified'}: ${value.publication_id}. Refresh memory history to inspect or withdraw it.`;
    } catch (e) { if (this.active(request.generation)) { this.publish.textContent = 'Retry same memory publication'; this.status.textContent = `${(e as Error).message} Publication may have completed. Reconfirm to retry this exact request; the excerpt stays locked. Discard or leaving clears the key: inspect history before another publication.`; } }
    finally { this.busy = false; this.hooks.lock(false); if (!this.stopped) await this.hooks.changed(); this.controls(); }
  }
  private async withdrawSelected(): Promise<void> {
    if (!this.visible() || this.busy || !this.selected || !this.withdrawConfirm.checked) return;
    this.hooks.beforeWithdraw(); const id = this.selected; this.busy = true; this.withdrawConfirm.checked = false; this.controls(); const request = this.start(); this.status.textContent = 'Withdrawing memory…';
    // Revocation does not acquire or release the shell's mutation lock.
    try {
      const value = await this.api.request(`${base}/${id}/withdraw`, 'POST', { confirm: true }, request.signal); if (!this.active(request.generation)) return;
      if (value?.publication_id !== id || value.withdrawn !== true || typeof value.created !== 'boolean') throw Error('Invalid memory withdrawal response.');
      this.resetDetail(); this.status.textContent = 'Memory withdrawal verified. Previous copies cannot be retracted. Refresh memory history before another action.';
    } catch (e) { if (this.active(request.generation)) { this.resetDetail(); this.status.textContent = `${(e as Error).message} Withdrawal may have completed. Refresh and inspect before confirming again.`; } }
    finally { this.busy = false; if (!this.stopped) await this.hooks.changed(); this.controls(); }
  }
}
