/**
 * components/turn-activity.ts – collapsible "Worked for …" log on agent replies.
 *
 * Progressive disclosure of one settled turn: a one-line summary (duration,
 * tool count, failures) that expands to the ordered steps (reasoning,
 * commentary, steering, tool calls). Tool cards expand to their arguments and
 * output; full content is fetched per step and output is paged. Everything is
 * read from GET /agent/turn-activity, so the reply post stays the unit users
 * delete and reference.
 *
 * Consumers: components/post.ts.
 */
import { html, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { abortAgentTool, getTurnActivity } from '../api.js';
import { renderMarkdown, renderThinkingMarkdown } from '../markdown.js';
import { renderDisclosureTriangle } from '../ui/disclosure-triangle.js';
import { attachHeaderAnchor } from '../ui/scroll-anchor.js';

/** The server flags durable replies, whose committed turn can be read on demand. */
export function hasTurnActivity(post) {
    return post?.data?.turn_activity === true;
}

export function formatActivityDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const seconds = ms / 1000;
    if (seconds < 10) return `${seconds.toFixed(1)}s`;
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatActivityTokens(count) {
    if (!Number.isFinite(count) || count <= 0) return '';
    return count < 1000 ? `${count} tokens` : `${(count / 1000).toFixed(count < 10000 ? 1 : 0)}k tokens`;
}

/** Collapsed summary: "Worked for 2m 55s" plus tools, tool time and output tokens. */
export function summariseTurnActivity(activity) {
    const duration = formatActivityDuration(activity?.duration_ms);
    const label = duration ? `Worked for ${duration}` : 'Worked';
    const meta = [];
    if (activity?.tools) meta.push(`${activity.tools} tool${activity.tools === 1 ? '' : 's'}`);
    const toolTime = formatActivityDuration(activity?.tool_ms);
    if (activity?.tools && activity?.tool_ms > 0 && toolTime) meta.push(`${toolTime} in tools`);
    const tokens = formatActivityTokens(activity?.output_tokens);
    if (tokens) meta.push(tokens);
    return { label, meta: meta.join(' · ') };
}

// Visible replies load their summaries a couple at a time; results are cached
// per reply so remounts (timeline refreshes, branch switches) do not refetch.
const cache = new Map();
const pending = [];
let active = 0;
const CONCURRENCY = 2;

function pump() {
    while (active < CONCURRENCY && pending.length) {
        const job = pending.shift();
        active += 1;
        job().finally(() => { active -= 1; pump(); });
    }
}

export function loadTurnActivity(chatJid, messageId) {
    const key = `${chatJid}\u0000${messageId}`;
    if (!cache.has(key)) {
        cache.set(key, new Promise((resolve) => {
            pending.push(() => Promise.resolve()
                .then(() => getTurnActivity(chatJid, messageId))
                .then(resolve, () => resolve(null)));
            pump();
        }));
    }
    return cache.get(key);
}

const STATUS_LABEL = { ok: 'Succeeded', error: 'Failed', running: 'No result', aborted: 'Stopped' };

function StatusIcon({ status }) {
    const path = status === 'ok' ? 'M20 6L9 17l-5-5'
        : status === 'error' ? 'M18 6L6 18M6 6l12 12'
            : status === 'aborted' ? 'M7 7h10v10H7z'
                : 'M12 8v4l3 2';
    return html`
        <span class=${`turn-activity-status is-${status}`} role="img" aria-label=${STATUS_LABEL[status] || status} title=${STATUS_LABEL[status] || status}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d=${path}></path></svg>
        </span>
    `;
}

function useStepDetail(chatJid, messageId, stepId) {
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);
    const load = useCallback((offset = 0) => {
        setLoading(true);
        setFailed(false);
        return getTurnActivity(chatJid, messageId, stepId, offset)
            .then((next) => {
                if (!mounted.current) return;
                setDetail((previous) => (offset > 0 && previous
                    ? { ...next, output: `${previous.output || ''}${next.output || ''}`, output_offset: previous.output_offset || 0 }
                    : next));
            })
            .catch(() => { if (mounted.current) setFailed(true); })
            .finally(() => { if (mounted.current) setLoading(false); });
    }, [chatJid, messageId, stepId]);
    return { detail, loading, failed, load };
}

