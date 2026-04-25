// @ts-nocheck
import { html, useState, useEffect, useCallback, useMemo, useRef } from '../../vendor/preact-htm.js';
import { METERS_EVENT_NAME, applyMetersEnabled, readStoredMetersEnabled } from '../../ui/meters.js';
import { NumberStepper } from './number-stepper.js';

function resolveAvatarPreview(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    const rel = raw.startsWith('/workspace/') ? raw.slice('/workspace/'.length) : raw;
    return `/workspace/file?path=${encodeURIComponent(rel)}`;
}

function AvatarField({ label, value, onChange }) {
    const inputRef = useRef(null);
    const [preview, setPreview] = useState(resolveAvatarPreview(value));

    useEffect(() => { setPreview(resolveAvatarPreview(value)); }, [value]);

    const handleFileSelect = useCallback((e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            setPreview(dataUrl);
            onChange?.(dataUrl);
        };
        reader.readAsDataURL(file);
    }, [onChange]);

    const handleUrlChange = useCallback((e) => {
        const url = e.target.value;
        setPreview(resolveAvatarPreview(url));
        onChange?.(url);
    }, [onChange]);

    return html`
        <div class="settings-avatar-field">
            <label>${label}</label>
            <div class="settings-avatar-row">
                <div class="settings-avatar-preview" onClick=${() => inputRef.current?.click()}>
                    ${preview
                        ? html`<img src=${preview} alt="avatar" />`
                        : html`<span class="settings-avatar-placeholder">+</span>`}
                </div>
                <div class="settings-avatar-inputs">
                    <input type="text" value=${value || ''} onInput=${handleUrlChange} placeholder="URL or path" />
                    <input type="file" accept="image/*" ref=${inputRef} style="display:none" onChange=${handleFileSelect} />
                    <button class="settings-avatar-upload-btn" onClick=${() => inputRef.current?.click()}>Upload</button>
                </div>
            </div>
        </div>
    `;
}

function normalizeGeneralSettings(data = {}) {
    return {
        userName: data.userName || '',
        userAvatar: data.userAvatar || '',
        assistantName: data.assistantName || '',
        assistantAvatar: data.assistantAvatar || '',
        sessionAutoRotate: data.sessionAutoRotate !== false,
        sessionMaxSizeMb: data.sessionMaxSizeMb ?? 32,
        webTerminalEnabled: data.webTerminalEnabled !== false,
        toolUseBudget: data.toolUseBudget ?? 64,
    };
}

