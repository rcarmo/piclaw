import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from 'node:timers/promises';
import type Database from "bun:sqlite";
import type { AssistantMessage, Api, Model } from "../../src/durable-legacy-sdk.js";
import { modelRequestAccounting, assertModelAccountingReady, RetainedAccountingPending } from "../../src/budget/model-request-accounting.js";
import { admitSqliteWrite } from "../../src/db/sqlite-async-admission.js";
import { boundHostRequestCost } from "../../src/budget/request-cost-bound.js";
import { ensureBudgetWork, getBudgetWork, setBudgetWorkStatus } from "../../src/db/budget-limits.js";
import { readStoredProviderUsageAccountRef } from "../../src/agent-pool/provider-usage.js";
import { abandonBudgetRequest,BudgetRequestError,findBudgetRequestByModelInvocation,findBudgetRequestByLogicalModelInvocation,getBudgetRequest,readBudgetTerminalReceipt,retainBudgetTerminalReceipt,
  type BudgetModelInvocation,type BudgetRequestBinding,type BudgetRequestReservation,type BudgetTerminalReceiptPayload } from '../../src/db/budget-request-reservations.js';
import { getDb } from '../../src/db/connection.js';
import { createLogger } from '../../src/utils/logger.js';
import type { TaskModelRequestScope } from './task-model-boundary-shim.js';
const log = createLogger('durable.accounting');
import { projectTerminalOutcome,decodeStoredTerminalOutcome } from './host-terminal-outcome.js';
import { nativeBackgroundIdentity,nativeBackgroundPolicyHash,readNativeBackgroundPolicy,type NativeBackgroundPolicy } from '../../src/agent-pool/background-operation-contract.js';

export const operationBudgetWorkId = (operationId: string) => `durable-operation:${operationId}`;
function hasSdkAccountingScope(database: Database): boolean {
  const count = (database.query("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name IN ('conversations','tasks')").get() as { n: number }).n;
  if (count === 1) throw new BudgetRequestError('conflict');
  return count === 2;
}
function accountingConversationRoots(database: Database) {
  const roots = new Map<number, number>();
  const rootFor = (id: number): number => {
    if (!Number.isSafeInteger(id) || id < 1) throw new BudgetRequestError('conflict');
    if (roots.has(id)) return roots.get(id)!;
    const rows = database.query(`WITH RECURSIVE ancestry(id,owner_task_id) AS (
      SELECT id,owner_task_id FROM conversations WHERE id=? UNION
      SELECT c.id,c.owner_task_id FROM ancestry a JOIN tasks t ON t.id=a.owner_task_id JOIN conversations c ON c.id=t.conversation_id
    ) SELECT id FROM ancestry WHERE owner_task_id IS NULL`).all(id) as { id: number }[];
    if (rows.length !== 1) throw new BudgetRequestError('conflict');
    roots.set(id, rows[0]!.id); return rows[0]!.id;
  };
  return rootFor;
}
/** Denial-only dependency scope. SDK conversation ownership is not a new source
 * grant or invented generation parent. History/fork edges never join scopes. */
