import { createHash, randomUUID } from "node:crypto";
import type Database from "bun:sqlite";
import type { AssistantMessage, Api, Model } from "../../src/durable-legacy-sdk.js";
import { modelRequestAccounting } from "../../src/budget/model-request-accounting.js";
import { admitSqliteWrite } from "../../src/db/sqlite-async-admission.js";
import { boundHostRequestCost } from "../../src/budget/request-cost-bound.js";
import { ensureBudgetWork, getBudgetWork, setBudgetWorkStatus } from "../../src/db/budget-limits.js";
import { readStoredProviderUsageAccountRef } from "../../src/agent-pool/provider-usage.js";
import { BudgetRequestError,getBudgetRequest,retainBudgetTerminalReceipt } from '../../src/db/budget-request-reservations.js';
import { getDb } from '../../src/db/connection.js';
import { projectTerminalOutcome } from './host-terminal-outcome.js';
import { nativeBackgroundIdentity,nativeBackgroundPolicyHash,readNativeBackgroundPolicy,type NativeBackgroundPolicy } from '../../src/agent-pool/background-operation-contract.js';

export const operationBudgetWorkId = (operationId: string) => `durable-operation:${operationId}`;
export function sidePromptSourceId(chatJid: string, retryId: string): string {
  const digest = createHash("sha256").update(JSON.stringify([chatJid, retryId])).digest("hex");
  return `side-prompt:${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/** Reconcile only already-committed host terminals. Never clear uncertain holds. */
export async function completeMaintenanceBudgetWork(database: Database, workId: string): Promise<void> {
  await admitSqliteWrite(database, () => {
    const work = getBudgetWork(workId, database);
    if (work?.status !== "active" || work.execution_kind !== "side_prompt" || work.parent_work_id !== null || database.query(`SELECT 1 FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id
      WHERE w.parent_work_id=? AND r.state NOT IN ('settled','released') LIMIT 1`).get(workId)) return;
    setBudgetWorkStatus(workId, "completed", { boundary: "maintenance_settled" }, database);
  });
}

export async function reconcileOperationBudgetWork(database: Database, operationId?: string): Promise<void> {
  await admitSqliteWrite(database, () => {
    const terminals = database.query("SELECT operation_id FROM service_effect_s02_commits WHERE (? IS NULL OR operation_id=?)").all(operationId ?? null, operationId ?? null) as { operation_id: string }[];
    for (const terminal of terminals) {
      const id = operationBudgetWorkId(terminal.operation_id);
      if (getBudgetWork(id, database)?.status !== "active") continue;
      if (!database.query(`SELECT 1 FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id
        WHERE w.parent_work_id=? AND r.state NOT IN ('settled','released') LIMIT 1`).get(id))
      {
        setBudgetWorkStatus(id, "completed", { boundary: "operation_settled" }, database);
        const work = getBudgetWork(id, database);
        const parent = work?.parent_work_id ? getBudgetWork(work.parent_work_id, database) : null;
        const source = database.query(`SELECT s.source_id FROM service_effect_s01_operations o
          JOIN service_effect_s01_sources s ON s.chat_jid=o.chat_jid AND s.source_seq=o.primary_source_seq
          WHERE o.operation_id=? AND s.kind='internal'`).get(terminal.operation_id) as { source_id: string } | null;
        if (parent?.status === "active" && parent.execution_kind === "side_prompt" && parent.chat_jid === work?.chat_jid &&
          source?.source_id === sidePromptSourceId(parent.chat_jid, parent.id) &&
          !database.query("SELECT 1 FROM budget_work WHERE parent_work_id=? AND id<>? LIMIT 1").get(parent.id, id))
          setBudgetWorkStatus(parent.id, "completed", { boundary: "side_prompt_settled" }, database);
      }
    }
  });
}

/** Stored-identity host model requests. Exact background input policy supports
 * capped reservations; other native paths retain their existing cap denial.
 * One fresh request ID per actual invocation, including a recovery resend. A
 * dispatched unknown outcome retains its old hold; it is never called free.
 */
export async function reserveHostRequest(options: {
  database: Database; operationId: string; chatJid: string; authPath: string;
  model: Model<Api>; maxTokens?: number; executionKind?: "interactive" | "delegate" | "scheduled" | "side_prompt" | "background"; scheduledTaskId?: string;
  backgroundPolicy?:NativeBackgroundPolicy;
  usageSource?:'compaction';
  maintenanceWorkId?: string; signal: AbortSignal; assertCurrent(): void;
  /** Database/lease lifetime only. Request cancellation cannot erase paid facts.
   * The backend must keep this owner alive while SDK close joins the request. */
  terminalOwner?: { signal: AbortSignal; assertCurrent(): void };
}) {
  const { database, model, signal, assertCurrent } = options;
  const background=options.backgroundPolicy&&readNativeBackgroundPolicy(options.backgroundPolicy);
  if((options.executionKind==='background')!==!!background)throw Error('Background request policy required');
  const operationWork = options.maintenanceWorkId ?? operationBudgetWorkId(options.operationId);
  const assertBackground=()=>{
    if(!background)return;
    const identity=nativeBackgroundIdentity(background),work=getBudgetWork(operationWork,database),owner=getBudgetWork(background.workId,database);
    if(identity.operationId!==options.operationId||identity.chatJid!==options.chatJid||options.maintenanceWorkId||options.scheduledTaskId||
      background.model.provider!==model.provider||background.model.modelId!==model.id||background.model.api!==model.api||
      work?.status!=='active'||work.execution_kind!=='background'||work.chat_jid!==identity.chatJid||work.parent_work_id!==background.workId||
      owner?.status!=='active'||owner.execution_kind!=='background'||owner.chat_jid!==identity.chatJid||owner.parent_work_id!==background.parentWorkId||
      !database.query(`SELECT 1 FROM service_effect_s01_operations o JOIN service_effect_s01_sources s ON s.chat_jid=o.chat_jid AND s.source_seq=o.primary_source_seq
        JOIN piclaw_durable_bindings_v1 b ON b.operation_id=o.operation_id AND b.chat_jid=s.chat_jid AND b.source_seq=s.source_seq
        WHERE o.operation_id=? AND o.chat_jid=? AND o.phase='executing' AND o.cancellation_source_id IS NULL AND s.state='claimed' AND s.kind='internal'
        AND s.source_id=? AND s.payload_ref=? AND s.provenance_ref=? AND b.source_id=s.source_id AND b.payload_ref=s.payload_ref`)
        .get(identity.operationId,identity.chatJid,identity.sourceId,identity.payloadRef,'application:background:'+nativeBackgroundPolicyHash(background)))throw Error('Background request ancestry or source changed');
  };
  assertCurrent();assertBackground(); signal.throwIfAborted();
  const accountRef = readStoredProviderUsageAccountRef(model.provider, options.authPath);
  if(!accountRef){
    if(background&&database.query('SELECT 1 FROM budget_caps WHERE enabled=1 LIMIT 1').get())throw new BudgetRequestError('budget_denied');
    return undefined;
  }
  const requested = boundHostRequestCost(model, options.maxTokens ?? model.maxTokens);
  // A smaller request hint is not proof that every provider enforces it. Fund
  // the full approved model output ceiling for this capped background port.
  const amount = background&&requested.amountMicros!==null?boundHostRequestCost(model,model.maxTokens):requested;
  if(amount.amountMicros===null){
    if(background&&database.query('SELECT 1 FROM budget_caps WHERE enabled=1 LIMIT 1').get())throw new BudgetRequestError('budget_denied');
    return undefined;
  }
  const id = randomUUID();
  const workId = `durable-request:${id}`;
  const current = () => {
    assertCurrent();assertBackground(); signal.throwIfAborted();
    if (readStoredProviderUsageAccountRef(model.provider, options.authPath) !== accountRef) throw Error("Native request account changed");
  };
  await admitSqliteWrite(database, () => {
    const sidePrompt = database.query(`SELECT 1 FROM service_effect_s01_operations o
      JOIN service_effect_s01_sources s ON s.chat_jid=o.chat_jid AND s.source_seq=o.primary_source_seq
      WHERE o.operation_id=? AND o.chat_jid=? AND s.kind='internal' AND s.source_id LIKE 'side-prompt:%'`).get(options.operationId, options.chatJid);
    const existingSide = sidePrompt ? getBudgetWork(operationWork, database) : null;
    if (!background) ensureBudgetWork({ id: operationWork, chatJid: options.chatJid, executionKind: options.maintenanceWorkId || sidePrompt ? "side_prompt" : options.scheduledTaskId ? "scheduled" : "interactive",
      parentWorkId: existingSide?.parent_work_id, scheduledTaskId: options.scheduledTaskId }, database);
    ensureBudgetWork({ id: workId, chatJid: options.chatJid, executionKind: options.executionKind === "delegate" ? "delegate" : sidePrompt ? "side_prompt" : options.executionKind ?? "interactive", parentWorkId: operationWork }, database);
  }, current, signal);
  const accounting = modelRequestAccounting({ authorise: current, documentedFree: false, usageSource: options.usageSource ?? (options.maintenanceWorkId ? "compaction" : "assistant") }, database);
  const binding = { id, workId, chatJid: options.chatJid, providerId: model.provider, modelId: model.id, accountRef, amountMicros: amount.amountMicros };
  let dispatchStarted = false;
  let settled = false;
  let settlementHash: string | undefined, terminalReceivedAt: string | undefined;
  const terminalPhysical = Object.freeze({ provider: binding.providerId, id: binding.modelId, api: model.api });
  // A rejected reservation may have committed before an ACK/storage failure.
  // Keep work active; never retire authority needed to reconcile that hold.
  try{await accounting.reserve(binding, signal);}
  catch(error){
    if(background&&error instanceof BudgetRequestError&&error.code==='budget_denied'){
      try{await admitSqliteWrite(database,()=>{if(!getBudgetRequest(binding.id,database))setBudgetWorkStatus(workId,'stopped',{boundary:'request_budget_blocked'},database);});}
      catch(cleanup){throw new AggregateError([error,cleanup],'Background budget rejection cleanup is uncertain',{cause:error});}
    }
    throw error;
  }
  return {
    id: binding.id,
    /** WIP producer port: not yet called by the model relay. Persist only the
     * allowlisted SDK-visible outcome, never raw provider diagnostics/handles. */
    async retainTerminal(message: AssistantMessage) {
      const owner = options.terminalOwner;
      if (!owner) throw Error('Terminal receipt owner unavailable');
      const check = () => {
        owner.signal.throwIfAborted(); owner.assertCurrent();
        if (getDb() !== database) throw Error('Terminal receipt database binding changed');
      };
      check();
      const projected = projectTerminalOutcome(message, terminalPhysical);
      terminalReceivedAt ??= new Date().toISOString();
      const row = getBudgetRequest(binding.id, database);
      if (!row) throw new BudgetRequestError('unavailable');
      // Explicit JSON boundary: the projection is detached/frozen, and the
      // reservation owner validates this exact finite payload before admission.
      const projectedOutcome = JSON.parse(JSON.stringify(projected));
      return retainBudgetTerminalReceipt(binding, { version: 1, requestId: binding.id,
        requestBindingSha256: row.binding_sha256, projectedOutcome }, terminalReceivedAt,
        { database, signal: owner.signal, assertCurrent: check });
    },
    async dispatch() {
      current();
      if (dispatchStarted) throw Error("Native request already dispatched");
      dispatchStarted = true;
      await accounting.dispatch(binding, signal);
      current();
    },
    async settle(message: AssistantMessage) {
      // Settlement uses original host evidence even after cancellation/revocation.
      const hash = JSON.stringify(message);
      if (settled) { if (hash !== settlementHash) throw Error("Native request terminal changed"); return; }
      const row = await accounting.settle(binding, message);
      if (row.state !== "settled") throw Error("Native request settlement unresolved");
      await admitSqliteWrite(database, () => setBudgetWorkStatus(workId, "completed", { boundary: "request_settled" }, database));
      settled = true; settlementHash = hash;
    },
    async abandon() {
      if (settled) return;
      const row = await accounting.abandon(binding);
      if (row?.state === "released" || row?.state === "settled") await admitSqliteWrite(database, () =>
        setBudgetWorkStatus(workId, row.state === "released" ? "stopped" : "completed",
          { boundary: row.state === "released" ? "request_not_sent" : "request_settled" }, database));
    },
  };
}
