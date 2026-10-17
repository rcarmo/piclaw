import { describe, expect, test } from "bun:test";
import "../helpers.js";
import { AgentQueue, MigrationAdmissionClosedError, QueueShutdownIncompleteError } from "../../src/queue.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
};

// Retain real startup turns, but hold retry callbacks explicitly: no backoff sleeps
// and no abandoned timers. The queue's retained record is still the authority.
async function withHeldRetries(run: (fire: () => void, scheduled: Promise<void>) => Promise<void>) {
  const original = globalThis.setTimeout;
  const scheduled = deferred();
  const callbacks: (() => void)[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    if (ms && ms >= 1000) {
      callbacks.push(fn);
      const timer = original(() => {}, 60_000);
      timers.push(timer);
      scheduled.resolve();
      return timer;
    }
    return original(fn, ms);
  }) as typeof setTimeout;
  try {
    await run(() => {
      const fn = callbacks.shift();
      if (!fn) throw new Error("No retained retry");
      clearTimeout(timers.shift()!);
      fn();
    }, scheduled.promise);
    expect(callbacks).toHaveLength(0);
  } finally {
    globalThis.setTimeout = original;
    timers.forEach(clearTimeout);
  }
}

describe("non-destructive queue migration drain", () => {
  test("seals synchronously in startup, joins all pending lanes, and never disposes residents", async () => {
    const queue = new AgentQueue();
    const a = deferred(), b = deferred(), aStarted = deferred(), bStarted = deferred();
    const order: string[] = [];
    const resident = { disposed: false, dispose() { this.disposed = true; } };
    queue.enqueue(async () => { aStarted.resolve(); await a.promise; order.push("a1"); }, "a1", "a");
    queue.enqueue(async () => { order.push("a2"); }, "a2", "a");
    queue.enqueue(async () => { bStarted.resolve(); await b.promise; order.push("b1"); }, "b1", "b");
    queue.enqueue(async () => { order.push("b2"); }, "b2", "b");
    const lease = queue.sealAndDrain();
    expect(queue.sealAndDrain()).toBe(lease);
    expect(() => lease.assertSealedAndDrained()).toThrow();
    expect(() => queue.assertLegacyCaptureDrained()).toThrow();
    expect(() => queue.enqueue(async () => {}, "a1", "a")).toThrow(MigrationAdmissionClosedError);
    expect(() => queue.enqueueTask("new", async () => {})).toThrow(MigrationAdmissionClosedError);
    let joined = false;
    void lease.joined.then(() => { joined = true; });
    await Promise.all([aStarted.promise, bStarted.promise]);
    expect(joined).toBe(false);
    a.resolve();
    await Bun.sleep(10);
    expect(order).toEqual(["a1", "a2"]);
    expect(joined).toBe(false);
    b.resolve();
    await lease.joined;
    expect(order).toEqual(["a1", "a2", "b1", "b2"]);
    lease.assertSealedAndDrained();
    queue.assertLegacyCaptureDrained();
    expect(resident.disposed).toBe(false);
    expect(queue.getMetrics().started).toBe(4);
    lease.release();
    expect(() => lease.assertSealedAndDrained()).toThrow();
    expect(() => queue.assertLegacyCaptureDrained()).toThrow();
    expect(() => queue.enqueue(async () => {})).toThrow(MigrationAdmissionClosedError);
  });

  test("already retained named and anonymous retries run after seal; shutdown cannot cancel them", async () => {
    await withHeldRetries(async (fire, scheduled) => {
      const queue = new AgentQueue();
      let attempts = 0;
      queue.enqueue(async () => { if (++attempts === 1) throw new Error("before seal"); }, "retry");
      await scheduled;
      const lease = queue.sealAndDrain();
      const shutdown = queue.shutdown(1);
      expect(shutdown).toBe(lease.joined);
      expect(() => queue.enqueue(async () => {}, "retry")).toThrow(MigrationAdmissionClosedError);
      expect(() => lease.assertSealedAndDrained()).toThrow();
      fire();
      await lease.joined;
      expect(attempts).toBe(2);
      lease.assertSealedAndDrained();
    });
    await withHeldRetries(async (fire, scheduled) => {
      const queue = new AgentQueue();
      let attempts = 0;
      queue.enqueue(async () => { if (++attempts === 1) throw new Error("anonymous"); });
      await scheduled;
      const lease = queue.sealAndDrain();
      fire();
      await lease.joined;
      expect(attempts).toBe(2);
      lease.assertSealedAndDrained();
    });
  });

  test("failures after seal reject only after pending work and newly scheduled retries finish", async () => {
    await withHeldRetries(async (fire, scheduled) => {
      const queue = new AgentQueue();
      const pending = deferred(), pendingStarted = deferred();
      const poison = new Error("poison after seal");
      let attempts = 0, settled = false;
      queue.enqueue(async () => { if (++attempts === 1) throw poison; }, "poison");
      queue.enqueue(async () => { pendingStarted.resolve(); await pending.promise; }, "pending");
      const lease = queue.sealAndDrain();
      void lease.joined.then(() => { settled = true; }, () => { settled = true; });
      await scheduled;
      await pendingStarted.promise;
      fire(); // Retained retry joins the pending lane, rather than public enqueue.
      await Bun.sleep(5);
      expect(attempts).toBe(1);
      expect(settled).toBe(false);
      pending.resolve();
      await expect(lease.joined).rejects.toBe(poison);
      expect(attempts).toBe(2);
      expect(queue.getMetrics().succeeded).toBe(2);
      expect(() => lease.assertSealedAndDrained()).toThrow();
      expect(() => queue.assertLegacyCaptureDrained()).toThrow();
      expect(queue.sealAndDrain().joined).toBe(lease.joined);
    });
  });

  test("exhausted retries reject the stable join without leaving timer ownership", async () => {
    await withHeldRetries(async (fire, scheduled) => {
      const queue = new AgentQueue();
      const poison = new Error("terminal poison");
      let attempts = 0;
      queue.enqueue(async () => { attempts++; throw poison; }, "terminal");
      const lease = queue.sealAndDrain();
      await scheduled;
      for (let retry = 0; retry < 3; retry++) {
        fire();
        await Bun.sleep(5);
      }
      await expect(lease.joined).rejects.toBe(poison);
      expect(attempts).toBe(4);
      expect(queue.getMetrics().retriesScheduled).toBe(3);
      expect(queue.isLaneBusy("__default__")).toBe(false);
      expect(() => lease.assertSealedAndDrained()).toThrow();
      await expect(queue.sealAndDrain().joined).rejects.toBe(poison);
    });
  });

  test("accepted callback and delayed stale closure have no authority to admit forks", async () => {
    const queue = new AgentQueue();
    let stale!: () => void;
    queue.enqueue(async () => {
      const fork = () => queue.enqueue(async () => {}, "fork");
      expect(fork).toThrow(MigrationAdmissionClosedError);
      stale = fork;
    }, "accepted");
    const lease = queue.sealAndDrain();
    await lease.joined;
    expect(stale).toThrow(MigrationAdmissionClosedError);
    expect(queue.getMetrics().enqueued).toBe(1);
    lease.assertSealedAndDrained();
  });

  test("empty queue joins; release and caller timeout never reopen it", async () => {
    const queue = new AgentQueue();
    const hold = deferred();
    queue.enqueue(async () => hold.promise);
    const lease = queue.sealAndDrain();
    const timeout = new Error("coordinator deadline");
    await expect(Promise.race([lease.joined, Promise.reject(timeout)])).rejects.toBe(timeout);
    expect(() => lease.assertSealedAndDrained()).toThrow();
    lease.release();
    hold.resolve();
    await lease.joined;
    expect(() => lease.assertSealedAndDrained()).toThrow();
    expect(() => queue.enqueue(async () => {})).toThrow(MigrationAdmissionClosedError);
    const empty = new AgentQueue().sealAndDrain();
    await empty.joined;
    empty.assertSealedAndDrained();
  });

  test("a prior legacy shutdown cannot be upgraded into migration certification", async () => {
    const queue = new AgentQueue();
    await queue.shutdown();
    const lease = queue.sealAndDrain();
    await expect(lease.joined).rejects.toBeInstanceOf(QueueShutdownIncompleteError);
    expect(() => lease.assertSealedAndDrained()).toThrow();
    expect(() => queue.enqueue(async () => {})).toThrow(MigrationAdmissionClosedError);
  });
});
