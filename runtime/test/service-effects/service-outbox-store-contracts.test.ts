import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  hashCanonicalRequest,
  type CanonicalJsonValue,
  type NormalisedEffectTrace,
  type NormalisedTraceInput,
} from "../../src/service-effects/contracts/common.js";
import { installServiceOutboxSchema } from "../../src/service-effects/current-piclaw/service-outbox-schema.js";
import {
  createCurrentPiclawServiceOutboxStore,
  type ServiceOutboxAdapterRuntime,
} from "../../src/service-effects/current-piclaw/service-outbox-store.js";
import type {
  ContractSubjectFactory,
  ContractTestContext,
} from "../../src/service-effects/testing/contract-suite.js";
import {
  defineServiceOutboxStoreContract,
  type ServiceOutboxContractSubject,
  type ServiceOutboxMutationMethod,
} from "../../src/service-effects/testing/contract-suites/service-outbox-store-contract.js";
import {
  ManualEffectClock,
  SequenceEffectIdSource,
} from "../../src/service-effects/testing/deterministic-controls.js";
import { FakeServiceOutboxStore } from "../../src/service-effects/testing/fakes/fake-service-outbox-store.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import { EffectTraceRecorder } from "../../src/service-effects/testing/trace-recorder.js";

function schemaEnqueue(id: string) {
  const base = {
    effect: {
      idempotencyKey: `schema:${id}`,
      requestHash: "",
      operationId: "operation:schema",
      sourceSeq: 1,
      provenanceRef: "provenance:schema",
      redactionClass: "private" as const,
    },
    outboxId: id,
    kind: "maintenance" as const,
    payloadRef: "payload:schema",
    destinationRef: null,
    availableAt: "2026-08-13T10:00:00.000Z",
    enqueuedAt: "2026-08-13T09:00:00.000Z",
    repeatability: "repeatable" as const,
  };
  return {
    ...base,
    effect: {
      ...base.effect,
      requestHash: hashCanonicalRequest(base as unknown as CanonicalJsonValue),
    },
  };
}

