import {
  applyAutoresearchStatusPayload,
  clearPendingPanelActionPrefix,
} from './app-extension-status.js';
import {
  haveSameFollowupQueueRows,
  normalizeFollowupQueueItems,
  type FollowupQueueItemLike,
} from './app-followup-queue.js';
import { isMainTimelineView } from './app-realtime-timeline.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

// SDK observations live only in this bounded page-local revision cache.
const CONTEXT_CACHE_LIMIT = 128;
let contextRevision = 0;
const CONTEXT_REPLACE = 'replace';
const contextUsageStates = new Map<string, [generation: string | null, revision: number, usage: Record<string, unknown> | null]>();
export function getContextUsageRevision(chatJid: string): number { return contextUsageStates.get(chatJid)?.[1] ?? contextRevision; }

function finiteOrNull(value: unknown): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeCostCoverage(payload: unknown): Record<string, number | null> | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  return {
    providerReportedRuns: finiteOrNull(data.providerReportedRuns),
    catalogueEstimateRuns: finiteOrNull(data.catalogueEstimateRuns),
    unavailableRuns: finiteOrNull(data.unavailableRuns),
    legacyRuns: finiteOrNull(data.legacyRuns),
  };
}

function normalizeTokenUsageRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  const costCoverage = normalizeCostCoverage(data.costCoverage);
  return {
    inputTokens: finiteOrNull(data.inputTokens),
    outputTokens: finiteOrNull(data.outputTokens),
    reasoningTokens: finiteOrNull(data.reasoningTokens),
    cacheReadTokens: finiteOrNull(data.cacheReadTokens),
    cacheWriteTokens: finiteOrNull(data.cacheWriteTokens),
    cacheReadReported: booleanOrNull(data.cacheReadReported),
    cacheWriteReported: booleanOrNull(data.cacheWriteReported),
    totalTokens: finiteOrNull(data.totalTokens),
    costTotal: finiteOrNull(data.costTotal),
    costCurrency: stringOrNull(data.costCurrency),
    providerCostCurrency: stringOrNull(data.providerCostCurrency),
    providerCostTotal: finiteOrNull(data.providerCostTotal),
    catalogueCostTotal: finiteOrNull(data.catalogueCostTotal),
    costProvenance: stringOrNull(data.costProvenance),
    runs: finiteOrNull(data.runs),
    cacheHitRate: finiteOrNull(data.cacheHitRate),
    model: stringOrNull(data.model),
    responseModel: stringOrNull(data.responseModel),
    provider: stringOrNull(data.provider),
    api: stringOrNull(data.api),
    turns: finiteOrNull(data.turns),
    runAt: stringOrNull(data.runAt),
    ...(costCoverage ? { costCoverage } : {}),
  };
}

function normalizeCacheUsage(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  const latest = normalizeTokenUsageRecord(data.latest);
  const totals = normalizeTokenUsageRecord(data.totals);
  return latest || totals ? { latest, totals } : null;
}

export function normalizeContextUsage(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  const tokens = finiteOrNull(data.tokens);
  const contextWindow = finiteOrNull(data.contextWindow);
  const percent = finiteOrNull(data.percent);
  const cacheUsage = normalizeCacheUsage(data.cacheUsage);
  const sessionGeneration = stringOrNull(data.sessionGeneration ?? data.session_generation);
  return {
    tokens,
    contextWindow,
    percent,
    cacheUsage,
    ...(sessionGeneration ? { sessionGeneration } : {}),
    ...(data.contextUpdate === CONTEXT_REPLACE ? { contextUpdate: CONTEXT_REPLACE } : {}),
  };
}

export function mergeContextUsage(previous: unknown, incoming: unknown, reset = false): Record<string, unknown> | null {
  const next = normalizeContextUsage(incoming);
  if (!next) return normalizeContextUsage(previous);
  const prev = normalizeContextUsage(previous);
  const previousGeneration = stringOrNull(prev?.sessionGeneration);
  const nextGeneration = stringOrNull(next.sessionGeneration);
  const generationChanged = Boolean(nextGeneration && previousGeneration !== nextGeneration);
  const replace = reset || generationChanged || next.contextUpdate === CONTEXT_REPLACE;
  return {
    tokens: replace ? next.tokens : next.tokens ?? prev?.tokens ?? null,
    contextWindow: replace ? next.contextWindow : next.contextWindow ?? prev?.contextWindow ?? null,
    percent: replace ? next.percent : next.percent ?? prev?.percent ?? null,
    // Cache telemetry is aggregated independently from Pi session context, so
    // retain it across a generation reset while clearing session-scoped meters.
    cacheUsage: next.cacheUsage ?? prev?.cacheUsage ?? null,
    ...(nextGeneration || previousGeneration ? { sessionGeneration: nextGeneration ?? previousGeneration } : {}),
  };
}

export function getContextSessionGeneration(chatJid: string): string | null {
  return contextUsageStates.get(chatJid)?.[0] ?? null;
}

