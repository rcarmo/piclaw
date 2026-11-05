import "./src/test-guard.js";
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHostProcessControls, nativeProcessToolNames } from "../../runtime/durable-engine/src/host-process-controls.js";
import { nativeExitNotice, type NativeExitReceipt } from "../../runtime/durable-engine/src/host-process-receipt.js";
import type { AcceptedInput, NativeProcessSnapshot } from "../../runtime/durable-engine/src/host-runtime.js";
import { addLogSink, removeLogSink, type LogRecord } from "../../runtime/src/utils/logger.js";
import { BACKGROUND_CONTEXT as context } from "../../runtime/durable-engine/qualification/context.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture(native=false) {
  // Deliberately independent schema: only the read-side contract of this controller.
  const root = new Database(":memory:"); databases.push(root);
  root.exec(`
    CREATE TABLE tasks(id INTEGER PRIMARY KEY, status TEXT, abort_requested INTEGER);
    CREATE TABLE submissions(id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE service_effect_s01_operations(operation_id TEXT PRIMARY KEY, phase TEXT, terminal_disposition TEXT);
    CREATE TABLE service_effect_s01_sources(chat_jid TEXT, source_seq INTEGER, state TEXT);
    CREATE TABLE service_effect_s01_queued_inputs(state TEXT);
    CREATE TABLE service_effect_s07_occurrences(state TEXT);
    CREATE TABLE chat_cursors(queued_followups_json TEXT);
    CREATE TABLE messages(chat_jid TEXT, content TEXT, is_bot_message INTEGER, is_terminal_agent_reply INTEGER);
    INSERT INTO tasks VALUES (9,'running',0),(8,'running',0);
    INSERT INTO submissions VALUES (4,'placed');
    INSERT INTO service_effect_s01_operations VALUES ('op','executing',NULL);
    INSERT INTO service_effect_s01_sources VALUES ('chat',1,'claimed');
    INSERT INTO chat_cursors VALUES ('[]');
  `);
  const input: AcceptedInput = { incarnation: "inc", conversationId: 7 as AcceptedInput["conversationId"],
    chatJid: "chat", branchId: "main", operationId: native?"native-message:7:1":"op", sourceSeq: 1, sourceId: "source",
    payloadRef: "payload", requestId: "request", requestHash: "a".repeat(64) };
  if(native)root.exec("DELETE FROM service_effect_s01_operations; UPDATE service_effect_s01_sources SET state='consumed';");
  let scope: NativeProcessSnapshot["scope"] = { input, submissionIds: [4], taskId: 9 as any,
    generationId: 8 as any, assistantId: 12, singleton: true };
  let tasks = [9, 8], submissions = [4], scheduling = "open";
  let owner = true, sourceCurrent = true, scopeError = false, revokeDuringInspect = false;
  let closed = 0, cleanupError: Error | undefined, shutdownError: Error | undefined, inspectCalls = 0;
  let duringCleanup: (() => void) | undefined;
  let verified: NativeExitReceipt | undefined;
  let hostBusy: "queue" | "control" | undefined;
  const hostIdleInputs: (AcceptedInput | undefined)[] = [];
  const deferred: (() => Promise<void>)[] = [], shutdowns: string[] = [], events: string[] = [];
  const runtime = {
    async inspectProcessControl(call?: { conversationId: number; taskId: number; callId: string }): Promise<NativeProcessSnapshot> {
      inspectCalls++;
      if (call) {
        expect(call).toEqual({ conversationId: 7, taskId: 9, callId: "exit-call" });
        if (scopeError) throw Error("Owned or unbound conversation: no root accepted scope");
      }
      if (revokeDuringInspect) owner = false;
      // No invocation means a global postterminal inspection, NOT recapture of a dead tool.
      return { scope: call ? scope : undefined, inspection: {
        scheduling, tasks: tasks.map(id => ({ record: { id } })), submissions: submissions.map(id => ({ id })),
      } as unknown as NativeProcessSnapshot["inspection"] };
    },
    assertCapturedSourceCurrent(captured: readonly unknown[]) {
      expect(captured).toEqual([{ ...input, submissionId: 4 }]);
      if (!sourceCurrent) throw Error("Source revoked");
    },
    async verifyProcessExitRound(assistant: number, captured: AcceptedInput) {
      expect(assistant).toBe(12); expect(captured).toEqual(input); return verified;
    },
  };
  const options = { root, runtime: () => runtime,
    assertOwner() { if (!owner) throw Error("Owner revoked"); },
    assertHostIdle(input?: AcceptedInput) {
      hostIdleInputs.push(input);
      if (hostBusy) throw Error(`Host ${hostBusy} is active or uncertain`);
    },
    async closeNative() { closed++; events.push("cleanup"); duringCleanup?.(); if (cleanupError) throw cleanupError; },
    requestShutdown(reason: string) { if (shutdownError) throw shutdownError; shutdowns.push(reason); events.push("shutdown"); },
    defer(run: () => Promise<void>) { deferred.push(run); },
  };
  const controls = createHostProcessControls(options);
  const run = (name = "exit_process", args: any = { reason: "  maintenance  " }) =>
    controls.tools.find(t => t.name === name)!.execute(args, { conversationId: 7, taskId: 9, callId: "exit-call" } as any, context) as Promise<any>;
  const afterTools = (assistant = 12) => (controls.extension as any).hooks[0].handlers.afterTools(assistant);
  function terminal(disposition = "completed") {
    root.query("UPDATE service_effect_s01_operations SET phase='terminal',terminal_disposition=?").run(disposition);
    root.exec("UPDATE tasks SET status='terminal'; UPDATE submissions SET status='completed'; UPDATE service_effect_s01_sources SET state='consumed';");
    tasks = []; submissions = [];
  }
  return { root, input, controls, run, afterTools, terminal, deferred, shutdowns, events,
    fresh: () => createHostProcessControls(options),
    hostBusy(kind?: "queue" | "control") { hostBusy = kind; }, hostIdleInputs,
    verify(receipt?: NativeExitReceipt) { verified = receipt; },
    scope(value: NativeProcessSnapshot["scope"]) { scope = value; }, getScope: () => scope!,
    sdk(taskIds: number[], submissionIds: number[] = [4]) { tasks = taskIds; submissions = submissionIds; },
    closing() { scheduling = "closing"; }, rejectScope() { scopeError = true; },
    revoke() { owner = false; }, revokeOnInspect() { revokeDuringInspect = true; },
    revokeSource() { sourceCurrent = false; }, rejectCleanup(error = Error("uncertain cleanup")) { cleanupError = error; },
    duringCleanup(run: () => void) { duringCleanup = run; },
    rejectShutdown(error: Error) { shutdownError = error; },
    stats: () => ({ closed, inspectCalls }),
  };
}

