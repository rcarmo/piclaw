// Inactive dispatch seam. EF-S07/root scheduler owns claims, renewal,
// source acceptance, recurrence, terminal state and delivery. No queue or timer here.
import type { ScheduledRunLease, ScheduledRunStore } from "../../../runtime/src/service-effects/contracts/scheduled-run-store.js";

export interface ScheduledAgentInput {
  readonly requestId: string;
  readonly chatJid: string;
  readonly sourceSeq: number;
  readonly operationId: string;
  readonly payloadRef: string;
  readonly modelLabel: string | null;
  readonly signal: AbortSignal;
}

export type CurrentScheduledTask = { revision: number; status: string };
export type ReadCurrentTask = (taskId: string) => Promise<CurrentScheduledTask | null>;

/** Construct only from a trusted scheduler claim. Host dispatch must bind this
 * identity to its durable conversation/submission and cancel actual WORK when
 * signal aborts (cancelling Submission.wait is not work cancellation).
 * Host renewal failure/shutdown must call fence(); check() is observational,
 * not an atomic provider/effect fence or an independent lease authority.
 * currentTask must read the LIVE authoritative task head on every call, not an
 * occurrence snapshot or memoized revision. These sequential reads are bounded
 * admission/result checks, not an atomic task-head/provider dispatch fence. */
export function createScheduledRunDispatch<T>(store: ScheduledRunStore, lease: ScheduledRunLease,
  currentTask: ReadCurrentTask, dispatch: (input: ScheduledAgentInput) => Promise<T>,
  now = () => new Date().toISOString()) {
  if (lease.task.kind !== "agent" || lease.task.executionRepeatability !== "agent_source")
    throw new Error("Scheduled durable dispatch requires an agent occurrence");
  // Do not retain caller-mutable lease/snapshot objects across awaits.
  const { runId, workerId, attempt, taskRevision, taskId } = lease.record;
  const { chatJid, payloadRef, modelLabel } = lease.task;
  const controller = new AbortController();
  let binding: { sourceSeq: number; operationId: string } | undefined;
  let pending: Promise<T> | undefined;
  const fence = () => controller.abort(new Error("Scheduled occurrence fenced"));
  async function check(): Promise<ScheduledAgentInput> {
    controller.signal.throwIfAborted();
    try {
      const current = await store.get(runId);
      const task = await currentTask(taskId);
      controller.signal.throwIfAborted();
      if (!task || task.revision !== taskRevision || task.status !== "active")
        throw new Error("Scheduled task head no longer eligible");
      if (!current.ok) throw new Error("Scheduled occurrence unavailable");
      const record = current.value;
      if (!record || record.state !== "source_bound" || record.runId !== runId || record.taskId !== taskId
        || record.workerId !== workerId || record.attempt !== attempt || record.taskRevision !== taskRevision
        || !record.leaseExpiresAt || record.leaseExpiresAt <= now()
        || record.acceptedSourceSeq === null || record.operationId === null)
        throw new Error("Scheduled occurrence no longer owned");
      if (binding && (binding.sourceSeq !== record.acceptedSourceSeq || binding.operationId !== record.operationId))
        throw new Error("Scheduled occurrence source changed");
      binding = { sourceSeq: record.acceptedSourceSeq, operationId: record.operationId };
      return { requestId: runId, chatJid, payloadRef, modelLabel, ...binding, signal: controller.signal };
    } catch {
      fence();
      throw controller.signal.reason;
    }
  }
  return { check, fence, signal: controller.signal,
    // Duplicate calls share the same execution, not another durable input. Durable
    // requestId reconciliation remains the host callback's responsibility on reopen.
    run(): Promise<T> {
      return pending ??= (async () => {
        const input = await check();
        controller.signal.throwIfAborted();
        const result = await dispatch(input);
        await check(); // Late completion cannot escape a revoked occurrence.
        return result;
      })();
    },
  };
}
