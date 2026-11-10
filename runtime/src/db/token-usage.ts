/**
 * db/token-usage.ts – Token/cost reporting projections.
 *
 * Actual request settlement commits the immutable event payload and report in
 * one frame. Compatibility session callbacks retain their weaker event identity
 * or unlinked legacy provenance. Replay repairs from the stored event.
 *
 * Consumers:
 *   - agent-pool/usage.ts calls storeTokenUsage() after every agent run.
 *   - agent-control/handlers/info.ts queries the table for `/usage` reports.
 *   - The token-chart skill reads the table to generate usage visualisations.
 */

import type Database from 'bun:sqlite';
import type { TokenUsageRecord, TokenUsageSource, TokenUsageCostProvenance } from "./usage-report-types.js";
import { getDb } from "./connection.js";
import { getRouterState, setRouterState, deleteRouterState } from "./router-state.js";
import { planUsageReportRetention, applyUsageReportRetention } from "./usage-report-retention.js";
import { tokenReportColumns, usageReportRecord } from "./usage-report-projection.js";

/** Overall token/cost totals for a chat across all runs. */
export interface TokenUsageTotalsSummary {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  cost_total: number | null;
  cost_currency: string | null;
  provider_cost_total: number | null;
  provider_cost_currency: string | null;
  catalogue_cost_total: number | null;
  runs: number;
  provider_reported_cost_runs?: number;
  catalogue_estimate_cost_runs?: number;
  unavailable_cost_runs?: number;
  legacy_cost_runs?: number;
}

/** Source category for a persisted usage record. */
export type { TokenUsageSource } from "./usage-report-types.js";

/** Provenance for the effective per-run total cost. */
export type { TokenUsageCostProvenance } from "./usage-report-types.js";

/** Latest token/cost record for a chat, including cache-hit telemetry. */
export interface LatestTokenUsageSummary extends TokenUsageTotalsSummary {
  output_tokens: number;
  cost_input: number;
  cost_output: number;
  cost_cache_read: number;
  cost_cache_write: number;
  cache_read_reported: number | null;
  cache_write_reported: number | null;
  provider_cost_total: number | null;
  provider_cost_currency: string | null;
  catalogue_cost_total: number | null;
  cost_provenance: TokenUsageCostProvenance | null;
  model: string | null;
  response_model: string | null;
  provider: string | null;
  api: string | null;
  usage_source: string | null;
  turns: number | null;
  run_at: string | null;
}

/** Aggregated token/cost totals grouped by provider for a chat. */
export interface TokenUsageByProviderSummary extends TokenUsageTotalsSummary {
  provider: string | null;
}

/** Aggregated token/cost totals grouped by model for a chat. */
export interface TokenUsageByModelSummary extends TokenUsageTotalsSummary {
  model: string | null;
}

/** Aggregated token/cost totals grouped by usage source for a chat. */
export interface TokenUsageBySourceSummary extends TokenUsageTotalsSummary {
  usage_source: string | null;
}

/** Latest model metadata recorded for a chat's token-usage stream. */
export interface LatestTokenUsageModelSummary {
  model: string | null;
  response_model: string | null;
  provider: string | null;
  run_at: string | null;
}

/**
 * Shape of a single token-usage record to be persisted.
 * Maps 1:1 to the `token_usage` table columns.
 */
export type { TokenUsageRecord } from "./usage-report-types.js";

/** Append passive telemetry. Existing event identities are never rewritten;
 * expense tables, prices and financial work ownership cannot admit this write. */
export function storeTokenUsage(record: TokenUsageRecord, db: Database = getDb()): void {
  const values = usageReportRecord(record);
  db.query(`INSERT OR IGNORE INTO main.token_usage (${tokenReportColumns.join(",")})
    VALUES (${tokenReportColumns.map(() => "?").join(",")})`).run(...tokenReportColumns.map(column => values[column]));
}

function normalizeLimit(limit: number): number {
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;
}

