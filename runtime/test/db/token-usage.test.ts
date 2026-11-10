/**
 * test/db/token-usage.test.ts – Tests for token usage tracking.
 *
 * Verifies token_usage table operations: recording, querying by time
 * range, aggregation, and summary formatting.
 */

import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import "../helpers.js";

import {
  getLatestTokenUsage,
  getLatestTokenUsageModel,
  getTokenUsageByModel,
  getTokenUsageByProvider,
  getTokenUsageTotals,
  initDatabase,
  storeTokenUsage,
} from "../../src/db.js";
import { getDb, initializeDatabaseSchema } from "../../src/db/connection.js";

describe("token-usage", () => {
  test("chat totals use a covering index without changing legacy counts or provenance", () => {
    initDatabase();
    const db = getDb();
    const chatJid = "test:covering-totals";
    for (const [i, provenance] of [null, "provider_reported", "catalogue_estimate", "unavailable"].entries()) {
      storeTokenUsage({
        chat_jid: chatJid, run_at: "2026-11-07T00:00:00.000Z",
        input_tokens: i + 1, output_tokens: 2, reasoning_tokens: 3,
        cache_read_tokens: 4, cache_write_tokens: 5, total_tokens: i + 15,
        cost_input: 0, cost_output: 0, cost_cache_read: 0, cost_cache_write: 0,
        cost_total: i / 100, cost_provenance: provenance as any,
      });
    }
    db.query("UPDATE token_usage SET input_tokens=NULL, cost_total=NULL WHERE chat_jid=? AND cost_provenance IS NULL").run(chatJid);
    let query = "";
    const prepare = db.prepare.bind(db);
    const original = db.prepare;
    db.prepare = ((sql: string) => { query = sql; return prepare(sql); }) as typeof db.prepare;
    let totals;
    try { totals = getTokenUsageTotals(chatJid); }
    finally { db.prepare = original; }
    expect(query).toContain("FROM token_usage");
    expect(db.query("EXPLAIN QUERY PLAN " + query).all(chatJid)).toEqual(expect.arrayContaining([
      expect.objectContaining({ detail: "SEARCH token_usage USING COVERING INDEX idx_token_usage_chat_totals_covering_v2 (chat_jid=?)" }),
    ]));
    expect(totals).toEqual(db.query(query.replace("FROM token_usage", "FROM token_usage NOT INDEXED")).get(chatJid) as any);
    expect(totals).toMatchObject({ runs: 4, input_tokens: 9, provider_reported_cost_runs: 1,
      catalogue_estimate_cost_runs: 1, unavailable_cost_runs: 1, legacy_cost_runs: 1 });
    expect(getTokenUsageTotals("test:no-covering-rows")).toMatchObject({ runs: 0, total_tokens: 0 });
    // All rows share a timestamp: the existing newest-id tie-break remains exact.
    expect(getLatestTokenUsage(chatJid)).toMatchObject({ input_tokens: 4, cost_provenance: "unavailable" });
  });

  test("legacy token columns migrate before the covering index and repeated startup preserves rows", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT, chat_jid TEXT NOT NULL, run_at TEXT NOT NULL,
        input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
        cache_write_tokens INTEGER, total_tokens INTEGER, cost_input REAL, cost_output REAL,
        cost_cache_read REAL, cost_cache_write REAL, cost_total REAL, model TEXT, provider TEXT,
        api TEXT, turns INTEGER);
        INSERT INTO token_usage(chat_jid,run_at,input_tokens,total_tokens,cost_total)
        VALUES('test:legacy-covering','2026-01-01T00:00:00Z',NULL,7,NULL);`);
      const original = db.query("SELECT id,chat_jid,run_at,input_tokens,total_tokens,cost_total FROM token_usage").all();
      initializeDatabaseSchema(db);
      initializeDatabaseSchema(db);
      expect(db.query("SELECT id,chat_jid,run_at,input_tokens,total_tokens,cost_total FROM token_usage").all()).toEqual(original);
      expect((db.query("PRAGMA index_info(idx_token_usage_chat_totals_covering_v2)").all() as { name: string }[]).map(row => row.name)).toEqual([
        "chat_jid", "run_at", "id", "input_tokens", "output_tokens", "reasoning_tokens",
        "cache_read_tokens", "cache_write_tokens", "total_tokens", "cost_total", "cost_provenance",
        "provider_cost_total", "provider_cost_currency", "catalogue_cost_total", "pricing_currency",
      ]);
      expect(db.query("SELECT name FROM sqlite_master WHERE name='idx_token_usage_chat_jid_run_at'").get()).not.toBeNull();
      db.query("INSERT INTO token_usage(chat_jid,run_at,total_tokens) VALUES(?,?,?)").run("test:legacy-covering", "2026-01-02T00:00:00Z", 3);
      expect(db.query("SELECT sum(total_tokens) total FROM token_usage").get()).toEqual({ total: 10 });
    } finally { db.close(); }
  });

  test("storeTokenUsage inserts a record", () => {
    initDatabase();
    const db = getDb();

    storeTokenUsage({
      chat_jid: "test:token",
      run_at: new Date().toISOString(),
      input_tokens: 100,
      output_tokens: 50,
      reasoning_tokens: 7,
      cache_read_tokens: 10,
      cache_write_tokens: 5,
      total_tokens: 165,
      cost_input: 0.001,
      cost_output: 0.002,
      cost_cache_read: 0.0001,
      cost_cache_write: 0.00005,
      cost_total: 0.00315,
      model: "gpt-4",
      provider: "openai",
      api: "chat",
      turns: 3,
    });

    const row = db.prepare("SELECT * FROM token_usage WHERE chat_jid = ?").get("test:token") as any;
    expect(row).toBeDefined();
    expect(row.input_tokens).toBe(100);
    expect(row.output_tokens).toBe(50);
    expect(row.reasoning_tokens).toBe(7);
    expect(row.total_tokens).toBe(165);
    expect(row.model).toBe("gpt-4");
    expect(row.response_model).toBeNull();
    expect(row.provider).toBe("openai");
    expect(row.turns).toBe(3);
  });

  test("storeTokenUsage preserves cache and cost provenance fields", () => {
    initDatabase();
    const chatJid = "test:token-provenance";

    storeTokenUsage({
      chat_jid: chatJid,
      run_at: "2026-08-25T12:00:00.000Z",
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: 0,
      cache_write_tokens: 5,
      cache_read_reported: true,
      cache_write_reported: false,
      total_tokens: 125,
      cost_input: 0.001,
      cost_output: 0.002,
      cost_cache_read: 0,
      cost_cache_write: 0.0001,
      cost_total: 0.00123,
      provider_cost_total: 0.00123,
      catalogue_cost_total: 0.0031,
      cost_provenance: "provider_reported",
      model: "auto",
      provider: "openrouter",
    });

    const latest = getLatestTokenUsage(chatJid);
    expect(latest).toMatchObject({
      cache_read_reported: 1,
      cache_write_reported: 0,
      provider_cost_total: 0.00123,
      catalogue_cost_total: 0.0031,
      cost_total: 0.00123,
      cost_provenance: "provider_reported",
    });
    const totals = getTokenUsageTotals(chatJid);
    expect(totals.provider_reported_cost_runs).toBe(1);
    expect(totals.catalogue_estimate_cost_runs).toBe(0);
    expect(totals.unavailable_cost_runs).toBe(0);
    expect(totals.legacy_cost_runs).toBe(0);
  });

  test("storeTokenUsage handles null optional fields", () => {
    initDatabase();
    const db = getDb();

    storeTokenUsage({
      chat_jid: "test:token-null",
      run_at: new Date().toISOString(),
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 15,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0,
    });

    const row = db.prepare("SELECT * FROM token_usage WHERE chat_jid = ?").get("test:token-null") as any;
    expect(row).toBeDefined();
    expect(row.model).toBeNull();
    expect(row.response_model).toBeNull();
    expect(row.provider).toBeNull();
    expect(row.turns).toBeNull();
  });

  test("aggregates overall totals, provider totals, and model totals", () => {
    initDatabase();

    const chatJid = "test:aggregate";
    storeTokenUsage({
      chat_jid: chatJid,
      run_at: new Date().toISOString(),
      input_tokens: 100,
      output_tokens: 50,
      reasoning_tokens: 15,
      cache_read_tokens: 10,
      cache_write_tokens: 0,
      total_tokens: 160,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0.16,
      provider: "openai",
      model: "gpt-4o",
    });

    storeTokenUsage({
      chat_jid: chatJid,
      run_at: new Date().toISOString(),
      input_tokens: 90,
      output_tokens: 30,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 120,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0.12,
      provider: "openai",
      model: "gpt-4o",
    });

    storeTokenUsage({
      chat_jid: chatJid,
      run_at: new Date().toISOString(),
      input_tokens: 40,
      output_tokens: 20,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 60,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0.06,
      provider: "anthropic",
      model: "claude",
    });

    const totals = getTokenUsageTotals(chatJid);
    expect(totals.total_tokens).toBe(340);
    expect(totals.reasoning_tokens).toBe(15);
    expect(totals.runs).toBe(3);

    const provider = getTokenUsageByProvider(chatJid, 10);
    expect(provider.length).toBe(2);
    expect(provider[0].provider).toBe("openai");
    expect(provider[0].total_tokens).toBe(280);
    expect(provider[0].runs).toBe(2);

    const model = getTokenUsageByModel(chatJid, 10);
    expect(model.length).toBe(2);
    expect(model[0].model).toBe("gpt-4o");
    expect(model[0].total_tokens).toBe(280);
    expect(model[0].runs).toBe(2);
  });

  test("groups model totals by concrete response model when present", () => {
    initDatabase();
    const chatJid = "test:response-model";

    storeTokenUsage({
      chat_jid: chatJid,
      run_at: new Date().toISOString(),
      input_tokens: 20,
      output_tokens: 10,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 30,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0.03,
      provider: "openrouter",
      model: "auto",
      response_model: "anthropic/claude-sonnet-4-5",
    });

    const model = getTokenUsageByModel(chatJid, 10);
    expect(model).toHaveLength(1);
    expect(model[0].model).toBe("anthropic/claude-sonnet-4-5");
    expect(model[0].total_tokens).toBe(30);
  });

  test("returns the latest requested and response model metadata for compose status", () => {
    initDatabase();
    const chatJid = "test:latest-response-model";

    storeTokenUsage({
      chat_jid: chatJid,
      run_at: "2026-05-01T10:00:00.000Z",
      input_tokens: 1,
      output_tokens: 1,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 2,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0,
      provider: "openrouter",
      model: "auto",
      response_model: "anthropic/claude-sonnet-4-5",
    });
    storeTokenUsage({
      chat_jid: chatJid,
      run_at: "2026-05-01T10:01:00.000Z",
      input_tokens: 2,
      output_tokens: 2,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 4,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0,
      provider: "openrouter",
      model: "auto",
      response_model: "google/gemini-2.5-pro",
    });

    expect(getLatestTokenUsageModel(chatJid)).toEqual({
      model: "auto",
      response_model: "google/gemini-2.5-pro",
      provider: "openrouter",
      run_at: "2026-05-01T10:01:00.000Z",
    });
  });

  test("coalesces grouped token usage aggregates when legacy rows contain null counts", () => {
    initDatabase();
    const db = getDb();
    const chatJid = "test:aggregate-null";
    db.prepare(
      `INSERT INTO token_usage (
        chat_jid,
        run_at,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        total_tokens,
        cost_input,
        cost_output,
        cost_cache_read,
        cost_cache_write,
        cost_total,
        model,
        provider,
        api,
        turns
      ) VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, ?, ?, NULL, NULL)`
    ).run(chatJid, new Date().toISOString(), "legacy-model", "legacy-provider");

    const provider = getTokenUsageByProvider(chatJid, 10);
    expect(provider).toEqual([{
      provider: "legacy-provider",
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 0,
      cost_total: null, cost_currency:null, provider_cost_total:null, provider_cost_currency:null, catalogue_cost_total:null,
      runs: 1,
      provider_reported_cost_runs: 0,
      catalogue_estimate_cost_runs: 0,
      unavailable_cost_runs: 0,
      legacy_cost_runs: 1,
    }]);

    const model = getTokenUsageByModel(chatJid, 10);
    expect(model).toEqual([{
      model: "legacy-model",
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 0,
      cost_total: null, cost_currency:null, provider_cost_total:null, provider_cost_currency:null, catalogue_cost_total:null,
      runs: 1,
      provider_reported_cost_runs: 0,
      catalogue_estimate_cost_runs: 0,
      unavailable_cost_runs: 0,
      legacy_cost_runs: 1,
    }]);
  });
});

for(const currencies of [['USD','USD'],['USD','EUR'],['USD',null],[null,null]] as const)test(`provider cost aggregation keeps units: ${currencies.join('/')}`,()=>{
 initDatabase();const db=getDb(),chat='test:currency:'+JSON.stringify(currencies);
 for(const [index,currency]of currencies.entries())storeTokenUsage({chat_jid:chat,run_at:'2026-11-10T00:00:00.000Z',provider:'currency-provider',model:'currency-model',input_tokens:1,output_tokens:1,cache_read_tokens:0,cache_write_tokens:0,total_tokens:2,cost_input:1,cost_output:0,cost_cache_read:0,cost_cache_write:0,cost_total:index,provider_cost_total:index,provider_cost_currency:currency,catalogue_cost_total:1,pricing_currency:'USD',cost_provenance:'provider_reported'});
 const known=currencies[0]==='USD'&&currencies[1]==='USD';
 for(const row of [getTokenUsageTotals(chat),getTokenUsageByProvider(chat)[0]!,getTokenUsageByModel(chat)[0]!])expect(row).toMatchObject({total_tokens:4,runs:2,cost_total:known?1:null,cost_currency:known?'USD':null,provider_cost_total:known?1:null,provider_cost_currency:known?'USD':null,catalogue_cost_total:2,provider_reported_cost_runs:2});
 expect(getLatestTokenUsage(chat)).toMatchObject({provider_cost_total:1,provider_cost_currency:currencies[1]});
 expect(db.query('SELECT provider_cost_total,provider_cost_currency FROM token_usage WHERE chat_jid=? ORDER BY id').all(chat)).toEqual(currencies.map((currency,index)=>({provider_cost_total:index,provider_cost_currency:currency})));
});
test('provider zero USD stays known while anonymous legacy amounts stay unclassified',()=>{
 initDatabase();const chat='test:currency-zero';storeTokenUsage({chat_jid:chat,run_at:'2026-11-10T00:00:00.000Z',input_tokens:0,output_tokens:0,cache_read_tokens:0,cache_write_tokens:0,total_tokens:0,cost_input:0,cost_output:0,cost_cache_read:0,cost_cache_write:0,cost_total:0,provider_cost_total:0,provider_cost_currency:'USD',cost_provenance:'provider_reported'});
 expect(getTokenUsageTotals(chat)).toMatchObject({cost_total:0,cost_currency:'USD',provider_cost_total:0,provider_cost_currency:'USD',catalogue_cost_total:null});
 expect(getTokenUsageTotals('test:no-currency-observations')).toMatchObject({cost_total:null,cost_currency:null,provider_cost_total:null});
});

for(const custom of [false,true])test(`currency index upgrade preserves rows and ${custom?'an unknown old declaration':'retires only the known old declaration'}`,()=>{
 const db=new Database(':memory:');try{
 initializeDatabaseSchema(db);db.exec('DROP INDEX idx_token_usage_chat_totals_covering_v2');
 const suffix=custom?" WHERE cost_total>0":"";
 db.exec('CREATE INDEX idx_token_usage_chat_totals_covering ON token_usage (chat_jid, run_at, id, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost_total, cost_provenance)'+suffix);
 db.exec("INSERT INTO token_usage(chat_jid,run_at,provider_cost_total,cost_total) VALUES('historical-unknown','2026-01-01',5,5)");const before=db.query('SELECT * FROM token_usage').all(),index=db.query("SELECT sql FROM sqlite_schema WHERE name='idx_token_usage_chat_totals_covering'").get();
 initializeDatabaseSchema(db);initializeDatabaseSchema(db);
 expect(db.query('SELECT * FROM token_usage').all()).toEqual(before);expect(db.query("SELECT sql FROM sqlite_schema WHERE name='idx_token_usage_chat_totals_covering'").get()).toEqual(custom?index:null);
 expect(db.query("SELECT name FROM sqlite_schema WHERE name='idx_token_usage_chat_totals_covering_v2'").get()).not.toBeNull();
 }finally{db.close();}
});
