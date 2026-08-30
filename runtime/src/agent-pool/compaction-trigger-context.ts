import { AsyncLocalStorage } from "node:async_hooks";

export type PiclawCompactionExecutionStage = "deterministic" | "provider_connect" | "first_token" | "streaming" | "settlement";

export type PiclawCompactionTrigger =
  | "manual"
  | "pre_prompt"
  | "idle"
  | "recovery"
  | "model_switch"
  | "model_downshift"
  | "rotation"
  | "threshold"
  | "overflow"
  | string;

export interface PiclawCompactionTriggerMetadata {
  chatJid: string;
  trigger: PiclawCompactionTrigger;
  willRetry: boolean;
  source: string;
  /** Internal identity used to isolate concurrent/late compaction cleanup. */
  generationId?: string;
  attempt?: number;
  targetContextWindow?: number;
  targetModelLabel?: string;
  /** Absolute Date.now() deadline for cooperative deterministic compaction work. */
  deadlineAtMs?: number;
  /** Maximum deterministic work units before cooperative compaction aborts. */
  maxWorkUnits?: number;
  executionStage?: PiclawCompactionExecutionStage;
  compactionMethod?: string;
  compactionExecution?: string;
  compactionInputTokens?: number;
  providerModel?: string;
  providerRequestCount?: number;
  providerRequestStartedAtMs?: number;
  providerFirstTokenAtMs?: number;
  providerLastOutputAtMs?: number;
  timeToFirstTokenMs?: number;
}

interface ActiveCompactionTriggerState {
  metadata: PiclawCompactionTriggerMetadata;
  workUnits: number;
  lastYieldAtMs: number;
}

export interface UpstreamCompactionEventMetadata {
  reason?: string;
  willRetry?: boolean;
}

const compactionTriggerStorage = new AsyncLocalStorage<ActiveCompactionTriggerState>();

export function getActivePiclawCompactionTrigger(): PiclawCompactionTriggerMetadata | null {
  return compactionTriggerStorage.getStore()?.metadata ?? null;
}

/** Remaining wall-clock budget for the active Piclaw compaction generation. */
export function updatePiclawCompactionExecution(patch: Partial<Pick<PiclawCompactionTriggerMetadata,
  "executionStage" | "compactionMethod" | "compactionExecution" | "compactionInputTokens" | "providerModel" | "providerRequestCount" | "providerRequestStartedAtMs" | "providerFirstTokenAtMs" | "providerLastOutputAtMs" | "timeToFirstTokenMs"
>>): void {
  const metadata = compactionTriggerStorage.getStore()?.metadata;
  if (!metadata) return;
  Object.assign(metadata, patch);
}

export function getRemainingPiclawCompactionMs(now = Date.now()): number | undefined {
  const deadlineAtMs = compactionTriggerStorage.getStore()?.metadata.deadlineAtMs;
  if (deadlineAtMs === undefined) return undefined;
  return Math.max(1, Math.floor(deadlineAtMs - now));
}

export function checkPiclawCompactionBudget(label: string, units = 1): void {
  const state = compactionTriggerStorage.getStore();
  if (!state) return;
  const increment = Number.isFinite(units) && units > 0 ? Math.ceil(units) : 1;
  state.workUnits += increment;
  const { metadata } = state;
  if (metadata.maxWorkUnits !== undefined && state.workUnits > metadata.maxWorkUnits) {
    throw new Error(`Compaction deterministic work budget exhausted at ${label} (${state.workUnits}/${metadata.maxWorkUnits} work units).`);
  }
  if (metadata.deadlineAtMs !== undefined && Date.now() > metadata.deadlineAtMs) {
    throw new Error(`Compaction timed out during deterministic work at ${label}.`);
  }
}

export async function maybeYieldPiclawCompaction(label: string, minIntervalMs = 25): Promise<void> {
  checkPiclawCompactionBudget(label, 0);
  const state = compactionTriggerStorage.getStore();
  if (!state) return;
  const now = Date.now();
  if (now - state.lastYieldAtMs < Math.max(0, minIntervalMs)) return;
  state.lastYieldAtMs = now;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  checkPiclawCompactionBudget(`${label}:after_yield`, 0);
}

export async function runWithPiclawCompactionTrigger<T>(
  metadata: PiclawCompactionTriggerMetadata,
  fn: () => Promise<T>,
): Promise<T> {
  return await compactionTriggerStorage.run({ metadata, workUnits: 0, lastYieldAtMs: Date.now() }, fn);
}

export function resolvePiclawCompactionTrigger(
  upstream: UpstreamCompactionEventMetadata = {},
): PiclawCompactionTriggerMetadata {
  const active = getActivePiclawCompactionTrigger();
  if (active) return active;
  return {
    chatJid: "unknown",
    trigger: upstream.reason ?? "manual",
    willRetry: upstream.willRetry === true,
    source: "upstream",
  };
}

export function buildPiclawCompactionEventFields(
  metadata: PiclawCompactionTriggerMetadata,
  upstream: UpstreamCompactionEventMetadata = {},
): Record<string, unknown> {
  const reason = upstream.reason ?? metadata.trigger;
  return {
    reason,
    trigger: metadata.trigger,
    piclawReason: metadata.trigger,
    willRetry: upstream.willRetry ?? metadata.willRetry,
    source: metadata.source,
    chatJid: metadata.chatJid,
    ...(metadata.attempt !== undefined ? { attempt: metadata.attempt } : {}),
    ...(metadata.targetContextWindow !== undefined ? { targetContextWindow: metadata.targetContextWindow } : {}),
    ...(metadata.targetModelLabel !== undefined ? { targetModelLabel: metadata.targetModelLabel } : {}),
    ...(metadata.executionStage !== undefined ? { executionStage: metadata.executionStage } : {}),
    ...(metadata.compactionMethod !== undefined ? { compactionMethod: metadata.compactionMethod } : {}),
    ...(metadata.compactionExecution !== undefined ? { compactionExecution: metadata.compactionExecution } : {}),
    ...(metadata.compactionInputTokens !== undefined ? { compactionInputTokens: metadata.compactionInputTokens } : {}),
    ...(metadata.providerModel !== undefined ? { providerModel: metadata.providerModel } : {}),
    ...(metadata.providerRequestCount !== undefined ? { providerRequestCount: metadata.providerRequestCount } : {}),
    ...(metadata.providerRequestStartedAtMs !== undefined ? { providerRequestStartedAtMs: metadata.providerRequestStartedAtMs } : {}),
    ...(metadata.providerFirstTokenAtMs !== undefined ? { providerFirstTokenAtMs: metadata.providerFirstTokenAtMs } : {}),
    ...(metadata.providerLastOutputAtMs !== undefined ? { providerLastOutputAtMs: metadata.providerLastOutputAtMs } : {}),
    ...(metadata.timeToFirstTokenMs !== undefined ? { timeToFirstTokenMs: metadata.timeToFirstTokenMs } : {}),
  };
}
