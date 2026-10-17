/**
 * test/queue/queue.test.ts – Tests for the agent message queue.
 *
 * Verifies AgentQueue enqueue/dequeue, ordering, priority, deduplication,
 * drain behaviour, and concurrent access safety.
 */

import { describe, test, expect } from "bun:test";
import "../helpers.js";

import { AgentQueue, QueueShutdownIncompleteError, QueueShutdownTimeoutError } from "../../src/queue.js";
import { getRetryDelay, shouldRetry } from "../../src/queue/retry-policy.js";

describe("AgentQueue", () => {
  test("enqueue schedules work without running the task synchronously", async () => {
    const queue = new AgentQueue();
    let ran = false;

    queue.enqueue(async () => {
      ran = true;
    });

    expect(ran).toBe(false);
    await Bun.sleep(20);
    expect(ran).toBe(true);
    await queue.shutdown(100);
  });

  test("executes tasks sequentially", async () => {
    const queue = new AgentQueue();
    const order: number[] = [];

    queue.enqueue(async () => {
      await Bun.sleep(10);
      order.push(1);
    });
    queue.enqueue(async () => {
      order.push(2);
    });

    // Wait for both to complete
    await Bun.sleep(100);
    expect(order).toEqual([1, 2]);
    await queue.shutdown(100);
  });

  test('lane busy covers deferred startup and clears after completion', async () => {
    const queue = new AgentQueue();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    queue.enqueue(async () => gate, 'starting', 'chat:a');
    expect(queue.isLaneBusy('chat:a')).toBe(true);
    expect(queue.isLaneBusy('chat:b')).toBe(false);
    release();
    await Bun.sleep(20);
    expect(queue.isLaneBusy('chat:a')).toBe(false);
    await queue.shutdown();
  });

  test("deduplicates by id", async () => {
    const queue = new AgentQueue();
    let count = 0;

    queue.enqueue(async () => {
      await Bun.sleep(50);
      count++;
    }, "task-1");

    // This should be ignored (same id, first is still running)
    queue.enqueue(async () => {
      count++;
    }, "task-1");

    await Bun.sleep(200);
    expect(count).toBe(1);

    const metrics = queue.getMetrics();
    expect(metrics.enqueued).toBe(1);
    expect(metrics.deduplicated).toBe(1);

    await queue.shutdown(100);
  });

  test("enqueueTask prefixes id with task:", async () => {
    const queue = new AgentQueue();
    let ran = false;

    queue.enqueueTask("abc", async () => {
      ran = true;
    });

    await Bun.sleep(50);
    expect(ran).toBe(true);
    await queue.shutdown(100);
  });

  test("shutdown prevents new tasks", async () => {
    const queue = new AgentQueue();
    await queue.shutdown(100);

    let ran = false;
    queue.enqueue(async () => {
      ran = true;
    });

    await Bun.sleep(50);
    expect(ran).toBe(false);
  });

  test("allows different ids in queue", async () => {
    const queue = new AgentQueue();
    const order: string[] = [];

    queue.enqueue(async () => {
      await Bun.sleep(20);
      order.push("a");
    }, "id-a");

    queue.enqueue(async () => {
      order.push("b");
    }, "id-b");

    await Bun.sleep(150);
    expect(order).toEqual(["a", "b"]);
    await queue.shutdown(100);
  });

  test("runs different lanes in parallel while preserving per-lane order", async () => {
    const queue = new AgentQueue();
    const order: string[] = [];
    let releaseLaneA!: () => void;
    const laneAGate = new Promise<void>((resolve) => {
      releaseLaneA = resolve;
    });

    queue.enqueue(async () => {
      order.push("lane-a:start");
      await laneAGate;
      order.push("lane-a:end");
    }, "job-a", "chat:web:a");

    queue.enqueue(async () => {
      order.push("lane-b:run");
    }, "job-b", "chat:web:b");

    await Bun.sleep(30);
    expect(order).toEqual(["lane-a:start", "lane-b:run"]);

    releaseLaneA();
    await Bun.sleep(30);
    expect(order).toEqual(["lane-a:start", "lane-b:run", "lane-a:end"]);
    await queue.shutdown(100);
  });

  test("keeps tasks in the same lane sequential", async () => {
    const queue = new AgentQueue();
    const order: string[] = [];

    queue.enqueue(async () => {
      order.push("first:start");
      await Bun.sleep(20);
      order.push("first:end");
    }, "job-1", "chat:web:shared");

    queue.enqueue(async () => {
      order.push("second");
    }, "job-2", "chat:web:shared");

    await Bun.sleep(80);
    expect(order).toEqual(["first:start", "first:end", "second"]);
    await queue.shutdown(100);
  });

  test("retries are appended after unrelated tasks", async () => {
    const queue = new AgentQueue();
    const order: string[] = [];
    let attempts = 0;

    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: (...args: any[]) => void, ms?: number, ...args: any[]) =>
      originalSetTimeout(fn, Math.min(ms ?? 0, 20), ...args)) as typeof setTimeout;

    try {
      queue.enqueue(async () => {
        order.push(attempts === 0 ? "first" : "retry");
        if (attempts === 0) {
          attempts += 1;
          throw new Error("fail");
        }
      }, "task-1");

      queue.enqueue(async () => {
        order.push("second");
      }, "task-2");

      await new Promise((resolve) => originalSetTimeout(resolve, 80));
      expect(order.slice(0, 2)).toEqual(["first", "second"]);
      expect(order).toContain("retry");

      const metrics = queue.getMetrics();
      expect(metrics.retriesScheduled).toBeGreaterThanOrEqual(1);
      expect(metrics.failed).toBeGreaterThanOrEqual(1);
      expect(metrics.succeeded).toBeGreaterThanOrEqual(2);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      await queue.shutdown(100);
    }
  });

  test("deduplicates items while a retry is waiting on its backoff timer", async () => {
    const queue = new AgentQueue();
    const order: string[] = [];
    let attempts = 0;

    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: (...args: any[]) => void, ms?: number, ...args: any[]) =>
      originalSetTimeout(fn, Math.min(ms ?? 0, 20), ...args)) as typeof setTimeout;

    try {
      queue.enqueue(async () => {
        order.push(attempts === 0 ? "first" : "retry");
        if (attempts === 0) {
          attempts += 1;
          throw new Error("fail");
        }
      }, "task-1");

      await Bun.sleep(5);

      queue.enqueue(async () => {
        order.push("duplicate");
      }, "task-1");

      await new Promise((resolve) => originalSetTimeout(resolve, 80));
      expect(order).toEqual(["first", "retry"]);

      const metrics = queue.getMetrics();
      expect(metrics.deduplicated).toBe(1);
      expect(metrics.retriesScheduled).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      await queue.shutdown(100);
    }
  });

  test("shutdown cancels pending retry timers", async () => {
    const queue = new AgentQueue();
    let attempts = 0;

    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: (...args: any[]) => void, ms?: number, ...args: any[]) =>
      originalSetTimeout(fn, Math.min(ms ?? 0, 20), ...args)) as typeof setTimeout;

    try {
      queue.enqueue(async () => {
        attempts += 1;
        throw new Error("fail");
      }, "task-1");

      await Bun.sleep(5);
      await expect(queue.shutdown(100)).rejects.toBeInstanceOf(QueueShutdownIncompleteError);
      expect(() => queue.assertLegacyCaptureDrained()).toThrow();
      await new Promise((resolve) => originalSetTimeout(resolve, 80));

      expect(attempts).toBe(1);
      expect(queue.getMetrics().retriesScheduled).toBe(1);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test("shutdown rejects at deadline, retains accepted pending work and stays sealed after late completion", async () => {
    const queue = new AgentQueue();
    let ran = false;
    let pendingRan = false;

    queue.enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      ran = true;
    });

    queue.enqueue(async () => {
      pendingRan = true;
    });

    const start = Date.now();
    const shutdown = queue.shutdown(5);
    await expect(shutdown).rejects.toBeInstanceOf(QueueShutdownTimeoutError);
    expect(() => queue.assertLegacyCaptureDrained()).toThrow();
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(40);

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(ran).toBe(true);
    expect(pendingRan).toBe(false);
    expect(() => queue.assertLegacyCaptureDrained()).toThrow();
    expect(queue.shutdown()).toBe(shutdown);
    await expect(queue.shutdown()).rejects.toBeInstanceOf(QueueShutdownTimeoutError);
    queue.enqueue(async () => { pendingRan = true; });
    await Bun.sleep(10);
    expect(pendingRan).toBe(false);
    expect(queue.getMetrics().enqueued).toBe(2);
  });

  test("retry policy helpers", () => {
    expect(shouldRetry(0, 3, false)).toBe(true);
    expect(shouldRetry(3, 3, false)).toBe(false);
    expect(shouldRetry(1, 3, true)).toBe(false);
    expect(getRetryDelay(1, 1000)).toBe(1000);
    expect(getRetryDelay(2, 1000)).toBe(2000);
    expect(getRetryDelay(3, 1000)).toBe(4000);
  });
});
