import {runAdmittedScheduledTask} from '../helpers/admitted-scheduled-task.js';
import { describe, expect, test } from "bun:test";
import Database from "bun:sqlite";
import { join } from "node:path";
import { createTempWorkspace } from "../helpers.js";
import { getDb, getTaskById, updateTask } from "../../src/db.js";
import { ensureBudgetWork, getBudgetCap, saveBudgetCap, setBudgetCapEnabled, setBudgetWorkStatus } from "../../src/db/budget-limits.js";
import { scheduledTasks } from "../../src/extensions/scheduled-tasks.js";
import { getScheduledTaskInspection } from "../../src/scheduled-task-query-service.js";
import { parseScheduledBudgetMicros } from "../../src/budget/amount.js";
import { scheduledBudgetReadiness } from "../../src/budget/scheduled-readiness.js";
import { evaluateBudget } from "../../src/budget/evaluator.js";
import { persistProviderEvidence } from "../../src/budget/provider-evidence.js";
import { pollScheduledRunsOnce } from "../../src/task-scheduler.js";
import { createCurrentPiclawScheduledRunStore } from "../../src/service-effects/current-piclaw/scheduled-run-store.js";
import { isolateBudgetTestDatabase } from "./fixture.js";

isolateBudgetTestDatabase();
function tool(name: string) {
  const tools = new Map<string, any>();
  scheduledTasks({ registerTool: (entry: any) => tools.set(entry.name, entry), registerCommand() {} } as any);
  return tools.get(name);
}
const request = (extra: Record<string, unknown> = {}) => ({ action: "create", chat_jid: "web:budget-origin", task_kind: "agent", prompt: "Fixture only", schedule_type: "interval", schedule_value: "60000", ...extra });
function rowCounts() {
  return ["budget_work", "budget_cap_windows", "budget_decisions", "budget_allowances", "budget_overrides"].map(table => getDb().query(`SELECT count(*) n FROM ${table}`).get());
}

test("scheduled amounts never round positive values to zero and UI/tool decimals agree", () => {
  for (const [value, micros] of [[0, 0], [0.25, 250000], [0.000001, 1], ["0.000001", 1], ["12.50", 12500000]] as const) expect(parseScheduledBudgetMicros(value)).toBe(micros);
  for (const value of [0.0000001, 0.0000011, "0.0000001", -1, Infinity, NaN, "1e-7", null, true, "", "999999999999999999999"]) expect(() => parseScheduledBudgetMicros(value)).toThrow();
});

for (const name of ["scheduled_tasks", "schedule_task"]) describe(name, () => {
  test("omitted budget is accepted without synthetic caps/work/approval and survives database reopen", async () => {
    const before = rowCounts();
    const created = await tool(name).execute("create", request());
    expect(created.details).toMatchObject({ ok: true, confirmed: true, schedule_accepted: true, budget_usd: null, budget_readiness: { mode: "no_task_cap", status: "allowed", blockers: [], applicable_cap_ids: [] } });
    expect(created.details.budget_readiness.summary).toContain("No budget approval");
    const id = created.details.id;
    expect(getBudgetCap(`scheduled-cap:${id}`)).toBeNull();
    expect(rowCounts()).toEqual(before);
    const ws = createTempWorkspace("scheduled-budget-reopen-");
    try {
      const path = join(ws.base, "copy.db");
      await Bun.write(path, getDb().serialize());
      const reopened = new Database(path);
      try {
        const task = reopened.query("SELECT * FROM scheduled_tasks WHERE id=?").get(id) as any;
        expect(scheduledBudgetReadiness(task, reopened)).toMatchObject({ mode: "no_task_cap", status: "allowed", blockers: [] });
        ensureBudgetWork({ id: "after-reopen", chatJid: task.chat_jid, executionKind: "scheduled", scheduledTaskId: id }, reopened);
        expect(evaluateBudget({ workId: "after-reopen" }, reopened).action).toBe("allow");
      } finally { reopened.close(); }
    } finally { ws.cleanup(); }
    expect(getScheduledTaskInspection(id)?.budget_readiness.mode).toBe("no_task_cap");
    expect((await tool(name === "schedule_task" ? "scheduled_tasks" : name).execute("get", { action: "get", id })).content[0].text).toContain("budget:");
  });

  test("zero requires explicit acknowledgement; positive precision errors do not create schedules", async () => {
    for (const value of [0, 0.0000001, 0.0000011]) {
      const result = await tool(name).execute("create", request({ budget_usd: value }));
      expect(result.details.ok).toBe(false);
      expect(getDb().query("SELECT count(*) n FROM scheduled_tasks").get()).toEqual({ n: 0 });
    }
    const result = await tool(name).execute("create", request({ budget_usd: 0, confirm_zero_budget: true }));
    expect(result.details).toMatchObject({ schedule_accepted: true, budget_readiness: { mode: "zero_task_cap", status: "blocked" } });
    expect(result.content[0].text).toContain("cannot pass");
    expect(getBudgetCap(`scheduled-cap:${result.details.id}`)?.amount).toBe(0);
    expect(rowCounts()[0]).toEqual({ n: 0 });
  });
});