export function GeneralSection({ settingsData, setStatus, mergeSettingsData }) {
    const [userName, setUserName] = useState('');
    const [userAvatar, setUserAvatar] = useState('');
    const [assistantName, setAssistantName] = useState('');
    const [assistantAvatar, setAssistantAvatar] = useState('');
    const [sessionAutoRotate, setSessionAutoRotate] = useState(true);
    const [sessionMaxSizeMb, setSessionMaxSizeMb] = useState(32);
    const [webTerminalEnabled, setWebTerminalEnabled] = useState(true);
    const [toolUseBudget, setToolUseBudget] = useState(64);
    const [saving, setSaving] = useState(false);
    const [metersEnabled, setMetersEnabled] = useState(() => readStoredMetersEnabled(false));
    const savedSnapshotRef = useRef('');

    const applyIncoming = useCallback((data) => {
        const next = normalizeGeneralSettings(data);
        setUserName(next.userName);
        setUserAvatar(next.userAvatar);
        setAssistantName(next.assistantName);
        setAssistantAvatar(next.assistantAvatar);
        setSessionAutoRotate(next.sessionAutoRotate);
        setSessionMaxSizeMb(next.sessionMaxSizeMb);
        setWebTerminalEnabled(next.webTerminalEnabled);
        setToolUseBudget(next.toolUseBudget);
        savedSnapshotRef.current = JSON.stringify(next);
    }, []);

    useEffect(() => {
        applyIncoming(settingsData || {});
    }, [settingsData, applyIncoming]);

    useEffect(() => {
        const onMetersChange = (event) => {
            setMetersEnabled(Boolean(event?.detail?.enabled));
        };
        window.addEventListener(METERS_EVENT_NAME, onMetersChange);
        return () => window.removeEventListener(METERS_EVENT_NAME, onMetersChange);
    }, []);

    const currentSnapshot = useMemo(() => JSON.stringify(normalizeGeneralSettings({
        userName,
        userAvatar,
        assistantName,
        assistantAvatar,
        sessionAutoRotate,
        sessionMaxSizeMb,
        webTerminalEnabled,
        toolUseBudget,
    })), [
        userName,
        userAvatar,
        assistantName,
        assistantAvatar,
        sessionAutoRotate,
        sessionMaxSizeMb,
        webTerminalEnabled,
        toolUseBudget,
    ]);
    const dirty = currentSnapshot !== savedSnapshotRef.current;

    const save = useCallback(async () => {
        if (saving) return;
        setSaving(true);
        setStatus?.('Saving general settings…', 'info');
        try {
            const response = await fetch('/agent/settings/general', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userName,
                    userAvatar,
                    assistantName,
                    assistantAvatar,
                    sessionAutoRotate,
                    sessionMaxSizeMb,
                    webTerminalEnabled,
                    toolUseBudget,
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok || !payload?.settings) {
                throw new Error(payload?.error || `HTTP ${response.status}`);
            }
            applyIncoming(payload.settings);
            mergeSettingsData?.(payload.settings);
            setStatus?.('General settings saved. New turns use the updated values.', 'success');
        } catch (e) {
            setStatus?.(String(e?.message || e), 'error');
        } finally {
            setSaving(false);
        }
    }, [
        saving,
        setStatus,
        userName,
        userAvatar,
        assistantName,
        assistantAvatar,
        sessionAutoRotate,
        sessionMaxSizeMb,
        webTerminalEnabled,
        toolUseBudget,
        applyIncoming,
        mergeSettingsData,
    ]);

    return html`
        <div class="settings-section">
            <h3>Identity</h3>
            <div class="settings-row">
                <label>User name</label>
                <input type="text" value=${userName} onInput=${e => setUserName(e.target.value)} />
            </div>
            <${AvatarField} label="User avatar" value=${userAvatar} onChange=${setUserAvatar} />
            <div class="settings-row">
                <label>Agent name</label>
                <input type="text" value=${assistantName} onInput=${e => setAssistantName(e.target.value)} />
            </div>
            <${AvatarField} label="Agent avatar" value=${assistantAvatar} onChange=${setAssistantAvatar} />

            <h3 style="margin-top:20px">Session</h3>
            <div class="settings-row">
                <label>Auto-rotate sessions</label>
                <input type="checkbox" checked=${sessionAutoRotate} onChange=${e => setSessionAutoRotate(e.target.checked)} />
            </div>
            <div class="settings-row">
                <label>Max session size (MB)</label>
                <${NumberStepper}
                    label="max session size"
                    value=${sessionMaxSizeMb}
                    min=${1}
                    max=${256}
                    fallback=${32}
                    width="80px"
                    onChange=${setSessionMaxSizeMb}
                />
            </div>
            <div class="settings-row">
                <label>Web terminal</label>
                <input type="checkbox" checked=${webTerminalEnabled} onChange=${e => setWebTerminalEnabled(e.target.checked)} />
            </div>
            <div class="settings-row">
                <label>System meters</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" checked=${metersEnabled}
                        onChange=${() => {
                            const next = applyMetersEnabled(!metersEnabled);
                            setMetersEnabled(next);
                        }} />
                    <span class="settings-hint" style="margin:0">Same toggle as <code>/meters on|off|toggle</code>. Applies immediately in this browser.</span>
                </div>
            </div>
            <div class="settings-row">
                <label>Tool use budget</label>
                <${NumberStepper}
                    label="tool use budget"
                    value=${toolUseBudget}
                    min=${8}
                    max=${512}
                    fallback=${64}
                    width="80px"
                    onChange=${setToolUseBudget}
                />
                <span class="settings-hint" style="margin:0">per turn</span>
            </div>
            <div class="settings-row" style="margin-top:16px; align-items:center; gap:10px;">
                <button class="settings-addon-btn settings-addon-btn-install" disabled=${saving || !dirty} onClick=${save}>
                    ${saving ? 'Saving…' : 'Save & apply'}
                </button>
                <span class="settings-hint" style="margin:0">
                    Identity, session rotation, size caps, terminal availability, and tool budget apply to new turns immediately.
                </span>
            </div>
        </div>
    `;
}