function refused(f: ReturnType<typeof fixture>, result: any) {
  expect(result.isError).toBe(true);
  expect(result.control).toBeUndefined();
  expect(result.details).toEqual({ scheduled: false, pending: false, safe_to_restart: false });
  expect(f.controls.pending()).toBe(false);
  expect(() => f.controls.assertAdmission()).not.toThrow();
  expect(f.deferred).toHaveLength(0); expect(f.shutdowns).toHaveLength(0); expect(f.stats().closed).toBe(0);
}

test("registration is model-only, unsafe and sequential", () => {
  const f = fixture(); expect(f.controls.tools.map(t => t.name)).toEqual([...nativeProcessToolNames]);
  for (const tool of f.controls.tools) {
    expect(tool.callers).toEqual(["model"]); expect(tool.replay).toBe("unsafe"); expect(tool.executionMode).toBe("sequential");
  }
});

test("native exit advertises only the supported bounded reason, never an unusable resume argument", () => {
  const f = fixture();
  const schema = JSON.parse(JSON.stringify(f.controls.tools.find(tool => tool.name === "exit_process")!.parameters));
  expect(Object.keys(schema.properties)).toEqual(["reason"]);
  expect(schema.required).toEqual(["reason"]);
  expect(schema.properties.reason).toMatchObject({ type: "string", minLength: 1, maxLength: 512, pattern: "\\S" });
  expect(f.controls.pending()).toBe(false);
  expect(f.stats()).toEqual({ closed: 0, inspectCalls: 0 });
});

