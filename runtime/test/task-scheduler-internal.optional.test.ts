import { runAdmittedScheduledTask } from './helpers/admitted-scheduled-task.js';
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";

import { importFresh, setEnv } from "./helpers.js";
import { assertPathWithinTestFilesystemIsolation } from "../scripts/test-filesystem-isolation.js";

const sentMessages: Array<{ jid: string; text: string }> = [];
let db: typeof import("../src/db.js") | null = null;
let dream: typeof import("../src/dream.js") | null = null;

function writeDailyNote(workspace: string, date: string, summary: string) {
  const dir = join(workspace, "notes/daily");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${date}.md`), `---\ndate: ${date}\nsummarised_until: ${date}T23:59:59.000Z\nmessages_total: 4\nmessages_user: 2\nmessages_assistant: 2\nsession_trees: 1\nsession_chats: 1\nfirst_message: ${date}T12:00:00.000Z\nlast_message: ${date}T12:15:00.000Z\nscope_mode: all-web-session-trees\nscope_anchor: web:default\n---\n# ${date}\n\n## Summary\n\n${summary}\n\n## Summary update (12:30 UTC)\n\n<!-- NEEDS_SUMMARY_UPDATE -->\n`, "utf8");
}

function isoDateDaysAgo(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 3_600_000).toISOString().slice(0, 10);
}

afterEach(() => {
  sentMessages.length = 0;
  try { db?.getDb().close(); } catch (_error) { void _error; }
  db = null;
  dream = null;
});