// Every sum retains its own unit. Unknown or unlike currencies produce no
// monetary aggregate; individual observations/history remain available unchanged.
const providerCurrency=`CASE WHEN cost_provenance='provider_reported' AND provider_cost_total IS NOT NULL THEN NULLIF(UPPER(TRIM(provider_cost_currency)),'') END`;
const effectiveCurrency=`CASE WHEN cost_total IS NOT NULL THEN CASE cost_provenance WHEN 'provider_reported' THEN ${providerCurrency} WHEN 'catalogue_estimate' THEN NULLIF(UPPER(TRIM(pricing_currency)),'') END END`;
const costSum=`COUNT(cost_total)=COUNT(${effectiveCurrency}) AND COUNT(DISTINCT ${effectiveCurrency})=1`;
const actualSum=`COUNT(provider_cost_total)=COUNT(${providerCurrency}) AND COUNT(DISTINCT ${providerCurrency})=1`;
const totalsSql=`
      COALESCE(SUM(input_tokens),0) AS input_tokens,
      COALESCE(SUM(output_tokens),0) AS output_tokens,
      COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens,
      COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens,
      COALESCE(SUM(total_tokens),0) AS total_tokens,
      CASE WHEN ${costSum} THEN SUM(cost_total) END AS cost_total,
      CASE WHEN ${costSum} THEN MIN(${effectiveCurrency}) END AS cost_currency,
      CASE WHEN ${actualSum} THEN SUM(provider_cost_total) END AS provider_cost_total,
      CASE WHEN ${actualSum} THEN MIN(${providerCurrency}) END AS provider_cost_currency,
      CASE WHEN COUNT(catalogue_cost_total)>0 AND COUNT(catalogue_cost_total)=COUNT(CASE WHEN catalogue_cost_total IS NOT NULL AND pricing_currency='USD' THEN 1 END) THEN SUM(catalogue_cost_total) END AS catalogue_cost_total,
      COUNT(*) AS runs,
      COALESCE(SUM(cost_provenance='provider_reported'),0) AS provider_reported_cost_runs,
      COALESCE(SUM(cost_provenance='catalogue_estimate'),0) AS catalogue_estimate_cost_runs,
      COALESCE(SUM(cost_provenance='unavailable'),0) AS unavailable_cost_runs,
      COALESCE(SUM(cost_provenance IS NULL),0) AS legacy_cost_runs`;

/** Return overall token and cost totals for a chat. */
export function getTokenUsageTotals(chatJid: string): TokenUsageTotalsSummary {
  const db = getDb();
  const row = db.prepare(
    `SELECT
      ${totalsSql}
     FROM token_usage
     WHERE chat_jid = ?`
  ).get(chatJid) as TokenUsageTotalsSummary | undefined;

  return row ?? {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    total_tokens: 0,
    cost_total: null,
    cost_currency: null,
    provider_cost_total: null,
    provider_cost_currency: null,
    catalogue_cost_total: null,
    runs: 0,
    provider_reported_cost_runs: 0,
    catalogue_estimate_cost_runs: 0,
    unavailable_cost_runs: 0,
    legacy_cost_runs: 0,
  };
}