test("readiness projection failure rolls back task creation and permits one safe retry", async () => {
  saveBudgetCap({ id: "corrupt-calendar", scope: "instance_daily", metric: "api_usd_micros", amount: 1000000, timezone: "UTC" });
  getDb().query("UPDATE budget_caps SET timezone='not-a-timezone' WHERE id='corrupt-calendar'").run();
  for (const name of ["scheduled_tasks", "schedule_task"]) {
    await expect(tool(name).execute("create", request({ budget_usd: 0.25 }))).rejects.toThrow();
    expect(getDb().query("SELECT count(*) n FROM scheduled_tasks").get()).toEqual({ n: 0 });
    expect(getDb().query("SELECT count(*) n FROM budget_caps WHERE scope='scheduled_run'").get()).toEqual({ n: 0 });
  }
  getDb().query("UPDATE budget_caps SET timezone='UTC' WHERE id='corrupt-calendar'").run();
  const result = await tool("scheduled_tasks").execute("create", request({ budget_usd: 0.25 }));
  expect(result.details.schedule_accepted).toBe(true);
  expect(getDb().query("SELECT count(*) n FROM scheduled_tasks").get()).toEqual({ n: 1 });
});

test("fresh scheduled readiness preserves instance guards, ignores unrelated work and disabled caps, and has no read side effects", async () => {
  const created = await tool("scheduled_tasks").execute("create", request({ budget_usd: 0.25 }));
  const id = created.details.id;
  ensureBudgetWork({ id: "unrelated-interactive", chatJid: "web:other", executionKind: "interactive" });
  saveBudgetCap({ id: "unrelated", scope: "task", metric: "api_usd_micros", workId: "unrelated-interactive", amount: 0 });
  expect(scheduledBudgetReadiness({ id })).toMatchObject({ status: "allowed", mode: "capped" });
  saveBudgetCap({ id: "daily-zero", scope: "instance_daily", metric: "api_usd_micros", amount: 0, timezone: "UTC" });
  const before = rowCounts();
  const blocked = scheduledBudgetReadiness({ id });
  expect(blocked.status).toBe("blocked");
  expect(blocked.blockers.map(b => b.capId)).toEqual(["daily-zero"]);
  expect(rowCounts()).toEqual(before);
  setBudgetCapEnabled("daily-zero", false);
  setBudgetCapEnabled(`scheduled-cap:${id}`, false);
  expect(scheduledBudgetReadiness({ id })).toMatchObject({ mode: "disabled_task_cap", status: "allowed", applicable_cap_ids: [] });
});

test("operator-created scheduled caps with custom IDs are represented in readiness mode", () => {
  saveBudgetCap({ id: "custom-task-cap", scope: "scheduled_run", metric: "api_usd_micros", amount: 0, scheduledTaskId: "task-custom" });
  expect(scheduledBudgetReadiness({ id: "task-custom" })).toMatchObject({ mode: "zero_task_cap", status: "blocked", applicable_cap_ids: ["custom-task-cap"] });
  setBudgetCapEnabled("custom-task-cap", false);
  expect(scheduledBudgetReadiness({ id: "task-custom" })).toMatchObject({ mode: "disabled_task_cap", status: "allowed" });
});

test("inherited providers are unresolved, not falsely blocked by another provider; explicit provider guard remains visible", async () => {
  saveBudgetCap({ id: "quota", scope: "provider_window", metric: "provider_percent_used_micros", amount: 80000000, providerId: "openai-codex", accountRef: "private-account", quotaDimension: "primary.percent_used" });
  expect(scheduledBudgetReadiness({ id: "task", model: null })).toMatchObject({ status: "check_at_run", blockers: [] });
  expect(scheduledBudgetReadiness({ id: "task", model: "other/model" })).toMatchObject({ status: "allowed", blockers: [] });
  const explicit = scheduledBudgetReadiness({ id: "task", model: "openai-codex/model" });
  expect(explicit.status).toBe("blocked");
  expect(explicit.blockers[0].reason).toBe("missing_provider_evidence");
  expect(JSON.stringify(explicit)).not.toContain("private-account");
});

