import { html, useCallback, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.js';
import { saveWorkspaceSettings } from '../../api.js';
import { WorkspaceIndexingSettings } from './workspace-indexing.js';
import {
    applyWorkspaceClientSettings,
    readWorkspaceClientSettings,
} from '../../ui/workspace-settings.js';
import { NumberStepper } from './number-stepper.js';
import { useTranslation } from '../../utils/i18n.js';
import { useSettingsFieldIds } from './field-ids.js';

function normalizeWorkspaceSettings(data: Record<string, any> = {}) {
    const workspace = data.workspaceSettings || {};
    return {
        webTerminalEnabled: workspace.webTerminalEnabled !== false,
        vncAllowDirect: workspace.vncAllowDirect !== false,
        sanitizeSvgFences: workspace.sanitizeSvgFences !== false,
        treeMaxDepth: workspace.treeMaxDepth ?? 4,
        treeMaxEntries: workspace.treeMaxEntries ?? 5000,
    };
}

export function WorkspaceSection({ settingsData, setStatus, mergeSettingsData }) {
    const fieldId = useSettingsFieldIds('workspace');
    const { t } = useTranslation();
    const [webTerminalEnabled, setWebTerminalEnabled] = useState(true);
    const [vncAllowDirect, setVncAllowDirect] = useState(true);
    const [sanitizeSvgFences, setSanitizeSvgFences] = useState(true);
    const [treeMaxDepth, setTreeMaxDepth] = useState(4);
    const [treeMaxEntries, setTreeMaxEntries] = useState(5000);
    const [refreshIntervalSec, setRefreshIntervalSec] = useState(60);
    const [folderPreviewDepth, setFolderPreviewDepth] = useState(3);
    const [serverAppliedHint, setServerAppliedHint] = useState(false);
    const [browserAppliedHint, setBrowserAppliedHint] = useState(false);
    const savedSnapshotRef = useRef('');
    const saveTimerRef = useRef(null);
    const serverHintTimerRef = useRef(null);
    const browserHintTimerRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            if (serverHintTimerRef.current) clearTimeout(serverHintTimerRef.current);
            if (browserHintTimerRef.current) clearTimeout(browserHintTimerRef.current);
        };
    }, []);

    const applyIncoming = useCallback((data) => {
        const next = normalizeWorkspaceSettings(data);
        const browser = readWorkspaceClientSettings();
        setWebTerminalEnabled(next.webTerminalEnabled);
        setVncAllowDirect(next.vncAllowDirect);
        setSanitizeSvgFences(next.sanitizeSvgFences);
        setTreeMaxDepth(next.treeMaxDepth);
        setTreeMaxEntries(next.treeMaxEntries);
        setRefreshIntervalSec(browser.refreshIntervalSec);
        setFolderPreviewDepth(browser.folderPreviewDepth);
        savedSnapshotRef.current = JSON.stringify(next);
    }, []);

    useEffect(() => {
        applyIncoming(settingsData || {});
    }, [settingsData, applyIncoming]);

    const currentServerSnapshot = useMemo(() => JSON.stringify(normalizeWorkspaceSettings({
        workspaceSettings: {
            webTerminalEnabled,
            vncAllowDirect,
            sanitizeSvgFences,
            treeMaxDepth,
            treeMaxEntries,
        },
    })), [webTerminalEnabled, vncAllowDirect, sanitizeSvgFences, treeMaxDepth, treeMaxEntries]);

    useEffect(() => {
        if (currentServerSnapshot === savedSnapshotRef.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            if (!mountedRef.current) return;
            try {
                const payload = await saveWorkspaceSettings(JSON.parse(currentServerSnapshot));
                if (!mountedRef.current || !payload?.ok || !payload?.settings) return;
                savedSnapshotRef.current = currentServerSnapshot;
                mergeSettingsData?.({ workspaceSettings: payload.settings });
                setStatus?.(null);
                setServerAppliedHint(true);
                if (serverHintTimerRef.current) clearTimeout(serverHintTimerRef.current);
                serverHintTimerRef.current = setTimeout(() => {
                    if (mountedRef.current) setServerAppliedHint(false);
                }, 4000);
            } catch (error) {
                setStatus?.(String(error?.message || error), 'error');
            }
        }, 800);
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, [currentServerSnapshot, mergeSettingsData, setStatus]);

    const applyBrowserPatch = useCallback((patch) => {
        const next = applyWorkspaceClientSettings(patch);
        setRefreshIntervalSec(next.refreshIntervalSec);
        setFolderPreviewDepth(next.folderPreviewDepth);
        setBrowserAppliedHint(true);
        if (browserHintTimerRef.current) clearTimeout(browserHintTimerRef.current);
        browserHintTimerRef.current = setTimeout(() => {
            if (mountedRef.current) setBrowserAppliedHint(false);
        }, 3000);
    }, []);

    return html`
        <div class="settings-section">
            <${WorkspaceIndexingSettings} setStatus=${setStatus} />

            ${serverAppliedHint && html`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${t('settings.workspace.serverApplied')}
                </div>
            `}
            ${browserAppliedHint && html`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${t('settings.workspace.browserApplied')}
                </div>
            `}

            <h3>${t('settings.workspace.access')}</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label for=${fieldId('terminal')}>${t('settings.workspace.enableTerminal')}</label>
                <input id=${fieldId('terminal')} type="checkbox" checked=${webTerminalEnabled} onChange=${e => setWebTerminalEnabled(e.target.checked)} />
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label for=${fieldId('vnc')}>${t('settings.workspace.allowVnc')}</label>
                <input id=${fieldId('vnc')} type="checkbox" checked=${vncAllowDirect} onChange=${e => setVncAllowDirect(e.target.checked)} />
            </div>
            <p class="settings-hint">${t('settings.workspace.accessHint')}</p>

            <h3 style="margin-top:20px">Timeline SVG</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label for=${fieldId('svg')}>Sanitize SVG code fences</label>
                <input id=${fieldId('svg')} type="checkbox" checked=${sanitizeSvgFences} onChange=${e => setSanitizeSvgFences(e.target.checked)} />
                <span class="settings-hint">Enabled by default: fenced SVG is rendered as a bounded static image. Disable only for trusted SVG that needs timeline interaction; its source will run in this page.</span>
            </div>

            <h3 style="margin-top:20px">${t('settings.workspace.guardrails')}</h3>
            <div class="settings-row settings-dense-row">
                <label>${t('settings.workspace.maxDepth')}</label>
                <${NumberStepper}
                    label=${t('settings.workspace.maxDepthAria')}
                    value=${treeMaxDepth}
                    min=${1}
                    max=${8}
                    fallback=${4}
                    width="80px"
                    onChange=${setTreeMaxDepth}
                />
                <span class="settings-hint">${t('settings.workspace.maxDepthHintPre')} <code>/workspace/tree</code> ${t('settings.workspace.maxDepthHintPost')}</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>${t('settings.workspace.maxEntries')}</label>
                <${NumberStepper}
                    label=${t('settings.workspace.maxEntriesAria')}
                    value=${treeMaxEntries}
                    min=${250}
                    max=${5000}
                    step=${250}
                    fallback=${5000}
                    width="92px"
                    onChange=${setTreeMaxEntries}
                />
                <span class="settings-hint">${t('settings.workspace.maxEntriesHint')}</span>
            </div>

            <h3 style="margin-top:20px">${t('settings.workspace.thisBrowser')}</h3>
            <div class="settings-row settings-dense-row">
                <label>${t('settings.workspace.refreshInterval')}</label>
                <${NumberStepper}
                    label=${t('settings.workspace.refreshIntervalAria')}
                    value=${refreshIntervalSec}
                    min=${15}
                    max=${300}
                    step=${15}
                    fallback=${60}
                    width="92px"
                    onChange=${(value) => applyBrowserPatch({ refreshIntervalSec: value })}
                />
            </div>
            <div class="settings-row settings-dense-row">
                <label>${t('settings.workspace.folderDepth')}</label>
                <${NumberStepper}
                    label=${t('settings.workspace.folderDepthAria')}
                    value=${folderPreviewDepth}
                    min=${0}
                    max=${8}
                    fallback=${3}
                    width="80px"
                    onChange=${(value) => applyBrowserPatch({ folderPreviewDepth: value })}
                />
                <span class="settings-hint">${t('settings.workspace.folderDepthHintPre')} <code>0</code> ${t('settings.workspace.folderDepthHintPost')}</span>
            </div>
            <p class="settings-hint">${t('settings.workspace.footerHint')}</p>
        </div>
    `;
}
