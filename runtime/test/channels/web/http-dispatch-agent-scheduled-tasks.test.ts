import {installHistoricalExpenseFixture} from '../../fixtures/historical-expense.js';
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import "../../helpers.js";
import { createTask, getDb, initDatabase } from "../../../src/db.js";
import { handleAgentRoutes } from "../../../src/channels/web/http/dispatch-agent.js";

function jsonChannel() {
  return {
    json: (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    }),
  } as any;
}

function insertTask(overrides: Record<string, any> = {}) {
  createTask({
    id: "task-web-ui",
    chat_jid: "web:default",
    prompt: "Summarize the day",
    model: null,
    task_kind: "agent",
    command: null,
    cwd: null,
    timeout_sec: null,
    schedule_type: "once",
    schedule_value: "2026-05-05T09:00:00.000Z",
    next_run: "2026-05-05T09:00:00.000Z",
    status: "active",
    created_at: "2026-05-04T09:00:00.000Z",
    ...overrides,
  });
}

describe("scheduled task web management routes", () => {
  beforeEach(() => {
    initDatabase();
    getDb().query("DELETE FROM task_run_logs").run();
    getDb().query("DELETE FROM scheduled_tasks").run();
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch (_error) {
      void _error;
    }
  });

  test("lists scheduled tasks with counts for the settings pane", async () => {
    insertTask();
    insertTask({ id: "task-paused", status: "paused", next_run: "2026-05-06T09:00:00.000Z" });

    const req = new Request("https://example.com/agent/scheduled-tasks?include_run_logs=1", { method: "GET" });
    const response = await handleAgentRoutes(jsonChannel(), req, "/agent/scheduled-tasks", new URL(req.url));
    expect(response?.status).toBe(200);
    const body = await response!.json() as any;
    expect(body.ok).toBe(true);
    expect(body.counts).toEqual({ active: 1, paused: 1, completed: 0 });
    expect(body.tasks.map((task: any) => task.id)).toContain("task-web-ui");
  });

  test("pauses and resumes non-internal scheduled tasks", async () => {
    insertTask();

    const pauseReq = new Request("https://example.com/agent/scheduled-tasks/action", {
      method: "POST",
      body: JSON.stringify({ action: "pause", id: "task-web-ui" }),
    });
    const pauseResponse = await handleAgentRoutes(jsonChannel(), pauseReq, "/agent/scheduled-tasks/action", new URL(pauseReq.url));
    expect(pauseResponse?.status).toBe(200);
    expect((await pauseResponse!.json() as any).task.status).toBe("paused");

    const resumeReq = new Request("https://example.com/agent/scheduled-tasks/action", {
      method: "POST",
      body: JSON.stringify({ action: "resume", id: "task-web-ui" }),
    });
    const resumeResponse = await handleAgentRoutes(jsonChannel(), resumeReq, "/agent/scheduled-tasks/action", new URL(resumeReq.url));
    expect(resumeResponse?.status).toBe(200);
    expect((await resumeResponse!.json() as any).task.status).toBe("active");
  });

  test("retired expense actions cannot mutate historical records; schedule controls ignore caps", async () => {
    insertTask();installHistoricalExpenseFixture(getDb());
    getDb().query(`INSERT INTO budget_caps(id,scope,metric,amount,scheduled_task_id,created_at,updated_at) VALUES(?,'scheduled_run','api_usd_micros',0,?,'2026-01-01','2026-01-01')`).run("scheduled-cap:task-web-ui", "task-web-ui");
    const before = getDb().query("SELECT * FROM budget_caps").all();
    const schema = getDb().query("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all();
    const call = (body: Record<string, unknown>) => {
      const req = new Request("https://example.com/agent/scheduled-tasks/action", {method:"POST",body:JSON.stringify({id:"task-web-ui",...body})});
      return handleAgentRoutes(jsonChannel(),req,"/agent/scheduled-tasks/action",new URL(req.url));
    };
    for (const body of [{action:"set_budget",budget_usd:1},{action:"set_budget",enabled:false,confirm_revision:1},
      {action:"pause",budget_usd:0},{action:"resume",confirm_zero_budget:true}]) {
      expect((await call(body))?.status).toBe(400);
    }
    for (const action of ["pause","resume"]) {
      const res = await call({action});
      expect(res?.status).toBe(200);
      const body = await res!.json();
      expect(Object.keys(body.task).filter(key=>key.startsWith("budget"))).toEqual([]);
    }
    expect((await call({action:"delete"}))?.status).toBe(200);
    expect(getDb().query("SELECT * FROM budget_caps").all()).toEqual(before);
    expect(getDb().query("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all()).toEqual(schema);
  });

  test("protects internal tasks unless explicitly allowed", async () => {
    insertTask({ id: "task-internal", task_kind: "internal", prompt: "/dream" });

    const req = new Request("https://example.com/agent/scheduled-tasks/action", {
      method: "POST",
      body: JSON.stringify({ action: "delete", id: "task-internal" }),
    });
    const response = await handleAgentRoutes(jsonChannel(), req, "/agent/scheduled-tasks/action", new URL(req.url));
    expect(response?.status).toBe(403);
    const body = await response!.json() as any;
    expect(body.protected).toBe(true);
    expect(getDb().prepare("SELECT id FROM scheduled_tasks WHERE id = ?").get("task-internal")).toBeTruthy();
  });
});
