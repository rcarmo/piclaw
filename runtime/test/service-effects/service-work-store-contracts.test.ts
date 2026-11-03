import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import type {
  ContractSubjectFactory,
  ContractTestContext,
} from "../../src/service-effects/testing/contract-suite.js";
import {
  ManualEffectClock,
  SequenceEffectIdSource,
} from "../../src/service-effects/testing/deterministic-controls.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import { EffectTraceRecorder } from "../../src/service-effects/testing/trace-recorder.js";
import {
  createCurrentPiclawServiceWorkStore,
  CurrentPiclawServiceWorkStore,
  type ServiceWorkAdapterRuntime,
} from "../../src/service-effects/current-piclaw/service-work-store.js";
import { installServiceWorkSchema } from "../../src/service-effects/current-piclaw/service-work-schema.js";
import { FakeServiceWorkStore } from "../../src/service-effects/testing/fakes/fake-service-work-store.js";
import {
  defineServiceWorkStoreContract,
  type ServiceWorkContractSubject,
  type ServiceWorkInspection,
  type ServiceWorkMutationMethod,
} from "../../src/service-effects/testing/contract-suites/service-work-store-contract.js";
import type {
  NormalisedEffectTrace,
  NormalisedTraceInput,
} from "../../src/service-effects/contracts/common.js";

function context(): ContractTestContext {
  return {
    clock: new ManualEffectClock("2026-08-13T07:00:00.000Z"),
    ids: new SequenceEffectIdSource("s01"),
    faults: new DeterministicFaultPlan(),
  };
}
class Runtime implements ServiceWorkAdapterRuntime {
  readonly trace: EffectTraceRecorder;
  readonly faults = new Map<string, Set<number>>();
  readonly faultCounts = new Map<string, number>();
  constructor(
    readonly context: ContractTestContext,
    snapshot: readonly NormalisedEffectTrace[] = [],
  ) {
    this.trace = EffectTraceRecorder.fromSnapshot(snapshot);
  }
  planFault(
    method: ServiceWorkMutationMethod,
    point: "before_effect" | "effect_then_lost_acknowledgement",
    occurrence: number,
  ) {
    const key = `${method}:${point}`;
    const current = this.faultCounts.get(key) ?? 0;
    this.faults.set(key, new Set([current + occurrence]));
  }
  hitFault(
    point: "before_effect" | "effect_then_lost_acknowledgement",
    method?: string,
  ) {
    const key = `${method}:${point}`;
    const planned = this.faults.get(key);
    if (planned) {
      const occurrence = (this.faultCounts.get(key) ?? 0) + 1;
      this.faultCounts.set(key, occurrence);
      return planned.has(occurrence);
    }
    return this.context.faults.hit(point);
  }
  recordTrace(input: NormalisedTraceInput) {
    if (input.resultTag === undefined || input.resultTag === "call")
      this.trace.recordCall(input);
    else this.trace.recordResult(input);
  }
}
interface SqliteSubject extends ServiceWorkContractSubject {
  database: Database;
  path: string;
  runtime: Runtime;
}
function mustCreateCurrentStore(
  database: Database,
  runtime: ServiceWorkAdapterRuntime,
): CurrentPiclawServiceWorkStore {
  const result = createCurrentPiclawServiceWorkStore(database, runtime);
  if (!result.ok) throw new Error("test store construction failed");
  return result.value;
}

