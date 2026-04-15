import { getActiveAppPerfTraceId } from './app-perf-tracing.js';

type RefreshState<T = unknown> = {
  inFlight: Promise<T> | null;
  lastCompletedAt: number;
  lastValue: T | null;
};

export interface NoteAppChatActivationOptions {
  chatJid: string;
  nowMs?: number;
}

export interface RunCoalescedAppRefreshOptions<T> {
  kind: string;
  chatJid: string;
  run: () => Promise<T>;
  cooldownMs?: number;
  activationWindowMs?: number;
  nowMs?: number;
}

const refreshStates = new Map<string, RefreshState>();
const recentChatActivationAt = new Map<string, number>();
const DEFAULT_COOLDOWN_MS = 250;
const DEFAULT_ACTIVATION_WINDOW_MS = 1_500;
const ACTIVATION_RETENTION_MS = 5 * 60_000;

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function buildRefreshKey(kind: string, chatJid: string): string {
  return `${kind}:${chatJid}`;
}

function pruneOldChatActivations(nowMs: number): void {
  for (const [chatJid, activatedAt] of recentChatActivationAt.entries()) {
    if (nowMs - activatedAt > ACTIVATION_RETENTION_MS) {
      recentChatActivationAt.delete(chatJid);
    }
  }
}

export function noteAppChatActivation(options: NoteAppChatActivationOptions): void {
  const { chatJid, nowMs = now() } = options;
  if (!chatJid) return;
  recentChatActivationAt.set(chatJid, nowMs);
  pruneOldChatActivations(nowMs);
}

export function isAppChatActivationRecent(chatJid: string, withinMs = DEFAULT_ACTIVATION_WINDOW_MS, nowMs = now()): boolean {
  if (!chatJid) return false;
  const activatedAt = recentChatActivationAt.get(chatJid);
  if (!Number.isFinite(activatedAt)) return false;
  return nowMs - Number(activatedAt) <= withinMs;
}

export async function runCoalescedAppRefresh<T>(options: RunCoalescedAppRefreshOptions<T>): Promise<T | null> {
  const {
    kind,
    chatJid,
    run,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    activationWindowMs = DEFAULT_ACTIVATION_WINDOW_MS,
    nowMs = now(),
  } = options;

  const key = buildRefreshKey(kind, chatJid);
  const state = refreshStates.get(key) || {
    inFlight: null,
    lastCompletedAt: Number.NaN,
    lastValue: null,
  };
  refreshStates.set(key, state);

  if (state.inFlight) {
    return await state.inFlight;
  }

  const foregroundRefresh = Boolean(
    getActiveAppPerfTraceId('thread-switch', chatJid)
    || isAppChatActivationRecent(chatJid, activationWindowMs, nowMs),
  );

  if (
    foregroundRefresh
    && Number.isFinite(state.lastCompletedAt)
    && nowMs - state.lastCompletedAt <= cooldownMs
  ) {
    return state.lastValue;
  }

  const inFlight = Promise.resolve()
    .then(run)
    .then((value) => {
      state.lastCompletedAt = now();
      state.lastValue = value ?? null;
      state.inFlight = null;
      return value;
    })
    .catch((error) => {
      state.lastCompletedAt = now();
      state.inFlight = null;
      throw error;
    });

  state.inFlight = inFlight;
  return await inFlight;
}

export function resetAppRefreshCoordination(): void {
  refreshStates.clear();
  recentChatActivationAt.clear();
}
