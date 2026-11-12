
type ChatWindowRuntime = { window?: any; navigator?: any };
type ChatWindowOptions = Record<string, any>;

export function isStandaloneWebAppMode(runtime: ChatWindowRuntime = {}) {
    const win = runtime.window ?? (typeof window !== 'undefined' ? window : null);
    const nav = runtime.navigator ?? (typeof navigator !== 'undefined' ? navigator : null);

    if (nav && nav.standalone === true) {
        return true;
    }

    if (!win || typeof win.matchMedia !== 'function') {
        return false;
    }

    const queries = [
        '(display-mode: standalone)',
        '(display-mode: minimal-ui)',
        '(display-mode: fullscreen)',
    ];
    return queries.some((query) => {
        try {
            return Boolean(win.matchMedia(query)?.matches);
        } catch {
            /* expected: older browsers or test doubles may reject matchMedia queries. */
            return false;
        }
    });
}

export function isMobileBrowserMode(runtime: ChatWindowRuntime = {}) {
    const win = runtime.window ?? (typeof window !== 'undefined' ? window : null);
    const nav = runtime.navigator ?? (typeof navigator !== 'undefined' ? navigator : null);
    if (!win && !nav) return false;

    const userAgent = String(nav?.userAgent || '');
    const maxTouchPoints = Number(nav?.maxTouchPoints || 0);
    const mobileUa = /Android|webOS|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(userAgent);
    const coarsePointer = (() => {
        if (!win || typeof win.matchMedia !== 'function') return false;
        try {
            return Boolean(win.matchMedia('(pointer: coarse)')?.matches || win.matchMedia('(any-pointer: coarse)')?.matches);
        } catch {
            return false;
        }
    })();

    return Boolean(mobileUa || maxTouchPoints > 1 || coarsePointer);
}

export function getChatWindowOpenOptions(chatJid, runtime: ChatWindowRuntime = {}) {
    if (isStandaloneWebAppMode(runtime)) {
        return null;
    }
    if (isMobileBrowserMode(runtime)) {
        return {
            target: '_blank',
            features: undefined,
            mode: 'tab',
        };
    }
    return {
        target: getChatWindowTarget(chatJid),
        features: 'popup=yes,width=900,height=960,resizable=yes,scrollbars=yes',
        mode: 'popup',
    };
}

export function openProvisionalChatWindow(openOptions, runtime: ChatWindowRuntime = {}) {
    const win = runtime.window ?? (typeof window !== 'undefined' ? window : null);
    if (!win || !openOptions) return null;
    try {
        return openOptions.features
            ? win.open('about:blank', openOptions.target, openOptions.features)
            : win.open('about:blank', openOptions.target);
    } catch {
        /* expected: popup blockers can reject provisional window creation. */
        return null;
    }
}

export function primeProvisionalChatWindow(handle, options: ChatWindowOptions = {}) {
    if (!handle || !handle.document) return;
    try {
        const title = String(options.title || 'Opening branch…');
        const message = String(options.message || 'Preparing a new branch window…');
        handle.document.title = title;
        const body = handle.document.body;
        if (!body) return;

        if (typeof handle.document.createElement !== 'function') {
            body.textContent = `${title}\n${message}`;
            return;
        }

        const wrapper = handle.document.createElement('div');
        wrapper.setAttribute('style', 'font-family: system-ui, sans-serif; padding: 24px; color: #222;');

        const heading = handle.document.createElement('h1');
        heading.setAttribute('style', 'font-size: 18px; margin: 0 0 12px;');
        heading.textContent = title;

        const paragraph = handle.document.createElement('p');
        paragraph.setAttribute('style', 'margin: 0; line-height: 1.5;');
        paragraph.textContent = message;

        wrapper.appendChild(heading);
        wrapper.appendChild(paragraph);
        if (typeof body.replaceChildren === 'function') {
            body.replaceChildren(wrapper);
        } else {
            body.innerHTML = '';
            body.appendChild(wrapper);
        }
    } catch {
        return;
    }
}

export function navigateProvisionalChatWindow(handle, url) {
    if (!handle || !url) return;
    try {
        if (handle.location && typeof handle.location.replace === 'function') {
            handle.location.replace(String(url));
            return;
        }
        handle.location = String(url);
    } catch {
        return;
    }
}

export function closeProvisionalChatWindow(handle) {
    if (!handle || typeof handle.close !== 'function') return;
    try {
        handle.close();
    } catch {
        return;
    }
}

