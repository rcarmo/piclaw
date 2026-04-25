// @ts-nocheck
import { html, useRef, useState, useEffect, useCallback, useMemo } from '../vendor/preact-htm.js';
import { findPopupTypeaheadMatch, isPopupTypeaheadKey, resolvePopupTypeaheadMatch, updatePopupTypeaheadBuffer } from '../ui/popup-typeahead.js';
import { getAgentModels, sendAgentMessage, uploadMedia } from '../api.js';
import { getLocalStorageItem, setLocalStorageItem } from '../utils/storage.js';
import { buildMentionValue, filterMentionAgents, parseMentionAutocompleteQuery } from '../ui/agent-mentions.js';
import { shouldOpenSessionSwitcherFromBlankCompose, shouldRouteComposeValueToSessionSwitcher } from '../ui/compose-session-switcher.js';
import { formatBranchPickerLabel, formatCurrentBranchLabel } from '../ui/branch-lifecycle.js';
import { buildComposeStatusDotClass } from '../ui/status-dot.js';
import { getStatusElapsedLabel, isCompactionStatus, resolveStatusPanelTitle } from '../ui/status-duration.js';
import { useConnectionStatusPresentation } from '../ui/connection-status.js';
import { FilePill } from './file-pill.js';
import { refreshAgentModelStateBestEffort } from './compose-model-refresh.js';
import { renderMarkdown } from '../markdown.js';

/**
 * Slash command definitions for autocomplete.
 * Kept in sync with agent-control/command-registry.ts.
 */
export const SLASH_COMMANDS = [
  { name: "/model", description: "Select model or list available models" },
  { name: "/cycle-model", description: "Cycle to the next available model" },
  { name: "/thinking", description: "Show or set thinking/effort level" },
  { name: "/effort", description: "Show or set thinking/effort level (alias for /thinking)" },
  { name: "/cycle-thinking", description: "Cycle thinking level" },
  { name: "/theme", description: "Set UI theme (no name to show available themes)" },
  { name: "/meters", description: "Toggle the top-right CPU/RAM HUD (/meters on|off|toggle)" },
  { name: "/tint", description: "Tint default light/dark UI (usage: /tint #hex or /tint off)" },
  { name: "/btw", description: "Open a side conversation panel without interrupting the main chat" },
  { name: "/state", description: "Show current session state" },
  { name: "/stats", description: "Show session token and cost stats" },
  { name: "/context", description: "Show context window usage" },
  { name: "/last", description: "Show last assistant response" },
  { name: "/compact", description: "Manually compact the session" },
  { name: "/auto-compact", description: "Toggle auto-compaction" },
  { name: "/auto-retry", description: "Toggle auto-retry" },
  { name: "/abort", description: "Abort the current response" },
  { name: "/abort-retry", description: "Abort retry backoff" },
  { name: "/abort-bash", description: "Abort running bash command" },
  { name: "/shell", description: "Run a shell command and return output" },
  { name: "/bash", description: "Run a shell command and add output to context" },
  { name: "/queue", description: "Queue a follow-up message (one-at-a-time)" },
  { name: "/queue-all", description: "Queue a follow-up message (batch all)" },
  { name: "/steer", description: "Steer the current response" },
  { name: "/steering-mode", description: "Set steering mode (all|one)" },
  { name: "/followup-mode", description: "Set follow-up mode (all|one)" },
  { name: "/session-name", description: "Set or show the session name" },
  { name: "/new-session", description: "Start a new session" },
  { name: "/switch-session", description: "Switch to a session file" },
  { name: "/session-rotate", description: "Rotate the current persisted session into an archived file" },
  { name: "/clone", description: "Duplicate the current active branch into a new session" },
  { name: "/fork", description: "Fork from a previous message" },
  { name: "/forks", description: "List forkable messages" },
  { name: "/tree", description: "List the session tree" },
  { name: "/label", description: "Set or clear a label on a tree entry" },
  { name: "/labels", description: "List labeled entries" },
  { name: "/agent-name", description: "Set or show the agent display name" },
  { name: "/agent-avatar", description: "Set or show the agent avatar URL" },
  { name: "/user-name", description: "Set or show your display name" },
  { name: "/user-avatar", description: "Set or show your avatar URL" },
  { name: "/user-github", description: "Set name/avatar from GitHub profile" },
  { name: "/export-html", description: "Export session to HTML" },
  { name: "/passkey", description: "Manage passkeys (enrol/list/delete)" },
  { name: "/totp", description: "Show a TOTP enrolment QR code" },
  { name: "/qr", description: "Generate a QR code for text or URL" },
  { name: "/search", description: "Search notes and skills in the workspace" },
  { name: "/dream", description: "Run Dream memory maintenance over recent days (default 7)" },
  { name: "/tasks", description: "List scheduled tasks" },
  { name: "/scheduled", description: "List scheduled tasks" },
  { name: "/pair", description: "Manage remote peer connections (/pair request <url> | /pair list)" },
  { name: "/ask", description: "Send a prompt to a paired remote instance (/ask <instance_id|fingerprint> <prompt>)" },
  { name: "/restart", description: "Restart the agent and stop subprocesses" },
  { name: "/exit", description: "Exit the current piclaw process immediately (Supervisor will restart it)" },
  { name: "/login", description: "Login to an AI model provider (OAuth or API key)" },
  { name: "/logout", description: "Logout from an AI model provider" },
  { name: "/settings", description: "Open the settings pane" },
  { name: "/commands", description: "List available commands" },
  { name: "/skill:", description: "Run a workspace skill (e.g. /skill:visual-artifact-generator, /skill:web-search)" },
];

const COMPOSE_HISTORY_STORAGE_KEY = 'piclaw_compose_history';

export function resolveComposePrefillRequest(prefillRequest, lastHandledToken, searchMode = false) {
    if (searchMode) return { shouldApply: false, nextToken: lastHandledToken, text: '' };
    if (!prefillRequest || typeof prefillRequest !== 'object') {
        return { shouldApply: false, nextToken: lastHandledToken, text: '' };
    }
    const token = typeof prefillRequest.token === 'string' ? prefillRequest.token : '';
    const text = typeof prefillRequest.text === 'string' ? prefillRequest.text : '';
    if (!token || token === lastHandledToken || !text.trim()) {
        return { shouldApply: false, nextToken: lastHandledToken, text: '' };
    }
    return { shouldApply: true, nextToken: token, text };
}

export function getComposeHistoryStorageKey(chatJid = 'web:default') {
    const normalized = typeof chatJid === 'string' && chatJid.trim() ? chatJid.trim() : 'web:default';
    if (normalized === 'web:default') return COMPOSE_HISTORY_STORAGE_KEY;
    return `${COMPOSE_HISTORY_STORAGE_KEY}:${encodeURIComponent(normalized)}`;
}

export function resolveUiOnlyCommandNotice(commandText, response) {
    const message = typeof response?.command?.message === 'string' ? response.command.message.trim() : '';
    if (!response?.ui_only || !message) return null;

    const trimmed = typeof commandText === 'string' ? commandText.trim() : '';
    if (!trimmed.startsWith('/')) return null;

    const parts = trimmed.split(/\s+/).filter(Boolean);
    const slashName = parts[0]?.toLowerCase() || '';
    const hasArgs = parts.length > 1;

    if (!hasArgs && (slashName === '/model' || slashName === '/thinking' || slashName === '/effort')) {
        return message;
    }

    return null;
}

export function resolveComposeSubmitButtonState(isAgentActive, canSend, _isCompacting = false) {
    if (isAgentActive) {
        return {
            mode: 'queue',
            className: 'icon-btn send-btn queue-mode',
            title: 'Queue follow-up (Enter)',
            ariaLabel: 'Queue follow-up message',
            disabled: !canSend,
        };
    }

    return {
        mode: 'send',
        className: 'icon-btn send-btn',
        title: 'Send (Enter)',
        ariaLabel: 'Send message',
        disabled: !canSend,
    };
}

export function resolveComposeAbortButtonState(isAgentActive, isCompacting = false) {
    if (!isAgentActive) return null;
    if (isCompacting) {
        return {
            mode: 'compacting',
            className: 'icon-btn send-btn abort-mode compacting-mode',
            title: 'Compacting context — Stop response',
            ariaLabel: 'Compacting context — Stop response',
            disabled: false,
        };
    }
    return {
        mode: 'abort',
        className: 'icon-btn send-btn abort-mode',
        title: 'Stop response',
        ariaLabel: 'Stop response',
        disabled: false,
    };
}

export function isComposeSubmitAbortMode(mode) {
    return mode === 'abort' || mode === 'compacting';
}

export function resolveComposeExtensionWorkingDisplay(workingState, frameIndex = 0) {
    const message = typeof workingState?.message === 'string' && workingState.message.trim()
        ? workingState.message.trim()
        : null;
    const indicator = workingState?.indicator && typeof workingState.indicator === 'object'
        ? workingState.indicator
        : null;

    if (!message && !indicator) {
        return {
            visible: false,
            title: '',
            indicatorText: null,
            animateDot: false,
        };
    }

    if (indicator?.mode === 'hidden') {
        return {
            visible: Boolean(message),
            title: message || 'Working…',
            indicatorText: null,
            animateDot: false,
        };
    }

    if (indicator?.mode === 'custom' && Array.isArray(indicator.frames) && indicator.frames.length > 0) {
        const frames = indicator.frames;
        const safeIndex = Number.isFinite(frameIndex) && frameIndex >= 0 ? Math.floor(frameIndex) % frames.length : 0;
        return {
            visible: true,
            title: message || 'Working…',
            indicatorText: frames[safeIndex],
            animateDot: false,
        };
    }

    return {
        visible: true,
        title: message || 'Working…',
        indicatorText: null,
        animateDot: true,
    };
}

/**
 * Tiny SVG pie chart showing context window usage.
 * Green when <75%, amber 75–90%, red >90%. Tooltip shows exact numbers.
 */
function ContextPie({ usage, onCompact, compactionLabel = '', compactionTitle = '' }) {
    const pct = Math.min(100, Math.max(0, usage.percent || 0));
    const tokens = usage.tokens;
    const window = usage.contextWindow;
    const compactLabel = `Compact context`;
    const label = tokens != null
        ? `Context: ${formatK(tokens)} / ${formatK(window)} tokens (${pct.toFixed(0)}%)`
        : `Context: ${pct.toFixed(0)}%`;
    const activeCompactionLabel = typeof compactionLabel === 'string' ? compactionLabel.trim() : '';
    const activeCompactionTitle = typeof compactionTitle === 'string' ? compactionTitle.trim() : '';
    const title = activeCompactionLabel
        ? `${label} — ${activeCompactionTitle || 'Smart compaction'} · ${activeCompactionLabel}`
        : `${label} — ${compactLabel}`;

    // Pie arc: SVG circle with stroke-dasharray trick.
    // Circle circumference = 2πr = 2π×9 ≈ 56.55
    const r = 9;
    const circ = 2 * Math.PI * r;
    const filled = (pct / 100) * circ;

    const color = pct > 90 ? 'var(--context-red, #ef4444)'
                : pct > 75 ? 'var(--context-amber, #f59e0b)'
                : 'var(--context-green, #22c55e)';

    return html`
        <button
            class=${`compose-context-pie icon-btn${activeCompactionLabel ? ' is-compacting' : ''}`}
            type="button"
            title=${title}
            aria-label=${activeCompactionLabel ? `Smart compaction ${activeCompactionLabel}` : 'Compact context'}
            onClick=${(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCompact?.();
            }}
        >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r=${r}
                    fill="none"
                    stroke="var(--context-track, rgba(128,128,128,0.2))"
                    stroke-width="2.5" />
                <circle cx="12" cy="12" r=${r}
                    fill="none"
                    stroke=${color}
                    stroke-width="2.5"
                    stroke-dasharray=${`${filled} ${circ}`}
                    stroke-linecap="round"
                    transform="rotate(-90 12 12)" />
            </svg>
            ${activeCompactionLabel && html`<span class="compose-context-pie-timer">${activeCompactionLabel}</span>`}
        </button>
    `;
}

