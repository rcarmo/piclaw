import { createVisibleInterval } from '../ui/visible-interval.js';
import { html, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { getSystemMetrics } from '../api.js';
import { METERS_COLLAPSED_EVENT_NAME, applyMetersCollapsed, readStoredMetersCollapsed } from '../ui/meters.js';
import { renderDisclosureTriangle } from '../ui/disclosure-triangle.js';
import { buildGpuCompactSummaryParts, GpuDetailsPopover, GpuMeterRows, GpuMeterHistory, getGpuMeterRows } from './intel-gpu-meters.js';

export const SYSTEM_METERS_COMPACT_BREAKPOINT_PX = 600;
// Match the metrics sampler's cadence. The general UI's 5s poll meets the
// demand-driven GPU cache's 5s expiry, so every refresh loses VRAM history.
export const SYSTEM_METERS_POLL_MS = 2000;

function sanitizeSeries(input, maxPoints = 30) {
    const series = Array.isArray(input)
        ? input
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value))
        : [];
    return series.length > maxPoints ? series.slice(series.length - maxPoints) : series;
}

function clampPercentSeries(input, maxPoints = 30) {
    return sanitizeSeries(input, maxPoints).map((value) => Math.max(0, Math.min(100, value)));
}

export function buildSparklinePath(series, width = 56, height = 16, options = {}) {
    const points = sanitizeSeries(series);
    if (points.length === 0) return '';

    const minValue = Number.isFinite(options.min) ? Number(options.min) : Math.min(...points);
    const maxValue = Number.isFinite(options.max) ? Number(options.max) : Math.max(...points);

    if (!(maxValue > minValue)) {
        const y = (height / 2).toFixed(2);
        return `M 0 ${y} L ${width} ${y}`;
    }

    if (points.length === 1) {
        const normalized = (points[0] - minValue) / (maxValue - minValue);
        const y = (height - normalized * height).toFixed(2);
        return `M 0 ${y} L ${width} ${y}`;
    }

    return points.map((value, index) => {
        const x = (index / (points.length - 1 || 1)) * width;
        const normalized = (value - minValue) / (maxValue - minValue);
        const y = height - normalized * height;
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
}

function formatPercent(value) {
    return `${Math.round(Number(value) || 0)}%`;
}
function optionalPercent(value) {
    return value !== null && value !== undefined && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 ? Number(value) : null;
}
function optionalBytes(value) {
    return value !== null && value !== undefined && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

export function formatBytesCompact(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0B';
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

export function buildCompactMetersSummary(metrics, gpuMeters = []) {
    const parts = [
        ...(optionalPercent(metrics?.cpu_percent) !== null ? [`CPU ${formatPercent(metrics.cpu_percent)}`] : []),
        ...(optionalPercent(metrics?.ram_percent) !== null ? [`RAM ${formatPercent(metrics.ram_percent)}`] : []),
        ...buildGpuCompactSummaryParts(gpuMeters),
    ];
    if (Number(metrics?.buffer_cache_bytes) > 0) {
        parts.push(`BUF ${formatBytesCompact(metrics?.buffer_cache_bytes)}`);
    }
    if (shouldShowVram(metrics)) {
        parts.push(`VRAM ${formatPercent(metrics?.vram_percent)}`);
    }
    if (optionalPercent(metrics?.swap_percent) !== null && Number(metrics?.swap_total_bytes) > 0) {
        parts.push(`SWP ${formatPercent(metrics?.swap_percent)}`);
    }
    return parts.join(' • ');
}

export function resolveCurrentRssBytes(metrics) {
    return Number(metrics?.process_memory?.vm_rss_bytes) > 0
        ? Number(metrics.process_memory.vm_rss_bytes)
        : Number(metrics?.process_memory?.rss_bytes) || 0;
}

export function shouldShowRss(metrics) {
    return resolveCurrentRssBytes(metrics) > 0 && sanitizeSeries(metrics?.process_rss_series_bytes).length > 0;
}

export function shouldShowVram(metrics) {
    return optionalPercent(metrics?.vram_percent) !== null
        && Number(metrics?.vram_total_bytes) > 0
        && Number.isFinite(Number(metrics?.vram_total_bytes))
        && metrics?.vram_used_bytes !== null && metrics?.vram_used_bytes !== undefined
        && Number.isFinite(Number(metrics?.vram_used_bytes))
        && Number(metrics?.vram_used_bytes) >= 0
        && Number(metrics?.vram_used_bytes) <= Number(metrics?.vram_total_bytes)
        && sanitizeSeries(metrics?.vram_series).length > 0;
}

/** Aggregate NVML memory plus optional busiest-device activity. */
export function resolveGpuMeterSnapshots(metrics) {
    const devices = Array.isArray(metrics?.gpus) ? metrics.gpus : [];
    if (!shouldShowVram(metrics) || devices.some(gpu => gpu?.provider === metrics.gpu_provider)) return devices;
    return [...devices, { id: `memory-${metrics.gpu_provider || 'gpu'}`, name: 'GPU', provider: metrics.gpu_provider || 'device-memory', status: 'ok',
        busy_percent: optionalPercent(metrics.gpu_busy_percent),
        sample_time_ms: metrics.gpu_sample_times?.at(-1),
        memory: { used_bytes: Number(metrics.vram_used_bytes), total_bytes: Number(metrics.vram_total_bytes) },
        history: Array.from({ length: metrics.gpu_sample_times?.length || Math.max(metrics.vram_series.length, metrics.gpu_busy_series?.length || 0) }, (_, index) => {
            const length = metrics.gpu_sample_times?.length || Math.max(metrics.vram_series.length, metrics.gpu_busy_series?.length || 0);
            const percent = metrics.vram_series[index + metrics.vram_series.length - length];
            const busyIndex = index + (metrics.gpu_busy_series?.length || 0) - length;
            return { timestamp_ms: metrics.gpu_sample_times?.[index], resident_bytes: Array.isArray(metrics.gpu_resident_series) && metrics.gpu_resident_series.length > 0 ? metrics.gpu_resident_series[index] : optionalPercent(percent) === null ? null : Number(metrics.vram_total_bytes) * Number(percent) / 100,
                busy_percent: optionalPercent(metrics.gpu_busy_series?.[busyIndex]) };
        }) }];
}

/** Legacy NVIDIA memory transport has no explicit device-removal signal. */
export class GpuSnapshotTracker {
    constructor() { this.aggregate = null; this.missing = null; }
    clear() { this.aggregate = null; this.missing = null; }
    resolve(metrics) {
        const explicit = Array.isArray(metrics?.gpus) ? metrics.gpus : [];
        if (explicit.length > 0) { this.clear(); return explicit; }
        if (this.aggregate && metrics?.gpu_provider && metrics.gpu_provider !== this.aggregate.provider) this.clear();
        const snapshots = resolveGpuMeterSnapshots(metrics);
        const aggregate = snapshots.find(snapshot => String(snapshot.id).startsWith('memory-'));
        if (aggregate) { this.aggregate = aggregate; this.missing = null; }
        else if (this.aggregate && snapshots.some(snapshot => snapshot.provider === this.aggregate.provider)) this.clear();
        else if (this.aggregate) {
            // A failed aggregate read is not proof that the GPU disappeared.
            const times = metrics?.gpu_sample_times || [];
            this.missing = { ...this.aggregate, status: 'unavailable', sample_time_ms: times.at(-1) ?? this.aggregate.sample_time_ms, busy_percent: null,
                memory: { total_bytes: this.aggregate.memory.total_bytes }, history: times.map((timestamp_ms, index) => ({timestamp_ms,busy_percent:metrics.gpu_busy_series?.[index] ?? null,resident_bytes:metrics.gpu_resident_series?.[index] ?? null})),
                reasons: ['GPU memory telemetry is temporarily unavailable.'] };
            return [...snapshots, this.missing];
        }
        return snapshots;
    }
}

function readIsNarrowLayout() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(`(max-width: ${SYSTEM_METERS_COMPACT_BREAKPOINT_PX}px)`).matches;
}

const SYSTEM_METERS_ACTIVE_MODES = new Set(['overlay', 'sidebar', 'statusbar']);

export function SystemMetersHud({ mode = 'overlay' }) {
    const [collapsed, setCollapsed] = useState(() => readStoredMetersCollapsed(false));
    const [isNarrowLayout, setIsNarrowLayout] = useState(() => readIsNarrowLayout());
    const [metrics, setMetrics] = useState({
        cpu_percent: null,
        ram_percent: null,
        swap_percent: null,
        cpu_series: [],
        ram_series: [],
        swap_series: [],
        gpu_busy_percent: null,
        gpu_busy_series: [],
        vram_percent: null,
        vram_series: [],
        vram_total_bytes: 0,
        vram_used_bytes: 0,
        gpu_provider: null,
        gpus: [],
        buffer_cache_bytes: null,
        buffer_cache_series_bytes: [],
        process_rss_series_bytes: [],
        process_memory: {
            rss_bytes: 0,
            vm_rss_bytes: null,
        },
        swap_total_bytes: 0,
        swap_used_bytes: 0,
        sample_interval_ms: 2000,
        platform: '',
    });
    const [loading, setLoading] = useState(false);
    const [openGpuId, setOpenGpuId] = useState(null);
    const gpuTriggerRef = useRef(null);
    const gpuHistoryRef = useRef(new GpuMeterHistory());
    const gpuSnapshotTrackerRef = useRef(new GpuSnapshotTracker());
    const [lastSuccessfulRefreshMs, setLastSuccessfulRefreshMs] = useState(null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [gpuPollId, setGpuPollId] = useState(0);

    useEffect(() => {
        const onMetersCollapsedChange = (event) => {
            setCollapsed(Boolean(event?.detail?.collapsed));
            setOpenGpuId(null);
        };
        window.addEventListener(METERS_COLLAPSED_EVENT_NAME, onMetersCollapsedChange);
        return () => window.removeEventListener(METERS_COLLAPSED_EVENT_NAME, onMetersCollapsedChange);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        const mediaQuery = window.matchMedia(`(max-width: ${SYSTEM_METERS_COMPACT_BREAKPOINT_PX}px)`);
        const sync = () => setIsNarrowLayout(Boolean(mediaQuery.matches));
        sync();
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', sync);
            return () => mediaQuery.removeEventListener('change', sync);
        }
        mediaQuery.addListener(sync);
        return () => mediaQuery.removeListener(sync);
    }, []);

    // Only one placement renders at a time: the side bar foot or the status bar.
    // In the workbench the activity bar's Meters toggle switches them off entirely.
    const workbenchPlacement = mode === 'sidebar' || mode === 'statusbar';
    const isActiveInstance = SYSTEM_METERS_ACTIVE_MODES.has(mode) && !(workbenchPlacement && collapsed);

    useEffect(() => {
        if (!isActiveInstance) return undefined;
        let cancelled = false;
        let inFlight = false;

        const refresh = async () => {
            if (cancelled || inFlight) return;
            inFlight = true;
            const current = () => !cancelled;
            setLoading((prev) => (prev || metrics.cpu_series.length > 0 ? prev : true));
            try {
                const next = await getSystemMetrics();
                if (!current()) return;
                setMetrics({
                    cpu_percent: optionalPercent(next?.cpu_percent),
                    ram_percent: optionalPercent(next?.ram_percent),
                    swap_percent: optionalPercent(next?.swap_percent),
                    gpu_busy_percent: optionalPercent(next?.gpu_busy_percent),
                    gpu_busy_series: Array.isArray(next?.gpu_busy_series) ? next.gpu_busy_series.slice(-30).map(optionalPercent) : [],
                    vram_percent: next?.vram_percent !== null && next?.vram_percent !== undefined && Number.isFinite(Number(next.vram_percent)) ? Number(next.vram_percent) : null,
                    cpu_series: clampPercentSeries(next?.cpu_series),
                    ram_series: clampPercentSeries(next?.ram_series),
                    swap_series: clampPercentSeries(next?.swap_series),
                    vram_series: Array.isArray(next?.vram_series) ? next.vram_series.slice(-30).map(optionalPercent) : [],
                    vram_total_bytes: optionalBytes(next?.vram_total_bytes),
                    vram_used_bytes: optionalBytes(next?.vram_used_bytes),
                    gpu_sample_times: Array.isArray(next?.gpu_sample_times) ? next.gpu_sample_times : [],
                    gpu_resident_series: Array.isArray(next?.gpu_resident_series) ? next.gpu_resident_series : [],
                    gpu_provider: typeof next?.gpu_provider === 'string' && next.gpu_provider.trim() ? next.gpu_provider.trim() : null,
                    gpus: Array.isArray(next?.gpus) ? next.gpus : [],
                    buffer_cache_bytes: Number.isFinite(Number(next?.buffer_cache_bytes)) ? Number(next?.buffer_cache_bytes) : null,
                    buffer_cache_series_bytes: sanitizeSeries(next?.buffer_cache_series_bytes),
                    process_rss_series_bytes: sanitizeSeries(next?.process_rss_series_bytes),
                    process_memory: {
                        rss_bytes: Number(next?.process_memory?.rss_bytes) || 0,
                        vm_rss_bytes: Number.isFinite(Number(next?.process_memory?.vm_rss_bytes)) ? Number(next?.process_memory?.vm_rss_bytes) : null,
                    },
                    swap_total_bytes: Number(next?.swap_total_bytes) || 0,
                    swap_used_bytes: Number(next?.swap_used_bytes) || 0,
                    sample_interval_ms: Number(next?.sample_interval_ms) || 2000,
                    platform: String(next?.platform || ''),
                });
                setGpuPollId(value => value + 1);
                const refreshedAt = Date.now();
                setLastSuccessfulRefreshMs(refreshedAt);
                setNowMs(refreshedAt);
            } catch {
                if (!current()) return;
                setGpuPollId(value => value + 1);
                setNowMs(Date.now());
            } finally {
                inFlight = false;
                if (current()) setLoading(false);
            }
        };

        void refresh();
        const stopVisibleInterval = createVisibleInterval(() => { void refresh(); }, SYSTEM_METERS_POLL_MS);

        return () => {
            cancelled = true;
            stopVisibleInterval();
        };
    }, [isActiveInstance]);

    const cpuPath = useMemo(() => buildSparklinePath(metrics.cpu_series, 56, 16, { min: 0, max: 100 }), [metrics.cpu_series]);
    const ramPath = useMemo(() => buildSparklinePath(metrics.ram_series, 56, 16, { min: 0, max: 100 }), [metrics.ram_series]);
    const swapPath = useMemo(() => buildSparklinePath(metrics.swap_series, 56, 16, { min: 0, max: 100 }), [metrics.swap_series]);
    const bufferCachePath = useMemo(() => buildSparklinePath(metrics.buffer_cache_series_bytes), [metrics.buffer_cache_series_bytes]);
    const rssPath = useMemo(() => buildSparklinePath(metrics.process_rss_series_bytes), [metrics.process_rss_series_bytes]);
    const gpuSnapshots = useMemo(() => gpuSnapshotTrackerRef.current.resolve(metrics), [metrics]);
    const gpuMeters = useMemo(
        () => gpuHistoryRef.current.update(gpuSnapshots, { nowMs, pollId: gpuPollId, lastSuccessAtMs: lastSuccessfulRefreshMs }).filter(meter => getGpuMeterRows(meter).length > 0),
        [gpuSnapshots, nowMs, gpuPollId, lastSuccessfulRefreshMs],
    );
    const showBufferCache = Number(metrics.buffer_cache_bytes) > 0 && sanitizeSeries(metrics.buffer_cache_series_bytes).length > 0;
    const showSwap = optionalPercent(metrics.swap_percent) !== null && metrics.swap_total_bytes > 0;
    const currentRssBytes = resolveCurrentRssBytes(metrics);
    const showRss = shouldShowRss(metrics);
    // GPU rows already have their own details buttons; do not duplicate an
    // aggregate VRAM line in the compact system summary.
    const compactSummary = useMemo(() => buildCompactMetersSummary({ ...metrics, vram_percent: null }), [metrics]);
    const handleGpuOpen = (id, trigger) => {
        if (trigger) gpuTriggerRef.current = trigger;
        setOpenGpuId((current) => trigger && current === id ? null : id);
    };

    useEffect(() => { setOpenGpuId(null); }, [isNarrowLayout]);
    useEffect(() => {
        if (openGpuId && (!gpuMeters.some(meter => meter.id === openGpuId) || !gpuTriggerRef.current?.isConnected)) setOpenGpuId(null);
    }, [gpuMeters, openGpuId]);

    if (!isActiveInstance) return null;

    const title = collapsed
        ? 'Show system meters'
        : (loading ? 'Updating system meters… Click to collapse.' : 'System meters — click to collapse.');

    const handleToggleCollapsed = (event) => {
        event?.stopPropagation?.();
        const nextCollapsed = !collapsed;
        setCollapsed(nextCollapsed);
        setOpenGpuId(null);
        applyMetersCollapsed(nextCollapsed);
    };

    return html`
        <div class=${`system-meters-hud system-meters-hud-${mode}${collapsed ? ' is-collapsed' : ''}`} aria-live="polite">
            <div class="system-meters-card" role="group" aria-label="System meters">
                ${collapsed
                    ? html`<button class="system-meters-meter-button system-meters-collapse-tab" type="button" title=${title} aria-label=${title} aria-expanded="false" onClick=${handleToggleCollapsed}>${renderDisclosureTriangle('left')}</button>`
                    : isNarrowLayout
                        ? html`<div class="system-meters-compact-summary">
                            <button class="system-meters-meter-button system-meters-compact-system" type="button" title=${title} aria-label=${title} aria-expanded="true" onClick=${handleToggleCollapsed}>${compactSummary}</button>
                            <${GpuMeterRows} meters=${gpuMeters} compact=${true} openGpuId=${openGpuId} onOpen=${handleGpuOpen} />
                        </div>`
                        : html`
                            ${metrics.cpu_percent !== null && html`<button class="system-meters-meter-button system-meters-row cpu" type="button" aria-label=${title} aria-expanded="true" onClick=${handleToggleCollapsed}>
                                <span class="system-meters-label">CPU</span>
                                <svg class="system-meters-spark" viewBox="0 0 56 16" preserveAspectRatio="none" aria-hidden="true">
                                    <path vector-effect="non-scaling-stroke" d=${cpuPath}></path>
                                </svg>
                                <span class="system-meters-value">${formatPercent(metrics.cpu_percent)}</span>
                            </button>`}
                            ${metrics.ram_percent !== null && html`<button class="system-meters-meter-button system-meters-row ram" type="button" aria-label=${title} aria-expanded="true" onClick=${handleToggleCollapsed}>
                                <span class="system-meters-label">RAM</span>
                                <svg class="system-meters-spark" viewBox="0 0 56 16" preserveAspectRatio="none" aria-hidden="true">
                                    <path vector-effect="non-scaling-stroke" d=${ramPath}></path>
                                </svg>
                                <span class="system-meters-value">${formatPercent(metrics.ram_percent)}</span>
                            </button>`}
                            ${showRss && html`
                                <button class="system-meters-meter-button system-meters-row rss" type="button" aria-label=${title} aria-expanded="true" onClick=${handleToggleCollapsed}>
                                    <span class="system-meters-label">RSS</span>
                                    <svg class="system-meters-spark" viewBox="0 0 56 16" preserveAspectRatio="none" aria-hidden="true">
                                        <path vector-effect="non-scaling-stroke" d=${rssPath}></path>
                                    </svg>
                                    <span class="system-meters-value">${formatBytesCompact(currentRssBytes)}</span>
                                </button>
                            `}
                            ${gpuMeters.length > 0 && html`<${GpuMeterRows} meters=${gpuMeters} openGpuId=${openGpuId} onOpen=${handleGpuOpen} />`}
                            ${showBufferCache && html`
                                <button class="system-meters-meter-button system-meters-row buf" type="button" aria-label=${title} aria-expanded="true" onClick=${handleToggleCollapsed}>
                                    <span class="system-meters-label">BUF</span>
                                    <svg class="system-meters-spark" viewBox="0 0 56 16" preserveAspectRatio="none" aria-hidden="true">
                                        <path vector-effect="non-scaling-stroke" d=${bufferCachePath}></path>
                                    </svg>
                                    <span class="system-meters-value">${formatBytesCompact(metrics.buffer_cache_bytes)}</span>
                                </button>
                            `}
                            ${showSwap && html`
                                <button class="system-meters-meter-button system-meters-row swap" type="button" aria-label=${title} aria-expanded="true" onClick=${handleToggleCollapsed}>
                                    <span class="system-meters-label">SWP</span>
                                    <svg class="system-meters-spark" viewBox="0 0 56 16" preserveAspectRatio="none" aria-hidden="true">
                                        <path vector-effect="non-scaling-stroke" d=${swapPath}></path>
                                    </svg>
                                    <span class="system-meters-value">${formatPercent(metrics.swap_percent)}</span>
                                </button>
                            `}
                        `}
            </div>
            ${!collapsed && gpuMeters.length > 0 && html`<${GpuDetailsPopover} meters=${gpuMeters} openGpuId=${openGpuId} onOpen=${handleGpuOpen} triggerRef=${gpuTriggerRef} />`}
        </div>
    `;
}