function context(): ContractTestContext {
  return {
    clock: new ManualEffectClock("2026-08-13T09:00:00.000Z"),
    ids: new SequenceEffectIdSource("s05"),
    faults: new DeterministicFaultPlan(),
  };
}
class Runtime implements ServiceOutboxAdapterRuntime {
  readonly trace: EffectTraceRecorder;
  readonly faults = new Map<string, Set<number>>();
  readonly counts = new Map<string, number>();
  constructor(
    private readonly ctx: ContractTestContext,
    snapshot: readonly NormalisedEffectTrace[] = [],
  ) {
    this.trace = EffectTraceRecorder.fromSnapshot(snapshot);
  }
  plan(method: string, point: string, occurrence: number) {
    const k = `${method}:${point}`,
      n = this.counts.get(k) ?? 0;
    this.faults.set(k, new Set([n + occurrence]));
  }
  hitFault(
    point: "before_effect" | "effect_then_lost_acknowledgement",
    method: ServiceOutboxMutationMethod,
  ) {
    const key = `${method}:${point}`;
    const occurrence = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, occurrence);
    const planned = this.faults.get(key);
    if (planned?.has(occurrence)) {
      return point === "before_effect" && occurrence > 1
        ? "in_transaction"
        : true;
    }
    return this.ctx.faults.hit(point);
  }
  recordTrace(input: NormalisedTraceInput) {
    if (input.resultTag === "call") this.trace.recordCall(input);
    else this.trace.recordResult(input);
  }
}
interface SqliteSubject extends ServiceOutboxContractSubject {
  database: Database;
  path: string;
  runtime: Runtime;
  ownsDirectory: boolean;
}
function sqliteSubject(
  path: string,
  ctx: ContractTestContext,
  trace: readonly NormalisedEffectTrace[] = [],
  ownsDirectory = true,
): SqliteSubject {
  const database = new Database(path, { strict: true });
  database.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0",
  );
  installServiceOutboxSchema(database);
  const runtime = new Runtime(ctx, trace),
    made = createCurrentPiclawServiceOutboxStore(database, runtime);
  if (!made.ok) throw new Error("construction");
  return {
    database,
    path,
    runtime,
    ownsDirectory,
    store: made.value,
    planFault: (m, p, o) => runtime.plan(m, p, o),
    dispose() {
      if (database.open) database.close();
      if (this.ownsDirectory) {
        rmSync(dirname(path), { recursive: true, force: true });
      }
    },
  };
}
const sqliteFactory: ContractSubjectFactory<ServiceOutboxContractSubject> = {
  name: "current-piclaw-service-outbox",
  create(ctx) {
    const dir = mkdtempSync(join(tmpdir(), "piclaw-s05-"));
    return sqliteSubject(join(dir, "store.sqlite"), ctx);
  },
  crashAndRestore(subject, ctx) {
    const old = subject as SqliteSubject,
      trace = old.runtime.trace.snapshot();
    const fresh = sqliteSubject(old.path, ctx, trace, true);
    old.ownsDirectory = false;
    old.database.close();
    fresh.runtime.faults.clear();
    fresh.runtime.counts.clear();
    return { subject: fresh, context: ctx };
  },
  inspectTrace(subject) {
    return (subject as SqliteSubject).runtime.trace.inspect();
  },
};
const fakeFactory: ContractSubjectFactory<ServiceOutboxContractSubject> = {
  name: "fake-service-outbox",
  create(ctx) {
    const store = new FakeServiceOutboxStore(ctx);
    return { store, planFault: (m, p, o) => store.planFault(m, p, o) };
  },
  crashAndRestore(subject, ctx) {
    const old = subject.store as FakeServiceOutboxStore,
      store = new FakeServiceOutboxStore(ctx);
    store.restore(old.snapshot());
    return {
      subject: { store, planFault: (m, p, o) => store.planFault(m, p, o) },
      context: ctx,
    };
  },
  inspectTrace(subject) {
    return (subject.store as FakeServiceOutboxStore).trace.inspect();
  },
};
describe("EF-S05 ServiceOutboxStore shared contract", () => {
  // This aggregate runs 15 contract/recovery cases with repeated private-schema creation and fresh SQLite restores.
  test("isolated SQLite adapter", { timeout: 15_000 }, async () => {
    const before = readdirSync(tmpdir())
      .filter((name) => name.startsWith("piclaw-s05-"))
      .sort();
    expect(
      await defineServiceOutboxStoreContract(sqliteFactory, context),
    ).toHaveLength(15);
    expect(
      readdirSync(tmpdir())
        .filter((name) => name.startsWith("piclaw-s05-"))
        .sort(),
    ).toEqual(before);
  });
  test("independent deterministic fake", async () => {
    expect(
      await defineServiceOutboxStoreContract(fakeFactory, context),
    ).toHaveLength(15);
  });
});
describe("EF-S05 private schema", () => {
  test("installer is explicit idempotent and atomic", () => {
    const db = new Database(":memory:", { strict: true });
    expect(
      (
        db
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE name LIKE 'service_effect_s05_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);
    installServiceOutboxSchema(db);
    installServiceOutboxSchema(db);
    const names = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'service_effect_s05_%' ORDER BY name",
      )
      .all() as { name: string }[];
    expect(names.map((x) => x.name)).toEqual([
      "service_effect_s05_decisions",
      "service_effect_s05_leases",
      "service_effect_s05_outbox",
      "service_effect_s05_outcomes",
      "service_effect_s05_resolutions",
    ]);
    db.close();
  });
  test("state correlation checks accept public transitions and reject impossible rows", async () => {
    const subject = sqliteSubject(":memory:", context(), [], false);
    try {
      await subject.store.enqueue(schemaEnqueue("schema-pending"));
      const pending = subject.database
        .query(
          "SELECT * FROM service_effect_s05_outbox WHERE outbox_id='schema-pending'",
        )
        .get();
      expect(pending).not.toBeNull();
      expect(() =>
        subject.database
          .query(
            "UPDATE service_effect_s05_outbox SET state='started',certainty=NULL,attempt=1 WHERE outbox_id='schema-pending'",
          )
          .run(),
      ).toThrow();
      const claimed = await subject.store.claimNext({
        kinds: ["maintenance"],
        workerId: "worker:schema",
        leaseToken: "lease:schema",
        now: "2026-08-13T10:00:01.000Z",
        leaseExpiresAt: "2026-08-13T10:01:00.000Z",
      });
      expect(claimed.ok && claimed.value.lease?.record.state).toBe("started");
      expect(() =>
        subject.database
          .query(
            "UPDATE service_effect_s05_outbox SET state='completed',certainty='applied' WHERE outbox_id='schema-pending'",
          )
          .run(),
      ).toThrow();
      if (!claimed.ok || !claimed.value.lease) throw new Error("claim");
      await subject.store.complete({
        outboxId: "schema-pending",
        workerId: claimed.value.lease.workerId,
        expectedAttempt: 1,
        leaseToken: claimed.value.lease.record.leaseToken,
        receiptRef: null,
        completedAt: "2026-08-13T10:00:30.000Z",
      });
      const seed = async (id: string) => {
        await subject.store.enqueue(schemaEnqueue(id));
        const result = await subject.store.claimNext({
          kinds: ["maintenance"],
          workerId: `worker:${id}`,
          leaseToken: `lease:${id}`,
          now: "2026-08-13T10:00:01.000Z",
          leaseExpiresAt: "2026-08-13T10:01:00.000Z",
        });
        if (!result.ok || !result.value.lease) throw new Error("claim");
        return result.value.lease;
      };
      const failed = await seed("schema-failed");
      await subject.store.fail({
        outboxId: "schema-failed",
        workerId: failed.workerId,
        expectedAttempt: 1,
        leaseToken: failed.record.leaseToken,
        errorTag: "fatal",
        certainty: "not_applied",
        retryAt: null,
        failedAt: "2026-08-13T10:00:30.000Z",
      });
      const unknown = await seed("schema-unknown");
      await subject.store.markUnknown({
        outboxId: "schema-unknown",
        workerId: unknown.workerId,
        expectedAttempt: 1,
        leaseToken: unknown.record.leaseToken,
        errorTag: "ambiguous",
        certainty: "unknown",
        observedAt: "2026-08-13T10:00:30.000Z",
      });
      const cancelled = await seed("schema-cancelled");
      await subject.store.markUnknown({
        outboxId: "schema-cancelled",
        workerId: cancelled.workerId,
        expectedAttempt: 1,
        leaseToken: cancelled.record.leaseToken,
        errorTag: "ambiguous",
        certainty: "unknown",
        observedAt: "2026-08-13T10:00:30.000Z",
      });
      await subject.store.resolveUnknown({
        outboxId: "schema-cancelled",
        expectedAttempt: 1,
        reconciliationRef: "reconciliation:schema",
        reconciledAt: "2026-08-13T10:02:00.000Z",
        resolution: { kind: "cancelled", reasonTag: "operator" },
      });
      expect(
        subject.database
          .query(
            "SELECT group_concat(state, ',') states FROM (SELECT state FROM service_effect_s05_outbox ORDER BY state)",
          )
          .get(),
      ).toEqual({ states: "cancelled,completed,failed,unknown" });
      expect(subject.database.query("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
    } finally {
      subject.dispose?.();
    }
  });

  test("hash instant tag and length bounds reject malformed durable values", async () => {
    const subject = sqliteSubject(":memory:", context(), [], false);
    try {
      await subject.store.enqueue(schemaEnqueue("schema-bounds"));
      for (const [column, value] of [
        ["request_hash", "x"],
        ["enqueued_at", "not-an-instant"],
        ["payload_ref", "x".repeat(2049)],
        ["outbox_id", "x".repeat(513)],
      ] as const) {
        expect(() =>
          subject.database
            .query(
              `UPDATE service_effect_s05_outbox SET ${column}=? WHERE outbox_id='schema-bounds'`,
            )
            .run(value),
        ).toThrow();
      }
      const claimed = await subject.store.claimNext({
        kinds: ["maintenance"],
        workerId: "worker:schema-bounds",
        leaseToken: "lease:schema-bounds",
        now: "2026-08-13T10:00:01.000Z",
        leaseExpiresAt: "2026-08-13T10:01:00.000Z",
      });
      if (!claimed.ok || !claimed.value.lease) throw new Error("claim");
      await subject.store.fail({
        outboxId: "schema-bounds",
        workerId: claimed.value.lease.workerId,
        expectedAttempt: 1,
        leaseToken: claimed.value.lease.record.leaseToken,
        errorTag: "fatal",
        certainty: "not_applied",
        retryAt: null,
        failedAt: "2026-08-13T10:00:30.000Z",
      });
      expect(() =>
        subject.database
          .query(
            "UPDATE service_effect_s05_outbox SET last_error_tag='bad tag' WHERE outbox_id='schema-bounds'",
          )
          .run(),
      ).toThrow();
    } finally {
      subject.dispose?.();
    }
  });

  test("hashed lease authority is permanent unique and contains no plaintext token", async () => {
    const subject = sqliteSubject(":memory:", context(), [], false);
    const token = "opaque:plaintext-lease-token";
    try {
      await subject.store.enqueue(schemaEnqueue("schema-token"));
      const claimed = await subject.store.claimNext({
        kinds: ["maintenance"],
        workerId: "worker:schema-token",
        leaseToken: token,
        now: "2026-08-13T10:00:01.000Z",
        leaseExpiresAt: "2026-08-13T10:01:00.000Z",
      });
      if (!claimed.ok || !claimed.value.lease) throw new Error("claim");
      await subject.store.fail({
        outboxId: "schema-token",
        workerId: claimed.value.lease.workerId,
        expectedAttempt: 1,
        leaseToken: token,
        errorTag: "fatal",
        certainty: "not_applied",
        retryAt: null,
        failedAt: "2026-08-13T10:00:30.000Z",
      });
      await subject.store.cleanupTerminal({
        cleanupId: "cleanup:schema-token",
        before: "2026-08-13T11:00:00.000Z",
        after: null,
        limit: 1,
      });
      const removed = await subject.store.get("schema-token");
      expect(removed.ok && removed.value).toBeNull();
      const lease = subject.database
        .query("SELECT * FROM service_effect_s05_leases")
        .get() as Record<string, unknown>;
      expect(lease.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(lease)).not.toContain(token);
      expect(() =>
        subject.database.exec(
          "INSERT INTO service_effect_s05_leases SELECT * FROM service_effect_s05_leases LIMIT 1",
        ),
      ).toThrow();
      for (const table of [
        "service_effect_s05_leases",
        "service_effect_s05_outcomes",
        "service_effect_s05_resolutions",
        "service_effect_s05_decisions",
      ]) {
        const columns = subject.database
          .query(`PRAGMA table_info(${table})`)
          .all() as Array<{ name: string }>;
        expect(columns.map(({ name }) => name)).not.toContain("lease_token");
        expect(
          JSON.stringify(
            subject.database.query(`SELECT * FROM ${table}`).all(),
          ),
        ).not.toContain(token);
      }
    } finally {
      subject.dispose?.();
    }
  });

  test("failed install rolls back all tables", () => {
    const db = new Database(":memory:", { strict: true });
    db.exec("CREATE VIEW service_effect_s05_outbox AS SELECT 1 value");
    expect(() => installServiceOutboxSchema(db)).toThrow();
    expect(
      (
        db
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'service_effect_s05_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);
    db.close();
  });
});
