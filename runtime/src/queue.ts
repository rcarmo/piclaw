/**
 * queue.ts – Lane-aware execution queue with retry for agent runs.
 *
 * Ensures only one task runs at a time per logical lane (for example one chat),
 * while allowing different lanes to make progress in parallel. Failed tasks are
 * retried with exponential back-off up to DEFAULT_MAX_RETRIES times.
 * Items can be deduplicated by an optional string `id` (useful for scheduled
 * tasks that shouldn't stack up).
 *
 * Consumers:
 *   - runtime.ts creates a single AgentQueue and passes it to the router
 *     and task scheduler.
 *   - router.ts calls enqueue() for each inbound message that needs processing.
 *   - task-scheduler.ts calls enqueueTask() for due scheduled tasks.
 *   - channels/web.ts calls enqueue() for web channel interactions.
 */

import { DEFAULT_BASE_RETRY_MS, DEFAULT_MAX_RETRIES, getRetryDelay, shouldRetry } from "./queue/retry-policy.js";
import { createLogger } from "./utils/logger.js";

const log = createLogger("queue");
const DEFAULT_LANE_KEY = "__default__";

/** A sealed queue still owns accepted work and cannot certify quiescence. */
export class QueueShutdownIncompleteError extends Error {
  constructor(message = "Queue shutdown retains accepted work") { super(message); this.name = "QueueShutdownIncompleteError"; }
}

/** The active-task join exceeded its deadline; late completion is not certification. */
export class QueueShutdownTimeoutError extends QueueShutdownIncompleteError {
  constructor(readonly timeoutMs: number) {
    super(`Queue shutdown timed out after ${timeoutMs}ms`);
    this.name = "QueueShutdownTimeoutError";
  }
}

/** New admission is forbidden permanently once migration starts. */
export class MigrationAdmissionClosedError extends Error {
  constructor() { super("Queue admission is permanently sealed for migration"); this.name = "MigrationAdmissionClosedError"; }
}

/** Queue-local capability only; does not certify persisted sources or global ownership. */
export interface QueueMigrationDrain {
  readonly joined: Promise<void>;
  assertSealedAndDrained(): void;
  /** Invalidates this capability; never reopens admission. */
  release(): void;
}

/** Internal representation of a queued work item. */
interface QueueItem {
  /** Optional deduplication key. */
  id?: string;
  /** The async function to execute. */
  fn: () => Promise<void>;
  /** Logical lane key; tasks in the same lane are serialized. */
  laneKey: string;
  /** Number of times this item has been retried after failure. */
  retries: number;
}

interface LaneState {
  running: boolean;
  pending: QueueItem[];
  current: QueueItem | null;
  runningPromise: Promise<void> | null;
}

/** In-memory counters for queue behavior/health visibility. */
export interface QueueMetrics {
  enqueued: number;
  deduplicated: number;
  started: number;
  succeeded: number;
  failed: number;
  retriesScheduled: number;
}

/**
 * A lane-aware execution queue: items run FIFO within each lane, while
 * unrelated lanes may execute concurrently.
 */
export class AgentQueue {
  private lanes = new Map<string, LaneState>();
  private retryingIds = new Set<string>();
  private retryTimers = new Map<ReturnType<typeof setTimeout>, QueueItem>();
  private shuttingDown = false;
  private shutdownPromise?: Promise<void>;
  private migration?: {
    capability: QueueMigrationDrain;
    resolve: () => void;
    reject: (error: unknown) => void;
    settled: boolean;
    failed: boolean;
    error?: unknown;
    released: boolean;
  };
  private metrics: QueueMetrics = {
    enqueued: 0,
    deduplicated: 0,
    started: 0,
    succeeded: 0,
    failed: 0,
    retriesScheduled: 0,
  };

  private getLane(laneKey?: string): LaneState {
    const resolved = laneKey || DEFAULT_LANE_KEY;
    let lane = this.lanes.get(resolved);
    if (!lane) {
      lane = { running: false, pending: [], current: null, runningPromise: null };
      this.lanes.set(resolved, lane);
    }
    return lane;
  }

