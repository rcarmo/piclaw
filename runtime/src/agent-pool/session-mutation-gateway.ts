/**
 * Per-chat ownership and serialization boundary for persistent AgentSession mutations.
 *
 * Durable work must present the exact active operation owner. Legacy work is
 * admitted only while no durable operation owns the chat. Abort is the sole
 * out-of-band exception: it compares the same ownership immediately before the
 * effect, but does not wait behind the mutation it is intended to interrupt.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import {
  compareChatOperationOwner,
  getChatOperation,
  type ChatOperationMismatch,
  type ChatOperationOwner,
  type ChatOperationState,
} from "../db/chat-operations.js";

export const SESSION_MUTATION_CLASSES = [
  "prompt",
  "compaction",
  "rotation",
  "control",
  "model",
  "thinking",
  "session",
  "session_tree",
  "recovery",
  "queue",
  "lifecycle",
  "abort",
] as const;

export type SessionMutationClass = (typeof SESSION_MUTATION_CLASSES)[number];

export type SessionMutationAccess =
  | { scope: "operation"; owner: ChatOperationOwner }
  | { scope: "legacy" };

export interface SessionMutationRequest {
  operationOwner?: ChatOperationOwner;
}

export type SessionMutationRejectionReason = ChatOperationMismatch
  | "legacy_conflict"
  | "operation_cancelled"
  | "operation_intent_required"
  | "operation_queue_behavior_mismatch"
  | "operation_mutation_forbidden"
  | "active_mutation_mismatch";

export class SessionMutationRejectedError extends Error {
  readonly name = "SessionMutationRejectedError";

  constructor(
    readonly chatJid: string,
    readonly mutation: SessionMutationClass,
    readonly reason: SessionMutationRejectionReason,
  ) {
    super(`Session mutation ${mutation} rejected for ${chatJid}: ${reason}`);
  }
}

interface SessionMutationContext {
  chatJid: string;
  access: SessionMutationAccess;
  laneId: symbol;
}

interface ActiveSessionMutation {
  access: SessionMutationAccess;
  mutation: Exclude<SessionMutationClass, "abort">;
  laneId: symbol;
}

export interface SessionMutationGatewayOptions {
  getOperation?: (chatJid: string) => ChatOperationState | null;
}

export function sessionMutationAccess(request: SessionMutationRequest = {}): SessionMutationAccess {
  return request.operationOwner
    ? { scope: "operation", owner: request.operationOwner }
    : { scope: "legacy" };
}

const OPERATION_MUTATION_CLASSES = new Set<SessionMutationClass>([
  "prompt",
  "compaction",
  "rotation",
  "recovery",
  "abort",
]);

function sameOwner(left: ChatOperationOwner, right: ChatOperationOwner): boolean {
  return left.operationId === right.operationId
    && left.sourceSeq === right.sourceSeq
    && left.phase === right.phase
    && left.generation === right.generation;
}

/** One serialized persistent-session mutation lane per chat. */
export class SessionMutationGateway {
  private readonly context = new AsyncLocalStorage<SessionMutationContext>();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly queueTails = new Map<string, Promise<void>>();
  private readonly activeMutationByChat = new Map<string, ActiveSessionMutation>();
  private readonly queueAdmissionOpen = new Set<string>();
  private readonly getOperation: (chatJid: string) => ChatOperationState | null;

  constructor(options: SessionMutationGatewayOptions = {}) {
    this.getOperation = options.getOperation ?? getChatOperation;
  }

  currentAccess(chatJid: string): SessionMutationAccess | null {
    return this.getLiveInheritedContext(chatJid)?.access ?? null;
  }

  hasPendingQueue(chatJid: string): boolean {
    return this.queueTails.has(chatJid);
  }