export function reconcileContextUsageForChat(
  chatJid: string,
  previous: unknown,
  incoming: unknown,
  options: {
    authoritative?: boolean;
    reset?: boolean;
    requireKnown?: boolean;
    expectedSessionGeneration?: string | null;
    expectedRevision?: number;
  } = {},
): Record<string, unknown> | null {
  const next = normalizeContextUsage(incoming);
  if (!chatJid || !next) return normalizeContextUsage(previous);
  if (options.expectedRevision !== undefined && options.expectedRevision !== getContextUsageRevision(chatJid)) return normalizeContextUsage(previous);
  const incomingGeneration = stringOrNull(next.sessionGeneration);
  const knownGeneration = getContextSessionGeneration(chatJid);
  const merge = () => {
    const replace = options.reset === true || next.contextUpdate === CONTEXT_REPLACE;
    const result = mergeContextUsage(previous, next, replace);
    // Even an unchanged unknown snapshot is a new boundary: an older in-flight
    // poll must not restore counts, and persisted same-session data must clear.
    rememberContext(chatJid, incomingGeneration ?? knownGeneration,
      replace || !haveSameContextUsage(previous, result) ? ++contextRevision : getContextUsageRevision(chatJid), result);
    return result;
  };
  if (!incomingGeneration) {
    // The current endpoint can report an unbound session. Clear its meters;
    // unscoped legacy/SSE updates still cannot replace a known SDK observation.
    return options.requireKnown || (knownGeneration && !(options.authoritative && next.contextUpdate === CONTEXT_REPLACE))
      ? normalizeContextUsage(previous)
      : merge();
  }
  if (Object.prototype.hasOwnProperty.call(options, 'expectedSessionGeneration')
    && knownGeneration !== (options.expectedSessionGeneration ?? null)) {
    return normalizeContextUsage(previous);
  }
  if (options.requireKnown && !knownGeneration) return normalizeContextUsage(previous);
  if (knownGeneration && knownGeneration !== incomingGeneration && !options.authoritative && !options.reset) {
    return normalizeContextUsage(previous);
  }
  return merge();
}

export function resetContextSessionGenerationsForTests(): void {
  contextUsageStates.clear();
  contextRevision = 0;
}

export function haveSameContextUsage(a: unknown, b: unknown): boolean {
  const left = normalizeContextUsage(a);
  const right = normalizeContextUsage(b);
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.tokens === right.tokens
    && left.contextWindow === right.contextWindow
    && left.percent === right.percent
    && left.sessionGeneration === right.sessionGeneration
    && JSON.stringify(left.cacheUsage ?? null) === JSON.stringify(right.cacheUsage ?? null);
}

export function hasRenderableContextUsage(payload: unknown): boolean {
  const normalized = normalizeContextUsage(payload);
  return Boolean(normalized && (normalized.percent != null || normalized.cacheUsage != null));
}

function rememberContext(chat: string, generation: string | null, revision: number, usage: Record<string, unknown> | null): void {
  contextUsageStates.delete(chat);
  contextUsageStates.set(chat,[generation,revision,usage]);
  while(contextUsageStates.size>CONTEXT_CACHE_LIMIT)contextUsageStates.delete(contextUsageStates.keys().next().value!);
}

/** A connection boundary invalidates outstanding reads even with a stable SDK session ID. */
export function invalidateContextUsageForChat(chat: string): Record<string, unknown> | null {
  const generation=getContextSessionGeneration(chat),previous=contextUsageStates.get(chat)?.[2];
  const cleared=generation?mergeContextUsage(previous,{tokens:null,contextWindow:null,percent:null,sessionGeneration:generation,contextUpdate:'replace'}):null;
  rememberContext(chat,generation,++contextRevision,cleared);
  return cleared;
}

/** Restore only a value accepted by this page's current revision; never browser storage. */
export function restoreContextUsage(chatJid: string): Record<string, unknown> | null {
  return getContextSessionGeneration(chatJid) ? contextUsageStates.get(chatJid)?.[2] ?? null : null;
}


interface RefBox<T> {
  current: T;
}

export interface RefreshQueueStateForChatOptions<TItem extends FollowupQueueItemLike = FollowupQueueItemLike> {
  currentChatJid: string;
  queueRefreshGenRef: RefBox<number>;
  activeChatJidRef: RefBox<string>;
  dismissedQueueRowIdsRef: RefBox<Set<string | number>>;
  getAgentQueueState: (chatJid: string) => Promise<{ items?: TItem[] | null | undefined }>;
  setFollowupQueueItems: StateSetter<TItem[]>;
  clearQueuedSteerStateIfStale: (remainingQueueCount: number) => void;
}

/**
 * Refresh follow-up queue state for the active chat, dropping stale responses.
 */
