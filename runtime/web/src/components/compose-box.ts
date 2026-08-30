import { html, useRef, useState, useEffect, useCallback, useMemo } from '../vendor/preact-htm.js';
import { useTranslation } from '../utils/i18n.js';
import { findPopupTypeaheadMatch, isPopupTypeaheadKey, resolvePopupTypeaheadMatch, updatePopupTypeaheadBuffer } from '../ui/popup-typeahead.js';
import { getAgentModels, sendAgentMessage } from '../api.js';
import { uploadFileBatch, uploadMedia } from '../ui/upload-transfers.js';
import { getLocalStorageItem, setLocalStorageItem } from '../utils/storage.js';
import { buildMentionValue, filterMentionAgents, parseMentionAutocompleteQuery } from '../ui/agent-mentions.js';
import { filterSessionPickerChats, formatSessionPickerMetrics, groupSessionPickerChats, moveSessionPickerIndex, resolveSessionPickerSearchInitialIndex, shouldOpenSessionSwitcherFromBlankCompose, shouldRouteComposeValueToSessionSwitcher } from '../ui/compose-session-switcher.js';
import {
    readSessionPickerPreferences,
    SESSION_PICKER_PREFERENCES_EVENT,
    togglePinnedSessionChatJid,
} from '../ui/session-picker-preferences.ts';
import { formatBranchPickerLabel, getBranchLifecycleBadges, normalizeHandle } from '../ui/branch-lifecycle.js';
import { buildComposeStatusDotClass } from '../ui/status-dot.js';
import { getStatusElapsedLabel, isCompactionStatus, resolveStatusPanelTitle } from '../ui/status-duration.js';
import { useConnectionStatusPresentation } from '../ui/connection-status.js';
import { FilePill } from './file-pill.js';
import { refreshAgentModelStateBestEffort } from './compose-model-refresh.js';
import { renderMarkdown } from '../markdown.js';
import { requestOpenSettingsDialog } from './settings-dialog-events.js';
import { ClassicModelPicker } from './model-picker.ts';
import {
    buildModelSearchDocument,
    calculateModelContextFit,
    normaliseModelCatalogue,
} from '../ui/model-catalogue.ts';
import {
    MODEL_CATALOGUE_PREFERENCES_EVENT,
    normalizeModelCataloguePreferenceKey,
    readModelCataloguePreferences,
    recordRecentModelKey,
    toModelCatalogueNormalisePreferences,
    togglePinnedModelKey,
} from '../ui/model-catalogue-preferences.ts';
import {
    describeSpeechRecognitionError,
    extractSpeechRecognitionText,
    getSpeechInputSupport,
    mergeSpeechComposeText,
} from '../ui/compose-speech.ts';

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
  { name: "/quota", description: "Show cached provider quota / rate-limit usage" },
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
  { name: "/rollup", description: "Merge the current branch chat back into its parent chat" },
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
  { name: "/help", description: "Open keyboard shortcuts help" },
  { name: "/commands", description: "List available commands" },
  { name: "/skill:", description: "Run a workspace skill (e.g. /skill:visual-artifact-generator, /skill:web-search)" },
];

const COMPOSE_HISTORY_STORAGE_KEY = 'piclaw_compose_history';
const COMPOSE_HEIGHT_STORAGE_KEY = 'piclaw_compose_height';
const COMPOSE_MIN_HEIGHT_MOBILE = 50;
const COMPOSE_MIN_HEIGHT_DESKTOP = 70;
const COMPOSE_AUTO_MAX_HEIGHT_CAP = 300;
const COMPOSE_MANUAL_MAX_HEIGHT_CAP = 520;

function getComposeMinHeight() {
    if (typeof window === 'undefined') return COMPOSE_MIN_HEIGHT_DESKTOP;
    return window.innerWidth >= 1024 ? COMPOSE_MIN_HEIGHT_DESKTOP : COMPOSE_MIN_HEIGHT_MOBILE;
}

function getComposeAutoMaxHeight() {
    if (typeof window === 'undefined') return COMPOSE_AUTO_MAX_HEIGHT_CAP;
    return Math.min(Math.floor(window.innerHeight * 0.40), COMPOSE_AUTO_MAX_HEIGHT_CAP);
}

function getComposeManualMaxHeight() {
    if (typeof window === 'undefined') return COMPOSE_MANUAL_MAX_HEIGHT_CAP;
    return Math.min(Math.floor(window.innerHeight * 0.50), COMPOSE_MANUAL_MAX_HEIGHT_CAP);
}

function clampComposeManualHeight(height) {
    const min = getComposeMinHeight();
    const max = Math.max(min, getComposeManualMaxHeight());
    return Math.min(Math.max(Math.round(Number(height) || min), min), max);
}

