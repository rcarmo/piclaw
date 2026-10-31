import type Database from 'bun:sqlite';
import { admitSqliteWrite } from '../db/sqlite-async-admission.js';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { BudgetProviderEvidence } from './types.js';
import { admitBudgetRequest, admitBudgetRequestDispatch } from './request-reservation-admission.js';
import { abandonBudgetRequest, getBudgetRequest, settleBudgetRequest, type BudgetRequestBinding } from '../db/budget-request-reservations.js';
import { getDb } from '../db/connection.js';
import { decodeUsageReport, readUsageProjectionEvent } from '../db/usage-report-projection.js';
import { valueApiEquivalentCost } from './valuation.js';

/** Shared request accounting for parent, side and Delegate callers. Each caller
 * must bind one host-generated request to its current work before asynchronous
 * auth/provider work starts, and dispatch immediately before its actual send.
 * Settlement uses that captured database/work even when callback ALS differs. */
export function modelRequestAccounting(input: {
  authorise(): void;
  providerEvidence?: BudgetProviderEvidence[];
  documentedFree: boolean;
  usageSource?: "assistant" | "compaction";
  /** Applies to reserve/dispatch only; terminal reconciliation retains its own policy. */
  admissionTimeoutMs?: number;
}, database: Database = getDb()) {
  const authorise = input.authorise;
  const evidence = input.providerEvidence ? structuredClone(input.providerEvidence) : undefined;
  const documentedFree = input.documentedFree, usageSource = input.usageSource, admissionTimeoutMs = input.admissionTimeoutMs;
  const accountedAt = new Map<string, string>();
  const current = () => { if (getDb() !== database) throw Error('Model request database binding changed.'); authorise(); };
  const options = (signal: AbortSignal) => ({ signal, authorise: current, providerEvidence: evidence, timeoutMs: admissionTimeoutMs });
  return Object.freeze({
    async reserve(binding: BudgetRequestBinding, signal: AbortSignal) { await admitBudgetRequest(binding, options(signal)); },
    async dispatch(binding: BudgetRequestBinding, signal: AbortSignal) { await admitBudgetRequestDispatch(binding, options(signal)); },
    // Terminal reconciliation survives cancellation; it never dispatches work.
    async abandon(binding: BudgetRequestBinding) {
      const captured = structuredClone(binding);
      return admitSqliteWrite(database, () => abandonBudgetRequest(captured, database));
    },
    async settle(binding: BudgetRequestBinding, message: AssistantMessage) {
      binding = structuredClone(binding); message = structuredClone(message);
      if (!accountedAt.has(binding.id)) accountedAt.set(binding.id, new Date().toISOString());
      return admitSqliteWrite(database, () => {
        const usage = message.usage;
        const valued = valueApiEquivalentCost({
          tokens: { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite },
          costs: usage.cost, documentedFree,
        });
        const successful = ['stop','length','toolUse'].includes(message.stopReason);
        // Error/abort zero telemetry never proves that a dispatched request was free.
        const known = valued.known && (successful || valued.amountMicros !== 0);
        const extra = usage as typeof usage & { providerCost?: unknown; provider_cost?: unknown; reasoningTokens?: unknown; reasoning_tokens?: unknown; cacheReadReported?: unknown; cacheWriteReported?: unknown };
        const providerCost = [extra.providerCost,extra.provider_cost].find(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) as number | undefined;
        const catalogueCost = usage.cost.total > 0 ? usage.cost.total : null;
        const reasoning = [extra.reasoningTokens,extra.reasoning_tokens].find(value => Number.isSafeInteger(value) && Number(value) >= 0) as number | undefined;
        const responseModel = message.responseModel ?? message.model;
        if (message.provider !== binding.providerId || message.model !== binding.modelId
          || responseModel !== binding.modelId && responseModel !== `${binding.providerId}/${binding.modelId}`) throw Error('Model request response identity changed.');
        // Provider timestamps cannot move charges outside a capped calendar
        // window. Capture the host time once and preserve it for payload replay.
        const existing = getBudgetRequest(binding.id, database);
        const event = existing?.state === 'settled' && existing.usage_event_id ? readUsageProjectionEvent(database, existing.usage_event_id) : null;
        const prior = event ? decodeUsageReport(event) : null;
        // Explicit pre-cutover decoder: the original settlement hash still has to
        // match. Added reporting metadata cannot rewrite an older charge payload.
        const legacyReplay = event !== null && (!prior || prior.origin.kind === 'legacy_projection_capture');
        if (event) accountedAt.set(binding.id, event.accounted_at);
        const originalMapping = {
          chat_jid: binding.chatJid, run_at: accountedAt.get(binding.id)!,
          input_tokens: usage.input, output_tokens: usage.output, cache_read_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite,
          total_tokens: usage.totalTokens, cost_input: usage.cost.input, cost_output: usage.cost.output,
          cost_cache_read: usage.cost.cacheRead, cost_cache_write: usage.cost.cacheWrite, cost_total: usage.cost.total,
          model: binding.modelId, response_model: binding.modelId, provider: binding.providerId, api: message.api, usage_source: 'assistant' as const,
          api_equivalent_cost_known: known, api_equivalent_cost_microusd: known ? valued.amountMicros : null,
          valuation_provenance: known ? valued.provenance : 'unavailable' as const,
        };
        return settleBudgetRequest(binding, legacyReplay ? originalMapping : {
          ...originalMapping, usage_source: usageSource ?? 'assistant',
          cost_total: providerCost ?? catalogueCost ?? 0,
          provider_cost_total: providerCost ?? null, catalogue_cost_total: catalogueCost,
          cost_provenance: providerCost !== undefined ? 'provider_reported' : catalogueCost !== null ? 'catalogue_estimate' : 'unavailable',
          reasoning_tokens: reasoning ?? 0,
          cache_read_reported: typeof extra.cacheReadReported === 'boolean' ? extra.cacheReadReported : null,
          cache_write_reported: typeof extra.cacheWriteReported === 'boolean' ? extra.cacheWriteReported : null,
          api_equivalent_known_subtotal_microusd: valued.knownSubtotalMicros,
          api_equivalent_unknown_categories: JSON.stringify(valued.unknownCategories),
          pricing_currency: 'USD', pricing_source: 'pi-ai Usage.cost category totals', pricing_version: 'pi-ai-usage-cost-v1',
          pricing_cache_fallbacks: JSON.stringify(valued.fallbackCategories),
        }, database);
      });
    },
  });
}
