import type { A2uiDraftEdit, A2uiDraftPatch } from '../../../src/channels/web/a2ui/drafts.js';

// Keep unsubmitted edits in this tab's memory, including across Classic pane changes.
const pending = new Map<string, { chat: string; surface: string; revision: number; shareModel: boolean; edits: Map<string, A2uiDraftEdit> }>();
const key = (chat: string, surface: string) => JSON.stringify([chat, surface]);
const listeners = new Map<string, Set<(revision: number, edits: Map<string, A2uiDraftEdit>) => void>>();

export function subscribeA2uiDraft(chat: string, surface: string, listener: (revision: number, edits: Map<string, A2uiDraftEdit>) => void) {
    const id = key(chat, surface);
    const set = listeners.get(id) ?? new Set();
    listeners.set(id, set);
    set.add(listener);
    return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(id);
    };
}

export function readA2uiDraft(chat: string, surface: string, revision: number) {
    const draft = pending.get(key(chat, surface));
    return draft?.revision === revision ? draft.edits : undefined;
}

export function discardOldA2uiDraft(chat: string, surface: string, revision: number) {
    const id = key(chat, surface);
    const draft = pending.get(id);
    if (draft && draft.revision < revision) pending.delete(id);
}

export function rememberA2uiDraftEdit(chat: string, surface: string, revision: number, path: string, edit: A2uiDraftEdit, shareModel = true) {
    const id = key(chat, surface);
    const previous = pending.get(id);
    if (previous && previous.revision > revision) return;
    const edits = previous?.revision === revision ? previous.edits : new Map();
    edits.set(path, edit);
    pending.delete(id);
    pending.set(id, { chat, surface, revision, shareModel, edits });
    if (pending.size > 32) pending.delete(pending.keys().next().value!);
    for (const listener of listeners.get(id) ?? []) listener(revision, edits);
}

export function a2uiDraftsFor(chat: string): A2uiDraftPatch[] | undefined {
    const patches = Array.from(pending.values()).filter(entry => entry.chat === chat && entry.shareModel).slice(-7)
        .map(({surface, revision, edits}) => ({surface_id:surface, revision, edits:[...edits.values()]}));
    return patches.length ? patches : undefined;
}