/** Return the most recent token-usage row for a chat, if any. */
export function getLatestTokenUsage(chatJid: string): LatestTokenUsageSummary | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT
      input_tokens,
      output_tokens,
      reasoning_tokens,
      cache_read_tokens,
      cache_write_tokens,
      cache_read_reported,
      cache_write_reported,
      total_tokens,
      cost_input,
      cost_output,
      cost_cache_read,
      cost_cache_write,
      cost_total,
      provider_cost_total,
      provider_cost_currency,
      catalogue_cost_total,
      cost_provenance,
      model,
      response_model,
      provider,
      api,
      usage_source,
      turns,
      run_at,
      CASE cost_provenance WHEN 'provider_reported' THEN NULLIF(UPPER(TRIM(provider_cost_currency)),'') WHEN 'catalogue_estimate' THEN NULLIF(UPPER(TRIM(pricing_currency)),'') END AS cost_currency,
      1 AS runs
     FROM token_usage
     WHERE chat_jid = ?
     ORDER BY run_at DESC, id DESC
     LIMIT 1`
  ).get(chatJid) as LatestTokenUsageSummary | undefined;

  return row ?? null;
}

/** Return per-provider token and cost totals for a chat, sorted by total tokens. */
export function getTokenUsageByProvider(chatJid: string, limit = 5): TokenUsageByProviderSummary[] {
  const db = getDb();
  return db.prepare(
    `SELECT
      provider,
      ${totalsSql}
     FROM token_usage
     WHERE chat_jid = ?
     GROUP BY provider
     ORDER BY total_tokens DESC
     LIMIT ?`
  ).all(chatJid, normalizeLimit(limit)) as TokenUsageByProviderSummary[];
}

/** Return per-model token and cost totals for a chat, sorted by total tokens. */
export function getTokenUsageByModel(chatJid: string, limit = 5): TokenUsageByModelSummary[] {
  const db = getDb();
  return db.prepare(
    `SELECT
      COALESCE(response_model, model) AS model,
      ${totalsSql}
     FROM token_usage
     WHERE chat_jid = ?
     GROUP BY COALESCE(response_model, model)
     ORDER BY total_tokens DESC
     LIMIT ?`
  ).all(chatJid, normalizeLimit(limit)) as TokenUsageByModelSummary[];
}

/** Return per-source token and cost totals for a chat, sorted by total tokens. */
export function getTokenUsageBySource(chatJid: string, limit = 5): TokenUsageBySourceSummary[] {
  const db = getDb();
  return db.prepare(
    `SELECT
      usage_source,
      ${totalsSql}
     FROM token_usage
     WHERE chat_jid = ?
     GROUP BY usage_source
     ORDER BY total_tokens DESC
     LIMIT ?`
  ).all(chatJid, normalizeLimit(limit)) as TokenUsageBySourceSummary[];
}

/** Return the most recent token-usage model metadata for a chat, if any. */
export function getLatestTokenUsageModel(chatJid: string): LatestTokenUsageModelSummary | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT
      model,
      response_model,
      provider,
      run_at
     FROM token_usage
     WHERE chat_jid = ?
     ORDER BY run_at DESC, id DESC
     LIMIT 1`
  ).get(chatJid) as LatestTokenUsageModelSummary | undefined;

  return row ?? null;
}

/**
 * Delete only unlinked legacy reports older than the retention period.
 * Event/request references retain accounting and replay evidence until their
 * owners explicitly retire it. This function never releases a request hold.
 *
 * One bounded page per existing startup invocation; no new schedule. Explicit
 * maintenance persists owner plans/cursors for subsequent pages and ACK replay.
 * @returns Number of deleted rows (at most 1000).
 */
export function pruneOldTokenUsage(retentionDays = 90): number {
  if(!Number.isFinite(retentionDays)||retentionDays<0)throw Error("Invalid usage retention period");
  const db = getDb(), cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString(), key="retention:legacy-usage-reports:v1";
  return db.transaction(()=>{
    const raw=getRouterState(key);
    const cursor=raw===undefined?undefined:JSON.parse(raw) as {version:number;retentionDays:number;before:string;after:number};
    if(raw!==undefined&&(!cursor||cursor.version!==1||!Number.isFinite(cursor.retentionDays)||cursor.retentionDays<0||typeof cursor.before!=="string"||
      !Number.isFinite(Date.parse(cursor.before))||!Number.isSafeInteger(cursor.after)||cursor.after<0))throw Error("Invalid persisted usage retention cursor");
    const resume=cursor?.retentionDays===retentionDays?cursor:undefined;
    if(resume&&resume.before>cutoff)throw Error("Usage retention clock moved behind its cursor");
    const plan=planUsageReportRetention(db,{before:resume?.before??cutoff,after:resume?.after??0,limit:1000});
    const result=applyUsageReportRetention(db,plan);
    if(result.next===null){deleteRouterState(key);if(getRouterState(key)!==undefined)throw Error("Usage retention cursor delete refused");}
    else {const value=JSON.stringify({version:1,retentionDays,before:plan.before,after:result.next});setRouterState(key,value);if(getRouterState(key)!==value)throw Error("Usage retention cursor write refused");}
    return result.removed.length;
  }).immediate();
}
