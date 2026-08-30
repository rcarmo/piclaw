/**
 * settings/compaction.ts — Compaction and watchdog settings pane.
 */
import { html, useState, useEffect, useCallback, useMemo, useRef } from '../../vendor/preact-htm.js';
import { NumberStepper } from './number-stepper.js';
import { useTranslation } from '../../utils/i18n.js';
import { getAgentModels } from '../../api.js';
import { formatModelCatalogueContextWindow, normaliseModelCatalogue } from '../../ui/model-catalogue.ts';

function normalizeSmartCompactionMethod(value) {
    const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return normalized === 'pipelined' || normalized === 'traditional_pipelined' ? 'pipelined' : 'selective';
}

function normalizeCompactionSettings(data: Record<string, any> = {}) {
    return {
        autoCompactionEnabled: Boolean(data.autoCompactionEnabled ?? true),
        smartCompactionMethod: normalizeSmartCompactionMethod(data.smartCompactionMethod),
        compactionModel: String(data.compactionModel ?? '').trim(),
        remoteCompactionEnabled: Boolean(data.remoteCompactionEnabled ?? false),
        remoteCompactionTimeoutSec: data.remoteCompactionTimeoutSec ?? 300,
        remoteCompactionSupportedProviders: Array.isArray(data.remoteCompactionSupportedProviders) ? data.remoteCompactionSupportedProviders : ['openai', 'openai-codex'],
        compactionTimeoutSec: data.compactionTimeoutSec ?? 300,
        compactionBackoffBaseMin: data.compactionBackoffBaseMin ?? 15,
        compactionBackoffMaxMin: data.compactionBackoffMaxMin ?? 360,
        compactionThresholdPercent: data.compactionThresholdPercent ?? 80,
        compactionBackoffDecayFactor: data.compactionBackoffDecayFactor ?? 0.5,
        toolResultCompactionEnabled: Boolean(data.toolResultCompactionEnabled ?? true),
        toolResultSemanticSummaryEnabled: Boolean(data.toolResultSemanticSummaryEnabled ?? true),
        toolResultSemanticSummaryMaxInputChars: data.toolResultSemanticSummaryMaxInputChars ?? 12000,
        toolResultSemanticSummaryMaxTokens: data.toolResultSemanticSummaryMaxTokens ?? 320,
        toolResultSemanticSummaryTimeoutSec: data.toolResultSemanticSummaryTimeoutSec ?? 12,
        progressWatchdogEnabled: Boolean(data.progressWatchdogEnabled ?? false),
        progressWatchdogTimeoutSec: data.progressWatchdogTimeoutSec ?? 300,
        compactionBackoffs: Array.isArray(data.compactionBackoffs) ? data.compactionBackoffs : [],
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
    const { t } = useTranslation();
    const [autoCompactionEnabled, setAutoCompactionEnabled] = useState(true);
    const [smartCompactionMethod, setSmartCompactionMethod] = useState('selective');
    const [compactionModel, setCompactionModel] = useState('');
    const [modelPayload, setModelPayload] = useState(null);
    const [probeBusy, setProbeBusy] = useState(false);
    const [probeResult, setProbeResult] = useState(null);
    const [remoteCompactionEnabled, setRemoteCompactionEnabled] = useState(false);
    const [remoteCompactionTimeoutSec, setRemoteCompactionTimeoutSec] = useState(300);
    const [remoteCompactionSupportedProviders, setRemoteCompactionSupportedProviders] = useState(['openai', 'openai-codex']);
    const [compactionTimeoutSec, setCompactionTimeoutSec] = useState(300);
    const [compactionBackoffBaseMin, setCompactionBackoffBaseMin] = useState(15);
    const [compactionBackoffMaxMin, setCompactionBackoffMaxMin] = useState(360);
    const [compactionThresholdPercent, setCompactionThresholdPercent] = useState(80);
    const [compactionBackoffDecayFactor, setCompactionBackoffDecayFactor] = useState(0.5);
    const [toolResultCompactionEnabled, setToolResultCompactionEnabled] = useState(true);
    const [toolResultSemanticSummaryEnabled, setToolResultSemanticSummaryEnabled] = useState(true);
    const [toolResultSemanticSummaryMaxInputChars, setToolResultSemanticSummaryMaxInputChars] = useState(12000);
    const [toolResultSemanticSummaryMaxTokens, setToolResultSemanticSummaryMaxTokens] = useState(320);
    const [toolResultSemanticSummaryTimeoutSec, setToolResultSemanticSummaryTimeoutSec] = useState(12);
    const [progressWatchdogEnabled, setProgressWatchdogEnabled] = useState(false);
    const [progressWatchdogTimeoutSec, setProgressWatchdogTimeoutSec] = useState(300);
    const [compactionBackoffs, setCompactionBackoffs] = useState([]);
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
        setSmartCompactionMethod(next.smartCompactionMethod);
        setCompactionModel(next.compactionModel);
        setRemoteCompactionEnabled(next.remoteCompactionEnabled);
        setRemoteCompactionTimeoutSec(next.remoteCompactionTimeoutSec);
        setRemoteCompactionSupportedProviders(next.remoteCompactionSupportedProviders);
        setCompactionTimeoutSec(next.compactionTimeoutSec);
        setCompactionBackoffBaseMin(next.compactionBackoffBaseMin);
        setCompactionBackoffMaxMin(next.compactionBackoffMaxMin);
        setCompactionThresholdPercent(next.compactionThresholdPercent);
        setCompactionBackoffDecayFactor(next.compactionBackoffDecayFactor);
        setToolResultCompactionEnabled(next.toolResultCompactionEnabled);
        setToolResultSemanticSummaryEnabled(next.toolResultSemanticSummaryEnabled);
        setToolResultSemanticSummaryMaxInputChars(next.toolResultSemanticSummaryMaxInputChars);
        setToolResultSemanticSummaryMaxTokens(next.toolResultSemanticSummaryMaxTokens);
        setToolResultSemanticSummaryTimeoutSec(next.toolResultSemanticSummaryTimeoutSec);
        setProgressWatchdogEnabled(next.progressWatchdogEnabled);
        setProgressWatchdogTimeoutSec(next.progressWatchdogTimeoutSec);
        setCompactionBackoffs(next.compactionBackoffs);
        setProgressWatchdogPhases(next.progressWatchdogPhases);
        savedSnapshotRef.current = JSON.stringify({
            autoCompactionEnabled: next.autoCompactionEnabled,
            smartCompactionMethod: next.smartCompactionMethod,
            compactionModel: next.compactionModel,
            remoteCompactionEnabled: next.remoteCompactionEnabled,
            remoteCompactionTimeoutSec: next.remoteCompactionTimeoutSec,
            compactionTimeoutSec: next.compactionTimeoutSec,
            compactionBackoffBaseMin: next.compactionBackoffBaseMin,
            compactionBackoffMaxMin: next.compactionBackoffMaxMin,
            compactionThresholdPercent: next.compactionThresholdPercent,
            compactionBackoffDecayFactor: next.compactionBackoffDecayFactor,
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

    useEffect(() => {
        let active = true;
        getAgentModels().then(payload => { if (active) setModelPayload(payload); }).catch(() => { if (active) setModelPayload({ models: [], model_options: [] }); });
        return () => { active = false; };
    }, []);

    const catalogue = useMemo(() => normaliseModelCatalogue(modelPayload || {}), [modelPayload]);
    const providerAuthById = useMemo(() => new Map(
        (modelPayload?.provider_diagnostics?.providers || []).map(provider => [provider.provider, Boolean(provider.auth_configured)]),
    ), [modelPayload]);
    const configuredModelMissing = Boolean(compactionModel && !catalogue.some(entry => entry.key === compactionModel));
    const effectiveProbeModel = compactionModel || modelPayload?.current || '';

    const probeCompactionModel = useCallback(async () => {
        if (!effectiveProbeModel || probeBusy) return;
        setProbeBusy(true);
        setProbeResult(null);
        try {
            const response = await fetch('/agent/settings/compaction/probe', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: effectiveProbeModel }),
            });
            const payload = await response.json().catch(() => ({}));
            setProbeResult(payload);
        } catch (error) {
            setProbeResult({ ok: false, model: effectiveProbeModel, error: error instanceof Error ? error.message : String(error) });
        } finally {
            setProbeBusy(false);
        }
    }, [effectiveProbeModel, probeBusy]);

    const currentSnapshot = useMemo(() => JSON.stringify({
        autoCompactionEnabled,
        smartCompactionMethod,
        compactionModel,
        remoteCompactionEnabled,
        remoteCompactionTimeoutSec,
        compactionTimeoutSec,
        compactionBackoffBaseMin,
        compactionBackoffMaxMin,
        compactionThresholdPercent,
        compactionBackoffDecayFactor,
        toolResultCompactionEnabled,
        toolResultSemanticSummaryEnabled,
        toolResultSemanticSummaryMaxInputChars,
        toolResultSemanticSummaryMaxTokens,
        toolResultSemanticSummaryTimeoutSec,
        progressWatchdogEnabled,
        progressWatchdogTimeoutSec,
    }), [
        autoCompactionEnabled,
        smartCompactionMethod,
        compactionModel,
        remoteCompactionEnabled,
        remoteCompactionTimeoutSec,
        compactionTimeoutSec,
        compactionBackoffBaseMin,
        compactionBackoffMaxMin,
        compactionThresholdPercent,
        compactionBackoffDecayFactor,
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

    const resetBackoff = useCallback(async (chatJid) => {
        try {
            setStatus?.(t('settings.compaction.clearing', { chat: chatJid }), 'info');
            const response = await fetch('/agent/settings/compaction/reset-backoff', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatJid }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok || !payload?.settings) {
                setStatus?.(payload?.error || t('settings.compaction.clearFailed'), 'error');
                return;
            }
            mergeSettingsData?.(payload.settings);
            applyIncoming({ ...(settingsData || {}), ...(payload.settings || {}) });
            setStatus?.(t('settings.compaction.cleared', { chat: chatJid }), 'success');
        } catch (error) {
            console.warn('[settings/compaction] Failed to clear compaction suppression.', error);
            setStatus?.(t('settings.compaction.clearFailed'), 'error');
        }
    }, [applyIncoming, mergeSettingsData, setStatus, settingsData]);

    return html`
        <div class="settings-section">
            ${appliedHint && html`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${t('settings.compaction.appliedNotice')}
                </div>
            `}

            <h3>${t('settings.compaction.autoHeading')}</h3>
            <div class="settings-row">
                <label>${t('settings.compaction.enableAutomatic')}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" checked=${autoCompactionEnabled} onChange=${e => setAutoCompactionEnabled(Boolean(e.target.checked))} />
                    <span class="settings-hint" style="margin:0">${t('settings.compaction.enableAutomaticHint')}</span>
                </div>
            </div>
            <div class="settings-row">
                <label>${t('settings.compaction.processingMethod')}</label>
                <select id="smartCompactionMethod" value=${smartCompactionMethod} onChange=${e => setSmartCompactionMethod(normalizeSmartCompactionMethod(e.target.value))}>
                    <option value="selective">${t('settings.compaction.methodSelective')}</option>
                    <option value="pipelined">${t('settings.compaction.methodPipelined')}</option>
                </select>
                <span class="settings-hint" style="margin:0">
                    ${smartCompactionMethod === 'pipelined'
                        ? t('settings.compaction.methodPipelinedHint')
                        : t('settings.compaction.methodSelectiveHint')}
                </span>
            </div>
            <div class="settings-row compaction-model-picker">
                <label for="compactionModel">${t('settings.compaction.model')}</label>
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; min-width:0;">
                    <select id="compactionModel" value=${compactionModel} onChange=${e => { setCompactionModel(e.target.value); setProbeResult(null); }} aria-describedby="compactionModelHint">
                        <option value="">Use active model${modelPayload?.current ? ` (${modelPayload.current})` : ''}</option>
                        ${configuredModelMissing && html`<option value=${compactionModel}>Unavailable: ${compactionModel}</option>`}
                        ${catalogue.map(entry => html`<option value=${entry.key}>${entry.displayName} — ${entry.key} · ${formatModelCatalogueContextWindow(entry.contextWindow) || 'unknown context'} · ${providerAuthById.get(entry.provider) ? 'credentials configured' : 'credentials not configured'}</option>`)}
                    </select>
                    <button type="button" class="settings-btn" disabled=${!effectiveProbeModel || probeBusy} onClick=${probeCompactionModel}>${probeBusy ? 'Testing…' : 'Test compaction model'}</button>
                </div>
                <span id="compactionModelHint" class="settings-hint" style="margin:0">${t('settings.compaction.modelHint')}</span>
                ${configuredModelMissing && html`<span class="settings-hint" role="alert" style="margin:0;color:var(--error, #dc2626)">Configured model is not currently available. It remains selected so you can repair it explicitly.</span>`}
                ${probeResult && html`<div class=${`settings-hint compaction-model-probe-result ${probeResult.ok ? 'success' : 'error'}`} role="status" aria-live="polite" style="margin:0">
                    ${probeResult.ok
                        ? `${probeResult.model} ready · ${probeResult.contextWindow?.toLocaleString?.() || 'unknown'} context · TTFT ${probeResult.timeToFirstTokenMs ?? 'n/a'}ms · ${probeResult.durationMs}ms total`
                        : `${probeResult.model || effectiveProbeModel}: ${probeResult.stage ? `${probeResult.stage} · ` : ''}${probeResult.error || 'Probe failed'}`}
                </div>`}
            </div>
            <div class="settings-row">
                <label>${t('settings.compaction.remoteNative')}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input id="remoteCompactionEnabled" type="checkbox" checked=${remoteCompactionEnabled} onChange=${e => setRemoteCompactionEnabled(Boolean(e.target.checked))} />
                    <span class="settings-hint" style="margin:0">
                        ${t('settings.compaction.remoteNativeHint', { providers: remoteCompactionSupportedProviders.join(', ') })}
                    </span>
                </div>
            </div>
            <div class="settings-row">
                <label>${t('settings.compaction.remoteTimeout')}</label>
                <${NumberStepper}
                    label=${t('settings.compaction.remoteTimeoutAria')}
                    value=${remoteCompactionTimeoutSec}
                    min=${1}
                    max=${300}
                    fallback=${60}
                    width="90px"
                    disabled=${!remoteCompactionEnabled}
                    onChange=${setRemoteCompactionTimeoutSec}
                />
                <span class="settings-hint" style="margin:0">${t('settings.compaction.remoteTimeoutHint')}</span>
            </div>
            <div class="settings-row">
                <label>${t('settings.compaction.enableToolResult')}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" checked=${toolResultCompactionEnabled} onChange=${e => setToolResultCompactionEnabled(Boolean(e.target.checked))} />
                    <span class="settings-hint" style="margin:0">${t('settings.compaction.enableToolResultHint')}</span>
                </div>
            </div>
            <div class="settings-row">
                <label>${t('settings.compaction.semanticSummaries')}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" checked=${toolResultSemanticSummaryEnabled} onChange=${e => setToolResultSemanticSummaryEnabled(Boolean(e.target.checked))} />
                    <span class="settings-hint" style="margin:0">${t('settings.compaction.semanticSummariesHint')}</span>
                </div>
            </div>
            <div class="settings-row">
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
            <div class="settings-row">
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
            <div class="settings-row">
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
            <div class="settings-row">
                <label>${t('settings.compaction.threshold')}</label>
                <${NumberStepper}
                    label=${t('settings.compaction.thresholdAria')}
                    value=${compactionThresholdPercent}
                    min=${10}
                    max=${95}
                    fallback=${80}
                    width="80px"
                    onChange=${setCompactionThresholdPercent}
                />
                <span class="settings-hint" style="margin:0">${t('settings.compaction.thresholdHint')}</span>
            </div>
            <div class="settings-row">
                <label>${t('settings.compaction.timeout')}</label>
                <${NumberStepper}
                    label=${t('settings.compaction.timeoutAria')}
                    value=${compactionTimeoutSec}
                    min=${1}
                    max=${3600}
                    fallback=${300}
                    width="90px"
                    onChange=${setCompactionTimeoutSec}
                />
                <span class="settings-hint" style="margin:0">${t('settings.compaction.timeoutHint')}</span>
            </div>
            <div class="settings-row">
                <label>${t('settings.compaction.backoffBase')}</label>
                <${NumberStepper}
                    label=${t('settings.compaction.backoffBaseAria')}
                    value=${compactionBackoffBaseMin}
                    min=${1}
                    max=${24 * 60}
                    fallback=${15}
                    width="90px"
                    onChange=${setCompactionBackoffBaseMin}
                />
                <span class="settings-hint" style="margin:0">${t('settings.compaction.backoffBaseHint')}</span>
            </div>
            <div class="settings-row">
                <label>${t('settings.compaction.backoffMax')}</label>
                <${NumberStepper}
                    label=${t('settings.compaction.backoffMaxAria')}
                    value=${compactionBackoffMaxMin}
                    min=${1}
                    max=${7 * 24 * 60}
                    fallback=${360}
                    width="90px"
                    onChange=${setCompactionBackoffMaxMin}
                />
                <span class="settings-hint" style="margin:0">${t('settings.compaction.backoffMaxHint')}</span>
            </div>

            <div class="settings-row">
                <label>${t('settings.compaction.decayFactor')}</label>
                <${NumberStepper}
                    label=${t('settings.compaction.decayFactorAria')}
                    value=${Math.round(compactionBackoffDecayFactor * 100)}
                    min=${10}
                    max=${100}
                    fallback=${50}
                    width="80px"
                    onChange=${v => setCompactionBackoffDecayFactor(v / 100)}
                />
                <span class="settings-hint" style="margin:0">${t('settings.compaction.decayFactorHint')}</span>
            </div>

            <h3 style="margin-top:20px">${t('settings.compaction.watchdogHeading')}</h3>
            <div class="settings-row">
                <label>${t('settings.compaction.enableWatchdog')}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" checked=${progressWatchdogEnabled} onChange=${e => setProgressWatchdogEnabled(Boolean(e.target.checked))} />
                    <span class="settings-hint" style="margin:0">${t('settings.compaction.enableWatchdogHint')}</span>
                </div>
            </div>
            <div class="settings-row">
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

            <h3 style="margin-top:20px">${t('settings.compaction.suppressionsHeading')}</h3>
            ${compactionBackoffs.length === 0 ? html`
                <p class="settings-hint">${t('settings.compaction.noBackoff')}</p>
            ` : html`
                <div class="settings-table-wrapper">
                    <table class="settings-table">
                        <thead>
                            <tr>
                                <th>Chat</th>
                                <th>Failures</th>
                                <th>Suppressed until</th>
                                <th>Last error</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${compactionBackoffs.map((entry) => html`
                                <tr>
                                    <td><code>${entry.chatJid}</code></td>
                                    <td>${entry.failureCount}</td>
                                    <td>${formatIso(entry.backoffUntil)}</td>
                                    <td title=${entry.lastErrorMessage || ''}>${entry.lastErrorMessage || '—'}</td>
                                    <td>
                                        <button class="settings-secondary-btn" onClick=${() => resetBackoff(entry.chatJid)}>
                                            ${t('settings.compaction.clear')}
                                        </button>
                                    </td>
                                </tr>
                            `)}
                        </tbody>
                    </table>
                </div>
            `}

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
