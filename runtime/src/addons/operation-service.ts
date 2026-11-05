import { createHash, randomUUID } from "node:crypto";
import { readAccessConfig } from "../core/config-access.js";
import { getExecutionIdentity } from "../core/execution-context.js";
import {
  admitAddonOperation,
  listAddonOperations,
  appendOperationInput,
  listRecoverableAddonOperations,
  operationSnapshot,
  readAddonOperation,
  readAddonOperationEvents,
  readAddonOperationInputSequence,
  transitionAddonOperation,
} from "../db/addon-operations.js";
import {
  OperationAccessError,
  operationGrantKey,
  TERMINAL_OPERATION_STATUSES,
  type OperationExecution,
  type OperationGrant,
  type OperationHost,
  type OperationInput,
  type OperationPrincipal,
  type OperationRecord,
  type OperationResult,
  type OperationSnapshot,
} from "./operation-contracts.js";

function singleUser(): void {
  const identity = getExecutionIdentity();
  if (
    readAccessConfig().mode !== "single-user" ||
    (identity && identity.mode !== "single-user")
  )
    throw new OperationAccessError();
}
function identifier(value: unknown, max = 128): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > max ||
    !/^[a-zA-Z0-9_.:-]+$/.test(value)
  )
    throw new OperationAccessError();
  return value;
}
function validateGrant(value: OperationGrant, target: string): OperationGrant {
  if (
    value.target !== target ||
    !value.revision ||
    !Array.isArray(value.allowedTools) ||
    value.allowedTools.length > 64 ||
    value.allowedTools.some(
      (t) => typeof t !== "string" || !t || t.length > 128,
    ) ||
    !Number.isSafeInteger(value.timeoutMs) ||
    value.timeoutMs < 100 ||
    value.timeoutMs > 3_600_000 ||
    !Number.isSafeInteger(value.maxToolCalls) ||
    value.maxToolCalls < 0 ||
    value.maxToolCalls > 100
  )
    throw new OperationAccessError();
  return structuredClone(value);
}
function cleanResult(result: OperationResult): OperationResult {
  if (
    ![
      "completed",
      "failed",
      "cancelled",
      "input_required",
    ].includes(result.status)
  )
    throw new Error("Invalid operation result");
  if (
    result.output !== undefined &&
    (typeof result.output !== "string" ||
      Buffer.byteLength(result.output) > 256 * 1024)
  )
    throw new Error("Operation output limit");
  if (result.reason !== undefined && !/^[a-z0-9_]{1,64}$/.test(result.reason))
    throw new Error("Invalid operation reason");
  return structuredClone(result);
}

/** Host-owned service; adapters receive only a bound principal view.
 * No transport/SDK types and no fallback to unscoped enqueue.
 * The host executor must enforce its grant and use a dedicated execution identity.
 */
export class AddonOperationService {
  private readonly running = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private closed = false;
  private subscriptions = 0;
  constructor(private readonly host: OperationHost) {}

