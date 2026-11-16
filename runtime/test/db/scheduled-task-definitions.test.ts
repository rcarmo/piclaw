import { afterEach, beforeEach, expect, test } from "bun:test";
import { initDatabase, closeDatabase, getDb } from "../../src/db/connection.js";
import { createTask, updateTask, getTaskById, deleteTask, applyScheduledRunToTask, updateTaskAfterRun } from "../../src/db/tasks.js";
import { readScheduledDefinition, definitionRef, projectScheduledTask, scheduledDefinitionMigration } from "../../src/db/scheduled-task-definitions.js";
import { migrateScheduledTaskAuthorities } from "../../src/db/scheduled-task-authority.js";
import { listScheduledTasks } from "../../src/scheduled-task-query-service.js";
import { createScheduledTaskAuthority } from "../../src/service-effects/current-piclaw/scheduled-task-authority.js";
import { createCurrentPiclawScheduledRunStore } from "../../src/service-effects/current-piclaw/scheduled-run-store.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../src/service-effects/contracts/common.js";
import type { CompleteScheduledRunRequest } from "../../src/service-effects/contracts/scheduled-run-store.js";
import type { ScheduledTask } from "../../src/types.js";
import { storeChatMetadata } from "../../src/db/messages.js";
import * as branchStore from "../../src/db/chat-branches.js";
import { ensureChatBranch, archiveChatBranch,
  exportArchivedBranchDownloadData } from "../../src/db/chat-branches.js";

beforeEach(() => { initDatabase(); getDb().exec("PRAGMA foreign_keys=ON"); });
afterEach(() => closeDatabase());
const at = "2026-10-24T12:00:00.000Z", slot = "2026-10-24T11:00:00.000Z";
function task(id = "definition"): Omit<ScheduledTask, "revision" | "last_run" | "last_result"> {
  return { id, chat_jid: "web:definition", prompt: "original prompt", model: null, task_kind: "agent", command: null,
    cwd: null, timeout_sec: null, notify_on_complete: 1, schedule_type: "interval", schedule_value: "60000",
    next_run: slot, status: "active", created_at: "2026-10-23T12:00:00.000Z" };
}
function store() {
  const built = createCurrentPiclawScheduledRunStore(getDb(), { hitFault: () => false, recordTrace() {} });
  if (!built.ok) throw Error(built.error._tag);
  return built.value;
}
function value<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw Error(JSON.stringify(result.error)); return result.value;
}
async function claim(id: string) {
  const s = store();
  const leases = value(await s.claimDue({ now: at, limit: 100, workerId: "fixture", leaseTokenPrefix: "fixture-lease",
    leaseDurationMs: 60000, reclaimAuthorities: [] }));
  const lease = leases.find(lease => lease.record.taskId === id)!;
  expect(lease).toBeDefined();
  const request: CompleteScheduledRunRequest = { effect: { idempotencyKey: `complete:${lease.record.runId}`, requestHash: "",
    operationId: null, sourceSeq: null, provenanceRef: lease.record.runId, redactionClass: "private" }, runId: lease.record.runId,
    workerId: "fixture", expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision,
    leaseToken: lease.leaseToken, now: at, completedAt: at, status: "success", durationMs: 4,
    resultRef: `task_run_result:${lease.record.runId}`, errorCode: null, outboxIntents: [], resultPayload: { version: 1, result: "original output", error: null } };
  request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
  return { s, lease, request };
}