  private removeLaneIfIdle(laneKey: string): void {
    const lane = this.lanes.get(laneKey);
    if (!lane) return;
    if (lane.running) return;
    if (lane.current) return;
    if (lane.pending.length > 0) return;
    if (lane.runningPromise) return;
    this.lanes.delete(laneKey);
  }

  private hasQueuedId(id: string): boolean {
    if (this.retryingIds.has(id)) return true;
    for (const lane of this.lanes.values()) {
      if (lane.current?.id === id) return true;
      if (lane.pending.some((item) => item.id === id)) return true;
    }
    return false;
  }

  /**
   * Add a work item to the queue.
   * Items in the same lane run sequentially; items in different lanes may run
   * concurrently. Items with the same `id` are deduplicated globally.
   */
  enqueue(fn: () => Promise<void>, id?: string, laneKey?: string): void {
    if (this.migration) throw new MigrationAdmissionClosedError();
    if (this.shuttingDown) return;

    if (id && this.hasQueuedId(id)) {
      this.metrics.deduplicated += 1;
      return;
    }

    const resolvedLaneKey = laneKey || DEFAULT_LANE_KEY;
    const lane = this.getLane(resolvedLaneKey);
    const item: QueueItem = { id, fn, laneKey: resolvedLaneKey, retries: 0 };
    this.metrics.enqueued += 1;

    if (lane.running) {
      lane.pending.push(item);
      return;
    }

    this.runItem(lane, item);
  }

  /** Includes the next-tick startup window before the queued function executes. */
  isLaneBusy(laneKey: string): boolean {
    const lane = this.lanes.get(laneKey);
    return Boolean(lane?.running || lane?.pending.length);
  }

  private isDrained(): boolean {
    return !this.retryingIds.size && !this.retryTimers.size && ![...this.lanes.values()].some(lane =>
      lane.running || lane.current || lane.runningPromise || lane.pending.length);
  }

  /** Actual inventory check; a trusted coordinator still owns the global fence. */
  assertLegacyCaptureDrained(): void {
    if (this.migration) this.migration.capability.assertSealedAndDrained();
    else if (!this.isDrained()) throw new Error("Legacy queue has not drained");
  }

  /**
   * Synchronously and permanently seal NEW admission, then join all queue-owned
   * startup/current/pending/backoff work without shutdown or pool disposal.
   * Retries retain their actual QueueItem identity; callbacks cannot admit forks,
   * even with an existing id or from an accepted task's async context.
   * processChat/queueChat follow-ups with new ids are new admission: persisted
   * source/root S01 drain must be certified separately by the coordinator.
   * No local deadline: a coordinator may time out, but must not certify capture.
   */
  sealAndDrain(): QueueMigrationDrain {
    if (this.migration) return this.migration.capability;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const joined = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    // The caller still observes rejection; keep deferred failures handled even
    // when a coordinator attaches its join handler later.
    void joined.catch((error) => {
      log.warn("Migration queue drain was not certified", { err: error });
    });
    const state: NonNullable<AgentQueue["migration"]> = {
      capability: Object.freeze({
        joined,
        assertSealedAndDrained: () => this.assertMigrationDrained(state),
        release: () => { state.released = true; },
      }),
      resolve, reject, settled: false, failed: this.shuttingDown,
      error: this.shuttingDown ? new QueueShutdownIncompleteError("Queue shutdown already started") : undefined,
      released: false,
    };
    this.migration = state;
    if (this.shuttingDown) {
      state.settled = true;
      reject(state.error);
    } else {
      this.checkMigrationDrain();
    }
    return state.capability;
  }

  private assertMigrationDrained(state: NonNullable<AgentQueue["migration"]>): void {
    if (this.migration !== state || state.released || !state.settled || state.failed || !this.isDrained())
      throw new Error("Queue migration capability is not sealed and drained");
  }

  private checkMigrationDrain(): void {
    const state = this.migration;
    if (!state || state.settled || !this.isDrained()) return;
    state.settled = true;
    if (state.failed) state.reject(state.error);
    else state.resolve();
  }

  /** Convenience wrapper that prefixes the id with "task:" for scheduled tasks. */
  enqueueTask(taskId: string, fn: () => Promise<void>, laneKey?: string): void {
    this.enqueue(fn, `task:${taskId}`, laneKey);
  }