export function assertConversationAccountingReady(database: Database, scope: { domain: string; conversationId: number; chatJid: string }, excludeRequestId?: string, terminal = false): void {
  if (!hasSdkAccountingScope(database)) return; // Generic Root accounting has no SDK work.
  const rootFor = accountingConversationRoots(database), root = rootFor(scope.conversationId);
  const pending = pendingSdkAccountingRows(database, scope.domain, root, scope.chatJid);
  for (const row of pending) {
    if (row.accounting_scope_broken) throw new BudgetRequestError('conflict');
    if (row.id === excludeRequestId || row.model_invocation_json === null) continue;
    const invocation = JSON.parse(row.model_invocation_json) as BudgetModelInvocation;
    if (findBudgetRequestByModelInvocation(invocation, database)?.id !== row.id) throw new BudgetRequestError('conflict');
    if (invocation.domain === scope.domain && rootFor(invocation.conversationId) === root)
      assertModelAccountingReady(row.work_id, database, excludeRequestId, terminal);
  }
  if (terminal) {
    const live = database.query(`SELECT conversation_id FROM tasks INDEXED BY tasks_by_status WHERE kind=? AND background=1
      AND status IN ('pending','running','waiting','sleeping','completing') AND json_extract(record,'$.owner') IS NULL`).all(JSON.stringify('pi.compaction')) as { conversation_id: number }[];
    if (live.some(task => rootFor(task.conversation_id) === root)) throw new BudgetRequestError('budget_denied');
  }
}
export function assertOperationAccountingReady(database: Database, operationId: string, terminal = false,
  namespace?: { domain: string; incarnation: string }): void {
  assertModelAccountingReady(operationBudgetWorkId(operationId), database, undefined, terminal);
  if (!hasSdkAccountingScope(database)) return;
  if (!namespace) throw new BudgetRequestError('conflict');
  // The immutable binding locates the exact SDK namespace/conversation. Current
  // source/version/harness authority is still checked by the original caller.
  const rows = database.query(`SELECT b.domain,b.incarnation,b.conversation_id,b.chat_jid FROM piclaw_durable_bindings_v1 b
    JOIN service_effect_s01_operations o ON o.operation_id=b.operation_id AND o.chat_jid=b.chat_jid AND o.primary_source_seq=b.source_seq
    JOIN service_effect_s01_sources s ON s.chat_jid=b.chat_jid AND s.source_seq=b.source_seq AND s.source_id=b.source_id AND s.payload_ref=b.payload_ref
    JOIN service_effect_s01_operation_sources os ON os.operation_id=o.operation_id AND os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq
    WHERE b.domain=? AND b.incarnation=? AND o.operation_id=?`).all(namespace.domain, namespace.incarnation, operationId) as { domain: string; incarnation: string; conversation_id: number; chat_jid: string }[];
  if (rows.length !== 1) throw new BudgetRequestError('conflict');
  const binding = rows[0]!;
  assertConversationAccountingReady(database, { domain: binding.domain, conversationId: binding.conversation_id, chatJid: binding.chat_jid }, undefined, terminal);
}
export function sidePromptSourceId(chatJid: string, retryId: string): string {
  const digest = createHash("sha256").update(JSON.stringify([chatJid, retryId])).digest("hex");
  return `side-prompt:${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/** Caller must prove the original SDK task and placed summary terminal. This
 * financial close never proves execution and never clears unresolved holds. */
export async function completeMaintenanceBudgetWork(database: Database, workId: string, owner: AccountingOwner,
  completed: () => Promise<boolean>): Promise<void> {
  const captured = captureAccountingOwner(database, owner), original = getBudgetWork(workId,database);
  if (!original) return;
  const sameWork = (work: ReturnType<typeof getBudgetWork>) => !!original && !!work
    && (['id','chat_jid','execution_kind','parent_work_id','scheduled_task_id','created_at'] as const).every(key => original[key] === work[key]);
  const eligible = () => {
    captured.assertCurrent();
    const work = getBudgetWork(workId, database);
    if (!sameWork(work)) throw new BudgetRequestError('conflict');
    if (!workId.startsWith('durable-maintenance:') || work?.status !== 'active' || work.execution_kind !== 'side_prompt') return false;
    if (work.parent_work_id !== null) {
      const parent = getBudgetWork(work.parent_work_id, database);
      if (!parent?.id.startsWith('durable-operation:') || parent.chat_jid !== work.chat_jid) return false;
    }
    return !database.query(`SELECT 1 FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id
      WHERE w.parent_work_id=? AND (r.state NOT IN ('settled','released') OR r.state='settled' AND w.status IN ('active','paused')) LIMIT 1`).get(workId);
  };
  if (!eligible()) return; // No SDK proof/read transaction or idle writer for held work.
  const proven = await completed(); captured.assertCurrent();
  if (proven !== true && proven !== false) throw Error('Maintenance proof must return completion');
  if (!proven) return;
  try {
    await admitSqliteWrite(database, () => {
      if (eligible()) setBudgetWorkStatus(workId, 'completed', { boundary: 'maintenance_settled' }, database);
    }, captured.assertCurrent, captured.signal, Number.POSITIVE_INFINITY, captured.assertCurrent);
  } catch (error) {
    captured.assertCurrent();
    if (error instanceof BudgetRequestError) throw error;
    const work = getBudgetWork(workId, database);
    // A lost ACK may follow close. Otherwise keep a verified, eligible financial
    // aggregate active; public SDK proof is rediscovered by the existing owner.
    if (!sameWork(work)) throw new BudgetRequestError('conflict');
    if (work?.status !== 'completed' && !eligible()) throw error;
  }
}

type AccountingOwner = { signal: AbortSignal; assertCurrent(): void };
function captureAccountingOwner(database: Database, owner: AccountingOwner): AccountingOwner {
  const signal = owner.signal, assertOwner = owner.assertCurrent.bind(owner);
  const check = () => {
    signal.throwIfAborted();
    const checked: unknown = assertOwner();
    if (checked !== undefined) { void Promise.resolve(checked).catch(() => {}); throw Error('Accounting owner must be synchronous'); }
    if (getDb() !== database) throw Error('Model request database binding changed.');
  };
  check(); return { signal, assertCurrent: check };
}
/** One retained-fact transition/readback policy for live, phase and startup owners. */
async function settleRetainedAccounting(database: Database, binding: BudgetRequestBinding, owner: AccountingOwner, usageSource: 'assistant' | 'compaction'): Promise<boolean> {
  const captured = captureAccountingOwner(database, owner);
  if (!readBudgetTerminalReceipt(binding, database)) throw new BudgetRequestError('unavailable');
  try {
    assertModelAccountingReady(binding.workId, database);
    if (getBudgetRequest(binding.id, database)?.state === 'unresolved') return true; // Verified intentional unknown; preserve its hold/time.
    // Completed charges still use the original deep event/hash verification.
  }
  catch (pending) { if (!(pending instanceof BudgetRequestError) || pending.code !== 'budget_denied') throw pending; }
  try {
    await modelRequestAccounting({ authorise() { throw Error('Financial reconciliation cannot dispatch'); }, documentedFree: false,
      usageSource }, database).settleRetainedRequest(binding, captured);
    captured.assertCurrent(); return true;
  } catch (error) {
    if (error instanceof BudgetRequestError) throw error;
    captured.assertCurrent();
    if (!readBudgetTerminalReceipt(binding, database)) throw error;
    // A failed ACK can follow COMMIT. Exact readback distinguishes completed
    // money from a still-valid held receipt; neither authorises another send.
    let ready = true;
    try { assertModelAccountingReady(binding.workId, database); }
    catch (pending) {
      if (!(pending instanceof BudgetRequestError) || pending.code !== 'budget_denied') throw pending;
      ready = false;
    }
    try { log.warn('Terminal accounting callback failed; exact receipt remains available', {
      operation: 'durable_accounting.ack_failed', requestId: binding.id,
    }); } catch { /* Optional diagnostics cannot replace durable facts. */ }
    return ready;
  }
}
async function reconcileRetainedAccountingRow(database: Database, row: BudgetRequestReservation, owner: AccountingOwner): Promise<boolean> {
  const invocation = JSON.parse(row.model_invocation_json!) as BudgetModelInvocation; // Exact full binding is verified by the shared receipt reader.
  const binding: BudgetRequestBinding = { id: row.id, workId: row.work_id, chatJid: row.chat_jid, providerId: row.provider_id,
    modelId: row.model_id, accountRef: row.account_ref, amountMicros: row.amount_microusd, modelInvocation: invocation };
  return settleRetainedAccounting(database, binding, owner, invocation.taskKind === 'pi.compaction' ? 'compaction' : 'assistant');
}
function pendingSdkAccountingRows(database: Database, domain: string, root: number, chatJid?: string): (BudgetRequestReservation & { accounting_scope_broken: number })[] {
  // Only IDs enter the outstanding-fact/ownership walk; unrelated receipts and
  // corrupt bindings never become this tree's financial or execution authority.
  return database.query(`WITH RECURSIVE candidates(id,conversation_id) AS MATERIALIZED (
    SELECT r.id,json_extract(r.model_invocation_json,'$.conversationId')
    FROM budget_request_reservations r INDEXED BY idx_budget_requests_domain_state
    WHERE json_extract(r.model_invocation_json,'$.domain')=? AND r.state IN ('reserved','dispatched','unresolved')
      AND r.model_invocation_json IS NOT NULL AND (? IS NULL OR r.chat_jid=?)
    UNION ALL SELECT r.id,json_extract(r.model_invocation_json,'$.conversationId') FROM budget_work w INDEXED BY idx_budget_work_status
    CROSS JOIN budget_request_reservations r INDEXED BY idx_budget_requests_work_state ON r.work_id=w.id
    WHERE w.status IN ('active','paused') AND r.state='settled'
      AND r.model_invocation_json IS NOT NULL AND json_extract(r.model_invocation_json,'$.domain')=?
      AND (? IS NULL OR w.chat_jid=?)
  ), ancestry(request_id,id,owner_task_id,owner_conversation_id,broken) AS (
    SELECT p.id,c.id,c.owner_task_id,c.owner_conversation_id,0 FROM candidates p JOIN conversations c ON c.id=p.conversation_id
    UNION SELECT a.request_id,c.id,c.owner_task_id,c.owner_conversation_id,a.broken OR t.id IS NULL
      FROM ancestry a LEFT JOIN tasks t ON t.id=a.owner_task_id
      JOIN conversations c ON c.id=coalesce(t.conversation_id,a.owner_conversation_id)
      WHERE a.owner_task_id IS NOT NULL
  ) SELECT r.*,a.broken AS accounting_scope_broken FROM ancestry a JOIN budget_request_reservations r ON r.id=a.request_id
    WHERE a.id=? AND a.owner_task_id IS NULL`).all(domain,chatJid ?? null,chatJid ?? null,domain,chatJid ?? null,chatJid ?? null,root) as (BudgetRequestReservation & { accounting_scope_broken: number })[];
}
/** Before the SDK phase body enters: reconcile immutable local facts or ask the
 * existing SDK scheduler to wait. No provider, tool, task-revival or queue port. */
export async function prepareTaskAccounting(database: Database, domain: string, scope: TaskModelRequestScope, owner: AccountingOwner): Promise<boolean> {
  const captured = captureAccountingOwner(database, owner);
  scope.signal.throwIfAborted();
  // Recovering an exact paid checkpoint is observation, not a new effect. Its
  // real model/account/source guards still run in the unchanged model port.
  if (scope.checkpointHash && (scope.taskKind === 'pi.generation' && scope.phase === 'request'
    || scope.taskKind === 'pi.compaction' && scope.phase === 'summarize')) {
    const row = findBudgetRequestByLogicalModelInvocation({ version: 1, domain, conversationId: scope.conversationId,
      taskId: scope.taskId, taskKind: scope.taskKind, phase: scope.phase as 'request' | 'summarize', checkpointHash: scope.checkpointHash }, database);
    if (row && row.terminal_receipt_json !== null) return true;
  }
  // This phase has not entered. Its observer may stop waiting for acquisition;
  // the immutable receipt remains for the database owner's later reconciliation.
  const observer = { signal: AbortSignal.any([captured.signal, scope.signal]), assertCurrent: captured.assertCurrent };
  const ready = await prepareConversationAccounting(database, domain, scope.conversationId, observer);
  scope.signal.throwIfAborted(); return ready;
}
/** Same receipt owner for SDK phase preparation and terminal observation. */
export async function prepareConversationAccounting(database: Database, domain: string, conversationId: number, owner: AccountingOwner): Promise<boolean> {
  const captured = captureAccountingOwner(database, owner);
  const rootFor = accountingConversationRoots(database), root = rootFor(conversationId);
  const rows = pendingSdkAccountingRows(database, domain, root);
  for (const row of rows) {
    if (row.accounting_scope_broken) throw new BudgetRequestError('conflict');
    const invocation = JSON.parse(row.model_invocation_json!) as BudgetModelInvocation;
    if (invocation.domain !== domain) continue;
    if (findBudgetRequestByModelInvocation(invocation, database)?.id !== row.id) throw new BudgetRequestError('conflict');
    try { assertModelAccountingReady(row.work_id, database); continue; }
    catch (pending) { if (!(pending instanceof BudgetRequestError) || pending.code !== 'budget_denied') throw pending; }
    if (rootFor(invocation.conversationId) !== root) throw new BudgetRequestError('conflict');
    if (row.terminal_receipt_json === null) return false; // Unknown send stays held; no financial guess or resend.
    if (!await reconcileRetainedAccountingRow(database, row, captured)) return false;
    captured.assertCurrent();
  }
  return true;
}
export async function reconcileOperationBudgetWork(database: Database, operationId: string | undefined, owner: AccountingOwner): Promise<void> {
  const { signal, assertCurrent: check } = captureAccountingOwner(database, owner);
  // Reuse this existing financial reconciler, not a provider/task recovery queue.
  // Only v1 attributed retained facts can reconstruct their original reporting
  // route. Legacy unattributed/receipt-less holds are never guessed or backfilled.
  const retained = database.query(`SELECT * FROM budget_request_reservations INDEXED BY idx_budget_requests_state
    WHERE state IN ('dispatched','unresolved') AND terminal_receipt_json IS NOT NULL AND model_invocation_json IS NOT NULL
    AND (? IS NULL OR json_extract(model_invocation_json,'$.operationId')=?)`).all(operationId ?? null, operationId ?? null) as BudgetRequestReservation[];
  for (const row of retained) await reconcileRetainedAccountingRow(database, row, { signal, assertCurrent: check });
  await admitSqliteWrite(database, () => {
    const terminals = (operationId !== undefined
      ? database.query('SELECT operation_id FROM service_effect_s02_commits WHERE operation_id=?').all(operationId)
      : database.query(`SELECT c.operation_id FROM service_effect_s01_chats chats
        CROSS JOIN budget_work w INDEXED BY idx_budget_work_chat_status
        CROSS JOIN service_effect_s02_commits c
        WHERE w.chat_jid=chats.chat_jid AND w.status='active' AND c.operation_id=substr(w.id,length('durable-operation:')+1)
        AND w.id='durable-operation:'||c.operation_id`).all()) as { operation_id: string }[];
    for (const terminal of terminals) {
      const id = operationBudgetWorkId(terminal.operation_id);
      if (getBudgetWork(id, database)?.status !== "active") continue;
      if (!database.query(`WITH RECURSIVE scope(id) AS (
        SELECT id FROM budget_work WHERE id=? UNION SELECT w.id FROM budget_work w JOIN scope s ON w.parent_work_id=s.id
      ) SELECT 1 FROM budget_request_reservations r JOIN scope s ON s.id=r.work_id WHERE r.state NOT IN ('settled','released') LIMIT 1`).get(id))
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
  }, check, signal, Number.POSITIVE_INFINITY, check);
}

/** Stored-identity host model requests. Exact background input policy supports
 * capped reservations; other native paths retain their existing cap denial.
 * SDK checkpoint identity reuses an exact stored outcome or definitely-unsent
 * binding. An unknown dispatched send remains held and cannot be resent.
 */
export async function reserveHostRequest(options: {
  database: Database; operationId: string; chatJid: string; authPath: string;
  model: Model<Api>; maxTokens?: number; executionKind?: "interactive" | "delegate" | "scheduled" | "side_prompt" | "background"; scheduledTaskId?: string;
  backgroundPolicy?:NativeBackgroundPolicy;
  /** Public running SDK checkpoint identity; caller/source guards remain required. */
  modelInvocation?: BudgetModelInvocation;
  usageSource?:'compaction';
  maintenanceWorkId?: string;
  /** Proven public generation owner, never a busy-chat guess. */
  maintenanceParentOperationId?: string;
  signal: AbortSignal; assertCurrent(): void;
  /** Database/lease lifetime only. Request cancellation cannot erase paid facts.
   * The backend must keep this owner alive while SDK close joins the request. */
  terminalOwner?: { signal: AbortSignal; assertCurrent(): void };
}) {
  const { database, model, signal, assertCurrent } = options;
  const originalOwner = options.terminalOwner;
  const capturedOwner = originalOwner && { signal: originalOwner.signal, assertCurrent: originalOwner.assertCurrent.bind(originalOwner) };
  const terminalOwner = () => {
    const owner = capturedOwner;
    if (!owner) throw Error('Terminal receipt owner unavailable');
    owner.signal.throwIfAborted();
    const checked: unknown = owner.assertCurrent();
    if (checked !== undefined) { void Promise.resolve(checked).catch(() => {}); throw Error('Accounting owner must be synchronous'); }
    if (getDb() !== database) throw Error('Terminal receipt database binding changed');
    return owner;
  };
  const modelInvocation = options.modelInvocation && structuredClone(options.modelInvocation);
  if (modelInvocation && modelInvocation.operationId !== options.operationId) throw new BudgetRequestError('conflict');
  const background=options.backgroundPolicy&&readNativeBackgroundPolicy(options.backgroundPolicy);
  if((options.executionKind==='background')!==!!background)throw Error('Background request policy required');
  const operationWork = options.maintenanceWorkId ?? operationBudgetWorkId(options.operationId);
  if (options.maintenanceParentOperationId && (!options.maintenanceWorkId || options.maintenanceParentOperationId !== options.operationId)) throw new BudgetRequestError('invalid_binding');
  const maintenanceParent = options.maintenanceParentOperationId ? operationBudgetWorkId(options.maintenanceParentOperationId) : undefined;
  const barrierWork = maintenanceParent ?? operationWork;
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
  const previous = modelInvocation ? findBudgetRequestByModelInvocation(modelInvocation, database) : null;
  // Recovering an exact stored fact is not a new outbound effect. Let each
  // paid sibling reconcile; tools/new sends/S02 still require the whole scope.
  const unenteredAccounting = new Error('Unentered request awaits retained accounting');
  const accountingReady = (excludeRequestId?: string) => {
    try {
      assertModelAccountingReady(barrierWork, database, excludeRequestId);
      if (modelInvocation) assertConversationAccountingReady(database, { domain: modelInvocation.domain,
        conversationId: modelInvocation.conversationId, chatJid: options.chatJid }, excludeRequestId);
    } catch (error) {
      // Only the pre-acquisition check can request another admission attempt.
      // An entered SQL callback, source failure or real cap denial is never retried.
      if (modelInvocation && !database.inTransaction && error instanceof RetainedAccountingPending
        && error.invocation.domain === modelInvocation.domain && hasSdkAccountingScope(database)) {
        const rootFor = accountingConversationRoots(database);
        if (rootFor(error.invocation.conversationId) === rootFor(modelInvocation.conversationId)) throw unenteredAccounting;
      }
      throw error;
    }
  };
  async function accountingAdmission<T>(attempt: () => Promise<T>): Promise<T> {
    for (;;) {
      try { return await attempt(); }
      catch (error) {
        if (error !== unenteredAccounting) throw error;
        const observer = { signal: AbortSignal.any([terminalOwner().signal, signal]), assertCurrent() {
          terminalOwner(); assertCurrent(); assertBackground(); signal.throwIfAborted();
        } };
        while (!await prepareConversationAccounting(database, modelInvocation!.domain, modelInvocation!.conversationId, observer)) {
          observer.assertCurrent(); await delay(1000, undefined, { signal: observer.signal });
        }
        observer.assertCurrent();
      }
    }
  }
  if (!previous?.terminal_receipt_json) await accountingAdmission(async () => accountingReady(previous?.id));
  if (modelInvocation && !previous && database.query(`SELECT 1 FROM budget_work w JOIN budget_request_reservations r ON r.work_id=w.id
    WHERE w.parent_work_id=? AND r.model_invocation_json IS NULL AND r.state IN ('reserved','dispatched','unresolved') LIMIT 1`).get(operationWork))
    throw new BudgetRequestError('budget_denied'); // Old unknown holds have no exact attempt attribution.
  const accountRef = readStoredProviderUsageAccountRef(model.provider, options.authPath);
  if(!accountRef){
    if (previous) throw new BudgetRequestError('conflict');
    if(background&&database.query('SELECT 1 FROM budget_caps WHERE enabled=1 LIMIT 1').get())throw new BudgetRequestError('budget_denied');
    return undefined;
  }
  const requested = boundHostRequestCost(model, options.maxTokens ?? model.maxTokens);
  // A smaller request hint is not proof that every provider enforces it. Fund
  // the full approved model output ceiling for this capped background port.
  const amount = background&&requested.amountMicros!==null?boundHostRequestCost(model,model.maxTokens):requested;
  if(amount.amountMicros===null && !previous){
    if(background&&database.query('SELECT 1 FROM budget_caps WHERE enabled=1 LIMIT 1').get())throw new BudgetRequestError('budget_denied');
    return undefined;
  }
  const id = previous?.id ?? randomUUID();
  const workId = `durable-request:${id}`;
  if (previous && (previous.work_id !== workId || previous.chat_jid !== options.chatJid || previous.provider_id !== model.provider
    || previous.model_id !== model.id || previous.account_ref !== accountRef
    || getBudgetWork(workId, database)?.parent_work_id !== operationWork
    || previous.state === 'reserved' && previous.amount_microusd !== amount.amountMicros)) throw new BudgetRequestError('conflict');
  const current = () => {
    assertCurrent();assertBackground(); signal.throwIfAborted();
    if (readStoredProviderUsageAccountRef(model.provider, options.authPath) !== accountRef) throw Error("Native request account changed");
  };
  // Pre-send writes wait under the caller lifetime; entered bodies are never replayed.
  const admissionTimeoutMs = Infinity;
  const requestCurrent = () => { terminalOwner(); current(); accountingReady(id); };
  if (!previous) await accountingAdmission(() => admitSqliteWrite(database, () => {
    const sidePrompt = database.query(`SELECT 1 FROM service_effect_s01_operations o
      JOIN service_effect_s01_sources s ON s.chat_jid=o.chat_jid AND s.source_seq=o.primary_source_seq
      WHERE o.operation_id=? AND o.chat_jid=? AND s.kind='internal' AND s.source_id LIKE 'side-prompt:%'`).get(options.operationId, options.chatJid);
    const existingSide = sidePrompt ? getBudgetWork(maintenanceParent ?? operationWork, database) : null;
    if (maintenanceParent) ensureBudgetWork({ id: maintenanceParent, chatJid: options.chatJid,
      executionKind: sidePrompt ? 'side_prompt' : options.scheduledTaskId ? 'scheduled' : 'interactive',
      parentWorkId: existingSide?.parent_work_id, scheduledTaskId: options.scheduledTaskId }, database);
    if (!background) ensureBudgetWork({ id: operationWork, chatJid: options.chatJid, executionKind: options.maintenanceWorkId || sidePrompt ? "side_prompt" : options.scheduledTaskId ? "scheduled" : "interactive",
      parentWorkId: maintenanceParent ?? existingSide?.parent_work_id, scheduledTaskId: options.scheduledTaskId }, database);
    ensureBudgetWork({ id: workId, chatJid: options.chatJid, executionKind: options.executionKind === "delegate" ? "delegate" : sidePrompt ? "side_prompt" : options.executionKind ?? "interactive", parentWorkId: operationWork }, database);
  }, requestCurrent, signal, admissionTimeoutMs, requestCurrent));
  const accounting = modelRequestAccounting({ authorise: requestCurrent, beforeAcquire: requestCurrent, admissionTimeoutMs, documentedFree: false }, database);
  const binding: BudgetRequestBinding = { id, workId, chatJid: options.chatJid, providerId: model.provider, modelId: model.id, accountRef,
    amountMicros: previous ? previous.amount_microusd : amount.amountMicros, ...(modelInvocation ? { modelInvocation } : {}) };
  let dispatchStarted = false;
  let terminalReceivedAt: string | undefined;
  const terminalPhysical = Object.freeze({ provider: binding.providerId, id: binding.modelId, api: model.api });
  // A rejected reservation may have committed before an ACK/storage failure.
  // Keep work active; never retire authority needed to reconcile that hold.
  try{if (!previous) await accountingAdmission(() => accounting.reserve(binding, signal));}
  catch(error){
    if(background&&error instanceof BudgetRequestError&&error.code==='budget_denied'){
      try{await admitSqliteWrite(database,()=>{if(!getBudgetRequest(binding.id,database))setBudgetWorkStatus(workId,'stopped',{boundary:'request_budget_blocked'},database);});}
      catch(cleanup){throw new AggregateError([error,cleanup],'Background budget rejection cleanup is uncertain',{cause:error});}
    }
    throw error;
  }
  const usageSource = options.usageSource ?? (options.maintenanceWorkId ? 'compaction' : 'assistant');
  let recoveredTerminal: AssistantMessage | undefined;
  if (previous) {
    const receipt = readBudgetTerminalReceipt(binding, database);
    if (receipt) {
      const payload = JSON.parse(receipt.bodyJson) as BudgetTerminalReceiptPayload; // Bound canonical envelope verified above.
      const decoded = decodeStoredTerminalOutcome(JSON.stringify(payload.projectedOutcome), terminalPhysical);
      await settleRetainedAccounting(database, binding, terminalOwner(), usageSource);
      current();
      recoveredTerminal = JSON.parse(JSON.stringify(decoded)) as AssistantMessage; // Validated JSON crosses SDK families.
    } else if (previous.state !== 'reserved') throw new BudgetRequestError('budget_denied');
  }
  // One detached safe receipt precedes the atomic charge/work transition. The
  // database/lease owner outlives caller/source cancellation until close joins.
  const retainTerminal = async (message: AssistantMessage) => {
    const owner = terminalOwner();
    const check = () => { terminalOwner(); };
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
  };
  return {
    id: binding.id, retainTerminal, recoveredTerminal,
    assertRecoveredCurrent() { terminalOwner(); current(); },
    async dispatch() {
      if (recoveredTerminal) throw new BudgetRequestError('invalid_state');
      await accountingAdmission(async () => requestCurrent());
      if (dispatchStarted) throw Error("Native request already dispatched");
      dispatchStarted = true;
      await accountingAdmission(() => accounting.dispatch(binding, signal));
      await accountingAdmission(async () => requestCurrent());
    },
    async settle(message: AssistantMessage) {
      await retainTerminal(message);
      await settleRetainedAccounting(database, binding, terminalOwner(), usageSource);
    },
    async abandon() {
      const owner = terminalOwner();
      // Readback may prove a committed transition after a lost ACK. Otherwise
      // mark a dispatched expense unresolved, never retry its charge or release
      // its receipt/hold. Settled/unresolved receipts need no cleanup write.
      if (readBudgetTerminalReceipt(binding, database) && getBudgetRequest(binding.id, database)?.state !== 'dispatched') return;
      await admitSqliteWrite(database, () => {
        const row = abandonBudgetRequest(binding, database), work = getBudgetWork(workId, database);
        if (row.state === 'released' && (work?.status === 'active' || work?.status === 'paused'))
          setBudgetWorkStatus(workId, 'stopped', { boundary: 'request_not_sent' }, database);
      }, () => { terminalOwner(); }, owner.signal);
    },
  };
}
