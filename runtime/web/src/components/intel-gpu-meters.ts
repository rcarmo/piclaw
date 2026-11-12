import { html, useEffect, useLayoutEffect, useMemo, useRef } from '../vendor/preact-htm.js';

export const INTEL_GPU_STALE_AFTER_MS = 6000;
export const INTEL_GPU_MISSING_VALUE = '—';

function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function toNonNegativeCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function clampPercent(value) {
    const number = toFiniteNumber(value);
    return number === null || number < 0 || number > 100 ? null : number;
}

function formatCompactBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return INTEL_GPU_MISSING_VALUE;
    if (bytes === 0) return '0B';
    const units = ['B', 'K', 'M', 'G', 'T'];
    let unitIndex = 0;
    let scaled = bytes;
    while (scaled >= 1024 && unitIndex < units.length - 1) {
        scaled /= 1024;
        unitIndex += 1;
    }
    const digits = scaled >= 100 || unitIndex === 0 ? 0 : scaled >= 10 ? 0 : 1;
    return `${scaled.toFixed(digits)}${units[unitIndex]}`;
}

export function formatOptionalPercent(value) {
    const number = clampPercent(value);
    return number === null ? INTEL_GPU_MISSING_VALUE : `${Math.round(number)}%`;
}

export function formatOptionalBytesCompact(value) {
    const number = toFiniteNumber(value);
    return number === null || number < 0 ? INTEL_GPU_MISSING_VALUE : formatCompactBytes(number);
}

export function formatBytesExplicit(value) {
    const bytes = toFiniteNumber(value);
    if (bytes === null || bytes < 0) return INTEL_GPU_MISSING_VALUE;
    if (bytes === 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let unitIndex = 0;
    let scaled = bytes;
    while (scaled >= 1024 && unitIndex < units.length - 1) {
        scaled /= 1024;
        unitIndex += 1;
    }
    const digits = scaled >= 100 || unitIndex === 0 ? 0 : scaled >= 10 ? 1 : 2;
    return `${scaled.toFixed(digits)} ${units[unitIndex]}`;
}

export function sanitizeNullableSeries(input, maxPoints = 30) {
    const series = Array.isArray(input)
        ? input.map((value) => {
            if (value === null || value === undefined || value === '') return null;
            const number = Number(value);
            return Number.isFinite(number) ? number : null;
        })
        : [];
    return series.length > maxPoints ? series.slice(series.length - maxPoints) : series;
}

export function buildNullableSparklinePath(series, width = 56, height = 16, options = {}) {
    const points = sanitizeNullableSeries(series);
    const finitePoints = points.filter((value) => Number.isFinite(value));
    if (finitePoints.length === 0) return '';

    const minValue = Number.isFinite(options.min) ? Number(options.min) : Math.min(...finitePoints);
    const maxValue = Number.isFinite(options.max) ? Number(options.max) : Math.max(...finitePoints);
    const singleValueY = (height / 2).toFixed(2);
    // Keep the stroke inside the SVG, including valid 0% and 100% samples.
    const padding = Math.min(1, height / 2);
    const sampleY = (value) => maxValue > minValue
        ? (height - padding - Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue))) * (height - 2 * padding)).toFixed(2)
        : singleValueY;
    if (points.length === 1) return `M 0 ${sampleY(points[0])} L ${width} ${sampleY(points[0])}`;
    const path = [];

    let previousIndex = -2;
    let segmentCount = 0;
    for (let index = 0; index < points.length; index += 1) {
        const value = points[index];
        if (!Number.isFinite(value)) {
            previousIndex = -2;
            continue;
        }
        const x = points.length === 1 ? width / 2 : (index / (points.length - 1 || 1)) * width;
        const y = sampleY(value);
        const isContinuation = previousIndex === index - 1;
        path.push(`${isContinuation ? 'L' : 'M'} ${x.toFixed(2)} ${y}`);
        if (!isContinuation) {
            segmentCount += 1;
            // A nonzero segment makes isolated valid samples visible with
            // round line caps, without bridging null history gaps.
            const markerX = x >= width ? x - 0.01 : x + 0.01;
            path.push(`L ${markerX.toFixed(2)} ${y}`);
        }
        previousIndex = index;
    }

    return segmentCount > 0 ? path.join(' ') : '';
}

