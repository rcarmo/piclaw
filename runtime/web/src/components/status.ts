// @ts-nocheck
import { html, useCallback, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { addToWhitelist, getWorkspaceBranch, respondToAgentRequest } from '../api.js';
import { renderThinkingMarkdown } from '../markdown.js';
import { getTurnColor } from '../ui/agent-utils.js';
import { buildTurnDotClass, resolveRunningStatusIndicator, shouldShowRunningStatusDot } from '../ui/status-dot.js';
import { getStatusElapsedLabel, getStatusRetryCountdownLabel, isCompactionStatus, parseStatusLastEventAt, parseStatusStartedAt, resolveStatusPanelTitle } from '../ui/status-duration.js';
import { extractToolContextPath } from '../ui/tool-git-context.js';
import { useConnectionStatusPresentation } from '../ui/connection-status.js';

const COPY_ICON_SVG = html`
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="9" y="9" width="10" height="10" rx="2"></rect>
        <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"></path>
    </svg>
`;

const GIT_BRANCH_ICON_SVG = html`
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <path d="M6 3v12"></path>
        <circle cx="18" cy="6" r="3"></circle>
        <circle cx="6" cy="18" r="3"></circle>
        <path d="M18 9a9 9 0 0 1-9 9"></path>
    </svg>
`;

const CLOCK_ICON_SVG = html`
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 7v5l3 2"></path>
    </svg>
`;

const STATUS_TIME_HINT_THRESHOLD_MS = 10_000;

export function normalizeStatusHints(value) {
    const source = Array.isArray(value)
        ? value
        : (value && Array.isArray(value.status_hints) ? value.status_hints : []);
    return source
        .filter((hint) => hint && typeof hint === 'object')
        .map((hint, index) => ({
            key: typeof hint.key === 'string' && hint.key.trim() ? hint.key.trim() : `hint-${index}`,
            iconSvg: typeof hint.icon_svg === 'string' ? hint.icon_svg.trim() : '',
            label: typeof hint.label === 'string' ? hint.label.trim() : '',
            title: typeof hint.title === 'string' ? hint.title.trim() : '',
        }))
        .filter((hint) => hint.iconSvg && hint.label);
}

export function resolveAgentStatusEscapeCollapseKey(expandedPanels) {
    if (!(expandedPanels instanceof Set) || expandedPanels.size === 0) return null;
    const keys = Array.from(expandedPanels.values());
    for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        if (key === 'thought' || key === 'draft') return key;
    }
    return null;
}

export function orderAgentStatusHints(statusHints) {
    if (!Array.isArray(statusHints) || statusHints.length === 0) return [];
    const priority = new Map([
        ['ssh', 0],
    ]);
    return statusHints
        .map((hint, index) => ({ hint, index }))
        .sort((left, right) => {
            const leftPriority = priority.get(left.hint?.key) ?? 100;
            const rightPriority = priority.get(right.hint?.key) ?? 100;
            if (leftPriority !== rightPriority) return leftPriority - rightPriority;
            return left.index - right.index;
        })
        .map((entry) => entry.hint);
}

export function formatAgentStatusGitLabel(repoPath, branch) {
    const normalizedRepoPath = typeof repoPath === 'string' ? repoPath.trim() : '';
    const normalizedBranch = typeof branch === 'string' ? branch.trim() : '';
    const repoName = normalizedRepoPath
        ? normalizedRepoPath.split(/[\\/]+/).filter(Boolean).pop() || normalizedRepoPath
        : '';
    return [repoName, normalizedBranch].filter(Boolean).join(' • ');
}

export function shouldTickStatusActivityAge(status) {
    if (!status || typeof status !== 'object') return false;
    const type = typeof status.type === 'string' ? status.type : '';
    const isLastActivity = Boolean(status.last_activity || status.lastActivity);
    const isToolStatus = type === 'tool_call' || type === 'tool_status' || Boolean(status.tool_name || status.tool_args);
    if (!isLastActivity && !isToolStatus) return false;
    return parseStatusLastEventAt(status) !== null;
}

export function shouldTickIntentElapsed(status) {
    if (!status || typeof status !== 'object') return false;
    return status.type === 'intent' && parseStatusStartedAt(status) !== null;
}

function hasMetStatusTimeHintThreshold(timestampMs, nowMs = Date.now()) {
    if (!Number.isFinite(timestampMs)) return false;
    return nowMs - timestampMs >= STATUS_TIME_HINT_THRESHOLD_MS;
}

export function resolveStatusActivityAgeLabel(status, nowMs = Date.now()) {
    if (!shouldTickStatusActivityAge(status)) return null;
    const lastEventAtMs = parseStatusLastEventAt(status);
    if (lastEventAtMs === null || !hasMetStatusTimeHintThreshold(lastEventAtMs, nowMs)) return null;
    const ageLabel = formatElapsed(new Date(lastEventAtMs).toISOString(), nowMs);
    return ageLabel ? `${ageLabel} ago` : null;
}

export function resolveIntentElapsedLabel(status, nowMs = Date.now()) {
    if (!shouldTickIntentElapsed(status)) return null;
    const startedAtMs = parseStatusStartedAt(status);
    if (startedAtMs === null) return null;
    return getStatusElapsedLabel(status, nowMs);
}