test("frozen definitions ignore mutable cache bytes and preserve old revisions on edit", () => {
  createTask(task());
  const db = getDb(), first = readScheduledDefinition(db, "definition", 1);
  expect(first.availability).toBe("known"); expect(first.origin).toBe("authored");
  expect(first.snapshot.payloadRef).toBe(definitionRef(first.body!));
  db.query("UPDATE scheduled_tasks SET prompt='WRONG',revision=999,status='completed',next_run=NULL WHERE id='definition'").run();
  expect(getTaskById("definition")).toMatchObject({ prompt: "original prompt", revision: 1, status: "active", next_run: slot });
  expect(listScheduledTasks({ status: "active" }).tasks[0]?.prompt).toBe("original prompt");
  updateTask("definition", { prompt: "edited prompt" }, 1);
  expect(getTaskById("definition")).toMatchObject({ prompt: "edited prompt", revision: 2 });
  expect(readScheduledDefinition(db, "definition", 1)).toEqual(first);
  expect(db.query("SELECT prompt,revision FROM scheduled_tasks WHERE id='definition'").get()).toEqual({ prompt: "edited prompt", revision: 2 });
  expect(() => updateTask("definition", { prompt: "stale edit" }, 1)).toThrow("revision mismatch");
  expect(getTaskById("definition")?.revision).toBe(2);
});

test("new creation never adopts an orphan compatibility payload", () => {
  const db = getDb();
  db.query(`INSERT INTO scheduled_tasks(id,chat_jid,prompt,schedule_type,schedule_value,next_run,created_at)
    VALUES('definition','web:orphan','retained orphan bytes','interval','60000',?,?)`).run(slot,at);
  expect(() => createTask(task())).toThrow("identity already exists");
  expect(db.query("SELECT prompt,chat_jid FROM scheduled_tasks WHERE id='definition'").get())
    .toEqual({ prompt: "retained orphan bytes", chat_jid: "web:orphan" });
  expect(db.query("SELECT task_id FROM service_effect_s07_tasks").all()).toEqual([]);
  expect(db.query("SELECT task_id FROM host_scheduled_task_definitions").all()).toEqual([]);
});