function formatK(n) {
    if (n == null) return '?';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
    return String(n);
}

export function formatModelPickerContextWindow(contextWindow) {
    const value = Number(contextWindow);
    if (!Number.isFinite(value) || value <= 0) return '';
    return `${formatK(value)} ctx`;
}

export function formatModelPickerDisplayLabel(label, contextWindow) {
    const primaryLabel = typeof label === 'string' ? label.trim() : '';
    const contextLabel = formatModelPickerContextWindow(contextWindow);
    if (!primaryLabel) return contextLabel;
    if (!contextLabel) return primaryLabel;
    return `${primaryLabel} • ${contextLabel}`;
}

function normalizeModelPickerLabel(value, provider = '', id = '') {
    const explicit = typeof value === 'string' ? value.trim() : '';
    if (explicit) return explicit;
    const normalizedProvider = typeof provider === 'string' ? provider.trim() : '';
    const normalizedId = typeof id === 'string' ? id.trim() : '';
    if (normalizedProvider && normalizedId) return `${normalizedProvider}/${normalizedId}`;
    return normalizedId || normalizedProvider || '';
}

export function normalizeModelPickerOptions(payload) {
    const structured = Array.isArray(payload?.model_options) ? payload.model_options : null;
    const legacy = Array.isArray(payload?.models) ? payload.models : [];
    const rawItems = structured && structured.length > 0 ? structured : legacy;
    const options = [];

    for (const item of rawItems) {
        if (typeof item === 'string') {
            const label = item.trim();
            if (!label) continue;
            const slashIndex = label.indexOf('/');
            const provider = slashIndex > 0 ? label.slice(0, slashIndex).trim() : '';
            const id = slashIndex > 0 ? label.slice(slashIndex + 1).trim() : label;
            options.push({
                label,
                provider,
                id,
                name: null,
                contextWindow: null,
                reasoning: false,
            });
            continue;
        }

        if (!item || typeof item !== 'object') continue;
        const provider = typeof item.provider === 'string' ? item.provider.trim() : '';
        const id = typeof item.id === 'string' ? item.id.trim() : '';
        const label = normalizeModelPickerLabel(item.label, provider, id);
        if (!label) continue;
        const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null;
        const contextWindow = Number(item.context_window ?? item.contextWindow);
        options.push({
            label,
            provider,
            id,
            name,
            contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : null,
            reasoning: Boolean(item.reasoning),
        });
    }

    options.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    return options;
}

export function getModelPickerOptionSearchLabel(option) {
    if (!option || typeof option !== 'object') return '';
    return [
        option.label,
        option.provider,
        option.id,
        option.name,
        formatModelPickerContextWindow(option.contextWindow),
    ].filter(Boolean).join(' ');
}

export function resolveComposeModelPickerState(activeModel, agentModelsPayload) {
    const modelLabel = typeof activeModel === 'string' ? activeModel.trim() : '';
    if (modelLabel) {
        return {
            showPicker: true,
            label: modelLabel,
            hasAvailableModels: true,
        };
    }

    const hasAvailableModels = normalizeModelPickerOptions(agentModelsPayload).length > 0;
    return {
        showPicker: hasAvailableModels,
        label: hasAvailableModels ? 'Select model' : '',
        hasAvailableModels,
    };
}

function unwrapQueuedTranscriptContent(value) {
    if (!value) return value;
    const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized.includes(' @ ') || !normalized.includes(':\n')) return value;

    const lines = normalized.split('\n');
    const collected = [];
    let index = 0;
    let sawTranscript = false;

    while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();
        if (!trimmed) {
            index += 1;
            continue;
        }
        if (trimmed === 'Messages:' || trimmed.startsWith('Channel:')) {
            sawTranscript = true;
            index += 1;
            continue;
        }
        if (/^[^\n]+\s@\s[^\n]+:$/.test(trimmed)) {
            sawTranscript = true;
            index += 1;
            const bodyLines = [];
            while (index < lines.length) {
                const current = lines[index];
                const currentTrimmed = current.trim();
                if (/^[^\n]+\s@\s[^\n]+:$/.test(currentTrimmed)) break;
                if (currentTrimmed.startsWith('Channel:') || currentTrimmed === 'Messages:') break;
                bodyLines.push(current.startsWith('  ') ? current.slice(2) : current);
                index += 1;
            }
            if (bodyLines.length > 0) {
                collected.push(bodyLines.join('\n').trim());
            }
            continue;
        }
        return value;
    }

    return sawTranscript && collected.length > 0 ? collected.filter(Boolean).join('\n\n') : value;
}

function extractQueuedFileRefs(value) {
    if (!value) return { content: value, fileRefs: [] };
    const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].trim() === 'Files:' && lines[i + 1] && /^\s*-\s+/.test(lines[i + 1])) {
            start = i;
            break;
        }
    }
    if (start === -1) return { content: value, fileRefs: [] };
    const refs = [];
    let end = start + 1;
    for (; end < lines.length; end += 1) {
        const line = lines[end];
        if (/^\s*-\s+/.test(line)) {
            refs.push(line.replace(/^\s*-\s+/, '').trim());
        } else if (!line.trim()) {
            break;
        } else {
            break;
        }
    }
    if (refs.length === 0) return { content: value, fileRefs: [] };
    const before = lines.slice(0, start);
    const after = lines.slice(end);
    const cleaned = [...before, ...after].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { content: cleaned, fileRefs: refs };
}

function extractQueuedMessageRefs(value) {
    if (!value) return { content: value, messageRefs: [] };
    const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].trim() === 'Referenced messages:' && lines[i + 1] && /^\s*-\s+/.test(lines[i + 1])) {
            start = i;
            break;
        }
    }
    if (start === -1) return { content: value, messageRefs: [] };
    const refs = [];
    let end = start + 1;
    for (; end < lines.length; end += 1) {
        const line = lines[end];
        if (/^\s*-\s+/.test(line)) {
            const match = line.replace(/^\s*-\s+/, '').trim().match(/^message:(\S+)$/i);
            if (match) refs.push(match[1]);
        } else if (!line.trim()) {
            break;
        } else {
            break;
        }
    }
    if (refs.length === 0) return { content: value, messageRefs: [] };
    const before = lines.slice(0, start);
    const after = lines.slice(end);
    const cleaned = [...before, ...after].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { content: cleaned, messageRefs: refs };
}

function extractQueuedAttachmentRefs(value) {
    if (!value) return { content: value, attachmentRefs: [] };
    const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].trim() === 'Attachments:' && lines[i + 1] && /^\s*-\s+/.test(lines[i + 1])) {
            start = i;
            break;
        }
    }
    if (start === -1) return { content: value, attachmentRefs: [] };
    const refs = [];
    let end = start + 1;
    for (; end < lines.length; end += 1) {
        const line = lines[end];
        if (/^\s*-\s+/.test(line)) {
            const item = line.replace(/^\s*-\s+/, '').trim();
            const match = item.match(/^attachment:(\d+)(?:\s*\((.+)\))?$/i);
            if (match) {
                refs.push({
                    id: match[1],
                    label: (match[2] || '').trim() || `attachment:${match[1]}`,
                    raw: item,
                });
            }
        } else if (!line.trim()) {
            break;
        } else {
            break;
        }
    }
    if (refs.length === 0) return { content: value, attachmentRefs: [] };
    const before = lines.slice(0, start);
    const after = lines.slice(end);
    const cleaned = [...before, ...after].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { content: cleaned, attachmentRefs: refs };
}

export function parseQueuedContent(value) {
    const unwrapped = unwrapQueuedTranscriptContent(value || '');
    const withFiles = extractQueuedFileRefs(unwrapped || '');
    const withMessages = extractQueuedMessageRefs(withFiles.content || '');
    const withAttachments = extractQueuedAttachmentRefs(withMessages.content || '');
    return {
        text: withAttachments.content || '',
        fileRefs: withFiles.fileRefs,
        messageRefs: withMessages.messageRefs,
        attachmentRefs: withAttachments.attachmentRefs,
    };
}

export function buildReturnedQueuedDraft(value) {
    const parsed = parseQueuedContent(value);
    const attachmentBlock = parsed.attachmentRefs.length > 0
        ? `Attachments:\n${parsed.attachmentRefs.map((attachment) => `- ${attachment.raw}`).join('\n')}`
        : '';
    const text = String(parsed.text || '').trim();
    return {
        content: [text, attachmentBlock].filter(Boolean).join('\n\n').trim(),
        fileRefs: [...parsed.fileRefs],
        messageRefs: [...parsed.messageRefs],
        attachmentRefs: [...parsed.attachmentRefs],
    };
}

