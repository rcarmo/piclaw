// @ts-nocheck
import { html, useCallback, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { BodyPortal } from './body-portal.js';
import { getAgentCommands, getQuickActionsSettings } from '../api.js';
import { isPopupTypeaheadKey } from '../ui/popup-typeahead.js';
import {
    WORKSPACE_QUICK_ACTIONS_CATALOG,
    buildTimelineQuickActionItems,
    normalizeTimelineQuickActionsSettingsData,
} from '../ui/timeline-quick-actions.js';

function isEditableTarget(target) {
    if (!target || typeof target !== 'object') return false;
    if (target.isContentEditable) return true;
    if (typeof target.closest !== 'function') return false;
    return Boolean(target.closest([
        'input',
        'textarea',
        'select',
        '[contenteditable="true"]',
        '.compose-box',
        '.compose-model-popup',
        '.compose-session-popup',
        '.settings-dialog',
        '.workspace-sidebar',
        '.workspace-explorer',
        '.editor-pane-container',
        '.dock-panel',
        '.timeline-menu-dropdown',
        '.rename-branch-overlay',
        '.agent-request-modal',
        '.attachment-preview-modal',
        '.vnc-pane-shell',
        '.kanban-plugin',
        '.mindmap-editor',
    ].join(', ')));
}

function isEligibleTimelineTarget(target) {
    if (!target || typeof target !== 'object') return true;
    if (isEditableTarget(target)) return false;
    const tagName = String(target.tagName || '').toUpperCase();
    if (tagName === 'BODY' || tagName === 'HTML') return true;
    if (typeof target.closest !== 'function') return true;
    return Boolean(target.closest('.container, .timeline, .post, .post-body, .post-content, .agent-status-panel'));
}

function toggleChatOnlyMode(chatOnlyMode) {
    const url = new URL(window.location.href);
    if (chatOnlyMode) {
        url.searchParams.delete('chat_only');
    } else {
        url.searchParams.set('chat_only', '1');
    }
    window.location.href = url.toString();
}

function buildWorkspaceCommands(options) {
    const commands = [];
    const byId = new Map(WORKSPACE_QUICK_ACTIONS_CATALOG.map((entry) => [entry.id, entry]));
    const add = (id, overrides = {}) => {
        const base = byId.get(id);
        if (!base) return;
        commands.push({ ...base, ...overrides });
    };

    add('toggle-workspace', {
        label: options.workspaceOpen ? 'Hide workspace' : 'Show workspace',
        description: options.workspaceOpen ? 'Hide the workspace sidebar.' : 'Show the workspace sidebar.',
    });
    if (!options.workspaceOpen && !options.chatOnlyMode) {
        add('open-explorer');
    }
    add('toggle-chat-only', {
        label: options.chatOnlyMode ? 'Exit chat-only mode' : 'Chat-only mode',
        description: options.chatOnlyMode ? 'Return to the split workspace layout.' : 'Switch to the chat-only layout.',
    });
    if (typeof options.onOpenTerminalTab === 'function') add('open-terminal-tab');
    if (typeof options.onOpenVncTab === 'function') add('open-vnc-tab');
    if (typeof options.onToggleTerminalDock === 'function') {
        add('toggle-terminal-dock', {
            label: options.terminalVisible ? 'Hide terminal dock' : 'Show terminal dock',
            description: options.terminalVisible ? 'Hide the terminal dock.' : 'Show the terminal dock.',
        });
    }
    add('open-settings');
    return commands;
}

function sectionLabel(kind) {
    if (kind === 'agent') return 'Agents';
    if (kind === 'workspace') return 'Workspace';
    return 'Slash commands';
}

function renderQuickActionMedia(item) {
    if (item?.imageUrl) {
        return html`<img class="timeline-quick-actions-item-avatar" src=${item.imageUrl} alt="" aria-hidden="true" />`;
    }
    return html`<span class="timeline-quick-actions-item-placeholder" aria-hidden="true">${item?.visualHint || ''}</span>`;
}

function renderKeyboardHint(label, value) {
    return html`
        <span class="timeline-quick-actions-keyhint">
            <kbd>${value}</kbd>
            <span>${label}</span>
        </span>
    `;
}

export function TimelineQuickActions({
    activeChatAgents = [],
    currentChatJid = 'web:default',
    workspaceOpen = false,
    chatOnlyMode = false,
    terminalVisible = false,
    onSwitchChat,
    onToggleWorkspace,
    onOpenTerminalTab,
    onOpenVncTab,
    onToggleTerminalDock,
    onPrefillCompose,
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlightIndex, setHighlightIndex] = useState(0);
    const [slashCommands, setSlashCommands] = useState([]);
    const [settings, setSettings] = useState({ workspaceCommands: null, slashCommands: null });
    const rootRef = useRef(null);
    const inputRef = useRef(null);

    const loadSettings = useCallback(async () => {
        try {
            const payload = await getQuickActionsSettings();
            setSettings(normalizeTimelineQuickActionsSettingsData(payload?.settings));
        } catch {
            setSettings({ workspaceCommands: null, slashCommands: null });
        }
    }, []);

    useEffect(() => {
        void loadSettings();
    }, [loadSettings]);

    useEffect(() => {
        let cancelled = false;
        void getAgentCommands(currentChatJid)
            .then((payload) => {
                if (cancelled) return;
                setSlashCommands(Array.isArray(payload?.commands) ? payload.commands : []);
            })
            .catch(() => {
                if (cancelled) return;
                setSlashCommands([]);
            });
        return () => {
            cancelled = true;
        };
    }, [currentChatJid]);

    const workspaceCommands = useMemo(() => buildWorkspaceCommands({
        workspaceOpen,
        chatOnlyMode,
        terminalVisible,
        onOpenTerminalTab,
        onOpenVncTab,
        onToggleTerminalDock,
    }), [chatOnlyMode, onOpenTerminalTab, onOpenVncTab, onToggleTerminalDock, terminalVisible, workspaceOpen]);

    const items = useMemo(() => buildTimelineQuickActionItems({
        agents: activeChatAgents,
        workspaceCommands,
        slashCommands,
        settings,
        query,
    }), [activeChatAgents, query, settings, slashCommands, workspaceCommands]);

    useEffect(() => {
        if (highlightIndex < items.length) return;
        setHighlightIndex(items.length > 0 ? 0 : -1);
    }, [highlightIndex, items.length]);

    useEffect(() => {
        if (!open) return;
        requestAnimationFrame(() => inputRef.current?.focus?.());
    }, [open]);

    useEffect(() => {
        const onKeyDown = (event) => {
            if (!open) {
                if (!isPopupTypeaheadKey(event)) return;
                if (!isEligibleTimelineTarget(event.target)) return;
                event.preventDefault();
                setQuery(String(event.key || ''));
                setHighlightIndex(0);
                setOpen(true);
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
                setQuery('');
                return;
            }
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlightIndex((prev) => items.length > 0 ? (prev + 1 + items.length) % items.length : 0);
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlightIndex((prev) => items.length > 0 ? (prev - 1 + items.length) % items.length : 0);
                return;
            }
            if (event.key === 'Enter' && items[highlightIndex]) {
                event.preventDefault();
                const current = items[highlightIndex];
                if (current) {
                    if (current.kind === 'agent' && current.chatJid) {
                        onSwitchChat?.(current.chatJid);
                    } else if (current.kind === 'workspace' && current.commandId) {
                        if (current.commandId === 'toggle-workspace' || current.commandId === 'open-explorer') onToggleWorkspace?.();
                        if (current.commandId === 'toggle-chat-only') toggleChatOnlyMode(chatOnlyMode);
                        if (current.commandId === 'open-terminal-tab') onOpenTerminalTab?.();
                        if (current.commandId === 'open-vnc-tab') onOpenVncTab?.();
                        if (current.commandId === 'toggle-terminal-dock') onToggleTerminalDock?.();
                        if (current.commandId === 'open-settings') window.dispatchEvent(new CustomEvent('piclaw:open-settings'));
                    } else if (current.kind === 'slash' && current.commandName) {
                        onPrefillCompose?.(current.commandName);
                    }
                }
                setOpen(false);
                setQuery('');
            }
        };

        const onPointerDown = (event) => {
            if (!open) return;
            if (rootRef.current?.contains(event.target)) return;
            setOpen(false);
            setQuery('');
        };

        window.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('pointerdown', onPointerDown, true);
        };
    }, [chatOnlyMode, highlightIndex, items, onOpenTerminalTab, onOpenVncTab, onPrefillCompose, onSwitchChat, onToggleTerminalDock, onToggleWorkspace, open]);

    useEffect(() => {
        const handleSettingsSaved = (event) => {
            const nextSettings = normalizeTimelineQuickActionsSettingsData(event?.detail?.settings);
            if (event?.detail?.settings) {
                setSettings(nextSettings);
                return;
            }
            void loadSettings();
        };
        window.addEventListener('focus', handleSettingsSaved);
        window.addEventListener('piclaw:quick-actions-settings-updated', handleSettingsSaved);
        return () => {
            window.removeEventListener('focus', handleSettingsSaved);
            window.removeEventListener('piclaw:quick-actions-settings-updated', handleSettingsSaved);
        };
    }, [loadSettings]);

    if (!open) return null;

    let lastKind = null;
    return html`
        <${BodyPortal} className="timeline-quick-actions-portal">
            <div class="timeline-quick-actions-overlay">
                <div class="timeline-quick-actions" ref=${rootRef}>
                    <div class="timeline-quick-actions-header">
                        <input
                            ref=${inputRef}
                            class="timeline-quick-actions-input"
                            type="text"
                            value=${query}
                            placeholder="Type to jump to an agent, workspace action, or slash command…"
                            onInput=${(event) => {
                                setQuery(event.currentTarget?.value || '');
                                setHighlightIndex(0);
                            }}
                        />
                        <div class="timeline-quick-actions-hints" aria-hidden="true">
                            ${renderKeyboardHint('Move', '↑↓')}
                            ${renderKeyboardHint('Select', '↵')}
                            ${renderKeyboardHint('Close', 'Esc')}
                        </div>
                    </div>
                    <div class="timeline-quick-actions-list">
                        ${items.length === 0 && html`<div class="timeline-quick-actions-empty">No quick actions match.</div>`}
                        ${items.map((item, index) => {
                            const showSection = item.kind !== lastKind;
                            lastKind = item.kind;
                            return html`
                                ${showSection && html`<div class="timeline-quick-actions-section">${sectionLabel(item.kind)}</div>`}
                                <button
                                    key=${item.key}
                                    type="button"
                                    class=${`timeline-quick-actions-item timeline-quick-actions-item-${item.kind}${index === highlightIndex ? ' active' : ''}`}
                                    onMouseEnter=${() => setHighlightIndex(index)}
                                    onClick=${() => {
                                        if (item.kind === 'agent' && item.chatJid) onSwitchChat?.(item.chatJid);
                                        if (item.kind === 'workspace' && item.commandId === 'toggle-workspace') onToggleWorkspace?.();
                                        if (item.kind === 'workspace' && item.commandId === 'open-explorer') onToggleWorkspace?.();
                                        if (item.kind === 'workspace' && item.commandId === 'toggle-chat-only') toggleChatOnlyMode(chatOnlyMode);
                                        if (item.kind === 'workspace' && item.commandId === 'open-terminal-tab') onOpenTerminalTab?.();
                                        if (item.kind === 'workspace' && item.commandId === 'open-vnc-tab') onOpenVncTab?.();
                                        if (item.kind === 'workspace' && item.commandId === 'toggle-terminal-dock') onToggleTerminalDock?.();
                                        if (item.kind === 'workspace' && item.commandId === 'open-settings') window.dispatchEvent(new CustomEvent('piclaw:open-settings'));
                                        if (item.kind === 'slash' && item.commandName) onPrefillCompose?.(item.commandName);
                                        setOpen(false);
                                        setQuery('');
                                    }}
                                >
                                    <span class="timeline-quick-actions-item-media">
                                        ${renderQuickActionMedia(item)}
                                    </span>
                                    <span class="timeline-quick-actions-item-copy">
                                        <span class="timeline-quick-actions-item-title-row">
                                            <span class="timeline-quick-actions-item-title">${item.title}</span>
                                            ${item.actionHint ? html`<span class="timeline-quick-actions-item-action-hint">${item.actionHint}</span>` : null}
                                        </span>
                                        <span class="timeline-quick-actions-item-subtitle">${item.subtitle}</span>
                                    </span>
                                    <span class="timeline-quick-actions-item-category">${item.categoryLabel || sectionLabel(item.kind)}</span>
                                </button>
                            `;
                        })}
                    </div>
                </div>
            </div>
        <//>
    `;
}