test("exact singleton exit returns a conditional notice and terminate receipt, never immediate shutdown", async () => {
  const f = fixture(); expect(() => f.controls.assertAdmission()).not.toThrow();
  const result = await f.run();
  expect(result.isError).not.toBe(true); expect(result.control).toEqual({ terminate: true });
  expect(result.output).toEqual([{ type: "text", text: nativeExitNotice("maintenance") }]);
  expect(result.details).toEqual({ kind: "native_process_exit", version: 1, nonce: expect.stringMatching(/^[0-9a-f-]{36}$/),
    reason: "maintenance", taskId: 9, assistantId: 12, input: f.input });
  expect(f.controls.pending()).toBe(true); expect(f.controls.ownsOperation("op")).toBe(true);
  expect(f.controls.ownsOperation("other")).toBe(false);
  expect(() => f.controls.assertAdmission()).toThrow("sealed");
  expect(() => f.controls.assertAdmission({ ...f.input })).not.toThrow();
  for (const key of Object.keys(f.input)) {
    expect(() => f.controls.assertAdmission({ ...f.input, [key]: "different" } as any)).toThrow("sealed");
  }
  expect(f.deferred).toHaveLength(0); expect(f.shutdowns).toHaveLength(0); expect(f.stats().closed).toBe(0);
  expect((await f.run()).isError).toBe(true);
});

test("session_status reports native counts read-only, including busy work", async () => {
  const f = fixture(); f.sdk([9, 8, 33], [4, 5]);
  f.root.exec("INSERT INTO tasks VALUES (33,'running',0); INSERT INTO submissions VALUES (5,'queued');");
  const before = f.root.serialize();
  for (const action of ["list", "check"]) {
    const result = await f.run("session_status", { action });
    expect(JSON.parse(result.output[0].text)).toEqual({ safe_to_restart: false, active_tasks: 3,
      unsettled_submissions: 2, chat_jid: "chat", current_operation_id: "op", blocker: "sdk_task" });
    expect(result.control).toBeUndefined();
  }
  expect(f.root.serialize()).toEqual(before); expect(f.controls.pending()).toBe(false);
  expect(() => f.controls.assertAdmission()).not.toThrow(); expect(f.deferred).toHaveLength(0);
});

test("singleton status grants safety without sealing admission", async () => {
  const f = fixture(); const result = await f.run("session_status", { action: "check" });
  expect(JSON.parse(result.output[0].text)).toEqual({ safe_to_restart: true, active_tasks: 2,
    unsettled_submissions: 1, chat_jid: "chat", current_operation_id: "op" });
  expect(f.controls.pending()).toBe(false); expect(() => f.controls.assertAdmission()).not.toThrow();
});

const busySql = {
  "claimed scheduled occurrence": "INSERT INTO service_effect_s07_occurrences VALUES ('claimed')",
  "source-bound uncertain scheduled occurrence": "INSERT INTO service_effect_s07_occurrences VALUES ('source_bound')",
  "foreign SDK task": "INSERT INTO tasks VALUES (30,'running',0)",
  "foreign submission": "INSERT INTO submissions VALUES (30,'queued')",
  "foreign host operation": "INSERT INTO service_effect_s01_operations VALUES ('foreign','executing',NULL)",
  "pending source": "INSERT INTO service_effect_s01_sources VALUES ('other',2,'accepted')",
  "same-chat sibling source": "INSERT INTO service_effect_s01_sources VALUES ('chat',2,'accepted')",
  "host queued input": "INSERT INTO service_effect_s01_queued_inputs VALUES ('queued')",
  "deferred queue": "UPDATE chat_cursors SET queued_followups_json='[{}]'",
  "unreadable deferred queue": "UPDATE chat_cursors SET queued_followups_json='bad json'",
  "uncertain own task": "UPDATE tasks SET abort_requested=1 WHERE id=9",
};
for (const [name, sql] of Object.entries(busySql)) test(`${name} refuses with no admission latch`, async () => {
  const f = fixture(); f.root.exec(sql); refused(f, await f.run());
});
for (const kind of ["task", "submission", "closing", "sibling", "owned", "unbound", "source"] as const) {
  test(`${kind} runtime scope/work refuses with no latch`, async () => {
    const f = fixture();
    if (kind === "task") f.sdk([9, 8, 30]);
    if (kind === "submission") f.sdk([9, 8], [4, 30]);
    if (kind === "closing") f.closing();
    if (kind === "sibling") f.scope({ ...f.getScope(), singleton: false });
    if (kind === "owned") f.rejectScope(); // Host runtime rejects conversation.owner before returning scope.
    if (kind === "unbound") f.scope(undefined);
    if (kind === "source") f.revokeSource();
    refused(f, await f.run());
  });
}
for (const phase of ["before", "during inspection"] as const) test(`ownership revoked ${phase} denies exit`, async () => {
  const f = fixture(); if (phase === "before") f.revoke(); else f.revokeOnInspect();
  const result = await f.run(); expect(result.isError).toBe(true); expect(f.controls.pending()).toBe(false);
  expect(() => f.controls.assertAdmission(f.input)).toThrow("revoked");
  expect(f.deferred).toHaveLength(0); expect(f.shutdowns).toHaveLength(0);
});

