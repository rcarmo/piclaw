import { isA2uiActionValue, type A2uiActionValue } from './action.js';

export interface A2uiDraftEdit {
  component_id: string;
  instance_path?: string;
  value: A2uiActionValue;
}

/** Classic transport only. A browser names a control occurrence, never a write path. */
export interface A2uiDraftPatch {
  surface_id: string;
  revision: number;
  edits: A2uiDraftEdit[];
}

const instancePath = /^(?:\/(?:0|[1-9][0-9]?)){1,24}$/;
export const MAX_A2UI_DRAFT_BYTES = 64 * 1024;

export class InvalidA2uiDraftError extends Error {
  constructor() { super('Invalid A2UI draft.'); }
}

export function parseA2uiDrafts(value: unknown): A2uiDraftPatch[] | undefined {
  if (value === undefined) return;
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const id = (item: unknown) => typeof item === 'string' && item.length > 0 && item.length <= 128;
  if (!Array.isArray(value) || value.length > 7 || value.some(patch => !record(patch) || Object.keys(patch).length !== 3
    || !id(patch.surface_id) || typeof patch.revision !== 'number' || !Number.isSafeInteger(patch.revision) || patch.revision < 1
    || !Array.isArray(patch.edits) || patch.edits.length < 1 || patch.edits.length > 384
    || patch.edits.some(edit => !record(edit) || Object.keys(edit).length !== 2 + Number(Object.hasOwn(edit, 'instance_path'))
      || !id(edit.component_id) || !isA2uiActionValue(edit.value)
      || (edit.instance_path !== undefined && (typeof edit.instance_path !== 'string' || !instancePath.test(edit.instance_path)))))) throw new InvalidA2uiDraftError();
  if (new Set(value.map(patch => patch.surface_id)).size !== value.length || new TextEncoder().encode(JSON.stringify(value)).length > MAX_A2UI_DRAFT_BYTES)
    throw new InvalidA2uiDraftError();
  return value;
}