  bind(principalInput: OperationPrincipal) {
    singleUser();
    const principal = Object.freeze({
      addonId: identifier(principalInput.addonId, 64),
      principalId: identifier(principalInput.principalId),
    });
    return Object.freeze({
      version: 1 as const,
      admit: (input: OperationInput) => this.admit(principal, input),
      get: (id: string) => this.get(principal, id),
      events: (id: string, after = 0) => this.events(principal, id, after),
      cancel: (id: string) => this.cancel(principal, id),
      resume: (id: string) => this.resume(principal, id),
      continue: (id: string, text: string) =>
        this.continue(principal, id, text),
      list: (after: string | null = null, limit = 50) =>
        this.list(principal, after, limit),
      subscribe: (id: string, after = 0, signal?: AbortSignal) =>
        this.subscribe(principal, id, after, signal),
    });
  }
  private ensureOpen() {
    singleUser();
    if (this.closed) throw new OperationAccessError();
  }
  private async owned(
    principal: OperationPrincipal,
    id: string,
    action: "read" | "cancel" | "admit" = "read",
  ): Promise<OperationRecord> {
    this.ensureOpen();
    const record = readAddonOperation(identifier(id));
    if (
      !record ||
      record.addonId !== principal.addonId ||
      record.principalId !== principal.principalId
    )
      throw new OperationAccessError();
    const decision = await this.host.authorize(
      principal,
      record.target,
      action,
    );
    this.ensureOpen();
    if (decision.decision !== "allow") throw new OperationAccessError();
    return record;
  }
  private async admit(principal: OperationPrincipal, input: OperationInput) {
    this.ensureOpen();
    const target = identifier(input.target),
      key = identifier(input.idempotencyKey);
    if (
      typeof input.text !== "string" ||
      !input.text.trim() ||
      Buffer.byteLength(input.text) > 32 * 1024
    )
      throw new OperationAccessError();
    const text = input.text;
    const decision = await this.host.authorize(principal, target, "admit");
    this.ensureOpen();
    if (decision.decision !== "allow")
      return { created: false, admission: decision.decision, operation: null };
    const grant = validateGrant(decision.grant, target);
    const id = randomUUID(),
      now = new Date().toISOString();
    const result = admitAddonOperation({
      id,
      addonId: principal.addonId,
      principalId: principal.principalId,
      idempotencyKey: key,
      inputHash: createHash("sha256")
        .update(JSON.stringify([target, text]))
        .digest("hex"),
      text,
      target,
      grant,
      chatJid: `operation:${id}`,
      workId: `operation:${id}`,
      status: "queued",
      sequence: 1,
      createdAt: now,
      updatedAt: now,
      output: null,
      reason: null,
    });
    if (result.created) this.start(result.record.id);
    return {
      created: result.created,
      admission: "allow" as const,
      operation: operationSnapshot(result.record),
    };
  }
  private async get(
    principal: OperationPrincipal,
    id: string,
  ): Promise<OperationSnapshot> {
    await this.owned(principal, id);
    const current = readAddonOperation(id);
    if (!current) throw new OperationAccessError();
    return operationSnapshot(current);
  }
  private async events(
    principal: OperationPrincipal,
    id: string,
    after: number,
  ) {
    if (!Number.isSafeInteger(after) || after < 0)
      throw new OperationAccessError();
    await this.owned(principal, id);
    const snapshot = operationSnapshot(readAddonOperation(id)!);
    const events = readAddonOperationEvents(id, after);
    return {
      snapshot,
      events,
      gap:
        after > snapshot.sequence ||
        (after > 0 && events.length > 0 && events[0].sequence > after + 1),
    };
  }
  private async list(
    principal: OperationPrincipal,
    after: string | null,
    limit: number,
  ) {
    this.ensureOpen();
    if (after !== null) identifier(after);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new OperationAccessError();
    const rows = listAddonOperations(principal, after, limit + 1),
      page = rows.slice(0, limit);
    const operations: OperationSnapshot[] = [];
    for (const row of page) {
      try {
        await this.owned(principal, row.id);
        operations.push(operationSnapshot(row));
      } catch (error) {
        if (!(error instanceof OperationAccessError)) throw error;
      }
    }
    return {
      operations,
      nextCursor: rows.length > limit ? page.at(-1)!.id : null,
    };
  }
  private async *subscribe(
    principal: OperationPrincipal,
    id: string,
    after: number,
    signal?: AbortSignal,
  ) {
    this.ensureOpen();
    if (this.subscriptions >= 64)
      throw new Error("Operation subscription quota exceeded.");
    this.subscriptions++;
    try {
      const initial = await this.events(principal, id, after);
      signal?.throwIfAborted();
      yield { type: "snapshot" as const, ...initial };
      let cursor = initial.snapshot.sequence;
      if (TERMINAL_OPERATION_STATUSES.has(initial.snapshot.status)) return;
      while (!this.closed) {
        signal?.throwIfAborted();
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            reject(signal?.reason ?? new Error("Subscription cancelled"));
          };
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
          }, 100);
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
        });
        const update = await this.events(principal, id, cursor);
        for (const event of update.events) {
          cursor = event.sequence;
          yield { type: "event" as const, event };
        }
        if (TERMINAL_OPERATION_STATUSES.has(update.snapshot.status)) return;
      }
    } finally {
      this.subscriptions--;
    }
  }
  private async continue(
    principal: OperationPrincipal,
    id: string,
    text: string,
  ) {
    const previous = await this.owned(principal, id, "admit");
    if (
      typeof text !== "string" ||
      !text.trim() ||
      Buffer.byteLength(text) > 32 * 1024
    )
      throw new OperationAccessError();
    const decision = await this.host.authorize(
      principal,
      previous.target,
      "admit",
    );
    this.ensureOpen();
    if (
      decision.decision !== "allow" ||
      operationGrantKey(validateGrant(decision.grant, previous.target)) !==
        operationGrantKey(previous.grant)
    )
      throw new OperationAccessError();
    const queued = appendOperationInput(id, text);
    if (queued) this.start(id);
    return {
      resumed: !!queued,
      operation: operationSnapshot(queued || readAddonOperation(id)!),
    };
  }
  private async cancel(principal: OperationPrincipal, id: string) {
    await this.owned(principal, id, "cancel");
    const record = readAddonOperation(id)!;
    if (TERMINAL_OPERATION_STATUSES.has(record.status))
      return {
        outcome:
          record.status === "cancelled" ? "cancelled" : "not_cancellable",
        operation: operationSnapshot(record),
      };
    if (
      [
        "queued",
        "approval_required",
        "budget_blocked",
        "input_required",
      ].includes(record.status)
    ) {
      const cancelled =
        transitionAddonOperation(
          id,
          [record.status],
          "cancelled",
          null,
          "caller_cancelled",
        ) || readAddonOperation(id)!;
      return {
        outcome:
          cancelled.status === "cancelled" ? "cancelled" : "not_cancellable",
        operation: operationSnapshot(cancelled),
      };
    }
    const owned = this.running.get(id);
    if (!owned)
      return {
        outcome: "not_cancellable",
        operation: operationSnapshot(record),
      };
    const updated =
      transitionAddonOperation(
        id,
        ["working"],
        "cancel_requested",
        null,
        "caller_cancelled",
      ) || record;
    owned.controller.abort(new Error("operation_cancelled"));
    return { outcome: "requested", operation: operationSnapshot(updated) };
  }
  private async resume(principal: OperationPrincipal, id: string) {
    this.ensureOpen();
    const previous = readAddonOperation(id);
    if (
      !previous ||
      previous.addonId !== principal.addonId ||
      previous.principalId !== principal.principalId
    )
      throw new OperationAccessError();
    // Historical financial pauses carry no current execution/resume authority.
    if (previous.status !== "approval_required")
      return { resumed: false, operation: await this.get(principal, id) };
    const decision = await this.host.authorize(
      principal,
      previous.target,
      "admit",
    );
    this.ensureOpen();
    if (decision.decision !== "allow")
      return { resumed: false, admission: decision.decision, operation: null };
    const currentGrant = validateGrant(decision.grant, previous.target);
    // Policy revisions require fresh operator reconciliation; never silently widen.
    if (operationGrantKey(currentGrant) !== operationGrantKey(previous.grant))
      throw new OperationAccessError();
    const queued = transitionAddonOperation(id, [previous.status], "queued");
    if (queued) this.start(id);
    return {
      resumed: !!queued,
      operation: operationSnapshot(queued || readAddonOperation(id)!),
    };
  }
  private start(id: string): void {
    if (this.closed || this.running.has(id)) return;
    const controller = new AbortController();
    // Defer execution until the admission transaction and running slot are committed.
    const promise = Promise.resolve()
      .then(() => this.execute(id, controller))
      .finally(() => {
        this.running.delete(id);
        if (!this.closed && readAddonOperation(id)?.status === "queued")
          this.start(id);
      });
    this.running.set(id, { controller, promise });
  }
  private async execute(
    id: string,
    controller: AbortController,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined,inputSequence:number|undefined;
    try {
      const record = readAddonOperation(id);
      if (!record || record.status !== "queued" || this.closed) return;
      inputSequence=readAddonOperationInputSequence(id)??undefined;if(inputSequence===undefined)throw Error('Operation input identity unavailable');
      singleUser();
      const principal = {
        addonId: record.addonId,
        principalId: record.principalId,
      };
      const admission = await this.host.authorize(
        principal,
        record.target,
        "admit",
      );
      if (this.closed) return;
      singleUser();
      if (admission.decision !== "allow") {
        transitionAddonOperation(
          id,
          ["queued"],
          admission.decision,
          null,
          "admission_changed",
          inputSequence,
        );
        return;
      }
      const grant = validateGrant(admission.grant, record.target);
      if (operationGrantKey(grant) !== operationGrantKey(record.grant)) {
        transitionAddonOperation(
          id,
          ["queued"],
          "rejected",
          null,
          "grant_changed",
          inputSequence,
        );
        return;
      }
      const working = transitionAddonOperation(id, ["queued"], "working",null,null,inputSequence);
      if (!working) return;
      timer = setTimeout(
        () => controller.abort(new Error("operation_timeout")),
        grant.timeoutMs,
      );
      const input: OperationExecution = {
        operationId: id,
        inputSequence,
        chatJid: record.chatJid,
        workId: record.workId,
        text: record.text,
        principal: Object.freeze(principal),
        grant: Object.freeze(grant),
        signal: controller.signal,
      };
      const result = cleanResult(await this.host.execute(input));
      // A requested cancel is not final cancellation: the executor may have completed first.
      transitionAddonOperation(
        id,
        ["working", "cancel_requested"],
        result.status,
        result.output ?? null,
        result.reason ?? null,
        inputSequence,
      );
    } catch {
      // Provider/adapter exception details are not safe public output.
      transitionAddonOperation(
        id,
        ["queued", "working", "cancel_requested"],
        "failed",
        null,
        "execution_failed",
        inputSequence,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private startRecovery(id:string):void{
    if(this.closed||this.running.has(id))return;
    const controller=new AbortController();
    const promise=Promise.resolve().then(async()=>{
      let inputSequence:number|undefined;
      try{
        if(this.closed)return;singleUser();
        const record=readAddonOperation(id);if(!record||!['working','cancel_requested'].includes(record.status))return;
        inputSequence=readAddonOperationInputSequence(id)??undefined;if(inputSequence===undefined)throw Error('Recovery input epoch unavailable');
        const result=await this.host.recover!({operationId:id,inputSequence,chatJid:record.chatJid,workId:record.workId,text:record.text,
          principal:Object.freeze({addonId:record.addonId,principalId:record.principalId}),grant:Object.freeze(structuredClone(record.grant)),signal:controller.signal});
        const known=result&&cleanResult(result);
        transitionAddonOperation(id,['working','cancel_requested'],known?.status??'failed',known?.output??null,known?.reason??(known?null:'interrupted_execution_unknown'),inputSequence);
      }catch{
        // Missing/uncertain native evidence is not permission to execute again.
        transitionAddonOperation(id,['working','cancel_requested'],'failed',null,'interrupted_execution_unknown',inputSequence);
      }
    }).finally(()=>{this.running.delete(id);});
    this.running.set(id,{controller,promise});
  }
  /** After restart, reconcile existing native receipts without dispatch. Legacy
   * or uncertain work keeps its non-replay interrupted outcome. */
  recover(): number {
    this.ensureOpen();
    let count = 0;
    for (const record of listRecoverableAddonOperations()) {
      if (this.running.has(record.id)) continue;
      if (record.status === "queued") this.start(record.id);
      else if(this.host.recover)this.startRecovery(record.id);
      else
        transitionAddonOperation(
          record.id,
          [record.status],
          "failed",
          null,
          "interrupted_execution_unknown",
        );
      count++;
    }
    return count;
  }
  async waitForIdle(): Promise<void> {
    while (this.running.size)
      await Promise.all([...this.running.values()].map((r) => r.promise));
  }
  /** Do not fake cancelled states if an executor cannot confirm termination. */
  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    for (const r of this.running.values())
      r.controller.abort(new Error("runtime_shutdown"));
  }
}
