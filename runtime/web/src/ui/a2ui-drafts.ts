import { setA2uiOverlay } from '../../../src/channels/web/a2ui/data-path.js';
import { MAX_A2UI_DRAFT_BYTES, type A2uiDraftEdit, type A2uiDraftPatch } from '../../../src/channels/web/a2ui/drafts.js';

// Keep unsubmitted edits in this tab's memory, including across Classic pane changes.
type DraftStep = {path:string;edit:A2uiDraftEdit;collection?:true};
const pending=new Map<string,{chat:string;surface:string;revision:number;shareModel:boolean;edits:Map<string,A2uiDraftEdit>;history?:DraftStep[]}>();
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

export function readA2uiDraftSteps(chat:string,surface:string,revision:number): A2uiDraftEdit[] {
    const draft=pending.get(key(chat,surface));
    return draft?.revision===revision ? draft.history?.map(step=>step.edit) ?? [...draft.edits.values()] : [];
}

export function discardOldA2uiDraft(chat: string, surface: string, revision: number) {
    const id = key(chat, surface);
    const draft = pending.get(id);
    if (draft && draft.revision < revision) pending.delete(id);
}

export function rememberA2uiDraftEdit(chat:string,surface:string,revision:number,path:string,edit:A2uiDraftEdit,shareModel=true,collection=false) {
    const id=key(chat,surface), previous=pending.get(id);
    if (previous && previous.revision>revision) return false;
    const current=previous?.revision===revision ? previous : undefined;
    const edits=new Map(current?.edits);
    setA2uiOverlay(edits,path,edit);
    // Keep the order across collection changes. The next edit may name a control
    // which only exists after an earlier edit, even if the final model hides it.
    const history=current?.history?.slice() ?? (collection ? [...(current?.edits ?? [])].map(([path,edit]):DraftStep=>({path,edit})) : undefined);
    if (history) {
        const last=history.at(-1);
        if (last?.path===path && last.edit.component_id===edit.component_id && last.edit.instance_path===edit.instance_path) history.pop();
        else if (!collection) for (let i=history.length-1;i>=0 && !history[i]?.collection;i--) {
            if (history[i]?.path===path) { history.splice(i,1); break; }
        }
        history.push({path,edit,...(collection ? {collection:true as const} : {})});
    }
    const steps=history?.map(step=>step.edit) ?? [...edits.values()];
    if (steps.length>384 || new TextEncoder().encode(JSON.stringify(steps)).length>MAX_A2UI_DRAFT_BYTES) return false;
    pending.delete(id);
    pending.set(id,{chat,surface,revision,shareModel,edits,history});
    if (pending.size > 32) pending.delete(pending.keys().next().value!);
    for (const listener of listeners.get(id) ?? []) listener(revision, edits);
    return true;
}

export function a2uiDraftsFor(chat: string): A2uiDraftPatch[] | undefined {
    const patches = Array.from(pending.values()).filter(entry => entry.chat === chat && entry.shareModel).slice(-7)
        .map(({surface,revision})=>({surface_id:surface,revision,edits:readA2uiDraftSteps(chat,surface,revision)}));
    return patches.length ? patches : undefined;
}
