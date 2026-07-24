/**
 * queued-followups.ts – shared queued follow-up item projection helpers.
 *
 * This module is deliberately dependency-free so both DB persistence and web
 * runtime placeholder code can share the same clone/normalisation semantics
 * without coupling those storage layers together.
 */

export interface QueuedFollowupSourceMetadata {
  source?: string;
  userId?: string;
  sessionId?: string;
  clientId?: string;
}

export interface QueuedFollowupItem {
  rowId: number;
  queuedContent: string;
  threadId?: number | null;
  queuedAt: string;
  mediaIds?: number[];
  contentBlocks?: unknown[];
  linkPreviews?: unknown[];
  screenHint?: string;
  source?: string;
  queuedBy?: QueuedFollowupSourceMetadata;
  /** Number of times materializeNextDeferredFollowup has failed for this item. */
  materializeRetries?: number;
}

export type QueuedFollowupItemInput = Partial<QueuedFollowupItem> & Pick<QueuedFollowupItem, "rowId">;

export interface ProjectQueuedFollowupOptions {
  /** Persistence-only default; leave undefined for transient placeholder clones. */
  materializeRetriesDefault?: number;
}

function trimOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cloneArray<T>(value: T[] | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    return structuredClone(value) as T[];
  } catch {
    return value.map((entry) => (
      entry && typeof entry === "object" ? { ...(entry as Record<string, unknown>) } as T : entry
    ));
  }
}

export function normalizeQueuedFollowupSourceMetadata(value: unknown): QueuedFollowupSourceMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const queuedBy = {
    ...(trimOptionalString(record.source) ? { source: trimOptionalString(record.source) } : {}),
    ...(trimOptionalString(record.userId) ? { userId: trimOptionalString(record.userId) } : {}),
    ...(trimOptionalString(record.sessionId) ? { sessionId: trimOptionalString(record.sessionId) } : {}),
    ...(trimOptionalString(record.clientId) ? { clientId: trimOptionalString(record.clientId) } : {}),
  };
  return Object.keys(queuedBy).length > 0 ? queuedBy : undefined;
}

/** Project an arbitrary queued follow-up-like object into the canonical shape. */
export function projectQueuedFollowupItem(
  item: QueuedFollowupItemInput,
  options: ProjectQueuedFollowupOptions = {},
): QueuedFollowupItem {
  const materializeRetries = Number.isFinite(item.materializeRetries)
    ? Number(item.materializeRetries)
    : options.materializeRetriesDefault;
  return {
    rowId: Number(item.rowId),
    queuedContent: typeof item.queuedContent === "string" ? item.queuedContent : "",
    threadId: Number.isFinite(item.threadId) ? Number(item.threadId) : null,
    queuedAt: typeof item.queuedAt === "string" && item.queuedAt ? item.queuedAt : new Date(0).toISOString(),
    mediaIds: Array.isArray(item.mediaIds)
      ? item.mediaIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
      : undefined,
    contentBlocks: cloneArray(item.contentBlocks),
    linkPreviews: cloneArray(item.linkPreviews),
    screenHint: trimOptionalString(item.screenHint),
    source: trimOptionalString(item.source),
    queuedBy: normalizeQueuedFollowupSourceMetadata(item.queuedBy),
    ...(materializeRetries !== undefined ? { materializeRetries } : {}),
  };
}

export function cloneQueuedFollowupItem(item: QueuedFollowupItem): QueuedFollowupItem {
  return projectQueuedFollowupItem(item);
}

export function projectPersistedQueuedFollowupItem(item: QueuedFollowupItemInput): QueuedFollowupItem {
  return projectQueuedFollowupItem(item, { materializeRetriesDefault: 0 });
}