test("resume_message, even empty, refuses without inspection or latch", async () => {
  const f = fixture(); refused(f, await f.run("exit_process", { reason: "restart", resume_message: "" }));
  expect(f.stats().inspectCalls).toBe(0);
});

for (const mismatch of ["missing", "nonce"] as const) test(`committed failed afterTools (${mismatch}) disarms latch`, async () => {
  const f = fixture(), result = await f.run();
  f.verify(mismatch === "nonce" ? { ...result.details, nonce: "different" } : undefined);
  await f.afterTools(99); expect(f.controls.pending()).toBe(true);
  await f.afterTools(); expect(f.controls.pending()).toBe(false);
  expect(() => f.controls.assertAdmission()).not.toThrow();
  f.terminal(); f.controls.onOperationSettled("op", result.details);
  expect(f.deferred).toHaveLength(0); expect(f.shutdowns).toHaveLength(0);
});

test("terminal persistence precedes one deferred cleanup/shutdown", async () => {
  const f = fixture(), result = await f.run(); f.verify(result.details); await f.afterTools();
  expect(f.controls.pending()).toBe(true);
  expect(() => f.controls.onOperationSettled("op", result.details)).toThrow("persistence");
  expect(f.deferred).toHaveLength(0); expect(f.shutdowns).toHaveLength(0);
  f.terminal();
  f.controls.onOperationSettled("other", result.details); expect(f.deferred).toHaveLength(0);
  for (let i = 0; i < 3; i++) f.controls.onOperationSettled("op", result.details);
  expect(f.deferred).toHaveLength(1); expect(f.shutdowns).toHaveLength(0);
  await f.deferred[0]();
  expect(f.events).toEqual(["cleanup", "shutdown"]); expect(f.shutdowns).toEqual(["maintenance"]);
  f.controls.onOperationSettled("op", result.details); expect(f.deferred).toHaveLength(1);
});

for (const mode of ["failed operation", "missing receipt", "wrong nonce"] as const) test(`${mode} never schedules terminal shutdown`, async () => {
  const f = fixture(), result = await f.run(); f.terminal(mode === "failed operation" ? "failed" : "completed");
  f.controls.onOperationSettled("op", mode === "missing receipt" ? undefined : mode === "wrong nonce" ? { ...result.details, nonce: "wrong" } : result.details);
  expect(f.controls.pending()).toBe(false); expect(f.deferred).toHaveLength(0); expect(f.shutdowns).toHaveLength(0);
});

for (const mode of ["SDK", "SQL", "ownership"] as const) test(`final ${mode} work/authority check denies and never retries`, async () => {
  const f = fixture(), result = await f.run(); f.terminal(); f.controls.onOperationSettled("op", result.details);
  if (mode === "SDK") f.sdk([30], []);
  if (mode === "SQL") f.root.exec("INSERT INTO service_effect_s01_operations VALUES ('late','executing',NULL)");
  if (mode === "ownership") f.revoke();
  await f.deferred[0]();
  expect(f.stats().closed).toBe(0); expect(f.shutdowns).toHaveLength(0);
  if (mode !== "ownership") {
    expect(f.controls.pending()).toBe(false);
    f.sdk([], []); f.root.exec("DELETE FROM service_effect_s01_operations WHERE operation_id='late'");
    f.controls.onOperationSettled("op", result.details); expect(f.deferred).toHaveLength(1);
  }
});

test("cleanup rejection never requests shutdown and repeated settlement cannot retry", async () => {
  const f = fixture(), result = await f.run(); f.terminal(); f.rejectCleanup();
  f.controls.onOperationSettled("op", result.details); await f.deferred[0]();
  expect(f.stats().closed).toBe(1); expect(f.shutdowns).toHaveLength(0);
  expect(() => f.controls.assertAdmission()).toThrow("sealed");
  f.controls.onOperationSettled("op", result.details); expect(f.deferred).toHaveLength(1);
});

test("recovery/new controller cannot rearm shutdown from a durable receipt alone", async () => {
  const f = fixture(), result = await f.run(); f.terminal(); f.verify(result.details);
  const recovered = f.fresh();
  await (recovered.extension as any).hooks[0].handlers.afterTools(12);
  recovered.onOperationSettled("op", result.details);
  expect(recovered.pending()).toBe(false); expect(recovered.ownsOperation("op")).toBe(false);
  expect(() => recovered.assertAdmission()).not.toThrow();
  expect(f.deferred).toHaveLength(0); expect(f.shutdowns).toHaveLength(0); expect(f.stats().closed).toBe(0);
});

