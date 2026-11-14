/**
 * settings/compaction.ts — Compaction and watchdog settings pane.
 */
import { html, useState, useEffect, useCallback, useMemo, useRef } from '../../vendor/preact-htm.js';
import { NumberStepper } from './number-stepper.js';
import { useTranslation } from '../../utils/i18n.js';
import { useSettingsFieldIds } from './field-ids.js';

function normalizeCompactionSettings(data: Record<string, any> = {}) {
    return {
        autoCompactionEnabled: Boolean(data.autoCompactionEnabled ?? true),
        localLitePromptProfileEnabled: Boolean(data.localLitePromptProfileEnabled ?? false),
        toolResultCompactionEnabled: Boolean(data.toolResultCompactionEnabled ?? true),
        toolResultSemanticSummaryEnabled: Boolean(data.toolResultSemanticSummaryEnabled ?? true),
        toolResultSemanticSummaryMaxInputChars: data.toolResultSemanticSummaryMaxInputChars ?? 12000,
        toolResultSemanticSummaryMaxTokens: data.toolResultSemanticSummaryMaxTokens ?? 320,
        toolResultSemanticSummaryTimeoutSec: data.toolResultSemanticSummaryTimeoutSec ?? 12,
        progressWatchdogEnabled: Boolean(data.progressWatchdogEnabled ?? false),
        progressWatchdogTimeoutSec: data.progressWatchdogTimeoutSec ?? 300,
        progressWatchdogPhases: Array.isArray(data.progressWatchdogPhases) ? data.progressWatchdogPhases : [],
    };
}

function formatIso(value) {
    const raw = String(value || '').trim();
    if (!raw) return '—';
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleString();
}

