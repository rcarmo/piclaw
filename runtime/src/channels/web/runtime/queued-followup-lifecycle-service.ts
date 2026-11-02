/**
 * web/queued-followup-lifecycle-service.ts – queued follow-up lifecycle state.
 *
 * Owns the web channel's persisted deferred follow-ups,
 * queue-state payload shaping, and queue action removal
 * behavior. Extracted from `channels/web.ts` to keep WebChannel focused on
 * transport/orchestration while preserving the existing public API.
 */

import {
  deleteMessageByRowId,
  getDeferredQueuedFollowups,
  getChatBranchByChatJid,
  getMessageByRowId,
  setDeferredQueuedFollowups,
} from "../../../db.js";
import type { DeferredQueuedFollowupRecord } from "../../../db.js";
import {
  cloneQueuedFollowupItem,
  projectPersistedQueuedFollowupItem,
  projectQueuedFollowupItem,
  type QueuedFollowupItem,
} from "../../../queued-followups.js";
import { getDb, getDatabaseBinding } from '../../../db/connection.js';
import { getRouterState, setRouterState } from '../../../db/router-state.js';
import { admitSqliteWrite } from '../../../db/sqlite-async-admission.js';
import { getWorkspaceDir, getStoreDir, getConfigPath, getRoutingConfig } from '../../../core/config.js';
import { parseControlCommand } from '../../../agent-control/agent-control-parser.js';
import { DEFERRED_CONTROL_COMMAND_TYPES } from '../../../agent-control/agent-control-types.js';
import { statSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { createUuid } from '../../../utils/ids.js';
import { hashCanonicalRequest } from '../../../service-effects/contracts/common.js';

export type QueuedInputSourceAdmission = (stored: Readonly<{
  chatJid: string; item: Readonly<QueuedFollowupItem & { source_id: string }>; database: ReturnType<typeof getDb>;
}>) => void;

/** SQL-only host callback. Use item.source_id, never the reusable rowId, for source identity. */
export function acceptQueuedInputSource(chatJid: string, rowId: number, database: ReturnType<typeof getDb>, accept?: QueuedInputSourceAdmission): void {
  if (!accept) return;
  if (!database.inTransaction || database !== getDb()) throw Error('Queue admission requires its database transaction.');
  const queued = getDeferredQueuedFollowups(chatJid);
  const index = queued.findIndex(item => item.rowId === rowId);
  const item = queued[index];
  if (!item) throw Error('Accepted queue item is unavailable.');
  // Legacy reads remain side-effect free. Adopt once in the same transaction as
  // source acceptance, so rejection also rolls back this identity assignment.
  const source_id = item.source_id ?? createUuid('source');
  if (!item.source_id) {
    queued[index] = { ...item, source_id };
    setDeferredQueuedFollowups(chatJid, queued);
  }
  const result: unknown = accept({ chatJid, item: { ...cloneQueuedFollowupItem(item), source_id }, database });
  if (result !== undefined) {
    void Promise.resolve(result).then(() => undefined, () => undefined);
    throw Error('Queued source admission callback must be synchronous.');
  }
  queued[index] = { ...item, source_id, source_accepted: true };
  setDeferredQueuedFollowups(chatJid, queued);
}

export interface QueuedFollowupStateItem {
  row_id: number;
  content: string;
  timestamp: string;
  thread_id: number | null;
  source?: string;
  queued_by?: Record<string, string>;
}

export interface QueuedFollowupWriteOptions {
  authorise?: (phase: 'before' | 'after') => void;
  signal?: AbortSignal;
}

export interface RemoveQueuedFollowupForActionOptions extends QueuedFollowupWriteOptions {
  /** Host-selected cancellation: explicit DELETE, or separately proved lifecycle
   * expiry. Ordinary steer/drain must never select this capability from text. */
  withdrawAcceptedSource?: QueuedInputSourceAdmission;
}

export interface RemoveQueuedFollowupForActionResult {
  removed: QueuedFollowupItem | null;
  source: "deferred" | null;
}

function toDeferredQueuedFollowupRecord(item: QueuedFollowupItem): DeferredQueuedFollowupRecord {
  return projectPersistedQueuedFollowupItem(item) as DeferredQueuedFollowupRecord;
}

function captureQueueBinding(database: ReturnType<typeof getDb>): () => void {
  const binding = getDatabaseBinding();
  const paths = JSON.stringify([getWorkspaceDir(), getStoreDir(), getConfigPath()]);
  const assertBinding = () => {
    if (getDb() !== database || JSON.stringify(getDatabaseBinding()) !== JSON.stringify(binding)
      || JSON.stringify([getWorkspaceDir(), getStoreDir(), getConfigPath()]) !== paths) throw Error('Queue database binding changed.');
    if (binding) { const stat=statSync(binding.path); if(`${stat.dev}:${stat.ino}` !== binding.identity) throw Error('Queue database file changed.'); }
  };
  return assertBinding;
}

export class QueuedFollowupLifecycleService {
  private readonly nextDeferredRowIdByChat = new Map<string, number>();

  enqueueQueuedFollowupItem(
    chatJid: string,
    rowId: number,
    queuedContent: string,
    threadId?: number | null,
    queuedAt?: string,
    extras?: { mediaIds?: number[]; contentBlocks?: unknown[]; linkPreviews?: unknown[]; screenHint?: string; source?: string; queuedBy?: QueuedFollowupItem["queuedBy"] }
  ): number {
    const resolvedRowId = Number.isFinite(rowId) && rowId !== 0 ? rowId : this.allocateDeferredQueuedRowId(chatJid);
    const queued = this.getDeferredQueuedFollowupItems(chatJid);
    const item = projectQueuedFollowupItem({
      rowId: resolvedRowId,
      queuedContent,
      threadId,
      queuedAt: queuedAt ?? new Date().toISOString(),
      ...extras,
      // Never accept an identity from enqueue extras (including untyped callers).
      source_id: createUuid('source'),
      source_accepted: undefined,
    });
    // Protected recovery is unfinished work from the active source turn. It
    // must run before follow-ups queued later while that source was inflight;
    // otherwise “continue the source request” would execute against newer
    // conversational state. Preserve FIFO ordering among protected intents.
    if (item.source === "auto-protected-recovery-continuation") {
      let protectedTail = -1;
      for (let index = 0; index < queued.length; index += 1) {
        if (queued[index]?.source === item.source) protectedTail = index;
      }
      queued.splice(protectedTail + 1, 0, item);
    } else {
      queued.push(item);
    }
    this.setDeferredQueuedFollowupItems(chatJid, queued);
    return resolvedRowId;
  }

  /** Host-generated replay-safe follow-up, inside the existing writer transaction.
   * A materialized/consumed source is never recreated as another queued input. */
  enqueueAcceptedFollowupOnce(
    sourceId: string, chatJid: string, content: string, queuedAt: string,
    extras: Pick<QueuedFollowupItem, 'source' | 'queuedBy'>, acceptSource: QueuedInputSourceAdmission,
    onlyIfIdle = false,
  ): number | null {
    const db = getDb();
    if (!db.inTransaction) throw new Error('Follow-up admission transaction required');
    if (!sourceId || sourceId.trim() !== sourceId || sourceId.length > 512) throw new Error('Invalid follow-up source identity');
    // Project exactly the supported payload fields before both persistence and
    // comparison; untyped extras must not smuggle media or another source ID.
    const candidate = projectQueuedFollowupItem({ rowId: 0, queuedContent: content, threadId: null, queuedAt,
      source: extras.source, queuedBy: extras.queuedBy });
    const prior = getDeferredQueuedFollowups(chatJid).find(item => item.source_id === sourceId);
    const identity = (item: Pick<QueuedFollowupItem, 'queuedContent' | 'queuedAt' | 'source' | 'queuedBy'>) => hashCanonicalRequest(JSON.parse(JSON.stringify({
      content: item.queuedContent, queuedAt: item.queuedAt, source: item.source ?? null, queuedBy: item.queuedBy ?? null,
    })));
    if (prior) {
      if (!prior.source_accepted || identity(prior) !== identity(candidate))
        throw new Error('Follow-up source identity conflict');
      return prior.rowId;
    }
    if (db.query('SELECT 1 FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?').get(chatJid, sourceId))
      throw new Error('Follow-up source already materialized; reconcile existing source');
    // Autonomous continuation yields to every outstanding input. Check after
    // identity reconciliation so a lost ACK can still recover its original row.
    if (onlyIfIdle && (getDeferredQueuedFollowups(chatJid).length || db.query(
      "SELECT 1 FROM service_effect_s01_sources WHERE chat_jid=? AND state IN ('pending','claimed') LIMIT 1",
    ).get(chatJid))) return null;
    const rowId = this.enqueueQueuedFollowupItem(chatJid, 0, candidate.queuedContent, undefined, candidate.queuedAt,
      { source: candidate.source, queuedBy: candidate.queuedBy });
    const items = getDeferredQueuedFollowups(chatJid);
    setDeferredQueuedFollowups(chatJid, items.map(item => item.rowId === rowId ? { ...item, source_id: sourceId } : item));
    acceptQueuedInputSource(chatJid, rowId, db, acceptSource);
    return rowId;
  }

  async admitQueuedFollowupItem(
    args: Parameters<QueuedFollowupLifecycleService['enqueueQueuedFollowupItem']>,
    authorise: (phase?: 'before' | 'after') => void,
    signal: AbortSignal,
    acceptSource?: QueuedInputSourceAdmission,
  ): Promise<number> {
    args = [...args]; // Pin positional input before acquisition can yield.
    const chatJid = args[0], database = getDb();
    const targetKey = () => { const branch = getChatBranchByChatJid(chatJid); return JSON.stringify(branch && [branch.branch_id, branch.chat_jid, branch.archived_at]); };
    const originalTarget = targetKey();
    let writtenTarget = originalTarget;
    const assertBinding = captureQueueBinding(database);
    const check = (phase: 'before' | 'after') => {
      assertBinding();
      if ((phase === 'before' && targetKey() !== originalTarget) || getChatBranchByChatJid(chatJid)?.archived_at) throw Error('Queued input target lifetime changed.');
      authorise(phase);
      if (phase === 'after' && targetKey() !== writtenTarget) throw Error('Queued input target lifetime changed.');
    };
    let attempted = false;
    let previousSeed: number | undefined;
    return admitSqliteWrite(database, () => {
      // Capture inside each attempt, never across a lock-backoff await.
      previousSeed = this.nextDeferredRowIdByChat.get(args[0]);
      attempted = true;
      const rowId = this.enqueueQueuedFollowupItem(...args);
      // A control command ahead of this input must acquire its idle guard first.
      // Keep later input in the persisted queue; its normal materialisation
      // atomically admits the source after the control command has settled.
      const queued = getDeferredQueuedFollowups(args[0]);
      const index = queued.findIndex(item => item.rowId === rowId);
      const controlAhead = queued.slice(0, index).some(item => {
        const command = parseControlCommand(item.queuedContent, getRoutingConfig().triggerPattern);
        return command && DEFERRED_CONTROL_COMMAND_TYPES.has(command.type);
      });
      writtenTarget = targetKey();
      if (!controlAhead) acceptQueuedInputSource(args[0], rowId, database, acceptSource);
      return rowId;
    }, check, signal, 5000, assertBinding, () => {
      // Queue contents are SQL-backed; only the allocation seed lives in memory.
      if (!attempted) return;
      if (previousSeed === undefined) this.nextDeferredRowIdByChat.delete(args[0]);
      else this.nextDeferredRowIdByChat.set(args[0], previousSeed);
      attempted = false;
    });
  }

  peekQueuedFollowupItem(chatJid: string): QueuedFollowupItem | null {
    const next = this.getDeferredQueuedFollowupItems(chatJid)[0] ?? null;
    return next ? cloneQueuedFollowupItem(next) : null;
  }

  getQueuedFollowupCount(chatJid: string): number {
    return this.getDeferredQueuedFollowupItems(chatJid).length;
  }

  getQueuedFollowupItems(chatJid: string): QueuedFollowupItem[] {
    const rows = this.getDeferredQueuedFollowupItems(chatJid);
    const seen = new Set<number>();
    return rows
      .filter((row) => {
        if (seen.has(row.rowId)) return false;
        seen.add(row.rowId);
        return true;
      });
  }

  listQueuedStateItems(chatJid: string): QueuedFollowupStateItem[] {
    return this.getQueuedFollowupItems(chatJid)
      .map((queued) => {
        const interaction = getMessageByRowId(chatJid, queued.rowId);
        const queuedBy = queued.queuedBy
          ? Object.fromEntries(Object.entries(queued.queuedBy).filter(([, value]) => typeof value === "string" && value.trim())) as Record<string, string>
          : undefined;
        return {
          row_id: queued.rowId,
          content: queued.queuedContent,
          timestamp: interaction?.timestamp ?? queued.queuedAt,
          thread_id: interaction?.data?.thread_id ?? queued.threadId ?? null,
          ...(queued.source ? { source: queued.source } : {}),
          ...(queuedBy && Object.keys(queuedBy).length > 0 ? { queued_by: queuedBy } : {}),
        };
      })
      .filter((item) => typeof item.content === "string" && item.content.trim().length > 0);
  }

  async removeQueuedFollowupForAction(
    chatJid: string,
    rowId: number,
    options: RemoveQueuedFollowupForActionOptions = {}
  ): Promise<RemoveQueuedFollowupForActionResult> {
    options.signal?.throwIfAborted();
    const queued = this.getDeferredQueuedFollowupItems(chatJid);
    const observed = queued.find(item => item.rowId === rowId);
    const database = getDb(), assertBinding = captureQueueBinding(database);
    const authorise = options.authorise, withdraw = options.withdrawAcceptedSource;
    const check = (phase: 'before' | 'after') => { assertBinding(); authorise?.(phase); };
    if (observed) {
      return admitSqliteWrite(database, () => {
        const current = this.getDeferredQueuedFollowupItems(chatJid);
        const index = current.findIndex(item => item.rowId === rowId);
        const item = current[index];
        if (!item || item.source_id !== observed.source_id || (!item.source_id && !isDeepStrictEqual(item, observed)))
          throw Error('Queued input is unavailable: identity changed.');
        if (item.source_accepted) {
          if (!withdraw || !item.source_id) throw Error('Accepted input requires host cancellation');
          const result: unknown = withdraw({ chatJid, item: { ...cloneQueuedFollowupItem(item), source_id: item.source_id }, database });
          if (result !== undefined) {
            void Promise.resolve(result).then(() => undefined, () => undefined);
            throw Error('Queued source withdrawal callback must be synchronous.');
          }
        }
        current.splice(index, 1); this.setDeferredQueuedFollowupItems(chatJid, current);
        if (item.rowId > 0) deleteMessageByRowId(chatJid, item.rowId);
        return { removed: cloneQueuedFollowupItem(item), source: 'deferred' as const };
      }, check, options.signal, 5000, assertBinding);
    }
    return { removed: null, source: null };
  }

  private getDeferredQueuedFollowupItems(chatJid: string): QueuedFollowupItem[] {
    return getDeferredQueuedFollowups(chatJid).map((item) => projectPersistedQueuedFollowupItem(item));
  }

  private setDeferredQueuedFollowupItems(chatJid: string, items: QueuedFollowupItem[]): void {
    const protectedItems = items.filter((item) => item.source === "auto-protected-recovery-continuation");
    const ordinaryItems = items.filter((item) => item.source !== "auto-protected-recovery-continuation");
    setDeferredQueuedFollowups(chatJid, [...protectedItems, ...ordinaryItems].map((item) => toDeferredQueuedFollowupRecord(item)));
  }

  /** Separate from the visible queue: materialization removes the selected item
   * before native claim. Keep its priority until the durable source is terminal. */
  getPendingQueuedSourceOrder(chatJid: string): readonly string[] {
    const raw = getRouterState(`queued-source-order:${chatJid}`);
    if (!raw) return [];
    const order: unknown = JSON.parse(raw);
    if (!Array.isArray(order) || order.some(id => typeof id !== 'string' || !id)) throw Error('Invalid persisted queue order');
    return order;
  }

  async reorderQueuedFollowupItems(chatJid: string, fromIndex: number, toIndex: number, options: QueuedFollowupWriteOptions = {}): Promise<boolean> {
    const database = getDb();
    const assertBinding = captureQueueBinding(database);
    const check = (phase: 'before' | 'after') => { assertBinding(); options.authorise?.(phase); };
    return await admitSqliteWrite(database, () => this.reorderQueuedFollowupItemsInTransaction(chatJid, fromIndex, toIndex),
      check, options.signal, 5000, assertBinding);
  }

  private reorderQueuedFollowupItemsInTransaction(chatJid: string, fromIndex: number, toIndex: number): boolean {
    const queued = this.getDeferredQueuedFollowupItems(chatJid);
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex < 0 || toIndex < 0 || fromIndex >= queued.length || toIndex >= queued.length || fromIndex === toIndex) return false;
    const [moved] = queued.splice(fromIndex, 1);
    queued.splice(toIndex, 0, moved);
    const protectedCount = queued.filter((item) => item.source === "auto-protected-recovery-continuation").length;
    const normalized = [
      ...queued.filter((item) => item.source === "auto-protected-recovery-continuation"),
      ...queued.filter((item) => item.source !== "auto-protected-recovery-continuation"),
    ];
    if (normalized.some((item, index) => item.rowId !== queued[index]?.rowId)) return false;
    if (moved?.source === "auto-protected-recovery-continuation" && toIndex >= protectedCount) return false;
    if (moved?.source !== "auto-protected-recovery-continuation" && toIndex < protectedCount) return false;
    this.setDeferredQueuedFollowupItems(chatJid, queued);
    setRouterState(`queued-source-order:${chatJid}`, JSON.stringify(queued.filter(item => item.source_accepted && item.source_id).map(item => item.source_id)));
    return true;
  }

  private allocateDeferredQueuedRowId(chatJid: string): number {
    const queued = this.getDeferredQueuedFollowupItems(chatJid);
    const minQueuedRowId = queued.reduce((min, item) => (item.rowId < min ? item.rowId : min), 0);
    const previousSeed = this.nextDeferredRowIdByChat.get(chatJid) ?? 0;
    const nextRowId = Math.min(minQueuedRowId - 1, previousSeed - 1, -1);
    this.nextDeferredRowIdByChat.set(chatJid, nextRowId);
    return nextRowId;
  }
}