for (const kind of ["queue", "control"] as const) test(`host ${kind} refuses before admission latch`, async () => {
  const f = fixture(); f.hostBusy(kind);
  const status = await f.run("session_status", { action: "check" });
  expect(JSON.parse(status.output[0].text).safe_to_restart).toBe(false);
  refused(f, await f.run());
  expect(f.hostIdleInputs).toEqual([f.input, f.input]);
  f.hostBusy();
  expect((await f.run()).control).toEqual({ terminate: true });
});

for (const kind of ["queue", "control", "claimed", "source_bound"] as const) test(`late final ${kind} refuses cleanup and shutdown without retry`, async () => {
  const f = fixture(), result = await f.run();
  expect(result.control).toEqual({ terminate: true });
  expect(f.hostIdleInputs).toEqual([f.input]);
  f.terminal(); f.controls.onOperationSettled("op", result.details);
  expect(f.deferred).toHaveLength(1);
  if (kind === "queue" || kind === "control") f.hostBusy(kind);
  else f.root.query("INSERT INTO service_effect_s07_occurrences VALUES (?)").run(kind);
  await f.deferred[0]();
  expect(f.hostIdleInputs).toEqual([f.input, undefined]);
  expect(f.stats().closed).toBe(0); expect(f.shutdowns).toHaveLength(0);
  expect(f.controls.pending()).toBe(false);
  expect(() => f.controls.assertAdmission()).not.toThrow();
  f.hostBusy(); f.root.exec("DELETE FROM service_effect_s07_occurrences");
  f.controls.onOperationSettled("op", result.details);
  expect(f.deferred).toHaveLength(1); expect(f.shutdowns).toHaveLength(0);
});

test("direct native exit seals admission at idle and shares final cleanup checks", async () => {
  const f = fixture(); f.terminal();
  await f.controls.requestCommandExit("  user /exit  ");
  expect(f.controls.pending()).toBe(true);
  expect(() => f.controls.assertAdmission()).toThrow("sealed");
  await expect(f.controls.requestCommandExit("duplicate")).rejects.toThrow("sealed");
  expect(f.deferred).toHaveLength(1);
  expect(f.shutdowns).toEqual([]);
  await f.deferred[0]!();
  expect(f.events).toEqual(["cleanup", "shutdown"]);
  expect(f.shutdowns).toEqual(["user /exit"]);
});

test("direct native exit refuses accepted work, host controls and uncertain scheduling", async () => {
  const f = fixture();
  await expect(f.controls.requestCommandExit("user /exit")).rejects.toThrow();
  expect(f.controls.pending()).toBe(false);
  f.terminal(); f.hostBusy("control");
  await expect(f.controls.requestCommandExit("user /exit")).rejects.toThrow();
  f.hostBusy(undefined); f.closing();
  await expect(f.controls.requestCommandExit("user /exit")).rejects.toThrow();
  expect(f.controls.pending()).toBe(false);
  expect(f.deferred).toHaveLength(0);
  expect(f.shutdowns).toEqual([]);
});

test("direct exit cancels on final queued input and never retries", async () => {
  const f = fixture(); f.terminal();
  await f.controls.requestCommandExit("user /exit");
  f.root.exec("INSERT INTO service_effect_s01_queued_inputs VALUES ('queued')");
  await f.deferred[0]!();
  expect(f.controls.pending()).toBe(false);
  expect(f.shutdowns).toEqual([]); expect(f.stats().closed).toBe(0);
  expect(f.deferred).toHaveLength(1);
});

test("status identifies a bounded blocker without changing admission", async () => {
  const f = fixture(); f.root.exec("INSERT INTO service_effect_s07_occurrences VALUES ('claimed')");
  const result = await f.run("session_status", { action: "check" });
  expect(JSON.parse(result.output[0].text)).toEqual({ safe_to_restart: false, active_tasks: 2,
    unsettled_submissions: 1, chat_jid: "chat", current_operation_id: "op", blocker: "scheduled_execution" });
  expect(f.controls.pending()).toBe(false); expect(f.stats().closed).toBe(0);
  expect(f.shutdowns).toHaveLength(0);
});

