import type Database from 'bun:sqlite';
import { admitSqliteWrite } from '../db/sqlite-async-admission.js';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { BudgetProviderEvidence } from './types.js';
import { admitBudgetRequest, admitBudgetRequestDispatch } from './request-reservation-admission.js';
import { BudgetRequestError, getBudgetRequest, readBudgetTerminalReceipt, settleBudgetRequest, validateBudgetSettlementUsage, type BudgetRequestBinding, type BudgetRequestReservation, type BudgetModelInvocation } from '../db/budget-request-reservations.js';
import { getDb } from '../db/connection.js';
import { getBudgetWork, setBudgetWorkStatus } from '../db/budget-limits.js';
import type { TokenUsageRecord } from '../db/token-usage.js';
import { decodeUsageReport, readUsageProjectionEvent } from '../db/usage-report-projection.js';
import { valueApiEquivalentCost } from './valuation.js';

/** Verified attributed expense whose local transition can still be repaired. */
export class RetainedAccountingPending extends BudgetRequestError {
  constructor(readonly invocation: BudgetModelInvocation) { super('budget_denied'); }
}

type UsageFacts = Pick<AssistantMessage, 'provider' | 'model' | 'responseModel' | 'stopReason' | 'usage'> & { api: string };
type SettlementUsage = Omit<TokenUsageRecord, 'work_id' | 'invocation_id' | 'usage_event_id' | 'execution_kind'>;

/** Map retained facts while preserving the original settlement hash shape. */
function prepareUsage(binding: BudgetRequestBinding, message: UsageFacts, documentedFree: boolean,
  usageSource: 'assistant' | 'compaction' | undefined) {
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
  return (runAt: string, legacyReplay: boolean): SettlementUsage => {
  const originalMapping = {
    chat_jid: binding.chatJid, run_at: runAt,
    input_tokens: usage.input, output_tokens: usage.output, cache_read_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite,
    total_tokens: usage.totalTokens, cost_input: usage.cost.input, cost_output: usage.cost.output,
    cost_cache_read: usage.cost.cacheRead, cost_cache_write: usage.cost.cacheWrite, cost_total: usage.cost.total,
    model: binding.modelId, response_model: binding.modelId, provider: binding.providerId, api: message.api, usage_source: 'assistant' as const,
    api_equivalent_cost_known: known, api_equivalent_cost_microusd: known ? valued.amountMicros : null,
    valuation_provenance: known ? valued.provenance : 'unavailable' as const,
  };
  return legacyReplay ? originalMapping : {
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
  };
  };
}

/** Read financial facts only from verified finite receipt JSON, never caller text.
 * Content remains the projection owner's concern and is not a billing input. */
function retainedUsageFacts(value: unknown): UsageFacts {
  const invalid = (): never => { throw new BudgetRequestError('invalid_receipt'); };
  const record = (item: unknown): Record<string, unknown> => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid();
    return Object.fromEntries(Object.entries(item));
  };
  const number = (item: unknown): number => typeof item === 'number' && Number.isFinite(item) ? item : invalid();
  const text = (item: unknown): string => typeof item === 'string' && item.length > 0 ? item : invalid();
  const source = record(value), usage = record(source.usage), cost = record(usage.cost);
  const stopReason = source.stopReason;
  if (source.role !== 'assistant' || source.deferred !== undefined) return invalid();
  // Narrow explicitly instead of trusting JSON.parse's any at the API boundary.
  if (stopReason !== 'stop' && stopReason !== 'length' && stopReason !== 'toolUse'
    && stopReason !== 'error' && stopReason !== 'aborted') return invalid();
  const facts: UsageFacts = {
    provider: text(source.provider), model: text(source.model), api: text(source.api), stopReason,
    usage: { input: number(usage.input), output: number(usage.output), cacheRead: number(usage.cacheRead),
      cacheWrite: number(usage.cacheWrite), totalTokens: number(usage.totalTokens),
      cost: { input: number(cost.input), output: number(cost.output), cacheRead: number(cost.cacheRead),
        cacheWrite: number(cost.cacheWrite), total: number(cost.total) } },
  };
  if (source.responseModel !== undefined) facts.responseModel = text(source.responseModel);
  for (const key of ['providerCost', 'provider_cost', 'reasoningTokens', 'reasoning_tokens'] as const) {
    if (usage[key] !== undefined) Object.assign(facts.usage, { [key]: number(usage[key]) });
  }
  for (const key of ['cacheReadReported', 'cacheWriteReported'] as const) {
    if (usage[key] !== undefined) {
      if (typeof usage[key] !== 'boolean') return invalid();
      Object.assign(facts.usage, { [key]: usage[key] });
    }
  }
  return facts;
}