export function resolveAgentStatusContent(status, options = {}) {
    const isLastActivity = options?.isLastActivity ?? Boolean(status?.last_activity || status?.lastActivity);
    const title = status?.title;
    const statusText = status?.status;
    let content = '';
    if (status?.type === 'plan') {
        content = title ? `Planning: ${title}` : 'Planning...';
    } else if (status?.type === 'tool_call') {
        content = title ? `Running: ${title}` : 'Running tool...';
    } else if (status?.type === 'tool_status') {
        content = title ? `${title}: ${statusText || 'Working...'}` : (statusText || 'Working...');
    } else if (status?.type === 'error') {
        content = title || 'Agent error';
    } else {
        content = title || statusText || 'Working...';
    }
    if (!isLastActivity) return content;
    if (content && content !== 'Working...') {
        return `Recent activity: ${content}`;
    }
    return 'Last activity';
}

/** Preact component: agent status bar with draft/thought/plan panels. */
function formatElapsed(isoString, nowMs = Date.now()) {
    if (!isoString) return null;
    const ms = nowMs - new Date(isoString).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

export function AgentStatus({ status, draft, plan, thought, pendingRequest, intent, extensionPanels = [], pendingPanelActions = new Set(), onExtensionPanelAction, turnId, steerQueued, onPanelToggle, showCorePanels = true, showExtensionPanels = true }) {
    const THOUGHT_MAX_LINES = 8;
    const DRAFT_MAX_LINES = 8;

    const normalizePreview = (value) => {
        if (!value) return { text: '', totalLines: 0, fullText: '' };
        if (typeof value === 'string') {
            const text = value;
            const totalLines = text ? text.replace(/\r\n/g, '\n').split('\n').length : 0;
            return { text, totalLines, fullText: text };
        }
        const text = value.text || '';
        const fullText = value.fullText || value.full_text || text;
        const totalLines = Number.isFinite(value.totalLines)
            ? value.totalLines
            : (fullText ? fullText.replace(/\r\n/g, '\n').split('\n').length : 0);
        return { text, totalLines, fullText };
    };

    const PREVIEW_MAX_CHARS_PER_LINE = 160;

    const stripInternalTags = (value) => String(value || '').replace(/<\/?internal>/gi, '');

    const countSoftLines = (line) => {
        if (!line) return 1;
        return Math.max(1, Math.ceil(line.length / PREVIEW_MAX_CHARS_PER_LINE));
    };

    const truncateLines = (text, maxLines, totalLinesOverride) => {
        const value = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (!value) {
            const totalLines = Number.isFinite(totalLinesOverride) ? totalLinesOverride : 0;
            return { text: '', omitted: 0, totalLines, visibleLines: 0 };
        }
        const lines = value.split('\n');
        const clipped = lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : value;
        const totalLines = Number.isFinite(totalLinesOverride) ? totalLinesOverride : lines.reduce((acc, line) => acc + countSoftLines(line), 0);
        const visibleLines = clipped
            ? clipped.split('\n').reduce((acc, line) => acc + countSoftLines(line), 0)
            : 0;
        const omitted = Math.max(totalLines - visibleLines, 0);
        return { text: clipped, omitted, totalLines, visibleLines };
    };

    const planInfo = normalizePreview(plan);
    const thoughtInfo = normalizePreview(thought);
    const draftInfo = normalizePreview(draft);
    const hasPlan = Boolean(planInfo.text) || planInfo.totalLines > 0;
    const hasThought = Boolean(thoughtInfo.text) || thoughtInfo.totalLines > 0;
    const hasDraft = Boolean(draftInfo.fullText?.trim() || draftInfo.text?.trim());

    const hasCorePanels = Boolean(status || hasDraft || hasPlan || hasThought || pendingRequest || intent);
    const hasExtensionPanels = Array.isArray(extensionPanels) && extensionPanels.length > 0;

    const [expandedPanels, setExpandedPanels] = useState(new Set());
    const [hoveredSeriesPoint, setHoveredSeriesPoint] = useState(null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const toggleExpand = (key) =>
        setExpandedPanels(prev => {
            const next = new Set(prev);
            const willExpand = !next.has(key);
            if (willExpand) next.add(key); else next.delete(key);
            if (typeof onPanelToggle === 'function') {
                onPanelToggle(key, willExpand);
            }
            return next;
        });

    // Collapse all panels when a new turn begins
    useEffect(() => {
        setExpandedPanels(new Set());
        setHoveredSeriesPoint(null);
    }, [turnId]);

    // Tick nowMs every second when visible extension panels expose timestamps.
    useEffect(() => {
        const hasVisibleTimestampPanel = Array.isArray(extensionPanels) && extensionPanels.some(
            (p) => p?.started_at || p?.last_activity_at,
        );
        if (!hasVisibleTimestampPanel) return;
        const interval = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(interval);
    }, [extensionPanels]);

    const escapeCollapseKey = useMemo(
        () => resolveAgentStatusEscapeCollapseKey(expandedPanels),
        [expandedPanels],
    );

    useEffect(() => {
        if (!escapeCollapseKey || typeof document === 'undefined') return undefined;

        const handleKeyDown = (event) => {
            if (event?.defaultPrevented) return;
            if (event?.key !== 'Escape') return;
            if (event?.altKey || event?.ctrlKey || event?.metaKey || event?.shiftKey) return;

            const target = event?.target;
            if (target instanceof Element) {
                if (target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
                if (target.isContentEditable) return;
            }

            setExpandedPanels((prev) => {
                if (!(prev instanceof Set) || !prev.has(escapeCollapseKey)) return prev;
                const next = new Set(prev);
                next.delete(escapeCollapseKey);
                return next;
            });
            if (typeof onPanelToggle === 'function') {
                onPanelToggle(escapeCollapseKey, false);
            }
            event.preventDefault?.();
            event.stopPropagation?.();
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [escapeCollapseKey, onPanelToggle]);

    const statusIsCompaction = isCompactionStatus(status);
    const isLastActivity = Boolean(status?.last_activity || status?.lastActivity);
    const shouldTickActivityAge = useMemo(
        () => shouldTickStatusActivityAge(status),
        [status],
    );
    const shouldTickIntentAge = useMemo(
        () => shouldTickIntentElapsed(status),
        [status],
    );
    const toolContextPath = useMemo(
        () => extractToolContextPath(status?.tool_name, status?.tool_args),
        [status?.tool_name, status?.tool_args],
    );
    const [toolRepoContext, setToolRepoContext] = useState(null);
    useEffect(() => {
        const shouldTick = Boolean(
            shouldTickIntentAge
            || status?.retry_at
            || status?.retryAt
            || shouldTickActivityAge,
        );
        if (!shouldTick) return;
        setNowMs(Date.now());
        const timer = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [shouldTickActivityAge, shouldTickIntentAge, status?.retry_at, status?.retryAt, status?.last_event_at, status?.lastEventAt, status?.started_at, status?.startedAt, status?.type, status?.tool_name, status?.tool_args]);

    useEffect(() => {
        const isToolStatus = status?.type === 'tool_call' || status?.type === 'tool_status';
        if (!isToolStatus || !toolContextPath) {
            setToolRepoContext(null);
            return undefined;
        }

        let active = true;
        getWorkspaceBranch(toolContextPath)
            .then((payload) => {
                if (!active) return;
                if (payload?.branch) {
                    setToolRepoContext({
                        branch: payload.branch,
                        repoPath: payload.repo_path || null,
                        path: toolContextPath,
                    });
                } else {
                    setToolRepoContext(null);
                }
            })
            .catch(() => {
                if (active) setToolRepoContext(null);
            });

        return () => {
            active = false;
        };
    }, [status?.type, toolContextPath]);

    const activeTurn = status?.turn_id || turnId;
    const turnColor = getTurnColor(activeTurn);
    const dotClass = buildTurnDotClass({ steerQueued });
    const panelTitle = (label) => label;
    const showRunningStatusDot = shouldShowRunningStatusDot(status, { isLastActivity });
    const runningIndicatorMode = resolveRunningStatusIndicator(status, { isLastActivity });
    const pendingIndicatorMode = resolveRunningStatusIndicator(null, { pendingRequest: true });
    const resolveIntentColor = (kind) => kind === 'warning'
        ? '#f59e0b'
        : kind === 'error'
            ? 'var(--danger-color)'
            : kind === 'success'
                ? 'var(--success-color)'
                : turnColor;
    const intentKind = intent?.kind || 'info';
    const intentColor = resolveIntentColor(intentKind);
    const statusIntentColor = resolveIntentColor(status?.kind || (statusIsCompaction ? 'warning' : 'info'));

    const content = resolveAgentStatusContent(status, { isLastActivity });
    const statusActivityAgeLabel = resolveStatusActivityAgeLabel(status, nowMs);

    const toolRepoRepoPath = toolRepoContext?.repoPath || '';
    const toolRepoBranch = toolRepoContext?.branch || '';
    const toolRepoLabel = toolRepoContext
        ? formatAgentStatusGitLabel(toolRepoRepoPath, toolRepoBranch)
        : '';
    const statusHints = normalizeStatusHints(status?.status_hints || status?.statusHints);
    const orderedStatusHints = useMemo(
        () => orderAgentStatusHints(statusHints),
        [statusHints],
    );
    const leadingStatusHints = useMemo(
        () => orderedStatusHints.filter((hint) => hint?.key === 'ssh'),
        [orderedStatusHints],
    );
    const trailingStatusHints = useMemo(
        () => orderedStatusHints.filter((hint) => hint?.key !== 'ssh'),
        [orderedStatusHints],
    );
    if ((!showCorePanels || !hasCorePanels) && (!showExtensionPanels || !hasExtensionPanels)) return null;

    const renderThinkingPanel = ({ panelTitle, text, fullText, totalLines, maxLines, titleClass, panelKey }) => {
        const isExpanded = expandedPanels.has(panelKey);
        const rawSourceText = fullText || text || '';
        const sourceText = panelKey === 'thought' || panelKey === 'draft'
            ? stripInternalTags(rawSourceText)
            : rawSourceText;
        const isCollapsible = typeof maxLines === 'number';
        const showClose = isExpanded && isCollapsible;
        const truncated = isCollapsible
            ? truncateLines(sourceText, maxLines, totalLines)
            : { text: sourceText || '', omitted: 0, totalLines: Number.isFinite(totalLines) ? totalLines : 0 };
        if (!sourceText && !(Number.isFinite(truncated.totalLines) && truncated.totalLines > 0)) return null;
        const bodyClass = `agent-thinking-body${isCollapsible ? ' agent-thinking-body-collapsible' : ''}`;
        const bodyStyle = isCollapsible ? `--agent-thinking-collapsed-lines: ${maxLines};` : '';
        return html`
            <div
                class="agent-thinking"
                data-expanded=${isExpanded ? 'true' : 'false'}
                data-collapsible=${isCollapsible ? 'true' : 'false'}
                style=${turnColor ? `--turn-color: ${turnColor};` : ''}
            >
                <div class="agent-thinking-title ${titleClass || ''}">
                    ${turnColor && html`<span class=${dotClass} aria-hidden="true"></span>`}
                    ${panelTitle}
                    ${showClose && html`
                        <button
                            class="agent-thinking-close"
                            aria-label=${`Close ${panelTitle} panel`}
                            onClick=${() => toggleExpand(panelKey)}
                        >
                            ×
                        </button>
                    `}
                </div>
                <div
                    class=${bodyClass}
                    style=${bodyStyle}
                    dangerouslySetInnerHTML=${{ __html: renderThinkingMarkdown(sourceText) }}
                />
                ${!isExpanded && truncated.omitted > 0 && html`
                    <button class="agent-thinking-truncation" onClick=${() => toggleExpand(panelKey)}>
                        ▸ ${truncated.omitted} more lines
                    </button>
                `}
                ${isExpanded && truncated.omitted > 0 && html`
                    <button class="agent-thinking-truncation" onClick=${() => toggleExpand(panelKey)}>
                        ▴ show less
                    </button>
                `}
            </div>
        `;
    };

    const pendingTitle = pendingRequest?.tool_call?.title;
    const pendingMessage = pendingTitle ? `Awaiting approval: ${pendingTitle}` : 'Awaiting approval';
    const statusIntentElapsedLabel = resolveIntentElapsedLabel(status, nowMs);
    const renderIntentPanel = (payload, color, elapsedLabel = null) => {
        const titleText = resolveStatusPanelTitle(payload);
        const retryCountdownLabel = getStatusRetryCountdownLabel(payload, nowMs);
        const metaLabel = [elapsedLabel, retryCountdownLabel].filter(Boolean).join(' · ');
        const pulsingDotClass = buildTurnDotClass({
            steerQueued,
            pulsing: isCompactionStatus(payload) || Boolean(retryCountdownLabel),
        });

        return html`
            <div
                class="agent-thinking agent-thinking-intent"
                aria-live="polite"
                style=${color ? `--turn-color: ${color};` : ''}
                title=${payload?.detail || ''}
            >
                <div class="agent-thinking-title intent">
                    ${color && html`<span class=${pulsingDotClass} aria-hidden="true"></span>`}
                    <span class="agent-thinking-title-text">${titleText}</span>
                    ${metaLabel && html`<span class="agent-status-elapsed">${metaLabel}</span>`}
                </div>
                ${payload.detail && html`<div class="agent-thinking-body">${payload.detail}</div>`}
            </div>
        `;
    };

    const projectSeriesPoint = (point, width, height, minValue, maxValue, minRun, maxRun, paddingX = 8, paddingY = 8) => {
        const range = Math.max(maxValue - minValue, 1e-9);
        const innerWidth = Math.max(width - (paddingX * 2), 1);
        const innerHeight = Math.max(height - (paddingY * 2), 1);
        const runSpan = Math.max(maxRun - minRun, 1);
        const x = maxRun === minRun
            ? width / 2
            : paddingX + (((point.run - minRun) / runSpan) * innerWidth);
        const y = paddingY + (innerHeight - (((point.value - minValue) / range) * innerHeight));
        return { x, y };
    };

    const buildLinePath = (points, width, height, minValue, maxValue, minRun, maxRun, paddingX = 8, paddingY = 8) => {
        if (!Array.isArray(points) || points.length === 0) return '';
        return points.map((point, index) => {
            const { x, y } = projectSeriesPoint(point, width, height, minValue, maxValue, minRun, maxRun, paddingX, paddingY);
            return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
        }).join(' ');
    };

    const formatMetricValue = (value, unit = '') => {
        if (!Number.isFinite(value)) return '—';
        const rounded = Math.abs(value) >= 100
            ? value.toFixed(0)
            : value.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
        return `${rounded}${unit}`;
    };

    const SERIES_COLOR_ANCHORS = [
        'var(--accent-color)',
        'var(--success-color)',
        'var(--warning-color, #f59e0b)',
        'var(--danger-color)',
    ];

    const resolveSeriesColor = (index, total) => {
        const anchors = SERIES_COLOR_ANCHORS;
        if (!Array.isArray(anchors) || anchors.length === 0) return 'var(--accent-color)';
        if (anchors.length === 1 || !Number.isFinite(total) || total <= 1) return anchors[0];
        const clampedIndex = Math.max(0, Math.min(Number.isFinite(index) ? index : 0, total - 1));
        const scaled = (clampedIndex / Math.max(1, total - 1)) * (anchors.length - 1);
        const leftIndex = Math.floor(scaled);
        const rightIndex = Math.min(anchors.length - 1, leftIndex + 1);
        const mixRatio = scaled - leftIndex;
        const left = anchors[leftIndex];
        const right = anchors[rightIndex];
        if (!right || leftIndex === rightIndex || mixRatio <= 0.001) return left;
        if (mixRatio >= 0.999) return right;
        const leftWeight = Math.round((1 - mixRatio) * 1000) / 10;
        const rightWeight = Math.round(mixRatio * 1000) / 10;
        return `color-mix(in oklab, ${left} ${leftWeight}%, ${right} ${rightWeight}%)`;
    };

    const renderCombinedSeriesChart = (seriesList, panelKey = 'autoresearch') => {
        const prepared = Array.isArray(seriesList)
            ? seriesList
                .map((series) => ({
                    ...series,
                    points: Array.isArray(series?.points)
                        ? series.points.filter((point) => Number.isFinite(point?.value) && Number.isFinite(point?.run))
                        : [],
                }))
                .filter((series) => series.points.length > 0)
            : [];
        const normalized = prepared.map((series, index) => ({
            ...series,
            color: resolveSeriesColor(index, prepared.length),
        }));
        if (normalized.length === 0) return null;

        const width = 320;
        const height = 120;
        const allPoints = normalized.flatMap((series) => series.points);
        const values = allPoints.map((point) => point.value);
        const runs = allPoints.map((point) => point.run);
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        const minRun = Math.min(...runs);
        const maxRun = Math.max(...runs);

        return html`
            <div class="agent-series-chart agent-series-chart-combined">
                <div class="agent-series-chart-header">
                    <span class="agent-series-chart-title">Tracked variables</span>
                    <span class="agent-series-chart-value">${normalized.length} series</span>
                </div>
                <div class="agent-series-chart-plot">
                    <svg class="agent-series-chart-svg" viewBox=${`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
                        ${normalized.map((series) => {
                            const seriesKey = series?.key || series?.label || 'series';
                            const lineHovered = hoveredSeriesPoint?.panelKey === panelKey && hoveredSeriesPoint?.seriesKey === seriesKey;
                            return html`
                                <g key=${seriesKey}>
                                    <path
                                        class=${`agent-series-chart-line${lineHovered ? ' is-hovered' : ''}`}
                                        d=${buildLinePath(series.points, width, height, minValue, maxValue, minRun, maxRun)}
                                        style=${`--agent-series-color: ${series.color};`}
                                        onMouseEnter=${() => setHoveredSeriesPoint({ panelKey, seriesKey })}
                                        onMouseLeave=${() => setHoveredSeriesPoint((prev) => prev?.panelKey === panelKey && prev?.seriesKey === seriesKey ? null : prev)}
                                    ></path>
                                </g>
                            `;
                        })}
                    </svg>
                    <div class="agent-series-chart-points-layer">
                        ${normalized.flatMap((series) => {
                            const unit = typeof series?.unit === 'string' ? series.unit : '';
                            const seriesKey = series?.key || series?.label || 'series';
                            return series.points.map((point, pointIndex) => {
                                const projected = projectSeriesPoint(point, width, height, minValue, maxValue, minRun, maxRun);
                                return html`
                                    <button
                                        key=${`${seriesKey}-point-${pointIndex}`}
                                        type="button"
                                        class="agent-series-chart-point-hit"
                                        style=${`--agent-series-color: ${series.color}; left:${(projected.x / width) * 100}%; top:${(projected.y / height) * 100}%;`}
                                        onMouseEnter=${() => setHoveredSeriesPoint({
                                            panelKey,
                                            seriesKey,
                                            run: point.run,
                                            value: point.value,
                                            unit,
                                        })}
                                        onMouseLeave=${() => setHoveredSeriesPoint((prev) => prev?.panelKey === panelKey ? null : prev)}
                                        onFocus=${() => setHoveredSeriesPoint({
                                            panelKey,
                                            seriesKey,
                                            run: point.run,
                                            value: point.value,
                                            unit,
                                        })}
                                        onBlur=${() => setHoveredSeriesPoint((prev) => prev?.panelKey === panelKey ? null : prev)}
                                        aria-label=${`${series?.label || 'Series'} ${formatMetricValue(point.value, unit)} at run ${point.run}`}
                                    >
                                        <span class="agent-series-chart-point"></span>
                                    </button>
                                `;
                            });
                        })}
                    </div>
                </div>
                <div class="agent-series-legend">
                    ${normalized.map((series) => {
                        const latest = series.points[series.points.length - 1]?.value;
                        const unit = typeof series?.unit === 'string' ? series.unit : '';
                        const seriesKey = series?.key || series?.label || 'series';
                        const hovered = hoveredSeriesPoint?.panelKey === panelKey && hoveredSeriesPoint?.seriesKey === seriesKey
                            ? hoveredSeriesPoint
                            : null;
                        const hoveredValue = hovered && Number.isFinite(hovered.value) ? hovered.value : latest;
                        const hoveredUnit = hovered && typeof hovered.unit === 'string' ? hovered.unit : unit;
                        const hoveredRun = hovered && Number.isFinite(hovered.run) ? hovered.run : null;
                        return html`
                            <div key=${`${seriesKey}-legend`} class=${`agent-series-legend-item${hovered ? ' is-hovered' : ''}`} style=${`--agent-series-color: ${series.color};`}>
                                <span class="agent-series-legend-swatch" style=${`--agent-series-color: ${series.color};`}></span>
                                <span class="agent-series-legend-label">${series?.label || 'Series'}</span>
                                ${hoveredRun !== null && html`<span class="agent-series-legend-run">run ${hoveredRun}</span>`}
                                <span class="agent-series-legend-value">${formatMetricValue(hoveredValue, hoveredUnit)}</span>
                            </div>
                        `;
                    })}
                </div>
            </div>
        `;
    };

    const renderExtensionPanel = (panel) => {
        if (!panel) return null;
        const panelKey = typeof panel?.key === 'string' ? panel.key : `panel-${Math.random()}`;
        const isExpanded = expandedPanels.has(panelKey);
        const titleText = panel?.title || 'Extension status';
        const collapsedText = panel?.collapsed_text || '';
        const stateLabel = String(panel?.state || '').replace(/[-_]+/g, ' ').replace(/^./, (match) => match.toUpperCase());
        const color = resolveIntentColor(
            panel?.state === 'completed'
                ? 'success'
                : panel?.state === 'failed'
                    ? 'error'
                    : panel?.state === 'stopped'
                        ? 'warning'
                        : 'info'
        );
        const panelDotClass = buildTurnDotClass({
            steerQueued,
            pulsing: panel?.state === 'running',
        });
        const detailText = typeof panel?.detail_markdown === 'string' ? panel.detail_markdown.trim() : '';
        const lastRunText = typeof panel?.last_run_text === 'string' ? panel.last_run_text.trim() : '';
        const tmuxCommand = typeof panel?.tmux_command === 'string' ? panel.tmux_command.trim() : '';
        const series = Array.isArray(panel?.series) ? panel.series : [];
        const actions = Array.isArray(panel?.actions) ? panel.actions : [];

        const experimentElapsed = panel?.started_at
            ? getStatusElapsedLabel(panel, nowMs)
            : null;
        const displayCollapsed = collapsedText;

        const hasDetailColumn = Boolean(detailText || tmuxCommand || experimentElapsed);
        const isExpandable = Boolean(detailText || series.length > 0 || tmuxCommand);
        const collapsedTooltip = [titleText, displayCollapsed].filter(Boolean).join(' — ');

        return html`
            <div
                class="agent-thinking agent-thinking-intent agent-thinking-autoresearch"
                aria-live="polite"
                data-expanded=${isExpanded ? 'true' : 'false'}
                style=${color ? `--turn-color: ${color};` : ''}
                title=${!isExpanded ? (collapsedTooltip || titleText) : ''}
            >
                <div class="agent-thinking-header agent-thinking-header-inline">
                    <button
                        class="agent-thinking-title intent agent-thinking-title-clickable"
                        type="button"
                        onClick=${() => (isExpandable ? toggleExpand(panelKey) : null)}
                    >
                        ${color && html`<span class=${panelDotClass} aria-hidden="true"></span>`}
                        <span class="agent-thinking-title-text">${titleText}</span>
                        ${displayCollapsed && html`<span class="agent-thinking-title-meta">${displayCollapsed}</span>`}
                        ${experimentElapsed && html`<span class="agent-status-elapsed">${experimentElapsed}</span>`}
                    </button>
                    ${(actions.length > 0 || isExpandable) && html`
                        <div class="agent-thinking-tools-inline">
                            ${actions.length > 0 && html`
                                <div class="agent-thinking-actions agent-thinking-actions-inline">
                                    ${actions.map((action) => {
                                        const pendingKey = `${panelKey}:${action?.key || ''}`;
                                        const pending = pendingPanelActions?.has?.(pendingKey);
                                        return html`
                                            <button
                                                key=${pendingKey}
                                                class=${`agent-thinking-action-btn${action?.tone === 'danger' ? ' danger' : ''}`}
                                                onClick=${() => onExtensionPanelAction?.(panel, action)}
                                                disabled=${Boolean(pending)}
                                            >
                                                ${pending ? 'Working…' : (action?.label || 'Run')}
                                            </button>
                                        `;
                                    })}
                                </div>
                            `}
                            ${isExpandable && html`
                                <button
                                    class="agent-thinking-corner-toggle agent-thinking-corner-toggle-inline"
                                    type="button"
                                    aria-label=${`${isExpanded ? 'Collapse' : 'Expand'} ${titleText}`}
                                    title=${isExpanded ? 'Collapse details' : 'Expand details'}
                                    onClick=${() => toggleExpand(panelKey)}
                                >
                                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        ${isExpanded
                                            ? html`<polyline points="4 6 8 10 12 6"></polyline>`
                                            : html`<polyline points="4 10 8 6 12 10"></polyline>`}
                                    </svg>
                                </button>
                            `}
                        </div>
                    `}
                </div>
                ${isExpanded && html`
                    <div class=${`agent-thinking-autoresearch-layout${hasDetailColumn ? '' : ' chart-only'}`}>
                        ${hasDetailColumn && html`
                            <div class="agent-thinking-autoresearch-meta-stack">
                                ${experimentElapsed && html`
                                    <div class="agent-thinking-autoresearch-elapsed">
                                        <span title="Experiment duration">⏱ ${experimentElapsed}</span>
                                        ${panel?.last_activity_at && panel?.state === 'running' && html`<span title="Since last activity">⟳ ${formatElapsed(panel.last_activity_at)} ago</span>`}
                                    </div>
                                `}
                                ${detailText && html`
                                    <div
                                        class="agent-thinking-body agent-thinking-autoresearch-detail"
                                        dangerouslySetInnerHTML=${{ __html: renderThinkingMarkdown(detailText) }}
                                    />
                                `}
                                ${tmuxCommand && html`
                                    <div class="agent-series-chart-command">
                                        <div class="agent-series-chart-command-header">
                                            <span>Attach to session</span>
                                        </div>
                                        <div class="agent-series-chart-command-shell">
                                            <pre class="agent-series-chart-command-code">${tmuxCommand}</pre>
                                            <button
                                                type="button"
                                                class="agent-series-chart-command-copy"
                                                aria-label="Copy tmux command"
                                                title="Copy tmux command"
                                                onClick=${() => onExtensionPanelAction?.(panel, { key: 'copy_tmux', action_type: 'autoresearch.copy_tmux', label: 'Copy tmux' })}
                                            >
                                                ${COPY_ICON_SVG}
                                            </button>
                                        </div>
                                    </div>
                                `}
                            </div>
                        `}
                        ${series.length > 0
                            ? html`
                                <div class="agent-series-chart-stack">
                                    ${renderCombinedSeriesChart(series, panelKey)}
                                    ${lastRunText && html`<div class="agent-series-chart-note">${lastRunText}</div>`}
                                </div>
                            `
                            : html`<div class="agent-thinking-body agent-thinking-autoresearch-summary">Variable history will appear after the first completed run.</div>`}
                    </div>
                `}
            </div>
        `;
    };

    return html`
        <div class="agent-status-panel">
            ${showCorePanels && intent && renderIntentPanel(intent, intentColor)}
            ${showExtensionPanels && Array.isArray(extensionPanels) && extensionPanels.map((panel) => renderExtensionPanel(panel))}
            ${showCorePanels && status?.type === 'intent' && renderIntentPanel(status, statusIntentColor, statusIntentElapsedLabel)}
            ${showCorePanels && pendingRequest && html`
                <div class="agent-status agent-status-request" aria-live="polite" style=${turnColor ? `--turn-color: ${turnColor};` : ''}>
                    ${pendingIndicatorMode === 'dot' && html`<span class=${dotClass} aria-hidden="true"></span>`}
                    ${pendingIndicatorMode === 'spinner' && html`<div class="agent-status-spinner"></div>`}
                    <span class="agent-status-text">${pendingMessage}</span>
                </div>
            `}
            ${showCorePanels && hasPlan && renderThinkingPanel({
                panelTitle: panelTitle('Planning'),
                text: planInfo.text,
                fullText: planInfo.fullText,
                totalLines: planInfo.totalLines,
                panelKey: 'plan',
            })}
            ${showCorePanels && hasDraft && renderThinkingPanel({
                panelTitle: panelTitle('Draft'),
                text: draftInfo.text,
                fullText: draftInfo.fullText,
                totalLines: draftInfo.totalLines,
                maxLines: DRAFT_MAX_LINES,
                titleClass: 'thought',
                panelKey: 'draft',
            })}
            ${showCorePanels && hasThought && renderThinkingPanel({
                panelTitle: panelTitle('Thoughts'),
                text: thoughtInfo.text,
                fullText: thoughtInfo.fullText,
                totalLines: thoughtInfo.totalLines,
                maxLines: THOUGHT_MAX_LINES,
                titleClass: 'thought',
                panelKey: 'thought',
            })}
            ${showCorePanels && status && status?.type !== 'intent' && html`
                <div class=${`agent-status${isLastActivity ? ' agent-status-last-activity' : ''}${status?.type === 'error' ? ' agent-status-error' : ''}${toolRepoLabel || statusHints.length > 0 || statusActivityAgeLabel ? ' agent-status-multiline' : ''}`} aria-live="polite" style=${turnColor ? `--turn-color: ${turnColor};` : ''}>
                    ${turnColor && showRunningStatusDot && html`<span class=${dotClass} aria-hidden="true"></span>`}
                    ${status?.type === 'error'
                        ? html`<span class="agent-status-error-icon" aria-hidden="true">⚠</span>`
                        : (runningIndicatorMode === 'spinner' && html`<div class="agent-status-spinner"></div>`)}
                    <div class="agent-status-copy">
                        <span class="agent-status-text">${content}</span>
                        ${(toolRepoLabel || orderedStatusHints.length > 0 || statusActivityAgeLabel) && html`
                            <span class="agent-status-meta-row">
                                ${leadingStatusHints.map((hint) => html`
                                    <span key=${hint.key} class="agent-status-hint-row" title=${hint.title || hint.label}>
                                        <span class="agent-status-hint-icon" dangerouslySetInnerHTML=${{ __html: hint.iconSvg }}></span>
                                        <span class="agent-status-hint-label">${hint.label}</span>
                                    </span>
                                `)}
                                ${toolRepoLabel && html`
                                    <span class="agent-status-git-row" title=${toolContextPath || toolRepoLabel}>
                                        <span class="agent-status-git-icon">${GIT_BRANCH_ICON_SVG}</span>
                                        <span class="agent-status-git-label">
                                            ${toolRepoRepoPath && html`<span class="agent-status-git-part">${toolRepoRepoPath}</span>`}
                                            ${toolRepoRepoPath && toolRepoBranch && html`<span class="agent-status-git-separator" aria-hidden="true">•</span>`}
                                            ${toolRepoBranch && html`<span class="agent-status-git-part">${toolRepoBranch}</span>`}
                                        </span>
                                    </span>
                                `}
                                ${trailingStatusHints.map((hint) => html`
                                    <span key=${hint.key} class="agent-status-hint-row" title=${hint.title || hint.label}>
                                        <span class="agent-status-hint-icon" dangerouslySetInnerHTML=${{ __html: hint.iconSvg }}></span>
                                        <span class="agent-status-hint-label">${hint.label}</span>
                                    </span>
                                `)}
                                ${statusActivityAgeLabel && html`
                                    <span class="agent-status-hint-row agent-status-activity-row" title=${`${isLastActivity ? 'Recent activity' : 'Last event'} ${statusActivityAgeLabel}`}>
                                        <span class="agent-status-hint-icon">${CLOCK_ICON_SVG}</span>
                                        <span class="agent-status-hint-label">${statusActivityAgeLabel}</span>
                                    </span>
                                `}
                            </span>
                        `}
                    </div>
                </div>
            `}
        </div>
    `;
}

/** Preact component: modal for agent confirmation/input requests. */
export function AgentRequestModal({ request, onRespond }) {
    if (!request) return null;

    const { request_id, tool_call, options, chat_jid } = request;
    const title = tool_call?.title || 'Agent Request';
    const kind = tool_call?.kind || 'other';

    // Extract command and explanation from tool call metadata
    const rawInput = tool_call?.rawInput || {};
    const command = rawInput.command || (rawInput.commands && rawInput.commands[0]) || null;
    const diff = rawInput.diff || null;
    const fileName = rawInput.fileName || rawInput.path || null;
    const explanation = tool_call?.description || rawInput.description || rawInput.explanation || null;
    const locations = Array.isArray(tool_call?.locations) ? tool_call.locations : [];
    const locationPaths = locations
        .map((loc) => loc?.path)
        .filter((path) => Boolean(path));
    const uniquePaths = Array.from(new Set([fileName, ...locationPaths].filter(Boolean)));

    console.log('AgentRequestModal:', { request_id, tool_call, options });

    const handleResponse = async (outcome) => {
        try {
            await respondToAgentRequest(request_id, outcome, chat_jid || null);
            onRespond();
        } catch (e) {
            console.error('Failed to respond to agent request:', e);
        }
    };

    const handleAlwaysAllow = async () => {
        try {
            // Add to whitelist with the exact title
            await addToWhitelist(title, `Auto-approved: ${title}`);
            // Then approve this request
            await respondToAgentRequest(request_id, 'approved', chat_jid || null);
            onRespond();
        } catch (e) {
            console.error('Failed to add to whitelist:', e);
        }
    };

    // ACP options format: { optionId, name, kind }
    const hasOptions = options && options.length > 0;

    return html`
        <div class="agent-request-modal">
            <div class="agent-request-content">
                <div class="agent-request-header">
                    <div class="agent-request-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        </svg>
                    </div>
                    <div class="agent-request-title">${title}</div>
                </div>
                ${(explanation || command || diff || uniquePaths.length > 0) && html`
                    <div class="agent-request-body">
                        ${explanation && html`
                            <div class="agent-request-description">${explanation}</div>
                        `}
                        ${uniquePaths.length > 0 && html`
                            <div class="agent-request-files">
                                <div class="agent-request-subtitle">Files</div>
                                <ul>
                                    ${uniquePaths.map((path, idx) => html`<li key=${idx}>${path}</li>`)}
                                </ul>
                            </div>
                        `}
                        ${command && html`
                            <pre class="agent-request-command">${command}</pre>
                        `}
                        ${diff && html`
                            <details class="agent-request-diff">
                                <summary>Proposed diff</summary>
                                <pre>${diff}</pre>
                            </details>
                        `}
                    </div>
                `}
                <div class="agent-request-actions">
                    ${hasOptions ? (
                        options.map(opt => html`
                            <button 
                                key=${opt.optionId || opt.id || String(opt)}
                                class="agent-request-btn ${opt.kind === 'allow_once' || opt.kind === 'allow_always' ? 'primary' : ''}"
                                onClick=${() => handleResponse(opt.optionId || opt.id || opt)}
                            >
                                ${opt.name || opt.label || opt.optionId || opt.id || String(opt)}
                            </button>
                        `)
                    ) : html`
                        <button class="agent-request-btn primary" onClick=${() => handleResponse('approved')}>
                            Allow
                        </button>
                        <button class="agent-request-btn" onClick=${() => handleResponse('denied')}>
                            Deny
                        </button>
                        <button class="agent-request-btn always-allow" onClick=${handleAlwaysAllow}>
                            Always Allow This
                        </button>
                    `}
                </div>
            </div>
        </div>
    `;
}

/** Preact component: SSE connection status indicator. */
export function ConnectionStatus({ status }) {
    const presentation = useConnectionStatusPresentation(status);
    if (!presentation.show) return null;

    return html`
        <div class="connection-status ${presentation.statusClass}">
            ${presentation.label}
        </div>
    `;
}