export function buildChatWindowUrl(baseHref, chatJid, options: ChatWindowOptions = {}) {
    const url = new URL(String(baseHref || 'http://localhost/'));
    const normalizedChatJid = String(chatJid || '').trim() || 'web:default';
    url.searchParams.set('chat_jid', normalizedChatJid);
    url.searchParams.delete('branch_loader');
    url.searchParams.delete('branch_source_chat_jid');
    url.searchParams.delete('pane_popout');
    url.searchParams.delete('pane_path');
    url.searchParams.delete('pane_label');
    if (options.chatOnly === true) {
        // Pop-outs start uncluttered; see applyUnclutteredWindowHint.
        url.searchParams.set('chat_only', '1');
    }
    return url.toString();
}

export function buildBranchLoaderUrl(baseHref, sourceChatJid, options: ChatWindowOptions = {}) {
    const url = new URL(String(baseHref || 'http://localhost/'));
    const normalizedChatJid = String(sourceChatJid || '').trim() || 'web:default';
    url.searchParams.set('branch_loader', '1');
    url.searchParams.set('branch_source_chat_jid', normalizedChatJid);
    url.searchParams.delete('chat_jid');
    url.searchParams.delete('pane_popout');
    url.searchParams.delete('pane_path');
    url.searchParams.delete('pane_label');
    if (options.chatOnly === true) {
        // Pop-outs start uncluttered; see applyUnclutteredWindowHint.
        url.searchParams.set('chat_only', '1');
    }
    return url.toString();
}

export function buildPanePopoutUrl(baseHref, panePath, options: ChatWindowOptions = {}) {
    const url = new URL(String(baseHref || 'http://localhost/'));
    const normalizedPanePath = String(panePath || '').trim();
    if (!normalizedPanePath) return url.toString();
    url.searchParams.set('pane_popout', '1');
    url.searchParams.set('pane_path', normalizedPanePath);
    if (options?.label) {
        url.searchParams.set('pane_label', String(options.label));
    } else {
        url.searchParams.delete('pane_label');
    }
    if (options?.chatJid) {
        url.searchParams.set('chat_jid', String(options.chatJid));
    }
    const extraParams = options?.params && typeof options.params === 'object' ? options.params : null;
    if (extraParams) {
        for (const [key, value] of Object.entries(extraParams)) {
            const normalizedKey = String(key || '').trim();
            if (!normalizedKey) continue;
            if (value === null || value === undefined || value === '') {
                url.searchParams.delete(normalizedKey);
            } else {
                url.searchParams.set(normalizedKey, String(value));
            }
        }
    }
    url.searchParams.delete('chat_only');
    url.searchParams.delete('branch_loader');
    url.searchParams.delete('branch_source_chat_jid');
    return url.toString();
}

export function getChatWindowTarget(chatJid) {
    const normalized = String(chatJid || 'web:default')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-');
    return `piclaw-chat-${normalized || 'default'}`;
}

export function getPaneWindowTarget(panePath) {
    const normalized = String(panePath || 'pane')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-');
    return `piclaw-pane-${normalized || 'default'}`;
}

export function getPaneWindowOpenOptions(panePath, runtime: ChatWindowRuntime = {}) {
    if (isStandaloneWebAppMode(runtime)) {
        return null;
    }
    if (isMobileBrowserMode(runtime)) {
        return {
            target: '_blank',
            features: undefined,
            mode: 'tab',
        };
    }
    return {
        target: getPaneWindowTarget(panePath),
        features: 'popup=yes,width=1200,height=960,resizable=yes,scrollbars=yes',
        mode: 'popup',
    };
}

export function describeBranchOpenError(error) {
    const raw = error instanceof Error ? error.message : String(error || '').trim();
    const message = String(raw || '').trim();
    if (!message) {
        return 'PiClaw could not open a new branch window.';
    }

    const normalized = message.toLowerCase();
    if (normalized.includes('no stable turn boundary')) {
        return 'This chat is still in flight and does not yet have a stable turn boundary to fork from.';
    }
    if (normalized.includes('cannot fork a branch while the source chat is still active')) {
        return 'This chat is still active. Please wait for the current turn to settle, then try again.';
    }
    if (normalized.includes('cancelled')) {
        return 'Branch creation was cancelled before a new chat window could be opened.';
    }
    if (normalized.includes('did not return a chat id')) {
        return 'PiClaw created no usable branch id for the new window. Please try again.';
    }
    if (normalized.includes('failed to fork branch') || normalized.includes('failed to fork chat branch')) {
        return 'PiClaw could not create the new branch. Please try again.';
    }

    return message;
}