export function CompactionSection({ settingsData, setStatus, mergeSettingsData }) {
    const fieldId = useSettingsFieldIds('compaction');
    const { t } = useTranslation();
    const [autoCompactionEnabled, setAutoCompactionEnabled] = useState(true);
    const [localLitePromptProfileEnabled, setLocalLitePromptProfileEnabled] = useState(false);
    const [toolResultCompactionEnabled, setToolResultCompactionEnabled] = useState(true);
    const [toolResultSemanticSummaryEnabled, setToolResultSemanticSummaryEnabled] = useState(true);
    const [toolResultSemanticSummaryMaxInputChars, setToolResultSemanticSummaryMaxInputChars] = useState(12000);
    const [toolResultSemanticSummaryMaxTokens, setToolResultSemanticSummaryMaxTokens] = useState(320);
    const [toolResultSemanticSummaryTimeoutSec, setToolResultSemanticSummaryTimeoutSec] = useState(12);
    const [progressWatchdogEnabled, setProgressWatchdogEnabled] = useState(false);
    const [progressWatchdogTimeoutSec, setProgressWatchdogTimeoutSec] = useState(300);
    const [progressWatchdogPhases, setProgressWatchdogPhases] = useState([]);
    const [appliedHint, setAppliedHint] = useState(false);
    const savedSnapshotRef = useRef('');
    const saveTimerRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const applyIncoming = useCallback((data) => {
        const next = normalizeCompactionSettings(data);
        setAutoCompactionEnabled(next.autoCompactionEnabled);
        setLocalLitePromptProfileEnabled(next.localLitePromptProfileEnabled);
        setToolResultCompactionEnabled(next.toolResultCompactionEnabled);
        setToolResultSemanticSummaryEnabled(next.toolResultSemanticSummaryEnabled);
        setToolResultSemanticSummaryMaxInputChars(next.toolResultSemanticSummaryMaxInputChars);
        setToolResultSemanticSummaryMaxTokens(next.toolResultSemanticSummaryMaxTokens);
        setToolResultSemanticSummaryTimeoutSec(next.toolResultSemanticSummaryTimeoutSec);
        setProgressWatchdogEnabled(next.progressWatchdogEnabled);
        setProgressWatchdogTimeoutSec(next.progressWatchdogTimeoutSec);
        setProgressWatchdogPhases(next.progressWatchdogPhases);
        savedSnapshotRef.current = JSON.stringify({
            autoCompactionEnabled: next.autoCompactionEnabled,
            localLitePromptProfileEnabled: next.localLitePromptProfileEnabled,
            toolResultCompactionEnabled: next.toolResultCompactionEnabled,
            toolResultSemanticSummaryEnabled: next.toolResultSemanticSummaryEnabled,
            toolResultSemanticSummaryMaxInputChars: next.toolResultSemanticSummaryMaxInputChars,
            toolResultSemanticSummaryMaxTokens: next.toolResultSemanticSummaryMaxTokens,
            toolResultSemanticSummaryTimeoutSec: next.toolResultSemanticSummaryTimeoutSec,
            progressWatchdogEnabled: next.progressWatchdogEnabled,
            progressWatchdogTimeoutSec: next.progressWatchdogTimeoutSec,
        });
    }, []);

    useEffect(() => {
        applyIncoming(settingsData || {});
    }, [settingsData, applyIncoming]);

    const currentSnapshot = useMemo(() => JSON.stringify({
        autoCompactionEnabled,
        localLitePromptProfileEnabled,
        toolResultCompactionEnabled,
        toolResultSemanticSummaryEnabled,
        toolResultSemanticSummaryMaxInputChars,
        toolResultSemanticSummaryMaxTokens,
        toolResultSemanticSummaryTimeoutSec,
        progressWatchdogEnabled,
        progressWatchdogTimeoutSec,
    }), [
        autoCompactionEnabled,
        localLitePromptProfileEnabled,
        toolResultCompactionEnabled,
        toolResultSemanticSummaryEnabled,
        toolResultSemanticSummaryMaxInputChars,
        toolResultSemanticSummaryMaxTokens,
        toolResultSemanticSummaryTimeoutSec,
        progressWatchdogEnabled,
        progressWatchdogTimeoutSec,
    ]);

    useEffect(() => {
        if (currentSnapshot === savedSnapshotRef.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            if (!mountedRef.current) return;
            try {
                setStatus?.(t('settings.compaction.saving'), 'info');
                const response = await fetch('/agent/settings/compaction', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: currentSnapshot,
                });
                const payload = await response.json().catch(() => ({}));
                if (!mountedRef.current) return;
                if (!response.ok || !payload?.ok || !payload?.settings) {
                    setStatus?.(payload?.error || t('settings.compaction.saveFailed'), 'error');
                    return;
                }
                savedSnapshotRef.current = currentSnapshot;
                mergeSettingsData?.(payload.settings);
                applyIncoming({ ...(settingsData || {}), ...(payload.settings || {}) });
                setStatus?.(t('settings.compaction.saved'), 'success');
                setAppliedHint(true);
                setTimeout(() => {
                    if (mountedRef.current) {
                        setAppliedHint(false);
                        setStatus?.(null);
                    }
                }, 4000);
            } catch (error) {
                console.warn('[settings/compaction] Failed to persist compaction settings.', error);
                if (mountedRef.current) setStatus?.(t('settings.compaction.saveFailed'), 'error');
            }
        }, 800);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, [currentSnapshot, mergeSettingsData, setStatus, applyIncoming, settingsData]);

    return html`
        <div class="settings-section settings-dense-form">
            ${appliedHint && html`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${t('settings.compaction.saved')}
                </div>
            `}

            <h3>Local models</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label for=${fieldId('check-1')}>Local-lite prompt and tools</label>
                <input id=${fieldId('check-1')} type="checkbox" checked=${localLitePromptProfileEnabled} onChange=${e => setLocalLitePromptProfileEnabled(Boolean(e.target.checked))} />
                <span class="settings-hint">Off by default. When enabled, local endpoints use a compact prompt and start with only read and tool discovery. Changes apply on the next turn.</span>
            </div>
            <h3>${t('settings.compaction.autoHeading')}</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label for=${fieldId('check-2')}>${t('settings.compaction.enableAutomatic')}</label>
                <input id=${fieldId('check-2')} type="checkbox" checked=${autoCompactionEnabled} onChange=${e => setAutoCompactionEnabled(Boolean(e.target.checked))} />
                <span class="settings-hint">Native compaction uses the active conversation model and SDK thresholds. Changes apply at the next compaction decision; already accepted maintenance is not cancelled.</span>
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label for=${fieldId('check-3')}>${t('settings.compaction.enableToolResult')}</label>
                <input id=${fieldId('check-3')} type="checkbox" checked=${toolResultCompactionEnabled} onChange=${e => setToolResultCompactionEnabled(Boolean(e.target.checked))} />
                <span class="settings-hint">${t('settings.compaction.enableToolResultHint')}</span>
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label for=${fieldId('check-4')}>${t('settings.compaction.semanticSummaries')}</label>
                <input id=${fieldId('check-4')} type="checkbox" checked=${toolResultSemanticSummaryEnabled} onChange=${e => setToolResultSemanticSummaryEnabled(Boolean(e.target.checked))} />
                <span class="settings-hint">${t('settings.compaction.semanticSummariesHint')}</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>${t('settings.compaction.inputLimit')}</label>
                <${NumberStepper}
                    label=${t('settings.compaction.inputLimitAria')}
                    value=${toolResultSemanticSummaryMaxInputChars}
                    min=${500}
                    max=${200000}
                    fallback=${12000}
                    width="100px"
                    disabled=${!toolResultSemanticSummaryEnabled}
                    onChange=${setToolResultSemanticSummaryMaxInputChars}
                />
                <span class="settings-hint" style="margin:0">${t('settings.compaction.inputLimitHint')}</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>${t('settings.compaction.maxTokens')}</label>
                <${NumberStepper}
                    label=${t('settings.compaction.maxTokensAria')}
                    value=${toolResultSemanticSummaryMaxTokens}
                    min=${64}
                    max=${4096}
                    fallback=${320}
                    width="90px"
                    disabled=${!toolResultSemanticSummaryEnabled}
                    onChange=${setToolResultSemanticSummaryMaxTokens}
                />
                <span class="settings-hint" style="margin:0">${t('settings.compaction.maxTokensHint')}</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>${t('settings.compaction.summaryTimeout')}</label>
                <${NumberStepper}
                    label=${t('settings.compaction.summaryTimeoutAria')}
                    value=${toolResultSemanticSummaryTimeoutSec}
                    min=${1}
                    max=${300}
                    fallback=${12}
                    width="90px"
                    disabled=${!toolResultSemanticSummaryEnabled}
                    onChange=${setToolResultSemanticSummaryTimeoutSec}
                />
                <span class="settings-hint" style="margin:0">${t('settings.compaction.summaryTimeoutHint')}</span>
            </div>
            <h3 style="margin-top:20px">${t('settings.compaction.watchdogHeading')}</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label for=${fieldId('check-5')}>${t('settings.compaction.enableWatchdog')}</label>
                <input id=${fieldId('check-5')} type="checkbox" checked=${progressWatchdogEnabled} onChange=${e => setProgressWatchdogEnabled(Boolean(e.target.checked))} />
                <span class="settings-hint">${t('settings.compaction.enableWatchdogHint')}</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>${t('settings.compaction.watchdogTimeout')}</label>
                <${NumberStepper}
                    label=${t('settings.compaction.watchdogTimeoutAria')}
                    value=${progressWatchdogTimeoutSec}
                    min=${0}
                    max=${3600}
                    fallback=${300}
                    width="90px"
                    disabled=${!progressWatchdogEnabled}
                    onChange=${setProgressWatchdogTimeoutSec}
                />
                <span class="settings-hint" style="margin:0">${t('settings.compaction.watchdogTimeoutHint')}</span>
            </div>

            <h3 style="margin-top:20px">${t('settings.compaction.phasesHeading')}</h3>
            ${progressWatchdogPhases.length === 0 ? html`
                <p class="settings-hint">${t('settings.compaction.noPhases')}</p>
            ` : html`
                <div class="settings-table-wrapper">
                    <table class="settings-table">
                        <thead>
                            <tr>
                                <th>Chat</th>
                                <th>Phase</th>
                                <th>Started</th>
                                <th>Last heartbeat</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${progressWatchdogPhases.map((entry) => html`
                                <tr>
                                    <td><code>${entry.chatJid}</code></td>
                                    <td>${entry.phase}</td>
                                    <td>${formatIso(entry.startedAt)}</td>
                                    <td>${formatIso(entry.lastProgressAt)}</td>
                                </tr>
                            `)}
                        </tbody>
                    </table>
                </div>
            `}
        </div>
    `;
}