  /** Start executing an item inside a lane. */
  private runItem(lane: LaneState, item: QueueItem): void {
    if (item.id) this.retryingIds.delete(item.id);
    lane.running = true;
    lane.current = item;
    this.metrics.started += 1;
    // Do not invoke the queued function synchronously from enqueue(). An async
    // function runs inline until its first await, and web submit handlers enqueue
    // processChat() before returning the POST response. If processChat performs
    // expensive synchronous setup before its first await, the user's message is
    // not displayed or acted upon until that setup completes. Starting work on
    // the next event-loop turn keeps enqueue() as a cheap scheduling operation.
    lane.runningPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        void this.executeItem(lane, item).finally(() => {
          resolve();
          this.checkMigrationDrain();
        });
      }, 0);
    });
  }

  /** Run the item's function, handle errors with retry, and advance within the lane. */
  private async executeItem(lane: LaneState, item: QueueItem): Promise<void> {
    try {
      await item.fn();
      this.metrics.succeeded += 1;
    } catch (error) {
      this.metrics.failed += 1;
      if (this.migration && !this.migration.failed) {
        this.migration.failed = true;
        this.migration.error = error;
      }
      log.error("Queue item failed", {
        operation: "execute_item",
        laneKey: item.laneKey,
        itemId: item.id ?? null,
        err: error,
      });
      this.scheduleRetry(item);
    } finally {
      lane.running = false;
      lane.current = null;
      lane.runningPromise = null;
      if (lane.pending.length > 0 && !this.shuttingDown) {
        const next = lane.pending.shift()!;
        this.runItem(lane, next);
      } else {
        this.removeLaneIfIdle(item.laneKey);
      }
    }
  }

  /** Schedule an exponential-backoff retry for a failed item. */
  private scheduleRetry(item: QueueItem): void {
    if (!shouldRetry(item.retries, DEFAULT_MAX_RETRIES, this.shuttingDown)) return;
    item.retries++;
    this.metrics.retriesScheduled += 1;
    if (item.id) this.retryingIds.add(item.id);
    const delay = getRetryDelay(item.retries, DEFAULT_BASE_RETRY_MS);
    log.info("Scheduling queue retry", {
      operation: "schedule_retry",
      retries: item.retries,
      maxRetries: DEFAULT_MAX_RETRIES,
      delayMs: delay,
      itemId: item.id ?? null,
    });
    const timer = setTimeout(() => {
      // Only a retained retry record can re-enter after the migration seal.
      if (this.retryTimers.get(timer) !== item) return;
      this.retryTimers.delete(timer);
      if (item.id) this.retryingIds.delete(item.id);
      if (this.shuttingDown) return;
      const lane = this.getLane(item.laneKey);
      if (lane.running) {
        lane.pending.push(item);
      } else {
        this.runItem(lane, item);
      }
    }, delay);
    this.retryTimers.set(timer, item);
  }

  /**
   * Seal admission and join active tasks. Never discard accepted pending work,
   * cancel active tasks, or turn a failed join into success on a later call.
   */
  shutdown(ms = 5000): Promise<void> {
    // Once migration owns the queue, shutdown must not cancel its accepted work.
    return this.shutdownPromise ??= this.migration?.capability.joined ?? this.joinShutdown(ms);
  }

  private async joinShutdown(ms: number): Promise<void> {
    this.shuttingDown = true;
    const retainedRetries = this.retryTimers.size > 0;
    // Keep canceled retry records as ownership evidence, including anonymous work.
    for (const timer of this.retryTimers.keys()) clearTimeout(timer);
    const runningPromises = [...this.lanes.values()].flatMap(lane => lane.runningPromise ? [lane.runningPromise] : []);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (runningPromises.length) {
        await Promise.race([
          Promise.all(runningPromises),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new QueueShutdownTimeoutError(ms)), ms);
          }),
        ]);
      }
      if (retainedRetries || [...this.lanes.values()].some(lane => lane.pending.length)) {
        throw new QueueShutdownIncompleteError();
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Snapshot queue counters for diagnostics and tests. */
  getMetrics(): QueueMetrics {
    return { ...this.metrics };
  }
}