function TextStep({ step, chatJid, messageId }) {
    const { detail, loading, failed, load } = useStepDetail(chatJid, messageId, step.id);
    const [expanded, setExpanded] = useState(false);
    const [clamped, setClamped] = useState(false);
    const bodyRef = useRef(null);
    const partial = (step.chars || 0) > (step.text || '').length;
    const text = detail?.text ?? step.text ?? '';
    const rendered = useMemo(() => {
        try {
            return { __html: step.kind === 'thinking' ? renderThinkingMarkdown(text) : renderMarkdown(text, null) };
        } catch {
            return null;
        }
    }, [text, step.kind]);
    // Reasoning is clamped to three lines; offer "Show more" only when the clamp actually hides text.
    useLayoutEffect(() => {
        const body = bodyRef.current;
        if (!body || expanded || step.kind !== 'thinking') return;
        setClamped(body.scrollHeight > body.clientHeight + 1);
    }, [expanded, step.kind, rendered]);
    const showMore = (event) => {
        event.stopPropagation();
        setExpanded(true);
        if (partial && !detail && !loading) load();
    };
    const className = step.kind === 'thinking' ? 'turn-activity-thinking' : step.kind === 'input' ? 'turn-activity-input' : 'turn-activity-text';
    return html`
        <li class=${`turn-activity-step ${className}${expanded ? ' is-expanded' : ''}`}>
            ${step.kind === 'input' && html`<span class="turn-activity-step-label">Steered</span>`}
            ${rendered ? html`<div class="turn-activity-markdown" ref=${bodyRef} dangerouslySetInnerHTML=${rendered}></div>` : html`<div class="turn-activity-markdown" ref=${bodyRef}>${text}</div>`}
            ${!expanded && (partial || clamped) && html`
                <button type="button" class="turn-activity-more" onClick=${showMore}>Show more</button>
            `}
            ${loading && html`<span class="turn-activity-note">Loading…</span>`}
            ${failed && html`<span class="turn-activity-note is-error">Could not load the full text.</span>`}
        </li>
    `;
}

/**
 * Kintsugi-style single-tool cancellation: stop one running call, optionally
 * telling the agent why, while the turn and any other calls carry on.
 */
function ToolStopControl({ chatJid, callId, title }) {
    const [confirming, setConfirming] = useState(false);
    const [note, setNote] = useState('');
    const [state, setState] = useState('idle');
    const mounted = useRef(true);
    const noteRef = useRef(null);
    useEffect(() => () => { mounted.current = false; }, []);
    useEffect(() => { if (confirming) noteRef.current?.focus?.(); }, [confirming]);
    const stop = (event) => {
        event.preventDefault();
        event.stopPropagation();
        setState('stopping');
        abortAgentTool(chatJid, callId, note)
            .then((result) => { if (mounted.current) setState(result?.aborted ? 'stopped' : 'finished'); })
            .catch(() => { if (mounted.current) setState('failed'); });
    };
    if (state === 'stopped') return html`<span class="turn-activity-note">Stopping…</span>`;
    if (state === 'finished') return html`<span class="turn-activity-note">Already finished</span>`;
    if (!confirming) {
        return html`<button type="button" class="turn-activity-stop" onClick=${(event) => { event.stopPropagation(); setConfirming(true); }}
            title="Stop this tool only; the agent will continue" aria-label=${`Stop ${title}; the agent will continue`}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="7" y="7" width="10" height="10" rx="1.5"></rect></svg>
        </button>`;
    }
    return html`
        <form class="turn-activity-stop-confirm" role="group" aria-label="Stop this tool" onSubmit=${stop} onClick=${(event) => event.stopPropagation()}
            onKeyDown=${(event) => { if (event.key === 'Escape') { event.stopPropagation(); setConfirming(false); } }}>
            <p>Stop this tool only? The agent continues with what it has.</p>
            <input type="text" value=${note} maxLength="2000" placeholder="Note for the agent (optional)" aria-label="Note for the agent (optional)"
                onInput=${(event) => setNote(event.currentTarget.value)} ref=${noteRef} />
            <div class="turn-activity-stop-actions">
                <button type="button" onClick=${() => setConfirming(false)}>Keep running</button>
                <button type="submit" class="is-danger" disabled=${state === 'stopping'}>Stop tool only</button>
            </div>
            ${state === 'failed' && html`<span class="turn-activity-note is-error">Could not stop the tool.</span>`}
        </form>
    `;
}