test("one-shot schedule bytes freeze their authored UTC instant across timezone changes", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    createTask({ ...task(), schedule_type: "once", schedule_value: "2026-11-01T12:00:00", next_run: null, status: "completed" });
    const definition = readScheduledDefinition(getDb(),"definition",1);
    expect(definition.body?.schedule_value).toBe("2026-11-01T12:00:00.000Z");
    process.env.TZ = "Pacific/Auckland";
    expect(readScheduledDefinition(getDb(),"definition",1)).toEqual(definition);
    expect(getTaskById("definition")?.schedule_value).toBe("2026-11-01T12:00:00.000Z");
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("projection failures roll back create, edit and pause with their canonical mutations", () => {
  const db = getDb();
  db.exec("CREATE TEMP TRIGGER projection_fail BEFORE INSERT ON main.scheduled_tasks BEGIN SELECT RAISE(ABORT,'fixture projection failure'); END");
  expect(() => createTask(task())).toThrow("fixture projection failure");
  for (const table of ["scheduled_tasks", "service_effect_s07_tasks", "service_effect_s07_task_revisions", "host_scheduled_task_definitions"]) {
    expect(db.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  }
  db.exec("DROP TRIGGER temp.projection_fail"); createTask(task());
  const before = readScheduledDefinition(db, "definition", 1);
  db.exec("CREATE TEMP TRIGGER projection_fail BEFORE UPDATE ON main.scheduled_tasks BEGIN SELECT RAISE(ABORT,'fixture projection failure'); END");
  expect(() => updateTask("definition", { prompt: "lost edit" })).toThrow("fixture projection failure");
  expect(() => updateTask("definition", { status: "paused" })).toThrow("fixture projection failure");
  expect(getTaskById("definition")).toMatchObject({ prompt: "original prompt", revision: 1, status: "active" });
  expect(readScheduledDefinition(db, "definition", 1)).toEqual(before);
  expect(db.query("SELECT revision FROM host_scheduled_task_definitions ORDER BY revision").all()).toEqual([{ revision: 1 }]);
});

for (const [schedule_type, schedule_value, task_kind] of [["once", slot, "shell"], ["interval", "60000", "internal"], ["cron", "0 * * * *", "shell"]] as const) {
  test(`${schedule_type}/${task_kind} paused completion projects the held successor and resumes exactly once`, async () => {
    createTask({ ...task(), schedule_type, schedule_value, task_kind, prompt: task_kind === "internal" ? "dream" : "printf original",
      command: task_kind === "shell" ? "printf original" : null });
    const { s, request } = await claim("definition");
    updateTask("definition", { status: "paused" });
    const completed = value(await s.complete(request));
    expect(completed.headDisposition).toBe("paused");
    expect(getTaskById("definition")).toMatchObject({ status: "paused", revision: 1, next_run: completed.nextRunAt, last_result: "original output" });
    expect(getDb().query("SELECT next_run_at FROM service_effect_s07_tasks WHERE task_id='definition'").get()).toEqual({ next_run_at: slot });
    updateTask("definition", { status: "active" });
    expect(getTaskById("definition")).toMatchObject({ revision: 1, status: completed.nextRunAt === null ? "completed" : "active", next_run: completed.nextRunAt });
    expect(value(await s.complete(request))).toEqual(completed);
    expect(getDb().query("SELECT count(*) AS n FROM task_run_logs WHERE occurrence_id=?").get(completed.runId)).toEqual({ n: 1 });
  });
}

test("explicit deletion retires bodies but retains revision hashes and scheduling tombstones", () => {
  createTask(task()); updateTask("definition", { prompt: "second prompt" });
  const db = getDb(), revisions = db.query("SELECT * FROM service_effect_s07_task_revisions ORDER BY revision").all();
  deleteTask("definition");
  expect(getTaskById("definition")).toBeNull();
  expect(db.query("SELECT status,next_run_at FROM service_effect_s07_tasks WHERE task_id='definition'").get()).toEqual({ status: "deleted", next_run_at: null });
  expect(db.query("SELECT * FROM service_effect_s07_task_revisions ORDER BY revision").all()).toEqual(revisions);
  expect(db.query("SELECT availability,payload_json FROM host_scheduled_task_definitions").all()).toEqual([
    { availability: "retired", payload_json: null }, { availability: "retired", payload_json: null }]);
  expect(readScheduledDefinition(db, "definition", 1).body).toBeNull();
  projectScheduledTask(db, "definition");
  expect(db.query("SELECT id FROM scheduled_tasks").all()).toEqual([]);
});

test("paused cursor remains recoverable after result-byte loss and attempted terminal cleanup", async () => {
  createTask({ ...task(), task_kind: "shell", command: "printf original" });
  const db = getDb(), { s, request } = await claim("definition");
  updateTask("definition", { status: "paused" });
  const completed = value(await s.complete(request));
  db.query("DELETE FROM task_run_logs WHERE occurrence_id=?").run(completed.runId);
  const retired = value(await s.cleanupTerminal({ settledBefore: "2026-10-24T13:00:00.000Z", limit: 10 }));
  expect(retired.removed).toBe(0);
  expect(getTaskById("definition")).toMatchObject({ status: "paused", next_run: completed.nextRunAt });
  updateTask("definition", { status: "active" });
  expect(getTaskById("definition")).toMatchObject({ status: "active", next_run: completed.nextRunAt });
});

test("body loss or corruption cannot be repaired from a current compatibility prompt", () => {
  createTask(task()); const db = getDb();
  db.query("UPDATE host_scheduled_task_definitions SET payload_hash=? WHERE task_id='definition'").run("0".repeat(64));
  expect(() => getTaskById("definition")).toThrow("Corrupt scheduled definition binding");
  db.query("DELETE FROM host_scheduled_task_definitions WHERE task_id='definition'").run();
  migrateScheduledTaskAuthorities(db);
  expect(() => getTaskById("definition")).toThrow("payload unavailable");
  expect(db.query("SELECT count(*) AS n FROM host_scheduled_task_definitions").get()).toEqual({ n: 0 });
});

function legacyCurrent() {
  const db = getDb(), t = task("legacy");
  db.exec(`DROP TABLE host_scheduled_task_definitions; DROP INDEX idx_scheduled_task_paused_successor;
    DELETE FROM piclaw_schema_migrations WHERE owner='host.scheduled-definitions' AND id='versioned-payload-v1'`);
  const authority = createScheduledTaskAuthority(db);
  const input = { taskId: t.id, chatJid: t.chat_jid, kind: "agent" as const, payloadRef: "scheduled_task:legacy:revision:1",
    modelLabel: null, scheduleType: "interval" as const, scheduleValue: "60000", timezone: "UTC", notifyOnComplete: true, muted: false,
    cwd: null, timeoutSec: null, internalTask: null, redactionClass: "private" as const, executionRepeatability: "agent_source" as const,
    nextRunAt: slot, authoredAt: t.created_at };
  authority.create(input);
  authority.update({ ...input, expectedRevision: 1, payloadRef: "scheduled_task:legacy:revision:2" });
  db.query(`INSERT INTO scheduled_tasks(id,chat_jid,prompt,model,task_kind,command,cwd,timeout_sec,notify_on_complete,
    schedule_type,schedule_value,next_run,status,created_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,2)`)
    .run(t.id,t.chat_jid,"only current bytes",null,"agent",null,null,null,1,"interval","60000",slot,"active",t.created_at);
  return db.query("SELECT * FROM service_effect_s07_task_revisions ORDER BY revision").all();
}

test("upgrade captures only current legacy bytes and preserves every historical snapshot/hash", () => {
  const before = legacyCurrent(), db = getDb();
  migrateScheduledTaskAuthorities(db);
  expect(db.query("SELECT * FROM service_effect_s07_task_revisions ORDER BY revision").all()).toEqual(before);
  expect(readScheduledDefinition(db,"legacy",1)).toMatchObject({ availability: "unavailable", origin: "unknown", body: null, capturedAt: null });
  const current = readScheduledDefinition(db,"legacy",2);
  expect(current).toMatchObject({ availability: "known", origin: "legacy_current", body: { prompt: "only current bytes" } });
  expect(current.capturedAt).toBeString();
  db.query("UPDATE scheduled_tasks SET prompt='not evidence' WHERE id='legacy'").run();
  migrateScheduledTaskAuthorities(db);
  expect(readScheduledDefinition(db,"legacy",2)).toEqual(current);
  expect(getTaskById("legacy")?.prompt).toBe("only current bytes");
  projectScheduledTask(db,"legacy");
  expect(db.query("SELECT prompt FROM scheduled_tasks WHERE id='legacy'").get()).toEqual({ prompt: "only current bytes" });
});

test("mismatched current legacy metadata rolls back the whole installation without adoption", () => {
  const before = legacyCurrent(), db = getDb();
  db.query("UPDATE scheduled_tasks SET model='conflicting/model' WHERE id='legacy'").run();
  expect(() => migrateScheduledTaskAuthorities(db)).toThrow("metadata mismatch");
  expect(db.query("SELECT * FROM service_effect_s07_task_revisions ORDER BY revision").all()).toEqual(before);
  expect(db.query("SELECT name FROM sqlite_schema WHERE name='host_scheduled_task_definitions'").get()).toBeNull();
  expect(db.query("SELECT id FROM piclaw_schema_migrations WHERE owner=?").all(scheduledDefinitionMigration.owner)).toEqual([]);
  expect(db.query("SELECT prompt,model FROM scheduled_tasks WHERE id='legacy'").get()).toEqual({ prompt: "only current bytes", model: "conflicting/model" });
});

test("receipt drift, temporary shadows and unowned shapes fail without repair", () => {
  createTask(task()); const db = getDb(), before = getTaskById("definition");
  db.exec("CREATE TEMP TABLE HOST_SCHEDULED_TASK_DEFINITIONS(x TEXT)");
  expect(() => migrateScheduledTaskAuthorities(db)).toThrow("shadow");
  db.exec("DROP TABLE temp.HOST_SCHEDULED_TASK_DEFINITIONS");
  db.query("UPDATE piclaw_schema_migrations SET checksum=? WHERE owner=?").run("0".repeat(64),scheduledDefinitionMigration.owner);
  expect(() => migrateScheduledTaskAuthorities(db)).toThrow("schema or receipt");
  expect(db.query("SELECT prompt FROM scheduled_tasks WHERE id='definition'").get()).toEqual({ prompt: before!.prompt });
  db.exec("DROP TABLE host_scheduled_task_definitions; DROP INDEX idx_scheduled_task_paused_successor; DELETE FROM piclaw_schema_migrations WHERE owner='host.scheduled-definitions'; CREATE TABLE host_scheduled_task_definitions(x TEXT)");
  expect(() => migrateScheduledTaskAuthorities(db)).toThrow("schema or receipt");
  expect(db.query("PRAGMA table_info(host_scheduled_task_definitions)").all()).toHaveLength(1);
});

test("completion and history roll back when their task projection fails; replay repairs only cache", async () => {
  createTask({ ...task(), task_kind: "shell", command: "printf original", schedule_type: "once", schedule_value: slot });
  const db = getDb(), { s, lease, request } = await claim("definition");
  db.exec(`CREATE TEMP TRIGGER fail_after_history BEFORE UPDATE ON main.scheduled_tasks
    WHEN EXISTS(SELECT 1 FROM task_run_logs WHERE occurrence_id='${lease.record.runId}') BEGIN SELECT RAISE(ABORT,'fixture final projection failure'); END`);
  expect((await s.complete(request)).ok).toBe(false);
  expect(value(await s.get(lease.record.runId))?.state).toBe("claimed");
  expect(db.query("SELECT count(*) AS n FROM service_effect_s07_run_logs").get()).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) AS n FROM task_run_logs").get()).toEqual({ n: 0 });
  expect(getTaskById("definition")).toMatchObject({ status: "active", next_run: slot, prompt: "original prompt" });
  db.exec("DROP TRIGGER temp.fail_after_history");
  const completed = value(await s.complete(request));
  expect(getTaskById("definition")).toMatchObject({ status: "completed", next_run: null, last_result: "original output" });
  db.query("UPDATE scheduled_tasks SET prompt='WRONG',status='active',next_run=? WHERE id='definition'").run(slot);
  expect(value(await s.complete(request))).toEqual(completed);
  applyScheduledRunToTask(completed,"UNTRUSTED caller text");
  expect(db.query("SELECT prompt,status,next_run,last_result FROM scheduled_tasks WHERE id='definition'").get())
    .toEqual({ prompt: "original prompt", status: "completed", next_run: null, last_result: "original output" });
  expect(db.query("SELECT count(*) AS n FROM task_run_logs").get()).toEqual({ n: 1 });
});

function branchTree() {
  storeChatMetadata("web:parent",at); storeChatMetadata("web:parent:child",at);
  const parent = ensureChatBranch({ chat_jid: "web:parent", agent_name: "definition-parent" });
  const child = ensureChatBranch({ chat_jid: "web:parent:child", root_chat_jid: parent.chat_jid, parent_branch_id: parent.branch_id, agent_name: "definition-child" });
  return { parent, child };
}

test("retired chat address and merge APIs cannot alter scheduling identity or hash evidence", () => {
  const {parent,child}=branchTree();createTask({...task(),chat_jid:child.chat_jid});
  const db=getDb(), original=readScheduledDefinition(db,"definition",1);
  expect(branchStore).not.toHaveProperty("renameChatJid");expect(branchStore).not.toHaveProperty("mergeChatBranchIntoParent");
  expect(getTaskById("definition")).toMatchObject({revision:1,chat_jid:child.chat_jid,prompt:"original prompt"});
  expect(readScheduledDefinition(db,"definition",1)).toEqual(original);
  expect(branchStore.getChatBranchByChatJid(parent.chat_jid)).toEqual(parent);expect(branchStore.getChatBranchByChatJid(child.chat_jid)).toEqual(child);
  expect(db.query("PRAGMA foreign_keys").get()).toEqual({foreign_keys:1});expect(db.query("PRAGMA defer_foreign_keys").get()).toEqual({defer_foreign_keys:0});expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("foreign-key failure rolls back supported task-definition revisions in the physical outer transaction", () => {
  const {parent,child}=branchTree();createTask({...task(),chat_jid:child.chat_jid});
  const db=getDb(),original=readScheduledDefinition(db,"definition",1);
  db.exec("CREATE TABLE fixture_foreign_hold(chat_jid TEXT REFERENCES chats(jid))");db.query("INSERT INTO fixture_foreign_hold VALUES (?)").run(parent.chat_jid);
  expect(()=>db.transaction(()=>{updateTask("definition",{prompt:"must roll back"});db.query("DELETE FROM chats WHERE jid=?").run(parent.chat_jid);}).immediate()).toThrow("FOREIGN KEY");
  expect(getTaskById("definition")).toMatchObject({revision:1,chat_jid:child.chat_jid,prompt:"original prompt"});expect(readScheduledDefinition(db,"definition",1)).toEqual(original);
  expect(db.query("SELECT revision FROM host_scheduled_task_definitions").all()).toEqual([{revision:1}]);expect(db.query("PRAGMA foreign_keys").get()).toEqual({foreign_keys:1});expect(db.query("PRAGMA defer_foreign_keys").get()).toEqual({defer_foreign_keys:0});expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("late old-revision completion and direct settlement cannot advance the edited head", async () => {
  createTask({ ...task(), task_kind: "shell", command: "printf original" });
  const { s, request } = await claim("definition"), next = "2026-11-01T00:00:00.000Z";
  updateTask("definition", { prompt: "new revision", command: "printf new", next_run: next });
  const completed = value(await s.complete(request));
  expect(completed.headDisposition).toBe("superseded");
  expect(getTaskById("definition")).toMatchObject({ revision: 2, prompt: "new revision", command: "printf new", next_run: next, status: "active" });
  updateTaskAfterRun("definition",null,"stale direct result",1);
  expect(getTaskById("definition")).toMatchObject({ revision: 2, next_run: next, status: "active", last_result: "original output" });
  expect(readScheduledDefinition(getDb(),"definition",1).body?.command).toBe("printf original");
});

test("archive export includes revision/body provenance; explicit task deletion tombstones its scheduling owner", () => {
  const { child } = branchTree();
  createTask({ ...task(), chat_jid: child.chat_jid }); updateTask("definition", { prompt: "newer prompt" });
  archiveChatBranch(child.chat_jid);
  const exported = exportArchivedBranchDownloadData(child.chat_jid);
  expect(exported.scheduled_definition_revisions).toHaveLength(2);
  expect(exported.scheduled_definition_revisions[0]).toMatchObject({ origin: "authored", availability: "known", revision: 1 });
  expect(JSON.parse(String(exported.scheduled_definition_revisions[0]!.payload_json)).prompt).toBe("original prompt");
  expect(branchStore).not.toHaveProperty("permanentDeleteArchivedBranch");
  deleteTask("definition");
  expect(branchStore.getChatBranchByChatJid(child.chat_jid)).not.toBeNull();
  expect(getTaskById("definition")).toBeNull();
  expect(getDb().query("SELECT status FROM service_effect_s07_tasks WHERE task_id='definition'").get()).toEqual({ status: "deleted" });
  expect(readScheduledDefinition(getDb(),"definition",1).availability).toBe("retired");
});