test("internal Dream flows keep notes/memory/days model-owned and AutoDream stays out of band", async () => {
  const config = await import("../src/core/config.js");

  for (const path of [join(config.WORKSPACE_DIR, "notes"), config.DATA_DIR]) {
    assertPathWithinTestFilesystemIsolation(path, process.env, { allowRoot: false });
  }
  rmSync(join(config.WORKSPACE_DIR, "notes"), { recursive: true, force: true });
  rmSync(join(config.DATA_DIR, "dream-backups"), { recursive: true, force: true });
  rmSync(join(config.DATA_DIR, "workspace-search"), { recursive: true, force: true });
  rmSync(join(config.DATA_DIR, "sessions"), { recursive: true, force: true });

  const recentDate = isoDateDaysAgo(0);
  writeDailyNote(config.WORKSPACE_DIR, recentDate, "Infra tooling and memory maintenance landed.");

  db = await importFresh("../src/db.js");
  dream = await importFresh("../src/dream.js");
  db.initDatabase();

  db.storeMessage({
    id: `msg-user-${Date.now()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "You",
    content: "Make sure the dream maintenance keeps transcript-derived signals from the database, not just daily-note summaries.",
    timestamp: `${recentDate}T12:10:00.000Z`,
    is_bot_message: false,
  });
  db.storeMessage({
    id: `msg-agent-${Date.now()}`,
    chat_jid: "web:default",
    sender: "agent",
    sender_name: "Smith",
    content: "Implemented the infra tooling and memory maintenance changes, validated with targeted tests and runtime checks.",
    timestamp: `${recentDate}T12:20:00.000Z`,
    is_bot_message: true,
    is_terminal_agent_reply: true,
  });

  const seeded = dream.ensureDreamTask("web:default");
  expect(seeded?.id).toBe(dream.DREAM_TASK_ID);
  expect(seeded?.task_kind).toBe("internal");
  expect(seeded?.schedule_type).toBe("cron");
  expect(seeded?.schedule_value).toBe("0 1 * * *");
  expect(seeded?.status).toBe("active");

  const manualTaskId = `task-dream-${Date.now()}`;
  db.createTask({
    id: manualTaskId,
    chat_jid: "web:default",
    prompt: "dream",
    model: null,
    task_kind: "internal",
    command: null,
    cwd: null,
    timeout_sec: null,
    schedule_type: "once",
    schedule_value: new Date().toISOString(),
    next_run: new Date().toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  const manualTask = db.getTaskById(manualTaskId);
  await runAdmittedScheduledTask(manualTask!, {
    queue: {} as any,
    agentPool: {} as any,
    sendMessage: async (jid, text) => { sentMessages.push({ jid, text }); },
  });

  expect(sentMessages.length).toBe(0);
  expect(db.getTaskById(manualTaskId)?.last_result).toContain("Dream updated");
  expect(existsSync(join(config.WORKSPACE_DIR, "notes/memory/MEMORY.md"))).toBe(true);
  expect(existsSync(join(config.WORKSPACE_DIR, `notes/memory/days/${recentDate}.md`))).toBe(false);

  const memoryIndexText = readFileSync(join(config.WORKSPACE_DIR, "notes/memory/MEMORY.md"), "utf8");
  expect(memoryIndexText).toContain("Complete days: 0");
  expect(memoryIndexText).toContain("Partial days: 1");
  expect(memoryIndexText).toContain(`${recentDate} — partial`);
  expect(memoryIndexText).toContain("No complete daily-note memories yet.");

  const currentStateText = readFileSync(join(config.WORKSPACE_DIR, "notes/memory/current-state.md"), "utf8");
  expect(currentStateText).toContain("# Current Dream state");
  expect(currentStateText).toContain("- Complete days: 0");
  expect(currentStateText).toContain("- Partial days: 1");
  expect(currentStateText).toContain(`${recentDate} — partial`);

  const recentContextText = readFileSync(join(config.WORKSPACE_DIR, "notes/memory/recent-context.md"), "utf8");
  expect(recentContextText).toContain("Partial days");
  expect(recentContextText).toContain(`${recentDate} — partial`);

  writeFileSync(
    join(config.WORKSPACE_DIR, "notes", "memory", "current-state.md"),
    `${JSON.stringify({ generated_at: new Date(Date.now() - 48 * 3_600_000).toISOString() }, null, 2)}\n`,
    "utf8",
  );

  for (const chat of ["web:default", "web:a", "web:b", "web:c", "web:d", "web:e"]) {
    db.storeChatMetadata(chat, new Date().toISOString());
    db.storeMessage({
      id: `msg-${chat}-${Date.now()}`,
      chat_jid: chat,
      sender: "user",
      sender_name: "You",
      content: `follow-up session in ${chat}`,
      timestamp: new Date().toISOString(),
      is_bot_message: false,
    });
  }

  db.updateTask(dream.DREAM_TASK_ID,{next_run:new Date(Date.now()-1000).toISOString()});
  await runAdmittedScheduledTask(db.getTaskById(dream.DREAM_TASK_ID)!, {
    queue: {} as any,
    agentPool: {isDurableRuntime:()=>true,
      dispatchDreamOperation:async()=>({status:'success',result:'AutoDream model consolidation finished.'}),
      disposeChatSession:async()=>{},
    } as any,
    sendMessage:async()=>{},
  });

  const lastResult = db.getTaskById(dream.DREAM_TASK_ID)?.last_result || "";
  expect(lastResult).toContain("AutoDream model consolidation finished");
  expect(lastResult).toContain("Daily notes refreshed before Dream: yes");
  expect(lastResult).toContain("Unresolved daily-note backlog:");
  expect(lastResult).toContain("Memory refreshed after Dream:");
  const backupRoot = join(config.DATA_DIR, "dream-backups");
  const backups = readdirSync(backupRoot);
  expect(backups.length).toBeGreaterThanOrEqual(1);
  const backupPath = join(backupRoot, backups.sort().at(-1)!);
  expect(backupPath.endsWith(".zip")).toBe(true);
  const list = Bun.spawnSync(["unzip", "-Z1", backupPath], { stdout: "pipe", stderr: "pipe" });
  expect(list.exitCode, list.stderr.toString()).toBe(0);
  const archived = list.stdout.toString("utf8");
  expect(archived).toContain("manifest.json");
  expect(archived).toContain(`notes/daily/${recentDate}.md`);
  expect(archived).not.toContain("notes/memory/.dream.lock");
  const today = new Date().toISOString().slice(0, 10);
  const dailyPath = join(config.WORKSPACE_DIR, "notes", "daily", `${today}.md`);
  expect(existsSync(dailyPath)).toBe(true);
  expect(readFileSync(dailyPath, "utf8")).toContain("## Summary");
  const dreamRows = db.getDb().query<{ count: number }, []>("SELECT COUNT(*) AS count FROM messages WHERE chat_jid LIKE 'dream:%'").get();
  expect(dreamRows?.count ?? 0).toBe(0);
});

test.skip("Dream task cron can be overridden via PICLAW_DREAM_CRON", async () => {
  const restore = setEnv({ PICLAW_DREAM_CRON: "45 3 * * *" });
  try {
    db = await importFresh("../src/db.js");
    dream = await importFresh("../src/dream.js");
    db.initDatabase();
    // Remove any existing dream task so ensureDreamTask creates a fresh one
    db.getDb().exec("DELETE FROM scheduled_tasks WHERE task_kind = 'agent'");

    // Verify the re-imported module picked up the env override
    expect(dream.DREAM_TASK_CRON).toBe("45 3 * * *");
    const seeded = dream.ensureDreamTask("web:default");
    expect(seeded?.schedule_value).toBe("45 3 * * *");
  } finally {
    restore();
  }
});
