/**
 * runtime/model-catalog-refresh.ts – On-demand model catalogue update.
 *
 * Mirrors `pi update --models`: a forced, networked refresh of every provider
 * catalogue. A stale login only skips that provider; other providers still
 * update. Concurrent requests for the same runtime share one refresh.
 */
import { ModelsError, type ModelsRefreshOptions, type ModelsRefreshResult } from "@earendil-works/pi-ai";

export interface ModelCatalogRefreshProblem { provider: string; message: string }
export interface ModelCatalogRefreshOutcome {
  status: "completed" | "partial" | "timed_out" | "failed";
  /** Providers skipped because their login needs renewing. */
  skipped: ModelCatalogRefreshProblem[];
  failed: ModelCatalogRefreshProblem[];
  /** Configured providers whose models are selectable after the refresh. */
  providers?: string[];
  /** Selectable model count before and after, when the runtime exposes it. */
  models?: { before: number; after: number };
}
interface RefreshableRuntime {
  refresh(options: ModelsRefreshOptions): Promise<ModelsRefreshResult>;
  getAvailableSnapshot?(): readonly { provider: string }[];
}

interface InFlightRefresh {
  promise: Promise<ModelCatalogRefreshOutcome>;
  controller: AbortController;
  liveWaiters: number;
}

const inFlight = new WeakMap<RefreshableRuntime, InFlightRefresh>();

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("The operation was aborted.");
}

function releaseWaiter(entry: InFlightRefresh): void {
  entry.liveWaiters = Math.max(0, entry.liveWaiters - 1);
}

function withCallerSignal(entry: InFlightRefresh, signal?: AbortSignal): Promise<ModelCatalogRefreshOutcome> {
  if (!signal) {
    entry.liveWaiters++;
    entry.promise.then(() => releaseWaiter(entry), () => releaseWaiter(entry));
    return entry.promise;
  }
  if (signal.aborted) return Promise.reject(abortReason(signal));

  entry.liveWaiters++;
  let settled = false;
  return new Promise<ModelCatalogRefreshOutcome>((resolve, reject) => {
    const finish = (value: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      releaseWaiter(entry);
      value();
    };
    const onAbort = () => {
      finish(() => reject(abortReason(signal)));
      if (entry.liveWaiters === 0) entry.controller.abort(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    entry.promise.then(
      outcome => finish(() => resolve(outcome)),
      error => finish(() => reject(error)),
    );
  });
}

/** Picker and model tools share the same one-refresh, authenticated lookup. */
export async function resolveLiveModelSelection<T extends { provider: string; id: string }>(
  label: string, available: () => readonly T[], refresh?: () => Promise<unknown>,
): Promise<T[]> {
  const query = label.trim().toLowerCase();
  const matches = () => available().filter(model => model.id.toLowerCase() === query || `${model.provider}/${model.id}`.toLowerCase() === query);
  let found = matches();
  if (query && !found.length && refresh) { await refresh(); found = matches(); }
  return found;
}

export async function refreshModelCatalogForSelection(runtime: RefreshableRuntime, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ModelCatalogRefreshOutcome> {
  const outcome = await refreshModelCatalogs(runtime, options);
  if (outcome.status === "failed" || outcome.status === "timed_out") throw new Error("Model catalogue refresh failed; retry or inspect the cached catalogue.");
  return outcome;
}

export function refreshModelCatalogs(runtime: RefreshableRuntime, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ModelCatalogRefreshOutcome> {
  if (options.signal?.aborted) return Promise.reject(abortReason(options.signal));

  const existing = inFlight.get(runtime);
  if (existing) return withCallerSignal(existing, options.signal);

  const timeoutMs = Math.max(1, options.timeoutMs ?? 15_000);
  const controller = new AbortController();
  let entry!: InFlightRefresh;
  const run = refreshOnce(runtime, timeoutMs, controller)
    .finally(() => {
      entry.liveWaiters = 0;
      if (inFlight.get(runtime) === entry) inFlight.delete(runtime);
    });
  entry = { controller, liveWaiters: 0, promise: run };
  inFlight.set(runtime, entry);

  if (!options.signal) {
    entry.liveWaiters++;
    run.then(() => { entry.liveWaiters = 0; }, () => { entry.liveWaiters = 0; });
    return run;
  }
  return withCallerSignal(entry, options.signal);
}

async function refreshOnce(runtime: RefreshableRuntime, timeoutMs: number, controller: AbortController): Promise<ModelCatalogRefreshOutcome> {
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const before = runtime.getAvailableSnapshot?.().length;
    const result = await runtime.refresh({ allowNetwork: true, force: true, signal: controller.signal });
    if (result.aborted || controller.signal.aborted) return { status: "timed_out", skipped: [], failed: [] };
    const skipped: ModelCatalogRefreshProblem[] = [], failed: ModelCatalogRefreshProblem[] = [];
    for (const [provider, error] of result.errors) {
      (error instanceof ModelsError && error.code === "oauth" ? skipped : failed).push({ provider, message: error.message });
    }
    const outcome: ModelCatalogRefreshOutcome = { status: failed.length ? "partial" : "completed", skipped, failed };
    const available = runtime.getAvailableSnapshot?.();
    if (available && before !== undefined) {
      outcome.providers = [...new Set(available.map(model => model.provider))].sort();
      outcome.models = { before, after: available.length };
    }
    return outcome;
  } catch (error) {
    if (controller.signal.aborted) return { status: "timed_out", skipped: [], failed: [] };
    return { status: "failed", skipped: [], failed: [{ provider: "", message: error instanceof Error ? error.message : String(error) }] };
  } finally {
    clearTimeout(timer);
  }
}