export async function refreshQueueStateForChat<TItem extends FollowupQueueItemLike = FollowupQueueItemLike>(
  options: RefreshQueueStateForChatOptions<TItem>,
): Promise<void> {
  const {
    currentChatJid,
    queueRefreshGenRef,
    activeChatJidRef,
    dismissedQueueRowIdsRef,
    getAgentQueueState,
    setFollowupQueueItems,
    clearQueuedSteerStateIfStale,
  } = options;

  const gen = ++queueRefreshGenRef.current;
  const targetChatJid = currentChatJid;

  try {
    const payload = await getAgentQueueState(targetChatJid);
    if (gen !== queueRefreshGenRef.current) return;
    if (activeChatJidRef.current !== targetChatJid) return;

    const dismissed = dismissedQueueRowIdsRef.current;
    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    const items = normalizeFollowupQueueItems(rawItems, dismissed);
    if (items.length) {
      setFollowupQueueItems((prev) => (haveSameFollowupQueueRows(prev, items) ? prev : items));
      return;
    }

    if (rawItems.length > 0) {
      return;
    }

    dismissed.clear();
    clearQueuedSteerStateIfStale(0);
    setFollowupQueueItems((prev) => (prev.length === 0 ? prev : []));
  } catch {
    if (gen !== queueRefreshGenRef.current) return;
    if (activeChatJidRef.current !== targetChatJid) return;
    setFollowupQueueItems((prev) => (prev.length === 0 ? prev : []));
  }
}

export interface RefreshContextUsageForChatOptions {
  currentChatJid: string;
  activeChatJidRef: RefBox<string>;
  getAgentContext: (chatJid: string) => Promise<any>;
  setContextUsage: StateSetter<any>;
}

/** Best-effort context usage refresh tied to the currently active chat. */
export async function refreshContextUsageForChat(options: RefreshContextUsageForChatOptions): Promise<void> {
  const {
    currentChatJid,
    activeChatJidRef,
    getAgentContext,
    setContextUsage,
  } = options;

  const targetChatJid = currentChatJid;
  const expectedSessionGeneration = getContextSessionGeneration(targetChatJid);
  const expectedRevision = getContextUsageRevision(targetChatJid);
  try {
    const contextPayload = normalizeContextUsage(await getAgentContext(targetChatJid));
    if (activeChatJidRef.current !== targetChatJid) return;
    setContextUsage((prev: unknown) => {
      const merged = reconcileContextUsageForChat(targetChatJid, prev, contextPayload, {
        authoritative: true,
        expectedSessionGeneration,
        expectedRevision,
      });
      if (haveSameContextUsage(prev, merged)) return prev;
      return merged;
    });
  } catch (error) {
    if (activeChatJidRef.current !== targetChatJid) return;
    console.warn('Failed to fetch agent context:', error);
  }
}

export interface RefreshAutoresearchStatusForChatOptions {
  currentChatJid: string;
  activeChatJidRef: RefBox<string>;
  getAutoresearchStatus: (chatJid: string) => Promise<any>;
  setExtensionStatusPanels: StateSetter<Map<any, any>>;
  setPendingExtensionPanelActions: StateSetter<Set<string>>;
}

/** Best-effort autoresearch panel refresh tied to the currently active chat. */
export async function refreshAutoresearchStatusForChat(options: RefreshAutoresearchStatusForChatOptions): Promise<void> {
  const {
    currentChatJid,
    activeChatJidRef,
    getAutoresearchStatus,
    setExtensionStatusPanels,
    setPendingExtensionPanelActions,
  } = options;

  const targetChatJid = currentChatJid;
  try {
    const payload = await getAutoresearchStatus(targetChatJid);
    if (activeChatJidRef.current !== targetChatJid) return;
    setExtensionStatusPanels((prev) => applyAutoresearchStatusPayload(prev, payload));
    setPendingExtensionPanelActions((prev) => clearPendingPanelActionPrefix(prev, 'autoresearch'));
  } catch (error) {
    if (activeChatJidRef.current !== targetChatJid) return;
    console.warn('Failed to fetch autoresearch status:', error);
  }
}

export interface RefreshModelAndQueueStateOptions {
  refreshModelState: () => void;
  refreshActiveChatAgents: () => void;
  refreshCurrentChatBranches: () => void;
  refreshQueueState: () => void;
  refreshContextUsage: () => Promise<void> | void;
  refreshAutoresearchStatus: () => Promise<void> | void;
}

/** Run the standard model/queue/status refresh bundle used on connect/wake. */
export function refreshModelAndQueueState(options: RefreshModelAndQueueStateOptions): void {
  const {
    refreshModelState,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    refreshQueueState,
    refreshContextUsage,
    refreshAutoresearchStatus,
  } = options;

  refreshModelState();
  refreshActiveChatAgents();
  refreshCurrentChatBranches();
  refreshQueueState();
  void refreshContextUsage();
  void refreshAutoresearchStatus();
}

export interface RefreshCurrentViewOptions {
  viewStateRef: RefBox<Record<string, unknown> | null | undefined>;
  refreshTimeline: () => Promise<void> | void;
  refreshModelAndQueueState: () => void;
}

/**
 * Refresh the current view and status panels without disturbing search/hashtag modes.
 */
export function refreshCurrentView(options: RefreshCurrentViewOptions): void {
  const {
    viewStateRef,
    refreshTimeline,
    refreshModelAndQueueState: refreshModelAndQueueStateFn,
  } = options;

  const onMainTimeline = isMainTimelineView(viewStateRef.current);
  if (onMainTimeline) {
    void refreshTimeline();
  }
  refreshModelAndQueueStateFn();
}
