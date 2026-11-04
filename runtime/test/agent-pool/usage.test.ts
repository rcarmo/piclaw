/**
 * test/agent-pool/usage.test.ts – Tests for token usage recording.
 *
 * Verifies recordMessageUsage() correctly extracts token counts,
 * cache metrics, and cost data from agent message objects and
 * persists them to the token_usage database table.
 */

import { describe, test, expect } from "bun:test";
import "../helpers.js";

import { initDatabase } from "../../src/db.js";
import { getDb } from "../../src/db/connection.js";
import { recordMessageUsage, recordSessionEventUsage } from "../../src/agent-pool/usage.js";
import { withBudgetWorkContext } from "../../src/budget/context.js";
import { ensureBudgetWork } from "../../src/db/budget-limits.js";

describe("recordMessageUsage", () => {
  test('explicit unlinked committed observation cannot borrow an ambient financial work owner', () => {
    initDatabase();
    const db = getDb(), chat = 'test:native-unlinked';
    const work = { workId: 'ambient-report-work', chatJid: 'test:other-owner', kind: 'background' as const };
    ensureBudgetWork({ id: work.workId, chatJid: work.chatJid, executionKind: work.kind }, db);
    const message = { role: 'assistant', timestamp: '2026-11-04T00:00:00Z',
      usage: { input: 1, output: 0, totalTokens: 1, providerCost: 0, cost: { total: 0 } } };
    withBudgetWorkContext(work, () => {
      recordMessageUsage(chat, { ...message, id: 'native-owned-entry' }, null);
      recordMessageUsage(chat, { ...message, id: 'legacy-context-entry' });
    });
    expect(db.query("SELECT work_id,json_extract(report_payload_json,'$.execution_kind') execution_kind FROM budget_usage_events WHERE chat_jid=? ORDER BY token_usage_id").all(chat))
      .toEqual([{ work_id: null, execution_kind: null }, { work_id: work.workId, execution_kind: work.kind }]);
  });

  test("stores usage from a well-formed message", () => {
    initDatabase();
    const db = getDb();

    recordMessageUsage("test:usage-1", {
      role: "assistant",
      usage: {
        input: 100,
        output: 50,
        reasoningTokens: 11,
        cacheRead: 10,
        cacheWrite: 5,
        totalTokens: 165,
        cost: {
          input: 0.001,
          output: 0.002,
          cacheRead: 0.0001,
          cacheWrite: 0.00005,
          total: 0.00315,
        },
      },
      model: "gpt-4o",
      provider: "openai",
      api: "chat",
      timestamp: "2025-06-01T12:00:00Z",
    });

    const row = db.prepare("SELECT * FROM token_usage WHERE chat_jid = ?").get("test:usage-1") as any;
    expect(row).toBeDefined();
    expect(row.input_tokens).toBe(100);
    expect(row.output_tokens).toBe(50);
    expect(row.reasoning_tokens).toBe(11);
    expect(row.total_tokens).toBe(165);
    expect(row.usage_source).toBe("assistant");
    expect(row.model).toBe("gpt-4o");
    expect(row.run_at).toBe("2025-06-01T12:00:00.000Z");
  });

  test("preserves explicit cache reporting and provider cost provenance", () => {
    initDatabase();
    const db = getDb();

    recordMessageUsage("test:usage-provenance", {
      role: "assistant",
      usage: {
        input: 100,
        output: 25,
        cacheRead: 0,
        cacheWrite: 0,
        cacheReadReported: true,
        cacheWriteReported: false,
        providerCost: 0.00123,
        totalTokens: 125,
        cost: { total: 0.00456 },
      },
      model: "auto",
      responseModel: "anthropic/claude-sonnet-4-5",
      provider: "openrouter",
      api: "openai-completions",
    });

    const row = db.prepare("SELECT * FROM token_usage WHERE chat_jid = ?").get("test:usage-provenance") as any;
    expect(row.cache_read_reported).toBe(1);
    expect(row.cache_write_reported).toBe(0);
    expect(row.provider_cost_total).toBe(0.00123);
    expect(row.catalogue_cost_total).toBe(0.00456);
    expect(row.cost_total).toBe(0.00123);
    expect(row.cost_provenance).toBe("provider_reported");
    expect(row.response_model).toBe("anthropic/claude-sonnet-4-5");
  });

  test("marks catalogue-only cost as estimated and absent cache fields as unknown", () => {
    initDatabase();
    const db = getDb();

    recordMessageUsage("test:usage-estimate", {
      role: "assistant",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { total: 0.005 },
      },
    });

    const row = db.prepare("SELECT * FROM token_usage WHERE chat_jid = ?").get("test:usage-estimate") as any;
    expect(row.cache_read_reported).toBeNull();
    expect(row.cache_write_reported).toBeNull();
    expect(row.provider_cost_total).toBeNull();
    expect(row.catalogue_cost_total).toBe(0.005);
    expect(row.cost_total).toBe(0.005);
    expect(row.cost_provenance).toBe("catalogue_estimate");
  });

  test("preserves an explicitly reported zero provider cost", () => {
    initDatabase();
    const db = getDb();

    recordMessageUsage("test:usage-zero-provider-cost", {
      role: "assistant",
      usage: {
        input: 10,
        output: 5,
        providerCost: 0,
        cost: { total: 0.005 },
      },
    });

    const row = db.prepare("SELECT * FROM token_usage WHERE chat_jid = ?").get("test:usage-zero-provider-cost") as any;
    expect(row.provider_cost_total).toBe(0);
    expect(row.catalogue_cost_total).toBe(0.005);
    expect(row.cost_total).toBe(0);
    expect(row.cost_provenance).toBe("provider_reported");
  });

  for (const actualField of ["providerCost", "provider_cost"]) test(`retains an attributed all-zero terminal with explicit ${actualField}`, () => {
    initDatabase();
    const db = getDb(), chat = `test:usage-zero-terminal:${actualField}`;
    const message = {
      id: `zero-terminal:${actualField}`, role: "assistant", stopReason: "stop", timestamp: "2026-11-02T12:00:00Z",
      provider: "fixture", model: "zero-model", api: "openai-completions",
      usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        [actualField]: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    recordMessageUsage(chat, message);
    recordMessageUsage(chat, structuredClone(message));
    const rows = db.query(`SELECT provider,model,total_tokens,reasoning_tokens,provider_cost_total,catalogue_cost_total,
      cost_total,cost_provenance,api_equivalent_cost_known,valuation_provenance FROM token_usage WHERE chat_jid=?`).all(chat);
    expect(rows).toEqual([{ provider: "fixture", model: "zero-model", total_tokens: 0, reasoning_tokens: 0,
      provider_cost_total: 0, catalogue_cost_total: null, cost_total: 0, cost_provenance: "provider_reported",
      api_equivalent_cost_known: 0, valuation_provenance: "unavailable" }]);
  });

  test("computes totals when not provided", () => {
    initDatabase();
    const db = getDb();

    recordMessageUsage("test:usage-2", {
      role: "assistant",
      usage: {
        input: 40,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        cost: {},
      },
    });

    const row = db.prepare("SELECT * FROM token_usage WHERE chat_jid = ?").get("test:usage-2") as any;
    expect(row).toBeDefined();
    expect(row.total_tokens).toBe(60); // 40 + 20
    expect(row.cost_total).toBe(0);
    expect(row.catalogue_cost_total).toBeNull();
    expect(row.cost_provenance).toBe("unavailable");
  });

  test("skips non-assistant messages", () => {
    initDatabase();
    const db = getDb();

    const before = db.prepare("SELECT COUNT(*) as count FROM token_usage WHERE chat_jid = ?").get("test:usage-skip") as any;
    recordMessageUsage("test:usage-skip", { role: "user", usage: { input: 10 } });
    const after = db.prepare("SELECT COUNT(*) as count FROM token_usage WHERE chat_jid = ?").get("test:usage-skip") as any;
    expect(after.count).toBe(before.count);
  });

  test("skips null/undefined messages", () => {
    // Should not throw
    recordMessageUsage("test:usage-null", null);
    recordMessageUsage("test:usage-null", undefined);
  });

  test("skips messages without usage", () => {
    recordMessageUsage("test:usage-nousage", { role: "assistant" });
    // Should not throw, should not insert
  });

  test("uses current time for invalid timestamp", () => {
    initDatabase();
    const db = getDb();

    recordMessageUsage("test:usage-badts", {
      role: "assistant",
      usage: { input: 1, output: 1 },
      timestamp: "not-a-date",
    });

    const row = db.prepare("SELECT * FROM token_usage WHERE chat_jid = ?").get("test:usage-badts") as any;
    expect(row).toBeDefined();
    // Should have a valid ISO date, not "not-a-date"
    expect(row.run_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("uses current time when no timestamp", () => {
    initDatabase();
    const db = getDb();
    const before = new Date().toISOString();

    recordMessageUsage("test:usage-nots", {
      role: "assistant",
      usage: { input: 1, output: 1 },
    });

    const row = db.prepare("SELECT * FROM token_usage WHERE chat_jid = ?").get("test:usage-nots") as any;
    expect(row).toBeDefined();
    expect(row.run_at >= before).toBe(true);
  });

  test("stores tool-result usage from session events", () => {
    initDatabase();
    const db = getDb();

    recordSessionEventUsage("test:usage-tool", {
      type: "message_end",
      message: {
        role: "toolResult",
        toolName: "delegate",
        timestamp: 1_750_000_000_000,
        usage: {
          input: 12,
          output: 7,
          cacheRead: 3,
          cacheWrite: 2,
          totalTokens: 24,
          cost: { input: 0.001, output: 0.002, cacheRead: 0.0001, cacheWrite: 0.0002, total: 0.0033 },
        },
      },
    });

    const row = db.prepare("SELECT * FROM token_usage WHERE chat_jid = ?").get("test:usage-tool") as any;
    expect(row).toBeDefined();
    expect(row.usage_source).toBe("tool");
    expect(row.total_tokens).toBe(24);
    expect(row.turns).toBe(0);
    expect(row.model).toBeNull();
  });

  test("stores compaction and branch-summary usage from session events", () => {
    initDatabase();
    const db = getDb();

    recordSessionEventUsage("test:usage-summaries", {
      type: "session_compact",
      compactionEntry: {
        type: "compaction",
        timestamp: "2026-01-02T03:04:05Z",
        usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { total: 0.01 } },
      },
    });
    recordSessionEventUsage("test:usage-summaries", {
      type: "session_tree",
      summaryEntry: {
        type: "branch_summary",
        timestamp: "2026-01-02T03:05:05Z",
        usage: { input: 30, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 40, cost: { total: 0.003 } },
      },
    });

    const rows = db.prepare("SELECT usage_source, total_tokens, cost_total FROM token_usage WHERE chat_jid = ? ORDER BY run_at ASC").all("test:usage-summaries") as any[];
    expect(rows.map((row) => row.usage_source)).toEqual(["compaction", "branch_summary"]);
    expect(rows.map((row) => row.total_tokens)).toEqual([120, 40]);
    expect(rows.map((row) => row.cost_total)).toEqual([0.01, 0.003]);
  });

  test("ignores zero-value usage payloads", () => {
    initDatabase();
    const db = getDb();

    recordSessionEventUsage("test:usage-zero", {
      type: "message_end",
      message: { role: "toolResult", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } },
    });

    const row = db.prepare("SELECT COUNT(*) AS count FROM token_usage WHERE chat_jid = ?").get("test:usage-zero") as any;
    expect(row.count).toBe(0);
  });
});
