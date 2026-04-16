// @ts-nocheck
/**
 * API client for Vibes backend
 */

import { recordAppPerfRequest } from './ui/app-perf-tracing.js';

const API_BASE = '';

/**
 * Fetch wrapper with error handling
 */
async function request(url, options = {}) {
    const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    let response;
    try {
        response = await fetch(API_BASE + url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });
    } catch (error) {
        recordAppPerfRequest({
            method: String(options.method || 'GET').toUpperCase(),
            url,
            startedAt,
            durationMs: (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()) - startedAt,
            ok: false,
            detail: { failedBeforeResponse: true },
        });
        throw error;
    }

    const durationMs = (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()) - startedAt;
    recordAppPerfRequest({
        method: String(options.method || 'GET').toUpperCase(),
        url,
        startedAt,
        durationMs,
        status: response.status,
        ok: response.ok,
        requestId: response.headers?.get?.('x-request-id') || null,
        serverTiming: response.headers?.get?.('Server-Timing') || null,
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }
    
    return response.json();
}

function parseEventStreamBlock(block) {
    const lines = String(block || '').split('\n');
    let event = 'message';
    const dataLines = [];
    for (const line of lines) {
        if (line.startsWith('event:')) {
            event = line.slice(6).trim() || 'message';
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
        }
    }
    const rawData = dataLines.join('\n');
    if (!rawData) return null;
    try {
        return { event, data: JSON.parse(rawData) };
    } catch {
        return { event, data: rawData };
    }
}

async function consumeEventStream(response, onEvent) {
    if (!response.body) throw new Error('Missing event stream body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
            const parsed = parseEventStreamBlock(part);
            if (parsed) onEvent(parsed.event, parsed.data);
        }
    }

    buffer += decoder.decode();
    const tail = parseEventStreamBlock(buffer);
    if (tail) onEvent(tail.event, tail.data);
}

/**
 * Get timeline posts (chat style - returns oldest first)
 */
export async function getTimeline(limit = 10, beforeId = null, chatJid = null) {
    let url = `/timeline?limit=${limit}`;
    if (beforeId) {
        url += `&before=${beforeId}`;
    }
    if (chatJid) {
        url += `&chat_jid=${encodeURIComponent(chatJid)}`;
    }
    return request(url);
}

/**
 * Get posts by hashtag
 */
export async function getPostsByHashtag(hashtag, limit = 50, offset = 0, chatJid = null) {
    const query = chatJid ? `&chat_jid=${encodeURIComponent(chatJid)}` : '';
    return request(`/hashtag/${encodeURIComponent(hashtag)}?limit=${limit}&offset=${offset}${query}`);
}

/**
 * Search posts
 */
export async function searchPosts(query, limit = 50, offset = 0, chatJid = null, scope = 'current', rootChatJid = null) {
    const chatQuery = chatJid ? `&chat_jid=${encodeURIComponent(chatJid)}` : '';
    const scopeQuery = scope ? `&scope=${encodeURIComponent(scope)}` : '';
    const rootQuery = rootChatJid ? `&root_chat_jid=${encodeURIComponent(rootChatJid)}` : '';
    return request(`/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}${chatQuery}${scopeQuery}${rootQuery}`);
}

/**
 * Get a thread by ID
 */
export async function getThread(threadId, chatJid = null) {
    const query = chatJid ? `?chat_jid=${encodeURIComponent(chatJid)}` : '';
    return request(`/thread/${threadId}${query}`);
}

export async function getSystemMetrics() {
    return request('/agent/system-metrics');
}

/**
 * Create a new post
 */
export async function createPost(content, mediaIds = [], chatJid = null) {
    const query = chatJid ? `?chat_jid=${encodeURIComponent(chatJid)}` : '';
    return request(`/post${query}`, {
        method: 'POST',
        body: JSON.stringify({ content, media_ids: mediaIds }),
    });
}

/**
 * Reply to a thread.
 */
export async function createReply(threadId, content, mediaIds = [], chatJid = null) {
    const query = chatJid ? `?chat_jid=${encodeURIComponent(chatJid)}` : '';
    return request(`/post/reply${query}`, {
        method: 'POST',
        body: JSON.stringify({ thread_id: threadId, content, media_ids: mediaIds }),
    });
}

/**
 * Delete a post (optionally cascade replies)
 */