/** Read-only, ancestry-scoped effect barrier. A known paid terminal whose local
 * charge/status transition is incomplete cannot authorise the next effect.
 * Intentional unknown valuation remains held, not charged or relabelled as free.
 * Only exact invocation recovery may exclude its own already-bound request. */
export function assertModelAccountingReady(workId: string, database: Database = getDb(), excludeRequestId?: string, terminal = false): void {
  const pending = database.query(`WITH RECURSIVE scope(id) AS (
    SELECT id FROM budget_work WHERE id=? UNION SELECT w.id FROM budget_work w JOIN scope s ON w.parent_work_id=s.id
  ) SELECT r.* FROM budget_request_reservations r JOIN scope s ON s.id=r.work_id JOIN budget_work w ON w.id=r.work_id
    WHERE r.state<>'released' AND (? OR r.terminal_receipt_json IS NOT NULL OR r.state='unresolved')
    AND (r.state<>'settled' OR w.status IN ('active','paused'))
    AND (? IS NULL OR r.id<>?)`).all(workId, terminal ? 1 : 0, excludeRequestId ?? null, excludeRequestId ?? null) as BudgetRequestReservation[];
  for (const row of pending) {
    // Unresolved receipt-less sends include hard retention failures. They are
    // not readiness. Terminal publication additionally waits for in-flight holds.
    if (row.terminal_receipt_json === null) throw new BudgetRequestError('budget_denied');
    const binding: BudgetRequestBinding = { id: row.id, workId: row.work_id, chatJid: row.chat_jid, providerId: row.provider_id,
      modelId: row.model_id, accountRef: row.account_ref, amountMicros: row.amount_microusd,
      ...(row.model_invocation_json === null ? {} : { modelInvocation: JSON.parse(row.model_invocation_json) }) };
    const receipt = readBudgetTerminalReceipt(binding, database);
    if (!receipt) throw new BudgetRequestError('conflict');
    const payload = JSON.parse(receipt.bodyJson);
    const usage = prepareUsage(binding, retainedUsageFacts(payload.projectedOutcome), false, undefined)(receipt.receivedAt, false);
    validateBudgetSettlementUsage(binding, usage);
    if (row.state !== 'unresolved' || usage.api_equivalent_cost_known) throw binding.modelInvocation
      ? new RetainedAccountingPending(binding.modelInvocation) : new BudgetRequestError('budget_denied');
    if (row.settlement_sha256 !== null || row.usage_event_id !== null) throw new BudgetRequestError('conflict');
  }
}

/** Shared request accounting for parent, side and Delegate callers. Each caller
 * must bind one host-generated request to its current work before asynchronous
 * auth/provider work starts, and dispatch immediately before its actual send.
 * Settlement uses that captured database/work even when callback ALS differs. */
