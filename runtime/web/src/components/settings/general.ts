import { html, useState, useEffect, useCallback, useMemo, useRef } from '../../vendor/preact-htm.js';
import { METERS_EVENT_NAME, applyMetersEnabled, readStoredMetersEnabled } from '../../ui/meters.js';
import { NumberStepper } from './number-stepper.js';
import { useTranslation } from '../../utils/i18n.js';
import { AboutVersions } from '../about-dialog.js';

export function resolveAvatarPreview(value, kind) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    // Newly selected files have not reached the avatar cache yet, so preview
    // their browser-local URL directly. Persisted sources must use the avatar
    // endpoint: /workspace/file is a JSON metadata API, not image content.
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    return kind === 'agent' || kind === 'user' ? `/avatar/${kind}` : '';
}

function AvatarField({ value, kind, onChange }) {
    const { t } = useTranslation();
    const inputRef = useRef(null);
    const [preview, setPreview] = useState(resolveAvatarPreview(value, kind));

    useEffect(() => { setPreview(resolveAvatarPreview(value, kind)); }, [kind, value]);

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

    return html`
        <div class="settings-avatar-inline" onClick=${() => inputRef.current?.click()} title=${t('settings.general.avatarUpload')}>
            ${preview
                ? html`<img src=${preview} alt="avatar" />`
                : html`<span class="settings-avatar-placeholder">+</span>`}
            <input type="file" accept="image/*" ref=${inputRef} style="display:none" onChange=${handleFileSelect} />
        </div>
    `;
}

function normalizeGeneralSettings(data: Record<string, any> = {}) {
    return {
        userName: data.userName || '',
        userAvatar: data.userAvatar || '',
        assistantName: data.assistantName || '',
        assistantAvatar: data.assistantAvatar || '',
        workspaceUploadLimitMb: data.workspaceUploadLimitMb ?? 256,
    };
}

let generalInstanceId = 0;

export function GeneralSection({ settingsData, setStatus, mergeSettingsData }) {
    const { t } = useTranslation();
    const fieldPrefixRef = useRef(null);
    if (!fieldPrefixRef.current) fieldPrefixRef.current = `settings-general-${++generalInstanceId}`;
    const fieldPrefix = fieldPrefixRef.current;
    const fieldId = (name) => `${fieldPrefix}-general-${name}`;
    const [userName, setUserName] = useState('');
    const [userAvatar, setUserAvatar] = useState('');
    const [assistantName, setAssistantName] = useState('');
    const [assistantAvatar, setAssistantAvatar] = useState('');
    const [workspaceUploadLimitMb, setWorkspaceUploadLimitMb] = useState(256);
    const [metersEnabled, setMetersEnabled] = useState(() => readStoredMetersEnabled(false));
    const [appliedHint, setAppliedHint] = useState(false);
    const savedSnapshotRef = useRef('');
    const saveTimerRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const applyIncoming = useCallback((data) => {
        const next = normalizeGeneralSettings(data);
        setUserName(next.userName);
        setUserAvatar(next.userAvatar);
        setAssistantName(next.assistantName);
        setAssistantAvatar(next.assistantAvatar);
        setWorkspaceUploadLimitMb(next.workspaceUploadLimitMb);
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
        userName, userAvatar, assistantName, assistantAvatar,
        workspaceUploadLimitMb,
    })), [
        userName, userAvatar, assistantName, assistantAvatar,
        workspaceUploadLimitMb,
    ]);

    useEffect(() => {
        if (currentSnapshot === savedSnapshotRef.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            if (!mountedRef.current) return;
            try {
                const response = await fetch('/agent/settings/general', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: currentSnapshot,
                });
                const payload = await response.json().catch(() => ({}));
                if (!mountedRef.current) return;
                if (!response.ok || !payload?.ok || !payload?.settings) {
                    throw new Error(payload?.error || `Failed to save general settings (${response.status})`);
                }
                savedSnapshotRef.current = currentSnapshot;
                mergeSettingsData?.(payload.settings);
                setStatus?.(null);
                setAppliedHint(true);
                setTimeout(() => { if (mountedRef.current) setAppliedHint(false); }, 4000);
            } catch (error) {
                console.warn('[settings/general] Failed to persist general settings snapshot.', error);
                if (mountedRef.current) setStatus?.(String(error?.message || error), 'error');
            }
        }, 800);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, [currentSnapshot, mergeSettingsData, setStatus]);

    const isSecureContext = typeof window !== 'undefined' && window.isSecureContext;

    return html`
        <div class="settings-section">
            ${appliedHint && html`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${t('settings.appliedNotice')}
                </div>
            `}
            <h3>${t('settings.general.identity')}</h3>
            <div class="settings-row">
                <label for=${fieldId('user')}>${t('settings.general.userLabel')}</label>
                <${AvatarField} kind="user" value=${userAvatar} onChange=${setUserAvatar} />
                <input id=${fieldId('user')} type="text" value=${userName} onInput=${e => setUserName(e.target.value)} placeholder=${t('settings.general.yourName')} />
            </div>
            <div class="settings-row">
                <label for=${fieldId('agent')}>${t('settings.general.agentLabel')}</label>
                <${AvatarField} kind="agent" value=${assistantAvatar} onChange=${setAssistantAvatar} />
                <input id=${fieldId('agent')} type="text" value=${assistantName} onInput=${e => setAssistantName(e.target.value)} placeholder=${t('settings.general.agentName')} />
            </div>

            <h3 style="margin-top:20px">${t('settings.general.notifications')}</h3>
            ${isSecureContext ? html`
                <div class="settings-row">
                    <label>${t('settings.general.browserNotifications')}</label>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span class="settings-hint" style="margin:0">
                            ${t('settings.general.notifSecureHint')}
                        </span>
                    </div>
                </div>
            ` : html`
                <div class="settings-row">
                    <label>${t('settings.general.browserNotifications')}</label>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span class="settings-hint" style="margin:0; color: var(--error-color, #e55)">
                            ${t('settings.general.notifInsecureHint')}
                        </span>
                    </div>
                </div>
            `}

            <h3 style="margin-top:20px">${t('settings.general.display')}</h3>
            <div class="settings-row">
                <label for=${fieldId('meters')}>${t('settings.general.systemMeters')}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input id=${fieldId('meters')} type="checkbox" checked=${metersEnabled}
                        onChange=${() => {
                            const next = applyMetersEnabled(!metersEnabled);
                            setMetersEnabled(next);
                        }} />
                    <span class="settings-hint" style="margin:0">${t('settings.general.systemMetersHint')}</span>
                </div>
            </div>

            <h3 style="margin-top:20px">${t('settings.general.instanceConfig')}</h3>
            <div class="settings-row">
                <label for=${fieldId('workspace')}>${t('settings.general.uploadLimit')}</label>
                <${NumberStepper}
                    id=${fieldId('workspace')}
                    label=${t('settings.general.uploadLimit')}
                    value=${workspaceUploadLimitMb}
                    min=${1}
                    max=${1024}
                    fallback=${256}
                    width="80px"
                    onChange=${setWorkspaceUploadLimitMb}
                />
                <span class="settings-hint" style="margin:0">${t('settings.general.uploadLimitHint')}</span>
            </div>

            <section class="settings-about" aria-label="About">
                <h3>About</h3>
                <${AboutVersions} versions=${settingsData?.runtimeVersions} />
            </section>
        </div>
    `;
}