for (const mode of ["inspection", "before_cleanup", "cleanup", "after_cleanup", "shutdown_request"] as const) {
  test(`bounded refusal diagnostics identify ${mode} without weakening the hold`, async () => {
    const f = fixture(), records: LogRecord[] = [];
    const sink = (record: LogRecord) => { if (record.module === "native.process-controls") records.push(record); };
    addLogSink(sink);
    try {
      const result = await f.run(); f.terminal(); f.controls.onOperationSettled("op", result.details);
      const insert = () => f.root.exec("INSERT INTO service_effect_s07_occurrences VALUES ('source_bound')");
      if (mode === "inspection") f.sdk([30], []);
      if (mode === "before_cleanup") insert();
      if (mode === "cleanup") f.rejectCleanup(Error("synthetic-private-diagnostic-token"));
      if (mode === "after_cleanup") f.duringCleanup(insert);
      if (mode === "shutdown_request") f.rejectShutdown(Error("synthetic-private-diagnostic-token"));
      await f.deferred[0]!();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ operation: "native_exit.refused", phase: mode,
        blocker: mode === "inspection" ? "sdk_activity" : mode === "cleanup" || mode === "shutdown_request" ? "unclassified" : "scheduled_execution" });
      expect(JSON.stringify(records)).not.toContain("synthetic-private-diagnostic-token");
      expect(records[0]!.err).toBeUndefined();
      expect(f.shutdowns).toHaveLength(0);
      expect(f.stats().closed).toBe(mode === "cleanup" || mode === "after_cleanup" || mode === "shutdown_request" ? 1 : 0);
      expect(f.controls.pending()).toBe(mode === "cleanup" || mode === "after_cleanup" || mode === "shutdown_request");
      f.controls.onOperationSettled("op", result.details);
      expect(f.deferred).toHaveLength(1); // Never rearm a refused request.
    } finally { removeLogSink(sink); }
  });
}

test("direct exit leaves admission sealed on ownership loss or uncertain cleanup", async () => {
  const lost = fixture(); lost.terminal(); lost.revokeOnInspect();
  await expect(lost.controls.requestCommandExit("user /exit")).rejects.toThrow();
  expect(lost.controls.pending()).toBe(true); expect(lost.deferred).toHaveLength(0);
  const cleanup = fixture(); cleanup.terminal(); cleanup.rejectCleanup();
  await cleanup.controls.requestCommandExit("user /exit");
  await cleanup.deferred[0]!();
  expect(cleanup.controls.pending()).toBe(true); expect(cleanup.shutdowns).toEqual([]);
});

for(const acknowledged of [false,true])test(`native singleton uses SDK receipt and committed timeline notice, not an operation/S02 (ACK=${acknowledged})`,async()=>{
  const f=fixture(true);if(!acknowledged)f.root.exec("UPDATE service_effect_s01_sources SET state='pending'");
  const status=await f.run("session_status",{action:"check"});expect(JSON.parse(status.output[0].text).safe_to_restart).toBe(true);
  const result=await f.run();expect(result.control).toEqual({terminate:true});f.verify(result.details);await f.afterTools();
  expect(()=>f.controls.onMessagePublished(f.input,1,result.details)).toThrow("persistence");expect(f.deferred).toHaveLength(0);
  f.root.exec("BEGIN IMMEDIATE");f.root.query("INSERT INTO messages VALUES (?,?,1,1)").run("chat",nativeExitNotice("maintenance"));
  expect(()=>f.controls.onMessagePublished(f.input,1,result.details)).toThrow("persistence");f.root.exec("ROLLBACK");expect(f.deferred).toHaveLength(0);
  f.root.query("INSERT INTO messages VALUES (?,?,1,1)").run("chat",nativeExitNotice("maintenance"));
  expect(()=>f.controls.onMessagePublished(f.input,1,{...result.details,reason:"wrong"})).toThrow("receipt");
  expect(()=>f.controls.onMessagePublished(f.input,1,{...result.details,nonce:"wrong"})).toThrow("receipt");expect(f.deferred).toHaveLength(0);
  f.terminal();f.controls.onMessagePublished(f.input,1,result.details);f.controls.onMessagePublished(f.input,1,result.details);
  expect(f.root.query("SELECT * FROM service_effect_s01_operations").all()).toEqual([]);expect(f.deferred).toHaveLength(1);
  await f.deferred[0]!();expect(f.events).toEqual(["cleanup","shutdown"]);expect(f.shutdowns).toEqual(["maintenance"]);
  const recovered=f.fresh();recovered.onMessagePublished(f.input,1,result.details);expect(recovered.pending()).toBe(false);expect(f.deferred).toHaveLength(1);
});
