/** Protocol-neutral operations. Policy and execution dependencies are host-owned. */
export type OperationStatus =
  | "queued"
  | "working"
  | "cancel_requested"
  | "approval_required"
  | "input_required"
  | "budget_blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "rejected";
export const TERMINAL_OPERATION_STATUSES = new Set<OperationStatus>([
  "completed",
  "failed",
  "cancelled",
  "rejected",
]);
export interface OperationPrincipal {
  addonId: string;
  principalId: string;
}
export interface OperationInput {
  target: string;
  idempotencyKey: string;
  text: string;
}
/** Returned only by trusted host policy; never deserialize from wire/model input. */
export interface OperationGrant {
  revision: string;
  target: string;
  allowedTools: string[];
  timeoutMs: number;
  maxToolCalls: number;
  /** Historical attribution only; never required for grants or execution. */
  parentWorkId?: string | null;
}
/** Only actual permission/resource fields participate in grant identity. */
export function operationGrantKey(grant: OperationGrant): string {
  return JSON.stringify([grant.revision,grant.target,[...grant.allowedTools].sort(),grant.timeoutMs,grant.maxToolCalls]);
}
export type OperationAdmission =
  | { decision: "allow"; grant: OperationGrant }
  | { decision: "approval_required" | "rejected" };
export interface OperationSnapshot {
  id: string;
  target: string;
  workId: string;
  status: OperationStatus;
  sequence: number;
  createdAt: string;
  updatedAt: string;
  output: string | null;
  reason: string | null;
}
export interface OperationRecord extends OperationSnapshot {
  addonId: string;
  principalId: string;
  idempotencyKey: string;
  inputHash: string;
  text: string;
  grant: OperationGrant;
  chatJid: string;
}
export interface OperationEvent {
  sequence: number;
  snapshot: OperationSnapshot;
}
export interface OperationExecution {
  operationId: string;
  /** Owner-captured epoch; a constraint, never caller spending authority. */
  inputSequence?:number;
  chatJid: string;
  workId: string;
  text: string;
  principal: Readonly<OperationPrincipal>;
  grant: Readonly<OperationGrant>;
  signal: AbortSignal;
}
export interface OperationResult {
  status:
    "completed" | "failed" | "cancelled" | "input_required";
  /** Public final text only. Never include hidden reasoning, prompts or raw tool logs. */
  output?: string;
  /** Machine-readable host reason, not arbitrary provider exception text. */
  reason?: string;
}
export interface OperationHost {
  authorize(
    principal: Readonly<OperationPrincipal>,
    target: string,
    action: "admit" | "read" | "cancel",
  ): Promise<OperationAdmission> | OperationAdmission;
  execute(input: OperationExecution): Promise<OperationResult>;
  /** Observe/settle existing native receipts only. Null retains unknown outcome;
   * this is never permission to resubmit working input. */
  recover?(input:OperationExecution):Promise<OperationResult|null>;
}
export class OperationAccessError extends Error {
  constructor() {
    super("Operation unavailable.");
    this.name = "OperationAccessError";
  }
}
export class OperationConflictError extends Error {
  constructor() {
    super("Operation key conflicts with a different request.");
    this.name = "OperationConflictError";
  }
}