export async function deletePost(postId, cascade = false, chatJid = null) {
    const chatQuery = chatJid ? `&chat_jid=${encodeURIComponent(chatJid)}` : '';
    const url = `/post/${postId}?cascade=${cascade ? 'true' : 'false'}${chatQuery}`;
    return request(url, { method: 'DELETE' });
}

/**
 * Send message to agent
 */
export async function sendAgentMessage(agentId, content, threadId = null, mediaIds = [], mode = null, chatJid = null) {
    const query = chatJid ? `?chat_jid=${encodeURIComponent(chatJid)}` : '';
    const payload = { content, thread_id: threadId, media_ids: mediaIds };
    if (mode === 'auto' || mode === 'queue' || mode === 'steer') {
        payload.mode = mode;
    }
    return request(`/agent/${agentId}/message${query}`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

/**
 * List currently active chat agents/branches known to the backend session pool.
 */
export async function getActiveChatAgents() {
    return request('/agent/active-chats');
}

/**
 * List known branch/session records from the branch registry.
 */
export async function getChatBranches(rootChatJid = null, options = {}) {
    const params = new URLSearchParams();
    if (rootChatJid) params.set('root_chat_jid', String(rootChatJid));
    if (options?.includeArchived) params.set('include_archived', '1');
    const query = params.toString() ? `?${params.toString()}` : '';
    return request(`/agent/branches${query}`);
}

/**
 * Create a first-class forked branch from an existing chat branch.
 */
export async function forkChatBranch(sourceChatJid, options = {}) {
    return request('/agent/branch-fork', {
        method: 'POST',
        body: JSON.stringify({
            source_chat_jid: sourceChatJid,
            ...(options?.agentName ? { agent_name: options.agentName } : {}),
        }),
    });
}

/**
 * Rename a registry-backed chat branch / agent identity.
 */
export async function renameChatBranch(chatJid, options = {}) {
    return request('/agent/branch-rename', {
        method: 'POST',
        body: JSON.stringify({
            chat_jid: chatJid,
            ...(options && Object.prototype.hasOwnProperty.call(options, 'agentName') ? { agent_name: options.agentName } : {}),
        }),
    });
}

/**
 * Archive/prune a registry-backed chat branch / agent identity.
 */
export async function pruneChatBranch(chatJid) {
    return request('/agent/branch-prune', {
        method: 'POST',
        body: JSON.stringify({ chat_jid: chatJid }),
    });
}

/**
 * Restore/reopen an archived branch into active discovery.
 */
export async function restoreChatBranch(chatJid, options = {}) {
    return request('/agent/branch-restore', {
        method: 'POST',
        body: JSON.stringify({
            chat_jid: chatJid,
            ...(options && Object.prototype.hasOwnProperty.call(options, 'agentName') ? { agent_name: options.agentName } : {}),
        }),
    });
}

/**
 * Relay a peer message from one chat agent/window to another.
 */
export async function sendPeerAgentMessage(sourceChatJid, targetChatOrName, content, mode = 'auto', options = {}) {
    const payload = {
        source_chat_jid: sourceChatJid,
        content,
        mode,
        ...(options?.sourceAgentName ? { source_agent_name: options.sourceAgentName } : {}),
        ...(options?.targetBy === 'agent_name'
            ? { target_agent_name: targetChatOrName }
            : { target_chat_jid: targetChatOrName }),
    };
    return request('/agent/peer-message', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function getWebPushPublicKey() {
    return request('/agent/push/vapid-public-key');
}

export async function saveWebPushSubscription(subscription, options = {}) {
    const payload = {
        subscription,
        ...(options?.deviceId ? { device_id: options.deviceId } : {}),
    };
    return request('/agent/push/subscription', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function deleteWebPushSubscription(subscription, options = {}) {
    const payload = {
        subscription,
        ...(options?.deviceId ? { device_id: options.deviceId } : {}),
    };
    return request('/agent/push/subscription', {
        method: 'DELETE',
        body: JSON.stringify(payload),
    });
}

/**
 * Get available agents / current agent roster.
 */
export async function getAgents() {
    return request('/agent/roster');
}

/**
 * Get current agent status
 */
export async function getAgentStatus(chatJid = null) {
    const query = chatJid ? `?chat_jid=${encodeURIComponent(chatJid)}` : '';
    return request(`/agent/status${query}`);
}

/**
 * Get context window usage (tokens, contextWindow, percent).
 * Returns null fields when the session has no usage data yet.
 */
export async function getAgentContext(chatJid = null) {
    const query = chatJid ? `?chat_jid=${encodeURIComponent(chatJid)}` : '';
    return request(`/agent/context${query}`);
}

/**
 * Get the live autoresearch status-panel widget payload for the current chat.
 */
export async function getAutoresearchStatus(chatJid = null) {
    const query = chatJid ? `?chat_jid=${encodeURIComponent(chatJid)}` : '';
    return request(`/agent/autoresearch/status${query}`);
}

/**
 * Stop the currently running autoresearch experiment for the current chat.
 */
export async function stopAutoresearch(chatJid = null, options = {}) {
    return request('/agent/autoresearch/stop', {
        method: 'POST',
        body: JSON.stringify({
            chat_jid: chatJid || undefined,
            generate_report: options?.generateReport !== false,
        }),
    });
}

export async function dismissAutoresearch(chatJid = null) {
    return request('/agent/autoresearch/dismiss', {
        method: 'POST',
        body: JSON.stringify({
            chat_jid: chatJid || undefined,
        }),
    });
}

/**
 * Get queued follow-up state for the default web chat (count + pending items).
 */
export async function getAgentQueueState(chatJid = null) {
    const query = chatJid ? `?chat_jid=${encodeURIComponent(chatJid)}` : '';
    return request(`/agent/queue-state${query}`);
}

/**
 * Remove one queued follow-up item by placeholder row id.
 */
export async function removeAgentQueueItem(rowId, chatJid = null) {
    const response = await fetch(API_BASE + '/agent/queue-remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ row_id: rowId, chat_jid: chatJid || undefined }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to remove queued item' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * Atomically convert one queued follow-up into steering (when active) or an
 * immediate send (when no active stream remains).
 */
export async function steerAgentQueueItem(rowId, chatJid = null) {
    const response = await fetch(API_BASE + '/agent/queue-steer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ row_id: rowId, chat_jid: chatJid || undefined }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to steer queued item' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * Get available models and current selection.
 */
export async function getAgentModels(chatJid = null) {
    const query = chatJid ? `?chat_jid=${encodeURIComponent(chatJid)}` : '';
    return request(`/agent/models${query}`);
}

/**
 * Upload media file
 */
export async function uploadMedia(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch(API_BASE + '/media/upload', {
        method: 'POST',
        body: formData,
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }
    
    return response.json();
}

/**
 * Respond to an agent request (permission, choice)
 */
export async function respondToAgentRequest(requestId, outcome, chatJid = null) {
    const response = await fetch(API_BASE + '/agent/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, outcome, chat_jid: chatJid || undefined }),
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to respond' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }
    
    return response.json();
}

/**
 * Submit an Adaptive Card action back to the web channel.
 */
export async function submitAdaptiveCardAction(payload) {
    const response = await fetch(API_BASE + '/agent/card-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Adaptive Card action failed' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
}

export async function streamSidePrompt(prompt, options = {}) {
    const response = await fetch(API_BASE + '/agent/side-prompt/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt,
            system_prompt: options.systemPrompt || undefined,
            chat_jid: options.chatJid || undefined,
        }),
        signal: options.signal,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Side prompt failed' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }

    let finalPayload = null;
    let errorPayload = null;
    await consumeEventStream(response, (eventType, data) => {
        options.onEvent?.(eventType, data);
        if (eventType === 'side_prompt_thinking_delta') {
            options.onThinkingDelta?.(data?.delta || '');
        } else if (eventType === 'side_prompt_text_delta') {
            options.onTextDelta?.(data?.delta || '');
        } else if (eventType === 'side_prompt_done') {
            finalPayload = data;
        } else if (eventType === 'side_prompt_error') {
            errorPayload = data;
        }
    });

    if (errorPayload) {
        const error = new Error(errorPayload?.error || 'Side prompt failed');
        error.payload = errorPayload;
        throw error;
    }

    return finalPayload;
}

/**
 * Add pattern to permission whitelist
 */
export async function addToWhitelist(pattern, description) {
    const response = await fetch(API_BASE + '/agent/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern, description }),
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to add to whitelist' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }
    
    return response.json();
}

/** Fetch the agent thought/plan panel content for a given turn. */
export async function getAgentThought(turnId, panel = 'thought') {
    const url = `/agent/thought?turn_id=${encodeURIComponent(turnId)}&panel=${encodeURIComponent(panel)}`;
    return request(url);
}

/** Toggle visibility of a thought/plan panel in the UI. */
export async function setAgentThoughtVisibility(turnId, panel, expanded) {
    return request('/agent/thought/visibility', {
        method: 'POST',
        body: JSON.stringify({ turn_id: turnId, panel, expanded: Boolean(expanded) }),
    });
}

/**
 * Get media URL
 */
export function getMediaUrl(mediaId) {
    return `${API_BASE}/media/${mediaId}`;
}

/**
 * Get media thumbnail URL
 */
export function getThumbnailUrl(mediaId) {
    return `${API_BASE}/media/${mediaId}/thumbnail`;
}

/**
 * Get media info (metadata without data)
 */
export async function getMediaInfo(mediaId) {
    const response = await fetch(`${API_BASE}/media/${mediaId}/info`);
    if (!response.ok) throw new Error('Failed to get media info');
    return response.json();
}

/** Load media as text for text-like attachment previews. */
export async function getMediaText(mediaId) {
    const response = await fetch(`${API_BASE}/media/${mediaId}`);
    if (!response.ok) throw new Error('Failed to load media text');
    return response.text();
}

/** Load media as a Blob for preview flows that need object URLs (e.g. PDFs). */
export async function getMediaBlob(mediaId) {
    const response = await fetch(`${API_BASE}/media/${mediaId}`);
    if (!response.ok) throw new Error('Failed to load media blob');
    return response.blob();
}

/**
 * Get workspace tree
 */
export async function getWorkspaceTree(path = '', depth = 2, showHidden = false) {
    const url = `/workspace/tree?path=${encodeURIComponent(path)}&depth=${depth}&show_hidden=${showHidden ? '1' : '0'}`;
    return request(url);
}

/** Get the current workspace git branch for the nearest enclosing repo. */
export async function getWorkspaceBranch(path = '') {
    const url = `/workspace/branch?path=${encodeURIComponent(path || '')}`;
    return request(url);
}

/** Get the current workspace FTS indexing status snapshot. */
export async function getWorkspaceIndexStatus(scope = 'all') {
    const url = `/workspace/index-status?scope=${encodeURIComponent(scope || 'all')}`;
    return request(url);
}

/** Trigger a workspace FTS reindex and return the updated status snapshot. */
export async function reindexWorkspace(scope = 'all') {
    return request('/workspace/reindex', {
        method: 'POST',
        body: JSON.stringify({ scope }),
    });
}

/**
 * Get workspace file preview
 */
export async function getWorkspaceFile(path, maxBytes = 20000, mode = null) {
    const modeParam = mode ? `&mode=${encodeURIComponent(mode)}` : '';
    const url = `/workspace/file?path=${encodeURIComponent(path)}&max=${maxBytes}${modeParam}`;
    return request(url);
}

/**
 * Update workspace file contents
 */
export async function updateWorkspaceFile(path, content) {
    return request('/workspace/file', {
        method: 'PUT',
        body: JSON.stringify({ path, content }),
    });
}

/**
 * Create a download attachment for a workspace file
 */
export async function attachWorkspaceFile(path) {
    return request('/workspace/attach', {
        method: 'POST',
        body: JSON.stringify({ path }),
    });
}

/** Upload a file to the workspace via multipart form data. */
/** Maximum client-side upload size (256 MB). Larger files need chunked upload. */
const MAX_UPLOAD_SIZE = 256 * 1024 * 1024;

export async function uploadWorkspaceFile(file, targetPath = '', options = {}) {
    if (file?.size > MAX_UPLOAD_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(0);
        const limitMB = (MAX_UPLOAD_SIZE / (1024 * 1024)).toFixed(0);
        const err = new Error(`File too large (${sizeMB} MB). Maximum upload size is ${limitMB} MB.`);
        err.code = 'file_too_large';
        throw err;
    }

    const formData = new FormData();
    formData.append('file', file);
    const params = new URLSearchParams();
    if (targetPath) params.set('path', targetPath);
    if (options.overwrite) params.set('overwrite', '1');
    const query = params.toString();
    const url = query ? `/workspace/upload?${query}` : '/workspace/upload';

    if (typeof options.onProgress === 'function') {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', API_BASE + url);
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    options.onProgress({ loaded: e.loaded, total: e.total, percent: Math.round((e.loaded / e.total) * 100) });
                }
            };
            xhr.onload = () => {
                try {
                    const body = JSON.parse(xhr.responseText);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(body);
                    } else {
                        const err = new Error(body.error || `HTTP ${xhr.status}`);
                        err.status = xhr.status;
                        err.code = body.code;
                        reject(err);
                    }
                } catch {
                    reject(new Error(`HTTP ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('Upload failed (network error)'));
            xhr.ontimeout = () => reject(new Error('Upload timed out'));
            xhr.send(formData);
        });
    }

    const response = await fetch(API_BASE + url, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Upload failed' }));
        const err = new Error(error.error || `HTTP ${response.status}`);
        err.status = response.status;
        err.code = error.code;
        throw err;
    }

    return response.json();
}

/** Create a new workspace file. */
export async function createWorkspaceFile(path, name, content = '') {
    const response = await fetch(API_BASE + '/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, name, content }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Create failed' }));
        const err = new Error(error.error || `HTTP ${response.status}`);
        err.status = response.status;
        err.code = error.code;
        throw err;
    }

    return response.json();
}

/** Rename a workspace file or folder. */
export async function renameWorkspaceFile(path, name) {
    const response = await fetch(API_BASE + '/workspace/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, name }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Rename failed' }));
        const err = new Error(error.error || `HTTP ${response.status}`);
        err.status = response.status;
        err.code = error.code;
        throw err;
    }

    return response.json();
}

/** Move a workspace file or folder into another directory. */
export async function moveWorkspaceEntry(path, target) {
    const response = await fetch(API_BASE + '/workspace/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, target }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Move failed' }));
        const err = new Error(error.error || `HTTP ${response.status}`);
        err.status = response.status;
        err.code = error.code;
        throw err;
    }

    return response.json();
}

/** Delete a file from the workspace. */
export async function deleteWorkspaceFile(path) {
    const url = `/workspace/file?path=${encodeURIComponent(path || '')}`;
    return request(url, { method: 'DELETE' });
}

/** Toggle workspace explorer visibility and hidden-file display. */
export async function setWorkspaceVisibility(visible, showHidden = false) {
    return request('/workspace/visibility', {
        method: 'POST',
        body: JSON.stringify({ visible: Boolean(visible), show_hidden: Boolean(showHidden) }),
    });
}

/**
 * Get raw workspace file URL (images/SVG)
 */
export function getWorkspaceRawUrl(path, options = {}) {
    const query = new URLSearchParams({ path: String(path || '') });
    if (options.download) query.set('download', '1');
    return `${API_BASE}/workspace/raw?${query.toString()}`;
}

/**
 * Get workspace file download URL.
 */
export function getWorkspaceFileDownloadUrl(path) {
    return getWorkspaceRawUrl(path, { download: true });
}

/**
 * Get workspace folder download URL (zip)
 */
export function getWorkspaceDownloadUrl(path, showHidden = false) {
    const query = `path=${encodeURIComponent(path || '')}&show_hidden=${showHidden ? '1' : '0'}`;
    return `${API_BASE}/workspace/download?${query}`;
}

/**
 * SSE client for live updates
 */
export class SSEClient {
    constructor(onEvent, onStatusChange, options = {}) {
        this.onEvent = onEvent;
        this.onStatusChange = onStatusChange;
        this.chatJid = typeof options?.chatJid === 'string' && options.chatJid.trim() ? options.chatJid.trim() : null;
        this.eventSource = null;
        this.reconnectTimeout = null;
        this.reconnectDelay = 1000;
        this.status = 'disconnected';
        this.reconnectAttempts = 0;
        this.cooldownUntil = 0;
        this.connecting = false;
        this.lastActivityAt = 0;
        this.staleCheckTimer = null;
        this.staleThresholdMs = 70000;
    }

    markActivity() {
        this.lastActivityAt = Date.now();
    }

    clearStaleMonitor() {
        if (this.staleCheckTimer) {
            clearInterval(this.staleCheckTimer);
            this.staleCheckTimer = null;
        }
    }

    startStaleMonitor() {
        this.clearStaleMonitor();
        this.staleCheckTimer = setInterval(() => {
            if (this.status !== 'connected') return;
            if (!this.lastActivityAt) return;
            if (Date.now() - this.lastActivityAt <= this.staleThresholdMs) return;
            console.warn('SSE connection went stale; forcing reconnect');
            this.forceReconnect();
        }, 15000);
    }

    forceReconnect() {
        this.connecting = false;
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.clearStaleMonitor();
        this.status = 'disconnected';
        this.onStatusChange('disconnected');
        this.reconnectAttempts += 1;
        this.scheduleReconnect();
    }
    
    connect() {
        if (this.connecting) return;
        if (this.eventSource && this.status === 'connected') return;
        this.connecting = true;
        if (this.eventSource) {
            this.eventSource.close();
        }
        this.clearStaleMonitor();
        
        const query = this.chatJid ? `?chat_jid=${encodeURIComponent(this.chatJid)}` : '';
        this.eventSource = new EventSource(API_BASE + '/sse/stream' + query);

        const bindJsonEvent = (eventType) => {
            this.eventSource.addEventListener(eventType, (e) => {
                this.markActivity();
                this.onEvent(eventType, JSON.parse(e.data));
            });
        };
        
        this.eventSource.onopen = () => {
            this.connecting = false;
            this.reconnectDelay = 1000;
            this.reconnectAttempts = 0;
            this.cooldownUntil = 0;
            this.status = 'connected';
            this.markActivity();
            this.startStaleMonitor();
            this.onStatusChange('connected');
        };
        
        this.eventSource.onerror = () => {
            this.connecting = false;
            this.clearStaleMonitor();
            this.status = 'disconnected';
            this.onStatusChange('disconnected');
            this.reconnectAttempts += 1;
            this.scheduleReconnect();
        };
        
        // Event handlers
        this.eventSource.addEventListener('connected', () => {
            this.markActivity();
            console.log('SSE connected');
            this.onEvent('connected', {});
        });

        this.eventSource.addEventListener('heartbeat', () => {
            this.markActivity();
        });
        
        bindJsonEvent('new_post');
        bindJsonEvent('new_reply');
        bindJsonEvent('agent_response');
        bindJsonEvent('interaction_updated');
        bindJsonEvent('interaction_deleted');
        bindJsonEvent('agent_status');
        bindJsonEvent('agent_steer_queued');
        bindJsonEvent('agent_followup_queued');
        bindJsonEvent('agent_followup_consumed');
        bindJsonEvent('agent_followup_removed');
        bindJsonEvent('workspace_update');
        bindJsonEvent('agent_draft');
        bindJsonEvent('agent_draft_delta');
        bindJsonEvent('agent_thought');
        bindJsonEvent('agent_thought_delta');
        bindJsonEvent('model_changed');
        bindJsonEvent('ui_theme');
        bindJsonEvent('ui_meters');

        [
            'extension_ui_request',
            'extension_ui_timeout',
            'extension_ui_notify',
            'extension_ui_status',
            'extension_ui_working',
            'extension_ui_widget',
            'extension_ui_title',
            'extension_ui_editor_text',
            'extension_ui_error',
        ].forEach(bindJsonEvent);
    }
    
    scheduleReconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        const MAX_ATTEMPTS = 10;
        const COOLDOWN_MS = 60000;
        const now = Date.now();
        if (this.reconnectAttempts >= MAX_ATTEMPTS) {
            this.cooldownUntil = Math.max(this.cooldownUntil, now + COOLDOWN_MS);
            this.reconnectAttempts = 0;
        }

        const cooldownDelay = Math.max(this.cooldownUntil - now, 0);
        const delay = Math.max(this.reconnectDelay, cooldownDelay);
        
        this.reconnectTimeout = setTimeout(() => {
            console.log('Reconnecting SSE...');
            this.connect();
        }, delay);
        
        // Exponential backoff, max 30 seconds
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    }

    reconnectIfNeeded() {
        const now = Date.now();
        if (this.status === 'connected') {
            if (this.lastActivityAt && now - this.lastActivityAt > this.staleThresholdMs) {
                this.forceReconnect();
            }
            return;
        }
        if (this.cooldownUntil && now < this.cooldownUntil) return;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        this.connect();
    }
    
    disconnect() {
        this.connecting = false;
        this.clearStaleMonitor();
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }
}
