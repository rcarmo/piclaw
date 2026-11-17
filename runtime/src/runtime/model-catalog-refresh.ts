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

const inFlight = new WeakMap<RefreshableRuntime, Promise<ModelCatalogRefreshOutcome>>();

export function refreshModelCatalogs(runtime: RefreshableRuntime, options: { timeoutMs?: number } = {}): Promise<ModelCatalogRefreshOutcome> {
  const existing = inFlight.get(runtime);
  if (existing) return existing;
  const run = refreshOnce(runtime, Math.max(1, options.timeoutMs ?? 15_000))
    .finally(() => { if (inFlight.get(runtime) === run) inFlight.delete(runtime); });
  inFlight.set(runtime, run);
  return run;
}

async function refreshOnce(runtime: RefreshableRuntime, timeoutMs: number): Promise<ModelCatalogRefreshOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const before = runtime.getAvailableSnapshot?.().length;
  try {
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