function normalizeEngineClassName(name) {
    const raw = String(name || '').trim();
    const lower = raw.toLowerCase();
    if (!raw) return 'Unknown';
    if (lower === 'render' || /^rcs\d*$/.test(lower)) return 'Render';
    if (lower === 'compute' || /^ccs\d*$/.test(lower)) return 'Compute';
    if (lower === 'copy' || lower === 'blitter' || /^bcs\d*$/.test(lower)) return 'Blitter';
    if (lower === 'video' || /^vcs\d*$/.test(lower)) return 'Video';
    if (lower === 'video-enhance' || lower === 'video enhance' || /^vecs\d*$/.test(lower)) return 'Video Enhance';
    if (lower === 'gsc' || /^gsc\d*$/.test(lower)) return 'GSC';
    return raw;
}

function humanizeStatus(status) {
    const normalized = ['ok', 'partial', 'unavailable', 'stale'].includes(String(status))
        ? String(status)
        : 'unavailable';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatAgeLabel(ageMs) {
    if (ageMs === null || !Number.isFinite(ageMs) || ageMs < 0) return 'Unknown';
    if (ageMs < 1000) return '<1s old';
    if (ageMs < 60_000) return `${(ageMs / 1000).toFixed(ageMs >= 10_000 ? 0 : 1)}s old`;
    if (ageMs < 3_600_000) return `${(ageMs / 60_000).toFixed(ageMs >= 600_000 ? 0 : 1)}m old`;
    return `${(ageMs / 3_600_000).toFixed(ageMs >= 36_000_000 ? 0 : 1)}h old`;
}

function normalizeReasons(input) {
    return Array.isArray(input)
        ? input
            .map((reason) => String(reason || '').trim())
            .filter(Boolean)
            .slice(0, 8)
        : [];
}

function statusToneClass(status) {
    return ['ok', 'partial', 'stale', 'unavailable'].includes(String(status))
        ? `is-${status}`
        : 'is-unavailable';
}

export function normalizeGpuSnapshots(input, options = {}) {
    const snapshots = Array.isArray(input)
        ? input.filter(s => s && typeof s.provider === 'string' && s.provider.trim() && s.disabled !== true && s.enabled !== false && s.status !== 'disabled').slice(0, 8)
        : [];
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const lastSuccessAtMs = toFiniteNumber(options.lastSuccessAtMs);
    const transportStale = lastSuccessAtMs !== null && nowMs - lastSuccessAtMs > INTEL_GPU_STALE_AFTER_MS;

    return snapshots.map((snapshot, index) => {
        const id = String(snapshot?.id || `gpu-${index}`);
        const name = String(snapshot?.name || `GPU ${index}`).trim() || `GPU ${index}`;
        const observedClients = snapshot.provider.endsWith('fdinfo')
            || (snapshot?.memory?.used_bytes === undefined && snapshot?.memory?.resident_bytes !== undefined);
        const rawStatus = ['ok', 'partial', 'unavailable', 'stale'].includes(String(snapshot?.status))
            ? String(snapshot?.status)
            : 'unavailable';
        const reasons = normalizeReasons(snapshot?.reasons);
        const sampleTimeMs = toFiniteNumber(snapshot?.sample_time_ms);
        const sampleAgeMs = sampleTimeMs === null ? null : Math.max(0, nowMs - sampleTimeMs);

        const stale = transportStale || rawStatus === 'stale' || (sampleAgeMs !== null && sampleAgeMs > INTEL_GPU_STALE_AFTER_MS);
        const unavailable = stale || rawStatus === 'unavailable';
        const engines = Array.isArray(snapshot?.engines)
            ? snapshot.engines.slice(0, 16).map((engine, engineIndex) => ({
                name: String(engine?.name || `engine-${engineIndex}`).trim() || `engine-${engineIndex}`,
                label: normalizeEngineClassName(engine?.name),
                capacity: toFiniteNumber(engine?.capacity),
                busyPercent: unavailable ? null : clampPercent(engine?.busy_percent),
            }))
            : [];

        let busiestEngine = null;
        for (const engine of engines) {
            if (engine.busyPercent === null) continue;
            if (!busiestEngine || engine.busyPercent > busiestEngine.busyPercent) busiestEngine = engine;
        }

        const history = Array.isArray(snapshot?.history) ? snapshot.history.slice(-30) : [];
        const busySeries = history.map((entry) => clampPercent(entry?.busy_percent));
        const residentSeries = history.map((entry) => {
            const residentBytes = toFiniteNumber(entry?.resident_bytes);
            return residentBytes === null || residentBytes < 0 ? null : residentBytes;
        });

        const busyPercent = unavailable ? null : clampPercent(snapshot?.busy_percent);
        const residentBytes = (() => {
            const number = unavailable ? null : toFiniteNumber(observedClients ? snapshot?.memory?.resident_bytes : snapshot?.memory?.used_bytes ?? snapshot?.memory?.resident_bytes);
            return number === null || number < 0 ? null : number;
        })();
        const totalBytes = (() => {
            const number = toFiniteNumber(snapshot?.memory?.total_bytes);
            return number === null || number < 0 ? null : number;
        })();
        const sharedBytes = (() => {
            const number = toFiniteNumber(snapshot?.memory?.shared_bytes);
            return number === null || number < 0 ? null : number;
        })();
        const deviceMemoryPercent = !observedClients && residentBytes !== null && totalBytes > 0 ? clampPercent(residentBytes / totalBytes * 100) : null;

        const coverage = {
            scope: String(snapshot?.coverage?.scope || 'observed-clients'),
            clients: toNonNegativeCount(snapshot?.coverage?.clients),
            scannedProcesses: toNonNegativeCount(snapshot?.coverage?.scanned_processes),
            unreadableProcesses: toNonNegativeCount(snapshot?.coverage?.unreadable_processes),
            unreadableClients: toNonNegativeCount(snapshot?.coverage?.unreadable_clients),
            truncated: Boolean(snapshot?.coverage?.truncated),
        };

        const effectiveStatus = stale ? 'stale' : rawStatus;
        const effectiveReasons = stale
            ? [...reasons, 'UI refresh overdue.']
            : reasons;
        const busiestEngineLabel = busiestEngine?.label || null;
        const coverageText = observedClients ? [
            `Observed clients: ${coverage.clients}`,
            `scanned processes: ${coverage.scannedProcesses}`,
            `unreadable processes: ${coverage.unreadableProcesses}`,
            `unreadable clients: ${coverage.unreadableClients}`,
            coverage.truncated ? 'scan truncated; best-effort visibility' : 'best-effort process visibility',
        ].join(' • ') : '';

        return {
            id,
            name,
            provider: String(snapshot?.provider || ''),
            driver: String(snapshot?.driver || ''),
            sampleTimeMs,
            sampleAgeMs,
            sampleAgeText: formatAgeLabel(sampleAgeMs),
            status: rawStatus,
            effectiveStatus,
            statusToneClass: statusToneClass(effectiveStatus),
            statusText: humanizeStatus(effectiveStatus),
            reasons,
            effectiveReasons,
            busiestEngineLabel,
            noVisibleClientsText: observedClients && coverage.clients === 0 ? 'No visible clients.' : '',
            memoryWarningText: observedClients ? 'Observed client memory may overlap system RAM and shared buffers; it is not dedicated VRAM usage.' : '',
            coverageText,
            engines,
            coverage,
            rows: {
                gpuLabel: snapshots.length === 1 ? 'GPU' : `GPU${index}`,
                gmemLabel: snapshots.length === 1 ? (observedClients ? 'GMEM' : 'VRAM') : `${observedClients ? 'GMEM' : 'VRAM'}${index}`,
                busyPercent,
                busyText: formatOptionalPercent(busyPercent),
                busySparkPath: unavailable ? '' : buildNullableSparklinePath(busySeries.length ? busySeries : [busyPercent], 56, 16, { min: 0, max: 100 }),
                busyTitle: observedClients && busiestEngineLabel
                    ? `${name} — busiest observed engine: ${busiestEngineLabel}`
                    : `${name} — ${busyPercent === null ? 'activity unavailable' : 'GPU activity'}`,
                engineNote: '',
                residentBytes,
                residentText: deviceMemoryPercent !== null ? formatOptionalPercent(deviceMemoryPercent) : formatOptionalBytesCompact(residentBytes),
                residentSparkPath: unavailable ? '' : deviceMemoryPercent !== null
                    ? buildNullableSparklinePath(residentSeries.length ? residentSeries.map(value => value === null ? null : value / totalBytes * 100) : [deviceMemoryPercent], 56, 16, { min: 0, max: 100 })
                    : buildNullableSparklinePath(residentSeries.length ? residentSeries : [residentBytes], 56, 16),
                memoryTitle: `${name} — ${observedClients ? 'observed client memory' : 'device memory usage'}`,
            },
            memory: {
                residentBytes,
                residentText: formatBytesExplicit(residentBytes),
                totalBytes,
                totalText: formatBytesExplicit(totalBytes),
                sharedBytes,
                sharedText: formatBytesExplicit(sharedBytes),
            },
        };
    });
}
export const normalizeIntelGpuSnapshots = normalizeGpuSnapshots;

/** Per-HUD capability memory. Never persist readings or invent idle samples. */
export class GpuMeterHistory {
    constructor() { this.devices = new Map(); }
    clear() { this.devices.clear(); }
    update(snapshots, options = {}) {
        const meters = normalizeGpuSnapshots(snapshots, options);
        const present = new Set(meters.map(meter => `${meter.provider}:${meter.id}`));
        for (const key of this.devices.keys()) if (!present.has(key)) this.devices.delete(key);
        return meters.map(meter => {
            const key = `${meter.provider}:${meter.id}`;
            const identity = `${meter.name}:${meter.driver}`;
            const previous = this.devices.get(key);
            const state = previous?.identity === identity ? previous : { identity, busy: false, memory: false, busySeries: [], memorySeries: [], sample: null, freshness: null, historyTime: -Infinity };
            const snapshot = snapshots.find(row => String(row?.id) === meter.id && row.provider === meter.provider);
            const sample = meter.effectiveStatus === 'stale' && options.pollId !== undefined
                ? `stale:${options.pollId}`
                : snapshot?.sample_time_ms ?? options.pollId ?? options.lastSuccessAtMs ?? options.nowMs;
            const freshness = `${meter.effectiveStatus}:${meter.rows.busyPercent}:${meter.rows.residentBytes}`;
            const memoryPercent = meter.rows.residentText.endsWith('%');
            const history = Array.isArray(snapshot?.history) ? snapshot.history.slice(-30) : [];
            const unseen = [...new Map(history.filter(row => toFiniteNumber(row?.timestamp_ms) !== null && Number(row.timestamp_ms) > state.historyTime)
                .map(row => [Number(row.timestamp_ms), row])).values()]
                .sort((a, b) => Number(a.timestamp_ms) - Number(b.timestamp_ms));
            const seedHistory = unseen.length ? unseen : history;
            if (sample !== state.sample || freshness !== state.freshness || unseen.length > 0) {
                const busyUsable = meter.rows.busyPercent !== null && Boolean(meter.rows.busySparkPath);
                const memoryUsable = meter.rows.residentBytes !== null && Boolean(meter.rows.residentSparkPath)
                    && (!state.memory || !state.memoryPercent || (memoryPercent && meter.memory.totalBytes > 0));
                const memoryValue = value => {
                    const bytes = toFiniteNumber(value);
                    if (bytes === null || bytes < 0) return null;
                    return state.memoryPercent ? (meter.memory.totalBytes > 0 ? clampPercent(bytes / meter.memory.totalBytes * 100) : null) : bytes;
                };
                if (busyUsable && !state.busy) {
                    state.busy = true;
                    state.busySeries = seedHistory.length ? seedHistory.map(row => clampPercent(row.busy_percent)) : [meter.rows.busyPercent];
                } else if (state.busy) {
                    const values = unseen.length ? unseen.map(row => clampPercent(row.busy_percent)) : [busyUsable ? meter.rows.busyPercent : null];
                    state.busySeries = [...state.busySeries, ...values].slice(-30);
                }
                if (memoryUsable && !state.memory) {
                    state.memory = true;
                    state.memoryPercent = memoryPercent;
                    state.memoryScale = memoryPercent ? { min: 0, max: 100 } : {};
                    state.memorySeries = seedHistory.length ? seedHistory.map(row => memoryValue(row.resident_bytes)) : [memoryValue(meter.rows.residentBytes)];
                } else if (state.memory) {
                    const values = unseen.length ? unseen.map(row => memoryValue(row.resident_bytes)) : [memoryUsable ? memoryValue(meter.rows.residentBytes) : null];
                    state.memorySeries = [...state.memorySeries, ...values].slice(-30);
                }
                // A retained backend history must not hide the current transport/counter gap.
                if (unseen.length && state.busy && !busyUsable && unseen.at(-1)?.busy_percent != null) state.busySeries = [...state.busySeries, null].slice(-30);
                if (unseen.length && state.memory && !memoryUsable && unseen.at(-1)?.resident_bytes != null) state.memorySeries = [...state.memorySeries, null].slice(-30);
                const timestamps = history.map(row => toFiniteNumber(row?.timestamp_ms)).filter(value => value !== null);
                if (timestamps.length) state.historyTime = Math.max(state.historyTime, ...timestamps);
                state.sample = sample;
                state.freshness = freshness;
            }
            meter.rows.busyRemembered = state.busy;
            meter.rows.memoryRemembered = state.memory;
            if (state.busy) {
                if (!meter.rows.busySparkPath || meter.rows.busyPercent === null) {
                    meter.rows.busyPercent = null;
                    meter.rows.busyText = INTEL_GPU_MISSING_VALUE;
                }
                meter.rows.busySparkPath = buildNullableSparklinePath(state.busySeries, 56, 16, { min: 0, max: 100 });
            }
            if (state.memory) {
                if (!state.memoryPercent && meter.rows.residentBytes !== null) meter.rows.residentText = formatOptionalBytesCompact(meter.rows.residentBytes);
                if (!meter.rows.residentSparkPath || meter.rows.residentBytes === null || (state.memoryPercent && !memoryPercent)) {
                    meter.rows.residentBytes = null;
                    meter.rows.residentText = INTEL_GPU_MISSING_VALUE;
                }
                meter.rows.residentSparkPath = buildNullableSparklinePath(state.memorySeries, 56, 16, state.memoryScale);
            }
            const missing = (state.busy && meter.rows.busyPercent === null) || (state.memory && meter.rows.residentBytes === null);
            if (missing && meter.effectiveStatus === 'ok') {
                meter.effectiveStatus = meter.rows.busyPercent !== null || meter.rows.residentBytes !== null ? 'partial' : 'unavailable';
                meter.statusText = humanizeStatus(meter.effectiveStatus);
                meter.statusToneClass = statusToneClass(meter.effectiveStatus);
                meter.effectiveReasons = [...meter.effectiveReasons, 'Current GPU readings unavailable.'];
            }
            this.devices.set(key, state);
            return meter;
        });
    }
}

export function getGpuMeterRows(meter) {
    return [
        { key: 'busy', className: 'intel-gpu', label: meter.rows.gpuLabel, value: meter.rows.busyText, title: meter.rows.busyTitle, path: meter.rows.busySparkPath, available: meter.rows.busyRemembered || meter.rows.busyPercent !== null },
        { key: 'memory', className: 'intel-gmem', label: meter.rows.gmemLabel, value: meter.rows.residentText, title: meter.rows.memoryTitle, path: meter.rows.residentSparkPath, available: meter.rows.memoryRemembered || meter.rows.residentBytes !== null },
    ].filter(row => row.available && (row.path !== '' || (row.key === 'busy' ? meter.rows.busyRemembered : meter.rows.memoryRemembered)));
}

export function buildIntelGpuCompactSummaryParts(meters) {
    return Array.isArray(meters)
        ? meters.flatMap(meter => getGpuMeterRows(meter).map(row => `${row.label} ${row.value}`))
        : [];
}
export const buildGpuCompactSummaryParts = buildIntelGpuCompactSummaryParts;

function renderDetailsSection(label, value) {
    return html`
        <div class="system-meters-gpu-detail-key">${label}</div>
        <div class="system-meters-gpu-detail-value">${value}</div>
    `;
}

function gpuDialogId(id) {
    return `gpu-details-${id.replace(/[^a-z0-9_-]+/gi, '-')}`;
}

export function GpuMeterRows({ meters = [], compact = false, openGpuId = null, onOpen = () => {} }) {
    return html`${meters.map((meter) => getGpuMeterRows(meter).map((row) => html`
        <button
            key=${`${meter.id}-${row.key}`}
            class=${`system-meters-meter-button ${compact ? 'system-meters-compact-gpu' : 'system-meters-row'} ${row.className} ${meter.statusToneClass}`}
            type="button"
            title=${`${row.title} — tap for details`}
            aria-label=${`${row.label} ${row.value} — ${meter.name} details`}
            aria-haspopup="dialog"
            aria-expanded=${openGpuId === meter.id ? 'true' : 'false'}
            aria-controls=${gpuDialogId(meter.id)}
            onClick=${(event) => { event.stopPropagation(); onOpen(meter.id, event.currentTarget); }}
        >
            <span class="system-meters-label">${row.label}</span>
            <svg class="system-meters-spark" viewBox="0 0 56 16" preserveAspectRatio="none" aria-hidden="true"><path vector-effect="non-scaling-stroke" d=${row.path}></path></svg>
            <span class="system-meters-value">${row.value}</span>
        </button>
    `))}`;
}

export function GpuDetailsPopover({ meters = [], openGpuId = null, onOpen = () => {}, triggerRef }) {
    const setOpenGpuId = onOpen;
    const panelRef = useRef(null);
    const closePanel = (restoreFocus = true) => {
        setOpenGpuId(null);
        const trigger = triggerRef?.current;
        if (restoreFocus && trigger?.isConnected) queueMicrotask(() => trigger.focus());
    };

    const activeMeter = useMemo(
        () => meters.find((meter) => meter.id === openGpuId) || null,
        [meters, openGpuId],
    );

    useEffect(() => {
        if (openGpuId && !meters.some((meter) => meter.id === openGpuId)) {
            setOpenGpuId(null);
        }
    }, [meters, openGpuId]);

    useLayoutEffect(() => {
        if (!activeMeter) return undefined;

        const onKeyDown = (event) => {
            if (event?.key !== 'Escape') return;
            event.preventDefault();
            closePanel();
        };

        const onPointerDown = (event) => {
            const target = event?.target;
            if (!(target instanceof Node)) return;
            if (panelRef.current?.contains(target)) return;
            // Meter buttons handle opening/toggling themselves. Outside taps
            // should retain their normal focus target instead of stealing focus.
            if (target instanceof Element && target.closest('.system-meters-meter-button[aria-haspopup="dialog"]')) return;
            closePanel(false);
        };

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('touchstart', onPointerDown, true);

        if (panelRef.current && typeof panelRef.current.focus === 'function') {
            queueMicrotask(() => panelRef.current?.focus?.());
        }

        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('mousedown', onPointerDown, true);
            document.removeEventListener('touchstart', onPointerDown, true);
        };
    }, [activeMeter?.id]);

    if (!activeMeter) return null;

    return html`
                <div
                    ref=${panelRef}
                    id=${gpuDialogId(activeMeter.id)}
                    class=${`system-meters-gpu-popover ${activeMeter.statusToneClass}`}
                    role="dialog"
                    aria-modal="false"
                    aria-label=${`${activeMeter.name} details`}
                    tabIndex="-1"
                    data-testid="gpu-popover"
                >
                    <div class="system-meters-gpu-popover-header">
                        <div class="system-meters-gpu-popover-heading">
                            <div class="system-meters-gpu-popover-title">${activeMeter.name}</div>
                            <div class="system-meters-gpu-popover-subtitle">GPU telemetry</div>
                        </div>
                        <button class="system-meters-gpu-popover-close" type="button" onClick=${() => closePanel()}>
                            Close
                        </button>
                    </div>

                    <div class="system-meters-gpu-detail-grid">
                        ${renderDetailsSection('Status', activeMeter.statusText)}
                        ${activeMeter.sampleAgeMs !== null && renderDetailsSection('Sample age', activeMeter.sampleAgeText)}
                        ${activeMeter.rows.busyPercent !== null && renderDetailsSection('Activity', activeMeter.rows.busyText)}
                        ${activeMeter.rows.residentBytes !== null && renderDetailsSection(activeMeter.rows.gmemLabel.startsWith('GMEM') ? 'Observed memory' : 'Device memory', activeMeter.memory.residentText)}
                        ${activeMeter.memory.totalBytes !== null && renderDetailsSection(activeMeter.rows.gmemLabel.startsWith('GMEM') ? 'Client-reported total' : 'Memory capacity', activeMeter.memory.totalText)}
                    </div>
                    ${activeMeter.noVisibleClientsText && html`<p class="system-meters-gpu-note">${activeMeter.noVisibleClientsText}</p>`}
                    ${activeMeter.memoryWarningText && html`<p class="system-meters-gpu-note">${activeMeter.memoryWarningText}</p>`}
                    ${activeMeter.effectiveReasons.length > 0 && html`<p class="system-meters-gpu-note">${activeMeter.effectiveReasons.join(' ')}</p>`}
                </div>
    `;
}
export const IntelGpuMeterRows = GpuMeterRows;
export const IntelGpuDetailsPopover = GpuDetailsPopover;