  async run<T>(
    chatJid: string,
    mutation: Exclude<SessionMutationClass, "abort">,
    access: SessionMutationAccess,
    action: () => Promise<T> | T,
  ): Promise<T> {
    const inherited = this.getLiveInheritedContext(chatJid);
    if (inherited) {
      if (access.scope !== inherited.access.scope
        || (access.scope === "operation"
          && inherited.access.scope === "operation"
          && !sameOwner(access.owner, inherited.access.owner))) {
        throw new SessionMutationRejectedError(chatJid, mutation, "generation_mismatch");
      }
      this.assertAccess(chatJid, mutation, access);
      const previous = this.activeMutationByChat.get(chatJid);
      const active: ActiveSessionMutation = { access, mutation, laneId: inherited.laneId };
      this.activeMutationByChat.set(chatJid, active);
      try {
        return await action();
      } finally {
        if (this.activeMutationByChat.get(chatJid) === active) {
          if (previous) this.activeMutationByChat.set(chatJid, previous);
          else this.activeMutationByChat.delete(chatJid);
        }
      }
    }

    // Fail fast instead of waiting behind an operation the caller cannot own.
    this.assertAccess(chatJid, mutation, access);

    const previous = this.tails.get(chatJid) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.tails.set(chatJid, tail);

    await previous.catch(() => undefined);
    try {
      // Ownership can change while this mutation waits behind the prior one.
      this.assertAccess(chatJid, mutation, access);
      const laneId = Symbol(chatJid);
      const active: ActiveSessionMutation = { access, mutation, laneId };
      this.activeMutationByChat.set(chatJid, active);
      if (mutation === "prompt") this.queueAdmissionOpen.add(chatJid);
      try {
        return await this.context.run({ chatJid, access, laneId }, action);
      } finally {
        if (mutation === "prompt") {
          this.queueAdmissionOpen.delete(chatJid);
          await this.queueTails.get(chatJid)?.catch(() => undefined);
        }
        if (this.activeMutationByChat.get(chatJid) === active) this.activeMutationByChat.delete(chatJid);
      }
    } finally {
      release();
      if (this.tails.get(chatJid) === tail) {
        void tail.finally(() => {
          if (this.tails.get(chatJid) === tail) this.tails.delete(chatJid);
        });
      }
    }
  }

  async runInheritedOrLegacy<T>(
    chatJid: string,
    mutation: Exclude<SessionMutationClass, "abort">,
    action: () => Promise<T> | T,
  ): Promise<T> {
    return this.run(chatJid, mutation, this.currentAccess(chatJid) ?? { scope: "legacy" }, action);
  }

  async compareAndActAbort<T>(
    chatJid: string,
    access: SessionMutationAccess,
    action: () => Promise<T> | T,
  ): Promise<T> {
    this.assertAccess(chatJid, "abort", access);
    this.assertActiveOccupant(chatJid, "abort", access);
    const active = this.activeMutationByChat.get(chatJid)!;
    return await this.context.run({ chatJid, access, laneId: active.laneId }, action);
  }

  /**
   * Queue one steer into the exact operation currently occupying the prompt
   * lane without waiting behind that prompt. Durable registration runs first;
   * ownership and lane occupancy are then compared again immediately before
   * the SDK queue effect.
   */
  async compareAndActQueue<T, R>(
    chatJid: string,
    access: SessionMutationAccess,
    beforeQueue: () => R,
    action: (registration: R) => Promise<T> | T,
    requiresQueueEffect: (registration: R) => boolean = () => true,
  ): Promise<T> {
    this.assertQueueAdmission(chatJid, access);
    const previous = this.queueTails.get(chatJid) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.queueTails.set(chatJid, tail);
    await previous.catch(() => undefined);
    try {
      this.assertQueueAdmission(chatJid, access);
      const registration = beforeQueue();
      if (requiresQueueEffect(registration)) this.assertQueueEffect(chatJid, access);
      const active = this.activeMutationByChat.get(chatJid)!;
      return await this.context.run({ chatJid, access, laneId: active.laneId }, () => action(registration));
    } finally {
      release();
      if (this.queueTails.get(chatJid) === tail) {
        void tail.finally(() => {
          if (this.queueTails.get(chatJid) === tail) this.queueTails.delete(chatJid);
        });
      }
    }
  }

