import { describe, expect, test } from "bun:test";

import type { ChatOperationOwner, ChatOperationState } from "../../src/db.js";
import {
  SessionMutationGateway,
  SessionMutationRejectedError,
} from "../../src/agent-pool/session-mutation-gateway.js";

function operation(generation = 0, phase: ChatOperationState["phase"] = "running"): ChatOperationState {
  return {
    chatJid: "web:test",
    operationId: "op-1",
    sourceSeq: 7,
    phase,
    generation,
    cancellation: null,
  };
}

function owner(state: ChatOperationState): ChatOperationOwner {
  return {
    operationId: state.operationId,
    sourceSeq: state.sourceSeq,
    phase: state.phase,
    generation: state.generation,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("SessionMutationGateway", () => {
  test("admits legacy mutations only when no durable operation owns the chat", async () => {
    let active: ChatOperationState | null = null;
    let effects = 0;
    const gateway = new SessionMutationGateway({ getOperation: () => active });

    await gateway.run("web:test", "control", { scope: "legacy" }, () => { effects += 1; });
    active = operation();

    await expect(gateway.run("web:test", "control", { scope: "legacy" }, () => { effects += 1; }))
      .rejects.toMatchObject({
        name: "SessionMutationRejectedError",
        reason: "legacy_conflict",
      });
    expect(effects).toBe(1);
  });

  test("requires the exact operation owner including phase and generation", async () => {
    const active = operation(3, "running");
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    let effects = 0;

    await gateway.run("web:test", "prompt", { scope: "operation", owner: owner(active) }, () => { effects += 1; });
    await expect(gateway.run("web:test", "prompt", {
      scope: "operation",
      owner: { ...owner(active), generation: 2 },
    }, () => { effects += 1; })).rejects.toMatchObject({ reason: "generation_mismatch" });
    await expect(gateway.run("web:test", "prompt", {
      scope: "operation",
      owner: { ...owner(active), phase: "waiting" },
    }, () => { effects += 1; })).rejects.toMatchObject({ reason: "phase_mismatch" });
    expect(effects).toBe(1);
  });

  test("rechecks ownership after waiting in the per-chat lane", async () => {
    let active = operation();
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    const entered = deferred();
    const release = deferred();
    const first = gateway.run("web:test", "prompt", { scope: "operation", owner: owner(active) }, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;

    let staleEffect = false;
    const queued = gateway.run("web:test", "compaction", { scope: "operation", owner: owner(active) }, () => {
      staleEffect = true;
    });
    active = operation(1);
    release.resolve();

    await first;
    await expect(queued).rejects.toMatchObject({ reason: "generation_mismatch" });
    expect(staleEffect).toBe(false);
  });

  test("inherits the exact owner for nested in-run recovery", async () => {
    const active = operation();
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    const effects: string[] = [];

    await gateway.run("web:test", "prompt", { scope: "operation", owner: owner(active) }, async () => {
      effects.push("prompt");
      await gateway.runInheritedOrLegacy("web:test", "recovery", () => { effects.push("recovery"); });
    });

    expect(effects).toEqual(["prompt", "recovery"]);
  });

  test("does not treat a child timer context as nested after its legacy lane exits", async () => {
    let active: ChatOperationState | null = null;
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    const releaseChild = deferred();
    let resolveChild!: () => void;
    let rejectChild!: (error: unknown) => void;
    const child = new Promise<void>((resolve, reject) => {
      resolveChild = resolve;
      rejectChild = reject;
    });
    let effects = 0;

    await gateway.run("web:test", "control", { scope: "legacy" }, () => {
      setTimeout(async () => {
        await releaseChild.promise;
        try {
          await gateway.run("web:test", "compaction", { scope: "operation", owner: owner(active!) }, () => {
            effects += 1;
          });
          resolveChild();
        } catch (error) {
          rejectChild(error);
        }
      }, 0);
    });

    active = operation();
    releaseChild.resolve();
    await child;
    expect(effects).toBe(1);
  });

  test("still rejects a genuinely live nested legacy-to-operation mismatch", async () => {
    let active: ChatOperationState | null = null;
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    let effects = 0;

    await gateway.run("web:test", "control", { scope: "legacy" }, async () => {
      active = operation();
      await expect(gateway.run(
        "web:test",
        "compaction",
        { scope: "operation", owner: owner(active) },
        () => { effects += 1; },
      )).rejects.toMatchObject({ reason: "generation_mismatch" });
    });

    expect(effects).toBe(0);
  });

  test("does not attach a stale child context to an unrelated later legacy lane", async () => {
    const gateway = new SessionMutationGateway({ getOperation: () => null });
    const releaseChild = deferred();
    const childQueued = deferred();
    let resolveChild!: () => void;
    let rejectChild!: (error: unknown) => void;
    const child = new Promise<void>((resolve, reject) => {
      resolveChild = resolve;
      rejectChild = reject;
    });
    const order: string[] = [];

    await gateway.run("web:test", "control", { scope: "legacy" }, () => {
      setTimeout(async () => {
        await releaseChild.promise;
        childQueued.resolve();
        try {
          await gateway.run("web:test", "session", { scope: "legacy" }, () => { order.push("child"); });
          resolveChild();
        } catch (error) {
          rejectChild(error);
        }
      }, 0);
    });

    const laterEntered = deferred();
    const releaseLater = deferred();
    const later = gateway.run("web:test", "control", { scope: "legacy" }, async () => {
      order.push("later");
      laterEntered.resolve();
      await releaseLater.promise;
    });
    await laterEntered.promise;

    releaseChild.resolve();
    await childQueued.promise;
    expect(order).toEqual(["later"]);
    releaseLater.resolve();
    await later;
    await child;
    expect(order).toEqual(["later", "child"]);
  });

  test("keeps legacy-only mutation classes closed to operation owners", async () => {
    const active = operation();
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    let effects = 0;

    for (const mutation of ["control", "model", "thinking", "session", "session_tree", "queue", "lifecycle"] as const) {
      await expect(gateway.run("web:test", mutation, { scope: "operation", owner: owner(active) }, () => {
        effects += 1;
      })).rejects.toMatchObject({ reason: "operation_mutation_forbidden" });
    }
    expect(effects).toBe(0);
  });

  test("does not let a newly claimed operation abort an earlier legacy lane occupant", async () => {
    let active: ChatOperationState | null = null;
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    const entered = deferred();
    const release = deferred();
    const legacy = gateway.run("web:test", "control", { scope: "legacy" }, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;

    active = operation();
    await expect(gateway.compareAndActAbort("web:test", {
      scope: "operation",
      owner: owner(active),
    }, () => {})).rejects.toMatchObject({ reason: "active_mutation_mismatch" });

    release.resolve();
    await legacy;
  });

  test("rejects an operation abort when no matching lane occupant exists", async () => {
    const active = operation();
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    let aborted = false;

    await expect(gateway.compareAndActAbort("web:test", {
      scope: "operation",
      owner: owner(active),
    }, () => { aborted = true; })).rejects.toMatchObject({ reason: "active_mutation_mismatch" });
    expect(aborted).toBe(false);
  });

  test("rejects a legacy abort when no legacy lane occupant exists", async () => {
    const gateway = new SessionMutationGateway({ getOperation: () => null });
    let aborted = false;

    await expect(gateway.compareAndActAbort("web:test", { scope: "legacy" }, () => {
      aborted = true;
    })).rejects.toMatchObject({ reason: "active_mutation_mismatch" });
    expect(aborted).toBe(false);
  });

  test("couples durable cancellation to the exact pre-cancellation lane occupant", async () => {
    let active: ChatOperationState | null = operation();
    const preCancelOwner = owner(active);
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    const entered = deferred();
    const release = deferred();
    const running = gateway.run("web:test", "prompt", { scope: "operation", owner: preCancelOwner }, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;

    const events: string[] = [];
    const result = await gateway.cancelAndActAbort(
      "web:test",
      { scope: "operation", owner: preCancelOwner },
      () => {
        events.push("cancel");
        active = { ...operation(1), cancellation: { cause: "remote_abort", requestedAt: "now" } };
        return { status: "applied" as const };
      },
      (cancellation) => cancellation.status === "applied",
      () => { events.push("abort"); },
    );
    expect(result).toEqual({ cancellation: { status: "applied" }, acted: true, result: undefined });
    expect(events).toEqual(["cancel", "abort"]);

    release.resolve();
    await running;
  });

  test("rejects stale cancellation before its callback and can cancel without an occupant", async () => {
    let active: ChatOperationState | null = operation(1);
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    let cancelCalls = 0;

    await expect(gateway.cancelAndActAbort(
      "web:test",
      { scope: "operation", owner: owner(operation()) },
      () => { cancelCalls += 1; return { status: "applied" as const }; },
      (cancellation) => cancellation.status === "applied",
      () => {},
    )).rejects.toMatchObject({ reason: "generation_mismatch" });
    expect(cancelCalls).toBe(0);

    const exactOwner = owner(active);
    const result = await gateway.cancelAndActAbort(
      "web:test",
      { scope: "operation", owner: exactOwner },
      () => {
        cancelCalls += 1;
        active = { ...operation(2), cancellation: { cause: "remote_abort", requestedAt: "now" } };
        return { status: "applied" as const };
      },
      (cancellation) => cancellation.status === "applied",
      () => { throw new Error("no occupant must not be aborted"); },
    );
    expect(result).toEqual({ cancellation: { status: "applied" }, acted: false });
    expect(cancelCalls).toBe(1);
  });

  test("allows only exact compare-and-act abort to bypass an occupied lane", async () => {
    let active: ChatOperationState | null = operation();
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    const entered = deferred();
    const release = deferred();
    const running = gateway.run("web:test", "prompt", { scope: "operation", owner: owner(active) }, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;

    let aborted = false;
    await gateway.compareAndActAbort("web:test", { scope: "operation", owner: owner(active) }, () => {
      aborted = true;
    });
    expect(aborted).toBe(true);

    active = operation(1);
    await expect(gateway.compareAndActAbort("web:test", {
      scope: "operation",
      owner: owner(operation()),
    }, () => {})).rejects.toBeInstanceOf(SessionMutationRejectedError);
    await expect(gateway.compareAndActAbort("web:test", { scope: "legacy" }, () => {}))
      .rejects.toMatchObject({ reason: "legacy_conflict" });

    release.resolve();
    await running;
  });

  test("admits an exact-owner queue effect out of band only for the matching prompt occupant", async () => {
    const active = operation();
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    const entered = deferred();
    const release = deferred();
    const running = gateway.run("web:test", "prompt", { scope: "operation", owner: owner(active) }, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;

    const events: string[] = [];
    await gateway.compareAndActQueue(
      "web:test",
      { scope: "operation", owner: owner(active) },
      () => { events.push("register"); },
      () => { events.push("queue"); },
    );
    expect(events).toEqual(["register", "queue"]);

    release.resolve();
    await running;
  });

  test("rejects same-owner queue effects while compaction, rotation, or recovery occupies the lane", async () => {
    const active = operation();
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    let effects = 0;

    for (const mutation of ["compaction", "rotation", "recovery"] as const) {
      const entered = deferred();
      const release = deferred();
      const running = gateway.run("web:test", mutation, { scope: "operation", owner: owner(active) }, async () => {
        entered.resolve();
        await release.promise;
      });
      await entered.promise;
      await expect(gateway.compareAndActQueue(
        "web:test",
        { scope: "operation", owner: owner(active) },
        () => { effects += 1; },
        () => { effects += 1; },
      )).rejects.toMatchObject({ reason: "active_mutation_mismatch" });
      release.resolve();
      await running;
    }
    expect(effects).toBe(0);
  });

  test("tracks inherited recovery occupancy and restores the enclosing prompt occupant", async () => {
    const active = operation();
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    const recoveryEntered = deferred();
    const releaseRecovery = deferred();
    const recoveryDone = deferred();
    const releasePrompt = deferred();
    let registrations = 0;
    let effects = 0;

    const prompt = gateway.run("web:test", "prompt", { scope: "operation", owner: owner(active) }, async () => {
      await gateway.runInheritedOrLegacy("web:test", "recovery", async () => {
        recoveryEntered.resolve();
        await releaseRecovery.promise;
      });
      recoveryDone.resolve();
      await releasePrompt.promise;
    });
    await recoveryEntered.promise;

    await expect(gateway.compareAndActQueue(
      "web:test",
      { scope: "operation", owner: owner(active) },
      () => { registrations += 1; },
      () => { effects += 1; },
    )).rejects.toMatchObject({ reason: "active_mutation_mismatch" });
    releaseRecovery.resolve();
    await recoveryDone.promise;

    await gateway.compareAndActQueue(
      "web:test",
      { scope: "operation", owner: owner(active) },
      () => { registrations += 1; },
      () => { effects += 1; },
    );
    expect(registrations).toBe(1);
    expect(effects).toBe(1);
    releasePrompt.resolve();
    await prompt;
  });

  test("rechecks exact ownership after durable queue registration and before the SDK effect", async () => {
    let active = operation();
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    const entered = deferred();
    const release = deferred();
    const running = gateway.run("web:test", "prompt", { scope: "operation", owner: owner(active) }, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;

    let queued = false;
    await expect(gateway.compareAndActQueue(
      "web:test",
      { scope: "operation", owner: owner(active) },
      () => { active = operation(1); },
      () => { queued = true; },
    )).rejects.toMatchObject({ reason: "generation_mismatch" });
    expect(queued).toBe(false);

    release.resolve();
    await running;
  });

  test("rejects stale and legacy out-of-band queue callers before registration or SDK effects", async () => {
    const active = operation(1);
    const gateway = new SessionMutationGateway({ getOperation: () => active });
    let effects = 0;

    await expect(gateway.compareAndActQueue(
      "web:test",
      { scope: "operation", owner: owner(operation()) },
      () => { effects += 1; },
      () => { effects += 1; },
    )).rejects.toMatchObject({ reason: "generation_mismatch" });
    await expect(gateway.compareAndActQueue(
      "web:test",
      { scope: "legacy" },
      () => { effects += 1; },
      () => { effects += 1; },
    )).rejects.toMatchObject({ reason: "legacy_conflict" });
    expect(effects).toBe(0);
  });
});