function readStoredComposeHeight() {
    const raw = getLocalStorageItem(COMPOSE_HEIGHT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? clampComposeManualHeight(parsed) : null;
}

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

export function resolveSessionPopupChats(activeChatAgents, currentChatJid = null, hiddenChatJids = null) {
    const seen = new Set();
    const hidden = hiddenChatJids instanceof Set
        ? hiddenChatJids
        : new Set(Array.isArray(hiddenChatJids) ? hiddenChatJids : []);
    const chats = [];
    for (const chat of Array.isArray(activeChatAgents) ? activeChatAgents : []) {
        const chatJid = typeof chat?.chat_jid === 'string' ? chat.chat_jid.trim() : '';
        if (!chatJid || seen.has(chatJid) || hidden.has(chatJid)) continue;
        const agentName = typeof chat?.agent_name === 'string' ? chat.agent_name.trim() : '';
        if (!agentName) continue;
        seen.add(chatJid);
        chats.push(chat);
    }
    chats.sort((a, b) => {
        const archivedA = Boolean(a?.archived_at);
        const archivedB = Boolean(b?.archived_at);
        if (archivedA !== archivedB) return archivedA ? 1 : -1;
        const nameA = String(a?.agent_name || '').trim();
        const nameB = String(b?.agent_name || '').trim();
        const byName = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
        if (byName !== 0) return byName;
        const jidA = String(a?.chat_jid || '').trim();
        const jidB = String(b?.chat_jid || '').trim();
        return jidA.localeCompare(jidB, undefined, { sensitivity: 'base' });
    });
    return chats;
}

export function isSessionPopupChatEmphasized(chat) {
    return Boolean(chat?.is_active && !chat?.archived_at);
}

export function resolveSessionPopupInitialIndex(items, currentChatJid = null) {
    const list = Array.isArray(items) ? items : [];
    const normalizedCurrentChatJid = typeof currentChatJid === 'string' ? currentChatJid.trim() : '';
    if (normalizedCurrentChatJid) {
        const currentIndex = list.findIndex((item) => {
            if (item?.disabled) return false;
            if (item?.type !== 'session') return false;
            const chatJid = typeof item?.chat?.chat_jid === 'string' ? item.chat.chat_jid.trim() : '';
            return chatJid === normalizedCurrentChatJid;
        });
        if (currentIndex >= 0) return currentIndex;
    }
    const firstEnabledIndex = list.findIndex((item) => !item?.disabled);
    return firstEnabledIndex >= 0 ? firstEnabledIndex : 0;
}

export function resolveUiOnlyCommandNotice(commandText, response) {
    const message = typeof response?.command?.message === 'string' ? response.command.message.trim() : '';
    if (!response?.ui_only || !message) return null;

    const trimmed = typeof commandText === 'string' ? commandText.trim() : '';
    if (!trimmed.startsWith('/')) return null;

    const parts = trimmed.split(/\s+/).filter(Boolean);
    const slashName = parts[0]?.toLowerCase() || '';
    const hasArgs = parts.length > 1;

    if (!hasArgs && (slashName === '/thinking' || slashName === '/effort')) {
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

export function shouldStartSpeechPushToTalk(event, value, options = {}) {
    if (!event || options.searchMode) return false;
    if (!(event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space')) return false;
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false;
    if (!options.speechButtonVisible || options.speechButtonActive) return false;
    if (!options.canStartSpeech) return false;
    return String(value || '').trim().length === 0;
}

export function shouldStopSpeechPushToTalk(event, active) {
    if (!active || !event) return false;
    return event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space';
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
    // Extension can hide the entire working loader row via setWorkingVisible(false)
    if (workingState?.visible === false) {
        return {
            visible: false,
            title: '',
            indicatorText: null,
            animateDot: false,
            animateSpinner: false,
        };
    }

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
            animateSpinner: false,
        };
    }

    if (indicator?.mode === 'hidden') {
        return {
            visible: Boolean(message),
            title: message || 'Thinking…',
            indicatorText: null,
            animateDot: false,
            animateSpinner: false,
        };
    }

    if (indicator?.mode === 'custom' && Array.isArray(indicator.frames) && indicator.frames.length > 0) {
        const frames = indicator.frames;
        const safeIndex = Number.isFinite(frameIndex) && frameIndex >= 0 ? Math.floor(frameIndex) % frames.length : 0;
        return {
            visible: true,
            title: message || 'Thinking…',
            indicatorText: frames[safeIndex],
            animateDot: false,
            animateSpinner: false,
        };
    }

    return {
        visible: true,
        title: message || 'Thinking…',
        indicatorText: null,
        animateDot: false,
        animateSpinner: true,
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
            data-tooltip=${title}
            aria-label=${title}
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

function finiteNumber(value) {
    if (value == null) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function tokenUsageCacheHitRate(record) {
    if (!record || typeof record !== 'object') return null;
    const explicit = finiteNumber(record.cacheHitRate);
    if (explicit != null) return explicit;
    const input = finiteNumber(record.inputTokens) ?? 0;
    const cacheRead = finiteNumber(record.cacheReadTokens) ?? 0;
    const cacheWrite = finiteNumber(record.cacheWriteTokens) ?? 0;
    const denominator = input + cacheRead + cacheWrite;
    if (record.cacheReadReported === false || denominator <= 0) return null;
    if (cacheRead <= 0 && record.cacheReadReported !== true) return null;
    return (cacheRead / denominator) * 100;
}

function formatCacheHitRate(rate) {
    const numeric = finiteNumber(rate);
    if (numeric == null) return null;
    return `${Math.max(0, Math.min(100, numeric)).toFixed(1)}%`;
}

function formatTokenUsagePart(label, value) {
    const numeric = finiteNumber(value);
    return numeric != null ? `${label} ${formatK(numeric)}` : null;
}

function formatUsageCost(value) {
    const numeric = finiteNumber(value);
    if (numeric == null || numeric < 0) return null;
    return `$${numeric.toFixed(numeric >= 0.01 ? 2 : 4)}`;
}

export function formatOpenRouterKeyUsageTitle(modelUsage) {
    if (modelUsage?.provider !== 'openrouter' || modelUsage?.availability !== 'available') return null;
    return [
        `Key spend: ${formatUsageCost(modelUsage.key_usage_usd) || 'unavailable'}`,
        `Key limit: ${modelUsage.key_limit_configured === true
            ? formatUsageCost(modelUsage.key_limit_usd) || 'unavailable'
            : modelUsage.key_limit_unlimited ? 'not configured (unlimited)' : 'unavailable'}`,
        `Key remaining: ${formatUsageCost(modelUsage.key_limit_remaining_usd) || 'unavailable'}`,
    ].join(' • ');
}

export function resolveComposeRunUsageMeta(contextUsage, activeModel = null) {
    const cacheUsage = contextUsage && typeof contextUsage === 'object' ? contextUsage.cacheUsage : null;
    if (!cacheUsage || typeof cacheUsage !== 'object') return null;
    const latest = cacheUsage.latest && typeof cacheUsage.latest === 'object' ? cacheUsage.latest : null;
    if (!latest) return null;

    const providerLabel = typeof latest.provider === 'string' && latest.provider.trim() ? latest.provider.trim() : null;
    const modelLabel = typeof latest.model === 'string' && latest.model.trim() ? latest.model.trim() : null;
    const requestedModel = modelLabel
        ? (!providerLabel || modelLabel.startsWith(`${providerLabel}/`) ? modelLabel : `${providerLabel}/${modelLabel}`)
        : providerLabel;
    const responseModel = typeof latest.responseModel === 'string' && latest.responseModel.trim()
        ? latest.responseModel.trim()
        : null;
    const sameRequestedModel = areRequestedModelLabelsSame(activeModel, requestedModel);
    const isPreviousModel = Boolean(activeModel && requestedModel && !sameRequestedModel);
    const cacheHitRate = tokenUsageCacheHitRate(latest);
    const formattedRate = formatCacheHitRate(cacheHitRate);
    const cacheLabel = formattedRate ? `CH${formattedRate}` : 'CH—';
    const totalTokens = finiteNumber(latest.totalTokens);
    const cost = formatUsageCost(latest.costTotal);
    const costProvenance = typeof latest.costProvenance === 'string' ? latest.costProvenance : null;
    const costLabel = costProvenance === 'provider_reported' ? cost
        : costProvenance === 'catalogue_estimate' && cost ? `~${cost}`
            : null;
    const runLabel = isPreviousModel ? 'Prev' : 'Last';
    const tokenParts = [
        formatTokenUsagePart('in', latest.inputTokens),
        formatTokenUsagePart('out', latest.outputTokens),
        formatTokenUsagePart('reason', latest.reasoningTokens),
        formatTokenUsagePart('cache-r', latest.cacheReadTokens),
        formatTokenUsagePart('cache-w', latest.cacheWriteTokens),
        formatTokenUsagePart('total', latest.totalTokens),
    ].filter(Boolean).join(', ');
    const costTitle = costProvenance === 'provider_reported' && cost
        ? `Provider-reported cost: ${cost}`
        : costProvenance === 'catalogue_estimate' && cost
            ? `Catalogue cost estimate: ~${cost}`
            : 'Cost unavailable';
    const cacheTitle = formattedRate
        ? `Prompt cache hit: ${formattedRate}`
        : latest.cacheReadReported === false
            ? 'Prompt cache telemetry unavailable'
            : 'Prompt cache hit unavailable';
    const titleParts = [
        `${isPreviousModel ? 'Previous' : 'Latest'} run${requestedModel ? `: ${requestedModel}` : ''}`,
        responseModel && responseModel !== latest.model ? `Response model: ${responseModel}` : null,
        tokenParts || null,
        cacheTitle,
        costTitle,
    ].filter(Boolean);

    return {
        label: [runLabel, totalTokens == null ? null : formatK(totalTokens), cacheLabel, costLabel].filter(Boolean).join(' • '),
        title: titleParts.join(' • '),
        cacheHitRate,
        costTotal: finiteNumber(latest.costTotal),
        costProvenance,
        requestedModel,
        responseModel,
        isPreviousModel,
    };
}

export function resolveComposeCacheHitMeta(contextUsage) {
    const meta = resolveComposeRunUsageMeta(contextUsage);
    return meta?.cacheHitRate == null ? null : meta;
}

function normalizeContextUsageTokens(contextUsage) {
    const tokens = Number(contextUsage?.tokens);
    return Number.isFinite(tokens) && tokens > 0 ? tokens : null;
}

export function getModelPickerContextLimit(modelOption, contextUsage) {
    const contextWindow = Number(modelOption?.contextWindow ?? modelOption?.context_window);
    const normalizedContextWindow = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : null;
    const tokens = normalizeContextUsageTokens(contextUsage);
    if (normalizedContextWindow == null || tokens == null) {
        return {
            blocked: false,
            note: '',
            title: '',
            tokens,
            contextWindow: normalizedContextWindow,
        };
    }
    const contextFit = calculateModelContextFit({ contextWindow: normalizedContextWindow }, { tokens });
    if (contextFit.state !== 'blocked') {
        return {
            blocked: false,
            note: '',
            title: '',
            tokens,
            safetyAdjustedTokens: contextFit.safetyAdjustedTokens,
            contextWindow: normalizedContextWindow,
            effectiveContextWindow: contextFit.effectiveContextWindow,
        };
    }
    return {
        blocked: true,
        note: 'Compact context first',
        title: `Current context uses ${formatK(tokens)} tokens (~${formatK(contextFit.safetyAdjustedTokens)} with estimator safety) plus app/tool overhead, but this model effectively fits about ${formatK(contextFit.effectiveContextWindow)} (${formatK(normalizedContextWindow)} raw). Compact context first, then switch.`,
        tokens,
        safetyAdjustedTokens: contextFit.safetyAdjustedTokens,
        contextWindow: normalizedContextWindow,
        effectiveContextWindow: contextFit.effectiveContextWindow,
    };
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

export function formatModelPickerPricing(pricing) {
    if (!pricing || typeof pricing !== 'object') return '';
    const rates = [
        ['in', pricing.input_per_million ?? pricing.inputPerMillion],
        ['out', pricing.output_per_million ?? pricing.outputPerMillion],
        ['cache-r', pricing.cache_read_per_million ?? pricing.cacheReadPerMillion],
        ['cache-w', pricing.cache_write_per_million ?? pricing.cacheWritePerMillion],
    ].map(([label, value]) => {
        const numeric = finiteNumber(value);
        if (numeric == null || numeric < 0) return null;
        return `${label} $${numeric.toFixed(numeric >= 1 ? 2 : 4).replace(/0+$/, '').replace(/\.$/, '')}`;
    }).filter(Boolean);
    return rates.length > 0 ? `${rates.join(' / ')} per 1M` : '';
}

function normaliseComposeModelCatalogue(payload, contextUsage) {
    const preferences = readModelCataloguePreferences();
    return normaliseModelCatalogue(payload, {
        contextUsage,
        ...toModelCatalogueNormalisePreferences(preferences),
    });
}

export function normalizeModelPickerOptions(payload) {
    const hasStructuredOptions = Array.isArray(payload?.model_options) && payload.model_options.length > 0;
    return normaliseModelCatalogue(payload).map((entry) => ({
        label: entry.key,
        provider: entry.provider,
        id: entry.id,
        name: entry.displayName === entry.key ? null : entry.displayName,
        contextWindow: entry.contextWindow,
        pricing: entry.pricing,
        reasoning: hasStructuredOptions ? entry.reasoning : null,
        ...(entry.current ? { current: true } : {}),
    }));
}

export function getModelPickerOptionSearchLabel(option) {
    if (!option || typeof option !== 'object') return '';
    const [entry] = normaliseModelCatalogue({
        model_options: [{
            label: option.label,
            provider: option.provider,
            id: option.id,
            name: option.name,
            context_window: option.contextWindow,
            pricing: option.pricing,
            reasoning: option.reasoning,
        }],
    });
    return entry ? [
        option.label,
        option.name,
        formatModelPickerContextWindow(option.contextWindow),
        formatModelPickerPricing(option.pricing),
        buildModelSearchDocument(entry),
    ].filter(Boolean).join(' ') : '';
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

function normalizeRoutedModelLabel(value) {
    const label = typeof value === 'string' ? value.trim() : '';
    return label || null;
}

function normalizeComparableModelLabel(value) {
    return normalizeRoutedModelLabel(value)?.toLowerCase() ?? null;
}

function areModelLabelsCompatible(left, right) {
    const a = normalizeComparableModelLabel(left);
    const b = normalizeComparableModelLabel(right);
    if (!a || !b) return false;
    return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function areRequestedModelLabelsSame(left, right) {
    const a = normalizeComparableModelLabel(left);
    const b = normalizeComparableModelLabel(right);
    if (!a || !b) return false;
    return a.includes('/') && b.includes('/') ? a === b : areModelLabelsCompatible(a, b);
}

export function resolveComposeRoutedModelStatus(activeModel, agentModelsPayload) {
    const payload = agentModelsPayload && typeof agentModelsPayload === 'object' ? agentModelsPayload : {};
    const responseModel = normalizeRoutedModelLabel(
        payload.latest_response_model ?? payload.response_model ?? payload.responseModel ?? payload.routed_model ?? payload.routedModel
    );
    if (!responseModel) return null;

    const requestedModel = normalizeRoutedModelLabel(
        payload.latest_requested_model ?? payload.requested_model ?? payload.requestedModel ?? payload.current ?? payload.model ?? activeModel
    );
    if (requestedModel && areModelLabelsCompatible(responseModel, requestedModel)) return null;

    const currentModel = normalizeRoutedModelLabel(activeModel ?? payload.current ?? payload.model);
    if (currentModel && requestedModel && !areRequestedModelLabelsSame(currentModel, requestedModel)) return null;

    return {
        label: `Routed: ${responseModel}`,
        title: requestedModel
            ? `Requested model: ${requestedModel} • Routed model: ${responseModel}`
            : `Routed model: ${responseModel}`,
        requestedModel,
        responseModel,
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
        if (trimmed === 'Messages:' || trimmed.startsWith('Channel:') || trimmed.startsWith('Chat:')) {
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
                if (currentTrimmed.startsWith('Channel:') || currentTrimmed.startsWith('Chat:') || currentTrimmed === 'Messages:') break;
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

function normalizeQueuedFileRef(value) {
    const trimmed = String(value || '').trim();
    const codeWrapped = trimmed.match(/^`([^`]+)`$/);
    return (codeWrapped ? codeWrapped[1] : trimmed).trim();
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
            const normalizedRef = normalizeQueuedFileRef(line.replace(/^\s*-\s+/, '').trim());
            if (normalizedRef) refs.push(normalizedRef);
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

function extractQueuedFolderRefs(value) {
    if (!value) return { content: value, folderRefs: [] };
    const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].trim() === 'Folders:' && lines[i + 1] && /^\s*-\s+/.test(lines[i + 1])) {
            start = i;
            break;
        }
    }
    if (start === -1) return { content: value, folderRefs: [] };
    const refs = [];
    let end = start + 1;
    for (; end < lines.length; end += 1) {
        const line = lines[end];
        if (/^\s*-\s+/.test(line)) {
            const normalizedRef = normalizeQueuedFileRef(line.replace(/^\s*-\s+/, '').trim());
            if (normalizedRef) refs.push(normalizedRef);
        } else if (!line.trim()) {
            break;
        } else {
            break;
        }
    }
    if (refs.length === 0) return { content: value, folderRefs: [] };
    const before = lines.slice(0, start);
    const after = lines.slice(end);
    const cleaned = [...before, ...after].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { content: cleaned, folderRefs: refs };
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
    const withFolders = extractQueuedFolderRefs(withFiles.content || '');
    const withMessages = extractQueuedMessageRefs(withFolders.content || '');
    const withAttachments = extractQueuedAttachmentRefs(withMessages.content || '');
    return {
        text: withAttachments.content || '',
        fileRefs: withFiles.fileRefs,
        folderRefs: withFolders.folderRefs,
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
        folderRefs: [...parsed.folderRefs],
        messageRefs: [...parsed.messageRefs],
        attachmentRefs: [...parsed.attachmentRefs],
    };
}

export function returnQueuedFollowupToEditor(options) {
    const {
        queuedItem,
        buildDraft = buildReturnedQueuedDraft,
        onRemoveQueuedFollowup,
        setSubmitError,
        setSubmitNotice,
        setMediaFiles,
        onSetFileRefs,
        onSetFolderRefs,
        onSetMessageRefs,
        setContent,
        textareaRef,
        resizeTextarea = () => {},
        scheduleTimeout = (callback, delayMs = 0) => setTimeout(callback, delayMs),
        scheduleRaf = (callback) => requestAnimationFrame(callback),
        logger = console,
    } = options || {};

    if (!queuedItem) return false;
    const restored = buildDraft(queuedItem?.content || '');
    const text = restored.content;
    logger?.info?.('[compose-box] Returning queued item to editor', {
        text: text?.slice(0, 80),
        fileRefs: restored.fileRefs?.length,
        folderRefs: restored.folderRefs?.length,
        messageRefs: restored.messageRefs?.length,
    });

    setSubmitError?.(null);
    setSubmitNotice?.(null);
    setMediaFiles?.([]);
    onSetFileRefs?.(restored.fileRefs);
    onSetFolderRefs?.(restored.folderRefs);
    onSetMessageRefs?.(restored.messageRefs);
    setContent?.(text);

    scheduleRaf(() => {
        const textarea = textareaRef?.current;
        if (!textarea) return;
        textarea.value = text;
        // Keep the controlled textarea state in sync even if a render happens
        // before setContent has flushed. Some tests provide a lightweight
        // textarea stub, so only dispatch when a DOM-like surface is present.
        if (typeof textarea.dispatchEvent === 'function') {
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        resizeTextarea();
        const len = text.length;
        textarea.selectionStart = len;
        textarea.selectionEnd = len;
        textarea.focus();
    });

    scheduleTimeout(() => {
        try {
            onRemoveQueuedFollowup?.(queuedItem);
        } catch (error) {
            logger?.warn?.('[compose-box] Failed to remove returned queued follow-up.', error);
        }
    }, 0);

    return true;
}

export function QueuedFollowupStack({
    items = [],
    onInjectQueuedFollowup,
    onRemoveQueuedFollowup,
    onMoveQueuedFollowup,
    onReturnQueuedFollowup,
    onOpenFilePill,
}) {
    const { t } = useTranslation();
    if (!Array.isArray(items) || items.length === 0) return null;
    return html`
        <div class="compose-queue-stack">
            ${items.map((item, index) => {
                const rowText = typeof item?.content === 'string' ? item.content : '';
                const parsed = parseQueuedContent(rowText);
                if (!parsed.text.trim() && parsed.fileRefs.length === 0 && parsed.folderRefs.length === 0 && parsed.messageRefs.length === 0 && parsed.attachmentRefs.length === 0) return null;
                const canMoveUp = index > 0;
                const canMoveDown = index < items.length - 1;
                const canReturnToEditor = true;
                return html`
                    <div class="compose-queue-stack-item" data-testid="queue-item" role="listitem">
                        <div class="compose-queue-stack-content" title=${rowText}>
                            ${parsed.text.trim() && html`<div class="compose-queue-stack-text">${parsed.text}</div>`}
                            ${(parsed.messageRefs.length > 0 || parsed.fileRefs.length > 0 || parsed.folderRefs.length > 0 || parsed.attachmentRefs.length > 0) && html`
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
                                    ${parsed.folderRefs.map((path) => {
                                        const label = path.split('/').pop() || path;
                                        return html`
                                            <${FilePill}
                                                key=${'queue-folder-' + path}
                                                prefix="compose"
                                                label=${label}
                                                title=${path}
                                                icon="folder"
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
                        <div class="compose-queue-stack-actions" role="group" aria-label=${t('compose.queueControls')}>
                            ${items.length > 1 && html`
                                <button
                                    class="compose-queue-stack-move-btn"
                                    data-action="move-up"
                                    type="button"
                                    title=${t('compose.moveUp')}
                                    aria-label=${t('compose.moveUpQueue')}
                                    disabled=${!canMoveUp}
                                    onClick=${() => canMoveUp && onMoveQueuedFollowup?.(index, index - 1)}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="18 15 12 9 6 15"></polyline>
                                    </svg>
                                </button>
                                <button
                                    class="compose-queue-stack-move-btn"
                                    data-action="move-down"
                                    type="button"
                                    title=${t('compose.moveDown')}
                                    aria-label=${t('compose.moveDownQueue')}
                                    disabled=${!canMoveDown}
                                    onClick=${() => canMoveDown && onMoveQueuedFollowup?.(index, index + 1)}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                </button>
                            `}
                            ${canReturnToEditor && html`
                                <button
                                    class="compose-queue-stack-move-btn queue-edit"
                                    data-action="edit"
                                    type="button"
                                    title=${t('compose.editInCompose')}
                                    aria-label=${t('compose.returnToEditor')}
                                    onClick=${(e) => { e.stopPropagation(); onReturnQueuedFollowup?.(item); }}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                    </svg>
                                </button>
                            `}
                            <button
                                class="compose-queue-stack-steer-btn"
                                type="button"
                                title=${t('compose.injectSteer')}
                                aria-label=${t('compose.injectSteer')}
                                onClick=${() => onInjectQueuedFollowup?.(item)}
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 20h12a2 2 0 0 0 2-2V8" />
                                    <polyline points="14 12 18 8 22 12" />
                                </svg>
                                <span>${t('compose.steer')}</span>
                            </button>
                            <button
                                class="compose-queue-stack-close-btn queue-remove"
                                data-action="remove"
                                type="button"
                                title=${t('compose.cancelQueued')}
                                aria-label=${t('compose.cancelQueued')}
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
    folderRefs = [],
    onRemoveFolderRef,
    onClearFolderRefs,
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
    stateAccessFailed = false,
    onSetFileRefs,
    onSetFolderRefs,
    onSetMessageRefs,
    onSubmitError,
    onSwitchChat,
    onRenameSession,
    isRenameSessionInProgress = false,
    onCreateSession,
    onCreateRootSession,
    onDeleteSession,
    onPurgeArchivedSession,
    onRestoreSession,
    showQueueStack = true,
    statusNotice = null,
    extensionWorkingState = null,
    prefillRequest = null,
}) {
    const [content, setContent] = useState('');
    const { t } = useTranslation();
    const [searchText, setSearchText] = useState('');
    const [searchFilterImages, setSearchFilterImages] = useState(false);
    const [searchFilterAttachments, setSearchFilterAttachments] = useState(false);
    const [searchMatchMode, setSearchMatchMode] = useState('or');
    const [mediaFiles, setMediaFiles] = useState([]);
    const [uploadProgress, setUploadProgress] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
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
    const [sessionPopupQuery, setSessionPopupQuery] = useState('');
    const [pinnedSessionChatJids, setPinnedSessionChatJids] = useState(() => readSessionPickerPreferences().pinnedChatJids);
    const [pendingPurgeChatJid, setPendingPurgeChatJid] = useState(null);
    const [pendingPruneChatJid, setPendingPruneChatJid] = useState(null);
    const [hiddenSessionChatJids, setHiddenSessionChatJids] = useState(() => new Set());
    const deletingSessionChatJidsRef = useRef(new Set());
    const currentChatJidRef = useRef(currentChatJid);
    const modelCommandGenerationRef = useRef(0);
    const modelListGenerationRef = useRef(0);
    currentChatJidRef.current = currentChatJid;
    const [modelOptions, setModelOptions] = useState([]);
    useEffect(() => {
        const applyPreferences = () => {
            const preferences = readModelCataloguePreferences();
            const pinned = new Set(preferences.pinnedKeys);
            setModelOptions((current) => current.map((entry) => ({
                ...entry,
                pinned: pinned.has(entry.key),
                lastUsedAt: preferences.recentByKey[entry.key] ?? null,
            })));
        };
        window.addEventListener(MODEL_CATALOGUE_PREFERENCES_EVENT, applyPreferences);
        window.addEventListener('storage', applyPreferences);
        return () => {
            window.removeEventListener(MODEL_CATALOGUE_PREFERENCES_EVENT, applyPreferences);
            window.removeEventListener('storage', applyPreferences);
        };
    }, [agentModelsPayload, contextUsage]);
    useEffect(() => {
        const applySessionPreferences = () => {
            setPinnedSessionChatJids(readSessionPickerPreferences().pinnedChatJids);
        };
        window.addEventListener(SESSION_PICKER_PREFERENCES_EVENT, applySessionPreferences);
        window.addEventListener('storage', applySessionPreferences);
        return () => {
            window.removeEventListener(SESSION_PICKER_PREFERENCES_EVENT, applySessionPreferences);
            window.removeEventListener('storage', applySessionPreferences);
        };
    }, []);
    useEffect(() => {
        const applyConfirmedModelState = (event) => {
            const detail = event?.detail;
            if (detail?.source === 'compose') return;
            if (detail?.chatJid && detail.chatJid !== currentChatJid) return;
            const payload = detail?.payload;
            if (!payload || typeof payload !== 'object') return;
            const modelLabel = payload.model ?? payload.current;
            setModelOptions(normaliseComposeModelCatalogue(payload, contextUsage));
            onModelStateChange?.({ ...payload, model: modelLabel ?? null });
            if (modelLabel) onModelChange?.(modelLabel);
        };
        window.addEventListener('piclaw:model-state-changed', applyConfirmedModelState);
        return () => window.removeEventListener('piclaw:model-state-changed', applyConfirmedModelState);
    }, [contextUsage, currentChatJid, onModelChange, onModelStateChange]);
    useEffect(() => {
        modelCommandGenerationRef.current += 1;
        modelListGenerationRef.current += 1;
        setSwitchingModel(false);
    }, [currentChatJid]);
    const [sessionPopupIndex, setSessionPopupIndex] = useState(0);
    const sessionPopupIndexRef = useRef(0);
    const sessionPopupEntriesRef = useRef([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [rollingUpSession, setRollingUpSession] = useState(false);
    const [footerWidth, setFooterWidth] = useState(0);
    const [submitError, setSubmitError] = useState(null);
    const [submitNotice, setSubmitNotice] = useState(null);
    const [speechSupport, setSpeechSupport] = useState(() => getSpeechInputSupport());
    const [speechUiState, setSpeechUiState] = useState({ kind: 'idle', title: '', detail: '' });
    const [statusNoticeNowMs, setStatusNoticeNowMs] = useState(() => Date.now());
    const [extensionWorkingFrameIndex, setExtensionWorkingFrameIndex] = useState(0);
    const textareaRef = useRef(null);
    const manualTextareaHeightRef = useRef(readStoredComposeHeight());
    const slashRef = useRef(null);
    const mentionRef = useRef(null);
    const modelPopupRef = useRef(null);
    const modelHintRef = useRef(null);
    const sessionPopupRef = useRef(null);
    const sessionPopupChatsRef = useRef([]);
    const sessionTriggerRef = useRef(null);
    const footerRef = useRef(null);
    const popupTypeaheadRef = useRef({ value: '', updatedAt: 0 });
    const speechRecognitionRef = useRef(null);
    const speechBaseContentRef = useRef('');
    const speechFinalTranscriptRef = useRef('');
    const speechInterimTranscriptRef = useRef('');
    const speechLastErrorRef = useRef('');
    const speechPendingStopRef = useRef(false);
    const speechPushToTalkActiveRef = useRef(false);
    const suppressNextSpeechClickRef = useRef(false);
    const submittingRef = useRef(false);
    const fileRefsRef = useRef(fileRefs);
    const folderRefsRef = useRef(folderRefs);
    const messageRefsRef = useRef(messageRefs);
    fileRefsRef.current = fileRefs;
    folderRefsRef.current = folderRefs;
    messageRefsRef.current = messageRefs;
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

    // Fetch search match mode when entering search mode
    useEffect(() => {
        if (!searchMode) return;
        fetch('/agent/settings-data').then(r => r.json()).then(data => {
            if (data?.searchMatchMode) setSearchMatchMode(data.searchMatchMode);
        }).catch(() => {
            setSearchMatchMode((prev) => prev || 'or');
        });
    }, [searchMode]);

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
    useEffect(() => {
        setSpeechSupport(getSpeechInputSupport());
    }, []);

    const canSend = content.trim() || mediaFiles.length > 0 || fileRefs.length > 0 || folderRefs.length > 0 || messageRefs.length > 0;
    const speechUiVisible = speechUiState.kind !== 'idle';
    const speechUiPulsing = speechUiState.kind === 'requesting_permission' || speechUiState.kind === 'listening';
    const speechButtonVisible = !searchMode && Boolean(speechSupport?.showButton);
    const speechButtonActive = speechUiState.kind === 'requesting_permission' || speechUiState.kind === 'listening';
    const speechButtonTitle = speechButtonActive
        ? 'Stop voice input'
        : (speechSupport?.title || 'Voice input');
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
    const hasAttachments = mediaFiles.length > 0 || fileRefs.length > 0 || folderRefs.length > 0 || messageRefs.length > 0;
    const connectionStatusPresentation = useConnectionStatusPresentation(stateAccessFailed ? connectionStatus : 'connected');
    const connectionStatusLabel = connectionStatusPresentation.label;
    const connectionStatusTitle = connectionStatusPresentation.title;
    const resolvedSubmitButtonState = resolveComposeSubmitButtonState(isAgentActive, canSend, statusNoticeIsCompaction);
    const submitButtonState = isSubmitting
        ? {
            ...resolvedSubmitButtonState,
            disabled: true,
            title: uploadProgress ? 'Uploading attachments…' : 'Sending…',
            ariaLabel: uploadProgress ? 'Uploading attachments' : 'Sending message',
        }
        : resolvedSubmitButtonState;
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
    const currentRollupParent = (() => {
        const parentBranchId = typeof currentSessionAgent?.parent_branch_id === 'string' ? currentSessionAgent.parent_branch_id.trim() : '';
        const branchId = typeof currentSessionAgent?.branch_id === 'string' ? currentSessionAgent.branch_id.trim() : '';
        if (!currentSessionAgent || !parentBranchId || !branchId || currentSessionAgent.archived_at) return null;
        const children = (Array.isArray(activeChatAgents) ? activeChatAgents : []).filter((chat) => {
            const candidateParent = typeof chat?.parent_branch_id === 'string' ? chat.parent_branch_id.trim() : '';
            return candidateParent && candidateParent === branchId;
        });
        if (children.length > 0) return null;
        const parent = (Array.isArray(activeChatAgents) ? activeChatAgents : []).find((chat) => {
            const candidateId = typeof chat?.branch_id === 'string' ? chat.branch_id.trim() : '';
            return candidateId && candidateId === parentBranchId && !chat?.archived_at;
        });
        return parent || null;
    })();
    const switchableChatAgents = useMemo(() => resolveSessionPopupChats(activeChatAgents, currentChatJid, hiddenSessionChatJids), [activeChatAgents, currentChatJid, hiddenSessionChatJids]);
    const pinnedSessionChatJidSet = useMemo(() => new Set(pinnedSessionChatJids), [pinnedSessionChatJids]);
    const filteredSessionChats = useMemo(() => filterSessionPickerChats(switchableChatAgents, sessionPopupQuery), [switchableChatAgents, sessionPopupQuery]);
    const sessionPopupSections = useMemo(
        () => groupSessionPickerChats(filteredSessionChats, currentChatJid, pinnedSessionChatJids),
        [filteredSessionChats, currentChatJid, pinnedSessionChatJids],
    );
    const orderedSessionChats = useMemo(() => sessionPopupSections.flatMap((section) => section.items), [sessionPopupSections]);
    sessionPopupChatsRef.current = switchableChatAgents;
    const hasSwitchableChatAgents = switchableChatAgents.length > 0;
    const canSwitchSession = hasSwitchableChatAgents && typeof onSwitchChat === 'function';
    const canRestoreSession = hasSwitchableChatAgents && typeof onRestoreSession === 'function';
    const renameInProgress = Boolean(isRenameSessionInProgress || renameSessionInProgressRef.current);
    const canRenameSession = !searchMode && typeof onRenameSession === 'function' && !renameInProgress;
    const canCreateSession = !searchMode && typeof onCreateSession === 'function';
    const canCreateRootSession = !searchMode && typeof onCreateRootSession === 'function';
    const canRollupSession = !searchMode && !isAgentActive && !rollingUpSession && Boolean(currentRollupParent?.chat_jid);
    const canDeleteSession = !searchMode && typeof onDeleteSession === 'function' && !isCurrentDefaultRootSession;
    const canPurgeArchivedSession = !searchMode && typeof onPurgeArchivedSession === 'function';
    const showSessionSwitcherButton = !searchMode && (canSwitchSession || canRestoreSession || canRenameSession || canCreateSession || canCreateRootSession || canRollupSession || canDeleteSession || canPurgeArchivedSession);
    const modelPickerState = resolveComposeModelPickerState(activeModel, agentModelsPayload);
    const showModelPickerHint = modelPickerState.showPicker;
    const modelHintLabel = modelPickerState.label;
    const modelHintSuffix = supportsThinking && thinkingLevel ? ` (${thinkingLevel})` : '';
    const modelThinkingLabel = modelHintSuffix.trim() ? `${thinkingLevel}` : '';
    const routedModelStatus = resolveComposeRoutedModelStatus(activeModel, agentModelsPayload);
    const runUsageMeta = resolveComposeRunUsageMeta(contextUsage, activeModel);
    const modelUsageLabel = typeof modelUsage?.hint_short === 'string' ? modelUsage.hint_short.trim() : '';
    const activeModelOption = normalizeModelPickerOptions(agentModelsPayload)
        .find((option) => areRequestedModelLabelsSame(option.label, activeModel));
    const activeModelPricingLabel = formatModelPickerPricing(activeModelOption?.pricing);
    const openRouterKeyTitle = formatOpenRouterKeyUsageTitle(modelUsage);
    const modelUsageSectionLabel = [
        modelThinkingLabel || null,
        routedModelStatus?.label || null,
        modelUsageLabel || null,
        runUsageMeta?.label || null,
    ].filter(Boolean).join(' • ');
    const modelUsageTitleParts = [
        activeModel ? `Current model: ${modelHintLabel}${modelHintSuffix}` : null,
        routedModelStatus?.title || null,
        modelUsage?.plan ? `Plan: ${modelUsage.plan}` : null,
        modelUsageLabel || null,
        modelUsage?.availability && modelUsage.availability !== 'available'
            ? `Usage telemetry: ${modelUsage.availability.replaceAll('_', ' ')}`
            : null,
        modelUsage?.stale ? `Usage telemetry stale after ${String(modelUsage.refresh_failure || 'refresh failure').replaceAll('_', ' ')}` : null,
        openRouterKeyTitle,
        activeModelPricingLabel ? `Catalogue pricing: ${activeModelPricingLabel}` : null,
        runUsageMeta?.title || null,
        modelUsage?.primary?.reset_description || null,
        modelUsage?.secondary?.reset_description || null,
    ].filter(Boolean);
    const modelHintTitle = switchingModel
        ? 'Switching model…'
        : (modelUsageTitleParts.join(' • ') || (showModelPickerHint
            ? 'Select a model (tap to open model picker)'
            : `Current model: ${modelHintLabel}${modelHintSuffix} (tap to open model picker)`));
    const showComposeMetaRow = !searchMode && (showModelPickerHint || runUsageMeta || (contextUsage && contextUsage.percent != null));

    const emitModelState = (payload) => {
        if (!payload || typeof payload !== 'object') return;
        const modelLabel = payload.model ?? payload.current;
        if (typeof onModelStateChange === 'function') {
            onModelStateChange({
                ...payload,
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
        window.dispatchEvent?.(new CustomEvent('piclaw:model-state-changed', {
            detail: { chatJid: currentChatJid, payload, source: 'compose' },
        }));
    };

    const applyTextareaHeight = (textarea, height) => {
        const nextHeight = clampComposeManualHeight(height);
        textarea.style.minHeight = `${nextHeight}px`;
        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY = textarea.scrollHeight > nextHeight ? 'auto' : 'hidden';
        return nextHeight;
    };

    const resizeTextarea = (target) => {
        const textarea = target || textareaRef.current;
        if (!textarea) return;

        const manualHeight = manualTextareaHeightRef.current;
        if (manualHeight != null) {
            applyTextareaHeight(textarea, manualHeight);
            return;
        }

        textarea.style.minHeight = '';
        textarea.style.height = 'auto';
        const nextHeight = Math.max(
            getComposeMinHeight(),
            Math.min(textarea.scrollHeight, getComposeAutoMaxHeight()),
        );
        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY = textarea.scrollHeight > nextHeight ? 'auto' : 'hidden';
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
        setSessionPopupQuery('');
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

    const hideSessionRowWhileDeleting = useCallback((chatJid) => {
        const target = typeof chatJid === 'string' ? chatJid.trim() : '';
        if (!target || deletingSessionChatJidsRef.current.has(target)) return false;
        deletingSessionChatJidsRef.current.add(target);
        setHiddenSessionChatJids((prev) => {
            const next = new Set(prev instanceof Set ? prev : []);
            next.add(target);
            return next;
        });
        return true;
    }, []);

    const finishSessionRowDelete = useCallback((chatJid, succeeded) => {
        const target = typeof chatJid === 'string' ? chatJid.trim() : '';
        if (!target) return;
        deletingSessionChatJidsRef.current.delete(target);
        if (succeeded) return;
        setHiddenSessionChatJids((prev) => {
            const next = new Set(prev instanceof Set ? prev : []);
            next.delete(target);
            return next;
        });
    }, []);

    const confirmSessionRowDelete = useCallback(async (chat, options = {}) => {
        const chatJid = typeof chat?.chat_jid === 'string' ? chat.chat_jid.trim() : '';
        if (!chatJid) return;
        if (options.canPurgeArchived) {
            if (!hideSessionRowWhileDeleting(chatJid)) return;
            setPendingPurgeChatJid(null);
            let succeeded = false;
            try {
                const purged = await onPurgeArchivedSession?.(chatJid, { confirmed: true });
                succeeded = purged !== false;
            } catch (error) {
                console.warn('Failed to purge archived session:', error);
            }
            finishSessionRowDelete(chatJid, succeeded);
            if (succeeded) {
                setShowSessionPopup(false);
            }
            return;
        }
        if (options.canPrune) {
            if (!hideSessionRowWhileDeleting(chatJid)) return;
            setPendingPruneChatJid(null);
            let succeeded = false;
            try {
                const pruned = await onDeleteSession(chatJid, { confirmed: true });
                succeeded = pruned !== false;
            } catch (error) {
                console.warn('Failed to delete session:', error);
            }
            finishSessionRowDelete(chatJid, succeeded);
            if (succeeded) {
                setShowSessionPopup(false);
            }
        }
    }, [finishSessionRowDelete, hideSessionRowWhileDeleting, onDeleteSession, onPurgeArchivedSession]);

    useEffect(() => {
        if (!showSessionPopup) return;
        const handleConfirmDeletePointer = (event) => {
            const popup = sessionPopupRef.current;
            if (!popup) return;
            const target = event.target;
            const button = target?.closest?.('button.compose-model-popup-item-delete.confirming[data-chat-jid]');
            if (!button || !popup.contains(button)) return;
            event.preventDefault?.();
            event.stopPropagation?.();
            event.stopImmediatePropagation?.();
            const chatJid = typeof button.dataset?.chatJid === 'string' ? button.dataset.chatJid.trim() : '';
            if (!chatJid) return;
            const chat = sessionPopupChatsRef.current.find((row) => row?.chat_jid === chatJid) || { chat_jid: chatJid };
            void confirmSessionRowDelete(chat, {
                canPurgeArchived: button.dataset?.deleteKind === 'purge',
                canPrune: button.dataset?.deleteKind === 'prune',
            });
        };
        document.addEventListener('pointerdown', handleConfirmDeletePointer, true);
        document.addEventListener('mousedown', handleConfirmDeletePointer, true);
        document.addEventListener('touchstart', handleConfirmDeletePointer, true);
        return () => {
            document.removeEventListener('pointerdown', handleConfirmDeletePointer, true);
            document.removeEventListener('mousedown', handleConfirmDeletePointer, true);
            document.removeEventListener('touchstart', handleConfirmDeletePointer, true);
        };
    }, [confirmSessionRowDelete, showSessionPopup]);

    const sessionPopupEntries = useMemo(() => {
        const entries = [];
        for (const chat of orderedSessionChats) {
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
        if (!sessionPopupQuery && canCreateSession) {
            entries.push({ type: 'action', key: 'action:new', label: 'New branch', action: 'new', disabled: false });
        }
        if (!sessionPopupQuery && canCreateRootSession) {
            entries.push({ type: 'action', key: 'action:new-root', label: 'New root session…', action: 'new-root', disabled: false });
        }
        if (!sessionPopupQuery && currentRollupParent?.chat_jid) {
            entries.push({
                type: 'action',
                key: 'action:rollup',
                label: 'Merge current w/ parent',
                action: 'rollup',
                disabled: !canRollupSession,
            });
        }
        if (!sessionPopupQuery && canRenameSession) {
            entries.push({ type: 'action', key: 'action:rename', label: 'Rename current session', action: 'rename', disabled: renameInProgress });
        }
        if (!sessionPopupQuery && canDeleteSession) {
            entries.push({ type: 'action', key: 'action:delete', label: 'Delete current session', action: 'delete', disabled: false });
        }
        return entries;
    }, [orderedSessionChats, sessionPopupQuery, canRestoreSession, canSwitchSession, canCreateSession, canCreateRootSession, currentRollupParent, canRollupSession, canRenameSession, canDeleteSession, renameInProgress]);
    sessionPopupEntriesRef.current = sessionPopupEntries;

    useEffect(() => {
        const clamped = Math.max(0, Math.min(sessionPopupIndexRef.current, Math.max(0, sessionPopupEntries.length - 1)));
        sessionPopupIndexRef.current = clamped;
        if (clamped !== sessionPopupIndex) setSessionPopupIndex(clamped);
    }, [sessionPopupEntries.length, sessionPopupIndex]);

    const toggleSessionPin = useCallback((chatJid) => {
        const preferences = togglePinnedSessionChatJid(chatJid);
        setPinnedSessionChatJids(preferences.pinnedChatJids);
        const nextIndex = groupSessionPickerChats(
            filteredSessionChats,
            currentChatJid,
            preferences.pinnedChatJids,
        ).flatMap((section) => section.items).findIndex((chat) => chat.chat_jid === chatJid);
        if (nextIndex >= 0) {
            sessionPopupIndexRef.current = nextIndex;
            setSessionPopupIndex(nextIndex);
        }
    }, [currentChatJid, filteredSessionChats]);

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

    const handleCreateRootSession = async () => {
        if (typeof onCreateRootSession !== 'function') return;
        setShowSessionPopup(false);
        const rawName = typeof window !== 'undefined'
            ? window.prompt('New root session handle (for example: ops)')
            : '';
        const rootName = String(rawName || '').trim();
        if (!rootName) {
            requestAnimationFrame(() => textareaRef.current?.focus());
            return;
        }
        try {
            await onCreateRootSession(rootName);
        } catch (error) {
            console.warn('Failed to create root session:', error);
        }
        requestAnimationFrame(() => textareaRef.current?.focus());
    };

    const handleRollupSession = async () => {
        const parentChatJid = typeof currentRollupParent?.chat_jid === 'string' ? currentRollupParent.chat_jid.trim() : '';
        if (!parentChatJid || rollingUpSession || isAgentActive) return;
        setShowSessionPopup(false);
        setSubmitError(null);
        setSubmitNotice(null);
        setRollingUpSession(true);
        try {
            const response = await sendAgentMessage('default', '/rollup', null, [], null, currentChatJid);
            onMessageResponse?.(response);
            onPost?.(response);
            const command = response?.command;
            if (command?.status === 'error') {
                const message = command?.message || 'Failed to merge current session with parent.';
                setSubmitError(message);
                onSubmitError?.(message);
                return;
            }
            const rolledUpTo = typeof command?.rolled_up_to === 'string' && command.rolled_up_to.trim()
                ? command.rolled_up_to.trim()
                : parentChatJid;
            onSwitchChat?.(rolledUpTo);
        } catch (error) {
            const message = error?.message || 'Failed to merge current session with parent.';
            setSubmitError(message);
            onSubmitError?.(message);
            console.warn('Failed to merge session with parent:', error);
        } finally {
            setRollingUpSession(false);
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

    const startComposeResize = (startHeight, startY, handle) => {
        const textarea = textareaRef.current;
        if (!textarea || !handle) return;

        let nextHeight = startHeight;
        handle.classList.add('dragging');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';

        const applyNextHeight = (clientY) => {
            nextHeight = applyTextareaHeight(textarea, startHeight + (startY - clientY));
            manualTextareaHeightRef.current = nextHeight;
        };

        const onMouseMove = (moveEvent) => {
            applyNextHeight(moveEvent.clientY);
        };

        const onTouchMove = (moveEvent) => {
            const touch = moveEvent.touches[0];
            if (!touch) return;
            moveEvent.preventDefault();
            applyNextHeight(touch.clientY);
        };

        const stop = () => {
            handle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            setLocalStorageItem(COMPOSE_HEIGHT_STORAGE_KEY, String(Math.round(nextHeight)));
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', stop);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', stop);
            document.removeEventListener('touchcancel', stop);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', stop);
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', stop);
        document.addEventListener('touchcancel', stop);
    };

    const handleComposeResizeMouseDown = (event) => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        event.preventDefault();
        startComposeResize(textarea.getBoundingClientRect().height, event.clientY, event.currentTarget);
    };

    const handleComposeResizeTouchStart = (event) => {
        const textarea = textareaRef.current;
        const touch = event.touches?.[0];
        if (!textarea || !touch) return;
        event.preventDefault();
        startComposeResize(textarea.getBoundingClientRect().height, touch.clientY, event.currentTarget);
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

    const focusTextarea = useCallback(() => {
        requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            try {
                textarea.focus({ preventScroll: true });
            } catch {
                textarea.focus();
            }
        });
    }, []);

    const clearSpeechUiState = useCallback(() => {
        setSpeechUiState({ kind: 'idle', title: '', detail: '' });
    }, []);

    const applySpeechComposeValue = useCallback((finalTranscript = speechFinalTranscriptRef.current, interimTranscript = speechInterimTranscriptRef.current) => {
        if (searchMode) return;
        updateValue(mergeSpeechComposeText(speechBaseContentRef.current, finalTranscript, interimTranscript));
    }, [searchMode]);

    const stopSpeechRecognition = useCallback(() => {
        speechPendingStopRef.current = true;
        const recognition = speechRecognitionRef.current;
        if (!recognition) {
            clearSpeechUiState();
            return;
        }
        try {
            recognition.stop();
        } catch {
            speechRecognitionRef.current = null;
            clearSpeechUiState();
        }
    }, [clearSpeechUiState]);

    const handleSpeechToggle = useCallback(() => {
        setSubmitError(null);
        setSubmitNotice(null);

        if (speechRecognitionRef.current) {
            stopSpeechRecognition();
            return;
        }

        if (!speechSupport?.showButton) return;

        if (speechSupport.mode === 'fallback') {
            focusTextarea();
            setSpeechUiState({
                kind: 'guidance',
                title: speechSupport.title || 'Use keyboard dictation',
                detail: speechSupport.detail || 'Use your keyboard dictation mic for voice input here.',
            });
            return;
        }

        if (!speechSupport?.canStart || !speechSupport?.recognitionCtor) {
            setSpeechUiState({
                kind: 'error',
                title: speechSupport?.title || 'Voice input unavailable',
                detail: speechSupport?.detail || 'This browser does not expose native speech recognition in this context.',
            });
            return;
        }

        try {
            const recognition = new speechSupport.recognitionCtor();
            speechRecognitionRef.current = recognition;
            speechBaseContentRef.current = String(content || '');
            speechFinalTranscriptRef.current = '';
            speechInterimTranscriptRef.current = '';
            speechLastErrorRef.current = '';
            speechPendingStopRef.current = false;

            recognition.lang = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'en-US';
            recognition.interimResults = true;
            recognition.continuous = false;
            if ('maxAlternatives' in recognition) {
                recognition.maxAlternatives = 1;
            }

            recognition.onstart = () => {
                setSpeechUiState({
                    kind: 'listening',
                    title: 'Listening…',
                    detail: 'Speak now. Tap the mic again to stop.',
                });
            };

            recognition.onresult = (event) => {
                const { finalText, interimText } = extractSpeechRecognitionText(event?.results, event?.resultIndex || 0);
                if (finalText) {
                    speechFinalTranscriptRef.current = `${speechFinalTranscriptRef.current} ${finalText}`.trim();
                }
                speechInterimTranscriptRef.current = interimText;
                applySpeechComposeValue();
                setSpeechUiState({
                    kind: 'listening',
                    title: 'Listening…',
                    detail: interimText
                        ? `Heard: ${interimText}`
                        : 'Speak now. Tap the mic again to stop.',
                });
            };

            recognition.onerror = (event) => {
                const errorCode = String(event?.error || '').trim();
                speechLastErrorRef.current = errorCode;
                speechRecognitionRef.current = null;
                speechInterimTranscriptRef.current = '';
                if (errorCode === 'aborted') {
                    clearSpeechUiState();
                    return;
                }
                setSpeechUiState({
                    kind: 'error',
                    title: 'Voice input failed',
                    detail: describeSpeechRecognitionError(errorCode, speechSupport),
                });
            };

            recognition.onend = () => {
                const lastError = speechLastErrorRef.current;
                const pendingStop = speechPendingStopRef.current;
                const hadTranscript = Boolean(speechFinalTranscriptRef.current.trim() || speechInterimTranscriptRef.current.trim());
                speechRecognitionRef.current = null;
                speechPendingStopRef.current = false;
                speechLastErrorRef.current = '';

                if (speechInterimTranscriptRef.current.trim()) {
                    speechFinalTranscriptRef.current = `${speechFinalTranscriptRef.current} ${speechInterimTranscriptRef.current}`.trim();
                    speechInterimTranscriptRef.current = '';
                }
                if (hadTranscript) {
                    applySpeechComposeValue(speechFinalTranscriptRef.current, '');
                }

                if (lastError && lastError !== 'aborted') {
                    return;
                }
                if (!hadTranscript && !pendingStop) {
                    setSpeechUiState({
                        kind: 'error',
                        title: 'No speech detected',
                        detail: describeSpeechRecognitionError('no-speech', speechSupport),
                    });
                    return;
                }
                clearSpeechUiState();
            };

            setSpeechUiState({
                kind: 'requesting_permission',
                title: 'Starting voice input…',
                detail: 'Allow microphone access if the browser asks.',
            });
            focusTextarea();
            recognition.start();
        } catch (error) {
            speechRecognitionRef.current = null;
            setSpeechUiState({
                kind: 'error',
                title: 'Voice input failed',
                detail: error?.message || 'Could not start native browser speech recognition.',
            });
        }
    }, [applySpeechComposeValue, clearSpeechUiState, content, focusTextarea, speechSupport, stopSpeechRecognition]);

    const runModelCommand = async (commandText, expectedModel = null) => {
        if (searchMode || switchingModel) return;

        const targetChatJid = currentChatJid;
        const generation = ++modelCommandGenerationRef.current;
        setSubmitError(null);
        setSubmitNotice(null);
        setSwitchingModel(true);
        try {
            const response = await sendAgentMessage('default', commandText, null, [], null, targetChatJid);
            if (generation !== modelCommandGenerationRef.current || targetChatJid !== currentChatJidRef.current) return false;
            if (response?.error || response?.command === false || response?.command?.status === 'error') {
                throw new Error(response?.error || response?.command?.message || 'Model switch failed.');
            }
            let confirmedModel = null;
            const refreshed = await refreshAgentModelStateBestEffort(getAgentModels, targetChatJid, (latest) => {
                if (generation === modelCommandGenerationRef.current && targetChatJid === currentChatJidRef.current) emitModelState(latest);
            }, (latest) => {
                if (generation !== modelCommandGenerationRef.current || targetChatJid !== currentChatJidRef.current) return;
                confirmedModel = normaliseModelCatalogue(latest).find((entry) => entry.current)?.key
                    ?? normalizeModelCataloguePreferenceKey(latest?.current ?? latest?.model)
                    ?? null;
                setModelOptions(normaliseComposeModelCatalogue(latest, contextUsage));
            });
            if (generation !== modelCommandGenerationRef.current || targetChatJid !== currentChatJidRef.current) return false;
            if (!refreshed || (expectedModel && confirmedModel !== expectedModel)) {
                throw new Error('The server did not confirm the model switch.');
            }
            if (expectedModel) recordRecentModelKey(expectedModel);
            setSubmitNotice(resolveUiOnlyCommandNotice(commandText, response));
            onPost?.(response);
            return true;
        } catch (error) {
            console.error('Failed to switch model:', error);
            alert('Failed to switch model: ' + error.message);
            return false;
        } finally {
            if (generation === modelCommandGenerationRef.current) setSwitchingModel(false);
        }
    };

    const handleSpeechButtonPointerDown = (e) => {
        if (e.pointerType === 'mouse') return;
        const currentValue = textareaRef.current?.value ?? (searchMode ? searchText : content);
        if (!shouldStartSpeechPushToTalk(e, currentValue, {
            searchMode,
            speechButtonVisible,
            speechButtonActive,
            canStartSpeech: Boolean(speechSupport?.canStart && speechSupport?.recognitionCtor),
        })) return;
        e.preventDefault();
        speechPushToTalkActiveRef.current = true;
        suppressNextSpeechClickRef.current = true;
        handleSpeechToggle();
    };

    const stopSpeechButtonPushToTalk = (e) => {
        if (!speechPushToTalkActiveRef.current) return;
        e?.preventDefault?.();
        speechPushToTalkActiveRef.current = false;
        if (speechRecognitionRef.current) {
            stopSpeechRecognition();
        }
    };

    const handleSpeechButtonClick = (e) => {
        if (suppressNextSpeechClickRef.current) {
            suppressNextSpeechClickRef.current = false;
            e.preventDefault();
            return;
        }
        handleSpeechToggle();
    };

    const handleSelectModel = async (modelOption) => {
        const modelLabel = typeof modelOption === 'string'
            ? modelOption
            : (typeof modelOption?.key === 'string'
                ? modelOption.key
                : (typeof modelOption?.label === 'string' ? modelOption.label : ''));
        if (!modelLabel || switchingModel) return;
        const blocked = modelOption?.contextFit?.state === 'blocked';
        const contextLimit = blocked ? { blocked: true, note: 'Compact context before switching to this model.' } : getModelPickerContextLimit(modelOption, contextUsage);
        if (contextLimit.blocked) {
            setSubmitError(null);
            setSubmitNotice(contextLimit.note || 'Compact context first');
            return;
        }
        const ok = await runModelCommand(`/model ${modelLabel}`, modelLabel);
        if (ok) {
            setShowModelPopup(false);
            requestAnimationFrame(() => modelHintRef.current?.focus?.());
        }
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
            if (entry.action === 'new-root') {
                void handleCreateRootSession();
                return;
            }
            if (entry.action === 'rollup') {
                void handleRollupSession();
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

    const closeModelPopup = useCallback(() => {
        setShowModelPopup(false);
        requestAnimationFrame(() => modelHintRef.current?.focus?.());
    }, []);

    const toggleModelPopup = (event) => {
        event.preventDefault();
        event.stopPropagation();
        popupTypeaheadRef.current = { value: '', updatedAt: 0 };
        setShowSessionPopup(false);
        setShowModelPopup((previous) => {
            if (!previous) {
                setModelOptions(normaliseComposeModelCatalogue(agentModelsPayload, contextUsage));
            }
            return !previous;
        });
    };

    const handleContextCompact = async () => {
        if (searchMode) return;
        onContextCompact?.();
        await handleSubmit('/compact', null, {
            includeMedia: false,
            includeFileRefs: false,
            includeFolderRefs: false,
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
        // Client-side interception for UI-only shortcuts.
        const rawInput = typeof overrideContent === 'string' ? overrideContent : content;
        if (/^\/settings\s*$/i.test(rawInput.trim())) {
            setContent('');
            requestAnimationFrame(() => resizeTextarea());
            requestOpenSettingsDialog();
            return;
        }
        if (/^\/help\s*$/i.test(rawInput.trim())) {
            setContent('');
            requestAnimationFrame(() => resizeTextarea());
            requestOpenSettingsDialog({ section: 'keyboard' });
            return;
        }

        const isAbortSubmission = /^\/abort\s*$/i.test(rawInput.trim());
        if (submittingRef.current && !isAbortSubmission) return;

        const {
            includeMedia = true,
            includeFileRefs = true,
            includeFolderRefs = true,
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
            (includeFolderRefs ? folderRefs.length === 0 : true) &&
            (includeMessageRefs ? messageRefs.length === 0 : true)
        ) return;

        const trackSubmission = !isAbortSubmission;
        if (trackSubmission) {
            submittingRef.current = true;
            setIsSubmitting(true);
        }

        if (speechRecognitionRef.current) {
            stopSpeechRecognition();
        }
        clearSpeechUiState();

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
        const capturedFolderRefs = includeFolderRefs ? [...folderRefs] : [];
        const capturedMessageRefs = includeMessageRefs ? [...messageRefs] : [];
        const baseContent = currentContent.trim();
        const submissionChatJid = currentChatJid;
        const submissionModelGeneration = modelCommandGenerationRef.current;

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
            const mergeUnique = (captured, current) => [...new Set([...(captured || []), ...(current || [])])];
            if (includeMedia) {
                setMediaFiles((current) => [
                    ...capturedMediaFiles.filter((file) => !current.includes(file)),
                    ...current,
                ]);
            }
            if (includeFileRefs) onSetFileRefs?.(mergeUnique(capturedFileRefs, fileRefsRef.current));
            if (includeFolderRefs) onSetFolderRefs?.(mergeUnique(capturedFolderRefs, folderRefsRef.current));
            if (includeMessageRefs) onSetMessageRefs?.(mergeUnique(capturedMessageRefs, messageRefsRef.current));
            setContent((current) => {
                if (!baseContent) return current;
                if (!current.trim()) return baseContent;
                if (current.trim() === baseContent) return current;
                return `${baseContent}\n\n${current}`;
            });
            requestAnimationFrame(() => resizeTextarea());
        };

        // Clear compose box immediately so user can keep typing
        if (clearAfterSubmit) {
            setContent('');
            setMediaFiles([]);
            onClearFileRefs?.();
            onClearFolderRefs?.();
            onClearMessageRefs?.();
        }

        // Fire-and-forget: send in background, never block the compose box
        (async () => {
            try {
                const intercepted = await onSubmitIntercept?.({
                    content: baseContent,
                    submitMode,
                    fileRefs: capturedFileRefs,
                    folderRefs: capturedFolderRefs,
                    messageRefs: capturedMessageRefs,
                    mediaFiles: capturedMediaFiles,
                });
                if (intercepted) {
                    onPost?.(intercepted);
                    return;
                }

                // Upload media files first. Keep each result paired with its source
                // file so mixed attachment/reference messages cannot drift by index.
                const uploadedMedia = await uploadFileBatch(
                    capturedMediaFiles,
                    (file, onProgress) => uploadMedia(file, { onProgress }),
                    {
                        onProgress: setUploadProgress,
                    },
                );
                const mediaRecords = uploadedMedia.map(({ name, result }) => ({ name, id: result.id }));
                const mediaIds = mediaRecords.map(({ id }) => id);

                const fileBlock = capturedFileRefs.length
                    ? `Files:\n${capturedFileRefs.map((path) => `- ${path}`).join('\n')}`
                    : '';
                const folderBlock = capturedFolderRefs.length
                    ? `Folders:\n${capturedFolderRefs.map((path) => `- ${path}`).join('\n')}`
                    : '';
                const messageRefBlock = capturedMessageRefs.length
                    ? `Referenced messages:\n${capturedMessageRefs.map((id) => `- message:${id}`).join('\n')}`
                    : '';
                const mediaBlock = mediaRecords.length
                    ? `Attachments:\n${mediaRecords.map(({ id, name }, index) => {
                        const label = name || `attachment-${index + 1}`;
                        return `- attachment:${id} (${label})`;
                    }).join('\n')}`
                    : '';
                const message = [baseContent, fileBlock, folderBlock, messageRefBlock, mediaBlock].filter(Boolean).join('\n\n');
                // The transfer status belongs only to attachment uploads. Message
                // submission is a separate compose action with its own button state.
                setUploadProgress(null);
                const response = await sendAgentMessage('default', message, null, mediaIds, resolveSubmitMode(submitMode), submissionChatJid);
                onMessageResponse?.(response);

                if (response?.command && response.command.status !== 'error') {
                    const recordsModelRecency = /^\/(?:model\s+\S+|cycle-model)\s*$/i.test(baseContent.trim());
                    await refreshAgentModelStateBestEffort(getAgentModels, submissionChatJid, (latest) => {
                        if (submissionModelGeneration === modelCommandGenerationRef.current && submissionChatJid === currentChatJidRef.current) emitModelState(latest);
                    }, (latest) => {
                        if (submissionModelGeneration !== modelCommandGenerationRef.current || submissionChatJid !== currentChatJidRef.current) return;
                        const confirmedModel = normaliseModelCatalogue(latest).find((entry) => entry.current)?.key
                            ?? normalizeModelCataloguePreferenceKey(latest?.current ?? latest?.model)
                            ?? null;
                        if (recordsModelRecency && confirmedModel) recordRecentModelKey(confirmedModel);
                    });
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
            } finally {
                if (trackSubmission) {
                    setUploadProgress(null);
                    setIsSubmitting(false);
                    submittingRef.current = false;
                }
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

    const handleReturnQueuedFollowup = useCallback((queuedItem) => {
        returnQueuedFollowupToEditor({
            queuedItem,
            onRemoveQueuedFollowup,
            setSubmitError,
            setSubmitNotice,
            setMediaFiles,
            onSetFileRefs,
            onSetFolderRefs,
            onSetMessageRefs,
            setContent,
            textareaRef,
            resizeTextarea,
        });
    }, [onRemoveQueuedFollowup, onSetFileRefs, onSetFolderRefs, onSetMessageRefs, resizeTextarea]);

    const handlePopupKeyboardEvent = useCallback((e) => {
        if (searchMode || (!showModelPopup && !showSessionPopup) || e?.isComposing) return false;
        const consume = () => {
            e.preventDefault?.();
            e.stopPropagation?.();
        };
        const resetPopupTypeahead = () => {
            popupTypeaheadRef.current = { value: '', updatedAt: 0 };
        };
        if (showModelPopup && e.target?.closest?.('[data-compose-model-catalogue]')) return false;
        if (e.key === 'Escape') {
            consume();
            resetPopupTypeahead();
            if (showModelPopup) closeModelPopup();
            if (showSessionPopup) {
                setShowSessionPopup(false);
                setSessionPopupQuery('');
                requestAnimationFrame(() => sessionTriggerRef.current?.querySelector?.('button')?.focus?.());
            }
            return true;
        }
        if (showModelPopup) return false;
        if (showSessionPopup) {
            const currentSessionPopupEntries = sessionPopupEntriesRef.current;
            const inSessionSearch = Boolean(e.target?.classList?.contains?.('compose-session-search'));
            if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(e.key)) {
                consume();
                resetPopupTypeahead();
                if (currentSessionPopupEntries.length > 0) setSessionPopupIndex((idx) => {
                    const next = moveSessionPickerIndex(idx, currentSessionPopupEntries.length, e.key);
                    sessionPopupIndexRef.current = next;
                    return next;
                });
                return true;
            }
            if (e.key === 'Enter' && e.altKey && currentSessionPopupEntries.length > 0) {
                consume();
                resetPopupTypeahead();
                const entry = currentSessionPopupEntries[Math.max(0, Math.min(sessionPopupIndexRef.current, currentSessionPopupEntries.length - 1))];
                if (entry?.type === 'session' && !entry.chat?.archived_at) {
                    toggleSessionPin(entry.chat.chat_jid);
                }
                return true;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && currentSessionPopupEntries.length > 0) {
                consume();
                resetPopupTypeahead();
                runSessionPopupEntry(currentSessionPopupEntries[Math.max(0, Math.min(sessionPopupIndexRef.current, currentSessionPopupEntries.length - 1))]);
                return true;
            }
            if (!inSessionSearch && isPopupTypeaheadKey(e) && currentSessionPopupEntries.length > 0) {
                consume();
                const nextBuffer = updatePopupTypeaheadBuffer(popupTypeaheadRef.current, e.key);
                popupTypeaheadRef.current = nextBuffer;
                const match = resolvePopupTypeaheadMatch(currentSessionPopupEntries, nextBuffer.value, sessionPopupIndex, (item) => item.label);
                if (match >= 0) {
                    sessionPopupIndexRef.current = match;
                    setSessionPopupIndex(match);
                }
                return true;
            }
        }
        return false;
    }, [
        searchMode,
        showModelPopup,
        showSessionPopup,
        sessionPopupEntries,
        sessionPopupIndex,
        closeModelPopup,
        toggleSessionPin,
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
        if (shouldStartSpeechPushToTalk(e, currentValue, {
            searchMode,
            speechButtonVisible,
            speechButtonActive,
            canStartSpeech: Boolean(speechSupport?.canStart && speechSupport?.recognitionCtor),
        })) {
            e.preventDefault();
            speechPushToTalkActiveRef.current = true;
            handleSpeechToggle();
            return;
        }
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
                    onSearch?.(currentValue.trim(), searchScope, { images: searchFilterImages, attachments: searchFilterAttachments });
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
                    onSearch?.(currentValue.trim(), searchScope, { images: searchFilterImages, attachments: searchFilterAttachments });
                }
            } else {
                void handleSubmit(currentValue);
            }
            return;
        }

        if (e.key === 'Escape') {
            if (showModelPopup || showSessionPopup || showSlash || showMention) return;
            e.preventDefault();
            textareaRef.current?.blur();
        }
    };

    const handleKeyUp = (e) => {
        if (shouldStopSpeechPushToTalk(e, speechPushToTalkActiveRef.current)) {
            e.preventDefault();
            speechPushToTalkActiveRef.current = false;
            if (speechRecognitionRef.current) {
                stopSpeechRecognition();
            }
        }
    };

    const addMediaFiles = (files) => {
        const list = Array.from(files || []).filter((file) => file instanceof File && !String(file.name || '').startsWith('.DS_Store'));
        if (!list.length) return;
        setMediaFiles((current) => [...current, ...list]);
        setSubmitError(null);
    };

    // Listen for annotated image attachments from the image annotator
    useEffect(() => {
        const onComposeMediaAttach = async (e) => {
            const mediaId = e?.detail?.mediaId;
            if (!mediaId) return;
            try {
                const { getMediaBlob } = await import('../api.js');
                const blob = await getMediaBlob(mediaId);
                const file = new File([blob], `annotated-${mediaId}.png`, { type: blob.type || 'image/png' });
                setMediaFiles((current) => [...current, file]);
                textareaRef.current?.focus();
            } catch (err) {
                console.warn('[compose-box] Failed to attach annotated image:', err);
            }
        };
        window.addEventListener('piclaw:compose-media-attach', onComposeMediaAttach);
        return () => window.removeEventListener('piclaw:compose-media-attach', onComposeMediaAttach);
    }, []);

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
        onClearFolderRefs?.();
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

        const targetChatJid = currentChatJid;
        const generation = ++modelListGenerationRef.current;
        popupTypeaheadRef.current = { value: '', updatedAt: 0 };
        setLoadingModels(true);
        getAgentModels(targetChatJid)
            .then((payload) => {
                if (generation !== modelListGenerationRef.current || targetChatJid !== currentChatJidRef.current) return;
                setModelOptions(normaliseComposeModelCatalogue(payload, contextUsage));
                emitModelState(payload);
            })
            .catch((error) => {
                if (generation !== modelListGenerationRef.current || targetChatJid !== currentChatJidRef.current) return;
                console.warn('Failed to load model list:', error);
                setModelOptions([]);
            })
            .finally(() => {
                if (generation === modelListGenerationRef.current) setLoadingModels(false);
            });
    }, [showModelPopup, currentChatJid]);

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
        if (!showSessionPopup) {
            setPendingPurgeChatJid(null);
            setPendingPruneChatJid(null);
            setSessionPopupQuery('');
        }
    }, [showSessionPopup]);

    useEffect(() => {
        if (!showSessionPopup) return;
        const initialIndex = resolveSessionPopupInitialIndex(sessionPopupEntries, currentChatJid);
        sessionPopupIndexRef.current = initialIndex;
        setSessionPopupIndex(initialIndex);
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
        if (!showSessionPopup) return;
        const popup = sessionPopupRef.current;
        const search = popup?.querySelector?.('.compose-session-search');
        if (document.activeElement !== search) search?.focus?.();
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
        const isEditableTarget = (target) => {
            if (!target || typeof target !== 'object') return false;
            if (target.isContentEditable) return true;
            if (typeof target.closest !== 'function') return false;
            return Boolean(target.closest('input, textarea, select, [contenteditable="true"], .compose-box, .compose-model-popup, .compose-session-popup, .settings-dialog, .workspace-sidebar, .editor-pane-container, .dock-panel, .timeline-menu-dropdown, .rename-branch-overlay, .agent-request-modal, .attachment-preview-modal, .vnc-pane-shell, .kanban-plugin, .timeline-quick-actions'));
        };
        const onGlobalKeyDown = (event) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const textarea = textareaRef.current;
            if (!textarea) return;
            const isFocused = document.activeElement === textarea;
            if (event.key === 'Escape' && !isFocused && !isEditableTarget(event.target)) {
                event.preventDefault();
                textarea.focus();
                return;
            }
            if (event.key === '/' && !isFocused && !isEditableTarget(event.target)) {
                event.preventDefault();
                updateValue('/');
                requestAnimationFrame(() => {
                    textarea.focus();
                    textarea.selectionStart = 1;
                    textarea.selectionEnd = 1;
                    updateSlashAutocomplete('/');
                });
            }
        };
        window.addEventListener('keydown', onGlobalKeyDown);
        return () => window.removeEventListener('keydown', onGlobalKeyDown);
    }, []);

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
        if (speechRecognitionRef.current && e?.isTrusted) {
            stopSpeechRecognition();
        }
        setSubmitError(null);
        setSubmitNotice(null);
        if (speechUiState.kind === 'guidance' || speechUiState.kind === 'error') {
            clearSpeechUiState();
        }
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
        if (typeof window === 'undefined') return undefined;

        const onWindowResize = () => {
            if (manualTextareaHeightRef.current != null) {
                const clamped = clampComposeManualHeight(manualTextareaHeightRef.current);
                manualTextareaHeightRef.current = clamped;
                setLocalStorageItem(COMPOSE_HEIGHT_STORAGE_KEY, String(clamped));
            }
            requestAnimationFrame(() => resizeTextarea());
        };

        window.addEventListener('resize', onWindowResize);
        return () => window.removeEventListener('resize', onWindowResize);
    }, []);

    useEffect(() => {
        if (!searchMode) return undefined;
        if (speechRecognitionRef.current) {
            stopSpeechRecognition();
        }
        return undefined;
    }, [searchMode, stopSpeechRecognition]);

    useEffect(() => {
        if (speechRecognitionRef.current) {
            stopSpeechRecognition();
        }
        clearSpeechUiState();
    }, [currentChatJid, clearSpeechUiState, stopSpeechRecognition]);

    useEffect(() => {
        return () => {
            if (!speechRecognitionRef.current) return;
            try {
                speechRecognitionRef.current.stop();
            } catch (error) {
                console.debug('[compose] failed to stop speech recognition during cleanup', error);
            }
            speechRecognitionRef.current = null;
        };
    }, []);

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
        <div class="compose-box" data-testid="compose-box">
            <div
                class="compose-resize-handle"
                role="separator"
                aria-orientation="horizontal"
                aria-label=${t('compose.resizeInput')}
                title=${t('compose.resizeInputHint')}
                onMouseDown=${handleComposeResizeMouseDown}
                onTouchStart=${handleComposeResizeTouchStart}
            ></div>
            ${speechUiVisible && html`
                <div class=${`compose-inline-status compose-speech-status compose-speech-status-${speechUiState.kind}`} role="status" aria-live="polite">
                    <div class="compose-inline-status-row">
                        <span class=${buildComposeStatusDotClass({ pulsing: speechUiPulsing })} aria-hidden="true"></span>
                        <span class="compose-inline-status-title">${speechUiState.title}</span>
                    </div>
                    ${speechUiState.detail && html`<div class="compose-inline-status-detail">${speechUiState.detail}</div>`}
                </div>
            `}
            ${uploadProgress && html`
                <div class="compose-inline-status compose-upload-status" role="status" aria-live="polite" data-testid="compose-upload-status">
                    <div class="compose-inline-status-row">
                        <div class="compose-inline-status-spinner" aria-hidden="true"></div>
                        <span class="compose-inline-status-title">
                            ${`Uploading ${uploadProgress.current}/${uploadProgress.total}: ${uploadProgress.name}`}
                        </span>
                        <span class="compose-inline-status-elapsed">${uploadProgress.percent}%</span>
                    </div>
                    <div
                        class="upload-progress-bar"
                        role="progressbar"
                        aria-label="Attachment upload progress"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-valuenow=${uploadProgress.percent}
                    >
                        <div class="upload-progress-fill" style=${`width:${uploadProgress.percent}%`}></div>
                    </div>
                </div>
            `}
            ${submitError && html`
                <div class="compose-inline-status compose-submit-error" role="alert" aria-live="assertive">
                    <div class="compose-inline-status-detail">${submitError}</div>
                </div>
            `}
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
                            : extensionWorkingDisplay.animateSpinner
                                ? html`<div class="compose-inline-status-spinner" aria-hidden="true"></div>`
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
                        <div class="compose-inline-status-spinner" aria-hidden="true"></div>
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
                ${showSessionSwitcherButton && html`
                    <div
                        ref=${sessionTriggerRef}
                        class="compose-session-trigger-group compose-session-trigger-top"
                    >
                        <button
                            type="button"
                            class=${`compose-session-trigger compose-session-trigger-pill${showSessionPopup ? ' active' : ''}`}
                            data-testid="session-switcher"
                            onClick=${toggleSessionPopup}
                            title=${currentSessionAgent?.chat_jid || currentChatJid}
                            aria-label=${currentSessionAgent?.agent_name
                                ? `Manage sessions for @${currentSessionAgent.agent_name}`
                                : 'Manage Sessions/Agents'}
                            aria-expanded=${showSessionPopup ? 'true' : 'false'}
                        >
                            <span class="compose-current-agent-label active">${currentSessionAgent?.agent_name ? `@${currentSessionAgent.agent_name}` : 'Sessions'}</span>
                        </button>
                    </div>
                `}
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
                            ${folderRefs.map((path) => {
                                const label = path.split('/').pop() || path;
                                return html`
                                    <${FilePill}
                                        prefix="compose"
                                        label=${label}
                                        title=${path}
                                        icon="folder"
                                        onClick=${() => onOpenFilePill?.(path)}
                                        removeTitle="Remove folder hint"
                                        onRemove=${() => onRemoveFolderRef?.(path)}
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
                                title=${t('compose.clearAllTitle')}
                                aria-label=${t('compose.clearAllTitle')}
                            >
                                ${t('compose.clearAll')}
                            </button>
                        </div>
                    `}
                    <textarea
                        ref=${textareaRef}
                        data-testid="compose-input"
                        placeholder=${searchMode ? t('compose.searchPlaceholder') : t('compose.placeholder')}
                        value=${searchMode ? searchText : content}
                        onInput=${handleInput}
                        onKeyDown=${handleKeyDown}
                        onKeyUp=${handleKeyUp}
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
                        <${ClassicModelPicker}
                            entries=${modelOptions}
                            loading=${loadingModels}
                            switching=${switchingModel}
                            onSelect=${(entry) => { void handleSelectModel(entry); }}
                            onTogglePin=${(entry) => togglePinnedModelKey(entry.key)}
                            onClose=${closeModelPopup}
                            onCompact=${() => {
                                closeModelPopup();
                                void handleContextCompact();
                            }}
                            onOpenSettings=${() => {
                                setShowModelPopup(false);
                                requestOpenSettingsDialog({ section: 'models' });
                            }}
                            rootRef=${modelPopupRef}
                        />
                    `}
                    ${showSessionPopup && !searchMode && html`
                        <div class="compose-model-popup compose-session-popup" data-testid="session-popup" ref=${sessionPopupRef} tabIndex="-1" onKeyDown=${handlePopupKeyboardEvent}>
                            <div class="compose-session-popup-header">
                                <label class="compose-model-popup-title compose-session-search-heading" for="compose-session-search">Search sessions</label>
                                <button type="button" class="compose-session-popup-close" aria-label="Close session picker" onClick=${() => { setShowSessionPopup(false); requestAnimationFrame(() => sessionTriggerRef.current?.querySelector?.('button')?.focus?.()); }}>×</button>
                            </div>
                            <input
                                id="compose-session-search"
                                class="compose-session-search"
                                type="search"
                                value=${sessionPopupQuery}
                                placeholder="Handle, JID, state, or model"
                                autocomplete="off"
                                onInput=${(event) => {
                                    const query = event.currentTarget.value;
                                    const nextOrderedChats = groupSessionPickerChats(
                                        filterSessionPickerChats(switchableChatAgents, query),
                                        currentChatJid,
                                        pinnedSessionChatJids,
                                    ).flatMap((section) => section.items);
                                    sessionPopupEntriesRef.current = nextOrderedChats.map((chat) => ({
                                        type: 'session',
                                        key: `session:${chat.chat_jid}`,
                                        label: `@${chat.agent_name} — ${chat.chat_jid}${chat.is_active ? ' active' : ''}${chat.archived_at ? ' archived' : ''}`,
                                        chat,
                                        disabled: chat.archived_at ? !canRestoreSession : !canSwitchSession,
                                    }));
                                    const initialIndex = resolveSessionPickerSearchInitialIndex(nextOrderedChats, query);
                                    sessionPopupIndexRef.current = initialIndex;
                                    setSessionPopupIndex(initialIndex);
                                    setSessionPopupQuery(query);
                                }}
                                onKeyDown=${handlePopupKeyboardEvent}
                            />
                            <div
                                class="compose-model-popup-menu compose-session-popup-results"
                                role="listbox"
                                aria-label=${t('compose.sessionsAndAgents')}
                                aria-activedescendant=${sessionPopupEntries[sessionPopupIndex]?.type === 'session' ? `compose-session-option-${encodeURIComponent(sessionPopupEntries[sessionPopupIndex].chat.chat_jid)}` : undefined}
                            >
                                ${!hasSwitchableChatAgents && html`
                                    <div class="compose-model-popup-empty">${t('compose.noSessions')}</div>
                                `}
                                ${hasSwitchableChatAgents && filteredSessionChats.length === 0 && html`
                                    <div class="compose-model-popup-empty">No sessions match “${sessionPopupQuery}”.</div>
                                `}
                                ${orderedSessionChats.map((chat, listIndex) => {
                                    const section = sessionPopupSections.find((candidate) => candidate.items.includes(chat));
                                    const sectionStart = section?.items[0] === chat;
                                    const archived = Boolean(chat.archived_at);
                                    const pinned = !archived && pinnedSessionChatJidSet.has(chat.chat_jid);
                                    const isRoot = chat.chat_jid === (chat.root_chat_jid || chat.chat_jid);
                                    const canPrune = !isRoot && !chat.is_active && !archived && typeof onDeleteSession === 'function';
                                    const canPurgeArchived = archived && canPurgeArchivedSession;
                                    const purgeConfirming = canPurgeArchived && pendingPurgeChatJid === chat.chat_jid;
                                    const pruneConfirming = canPrune && pendingPruneChatJid === chat.chat_jid;
                                    const deleteConfirming = purgeConfirming || pruneConfirming;
                                    const label = formatBranchPickerLabel(chat, { currentChatJid });
                                    const primaryLabel = normalizeHandle(chat.agent_name);
                                    const lifecycleBadges = getBranchLifecycleBadges(chat, { currentChatJid });
                                    const rootJid = chat.root_chat_jid || chat.chat_jid;
                                    const modelLabel = chat.model || chat.model_label || '';
                                    const sessionMetrics = formatSessionPickerMetrics(chat);
                                    return html`
                                        ${sectionStart && html`<div class="compose-session-section-heading" role="presentation">${section.label}</div>`}
                                        <div key=${chat.chat_jid} class=${`compose-model-popup-item-row${archived ? ' archived' : ''}`}>
                                            ${archived
                                                ? html`<span class="compose-session-row-pin-spacer" aria-hidden="true"></span>`
                                                : html`<button
                                                    type="button"
                                                    class=${`compose-session-row-pin${pinned ? ' pinned' : ''}`}
                                                    title=${pinned ? `Unpin @${chat.agent_name}` : `Pin @${chat.agent_name}`}
                                                    aria-label=${pinned ? `Unpin @${chat.agent_name}` : `Pin @${chat.agent_name}`}
                                                    aria-pressed=${pinned ? 'true' : 'false'}
                                                    aria-keyshortcuts="Alt+Enter"
                                                    onClick=${(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        toggleSessionPin(chat.chat_jid);
                                                    }}
                                                >${pinned ? '★' : '☆'}</button>`}
                                            <button
                                                id=${`compose-session-option-${encodeURIComponent(chat.chat_jid)}`}
                                                type="button"
                                                role="option"
                                                aria-selected=${sessionPopupIndex === listIndex ? 'true' : 'false'}
                                                aria-label=${`${label}; chat ${chat.chat_jid}; root ${rootJid}; ${modelLabel ? `model ${modelLabel}; ` : ''}${lifecycleBadges.join(', ') || 'idle'}`}
                                                class=${`compose-model-popup-item session-item${archived ? ' archived' : ''}${sessionPopupIndex === listIndex ? ' active' : ''}`}
                                                data-testid="session-item"
                                                onClick=${() => {
                                                    if (archived) {
                                                        void handleRestoreSession(chat.chat_jid);
                                                        return;
                                                    }
                                                    handleSessionSwitch(chat.chat_jid);
                                                }}
                                                disabled=${archived ? !canRestoreSession : !canSwitchSession}
                                                title=${archived ? `Restore archived ${label}` : `Switch to ${label}`}
                                            >
                                                <span class="compose-session-row-content" style=${isSessionPopupChatEmphasized(chat) ? 'font-weight:700' : ''}>
                                                    <span class="compose-session-row-main">
                                                        <span class="compose-session-row-label">${primaryLabel}</span>
                                                        <span class="compose-session-row-meta">
                                                            <span class="compose-session-row-jid">${chat.chat_jid}</span>
                                                            ${sessionMetrics && html`<span class="compose-session-row-metrics"> · ${sessionMetrics}</span>`}
                                                        </span>
                                                    </span>
                                                    ${lifecycleBadges.length > 0 && html`
                                                        <span class="compose-session-row-pills" aria-label=${`Session status: ${lifecycleBadges.join(', ')}`}>
                                                            ${lifecycleBadges.map((badge) => html`
                                                                <span key=${badge} class=${`compose-session-status-pill ${badge}`}>${badge}</span>
                                                            `)}
                                                        </span>
                                                    `}
                                                </span>
                                            </button>
                                            <button
                                                type="button"
                                                class="compose-model-popup-item-popout"
                                                title=${`Open @${chat.agent_name} in new window`}
                                                aria-label=${`Open @${chat.agent_name} in new window`}
                                                onClick=${(e) => {
                                                    e.stopPropagation();
                                                    setShowSessionPopup(false);
                                                    const url = new URL(window.location.href);
                                                    url.searchParams.set('chat_jid', chat.chat_jid);
                                                    url.searchParams.set('chat_only', '1');
                                                    const a = document.createElement('a');
                                                    a.href = url.toString();
                                                    a.target = '_blank';
                                                    a.rel = 'noopener';
                                                    a.style.display = 'none';
                                                    document.body.appendChild(a);
                                                    a.click();
                                                    a.remove();
                                                }}
                                            >
                                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M6 2h8v8"/>
                                                    <path d="M14 2 7 9"/>
                                                    <path d="M12 9v5H2V4h5"/>
                                                </svg>
                                            </button>
                                            ${(canPrune || canPurgeArchived) && html`
                                                ${deleteConfirming
                                                    ? html`<button
                                                        key=${`${chat.chat_jid}:delete-confirm`}
                                                        type="button"
                                                        class="compose-model-popup-item-delete confirming"
                                                        data-chat-jid=${chat.chat_jid}
                                                        data-delete-kind=${canPurgeArchived ? 'purge' : 'prune'}
                                                        title=${canPurgeArchived ? 'Confirm permanent deletion' : 'Confirm branch deletion'}
                                                        aria-label=${canPurgeArchived
                                                            ? (isRoot ? `Confirm permanent deletion of archived session @${chat.agent_name}` : `Confirm permanent deletion of archived branch @${chat.agent_name}`)
                                                            : `Confirm delete @${chat.agent_name}`}
                                                        onPointerDown=${(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            void confirmSessionRowDelete(chat, { canPurgeArchived, canPrune });
                                                        }}
                                                        onKeyDown=${(e) => {
                                                            if (e.key !== 'Enter' && e.key !== ' ') return;
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            void confirmSessionRowDelete(chat, { canPurgeArchived, canPrune });
                                                        }}
                                                    >
                                                        <span class="compose-model-popup-item-delete-confirm">OK</span>
                                                    </button>`
                                                    : html`<button
                                                        key=${`${chat.chat_jid}:delete-request`}
                                                        type="button"
                                                        class="compose-model-popup-item-delete"
                                                        title=${canPurgeArchived
                                                            ? (isRoot ? 'Permanently delete this archived session' : 'Permanently delete this archived branch')
                                                            : 'Delete this branch'}
                                                        aria-label=${canPurgeArchived
                                                            ? (isRoot ? `Permanently delete archived session @${chat.agent_name}` : `Permanently delete archived branch @${chat.agent_name}`)
                                                            : `Delete @${chat.agent_name}`}
                                                        onClick=${(e) => {
                                                            e.stopPropagation();
                                                            if (canPurgeArchived) {
                                                                setPendingPurgeChatJid(chat.chat_jid);
                                                                return;
                                                            }
                                                            if (canPrune) {
                                                                setPendingPruneChatJid(chat.chat_jid);
                                                                return;
                                                            }
                                                            setShowSessionPopup(false);
                                                            void onDeleteSession(chat.chat_jid);
                                                        }}
                                                    >
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                                            <line x1="18" y1="6" x2="6" y2="18" />
                                                            <line x1="6" y1="6" x2="18" y2="18" />
                                                        </svg>
                                                    </button>`}
                                            `}
                                        </div>
                                    `;
                                })}
                            </div>
                            ${!sessionPopupQuery && (canCreateSession || canCreateRootSession || canRenameSession || canDeleteSession) && html`
                                <div class="compose-model-popup-actions">
                                    ${canCreateSession && html`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn primary${sessionPopupEntries.findIndex((entry) => entry.key === 'action:new') === sessionPopupIndex ? ' active' : ''}`}
                                            onClick=${() => { void handleCreateSession(); }}
                                            title=${t('compose.newBranchTitle')}
                                        >
                                            ${t('compose.newBranch')}
                                        </button>
                                    `}
                                    ${canCreateRootSession && html`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${sessionPopupEntries.findIndex((entry) => entry.key === 'action:new-root') === sessionPopupIndex ? ' active' : ''}`}
                                            onClick=${() => { void handleCreateRootSession(); }}
                                            title=${t('compose.newRootTitle')}
                                        >
                                            ${t('compose.newRoot')}
                                        </button>
                                    `}
                                    ${currentRollupParent?.chat_jid && html`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${sessionPopupEntries.findIndex((entry) => entry.key === 'action:rollup') === sessionPopupIndex ? ' active' : ''}`}
                                            onClick=${() => { void handleRollupSession(); }}
                                            title=${canRollupSession ? t('compose.mergeInto', { target: currentRollupParent.agent_name ? `@${currentRollupParent.agent_name}` : currentRollupParent.chat_jid }) : t('compose.mergeBlocked')}
                                            disabled=${!canRollupSession}
                                        >
                                            ${t('compose.mergeCurrent')}
                                        </button>
                                    `}
                                    ${canRenameSession && html`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${sessionPopupEntries.findIndex((entry) => entry.key === 'action:rename') === sessionPopupIndex ? ' active' : ''}`}
                                            onClick=${(e) => { void handleRenameSession(e); }}
                                            title=${t('compose.renameSessionTitle')}
                                            disabled=${renameInProgress}
                                        >
                                            ${t('compose.renameCurrent')}
                                        </button>
                                    `}
                                    ${canDeleteSession && html`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn danger${sessionPopupEntries.findIndex((entry) => entry.key === 'action:delete') === sessionPopupIndex ? ' active' : ''}`}
                                            onClick=${() => { void handleDeleteSession(); }}
                                            title=${t('compose.pruneSessionTitle')}
                                        >
                                            ${t('compose.deleteCurrent')}
                                        </button>
                                    `}
                                </div>
                            `}
                        </div>
                    `}
                </div>
                <div class="compose-footer" ref=${footerRef}>
                    ${connectionStatusPresentation.show && html`
                        <span class="compose-connection-status connection-status ${connectionStatusPresentation.statusClass}" title=${connectionStatusTitle}>
                            ${connectionStatusLabel}
                        </span>
                    `}
                    ${showComposeMetaRow && html`
                    <div class="compose-meta-row">
                        ${(showModelPickerHint || runUsageMeta) && html`
                            <div class="compose-model-meta">
                                ${showModelPickerHint && html`
                                    <button
                                        ref=${modelHintRef}
                                        type="button"
                                        class="compose-model-hint compose-model-hint-btn"
                                        title=${modelHintTitle}
                                        aria-label=${t('compose.openModelPicker')}
                                        onClick=${toggleModelPopup}
                                        disabled=${switchingModel}
                                    >
                                        ${switchingModel ? 'Switching…' : modelHintLabel}
                                    </button>
                                `}
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
                    ${searchMode && html`
                        <label class="compose-search-scope-wrap" title=${t('compose.searchScope')}>
                            <span class="compose-search-scope-label">${t('compose.scope')}</span>
                            <select
                                class="compose-search-scope-select"
                                value=${searchScope}
                                onChange=${(e) => onSearchScopeChange?.(e.currentTarget.value)}
                            >
                                <option value="current">${t('compose.scopeCurrent')}</option>
                                <option value="root">${t('compose.scopeBranchFamily')}</option>
                                <option value="all">${t('compose.scopeAll')}</option>
                            </select>
                        </label>
                        <label class="compose-search-filter-wrap" title=${t('compose.filterImagesTitle')}>
                            <input type="checkbox" checked=${searchFilterImages} onChange=${() => setSearchFilterImages(v => !v)} />
                            <span class="compose-search-filter-label">${t('compose.filterImages')}</span>
                        </label>
                        <label class="compose-search-filter-wrap" title=${t('compose.filterAttachmentsTitle')}>
                            <input type="checkbox" checked=${searchFilterAttachments} onChange=${() => setSearchFilterAttachments(v => !v)} />
                            <span class="compose-search-filter-label">${t('compose.filterAttachments')}</span>
                        </label>
                        <button
                            class=${`compose-search-match-toggle ${searchMatchMode === 'and' ? 'active' : ''}`}
                            onClick=${() => {
                                const next = searchMatchMode === 'or' ? 'and' : 'or';
                                setSearchMatchMode(next);
                                fetch('/agent/settings/general', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ searchMatchMode: next }),
                                }).catch((e) => { void e; });
                            }}
                            title=${searchMatchMode === 'or' ? 'Any keyword (OR) — click for all keywords (AND)' : 'All keywords (AND) — click for any keyword (OR)'}
                            type="button"
                        >
                            ${searchMatchMode === 'or' ? 'OR' : 'AND'}
                        </button>
                    `}
                    <button
                        class="icon-btn search-toggle"
                        onClick=${searchMode ? onExitSearch : onEnterSearch}
                        title=${searchMode ? t('compose.closeSearch') : t('compose.search')}
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
                            title=${t('compose.shareLocation')}
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
                    ${speechButtonVisible && html`
                        <button
                            class=${`icon-btn voice-input-btn${speechButtonActive ? ' active' : ''}${speechSupport.mode === 'fallback' ? ' fallback' : ''}`}
                            onClick=${handleSpeechButtonClick}
                            onPointerDown=${handleSpeechButtonPointerDown}
                            onPointerUp=${stopSpeechButtonPushToTalk}
                            onPointerCancel=${stopSpeechButtonPushToTalk}
                            onPointerLeave=${stopSpeechButtonPushToTalk}
                            title=${speechButtonTitle}
                            aria-label=${speechButtonTitle}
                            type="button"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <path d="M12 19v3" />
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
                        <label class="icon-btn" title=${t('compose.attachFile')}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            <input type="file" multiple hidden onChange=${handleFileChange} disabled=${isSubmitting} />
                        </label>
                    `}
                    ${!searchMode && html`
                        <div class="compose-send-stack">
                                <button
                                    class=${submitButtonState.className}
                                    data-testid="send-button"
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
                                        data-testid="stop-button"
                                        type="button"
                                        onClick=${() => {
                                            if (isComposeSubmitAbortMode(abortButtonState.mode)) {
                                                void handleSubmit('/abort', 'steer', { clearAfterSubmit: false, includeMedia: false, includeFileRefs: false, includeFolderRefs: false, includeMessageRefs: false, recordHistory: false });
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
                        </div>
                    `}
                </div>
            </div>
        </div>
        </div>
    `;
}