function ToolStep({ step, chatJid, messageId, liveOutput = '', live = false }) {
    const tool = step.tool;
    const [open, setOpen] = useState(false);
    const { detail, loading, failed, load } = useStepDetail(chatJid, messageId, step.id);
    const bodyId = `turn-activity-${messageId}-${step.id}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    const fullOutput = tool.output_chars > (tool.output_preview || '').length;
    const toggle = (event) => {
        event.stopPropagation();
        setOpen((value) => !value);
    };
    const loadFull = (event) => {
        event.stopPropagation();
        load(0);
    };
    const loadMore = (event) => {
        event.stopPropagation();
        load((detail?.output_offset || 0) + (detail?.output || '').length);
    };
    const args = detail?.args ?? tool.args_preview;
    // A running call has no committed result yet; show its live output.
    const output = detail ? detail.output : (tool.status === 'running' && liveOutput ? liveOutput : tool.output_preview);
    const duration = formatActivityDuration(tool.duration_ms);
    return html`
        <li class=${`turn-activity-step turn-activity-tool is-${tool.status}${open ? ' is-open' : ''}`}>
            <div class="turn-activity-tool-row">
                <button type="button" class="turn-activity-tool-header" onClick=${toggle} aria-expanded=${open ? 'true' : 'false'} aria-controls=${bodyId}>
                    <span class="turn-activity-toggle" aria-hidden="true">${renderDisclosureTriangle(open ? 'down' : 'right')}</span>
                    <${StatusIcon} status=${tool.status} />
                    <span class="turn-activity-tool-title" title=${tool.title}>${tool.title}</span>
                    ${tool.nested?.length ? html`<span class="turn-activity-badge">${tool.nested.length} call${tool.nested.length === 1 ? '' : 's'}</span>` : null}
                    ${duration && html`<span class="turn-activity-duration">${duration}</span>`}
                </button>
                ${live && tool.status === 'running' && html`<${ToolStopControl} chatJid=${chatJid} callId=${tool.call_id} title=${tool.title} />`}
            </div>
            <div id=${bodyId} class="turn-activity-tool-body" hidden=${!open}>
                ${open && html`
                    <div class="turn-activity-section-label">Arguments</div>
                    <pre class="turn-activity-pre">${args}</pre>
                    ${tool.nested?.length ? html`
                        <div class="turn-activity-section-label">Calls</div>
                        <ol class="turn-activity-nested">
                            ${tool.nested.map((call, index) => html`
                                <li key=${index} class=${`turn-activity-nested-call is-${call.status}`}>
                                    <${StatusIcon} status=${call.status} />
                                    <span class="turn-activity-tool-title" title=${call.title}>${call.title}</span>
                                    ${Number.isFinite(call.duration_ms) && html`<span class="turn-activity-duration">${formatActivityDuration(call.duration_ms)}</span>`}
                                </li>
                            `)}
                        </ol>
                    ` : null}
                    ${(output || tool.images > 0) && html`<div class="turn-activity-section-label">Output${tool.output_lines ? html` <span class="turn-activity-note">${tool.output_lines} line${tool.output_lines === 1 ? '' : 's'}</span>` : null}</div>`}
                    ${output && html`<pre class=${`turn-activity-pre turn-activity-output${tool.status === 'error' ? ' is-error' : ''}`}>${output}</pre>`}
                    ${tool.images > 0 && html`<div class="turn-activity-note">${tool.images} image${tool.images === 1 ? '' : 's'} returned to the model</div>`}
                    ${fullOutput && !detail && html`<button type="button" class="turn-activity-more" onClick=${loadFull} disabled=${loading}>Show full output (${tool.output_chars.toLocaleString()} characters)</button>`}
                    ${detail?.truncated && html`<button type="button" class="turn-activity-more" onClick=${loadMore} disabled=${loading}>Load more</button>`}
                    ${loading && html`<span class="turn-activity-note">Loading…</span>`}
                    ${failed && html`<span class="turn-activity-note is-error">Could not load the output.</span>`}
                `}
            </div>
        </li>
    `;
}

export function TurnActivity({ post, chatJid }) {
    const messageId = post?.id;
    const jid = chatJid || post?.chat_jid || '';
    const [activity, setActivity] = useState(undefined);
    const [expanded, setExpanded] = useState(false);
    const rootRef = useRef(null);
    const panelRef = useRef(null);
    const anchorRef = useRef(null);

    useEffect(() => {
        const root = rootRef.current;
        if (!root || !messageId) return undefined;
        let cancelled = false;
        const start = () => {
            loadTurnActivity(jid, messageId).then((value) => {
                if (!cancelled) setActivity(value || null);
            });
        };
        if (typeof IntersectionObserver !== 'function') {
            start();
            return () => { cancelled = true; };
        }
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            start();
        }, { rootMargin: '400px 0px' });
        observer.observe(root);
        return () => { cancelled = true; observer.disconnect(); };
    }, [jid, messageId]);

    // Hold the header still while the log opens or closes (WebKit lacks scroll anchoring).
    useLayoutEffect(() => {
        const scroller = rootRef.current?.closest('.timeline');
        if (!scroller || !panelRef.current) return undefined;
        const anchor = attachHeaderAnchor(scroller, panelRef.current);
        anchorRef.current = anchor;
        return () => { anchor.dispose(); anchorRef.current = null; };
    }, [activity]);
    useLayoutEffect(() => { anchorRef.current?.compensate(); }, [expanded]);

    const toggle = useCallback((event) => {
        event.stopPropagation();
        anchorRef.current?.mark();
        setExpanded((value) => !value);
    }, []);

    if (activity === null) return null;
    if (activity === undefined) return html`<div class="turn-activity is-pending" ref=${rootRef} aria-hidden="true"></div>`;
    if (!activity.steps?.length && !activity.duration_ms) return null;

    const { label, meta } = summariseTurnActivity(activity);
    const detailId = `turn-activity-${messageId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    return html`
        <div class=${`turn-activity${expanded ? ' is-expanded' : ''}${activity.errors ? ' has-errors' : ''}`} ref=${rootRef}>
            <button type="button" class="turn-activity-header" onClick=${toggle} aria-expanded=${expanded ? 'true' : 'false'} aria-controls=${detailId}>
                <span class="turn-activity-toggle" aria-hidden="true">${renderDisclosureTriangle(expanded ? 'down' : 'right')}</span>
                <span class="turn-activity-label">${label}</span>
                ${meta && html`<span class="turn-activity-meta">${meta}</span>`}
                ${activity.errors > 0 && html`<span class="turn-activity-badge is-error">${activity.errors} failed</span>`}
            </button>
            <div id=${detailId} class="turn-activity-detail" ref=${panelRef} hidden=${!expanded}>
                ${expanded && html`
                    <ol class="turn-activity-steps">
                        ${activity.steps.map((step) => step.kind === 'tool'
                            ? html`<${ToolStep} key=${step.id} step=${step} chatJid=${jid} messageId=${messageId} />`
                            : html`<${TextStep} key=${step.id} step=${step} chatJid=${jid} messageId=${messageId} />`)}
                    </ol>
                    ${!activity.steps.length && html`<p class="turn-activity-note">No intermediate activity for this turn.</p>`}
                    ${activity.truncated && html`<p class="turn-activity-note">Showing the most recent activity only.</p>`}
                `}
            </div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Running turn: the live "Working · elapsed" block at the end of the timeline.

const previewText = (value) => (typeof value === 'string' ? value : value?.fullText || value?.text || '');

/** A turn is live while the agent status is active, or a draft/thought is still streaming. */
export function isLiveTurnActive(status, draft, thought) {
    if (status && typeof status === 'object' && status.type !== 'done' && status.type !== 'error' && status.state !== 'idle') return true;
    return Boolean(previewText(draft).trim() || previewText(thought).trim());
}

function parseTime(value) {
    const ms = typeof value === 'number' ? value : Date.parse(value || '');
    return Number.isFinite(ms) ? ms : null;
}

// Expanded/collapsed carries across turns within this page.
let liveExpandedPreference = false;

export function LiveTurnActivity({ chatJid, status, draft, thought, turnId }) {
    const active = isLiveTurnActive(status, draft, thought);
    const [expanded, setExpanded] = useState(liveExpandedPreference);
    const [activity, setActivity] = useState(null);
    const [now, setNow] = useState(() => Date.now());
    const firstSeen = useRef({ turn: null, at: Date.now() });
    if (firstSeen.current.turn !== turnId) firstSeen.current = { turn: turnId, at: Date.now() };

    useEffect(() => { setActivity(null); }, [turnId, chatJid]);
    useEffect(() => {
        if (!active) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [active]);

    // Refetch the committed steps when the visible activity changes, only while open.
    const signature = JSON.stringify([turnId, status?.type, status?.tool_call_id, status?.status, status?.phase,
        (status?.active_tools || []).map((tool) => [tool?.tool_call_id, tool?.status])]);
    useEffect(() => {
        if (!active || !expanded) return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            getTurnActivity(chatJid, null).then((next) => { if (!cancelled) setActivity(next); }).catch((error) => { console.debug('[turn-activity] Live activity unavailable; retrying on the next change.', error); });
        }, 300);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [active, expanded, signature, chatJid]);

    const draftText = previewText(draft);
    const renderedDraft = useMemo(() => {
        if (!draftText.trim()) return null;
        try { return { __html: renderMarkdown(draftText.replace(/<\/?internal>/gi, ''), null) }; } catch { return null; }
    }, [draftText]);

    if (!active) return null;

    const startedAt = parseTime(status?.started_at) ?? firstSeen.current.at;
    const elapsed = formatActivityDuration(Math.max(0, now - startedAt));
    const current = typeof status?.title === 'string' && status.type !== 'thinking' ? status.title : '';
    const liveOutputs = new Map();
    if (status?.tool_call_id && (status?.output_preview || status?.outputPreview)) liveOutputs.set(status.tool_call_id, status.output_preview || status.outputPreview);
    for (const tool of status?.active_tools || []) if (tool?.tool_call_id && tool.output_preview) liveOutputs.set(tool.tool_call_id, tool.output_preview);
    const thinkingText = previewText(thought).replace(/<\/?internal>/gi, '').trim();
    const thinkingTail = thinkingText ? thinkingText.split('\n').slice(-6).join('\n') : '';
    const showThinkingTail = Boolean(thinkingTail) && (status?.type === 'thinking' || status?.phase === 'thinking');
    const toggle = (event) => {
        event.stopPropagation();
        setExpanded((value) => { liveExpandedPreference = !value; return !value; });
    };
    const detailId = `turn-activity-live-${String(turnId || 'current').replace(/[^a-zA-Z0-9_-]/g, '-')}`;

    return html`
        <div class="post agent-post turn-activity-live" aria-live="off">
            <div class="post-avatar turn-activity-live-avatar" aria-hidden="true"><span class="turn-activity-live-dot"></span></div>
            <div class="post-body">
                <div class=${`turn-activity is-live${expanded ? ' is-expanded' : ''}${activity?.errors ? ' has-errors' : ''}`}>
                    <button type="button" class="turn-activity-header" onClick=${toggle} aria-expanded=${expanded ? 'true' : 'false'} aria-controls=${detailId}>
                        <span class="turn-activity-toggle" aria-hidden="true">${renderDisclosureTriangle(expanded ? 'down' : 'right')}</span>
                        <span class="turn-activity-label">Working · ${elapsed}</span>
                        ${current && html`<span class="turn-activity-meta" title=${current}>${current}</span>`}
                        ${activity?.errors > 0 && html`<span class="turn-activity-badge is-error">${activity.errors} failed</span>`}
                    </button>
                    <div id=${detailId} class="turn-activity-detail" hidden=${!expanded}>
                        ${expanded && html`
                            <ol class="turn-activity-steps">
                                ${(activity?.steps || []).map((step) => step.kind === 'tool'
                                    ? html`<${ToolStep} key=${step.id} step=${step} chatJid=${chatJid} messageId=${null} live=${true} liveOutput=${liveOutputs.get(step.tool.call_id) || ''} />`
                                    : html`<${TextStep} key=${step.id} step=${step} chatJid=${chatJid} messageId=${null} />`)}
                                ${showThinkingTail && html`<li class="turn-activity-step turn-activity-thinking turn-activity-live-thinking"><div class="turn-activity-markdown">${thinkingTail}</div></li>`}
                            </ol>
                            ${!activity && html`<p class="turn-activity-note">Loading…</p>`}
                        `}
                    </div>
                </div>
                ${renderedDraft && html`<div class="post-content turn-activity-live-draft" dangerouslySetInnerHTML=${renderedDraft}></div>`}
            </div>
        </div>
    `;
}
