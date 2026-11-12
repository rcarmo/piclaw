import { html, useCallback, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { t } from '../utils/i18n.js';
import { getAgentCommands, getQuickActionsSettings } from '../api.js';
import { isPopupTypeaheadKey } from '../ui/popup-typeahead.js';
import { KEYBOARD_SHORTCUT_ACTIONS, matchesKeyboardShortcutAction } from '../ui/keyboard-shortcuts.ts';
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
    ].join(', ')));
}

export function isEligibleTimelineTarget(target) {
    if (!target || typeof target !== 'object') return true;
    if (isEditableTarget(target)) return false;
    const tagName = String(target.tagName || '').toUpperCase();
    if (tagName === 'BODY' || tagName === 'HTML') return true;
    if (typeof target.closest !== 'function') return true;
    return Boolean(target.closest('.container, .timeline, .post, .post-body, .post-content, .agent-status-panel'));
}

export function shouldOpenTimelineQuickActionsFromKeyEvent(event) {
    if (!isPopupTypeaheadKey(event)) return false;
    if (!isEligibleTimelineTarget(event?.target)) return false;
    const matchesShortcut = KEYBOARD_SHORTCUT_ACTIONS.some((action) => matchesKeyboardShortcutAction(event, action.id));
    return !matchesShortcut;
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
        label: options.workspaceOpen ? t('palette.hideWorkspace') : t('palette.showWorkspace'),
        description: options.workspaceOpen ? t('palette.hideWorkspaceDesc') : t('palette.showWorkspaceDesc'),
    });
    if (!options.workspaceOpen) {
        add('open-explorer');
    }
    if (typeof options.onOpenTerminalTab === 'function') add('open-terminal-tab');
    if (typeof options.onOpenVncTab === 'function') add('open-vnc-tab');
    add('open-settings');
    return commands;
}

function sectionLabel(kind) {
    if (kind === 'agent') return t('palette.groupAgents');
    if (kind === 'workspace') return t('palette.groupWorkspace');
    return t('palette.groupSlash');
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

function openInNewTab(chatJid) {
    const url = new URL(window.location.href);
    url.searchParams.set('chat_jid', chatJid);
    url.searchParams.set('chat_only', '1');
    const a = document.createElement('a');
    a.href = url.toString();
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

export function TimelineQuickActions({
    activeChatAgents = [],
    currentChatJid = 'web:default',
    workspaceOpen = false,
    onSwitchChat,
    onToggleWorkspace,
    onOpenTerminalTab,
    onOpenVncTab,
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
        onOpenTerminalTab,
        onOpenVncTab,
    }), [onOpenTerminalTab, onOpenVncTab, workspaceOpen]);

    const items = useMemo(() => buildTimelineQuickActionItems({
        agents: activeChatAgents,
        workspaceCommands,
        slashCommands,
        settings,
        query,
    }), [activeChatAgents, query, settings, slashCommands, workspaceCommands]);

    useEffect(() => {
        if (items.length === 0) {
            setHighlightIndex(-1);
            return;
        }
        if (!query.trim()) {
            setHighlightIndex(0);
            return;
        }
        const normalizedQuery = query.toLowerCase().replace(/^[@/]+/, '').trim();
        if (!normalizedQuery) {
            setHighlightIndex(0);
            return;
        }
        let bestIndex = 0;
        let bestScore = 0;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const title = (item.title || '').toLowerCase().replace(/^[@/]+/, '');
            if (title === normalizedQuery) {
                bestIndex = i;
                break;
            }
            let score = 0;
            if (title.startsWith(normalizedQuery)) {
                score = 3;
            } else if (title.includes(normalizedQuery)) {
                score = 2;
            } else if ((item.subtitle || '').toLowerCase().includes(normalizedQuery)) {
                score = 1;
            }
            if (score > bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }
        setHighlightIndex(bestIndex);
    }, [items, query]);

    useEffect(() => {
        if (!open) return;
        requestAnimationFrame(() => inputRef.current?.focus?.());
    }, [open]);

    useEffect(() => {
        const onKeyDown = (event) => {
            if (!open) {
                if (!shouldOpenTimelineQuickActionsFromKeyEvent(event)) return;
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
                const popOut = event.altKey;
                if (current) {
                    if (current.kind === 'agent' && current.chatJid) {
                        if (popOut) {
                            openInNewTab(current.chatJid);
                        } else {
                            onSwitchChat?.(current.chatJid);
                        }
                    } else if (current.kind === 'workspace' && current.commandId) {
                        if (current.commandId === 'toggle-workspace' || current.commandId === 'open-explorer') onToggleWorkspace?.();
                        if (current.commandId === 'open-terminal-tab') onOpenTerminalTab?.();
                        if (current.commandId === 'open-vnc-tab') onOpenVncTab?.();
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
    }, [highlightIndex, items, onOpenTerminalTab, onOpenVncTab, onPrefillCompose, onSwitchChat, onToggleWorkspace, open]);

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
        <div class="timeline-quick-actions-portal">
            <div class="timeline-quick-actions-overlay">
                <div class="timeline-quick-actions" ref=${rootRef}>
                    <div class="timeline-quick-actions-header">
                        <div class="timeline-quick-actions-search-row">
                            <input
                                ref=${inputRef}
                                class="timeline-quick-actions-input"
                                type="text"
                                value=${query}
                                placeholder=${t('palette.placeholder')}
                                onInput=${(event) => {
                                    setQuery(event.currentTarget?.value || '');
                                    setHighlightIndex(0);
                                }}
                            />
                            <div class="timeline-quick-actions-hints" aria-hidden="true">
                                ${renderKeyboardHint(t('palette.hintMove'), '↑↓')}
                                ${renderKeyboardHint(t('palette.hintSelect'), '↵')}
                                ${renderKeyboardHint(t('palette.hintPopOut'), 'Alt+↵')}
                                ${renderKeyboardHint(t('palette.hintClose'), 'Esc')}
                            </div>
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
                                    onMouseEnter=${null}
                                    onClick=${() => {
                                        if (item.kind === 'agent' && item.chatJid) onSwitchChat?.(item.chatJid);
                                        if (item.kind === 'workspace' && item.commandId === 'toggle-workspace') onToggleWorkspace?.();
                                        if (item.kind === 'workspace' && item.commandId === 'open-explorer') onToggleWorkspace?.();
                                        if (item.kind === 'workspace' && item.commandId === 'open-terminal-tab') onOpenTerminalTab?.();
                                        if (item.kind === 'workspace' && item.commandId === 'open-vnc-tab') onOpenVncTab?.();
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
        </div>
    `;
}