export function QueuedFollowupStack({
    items = [],
    onInjectQueuedFollowup,
    onRemoveQueuedFollowup,
    onMoveQueuedFollowup,
    onReturnQueuedFollowup,
    onOpenFilePill,
}) {
    if (!Array.isArray(items) || items.length === 0) return null;
    return html`
        <div class="compose-queue-stack">
            ${items.map((item, index) => {
                const rowText = typeof item?.content === 'string' ? item.content : '';
                const parsed = parseQueuedContent(rowText);
                if (!parsed.text.trim() && parsed.fileRefs.length === 0 && parsed.messageRefs.length === 0 && parsed.attachmentRefs.length === 0) return null;
                const canMoveUp = index > 0;
                const canMoveDown = index < items.length - 1;
                const canReturnToEditor = index === items.length - 1;
                return html`
                    <div class="compose-queue-stack-item" role="listitem">
                        <div class="compose-queue-stack-content" title=${rowText}>
                            ${parsed.text.trim() && html`<div class="compose-queue-stack-text">${parsed.text}</div>`}
                            ${(parsed.messageRefs.length > 0 || parsed.fileRefs.length > 0 || parsed.attachmentRefs.length > 0) && html`
                                <div class="compose-queue-stack-refs">
                                    ${parsed.messageRefs.map((id) => html`
                                        <${FilePill}
                                            key=${'queue-msg-' + id}
                                            prefix="compose"
                                            label=${'msg:' + id}
                                            title=${'Message reference: ' + id}
                                            icon="message"
                                        />
                                    `)}
                                    ${parsed.fileRefs.map((path) => {
                                        const label = path.split('/').pop() || path;
                                        return html`
                                            <${FilePill}
                                                key=${'queue-file-' + path}
                                                prefix="compose"
                                                label=${label}
                                                title=${path}
                                                onClick=${() => onOpenFilePill?.(path)}
                                            />
                                        `;
                                    })}
                                    ${parsed.attachmentRefs.map((attachment) => html`
                                        <${FilePill}
                                            key=${'queue-attachment-' + attachment.id}
                                            prefix="compose"
                                            label=${attachment.label}
                                            title=${attachment.raw}
                                        />
                                    `)}
                                </div>
                            `}
                        </div>
                        <div class="compose-queue-stack-actions" role="group" aria-label="Queued follow-up controls">
                            ${items.length > 1 && html`
                                <button
                                    class="compose-queue-stack-move-btn"
                                    type="button"
                                    title="Move up"
                                    aria-label="Move up in queue"
                                    disabled=${!canMoveUp}
                                    onClick=${() => canMoveUp && onMoveQueuedFollowup?.(index, index - 1)}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="18 15 12 9 6 15"></polyline>
                                    </svg>
                                </button>
                                <button
                                    class="compose-queue-stack-move-btn"
                                    type="button"
                                    title=${canReturnToEditor ? 'Return to editor' : 'Move down'}
                                    aria-label=${canReturnToEditor ? 'Return queued message to editor' : 'Move down in queue'}
                                    disabled=${!canMoveDown && !canReturnToEditor}
                                    onClick=${() => {
                                        if (canMoveDown) {
                                            onMoveQueuedFollowup?.(index, index + 1);
                                            return;
                                        }
                                        if (canReturnToEditor) {
                                            onReturnQueuedFollowup?.(item);
                                        }
                                    }}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                </button>
                            `}
                            <button
                                class="compose-queue-stack-steer-btn"
                                type="button"
                                title="Inject queued follow-up as steer"
                                aria-label="Inject queued follow-up as steer"
                                onClick=${() => onInjectQueuedFollowup?.(item)}
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 20h12a2 2 0 0 0 2-2V8" />
                                    <polyline points="14 12 18 8 22 12" />
                                </svg>
                                <span>Steer</span>
                            </button>
                            <button
                                class="compose-queue-stack-close-btn"
                                type="button"
                                title="Cancel queued message"
                                aria-label="Cancel queued message"
                                onClick=${() => onRemoveQueuedFollowup?.(item)}
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
            })}
        </div>
    `;
}

/**
 * Compose box component
 */
export function ComposeBox({
    onPost,
    onFocus,
    searchMode,
    searchScope = 'current',
    onSearch,
    onSearchScopeChange,
    onEnterSearch,
    onExitSearch,
    fileRefs = [],
    onRemoveFileRef,
    onClearFileRefs,
    messageRefs = [],
    onRemoveMessageRef,
    onClearMessageRefs,
    activeModel = null,
    agentModelsPayload = null,
    modelUsage = null,
    thinkingLevel = null,
    supportsThinking = false,
    contextUsage = null,
    onContextCompact,
    notificationsEnabled = false,
    notificationPermission = 'default',
    onToggleNotifications,
    onModelChange,
    onModelStateChange,
    activeEditorPath = null,
    onAttachEditorFile,
    onOpenFilePill,
    followupQueueItems = [],
    onInjectQueuedFollowup,
    onRemoveQueuedFollowup,
    onMoveQueuedFollowup,
    onSubmitIntercept,
    onMessageResponse,
    isAgentActive = false,
    activeChatAgents = [],
    currentChatJid = 'web:default',
    connectionStatus = 'connected',
    onSetFileRefs,
    onSetMessageRefs,
    onSubmitError,
    onSwitchChat,
    onRenameSession,
    isRenameSessionInProgress = false,
    onCreateSession,
    onDeleteSession,
    onPurgeArchivedSession,
    onRestoreSession,
    showQueueStack = true,
    statusNotice = null,
    extensionWorkingState = null,
    prefillRequest = null,
}) {
    const [content, setContent] = useState('');
    const [searchText, setSearchText] = useState('');
    const [mediaFiles, setMediaFiles] = useState([]);
    const [isDragActive, setIsDragActive] = useState(false);
    const [slashMatches, setSlashMatches] = useState([]);
    const [slashIndex, setSlashIndex] = useState(0);
    const [showSlash, setShowSlash] = useState(false);
    const dynamicCommandsRef = useRef(null);
    const [mentionMatches, setMentionMatches] = useState([]);
    const [mentionIndex, setMentionIndex] = useState(0);
    const [showMention, setShowMention] = useState(false);
    const [switchingModel, setSwitchingModel] = useState(false);
    const [showModelPopup, setShowModelPopup] = useState(false);
    const [showSessionPopup, setShowSessionPopup] = useState(false);
    const [modelOptions, setModelOptions] = useState([]);
    const [modelPopupIndex, setModelPopupIndex] = useState(0);
    const [sessionPopupIndex, setSessionPopupIndex] = useState(0);
    const [loadingModels, setLoadingModels] = useState(false);
    const [footerWidth, setFooterWidth] = useState(0);
    const [submitError, setSubmitError] = useState(null);
    const [submitNotice, setSubmitNotice] = useState(null);
    const [statusNoticeNowMs, setStatusNoticeNowMs] = useState(() => Date.now());
    const [extensionWorkingFrameIndex, setExtensionWorkingFrameIndex] = useState(0);
    const textareaRef = useRef(null);
    const slashRef = useRef(null);
    const mentionRef = useRef(null);
    const modelPopupRef = useRef(null);
    const modelHintRef = useRef(null);
    const sessionPopupRef = useRef(null);
    const sessionTriggerRef = useRef(null);
    const footerRef = useRef(null);
    const popupTypeaheadRef = useRef({ value: '', updatedAt: 0 });
    const dragCounterRef = useRef(0);
    const renameSessionInProgressRef = useRef(false);
    const historyMax = 200;
    const historyStorageKey = getComposeHistoryStorageKey(currentChatJid);
    const normaliseHistory = (items) => {
        const seen = new Set();
        const cleaned = [];
        for (const item of items || []) {
            if (typeof item !== 'string') continue;
            const trimmed = item.trim();
            if (!trimmed || seen.has(trimmed)) continue;
            seen.add(trimmed);
            cleaned.push(trimmed);
        }
        return cleaned;
    };
    const loadHistory = (storageKey = historyStorageKey) => {
        const raw = getLocalStorageItem(storageKey);
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return normaliseHistory(parsed);
        } catch {
            return [];
        }
    };
    const saveHistory = (history, storageKey = historyStorageKey) => {
        setLocalStorageItem(storageKey, JSON.stringify(history));
    };
    const historyRef = useRef(loadHistory(historyStorageKey));
    const historyIndexRef = useRef(-1);
    const historyDraftRef = useRef('');
    const lastPrefillTokenRef = useRef('');

    useEffect(() => {
        historyRef.current = loadHistory(historyStorageKey);
        historyIndexRef.current = -1;
        historyDraftRef.current = '';
    }, [historyStorageKey]);

    // Fetch dynamic commands from the server for autocomplete
    useEffect(() => {
        let cancelled = false;
        const chatJid = currentChatJid || 'web:default';
        fetch(`/agent/commands?chat_jid=${encodeURIComponent(chatJid)}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (cancelled || !data?.commands) return;
                dynamicCommandsRef.current = data.commands.map(c => ({
                    name: c.name,
                    description: c.description || '',
                }));
            })
            .catch((e) => {
                // keep hardcoded fallback — dynamic commands are optional
                console.debug("[compose] failed to fetch dynamic commands", e);
            });
        return () => { cancelled = true; };
    }, [currentChatJid]);

    useEffect(() => {
        const resolved = resolveComposePrefillRequest(prefillRequest, lastPrefillTokenRef.current, searchMode);
        if (!resolved.shouldApply) return;
        lastPrefillTokenRef.current = resolved.nextToken;
        setSubmitError(null);
        setContent(resolved.text);
        updateSlashAutocomplete(resolved.text);
        updateMentionAutocomplete(resolved.text);
        requestAnimationFrame(() => {
            resizeTextarea();
            const textarea = textareaRef.current;
            if (!textarea) return;
            try {
                textarea.focus({ preventScroll: true });
            } catch {
                textarea.focus();
            }
            const end = resolved.text.length;
            textarea.setSelectionRange?.(end, end);
        });
    }, [prefillRequest, searchMode]);
    const canSend = content.trim() || mediaFiles.length > 0 || fileRefs.length > 0 || messageRefs.length > 0;
    const canShareLocation = typeof window !== 'undefined'
        && typeof navigator !== 'undefined'
        && Boolean(navigator.geolocation)
        && Boolean(window.isSecureContext);
    const notificationsSupported = typeof window !== 'undefined' && typeof Notification !== 'undefined';
    const notificationsSecure = typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false;
    const notificationDenied = notificationPermission === 'denied';
    const notificationsAvailable = notificationsSupported && notificationsSecure && !notificationDenied;
    const notificationActive = notificationPermission === 'granted' && notificationsEnabled;
    const statusNoticeIsCompaction = isCompactionStatus(statusNotice);
    const statusNoticeTitle = resolveStatusPanelTitle(statusNotice);
    const statusNoticeDetail = typeof statusNotice?.detail === 'string' && statusNotice.detail.trim()
        ? statusNotice.detail.trim()
        : '';
    const statusNoticeElapsedLabel = statusNoticeIsCompaction
        ? getStatusElapsedLabel(statusNotice, statusNoticeNowMs)
        : null;
    const extensionWorkingDisplay = resolveComposeExtensionWorkingDisplay(extensionWorkingState, extensionWorkingFrameIndex);
    const extensionWorkingIndicator = extensionWorkingState?.indicator && typeof extensionWorkingState.indicator === 'object'
        ? extensionWorkingState.indicator
        : null;
    const notificationTitle = notificationActive ? 'Disable notifications' : 'Enable notifications';
    const hasAttachments = mediaFiles.length > 0 || fileRefs.length > 0 || messageRefs.length > 0;
    const connectionStatusPresentation = useConnectionStatusPresentation(connectionStatus);
    const connectionStatusLabel = connectionStatusPresentation.label;
    const connectionStatusTitle = connectionStatusPresentation.title;
    const submitButtonState = resolveComposeSubmitButtonState(isAgentActive, canSend, statusNoticeIsCompaction);
    const abortButtonState = resolveComposeAbortButtonState(isAgentActive, statusNoticeIsCompaction);

    const mentionAgents = (Array.isArray(activeChatAgents) ? activeChatAgents : [])
        .filter((chat) => !chat?.archived_at);
    const currentSessionAgent = (() => {
        for (const chat of Array.isArray(activeChatAgents) ? activeChatAgents : []) {
            const chatJid = typeof chat?.chat_jid === 'string' ? chat.chat_jid.trim() : '';
            if (chatJid && chatJid === currentChatJid) return chat;
        }
        return null;
    })();
    const isCurrentRootSession = Boolean(
        currentSessionAgent
        && currentSessionAgent.chat_jid === (currentSessionAgent.root_chat_jid || currentSessionAgent.chat_jid)
    );
    const isCurrentDefaultRootSession = Boolean(isCurrentRootSession && (currentSessionAgent?.chat_jid || currentChatJid) === 'web:default');
    const switchableChatAgents = useMemo(() => {
        const seen = new Set();
        const chats = [];
        for (const chat of Array.isArray(activeChatAgents) ? activeChatAgents : []) {
            const chatJid = typeof chat?.chat_jid === 'string' ? chat.chat_jid.trim() : '';
            if (!chatJid || chatJid === currentChatJid || seen.has(chatJid)) continue;
            const agentName = typeof chat?.agent_name === 'string' ? chat.agent_name.trim() : '';
            if (!agentName) continue;
            seen.add(chatJid);
            chats.push(chat);
        }
        return chats;
    }, [activeChatAgents, currentChatJid]);
    const hasSwitchableChatAgents = switchableChatAgents.length > 0;
    const canSwitchSession = hasSwitchableChatAgents && typeof onSwitchChat === 'function';
    const canRestoreSession = hasSwitchableChatAgents && typeof onRestoreSession === 'function';
    const renameInProgress = Boolean(isRenameSessionInProgress || renameSessionInProgressRef.current);
    const canRenameSession = !searchMode && typeof onRenameSession === 'function' && !renameInProgress;
    const canCreateSession = !searchMode && typeof onCreateSession === 'function';
    const canDeleteSession = !searchMode && typeof onDeleteSession === 'function' && !isCurrentDefaultRootSession;
    const canPurgeArchivedSession = !searchMode && typeof onPurgeArchivedSession === 'function';
    const showSessionSwitcherButton = !searchMode && (canSwitchSession || canRestoreSession || canRenameSession || canCreateSession || canDeleteSession || canPurgeArchivedSession);
    const modelPickerState = resolveComposeModelPickerState(activeModel, agentModelsPayload);
    const showModelPickerHint = modelPickerState.showPicker;
    const modelHintLabel = modelPickerState.label;
    const modelHintSuffix = supportsThinking && thinkingLevel ? ` (${thinkingLevel})` : '';
    const modelThinkingLabel = modelHintSuffix.trim() ? `${thinkingLevel}` : '';
    const modelUsageLabel = typeof modelUsage?.hint_short === 'string' ? modelUsage.hint_short.trim() : '';
    const modelUsageSectionLabel = [
        modelThinkingLabel || null,
        modelUsageLabel || null,
    ].filter(Boolean).join(' • ');
    const modelUsageTitleParts = [
        activeModel ? `Current model: ${modelHintLabel}${modelHintSuffix}` : null,
        modelUsage?.plan ? `Plan: ${modelUsage.plan}` : null,
        modelUsageLabel || null,
        modelUsage?.primary?.reset_description || null,
        modelUsage?.secondary?.reset_description || null,
    ].filter(Boolean);
    const modelHintTitle = switchingModel
        ? 'Switching model…'
        : (modelUsageTitleParts.join(' • ') || (showModelPickerHint
            ? 'Select a model (tap to open model picker)'
            : `Current model: ${modelHintLabel}${modelHintSuffix} (tap to open model picker)`));
    const showComposeMetaRow = !searchMode && (showModelPickerHint || (contextUsage && contextUsage.percent != null));

    const emitModelState = (payload) => {
        if (!payload || typeof payload !== 'object') return;
        const modelLabel = payload.model ?? payload.current;
        if (typeof onModelStateChange === 'function') {
            onModelStateChange({
                model: modelLabel ?? null,
                thinking_level: payload.thinking_level ?? null,
                thinking_level_label: payload.thinking_level_label ?? null,
                supports_thinking: payload.supports_thinking,
                provider_usage: payload.provider_usage ?? null,
            });
        }
        if (modelLabel && typeof onModelChange === 'function') {
            onModelChange(modelLabel);
        }
    };

    const resizeTextarea = (target) => {
        const textarea = target || textareaRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
        textarea.style.overflowY = 'hidden';
    };

    /** Update slash autocomplete matches based on current input. */
    const updateSlashAutocomplete = (value) => {
        // Only trigger when the entire input is a slash command (starts with /)
        // and contains no newlines (single-line command)
        if (!value.startsWith('/') || value.includes('\n')) {
            setShowSlash(false);
            setSlashMatches([]);
            return;
        }
        const prefix = value.toLowerCase().split(' ')[0]; // only match the command part
        if (prefix.length < 1) {
            setShowSlash(false);
            setSlashMatches([]);
            return;
        }
        const commandList = dynamicCommandsRef.current || SLASH_COMMANDS;
        const matches = commandList.filter(cmd =>
            cmd.name.startsWith(prefix) || cmd.name.replace(/-/g, '').startsWith(prefix.replace(/-/g, ''))
        );
        if (matches.length > 0 && !(matches.length === 1 && matches[0].name === prefix)) {
            setShowMention(false);
            setMentionMatches([]);
            setSlashMatches(matches);
            setSlashIndex(0);
            setShowSlash(true);
        } else {
            setShowSlash(false);
            setSlashMatches([]);
        }
    };

    /** Accept the currently highlighted slash command. */
    const acceptSlashCommand = (cmd) => {
        const current = content;
        // Replace the command portion, keep any args after a space
        const spaceIdx = current.indexOf(' ');
        const args = spaceIdx >= 0 ? current.slice(spaceIdx) : '';
        const newVal = cmd.name + args;
        setContent(newVal);
        setShowSlash(false);
        setSlashMatches([]);
        requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            // Place cursor at end
            const len = newVal.length;
            textarea.selectionStart = len;
            textarea.selectionEnd = len;
            textarea.focus();
        });
    };

    const updateMentionAutocomplete = (value) => {
        if (shouldRouteComposeValueToSessionSwitcher(value, {
            searchMode,
            showSessionSwitcherButton,
        })) {
            setShowMention(false);
            setMentionMatches([]);
            return;
        }
        if (parseMentionAutocompleteQuery(value) == null) {
            setShowMention(false);
            setMentionMatches([]);
            return;
        }
        const matches = filterMentionAgents(mentionAgents, value, { currentChatJid });
        if (matches.length > 0 && !(matches.length === 1 && buildMentionValue(matches[0].agent_name).trim().toLowerCase() === String(value || '').trim().toLowerCase())) {
            setShowSlash(false);
            setSlashMatches([]);
            setMentionMatches(matches);
            setMentionIndex(0);
            setShowMention(true);
        } else {
            setShowMention(false);
            setMentionMatches([]);
        }
    };

    const acceptMention = (agent) => {
        const newVal = buildMentionValue(agent?.agent_name);
        if (!newVal) return;
        setContent(newVal);
        setShowMention(false);
        setMentionMatches([]);
        requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            const len = newVal.length;
            textarea.selectionStart = len;
            textarea.selectionEnd = len;
            textarea.focus();
        });
    };

    const openSessionPopup = () => {
        if (searchMode || (!canSwitchSession && !canRestoreSession && !canRenameSession && !canCreateSession && !canDeleteSession)) return false;

        popupTypeaheadRef.current = { value: '', updatedAt: 0 };
        setShowModelPopup(false);
        setShowSlash(false);
        setSlashMatches([]);
        setShowMention(false);
        setMentionMatches([]);
        setShowSessionPopup(true);
        return true;
    };

    const toggleSessionPopup = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (searchMode || (!canSwitchSession && !canRestoreSession && !canRenameSession && !canCreateSession && !canDeleteSession)) return;
        if (showSessionPopup) {
            popupTypeaheadRef.current = { value: '', updatedAt: 0 };
            setShowSessionPopup(false);
            return;
        }
        openSessionPopup();
    };

    const handleSessionSwitch = (chatJid) => {
        const nextChatJid = typeof chatJid === 'string' ? chatJid.trim() : '';
        setShowSessionPopup(false);
        if (!nextChatJid || nextChatJid === currentChatJid) {
            requestAnimationFrame(() => textareaRef.current?.focus());
            return;
        }
        onSwitchChat?.(nextChatJid);
    };

    const handleRestoreSession = async (chatJid) => {
        const nextChatJid = typeof chatJid === 'string' ? chatJid.trim() : '';
        setShowSessionPopup(false);
        if (!nextChatJid || typeof onRestoreSession !== 'function') {
            requestAnimationFrame(() => textareaRef.current?.focus());
            return;
        }
        try {
            await onRestoreSession(nextChatJid);
        } catch (error) {
            console.warn('Failed to restore session:', error);
            requestAnimationFrame(() => textareaRef.current?.focus());
        }
    };

    const findFirstEnabledPopupIndex = (items) => {
        const list = Array.isArray(items) ? items : [];
        const index = list.findIndex((item) => !item?.disabled);
        return index >= 0 ? index : 0;
    };

    const sessionPopupEntries = useMemo(() => {
        const entries = [];
        for (const chat of switchableChatAgents) {
            const archived = Boolean(chat?.archived_at);
            const agentName = typeof chat?.agent_name === 'string' ? chat.agent_name.trim() : '';
            const chatJid = typeof chat?.chat_jid === 'string' ? chat.chat_jid.trim() : '';
            if (!agentName || !chatJid) continue;
            entries.push({
                type: 'session',
                key: `session:${chatJid}`,
                label: `@${agentName} — ${chatJid}${chat?.is_active ? ' active' : ''}${archived ? ' archived' : ''}`,
                chat,
                disabled: archived ? !canRestoreSession : !canSwitchSession,
            });
        }
        if (canCreateSession) {
            entries.push({ type: 'action', key: 'action:new', label: 'New session', action: 'new', disabled: false });
        }
        if (canRenameSession) {
            entries.push({ type: 'action', key: 'action:rename', label: 'Rename current session', action: 'rename', disabled: renameInProgress });
        }
        if (canDeleteSession) {
            entries.push({ type: 'action', key: 'action:delete', label: 'Delete current session', action: 'delete', disabled: false });
        }
        return entries;
    }, [switchableChatAgents, canRestoreSession, canSwitchSession, canCreateSession, canRenameSession, canDeleteSession, renameInProgress]);

    const handleRenameSession = async (event) => {
        if (event?.preventDefault) event.preventDefault();
        if (event?.stopPropagation) event.stopPropagation();

        if (typeof onRenameSession !== 'function' || isRenameSessionInProgress || renameSessionInProgressRef.current) return;
        renameSessionInProgressRef.current = true;
        setShowSessionPopup(false);
        try {
            await onRenameSession();
        } catch (error) {
            console.warn('Failed to rename session:', error);
        } finally {
            renameSessionInProgressRef.current = false;
        }
        requestAnimationFrame(() => textareaRef.current?.focus());
    };

    const handleCreateSession = async () => {
        if (typeof onCreateSession !== 'function') return;
        setShowSessionPopup(false);
        try {
            await onCreateSession();
        } catch (error) {
            console.warn('Failed to create session:', error);
        }
        requestAnimationFrame(() => textareaRef.current?.focus());
    };

    const handleDeleteSession = async () => {
        if (typeof onDeleteSession !== 'function') return;
        setShowSessionPopup(false);
        try {
            await onDeleteSession(currentChatJid);
        } catch (error) {
            console.warn('Failed to delete session:', error);
        }
        requestAnimationFrame(() => textareaRef.current?.focus());
    };

    const updateValue = (value) => {
        if (searchMode) {
            setSearchText(value);
        } else {
            setContent(value);
            updateSlashAutocomplete(value);
            updateMentionAutocomplete(value);
        }
        requestAnimationFrame(() => resizeTextarea());
    };

    const appendToValue = (snippet) => {
        const current = searchMode ? searchText : content;
        const prefix = current && !current.endsWith('\n') ? '\n' : '';
        const next = `${current}${prefix}${snippet}`.trimStart();
        updateValue(next);
    };

    const extractCurrentModel = (response) => {
        const fromLabel = response?.command?.model_label;
        if (fromLabel) return fromLabel;
        const message = response?.command?.message;
        if (typeof message === 'string') {
            const currentMatch = message.match(/•\s+([^\n]+?)\s+\(current\)/);
            if (currentMatch?.[1]) return currentMatch[1].trim();
        }
        return null;
    };

    const runModelCommand = async (commandText) => {
        if (searchMode || switchingModel) return;

        setSubmitError(null);
        setSubmitNotice(null);
        setSwitchingModel(true);
        try {
            const response = await sendAgentMessage('default', commandText, null, [], null, currentChatJid);
            const nextModel = extractCurrentModel(response);
            emitModelState({
                model: nextModel ?? activeModel ?? null,
                thinking_level: response?.command?.thinking_level,
                thinking_level_label: response?.command?.thinking_level_label,
                supports_thinking: response?.command?.supports_thinking,
            });
            await refreshAgentModelStateBestEffort(getAgentModels, currentChatJid, emitModelState);
            setSubmitNotice(resolveUiOnlyCommandNotice(commandText, response));
            onPost?.(response);
            return true;
        } catch (error) {
            console.error('Failed to switch model:', error);
            alert('Failed to switch model: ' + error.message);
            return false;
        } finally {
            setSwitchingModel(false);
        }
    };

    const handleCycleModel = async () => {
        await runModelCommand('/cycle-model');
    };

    const handleSelectModel = async (modelOption) => {
        const modelLabel = typeof modelOption === 'string'
            ? modelOption
            : (typeof modelOption?.label === 'string' ? modelOption.label : '');
        if (!modelLabel || switchingModel) return;
        const ok = await runModelCommand(`/model ${modelLabel}`);
        if (ok) setShowModelPopup(false);
    };

    const runSessionPopupEntry = (entry) => {
        if (!entry || entry.disabled) return;
        if (entry.type === 'session') {
            const chat = entry.chat;
            if (chat?.archived_at) {
                void handleRestoreSession(chat.chat_jid);
            } else {
                handleSessionSwitch(chat.chat_jid);
            }
            return;
        }
        if (entry.type === 'action') {
            if (entry.action === 'new') {
                void handleCreateSession();
                return;
            }
            if (entry.action === 'rename') {
                void handleRenameSession();
                return;
            }
            if (entry.action === 'delete') {
                void handleDeleteSession();
            }
        }
    };

    const toggleModelPopup = (event) => {
        event.preventDefault();
        event.stopPropagation();
        popupTypeaheadRef.current = { value: '', updatedAt: 0 };
        setShowSessionPopup(false);
        setShowModelPopup((prev) => !prev);
    };

    const handleContextCompact = async () => {
        if (searchMode) return;
        onContextCompact?.();
        await handleSubmit('/compact', null, {
            includeMedia: false,
            includeFileRefs: false,
            includeMessageRefs: false,
            clearAfterSubmit: false,
            recordHistory: false,
        });
    };

    const resolveSubmitMode = (mode) => {
        if (mode === 'queue' || mode === 'steer' || mode === 'auto') {
            return mode;
        }
        return isAgentActive ? 'queue' : undefined;
    };

    const handleSubmit = async (overrideContent, submitMode, submitOptions = {}) => {
        // Client-side interception for /settings — open dialog immediately
        const rawInput = typeof overrideContent === 'string' ? overrideContent : content;
        if (/^\/settings\s*$/i.test(rawInput.trim())) {
            setContent('');
            requestAnimationFrame(() => resizeTextarea());
            window.dispatchEvent(new CustomEvent('piclaw:open-settings'));
            return;
        }

        const {
            includeMedia = true,
            includeFileRefs = true,
            includeMessageRefs = true,
            clearAfterSubmit = true,
            recordHistory = true,
        } = submitOptions || {};

        const inferred = typeof overrideContent === 'string'
            ? overrideContent
            : (overrideContent && typeof overrideContent?.target?.value === 'string'
                ? overrideContent.target.value
                : content);
        const currentContent = typeof inferred === 'string' ? inferred : '';
        if (
            !currentContent.trim() &&
            (includeMedia ? mediaFiles.length === 0 : true) &&
            (includeFileRefs ? fileRefs.length === 0 : true) &&
            (includeMessageRefs ? messageRefs.length === 0 : true)
        ) return;

        setShowSlash(false);
        setSlashMatches([]);
        setShowMention(false);
        setMentionMatches([]);
        setShowSessionPopup(false);
        setSubmitError(null);
        setSubmitNotice(null);

        // Capture media/refs before clearing so the async send can use them
        const capturedMediaFiles = includeMedia ? [...mediaFiles] : [];
        const capturedFileRefs = includeFileRefs ? [...fileRefs] : [];
        const capturedMessageRefs = includeMessageRefs ? [...messageRefs] : [];
        const baseContent = currentContent.trim();

        // Record history synchronously
        if (recordHistory && baseContent) {
            const current = historyRef.current;
            const deduped = normaliseHistory(current.filter((item) => item !== baseContent));
            deduped.push(baseContent);
            if (deduped.length > historyMax) {
                deduped.splice(0, deduped.length - historyMax);
            }
            historyRef.current = deduped;
            saveHistory(deduped);
            historyIndexRef.current = -1;
            historyDraftRef.current = '';
        }

        const restoreDraft = () => {
            if (includeMedia) setMediaFiles([...capturedMediaFiles]);
            if (includeFileRefs) onSetFileRefs?.(capturedFileRefs);
            if (includeMessageRefs) onSetMessageRefs?.(capturedMessageRefs);
            setContent(baseContent);
            requestAnimationFrame(() => resizeTextarea());
        };

        // Clear compose box immediately so user can keep typing
        if (clearAfterSubmit) {
            setContent('');
            setMediaFiles([]);
            onClearFileRefs?.();
            onClearMessageRefs?.();
        }

        // Fire-and-forget: send in background, never block the compose box
        (async () => {
            try {
                const intercepted = await onSubmitIntercept?.({
                    content: baseContent,
                    submitMode,
                    fileRefs: capturedFileRefs,
                    messageRefs: capturedMessageRefs,
                    mediaFiles: capturedMediaFiles,
                });
                if (intercepted) {
                    onPost?.(intercepted);
                    return;
                }

                // Upload media files first
                const mediaIds = [];
                for (const file of capturedMediaFiles) {
                    const result = await uploadMedia(file);
                    mediaIds.push(result.id);
                }

                const fileBlock = capturedFileRefs.length
                    ? `Files:\n${capturedFileRefs.map((path) => `- ${path}`).join('\n')}`
                    : '';
                const messageRefBlock = capturedMessageRefs.length
                    ? `Referenced messages:\n${capturedMessageRefs.map((id) => `- message:${id}`).join('\n')}`
                    : '';
                const mediaBlock = mediaIds.length
                    ? `Attachments:\n${mediaIds.map((id, index) => {
                        const file = capturedMediaFiles[index];
                        const label = file?.name || `attachment-${index + 1}`;
                        return `- attachment:${id} (${label})`;
                    }).join('\n')}`
                    : '';
                const message = [baseContent, fileBlock, messageRefBlock, mediaBlock].filter(Boolean).join('\n\n');
                const response = await sendAgentMessage('default', message, null, mediaIds, resolveSubmitMode(submitMode), currentChatJid);
                onMessageResponse?.(response);

                if (response?.command) {
                    emitModelState({
                        model: response.command.model_label ?? activeModel ?? null,
                        thinking_level: response.command.thinking_level,
                        thinking_level_label: response.command.thinking_level_label,
                        supports_thinking: response.command.supports_thinking,
                    });
                    await refreshAgentModelStateBestEffort(getAgentModels, currentChatJid, emitModelState);
                }

                setSubmitNotice(resolveUiOnlyCommandNotice(baseContent, response));
                onPost?.(response);
            } catch (error) {
                if (clearAfterSubmit) {
                    restoreDraft();
                }
                const message = error?.message || 'Failed to send message.';
                setSubmitError(message);
                onSubmitError?.(message);
                console.error('Failed to post:', error);
            }
        })();
    };

    const handleInjectQueuedFollowup = (queuedItem) => {
        // Queue-item steering is backend-authoritative: the server removes the
        // queued item and either converts it into steering or immediately sends
        // it if the active stream already ended. Avoid a second client-side
        // submit here so removal + steering stay atomic.
        onInjectQueuedFollowup?.(queuedItem);
    };

    const handleReturnQueuedFollowup = (queuedItem) => {
        if (!queuedItem) return;
        const restored = buildReturnedQueuedDraft(queuedItem?.content || '');
        setSubmitError(null);
        setSubmitNotice(null);
        setMediaFiles([]);
        onSetFileRefs?.(restored.fileRefs);
        onSetMessageRefs?.(restored.messageRefs);
        setContent(restored.content);
        onRemoveQueuedFollowup?.(queuedItem);
        requestAnimationFrame(() => {
            resizeTextarea();
            const textarea = textareaRef.current;
            if (!textarea) return;
            const len = restored.content.length;
            textarea.selectionStart = len;
            textarea.selectionEnd = len;
            textarea.focus();
        });
    };

    const handlePopupKeyboardEvent = useCallback((e) => {
        if (searchMode || (!showModelPopup && !showSessionPopup) || e?.isComposing) return false;
        const consume = () => {
            e.preventDefault?.();
            e.stopPropagation?.();
        };
        const resetPopupTypeahead = () => {
            popupTypeaheadRef.current = { value: '', updatedAt: 0 };
        };
        if (e.key === 'Escape') {
            consume();
            resetPopupTypeahead();
            if (showModelPopup) setShowModelPopup(false);
            if (showSessionPopup) setShowSessionPopup(false);
            return true;
        }
        if (showModelPopup) {
            if (e.key === 'ArrowDown') {
                consume();
                resetPopupTypeahead();
                if (modelOptions.length > 0) setModelPopupIndex((idx) => (idx + 1) % modelOptions.length);
                return true;
            }
            if (e.key === 'ArrowUp') {
                consume();
                resetPopupTypeahead();
                if (modelOptions.length > 0) setModelPopupIndex((idx) => (idx - 1 + modelOptions.length) % modelOptions.length);
                return true;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && modelOptions.length > 0) {
                consume();
                resetPopupTypeahead();
                void handleSelectModel(modelOptions[Math.max(0, Math.min(modelPopupIndex, modelOptions.length - 1))]);
                return true;
            }
            if (isPopupTypeaheadKey(e) && modelOptions.length > 0) {
                consume();
                const nextBuffer = updatePopupTypeaheadBuffer(popupTypeaheadRef.current, e.key);
                popupTypeaheadRef.current = nextBuffer;
                const match = resolvePopupTypeaheadMatch(modelOptions, nextBuffer.value, modelPopupIndex, (item) => getModelPickerOptionSearchLabel(item));
                if (match >= 0) setModelPopupIndex(match);
                return true;
            }
        }
        if (showSessionPopup) {
            if (e.key === 'ArrowDown') {
                consume();
                resetPopupTypeahead();
                if (sessionPopupEntries.length > 0) setSessionPopupIndex((idx) => (idx + 1) % sessionPopupEntries.length);
                return true;
            }
            if (e.key === 'ArrowUp') {
                consume();
                resetPopupTypeahead();
                if (sessionPopupEntries.length > 0) setSessionPopupIndex((idx) => (idx - 1 + sessionPopupEntries.length) % sessionPopupEntries.length);
                return true;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && sessionPopupEntries.length > 0) {
                consume();
                resetPopupTypeahead();
                runSessionPopupEntry(sessionPopupEntries[Math.max(0, Math.min(sessionPopupIndex, sessionPopupEntries.length - 1))]);
                return true;
            }
            if (isPopupTypeaheadKey(e) && sessionPopupEntries.length > 0) {
                consume();
                const nextBuffer = updatePopupTypeaheadBuffer(popupTypeaheadRef.current, e.key);
                popupTypeaheadRef.current = nextBuffer;
                const match = resolvePopupTypeaheadMatch(sessionPopupEntries, nextBuffer.value, sessionPopupIndex, (item) => item.label);
                if (match >= 0) setSessionPopupIndex(match);
                return true;
            }
        }
        return false;
    }, [
        searchMode,
        showModelPopup,
        showSessionPopup,
        modelOptions,
        modelPopupIndex,
        sessionPopupEntries,
        sessionPopupIndex,
        handleSelectModel,
    ]);

    const handleKeyDown = (e) => {
        if (e.isComposing) return;
        if (searchMode && e.key === 'Escape') {
            e.preventDefault();
            setSearchText('');
            onExitSearch?.();
            return;
        }
        if (handlePopupKeyboardEvent(e)) {
            return;
        }
        const currentValue = textareaRef.current?.value ?? (searchMode ? searchText : content);
        if (shouldOpenSessionSwitcherFromBlankCompose(e, currentValue, {
            searchMode,
            showSessionSwitcherButton,
        })) {
            e.preventDefault();
            openSessionPopup();
            return;
        }
        // @agent autocomplete navigation
        if (showMention && mentionMatches.length > 0) {
            const mentionValue = textareaRef.current?.value ?? (searchMode ? searchText : content);
            if (!String(mentionValue || '').match(/^@([a-zA-Z0-9_-]*)$/)) {
                setShowMention(false);
                setMentionMatches([]);
            } else {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setMentionIndex(i => (i + 1) % mentionMatches.length);
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionIndex(i => (i - 1 + mentionMatches.length) % mentionMatches.length);
                    return;
                }
                if (e.key === 'Tab' || e.key === 'Enter') {
                    e.preventDefault();
                    acceptMention(mentionMatches[mentionIndex]);
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowMention(false);
                    setMentionMatches([]);
                    return;
                }
            }
        }
        // Slash autocomplete navigation
        if (showSlash && slashMatches.length > 0) {
            const slashValue = textareaRef.current?.value ?? (searchMode ? searchText : content);
            if (!String(slashValue || '').startsWith('/')) {
                // Stale slash popup; hide and continue with normal key handling.
                setShowSlash(false);
                setSlashMatches([]);
            } else {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSlashIndex(i => (i + 1) % slashMatches.length);
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlashIndex(i => (i - 1 + slashMatches.length) % slashMatches.length);
                    return;
                }
                if (e.key === 'Tab') {
                    e.preventDefault();
                    acceptSlashCommand(slashMatches[slashIndex]);
                    return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                    const hasArgs = currentValue.includes(' ');
                    if (!hasArgs) {
                        e.preventDefault();
                        const cmd = slashMatches[slashIndex];
                        setShowSlash(false);
                        setSlashMatches([]);
                        // If the user hits Enter with only a command fragment, accept
                        // the match and submit in one step to avoid double-Enter.
                        void handleSubmit(cmd.name);
                        return;
                    }
                    // When args are present, allow Enter to fall through to submit.
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowSlash(false);
                    setSlashMatches([]);
                    return;
                }
            }
        }
        if (!searchMode && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
            const textarea = textareaRef.current;
            if (!textarea) return;
            const value = textarea.value || '';
            const atStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0;
            const atEnd = textarea.selectionStart === value.length && textarea.selectionEnd === value.length;
            if ((e.key === 'ArrowUp' && atStart) || (e.key === 'ArrowDown' && atEnd)) {
                const history = historyRef.current;
                if (!history.length) return;
                e.preventDefault();
                let idx = historyIndexRef.current;
                if (e.key === 'ArrowUp') {
                    if (idx === -1) {
                        historyDraftRef.current = value;
                        idx = history.length - 1;
                    } else if (idx > 0) {
                        idx -= 1;
                    }
                    historyIndexRef.current = idx;
                    updateValue(history[idx] || '');
                } else {
                    if (idx === -1) return;
                    if (idx < history.length - 1) {
                        idx += 1;
                        historyIndexRef.current = idx;
                        updateValue(history[idx] || '');
                    } else {
                        historyIndexRef.current = -1;
                        updateValue(historyDraftRef.current || '');
                        historyDraftRef.current = '';
                    }
                }
                requestAnimationFrame(() => {
                    const target = textareaRef.current;
                    if (!target) return;
                    const len = target.value.length;
                    target.selectionStart = len;
                    target.selectionEnd = len;
                });
                return;
            }
        }
        if (e.key === 'Enter' && !e.shiftKey && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (searchMode) {
                if (currentValue.trim()) {
                    onSearch?.(currentValue.trim(), searchScope);
                }
            } else {
                void handleSubmit(currentValue, "steer");
            }
            return;
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (searchMode) {
                if (currentValue.trim()) {
                    onSearch?.(currentValue.trim(), searchScope);
                }
            } else {
                void handleSubmit(currentValue);
            }
        }
    };

    const addMediaFiles = (files) => {
        const list = Array.from(files || []).filter((file) => file instanceof File && !String(file.name || '').startsWith('.DS_Store'));
        if (!list.length) return;
        setMediaFiles((current) => [...current, ...list]);
        setSubmitError(null);
    };

    const handleFileChange = (e) => {
        addMediaFiles(e.target.files);
        e.target.value = '';
    };

    const handleDragEnter = (e) => {
        if (searchMode) return;
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current += 1;
        setIsDragActive(true);
    };

    const handleDragLeave = (e) => {
        if (searchMode) return;
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) setIsDragActive(false);
    };

    const handleDragOver = (e) => {
        if (searchMode) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        setIsDragActive(true);
    };

    const handleDrop = (e) => {
        if (searchMode) return;
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = 0;
        setIsDragActive(false);
        addMediaFiles(e.dataTransfer?.files || []);
    };

    const handlePaste = (e) => {
        if (searchMode) return;
        const items = e.clipboardData?.items;
        if (!items || !items.length) return;
        const files = [];
        for (const item of items) {
            if (item.kind !== 'file') continue;
            const file = item.getAsFile?.();
            if (file) files.push(file);
        }
        if (files.length > 0) {
            e.preventDefault();
            addMediaFiles(files);
        }
    };

    const removeMediaFile = (index) => {
        setMediaFiles((current) => current.filter((_, idx) => idx !== index));
    };

    const clearAllAttachmentRefs = () => {
        setSubmitError(null);
        setMediaFiles([]);
        onClearFileRefs?.();
        onClearMessageRefs?.();
    };

    const handleLocation = () => {
        if (!navigator.geolocation) {
            alert('Geolocation is not available in this browser.');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude, accuracy } = pos.coords;
                const coords = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
                const accuracyLabel = Number.isFinite(accuracy) ? ` ±${Math.round(accuracy)}m` : '';
                const mapLink = `https://maps.google.com/?q=${latitude},${longitude}`;
                const snippet = `Location: ${coords}${accuracyLabel} ${mapLink}`;
                appendToValue(snippet);
            },
            (err) => {
                const message = err?.message || 'Unable to retrieve location.';
                alert(`Location error: ${message}`);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    };

    useEffect(() => {
        if (!showModelPopup) return;

        popupTypeaheadRef.current = { value: '', updatedAt: 0 };
        setLoadingModels(true);
        getAgentModels(currentChatJid)
            .then((payload) => {
                setModelOptions(normalizeModelPickerOptions(payload));
                emitModelState(payload);
            })
            .catch((error) => {
                console.warn('Failed to load model list:', error);
                setModelOptions([]);
            })
            .finally(() => {
                setLoadingModels(false);
            });
    }, [showModelPopup, activeModel]);

    useEffect(() => {
        if (searchMode) {
            setShowModelPopup(false);
            setShowSessionPopup(false);
            setShowSlash(false);
            setSlashMatches([]);
            setShowMention(false);
            setMentionMatches([]);
        }
    }, [searchMode]);

    useEffect(() => {
        if (showSessionPopup && !showSessionSwitcherButton) {
            setShowSessionPopup(false);
        }
    }, [showSessionPopup, showSessionSwitcherButton]);

    useEffect(() => {
        if (!showModelPopup) return;
        const activeIndex = modelOptions.findIndex((model) => model?.label === activeModel);
        setModelPopupIndex(activeIndex >= 0 ? activeIndex : 0);
    }, [showModelPopup, modelOptions, activeModel]);

    useEffect(() => {
        if (!showSessionPopup) return;
        setSessionPopupIndex(findFirstEnabledPopupIndex(sessionPopupEntries));
        popupTypeaheadRef.current = { value: '', updatedAt: 0 };
    }, [showSessionPopup, currentChatJid]);

    useEffect(() => {
        if (!showModelPopup) return;

        const onPointerDown = (event) => {
            const popup = modelPopupRef.current;
            const hint = modelHintRef.current;
            const target = event.target;
            if (popup && popup.contains(target)) return;
            if (hint && hint.contains(target)) return;
            setShowModelPopup(false);
        };

        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [showModelPopup]);

    useEffect(() => {
        if (!showSessionPopup) return;

        const onPointerDown = (event) => {
            const popup = sessionPopupRef.current;
            const trigger = sessionTriggerRef.current;
            const target = event.target;
            if (popup && popup.contains(target)) return;
            if (trigger && trigger.contains(target)) return;
            setShowSessionPopup(false);
        };

        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [showSessionPopup]);

    useEffect(() => {
        if (searchMode || (!showModelPopup && !showSessionPopup)) return;
        const onKeyDown = (event) => {
            handlePopupKeyboardEvent(event);
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [searchMode, showModelPopup, showSessionPopup, handlePopupKeyboardEvent]);

    useEffect(() => {
        if (!showModelPopup) return;
        const popup = modelPopupRef.current;
        popup?.focus?.();
        const active = popup?.querySelector?.('.compose-model-popup-item.active');
        active?.scrollIntoView?.({ block: 'nearest' });
    }, [showModelPopup, modelPopupIndex, modelOptions]);

    useEffect(() => {
        if (!showSessionPopup) return;
        const popup = sessionPopupRef.current;
        popup?.focus?.();
        const active = popup?.querySelector?.('.compose-model-popup-item.active');
        active?.scrollIntoView?.({ block: 'nearest' });
    }, [showSessionPopup, sessionPopupIndex, sessionPopupEntries.length]);

    useEffect(() => {
        if (!showMention || !mentionRef.current) return;
        const popup = mentionRef.current;
        const active = popup.querySelector?.('.slash-item.active');
        active?.scrollIntoView?.({ block: 'nearest' });
    }, [showMention, mentionIndex, mentionMatches.length]);

    useEffect(() => {
        if (!showSlash || !slashRef.current) return;
        const popup = slashRef.current;
        const active = popup.querySelector?.('.slash-item.active');
        active?.scrollIntoView?.({ block: 'nearest' });
    }, [showSlash, slashIndex, slashMatches.length]);

    useEffect(() => {
        const updateFooterWidth = () => {
            const width = footerRef.current?.clientWidth || 0;
            setFooterWidth((current) => (current === width ? current : width));
        };

        updateFooterWidth();

        const footer = footerRef.current;
        let observerFrame = 0;
        const scheduleFooterResize = () => {
            if (observerFrame) {
                cancelAnimationFrame(observerFrame);
            }
            observerFrame = requestAnimationFrame(() => {
                observerFrame = 0;
                updateFooterWidth();
            });
        };

        let observer = null;
        if (footer && typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(() => scheduleFooterResize());
            observer.observe(footer);
        }

        if (typeof window !== 'undefined') {
            window.addEventListener('resize', scheduleFooterResize);
        }

        return () => {
            if (observerFrame) {
                cancelAnimationFrame(observerFrame);
            }
            observer?.disconnect?.();
            if (typeof window !== 'undefined') {
                window.removeEventListener('resize', scheduleFooterResize);
            }
        };
    }, [searchMode, activeModel, currentSessionAgent?.agent_name, showSessionSwitcherButton, contextUsage?.percent]);

    // Auto-resize textarea
    const handleInput = (e) => {
        const value = e.target.value;
        setSubmitError(null);
        setSubmitNotice(null);
        if (showSessionPopup) setShowSessionPopup(false);
        resizeTextarea(e.target);
        if (shouldRouteComposeValueToSessionSwitcher(value, {
            searchMode,
            showSessionSwitcherButton,
        })) {
            updateValue('');
            requestAnimationFrame(() => {
                const textarea = textareaRef.current;
                if (!textarea) return;
                textarea.value = '';
                textarea.selectionStart = 0;
                textarea.selectionEnd = 0;
                textarea.focus();
            });
            openSessionPopup();
            return;
        }
        updateValue(value);
    };

    useEffect(() => {
        requestAnimationFrame(() => resizeTextarea());
    }, [content, searchText, searchMode]);

    useEffect(() => {
        if (!statusNoticeIsCompaction) return;
        setStatusNoticeNowMs(Date.now());
        const timer = setInterval(() => setStatusNoticeNowMs(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [statusNoticeIsCompaction, statusNotice?.started_at, statusNotice?.startedAt]);

    useEffect(() => {
        setExtensionWorkingFrameIndex(0);
        if (extensionWorkingIndicator?.mode !== 'custom' || !Array.isArray(extensionWorkingIndicator.frames) || extensionWorkingIndicator.frames.length <= 1) {
            return undefined;
        }
        const intervalMs = typeof extensionWorkingIndicator.intervalMs === 'number' && Number.isFinite(extensionWorkingIndicator.intervalMs) && extensionWorkingIndicator.intervalMs > 0
            ? extensionWorkingIndicator.intervalMs
            : 120;
        const timer = setInterval(() => {
            setExtensionWorkingFrameIndex((prev) => (prev + 1) % extensionWorkingIndicator.frames.length);
        }, intervalMs);
        return () => clearInterval(timer);
    }, [extensionWorkingIndicator]);

    useEffect(() => {
        if (searchMode) return;
        updateMentionAutocomplete(content);
    }, [mentionAgents, currentChatJid, content, searchMode]);

    return html`
        <div class="compose-box">
            ${showQueueStack && !searchMode && html`
                <${QueuedFollowupStack}
                    items=${followupQueueItems}
                    onInjectQueuedFollowup=${handleInjectQueuedFollowup}
                    onRemoveQueuedFollowup=${onRemoveQueuedFollowup}
                    onMoveQueuedFollowup=${onMoveQueuedFollowup}
                    onReturnQueuedFollowup=${handleReturnQueuedFollowup}
                    onOpenFilePill=${onOpenFilePill}
                />
            `}
            ${extensionWorkingDisplay.visible && html`
                <div class="compose-inline-status extension-working" role="status" aria-live="polite">
                    <div class="compose-inline-status-row">
                        ${extensionWorkingDisplay.indicatorText
                            ? html`<span class="compose-inline-status-glyph" aria-hidden="true">${extensionWorkingDisplay.indicatorText}</span>`
                            : extensionWorkingDisplay.animateDot
                                ? html`<span class=${buildComposeStatusDotClass({ pulsing: true })} aria-hidden="true"></span>`
                                : null}
                        <span class="compose-inline-status-title">${extensionWorkingDisplay.title}</span>
                    </div>
                </div>
            `}
            ${statusNotice && !statusNoticeIsCompaction && html`
                <div
                    class="compose-inline-status"
                    role="status"
                    aria-live="polite"
                    title=${statusNoticeDetail || ''}
                >
                    <div class="compose-inline-status-row">
                        <span class=${buildComposeStatusDotClass({ pulsing: false })} aria-hidden="true"></span>
                        <span class="compose-inline-status-title">${statusNoticeTitle}</span>
                        ${statusNoticeElapsedLabel && html`<span class="compose-inline-status-elapsed">${statusNoticeElapsedLabel}</span>`}
                    </div>
                    ${statusNoticeDetail && html`<div class="compose-inline-status-detail">${statusNoticeDetail}</div>`}
                </div>
            `}
            ${submitNotice && html`
                <div class="compose-inline-status compose-command-notice" role="status" aria-live="polite">
                    <div class="compose-inline-status-detail compose-command-notice-text" dangerouslySetInnerHTML=${{ __html: renderMarkdown(submitNotice) }}></div>
                </div>
            `}
            <div
                class=${`compose-input-wrapper${isDragActive ? ' drag-active' : ''}`}
                onDragEnter=${handleDragEnter}
                onDragOver=${handleDragOver}
                onDragLeave=${handleDragLeave}
                onDrop=${handleDrop}
            >
                <div class="compose-input-main">
                    ${hasAttachments && html`
                        <div class="compose-file-refs">
                            ${messageRefs.map((id) => {
                                return html`
                                    <${FilePill}
                                        key=${'msg-' + id}
                                        prefix="compose"
                                        label=${'msg:' + id}
                                        title=${'Message reference: ' + id}
                                        removeTitle="Remove reference"
                                        icon="message"
                                        onRemove=${() => onRemoveMessageRef?.(id)}
                                    />
                                `;
                            })}
                            ${fileRefs.map((path) => {
                                const label = path.split('/').pop() || path;
                                return html`
                                    <${FilePill}
                                        prefix="compose"
                                        label=${label}
                                        title=${path}
                                        onClick=${() => onOpenFilePill?.(path)}
                                        removeTitle="Remove file"
                                        onRemove=${() => onRemoveFileRef?.(path)}
                                    />
                                `;
                            })}
                            ${mediaFiles.map((file, index) => {
                                const label = file?.name || `attachment-${index + 1}`;
                                return html`
                                    <${FilePill}
                                        key=${label + index}
                                        prefix="compose"
                                        label=${label}
                                        title=${label}
                                        removeTitle="Remove attachment"
                                        onRemove=${() => removeMediaFile(index)}
                                    />
                                `;
                            })}
                            <button
                                type="button"
                                class="compose-clear-attachments-btn"
                                onClick=${clearAllAttachmentRefs}
                                title="Clear all attachments and references"
                                aria-label="Clear all attachments and references"
                            >
                                Clear all
                            </button>
                        </div>
                    `}
                    <textarea
                        ref=${textareaRef}
                        placeholder=${searchMode ? "Search (Enter to run)..." : "Message (Enter to send, Shift+Enter for newline)..."}
                        value=${searchMode ? searchText : content}
                        onInput=${handleInput}
                        onKeyDown=${handleKeyDown}
                        onPaste=${handlePaste}
                        onFocus=${onFocus}
                        onClick=${onFocus}
                        rows="1"
                    />
                    ${showMention && mentionMatches.length > 0 && html`
                        <div class="slash-autocomplete" ref=${mentionRef}>
                            ${mentionMatches.map((agent, i) => html`
                                <div
                                    key=${agent.chat_jid || agent.agent_name}
                                    class=${`slash-item${i === mentionIndex ? ' active' : ''}`}
                                    onMouseDown=${(e) => { e.preventDefault(); acceptMention(agent); }}
                                    onMouseEnter=${() => setMentionIndex(i)}
                                >
                                    <span class="slash-name">@${agent.agent_name}</span>
                                    <span class="slash-desc">${agent.chat_jid || 'Active agent'}</span>
                                </div>
                            `)}
                        </div>
                    `}
                    ${showSlash && slashMatches.length > 0 && html`
                        <div class="slash-autocomplete" ref=${slashRef}>
                            ${slashMatches.map((cmd, i) => html`
                                <div
                                    key=${cmd.name}
                                    class=${`slash-item${i === slashIndex ? ' active' : ''}`}
                                    onMouseDown=${(e) => { e.preventDefault(); acceptSlashCommand(cmd); }}
                                    onMouseEnter=${() => setSlashIndex(i)}
                                >
                                    <span class="slash-name">${cmd.name}</span>
                                    <span class="slash-desc">${cmd.description}</span>
                                </div>
                            `)}
                        </div>
                    `}
                    ${showModelPopup && !searchMode && html`
                        <div class="compose-model-popup" ref=${modelPopupRef} tabIndex="-1" onKeyDown=${handlePopupKeyboardEvent}>
                            <div class="compose-model-popup-title">Select model</div>
                            <div class="compose-model-popup-menu" role="menu" aria-label="Model picker">
                                ${loadingModels && html`
                                    <div class="compose-model-popup-empty">Loading models…</div>
                                `}
                                ${!loadingModels && modelOptions.length === 0 && html`
                                    <div class="compose-model-popup-empty">No models available.</div>
                                `}
                                ${!loadingModels && modelOptions.map((modelOption, index) => {
                                    const modelLabel = typeof modelOption?.label === 'string' ? modelOption.label : '';
                                    const contextWindowLabel = formatModelPickerContextWindow(modelOption?.contextWindow);
                                    return html`
                                        <button
                                            key=${modelLabel}
                                            type="button"
                                            role="menuitem"
                                            class=${`compose-model-popup-item compose-model-popup-model-item${modelPopupIndex === index ? ' active' : ''}${activeModel === modelLabel ? ' current-model' : ''}`}
                                            onClick=${() => { void handleSelectModel(modelOption); }}
                                            disabled=${switchingModel}
                                            title=${[modelLabel, contextWindowLabel].filter(Boolean).join(' • ')}
                                        >
                                            <span class="compose-model-popup-model-label">${formatModelPickerDisplayLabel(modelLabel, modelOption?.contextWindow)}</span>
                                        </button>
                                    `;
                                })}
                            </div>
                            <div class="compose-model-popup-actions">
                                <button
                                    type="button"
                                    class="compose-model-popup-btn"
                                    onClick=${() => { void handleCycleModel(); }}
                                    disabled=${switchingModel}
                                >
                                    Next model
                                </button>
                            </div>
                        </div>
                    `}
                    ${showSessionPopup && !searchMode && html`
                        <div class="compose-model-popup" ref=${sessionPopupRef} tabIndex="-1" onKeyDown=${handlePopupKeyboardEvent}>
                            <div class="compose-model-popup-title">Manage sessions & agents</div>
                            <div class="compose-model-popup-menu" role="menu" aria-label="Sessions and agents">
                                ${html`
                                    <div class="compose-model-popup-item current" role="note" aria-live="polite">
                                        ${(() => {
                                            return formatCurrentBranchLabel(currentSessionAgent, currentChatJid);
                                        })()}
                                    </div>
                                `}
                                ${!hasSwitchableChatAgents && html`
                                    <div class="compose-model-popup-empty">No other sessions yet.</div>
                                `}
                                ${hasSwitchableChatAgents && switchableChatAgents.map((chat, listIndex) => {
                                    const archived = Boolean(chat.archived_at);
                                    const isRoot = chat.chat_jid === (chat.root_chat_jid || chat.chat_jid);
                                    const canPrune = !isRoot && !chat.is_active && !archived && typeof onDeleteSession === 'function';
                                    const canPurgeArchived = archived && !isRoot && canPurgeArchivedSession;
                                    const label = formatBranchPickerLabel(chat, { currentChatJid });
                                    return html`
                                        <div key=${chat.chat_jid} class=${`compose-model-popup-item-row${archived ? ' archived' : ''}`}>
                                            <button
                                                type="button"
                                                role="menuitem"
                                                class=${`compose-model-popup-item${archived ? ' archived' : ''}${sessionPopupIndex === listIndex ? ' active' : ''}`}
                                                onClick=${() => {
                                                    if (archived) {
                                                        void handleRestoreSession(chat.chat_jid);
                                                        return;
                                                    }
                                                    handleSessionSwitch(chat.chat_jid);
                                                }}
                                                disabled=${archived ? !canRestoreSession : !canSwitchSession}
                                                title=${archived ? `Restore archived ${`@${chat.agent_name}`}` : `Switch to ${`@${chat.agent_name}`}`}
                                            >
                                                ${label}
                                            </button>
                                            ${(canPrune || canPurgeArchived) && html`
                                                <button
                                                    type="button"
                                                    class="compose-model-popup-item-delete"
                                                    title=${canPurgeArchived ? 'Permanently delete this archived branch' : 'Delete this branch'}
                                                    aria-label=${canPurgeArchived ? `Permanently delete @${chat.agent_name}` : `Delete @${chat.agent_name}`}
                                                    onClick=${(e) => {
                                                        e.stopPropagation();
                                                        setShowSessionPopup(false);
                                                        if (canPurgeArchived) {
                                                            void onPurgeArchivedSession?.(chat.chat_jid);
                                                            return;
                                                        }
                                                        void onDeleteSession(chat.chat_jid);
                                                    }}
                                                >
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                                        <line x1="18" y1="6" x2="6" y2="18" />
                                                        <line x1="6" y1="6" x2="18" y2="18" />
                                                    </svg>
                                                </button>
                                            `}
                                        </div>
                                    `;
                                })}
                            </div>
                            ${(canCreateSession || canRenameSession || canDeleteSession) && html`
                                <div class="compose-model-popup-actions">
                                    ${canCreateSession && html`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn primary${sessionPopupEntries.findIndex((entry) => entry.key === 'action:new') === sessionPopupIndex ? ' active' : ''}`}
                                            onClick=${() => { void handleCreateSession(); }}
                                            title="Create a new agent/session branch from this chat"
                                        >
                                            New
                                        </button>
                                    `}
                                    ${canRenameSession && html`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${sessionPopupEntries.findIndex((entry) => entry.key === 'action:rename') === sessionPopupIndex ? ' active' : ''}`}
                                            onClick=${(e) => { void handleRenameSession(e); }}
                                            title="Rename the current branch handle"
                                            disabled=${renameInProgress}
                                        >
                                            Rename current…
                                        </button>
                                    `}
                                    ${canDeleteSession && html`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn danger${sessionPopupEntries.findIndex((entry) => entry.key === 'action:delete') === sessionPopupIndex ? ' active' : ''}`}
                                            onClick=${() => { void handleDeleteSession(); }}
                                            title="Delete (prune) current agent/session branch"
                                        >
                                            Delete current…
                                        </button>
                                    `}
                                </div>
                            `}
                        </div>
                    `}
                </div>
                <div class="compose-footer" ref=${footerRef}>
                    ${showComposeMetaRow && html`
                    <div class="compose-meta-row">
                        ${showModelPickerHint && html`
                            <div class="compose-model-meta">
                                <button
                                    ref=${modelHintRef}
                                    type="button"
                                    class="compose-model-hint compose-model-hint-btn"
                                    title=${modelHintTitle}
                                    aria-label="Open model picker"
                                    onClick=${toggleModelPopup}
                                    disabled=${switchingModel}
                                >
                                    ${switchingModel ? 'Switching…' : modelHintLabel}
                                </button>
                                <div class="compose-model-meta-subline">
                                    ${!switchingModel && modelUsageSectionLabel && html`
                                        <span class="compose-model-usage-hint" title=${modelHintTitle}>
                                            ${modelUsageSectionLabel}
                                        </span>
                                    `}
                                </div>
                            </div>
                        `}
                        ${!searchMode && contextUsage && contextUsage.percent != null && html`
                            <${ContextPie}
                                usage=${contextUsage}
                                onCompact=${handleContextCompact}
                                compactionLabel=${statusNoticeIsCompaction ? statusNoticeElapsedLabel || '0:00' : ''}
                                compactionTitle=${statusNoticeIsCompaction ? (statusNoticeTitle || 'Smart compaction') : ''}
                            />
                        `}
                    </div>
                    `}
                    <div class="compose-actions ${searchMode ? 'search-mode' : ''}">
                    ${showSessionSwitcherButton && html`
                        <div
                            ref=${sessionTriggerRef}
                            class="compose-session-trigger-group"
                        >
                            ${currentSessionAgent?.agent_name && html`
                                <button
                                    type="button"
                                    class=${`compose-session-trigger compose-session-trigger-pill${showSessionPopup ? ' active' : ''}`}
                                    onClick=${toggleSessionPopup}
                                    title=${currentSessionAgent?.chat_jid || currentChatJid}
                                    aria-label=${`Manage sessions for @${currentSessionAgent.agent_name}`}
                                    aria-expanded=${showSessionPopup ? 'true' : 'false'}
                                >
                                    <span class="compose-current-agent-label active">@${currentSessionAgent.agent_name}</span>
                                </button>
                            `}
                            <button
                                type="button"
                                class=${`compose-session-trigger compose-session-trigger-icon-btn${showSessionPopup ? ' active' : ''}`}
                                onClick=${toggleSessionPopup}
                                title=${currentSessionAgent?.chat_jid || currentChatJid}
                                aria-label=${currentSessionAgent?.agent_name
                                    ? `Manage sessions for @${currentSessionAgent.agent_name}`
                                    : 'Manage Sessions/Agents'}
                                aria-expanded=${showSessionPopup ? 'true' : 'false'}
                            >
                                <span class="compose-session-trigger-icon" aria-hidden="true">
                                    <svg class="compose-mention-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" focusable="false">
                                        <circle cx="12" cy="12" r="4.25" />
                                        <path d="M16.25 7.75v5.4a2.1 2.1 0 0 0 4.2 0V12a8.45 8.45 0 1 0-4.2 7.33" />
                                    </svg>
                                </span>
                            </button>
                        </div>
                    `}
                    ${searchMode && html`
                        <label class="compose-search-scope-wrap" title="Search scope">
                            <span class="compose-search-scope-label">Scope</span>
                            <select
                                class="compose-search-scope-select"
                                value=${searchScope}
                                onChange=${(e) => onSearchScopeChange?.(e.currentTarget.value)}
                            >
                                <option value="current">Current</option>
                                <option value="root">Branch family</option>
                                <option value="all">All chats</option>
                            </select>
                        </label>
                    `}
                    <button
                        class="icon-btn search-toggle"
                        onClick=${searchMode ? onExitSearch : onEnterSearch}
                        title=${searchMode ? "Close search" : "Search"}
                    >
                        ${searchMode ? html`
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                        ` : html`
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="11" cy="11" r="8"/>
                                <path d="M21 21l-4.35-4.35"/>
                            </svg>
                        `}
                    </button>
                    ${canShareLocation && !searchMode && html`
                        <button
                            class="icon-btn location-btn"
                            onClick=${handleLocation}
                            title="Share location"
                            type="button"
                            disabled=${false}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M12 2a14 14 0 0 1 0 20a14 14 0 0 1 0-20" />
                                <path d="M2 12h20" />
                            </svg>
                        </button>
                    `}
                    ${notificationsAvailable && !searchMode && html`
                        <button
                            class=${`icon-btn notification-btn${notificationActive ? ' active' : ''}`}
                            onClick=${onToggleNotifications}
                            title=${notificationTitle}
                            type="button"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                            </svg>
                        </button>
                    `}
                    ${!searchMode && html`
                        ${activeEditorPath && onAttachEditorFile && html`
                            <button
                                class="icon-btn attach-editor-btn"
                                onClick=${onAttachEditorFile}
                                title=${`Attach open file: ${activeEditorPath}`}
                                type="button"
                                disabled=${fileRefs.includes(activeEditorPath)}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                            </button>
                        `}
                        <label class="icon-btn" title="Attach file">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            <input type="file" multiple hidden onChange=${handleFileChange} />
                        </label>
                    `}
                    ${(connectionStatus !== 'connected' || !searchMode) && html`
                        <div class="compose-send-stack">
                            ${connectionStatus !== 'connected' && html`
                                <span class="compose-connection-status connection-status ${connectionStatusPresentation.statusClass}" title=${connectionStatusTitle}>
                                    ${connectionStatusLabel}
                                </span>
                            `}
                            ${!searchMode && html`
                                <button 
                                    class=${submitButtonState.className}
                                    type="button"
                                    onClick=${() => {
                                        void handleSubmit();
                                    }}
                                    disabled=${submitButtonState.disabled}
                                    title=${submitButtonState.title}
                                    aria-label=${submitButtonState.ariaLabel}
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                                </button>
                                ${abortButtonState && html`
                                    <button 
                                        class=${abortButtonState.className}
                                        type="button"
                                        onClick=${() => {
                                            if (isComposeSubmitAbortMode(abortButtonState.mode)) {
                                                void handleSubmit('/abort', 'steer');
                                            }
                                        }}
                                        disabled=${abortButtonState.disabled}
                                        title=${abortButtonState.title}
                                        aria-label=${abortButtonState.ariaLabel}
                                    >
                                        ${abortButtonState.mode === 'compacting'
                                            ? html`
                                                <span class="compose-submit-spinner" aria-hidden="true">
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                                        <circle class="compose-submit-spinner-ring" cx="12" cy="12" r="10.5" stroke-width="2.25" stroke-linecap="round"></circle>
                                                        <rect class="compose-submit-spinner-stop" x="6" y="6" width="12" height="12" rx="0" fill="currentColor"></rect>
                                                    </svg>
                                                </span>
                                            `
                                            : html`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2.5"/></svg>`}
                                    </button>
                                `}
                            `}
                        </div>
                    `}
                </div>
            </div>
        </div>
        </div>
    `;
}