test("provider readiness uses matching-account evidence even when a foreign snapshot is newer", () => {
  const now = new Date();
  saveBudgetCap({ id: "quota-account", scope: "provider_window", metric: "provider_percent_used_micros", amount: 80000000, providerId: "openai-codex", accountRef: "matching-private", quotaDimension: "primary.percent_used" });
  for (const [accountRef, age, value] of [["matching-private", 1000, 20000000], ["foreign-private", 0, 99000000]] as const) persistProviderEvidence({ capId: "quota-account", providerId: "openai-codex", accountRef, quotaDimension: "primary.percent_used", windowId: "window", fetchedAt: new Date(now.getTime() - age).toISOString(), resetsAt: new Date(now.getTime() + 60000).toISOString(), stale: false, availability: "available", valueMicros: value, source: "fixture" });
  const readiness = scheduledBudgetReadiness({ id: "task", model: "openai-codex/model" }, getDb(), now);
  expect(readiness.status).toBe("allowed");
  expect(readiness.blockers).toEqual([]);
  expect(JSON.stringify(readiness)).not.toContain("matching-private");
  expect(JSON.stringify(readiness)).not.toContain("foreign-private");
});

test("an uncapped tool-created task reaches execution through durable due dispatch", async () => {
  const created = await tool("scheduled_tasks").execute("create", request({ schedule_type: "once", schedule_value: "2020-01-01T00:00:00Z" }));
  let run: (() => Promise<unknown>) | undefined;
  let executions = 0;
  const deps = {
    queue: { enqueueTask: (_id: string, fn: () => Promise<unknown>) => { run = fn; } },
    agentPool: { saveSessionPosition: async () => null, getCurrentModelLabel: async () => null, restoreSessionPosition: async () => {}, isDurableRuntime:()=>true,dispatchScheduledAgent: async (lease: any) => {
      const chat=lease.task.chatJid,opts={budgetWorkId:'scheduled:'+lease.record.runId,budgetScheduledTaskId:lease.record.taskId};
      ensureBudgetWork({ id: opts.budgetWorkId, chatJid: chat, executionKind: "scheduled", scheduledTaskId: opts.budgetScheduledTaskId });
      expect(evaluateBudget({ workId: opts.budgetWorkId }).action).toBe("allow");
      executions++;
      return { status: "success", result: "Fixture completed" };
    } }, sendMessage: async () => {},
  };
  getDb().exec("PRAGMA foreign_keys = ON");
  const built = createCurrentPiclawScheduledRunStore(getDb(), { hitFault: () => false, recordTrace: () => {} });
  if (!built.ok) throw new Error(built.error.message);
  await pollScheduledRunsOnce(deps as any, built.value);
  expect(run).toBeDefined();
  await run!();
  expect(executions).toBe(1);
  expect(getTaskById(created.details.id)?.status).toBe("completed");
  expect(getBudgetCap(`scheduled-cap:${created.details.id}`)).toBeNull();
});

test("uncapped recurring tasks reach execution on every fresh run without pricing or quota evidence", async () => {
  saveBudgetCap({ id: "disabled-daily", scope: "instance_daily", metric: "api_usd_micros", amount: 0, timezone: "UTC", enabled: false });
  const created = await tool("scheduled_tasks").execute("create", request({ notify: false }));
  const sent: string[] = [], workIds: string[] = [];
  let modelCalls = 0;
  const pool = {
    saveSessionPosition: async () => null, getCurrentModelLabel: async () => null, restoreSessionPosition: async () => {},
    isDurableRuntime:()=>true,dispatchScheduledAgent: async (lease: any) => {
      const chat=lease.task.chatJid,opts={budgetWorkId:'scheduled:'+lease.record.runId,budgetScheduledTaskId:lease.record.taskId};
      workIds.push(opts.budgetWorkId);
      ensureBudgetWork({ id: opts.budgetWorkId, chatJid: chat, executionKind: "scheduled", scheduledTaskId: opts.budgetScheduledTaskId });
      expect(evaluateBudget({ workId: opts.budgetWorkId }).action).toBe("allow");
      modelCalls++;
      setBudgetWorkStatus(opts.budgetWorkId, "completed");
      return { status: "success", result: "Fixture completed" };
    },
  };
  for (let run = 0; run < 2; run++) {
    updateTask(created.details.id,{next_run:new Date(Date.now()-1000).toISOString()});
    const result = await runAdmittedScheduledTask(getTaskById(created.details.id)!, { agentPool: pool, sendMessage: async (chat: string) => { sent.push(chat); } } as any);
    expect(result.status).toBe("success");
    await Bun.sleep(2);
  }
  expect(modelCalls).toBe(2);
  expect(new Set(workIds).size).toBe(2);
  expect(sent).toEqual(["web:budget-origin", "web:budget-origin"]);
  expect(getDb().query("SELECT count(*) n FROM budget_caps WHERE enabled=1").get()).toEqual({ n: 0 });
  expect(getDb().query("SELECT count(*) n FROM budget_allowances").get()).toEqual({ n: 0 });
});