function sqliteSubject(
  path: string,
  ctx: ContractTestContext,
  trace: readonly NormalisedEffectTrace[] = [],
): SqliteSubject {
  const database = new Database(path, { strict: true });
  database.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0",
  );
  installServiceWorkSchema(database);
  const runtime = new Runtime(ctx, trace);
  const store = mustCreateCurrentStore(database, runtime);
  return {
    database,
    path,
    runtime,
    store,
    inspect: () => inspectDatabase(database),
    planFault: (method, point, occurrence) =>
      runtime.planFault(method, point, occurrence),
    dispose: () => {
      if (database.open) database.close();
      rmSync(dirname(path), { recursive: true, force: true });
    },
  };
}
function inspectDatabase(database: Database): ServiceWorkInspection {
  const sources = (
    database
      .prepare(
        "SELECT chat_jid,source_seq,state FROM service_effect_s01_sources ORDER BY chat_jid,source_seq",
      )
      .all() as Array<{ chat_jid: string; source_seq: number; state: string }>
  ).map((r) => ({
    chatJid: r.chat_jid,
    sourceSeq: r.source_seq,
    state: r.state,
  }));
  const intents = (
    database
      .prepare(
        "SELECT operation_id,intent_id,payload_ref FROM service_effect_s01_intents ORDER BY operation_id,intent_id",
      )
      .all() as Array<{
      operation_id: string;
      intent_id: string;
      payload_ref: string;
    }>
  ).map((r) => ({
    operationId: r.operation_id,
    intentId: r.intent_id,
    payloadRef: r.payload_ref,
  }));
  const queues = (
    database
      .prepare(
        "SELECT operation_id,source_seq,state FROM service_effect_s01_queued_inputs ORDER BY operation_id,source_seq",
      )
      .all() as Array<{
      operation_id: string;
      source_seq: number;
      state: string;
    }>
  ).map((r) => ({
    operationId: r.operation_id,
    sourceSeq: r.source_seq,
    state: r.state,
  }));
  const wakes = (
    database
      .prepare(
        "SELECT chat_jid,source_seq FROM service_effect_s01_wake_intents ORDER BY chat_jid,source_seq",
      )
      .all() as Array<{ chat_jid: string; source_seq: number }>
  ).map((r) => `${r.chat_jid}:${r.source_seq}`);
  const nextByChat = Object.fromEntries(
    (
      database
        .prepare(
          "SELECT chat_jid,next_source_seq FROM service_effect_s01_chats",
        )
        .all() as Array<{ chat_jid: string; next_source_seq: number }>
    ).map((r) => [r.chat_jid, r.next_source_seq]),
  );
  return { sources, intents, queues, wakes, nextByChat };
}
const sqliteFactory: ContractSubjectFactory<ServiceWorkContractSubject> = {
  name: "current-piclaw-service-work",
  create(ctx) {
    const dir = mkdtempSync(join(tmpdir(), "piclaw-s01-"));
    const path = join(dir, "store.sqlite");
    return sqliteSubject(path, ctx);
  },
  crashAndRestore(subject, ctx) {
    const current = subject as SqliteSubject;
    const trace = current.runtime.trace.snapshot();
    current.database.close();
    const restored = sqliteSubject(current.path, ctx, trace);
    restored.runtime.faults.clear();
    restored.runtime.faultCounts.clear();
    return { subject: restored, context: ctx };
  },
  inspectTrace(subject) {
    return (subject as SqliteSubject).runtime.trace.inspect();
  },
};
const fakeFactory: ContractSubjectFactory<ServiceWorkContractSubject> = {
  name: "fake-service-work",
  create(ctx) {
    const store = new FakeServiceWorkStore(ctx);
    return {
      store,
      inspect: () => store.inspectState(),
      planFault: (method, point, occurrence) =>
        store.planFault(method, point, occurrence),
    };
  },
  crashAndRestore(subject, ctx) {
    const old = subject.store as FakeServiceWorkStore;
    const store = new FakeServiceWorkStore(ctx);
    store.restore(old.snapshot());
    return {
      subject: {
        store,
        inspect: () => store.inspectState(),
        planFault: (method, point, occurrence) =>
          store.planFault(method, point, occurrence),
      },
      context: ctx,
    };
  },
  inspectTrace(subject) {
    return (subject.store as FakeServiceWorkStore).trace.inspect();
  },
};

describe("EF-S01 ServiceWorkStore shared contract", () => {
  // This aggregate runs 18 contract/recovery cases with repeated private-schema creation and fresh SQLite restores.
  test("isolated SQLite adapter", { timeout: 15_000 }, async () => {
    const before = readdirSync(tmpdir())
      .filter((name) => name.startsWith("piclaw-s01-"))
      .sort();
    const results = await defineServiceWorkStoreContract(
      sqliteFactory,
      context,
    );
    expect(results).toHaveLength(18);
    expect(
      readdirSync(tmpdir())
        .filter((name) => name.startsWith("piclaw-s01-"))
        .sort(),
    ).toEqual(before);
  });
  test("independent deterministic fake", async () => {
    const results = await defineServiceWorkStoreContract(fakeFactory, context);
    expect(results).toHaveLength(18);
  });
});
describe("EF-S01 private schema installer", () => {
  test("is explicit idempotent atomic and collision resistant", () => {
    const database = new Database(":memory:", { strict: true });
    installServiceWorkSchema(database);
    installServiceWorkSchema(database);
    const names = (
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'service_effect_s01_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(names).toHaveLength(8);
    expect(
      names.every((name) => name.startsWith("service_effect_s01_")),
    ).toBeTrue();
    database.exec("PRAGMA foreign_keys=ON");
    const insertSource = database.prepare(
      "INSERT INTO service_effect_s01_sources(chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,target_operation_id,parent_source_seq,accepted_at,disposition_reason,provenance_ref,create_wake_intent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const validValues = [
      "missing",
      1,
      "source-1",
      "a".repeat(64),
      "message",
      "pending",
      "payload:1",
      null,
      null,
      "2026-01-01T00:00:00.000Z",
      null,
      "provenance:1",
      0,
    ] as const;
    let constraintCode: unknown;
    try {
      insertSource.run(...validValues);
    } catch (caught) {
      constraintCode = Object.getOwnPropertyDescriptor(
        caught as object,
        "code",
      )?.value;
    }
    expect(constraintCode).toBe("SQLITE_CONSTRAINT_FOREIGNKEY");
    database
      .query("INSERT INTO service_effect_s01_chats(chat_jid) VALUES (?)")
      .run("present");
    expect(() =>
      insertSource.run("present", ...validValues.slice(1)),
    ).not.toThrow();
    expect(
      (
        database
          .query("SELECT COUNT(*) AS count FROM service_effect_s01_sources")
          .get() as { count: number }
      ).count,
    ).toBe(1);
    database.close();
  });
  test("does not appear without explicit installation", () => {
    const database = new Database(":memory:");
    const count = (
      database
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'service_effect_s01_%'",
        )
        .get() as { n: number }
    ).n;
    expect(count).toBe(0);
    database.close();
  });
});