export function modelRequestAccounting(input: {
  authorise(): void;
  beforeAcquire?(): void;
  providerEvidence?: BudgetProviderEvidence[];
  documentedFree: boolean;
  usageSource?: "assistant" | "compaction";
}, database: Database = getDb()) {
  const authorise = input.authorise, beforeAcquire = input.beforeAcquire;
  const evidence = input.providerEvidence ? structuredClone(input.providerEvidence) : undefined;
  const documentedFree = input.documentedFree, usageSource = input.usageSource;
  const current = () => { if (getDb() !== database) throw Error('Model request database binding changed.'); authorise(); };
  const options = (signal: AbortSignal) => ({ signal, authorise: current, beforeAcquire, providerEvidence: evidence });
  return Object.freeze({
    async reserve(binding: BudgetRequestBinding, signal: AbortSignal) { await admitBudgetRequest(binding, options(signal)); },
    async dispatch(binding: BudgetRequestBinding, signal: AbortSignal) { await admitBudgetRequestDispatch(binding, options(signal)); },
    /** WIP receipt-only reconciliation. No provider/reserve/dispatch port.
     * Supply database/owner-lifetime authority, NOT request cancellation/source
     * authority. The caller MUST join this promise before releasing/closing DB.
     * A failed ACK may follow commit: reconcile this exact proof, never resend. */
    async settleRetainedRequest(binding: BudgetRequestBinding, owner: { signal: AbortSignal; assertCurrent(): void }) {
      const signal = owner.signal, assertCurrent = owner.assertCurrent.bind(owner);
      const check = () => {
        signal.throwIfAborted(); assertCurrent();
        if (getDb() !== database) throw Error('Model request database binding changed.');
      };
      check();
      binding = structuredClone(binding);
      if (binding.workId !== `durable-request:${binding.id}`) throw new BudgetRequestError('invalid_binding');
      // Canonical envelope/hash/host-time verification and valuation precede
      // writer acquisition. Absence never grants permission to recreate a call.
      const receipt = readBudgetTerminalReceipt(binding, database);
      if (!receipt) throw new BudgetRequestError('unavailable');
      const snapshot = getBudgetRequest(binding.id, database)!;
      if (snapshot.terminal_receipt_json !== receipt.bodyJson || snapshot.terminal_receipt_sha256 !== receipt.sha256
        || snapshot.terminal_received_at !== receipt.receivedAt || snapshot.work_id !== binding.workId
        || snapshot.chat_jid !== binding.chatJid || snapshot.provider_id !== binding.providerId
        || snapshot.model_id !== binding.modelId || snapshot.account_ref !== binding.accountRef
        || snapshot.amount_microusd !== binding.amountMicros) throw new BudgetRequestError('conflict');
      const payload: unknown = JSON.parse(receipt.bodyJson);
      if (!payload || typeof payload !== 'object' || !('projectedOutcome' in payload)) throw new BudgetRequestError('invalid_receipt');
      const mapping = prepareUsage(binding, retainedUsageFacts(payload.projectedOutcome), documentedFree, usageSource);
      const modernUsage = mapping(receipt.receivedAt, false), legacyUsage = mapping(receipt.receivedAt, true);
      const immutable = ['id','work_id','chat_jid','provider_id','model_id','account_ref','amount_microusd','binding_sha256','created_at',
        'terminal_receipt_json','terminal_receipt_sha256','terminal_received_at','model_invocation_json','model_invocation_key_sha256'] as const;
      return admitSqliteWrite(database, () => {
        const row = getBudgetRequest(binding.id, database);
        // Recheck immutable proof, not another reconciler's legitimate progress.
        // Large outcome hashing/validation and valuation already happened above.
        if (!row || immutable.some(key => row[key] !== snapshot[key])) throw new BudgetRequestError('conflict');
        const work = getBudgetWork(binding.workId, database);
        if (!work || work.chat_jid !== binding.chatJid) throw new BudgetRequestError('conflict');
        if (!modernUsage.api_equivalent_cost_known && row.state === 'unresolved') {
          if (row.settlement_sha256 !== null || row.usage_event_id !== null) throw new BudgetRequestError('conflict');
          return row; // Exact unknown evidence remains held without timestamp churn.
        }
        const event = row.state === 'settled' && row.usage_event_id ? readUsageProjectionEvent(database, row.usage_event_id) : null;
        if (row.state === 'settled' && !event) throw new BudgetRequestError('conflict');
        const prior = event ? decodeUsageReport(event) : null;
        // A concurrent/legacy charge retains its own original time and mapping.
        // Selecting an already prepared template is not new valuation under SQL.
        const usage = event ? { ...(prior && prior.origin.kind !== 'legacy_projection_capture' ? modernUsage : legacyUsage), run_at: event.accounted_at } : modernUsage;
        const settled = settleBudgetRequest(binding, usage, database);
        // Never retire parent/shared work, reopen cancelled/stopped work, or
        // replace an existing completion timestamp. No other work is written.
        if (settled.state === 'settled' && (work.status === 'active' || work.status === 'paused')) {
          setBudgetWorkStatus(binding.workId, 'completed', { now: receipt.receivedAt, boundary: 'request_settled' }, database);
        }
        return settled;
      }, check, signal, Number.POSITIVE_INFINITY, check);
    },
  });
}