  private assertQueueAdmission(chatJid: string, access: SessionMutationAccess): void {
    this.assertOutOfBandQueueAccess(chatJid, access);
    this.assertActiveOccupant(chatJid, "queue", access, "prompt");
    if (!this.queueAdmissionOpen.has(chatJid)) {
      throw new SessionMutationRejectedError(chatJid, "queue", "active_mutation_mismatch");
    }
  }

  /** Exact synchronous guard invoked after runtime acquisition and immediately before SDK queueing. */
  assertQueueEffect(chatJid: string, access: SessionMutationAccess): void {
    this.assertOutOfBandQueueAccess(chatJid, access);
    this.assertActiveOccupant(chatJid, "queue", access, "prompt");
  }

  /**
   * Validate the durable owner, persist cancellation synchronously, then abort
   * only the lane occupant that still has that exact pre-cancellation owner.
   * The callback boundary prevents post-cancellation generation drift from
   * becoming a reusable ownership-check bypass.
   */
  async cancelAndActAbort<T, C>(
    chatJid: string,
    access: SessionMutationAccess,
    cancel: () => C,
    cancellationApplied: (result: C) => boolean,
    action: () => Promise<T> | T,
  ): Promise<{ cancellation: C; acted: boolean; result?: T }> {
    this.assertAccess(chatJid, "abort", access);
    const cancellation = cancel();
    if (!cancellationApplied(cancellation)) return { cancellation, acted: false };

    const active = this.activeMutationByChat.get(chatJid);
    if (!active || !this.isSameAccess(active.access, access)) {
      return { cancellation, acted: false };
    }
    const result = await this.context.run({ chatJid, access, laneId: active.laneId }, action);
    return { cancellation, acted: true, result };
  }

  private getLiveInheritedContext(chatJid: string): SessionMutationContext | null {
    const inherited = this.context.getStore();
    if (!inherited || inherited.chatJid !== chatJid) return null;
    return this.activeMutationByChat.get(chatJid)?.laneId === inherited.laneId ? inherited : null;
  }

  private isSameAccess(left: SessionMutationAccess, right: SessionMutationAccess): boolean {
    if (left.scope !== right.scope) return false;
    return left.scope === "legacy" || (right.scope === "operation" && sameOwner(left.owner, right.owner));
  }

  private assertActiveOccupant(
    chatJid: string,
    mutation: SessionMutationClass,
    access: SessionMutationAccess,
    requiredMutation?: ActiveSessionMutation["mutation"],
  ): void {
    const active = this.activeMutationByChat.get(chatJid);
    if (!active || !this.isSameAccess(active.access, access) || (requiredMutation && active.mutation !== requiredMutation)) {
      throw new SessionMutationRejectedError(chatJid, mutation, "active_mutation_mismatch");
    }
  }

  private assertOutOfBandQueueAccess(chatJid: string, access: SessionMutationAccess): void {
    if (access.scope === "legacy") {
      this.assertAccess(chatJid, "queue", access);
      return;
    }
    const active = this.getOperation(chatJid);
    const comparison = compareChatOperationOwner(active, access.owner);
    if (!comparison.ok) throw new SessionMutationRejectedError(chatJid, "queue", comparison.reason);
    if (active!.cancellation) throw new SessionMutationRejectedError(chatJid, "queue", "operation_cancelled");
  }

  private assertAccess(
    chatJid: string,
    mutation: SessionMutationClass,
    access: SessionMutationAccess,
  ): void {
    const active = this.getOperation(chatJid);
    if (access.scope === "legacy") {
      if (active) throw new SessionMutationRejectedError(chatJid, mutation, "legacy_conflict");
      return;
    }
    if (!OPERATION_MUTATION_CLASSES.has(mutation)) {
      throw new SessionMutationRejectedError(chatJid, mutation, "operation_mutation_forbidden");
    }
    const comparison = compareChatOperationOwner(active, access.owner);
    if (!comparison.ok) throw new SessionMutationRejectedError(chatJid, mutation, comparison.reason);
  }
}
