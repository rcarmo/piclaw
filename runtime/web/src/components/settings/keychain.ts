/**
 * settings/keychain.ts — Keychain management panel for the settings dialog.
 * Lists entries (name, type, env var, dates). Supports add, delete, and reveal.
 * Revealing requires the master password and optionally a TOTP code.
 */
import { html, useState, useEffect, useCallback, useRef, useMemo } from '../../vendor/preact-htm.js';
import { useTranslation } from '../../utils/i18n.js';

function formatDate(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return iso; }
}

const TYPE_OPTIONS = ['secret', 'token', 'password', 'basic'];
let keychainInstanceId = 0;

export function KeychainSection({ filter = '' }) {
    const { t: tr } = useTranslation();
    const fieldPrefixRef = useRef(null);
    if (!fieldPrefixRef.current) fieldPrefixRef.current = `settings-keychain-${++keychainInstanceId}`;
    const fieldPrefix = fieldPrefixRef.current;
    const fieldId = (name) => `${fieldPrefix}-keychain-${name}`;
    const addButtonRef = useRef(null);
    const revealButtonRefs = useRef(new Map());
    const deleteButtonRefs = useRef(new Map());
    const noteButtonRefs = useRef(new Map());
    const confirmButtonRef = useRef(null);
    const pendingFocusRef = useRef(null);
    const [announcement, setAnnouncement] = useState('');
    const restoreFocus = (kind, name = null) => { pendingFocusRef.current = { kind, name }; };
    const closeReveal = (name) => { restoreFocus('reveal', name); setRevealState(null); };

    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [keychainStatus, setKeychainStatus] = useState(null);
    const [error, setError] = useState(null);
    const [showAdd, setShowAdd] = useState(false);
    const [addName, setAddName] = useState('');
    const [addSecret, setAddSecret] = useState('');
    const [addUsername, setAddUsername] = useState('');
    const [addUserNote, setAddUserNote] = useState('');
    const [addAgentNote, setAddAgentNote] = useState('');
    const [addType, setAddType] = useState('secret');
    const [saving, setSaving] = useState(false);
    const [noteDrafts, setNoteDrafts] = useState({});
    const [savingNote, setSavingNote] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null);
    // Reveal state: { name, phase: 'password'|'totp'|'revealed'|'error', masterPassword?, totpCode?, secret?, username?, error? }
    const [revealState, setRevealState] = useState(null);
    const nameRef = useRef(null);
    const passwordRef = useRef(null);
    const totpRef = useRef(null);

    const fetchEntries = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const resp = await fetch('/agent/keychain');
            const data = await resp.json();
            if (data?.ok) {
                setEntries(data.entries || []);
            setKeychainStatus(data.status || null);
            } else {
                setError(data?.error || tr('settings.keychain.loadFailed'));
            }
        } catch {
            setError(tr('settings.keychain.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchEntries(); }, [fetchEntries]);

    const handleAdd = useCallback(async () => {
        const name = addName.trim();
        const secret = addSecret;
        if (!name || !secret) return;
        setSaving(true);
        try {
            const resp = await fetch('/agent/keychain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    secret,
                    type: addType,
                    username: addUsername.trim() || undefined,
                    userNote: addUserNote,
                    agentNote: addAgentNote,
                }),
            });
            const data = await resp.json();
            if (data?.ok) {
                restoreFocus('add');
                setAnnouncement('Keychain entry saved.');
                setAddName(''); setAddSecret(''); setAddUsername(''); setAddUserNote(''); setAddAgentNote(''); setAddType('secret'); setShowAdd(false);
                await fetchEntries();
            } else { setError(data?.error || tr('settings.keychain.addFailed')); }
        } catch { setError(tr('settings.keychain.addFailed')); }
        finally { setSaving(false); }
    }, [addName, addSecret, addUsername, addUserNote, addAgentNote, addType, fetchEntries]);

    const handleDelete = useCallback(async (name) => {
        try {
            const resp = await fetch('/agent/keychain', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await resp.json();
            if (data?.ok) {
                restoreFocus('add');
                setAnnouncement('Keychain entry deleted.');
                setConfirmDelete(null);
                setRevealState(s => s?.name === name ? null : s);
                await fetchEntries();
            } else { setError(data?.error || tr('settings.keychain.deleteFailed')); }
        } catch { setError(tr('settings.keychain.deleteFailed')); }
    }, [fetchEntries]);

    const handleSaveNotes = useCallback(async (entry) => {
        const name = entry?.name;
        if (!name) return;
        const draft = noteDrafts[name] || {};
        const userNote = Object.prototype.hasOwnProperty.call(draft, 'userNote') ? draft.userNote : (entry.userNote || '');
        const agentNote = Object.prototype.hasOwnProperty.call(draft, 'agentNote') ? draft.agentNote : (entry.agentNote || '');
        setSavingNote(name);
        try {
            const resp = await fetch('/agent/keychain/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, userNote, agentNote }),
            });
            const data = await resp.json();
            if (data?.ok) {
                restoreFocus('notes', name);
                setAnnouncement('Keychain notes saved.');
                setNoteDrafts(prev => {
                    const next = { ...(prev || {}) };
                    delete next[name];
                    return next;
                });
                await fetchEntries();
            } else { setError(data?.error || tr('settings.keychain.saveNotesFailed')); }
        } catch { setError(tr('settings.keychain.saveNotesFailed')); }
        finally { setSavingNote(null); }
    }, [noteDrafts, fetchEntries]);

    const setNoteDraft = useCallback((name, field, value) => {
        setNoteDrafts(prev => ({
            ...(prev || {}),
            [name]: {
                ...((prev || {})[name] || {}),
                [field]: value,
            },
        }));
    }, []);

    const doReveal = useCallback(async (name, masterPassword, totpCode) => {
        try {
            const resp = await fetch('/agent/keychain/reveal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, master_password: masterPassword || undefined, totp_code: totpCode || undefined }),
            });
            const data = await resp.json();
            if (data?.ok) {
                restoreFocus('reveal', name);
                setAnnouncement('Secret revealed.');
                setRevealState({ name, phase: 'revealed', secret: data.secret, username: data.username, masterPassword });
            } else if (data?.needs_master_password) {
                setRevealState(prev => ({
                    name, phase: 'password', masterPassword: '',
                    error: prev?.name === name && prev?.masterPassword ? data.error : null,
                }));
                requestAnimationFrame(() => passwordRef.current?.focus());
            } else if (data?.needs_totp) {
                setRevealState(prev => ({
                    name, phase: 'totp', masterPassword, totpCode: '',
                    error: prev?.name === name && prev?.phase === 'totp' && prev?.totpCode ? data.error : null,
                }));
                requestAnimationFrame(() => totpRef.current?.focus());
            } else {
                setRevealState({ name, phase: 'error', error: data?.error || tr('settings.keychain.revealFailed') });
            }
        } catch {
            setRevealState({ name, phase: 'error', error: tr('settings.keychain.revealFailed') });
        }
    }, []);

    const handleRevealClick = useCallback((name) => {
        if (revealState?.name === name && revealState?.phase === 'revealed') {
            setRevealState(null); // toggle off
            return;
        }
        // Start the reveal flow — server will tell us what's needed
        doReveal(name, null, null);
    }, [revealState, doReveal]);

    const handlePasswordSubmit = useCallback((name) => {
        const pw = revealState?.masterPassword || '';
        if (!pw) return;
        doReveal(name, pw, null);
    }, [revealState, doReveal]);

    const handleTotpSubmit = useCallback((name) => {
        const code = revealState?.totpCode || '';
        if (code.length < 6) return;
        doReveal(name, revealState?.masterPassword, code);
    }, [revealState, doReveal]);

    const copyToClipboard = useCallback(async (text) => {
        try { await navigator.clipboard.writeText(text); }
        catch {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        }
    }, []);

    useEffect(() => {
        if (loading || !pendingFocusRef.current) return;
        const target = pendingFocusRef.current;
        const frame = requestAnimationFrame(() => {
            pendingFocusRef.current = null;
            const refs = target.kind === 'reveal' ? revealButtonRefs : target.kind === 'delete' ? deleteButtonRefs : noteButtonRefs;
            const element = target.kind === 'add' ? addButtonRef.current : refs.current.get(target.name);
            const focusTarget = target.kind === 'notes' && element?.disabled
                ? element.parentElement?.querySelector('textarea')
                : element;
            (focusTarget?.isConnected && !focusTarget.disabled ? focusTarget : addButtonRef.current)?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [loading, showAdd, revealState, confirmDelete, entries]);
    useEffect(() => {
        if (!confirmDelete) return;
        const frame = requestAnimationFrame(() => confirmButtonRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [confirmDelete]);

    useEffect(() => { if (showAdd) requestAnimationFrame(() => nameRef.current?.focus()); }, [showAdd]);

    const lf = filter.toLowerCase();
    const filtered = useMemo(() => {
        if (!lf) return entries;
        return entries.filter(e =>
            e.name.toLowerCase().includes(lf) ||
            (e.type || '').toLowerCase().includes(lf) ||
            (e.envVar || '').toLowerCase().includes(lf) ||
            (e.userNote || '').toLowerCase().includes(lf) ||
            (e.agentNote || '').toLowerCase().includes(lf)
        );
    }, [entries, lf]);

    if (loading) return html`<div class="settings-section"><div class="settings-loading">${tr('settings.keychain.loading')}</div></div>`;

    return html`
        <div class="settings-section">
            <div role="status" aria-live="polite" aria-atomic="true">${announcement}</div>
            ${error && html`
                <div class="settings-keychain-error" role="alert">
                    ${error}
                    <button class="settings-keychain-dismiss" aria-label="Dismiss keychain error" onClick=${() => setError(null)}>✕</button>
                </div>
            `}
            ${keychainStatus?.enabled === false && html`<div class="settings-keychain-error" role="status">Keychain storage is disabled. Configure PICLAW_KEYCHAIN_KEY or PICLAW_KEYCHAIN_KEY_FILE on the server before adding secrets.</div>`}
            <div class="settings-keychain-toolbar" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                <span class="settings-hint" style="margin:0; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <span>${filtered.length === 1 ? tr('settings.keychain.entryCountSingular', { count: filtered.length }) : tr('settings.keychain.entryCountPlural', { count: filtered.length })}${lf ? tr('settings.keychain.matchingFilter', { filter }) : ''}${tr('settings.keychain.encryptedSuffix')}</span>
                    <span style="display:inline-flex; align-items:center; gap:6px;">
                        <span>${tr('settings.keychain.clickPrefix')}</span>
                        <span aria-hidden="true" style="display:inline-flex; width:18px; height:18px; align-items:center; justify-content:center; border-radius:999px; border:1px solid var(--border-color, rgba(120,120,120,.22)); background:var(--panel-bg, rgba(255,255,255,.04));">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </span>
                        <span>${tr('settings.keychain.revealSuffix')}</span>
                    </span>
                </span>
                <button ref=${addButtonRef} class="settings-keychain-add-btn" disabled=${keychainStatus?.enabled === false} aria-expanded=${showAdd} aria-controls=${fieldId('add-form')} onClick=${() => { if (showAdd) restoreFocus('add'); setShowAdd(!showAdd); }}>
                    ${showAdd ? tr('settings.keychain.cancel') : tr('settings.keychain.addEntry')}
                </button>
            </div>

            ${showAdd && html`
                <div id=${fieldId('add-form')} class="settings-keychain-add-form" role="group" aria-label="Add keychain entry" aria-busy=${saving}>
                    <div class="settings-keychain-add-row">
                        <input ref=${nameRef} type="text" aria-label="Entry name" required aria-invalid=${addName.length > 0 && !addName.trim() ? 'true' : undefined} placeholder=${tr('settings.keychain.namePlaceholder')}
                            value=${addName} onInput=${e => setAddName(e.target.value)}
                            class="settings-keychain-input" />
                        <select aria-label="Entry type" value=${addType} onChange=${e => setAddType(e.target.value)}
                            class="settings-keychain-select">
                            ${TYPE_OPTIONS.map(t => html`<option value=${t}>${t}</option>`)}
                        </select>
                    </div>
                    <div class="settings-keychain-add-row">
                        <input type="password" aria-label="Entry secret" required placeholder=${tr('settings.keychain.secretPlaceholder')}
                            value=${addSecret} onInput=${e => setAddSecret(e.target.value)}
                            class="settings-keychain-input settings-keychain-secret" />
                        <input type="text" aria-label="Entry username" placeholder=${tr('settings.keychain.usernamePlaceholder')}
                            value=${addUsername} onInput=${e => setAddUsername(e.target.value)}
                            class="settings-keychain-input" style="max-width:200px" />
                        <button class="settings-keychain-save-btn" onClick=${handleAdd}
                            disabled=${saving || !addName.trim() || !addSecret}>
                            ${saving ? tr('settings.keychain.saving') : tr('settings.keychain.save')}
                        </button>
                    </div>
                    <div class="settings-keychain-add-row" style="align-items:stretch">
                        <textarea aria-label=${tr('settings.keychain.userNote')} placeholder=${tr('settings.keychain.userNotePlaceholder')}
                            value=${addUserNote} onInput=${e => setAddUserNote(e.target.value)}
                            class="settings-keychain-input" rows="2" style="resize:vertical; min-height:56px"></textarea>
                        <textarea aria-label=${tr('settings.keychain.agentNote')} placeholder=${tr('settings.keychain.agentNotePlaceholder')}
                            value=${addAgentNote} onInput=${e => setAddAgentNote(e.target.value)}
                            class="settings-keychain-input" rows="2" style="resize:vertical; min-height:56px"></textarea>
                    </div>
                </div>
            `}

            <div class="settings-keychain-table-wrap">
                <table class="settings-table settings-keychain-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Env var</th>
                            <th>Updated</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filtered.length === 0 && html`
                            <tr><td colspan="5" class="settings-keychain-empty">
                                ${lf ? tr('settings.keychain.noMatchFilter') : tr('settings.keychain.noEntries')}
                            </td></tr>
                        `}
                        ${filtered.map(e => {
                            const rs = revealState?.name === e.name ? revealState : null;
                            const isRevealed = rs?.phase === 'revealed';
                            const isPasswordPrompt = rs?.phase === 'password';
                            const isTotpPrompt = rs?.phase === 'totp';
                            const isError = rs?.phase === 'error';
                            const draft = noteDrafts[e.name] || {};
                            const userNote = Object.prototype.hasOwnProperty.call(draft, 'userNote') ? draft.userNote : (e.userNote || '');
                            const agentNote = Object.prototype.hasOwnProperty.call(draft, 'agentNote') ? draft.agentNote : (e.agentNote || '');
                            const notesDirty = userNote !== (e.userNote || '') || agentNote !== (e.agentNote || '');
                            const notesSaving = savingNote === e.name;
                            return html`
                            <tr class="settings-keychain-row" key=${e.name}>
                                <td class="settings-keychain-name">${e.name}<span class="settings-keychain-type-inline">${e.type}</span></td>
                                <td><span class="settings-keychain-type-badge">${e.type}</span></td>
                                <td class="settings-keychain-env">${e.envVar ? html`<code>$${e.envVar}</code>` : '—'}</td>
                                <td class="settings-keychain-date">${formatDate(e.updatedAt)}</td>
                                <td class="settings-keychain-actions">
                                    <div class="settings-keychain-action-group">
                                    <button ref=${node => { if (node) revealButtonRefs.current.set(e.name, node); else revealButtonRefs.current.delete(e.name); }} aria-label=${`${isRevealed ? tr('settings.keychain.hideSecret') : tr('settings.keychain.revealSecret')}: ${e.name}`} aria-expanded=${Boolean(rs)} class=${`settings-keychain-reveal-btn${isRevealed ? ' active' : ''}`}
                                        onClick=${() => handleRevealClick(e.name)}
                                        title=${isRevealed ? tr('settings.keychain.hideSecret') : tr('settings.keychain.revealSecret')}>
                                        ${isRevealed
                                            ? html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
                                            : html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
                                        }
                                    </button>
                                    ${confirmDelete === e.name
                                        ? html`
                                            <span class="settings-keychain-confirm">${tr('settings.keychain.deleteQ')}
                                                <button ref=${confirmButtonRef} aria-label=${`Delete ${e.name}`} class="settings-keychain-confirm-yes" onClick=${() => handleDelete(e.name)}>${tr('settings.keychain.yes')}</button>
                                                <button class="settings-keychain-confirm-no" onClick=${() => { restoreFocus('delete', e.name); setConfirmDelete(null); }}>${tr('settings.keychain.no')}</button>
                                            </span>
                                        `
                                        : html`<button ref=${node => { if (node) deleteButtonRefs.current.set(e.name, node); else deleteButtonRefs.current.delete(e.name); }} aria-label=${`Delete ${e.name}`} class="settings-keychain-delete-btn" onClick=${() => setConfirmDelete(e.name)} title=${tr('settings.keychain.deleteTitle')}>🗑</button>`
                                    }
                                    </div>
                                </td>
                            </tr>
                            <tr class="settings-keychain-notes-row" key=${e.name + '-notes'}>
                                <td colspan="5">
                                    <div class="settings-keychain-notes">
                                        <label class="settings-keychain-note">
                                            <span class="settings-hint" style="margin:0">${tr('settings.keychain.userNote')}</span>
                                            <textarea class="settings-keychain-input settings-keychain-note-input" rows="2" placeholder=${tr('settings.keychain.userNoteHint')}
                                                value=${userNote}
                                                onInput=${ev => setNoteDraft(e.name, 'userNote', ev.target.value)}></textarea>
                                        </label>
                                        <label class="settings-keychain-note">
                                            <span class="settings-hint" style="margin:0">${tr('settings.keychain.agentNote')}</span>
                                            <textarea class="settings-keychain-input settings-keychain-note-input" rows="2" placeholder=${tr('settings.keychain.agentNoteHint')}
                                                value=${agentNote}
                                                onInput=${ev => setNoteDraft(e.name, 'agentNote', ev.target.value)}></textarea>
                                        </label>
                                        <button ref=${node => { if (node) noteButtonRefs.current.set(e.name, node); else noteButtonRefs.current.delete(e.name); }} aria-label=${`${tr('settings.keychain.saveNotes')}: ${e.name}`} class="settings-keychain-save-btn" disabled=${!notesDirty || notesSaving} onClick=${() => handleSaveNotes(e)}>
                                            ${notesSaving ? tr('settings.keychain.saving') : tr('settings.keychain.saveNotes')}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                            ${isPasswordPrompt && html`
                                <tr class="settings-keychain-prompt-row" key=${e.name + '-pw'}>
                                    <td colspan="5">
                                        <div class="settings-keychain-prompt">
                                            <span class="settings-keychain-prompt-label">${tr('settings.keychain.masterPassword')}</span>
                                            <input ref=${passwordRef} aria-label=${tr('settings.keychain.masterPassword')} aria-invalid=${rs?.error ? 'true' : undefined} aria-describedby=${rs?.error ? fieldId('reveal-error') : undefined} type="password" autocomplete="off"
                                                placeholder=${tr('settings.keychain.masterPasswordPlaceholder')}
                                                class="settings-keychain-prompt-input"
                                                value=${rs?.masterPassword || ''}
                                                onInput=${ev => setRevealState(s => ({ ...s, masterPassword: ev.target.value }))}
                                                onKeyDown=${ev => { if (ev.key === 'Enter') handlePasswordSubmit(e.name); if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeReveal(e.name); } }}
                                            />
                                            <button class="settings-keychain-prompt-submit" onClick=${() => handlePasswordSubmit(e.name)}
                                                disabled=${!(rs?.masterPassword)}>${tr('settings.keychain.unlock')}</button>
                                            <button class="settings-keychain-prompt-cancel" onClick=${() => closeReveal(e.name)}>${tr('settings.keychain.cancel')}</button>
                                            ${rs?.error && html`<span id=${fieldId('reveal-error')} class="settings-keychain-prompt-error" role="alert">${rs.error}</span>`}
                                        </div>
                                    </td>
                                </tr>
                            `}
                            ${isTotpPrompt && html`
                                <tr class="settings-keychain-prompt-row" key=${e.name + '-totp'}>
                                    <td colspan="5">
                                        <div class="settings-keychain-prompt">
                                            <span class="settings-keychain-prompt-label">${tr('settings.keychain.totpCode')}</span>
                                            <input ref=${totpRef} aria-label=${tr('settings.keychain.totpCode')} aria-invalid=${rs?.error ? 'true' : undefined} aria-describedby=${rs?.error ? fieldId('reveal-error') : undefined} type="text" inputmode="numeric" autocomplete="one-time-code"
                                                maxlength="6" placeholder="000000"
                                                class="settings-keychain-prompt-input" style="width:90px;text-align:center;letter-spacing:0.15em"
                                                value=${rs?.totpCode || ''}
                                                onInput=${ev => setRevealState(s => ({ ...s, totpCode: ev.target.value.replace(/\\D/g, '').slice(0, 6) }))}
                                                onKeyDown=${ev => { if (ev.key === 'Enter') handleTotpSubmit(e.name); if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeReveal(e.name); } }}
                                            />
                                            <button class="settings-keychain-prompt-submit" onClick=${() => handleTotpSubmit(e.name)}
                                                disabled=${(rs?.totpCode || '').length < 6}>${tr('settings.keychain.verify')}</button>
                                            <button class="settings-keychain-prompt-cancel" onClick=${() => closeReveal(e.name)}>${tr('settings.keychain.cancel')}</button>
                                            ${rs?.error && html`<span id=${fieldId('reveal-error')} class="settings-keychain-prompt-error" role="alert">${rs.error}</span>`}
                                        </div>
                                    </td>
                                </tr>
                            `}
                            ${isRevealed && html`
                                <tr class="settings-keychain-reveal-row" key=${e.name + '-reveal'}>
                                    <td colspan="5">
                                        <div class="settings-keychain-reveal-panel">
                                            ${rs.username && html`
                                                <div class="settings-keychain-reveal-field">
                                                    <span class="settings-keychain-reveal-label">${tr('settings.keychain.username')}</span>
                                                    <code class="settings-keychain-reveal-value">${rs.username}</code>
                                                    <button class="settings-keychain-copy-btn" onClick=${() => copyToClipboard(rs.username)} title=${tr('settings.keychain.copyUsername')}>
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                                    </button>
                                                </div>
                                            `}
                                            <div class="settings-keychain-reveal-field">
                                                <span class="settings-keychain-reveal-label">${tr('settings.keychain.secret')}</span>
                                                <code class="settings-keychain-reveal-value">${rs.secret}</code>
                                                <button class="settings-keychain-copy-btn" onClick=${() => copyToClipboard(rs.secret)} title=${tr('settings.keychain.copySecret')}>
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            `}
                            ${isError && html`
                                <tr class="settings-keychain-reveal-row" key=${e.name + '-error'}>
                                    <td colspan="5">
                                        <div class="settings-keychain-reveal-panel" role="alert" style="color: var(--error-color, #e55)">${rs.error}</div>
                                    </td>
                                </tr>
                            `}
                        `; })}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}
