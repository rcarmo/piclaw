import { Database } from "bun:sqlite";
import { describe, expect, spyOn, test } from "bun:test";
import { createCurrentPiclawServiceOutboxStore, createServiceOutboxEnqueueInserter } from "../../src/service-effects/current-piclaw/service-outbox-store.js";
import { installServiceOutboxSchema } from "../../src/service-effects/current-piclaw/service-outbox-schema.js";
import { installServiceWorkSchema } from "../../src/service-effects/current-piclaw/service-work-schema.js";
import { installTerminalSettlementCompositionSchema } from "../../src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../src/service-effects/current-piclaw/terminal-settlement-store.js";
import { installTimelineMediaAdapterTestSchema } from "../../src/service-effects/current-piclaw/timeline-media-test-schema.js";
import { Payloads, Runtime } from "./terminal-settlement-test-support.js";

describe("EF-S02 composition schema and construction hardening", () => {
  test("installer composes inside one caller transaction and is idempotent", () => {
    const database = new Database(":memory:", { strict: true });
    database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    installTerminalSettlementCompositionSchema(database);
    expect(
      (
        database
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE name LIKE 'service_effect_s02_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBeGreaterThan(0);
    database.exec("ROLLBACK");
    expect(
      (
        database
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE name LIKE 'service_effect_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);
    installTerminalSettlementCompositionSchema(database);
    installTerminalSettlementCompositionSchema(database);
    expect(
      (
        database
          .query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'service_effect_s02_%' ORDER BY name",
          )
          .all() as { name: string }[]
      ),
    ).toEqual([{ name: "service_effect_s02_commit_outbox" }, { name: "service_effect_s02_commits" }]);
    database.close();
  });

  test("installer rolls back every prerequisite and S02 object boundary", () => {
    const boundaries = [
      "service_work",
      "timeline_media",
      "service_outbox",
      "s02_commits",
      "s02_commit_outbox",
          "s02_commit_chat_index",
    ] as const;
    for (const expected of boundaries) {
      const database = new Database(":memory:", { strict: true });
      database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
      expect(() =>
        installTerminalSettlementCompositionSchema(database, {
          afterBoundary(boundary) {
            if (boundary === expected) throw new Error(`stop:${boundary}`);
          },
        }),
      ).toThrow(`stop:${expected}`);
      expect(database.inTransaction).toBeTrue();
      database.exec("ROLLBACK");
      expect(
        (
          database
            .query(
              "SELECT count(*) n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
            )
            .get() as { n: number }
        ).n,
      ).toBe(0);
      database.close();
    }
  });

  test("standalone transaction commit and rollback plus pre-created prerequisites compose", () => {
    const committed = new Database(":memory:", { strict: true });
    committed.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    installTerminalSettlementCompositionSchema(committed);
    committed.exec("COMMIT");
    expect(
      createCurrentPiclawTerminalSettlementStore(
        committed,
        new Payloads(),
        new Runtime(),
      ).ok,
    ).toBeTrue();
    committed.close();

    const precreated = new Database(":memory:", { strict: true });
    precreated.exec("PRAGMA foreign_keys=ON");
    installServiceWorkSchema(precreated);
    installTimelineMediaAdapterTestSchema(precreated);
    installServiceOutboxSchema(precreated);
    installTerminalSettlementCompositionSchema(precreated);
    expect(
      createCurrentPiclawTerminalSettlementStore(
        precreated,
        new Payloads(),
        new Runtime(),
      ).ok,
    ).toBeTrue();
    precreated.close();
  });

  test("FTS object collision aborts without leaking prerequisite objects", () => {
    const database = new Database(":memory:", { strict: true });
    database.exec("PRAGMA foreign_keys=ON; CREATE TABLE messages_fts(x TEXT)");
    expect(() => installTerminalSettlementCompositionSchema(database)).toThrow();
    expect(
      (
        database
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE name LIKE 'service_effect_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);
    expect(
      (
        database
          .query("SELECT count(*) n FROM pragma_table_info('messages_fts')")
          .get() as { n: number }
      ).n,
    ).toBe(1);
    database.close();
  });

  test("unrelated historical FK violations preserve rows and do not block construction", () => {
    const database = new Database(":memory:", { strict: true });
    try {
      installTerminalSettlementCompositionSchema(database);
      database.exec(`
        CREATE TABLE legacy_parent(id INTEGER PRIMARY KEY);
        CREATE TABLE dummyLegacyLogFK(parent_id INTEGER REFERENCES legacy_parent(id));
        PRAGMA foreign_keys=OFF;
        INSERT INTO dummyLegacyLogFK VALUES(1);
        PRAGMA foreign_keys=ON;
      `);
      const before = database.query("PRAGMA foreign_key_check").all();
      expect(before).toHaveLength(1);
      expect(createCurrentPiclawTerminalSettlementStore(database, new Payloads(), new Runtime()).ok).toBeTrue();
      expect(createServiceOutboxEnqueueInserter(database).ok).toBeTrue();
      expect(createCurrentPiclawServiceOutboxStore(database, {
        hitFault() {}, recordTrace() {},
      }).ok).toBeTrue();
      expect(database.query("PRAGMA foreign_key_check").all()).toEqual(before);
      expect(database.query("SELECT * FROM dummyLegacyLogFK").all()).toEqual([{ parent_id: 1 }]);
      expect(() => database.exec("INSERT INTO dummyLegacyLogFK VALUES(2)")).toThrow();
    } finally {
      database.close();
    }
  });

  test("construction checks every owned table without scanning unrelated SDK history", () => {
    const database = new Database(":memory:", { strict: true });
    try {
      installTerminalSettlementCompositionSchema(database);
      const owned = (database.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'piclaw_schema_migrations'").all() as { name: string }[]).map(row => row.name).sort();
      database.exec("CREATE TABLE unrelated_sdk_history(payload TEXT)");
      const query = database.query.bind(database);
      const observed: string[] = [];
      const probe = spyOn(database, "query").mockImplementation((sql: string) => {
        observed.push(sql);
        if (/^PRAGMA (foreign_key_check|quick_check)\s*$/i.test(sql)) throw Error("Unscoped database scan");
        return query(sql);
      });
      try {
        expect(createCurrentPiclawTerminalSettlementStore(database, new Payloads(), new Runtime()).ok).toBeTrue();
        for (const pragma of ["foreign_key_check", "quick_check"]) {
          const checked = observed.flatMap(sql => {
            const match = sql.match(new RegExp(`^PRAGMA ${pragma}\\("([a-z_0-9]+)"\\)$`));
            return match ? [match[1]!] : [];
          }).sort();
          expect(checked).toEqual(owned);
        }
      } finally { probe.mockRestore(); }
    } finally { database.close(); }
  });

  test("owned table CHECK corruption still rejects terminal construction", () => {
    const database = new Database(":memory:", { strict: true });
    try {
      installTerminalSettlementCompositionSchema(database);
      database.exec(`
        ALTER TABLE chats ADD COLUMN integrity_guard INTEGER CHECK(integrity_guard>0);
        PRAGMA ignore_check_constraints=ON;
        INSERT INTO chats(jid,name,last_message_time,integrity_guard) VALUES('corrupt','corrupt','2026-11-02T00:00:00.000Z',-1);
        PRAGMA ignore_check_constraints=OFF;
      `);
      expect(database.query('PRAGMA foreign_key_check("chats")').all()).toEqual([]);
      expect(database.query('PRAGMA quick_check("chats")').all()).not.toEqual([{ quick_check: "ok" }]);
      expect(createCurrentPiclawTerminalSettlementStore(database, new Payloads(), new Runtime()).ok).toBeFalse();
      expect(database.query("SELECT integrity_guard FROM chats WHERE jid='corrupt'").get()).toEqual({ integrity_guard: -1 });
    } finally { database.close(); }
  });

  test("required S02 and S05 table FK violations still reject terminal construction", () => {
    for (const table of ["service_effect_s02_commit_outbox", "service_effect_s05_decisions"]) {
      const database = new Database(":memory:", { strict: true });
      try {
        installTerminalSettlementCompositionSchema(database);
        database.exec("PRAGMA foreign_keys=OFF");
        if (table === "service_effect_s02_commit_outbox") {
          database.exec("INSERT INTO service_effect_s02_commit_outbox VALUES('missing-operation',0,'missing-outbox')");
        } else {
          database.exec(`
            CREATE TABLE legacy_parent(id INTEGER PRIMARY KEY);
            ALTER TABLE service_effect_s05_decisions ADD COLUMN parent_id INTEGER REFERENCES legacy_parent(id);
            INSERT INTO service_effect_s05_decisions(decision_key,method,request_hash,outcome,outbox_id,parent_id)
            VALUES('decision','enqueue','${"a".repeat(64)}','applied','outbox',1);
          `);
        }
        database.exec("PRAGMA foreign_keys=ON");
        expect(database.query("PRAGMA foreign_key_check").all().length).toBeGreaterThan(0);
        expect(createCurrentPiclawTerminalSettlementStore(database, new Payloads(), new Runtime()).ok).toBeFalse();
      } finally {
        database.close();
      }
    }
  });

  test("factory rejects missing disabled incomplete and incompatible schemas", () => {
    const payloads = new Payloads();
    const runtime = new Runtime();
    const missing = new Database(":memory:", { strict: true });
    expect(
      createCurrentPiclawTerminalSettlementStore(missing, payloads, runtime).ok,
    ).toBeFalse();
    missing.close();

    const disabled = new Database(":memory:", { strict: true });
    installTerminalSettlementCompositionSchema(disabled);
    disabled.exec("PRAGMA foreign_keys=OFF");
    expect(
      createCurrentPiclawTerminalSettlementStore(disabled, payloads, runtime).ok,
    ).toBeFalse();
    disabled.close();

    const incomplete = new Database(":memory:", { strict: true });
    installTerminalSettlementCompositionSchema(incomplete);
    incomplete.exec("DROP TRIGGER messages_ai");
    expect(
      createCurrentPiclawTerminalSettlementStore(incomplete, payloads, runtime)
        .ok,
    ).toBeFalse();
    incomplete.close();

    const incompatible = new Database(":memory:", { strict: true });
    installTerminalSettlementCompositionSchema(incompatible);
    incompatible.exec(`
      PRAGMA foreign_keys=OFF;
      DROP TABLE service_effect_s02_commit_outbox;
      DROP TABLE service_effect_s02_commits;
      CREATE TABLE service_effect_s02_commits(idempotency_key TEXT PRIMARY KEY);
      CREATE TABLE service_effect_s02_commit_outbox(operation_id TEXT PRIMARY KEY);
      PRAGMA foreign_keys=ON;
    `);
    expect(
      createCurrentPiclawTerminalSettlementStore(incompatible, payloads, runtime)
        .ok,
    ).toBeFalse();
    incompatible.close();
  });

  test("factory rejects each required table index and trigger when absent", () => {
    const required = {
      table: [
        "chats",
        "media",
        "message_media",
        "messages",
        "messages_fts",
        "service_effect_media_deletions",
        "service_effect_media_upload_history",
        "service_effect_media_uploads",
        "service_effect_operation_media",
        "service_effect_outbox_media_refs",
        "service_effect_s01_chats",
        "service_effect_s01_decisions",
        "service_effect_s01_intents",
        "service_effect_s01_operation_sources",
        "service_effect_s01_operations",
        "service_effect_s01_queued_inputs",
        "service_effect_s01_sources",
        "service_effect_s01_wake_intents",
        "service_effect_s02_commit_outbox",
        "service_effect_s02_commits",
        "service_effect_s05_decisions",
        "service_effect_s05_leases",
        "service_effect_s05_outbox",
        "service_effect_s05_outcomes",
        "service_effect_s05_resolutions",
        "service_effect_timeline_writes",
      ],
      index: [
        "service_effect_draft_revision",
        "service_effect_notice_source",
        "service_effect_operation_media_id",
        "service_effect_outbox_media_id",
        "service_effect_s01_one_active_operation",
        "service_effect_s01_open_operations",
        "service_effect_s01_pending_sources",
        "service_effect_s02_commit_chat",
        "service_effect_s05_decision_outbox",
        "service_effect_s05_expired_started",
        "service_effect_s05_failed_claim",
        "service_effect_s05_lease_outbox",
        "service_effect_s05_operation_lookup",
        "service_effect_s05_pending_claim",
        "service_effect_s05_terminal_cleanup",
        "service_effect_s05_unknown_list",
        "service_effect_timeline_operation",
      ],
      trigger: ["messages_ad", "messages_ai", "messages_au"],
    } as const;
    for (const [type, names] of Object.entries(required)) {
      for (const name of names) {
        const database = new Database(":memory:", { strict: true });
        installTerminalSettlementCompositionSchema(database);
        database.exec("PRAGMA foreign_keys=OFF");
        database.exec(`DROP ${type.toUpperCase()} ${name}`);
        database.exec("PRAGMA foreign_keys=ON");
        expect(
          createCurrentPiclawTerminalSettlementStore(
            database,
            new Payloads(),
            new Runtime(),
          ).ok,
        ).toBeFalse();
        database.close();
      }
    }
  });
});
