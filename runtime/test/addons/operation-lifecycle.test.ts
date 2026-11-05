import { beforeEach, afterEach, expect, test } from "bun:test";
import { initDatabase, getDb } from "../../src/db.js";
import { AddonOperationService } from "../../src/addons/operation-service.js";
import {
  type OperationGrant,
  type OperationHost,
  type OperationResult,
} from "../../src/addons/operation-contracts.js";
import {
  readAddonOperation,
  transitionAddonOperation,
} from "../../src/db/addon-operations.js";

let service: AddonOperationService;
let authorized: boolean;
let handler: OperationHost["execute"];
const grant: OperationGrant = {
  revision: "r1",
  target: "target",
  allowedTools: [],
  timeoutMs: 500,
  maxToolCalls: 0,
  parentWorkId: null,
};
const principal = { addonId: "fixture", principalId: "alice" };
beforeEach(() => {
  initDatabase();
  getDb().exec(
    "DELETE FROM addon_operation_events;DELETE FROM addon_operations;",
  );
  authorized = true;
  handler = async () => ({ status: "completed", output: "done" });
  service = new AddonOperationService({
    authorize: () =>
      authorized ? { decision: "allow", grant } : { decision: "rejected" },
    execute: (input) => handler(input),
  });
});
afterEach(async () => {
  service.shutdown();
  await service.waitForIdle();
});
const request = (key: string) => ({
  target: "target",
  idempotencyKey: key,
  text: "external data",
});

test("caller-scoped list pagination, terminal subscriptions and duplicate receipts", async () => {
  const client = service.bind(principal),
    other = service.bind({ ...principal, principalId: "bob" });
  for (let i = 0; i < 4; i++) await client.admit(request("a" + i));
  await other.admit(request("b"));
  await service.waitForIdle();
  const first = await client.list(null, 2),
    second = await client.list(first.nextCursor, 2);
  expect(first.operations).toHaveLength(2);
  expect(second.operations).toHaveLength(2);
  expect(second.nextCursor).toBeNull();
  const all = [...first.operations, ...second.operations];
  expect(new Set(all.map((o) => o.id)).size).toBe(4);
  const updates = [];
  for await (const update of client.subscribe(all[0].id)) updates.push(update);
  expect(updates).toHaveLength(1);
  expect(updates[0]).toHaveProperty("snapshot.status", "completed");
  expect((await other.list()).operations).toHaveLength(1);
});

test("subscribers receive durable completion independently; aborting subscription does not cancel execution", async () => {
  let finish!: (r: OperationResult) => void;
  handler = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const client = service.bind(principal),
    receipt = await client.admit(request("stream"));
  await Bun.sleep(0);
  const controller = new AbortController();
  const stream = client.subscribe(receipt.operation!.id, 0, controller.signal);
  expect((await stream.next()).value).toHaveProperty(
    "snapshot.status",
    "working",
  );
  const next = stream.next();
  controller.abort(new Error("subscriber_left"));
  await expect(next).rejects.toThrow("subscriber_left");
  expect((await client.get(receipt.operation!.id)).status).toBe("working");
  finish({ status: "completed", output: "persisted after disconnect" });
  await service.waitForIdle();
  expect((await client.get(receipt.operation!.id)).output).toBe(
    "persisted after disconnect",
  );
  const reconnect = client.subscribe(receipt.operation!.id);
  expect((await reconnect.next()).value).toHaveProperty(
    "snapshot.status",
    "completed",
  );
  await reconnect.return();
});

test("revocation interrupts subscribed access, not unrelated task execution", async () => {
  let finish!: (r: OperationResult) => void;
  handler = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const client = service.bind(principal),
    receipt = await client.admit(request("revoked"));
  await Bun.sleep(0);
  const stream = client.subscribe(receipt.operation!.id);
  await stream.next();
  authorized = false;
  await expect(stream.next()).rejects.toThrow("unavailable");
  finish({ status: "completed" });
  await service.waitForIdle();
  await expect(client.get(receipt.operation!.id)).rejects.toThrow(
    "unavailable",
  );
});

test("input continuation remains in one operation, requires nonempty bounded input", async () => {
  let count = 0;
  handler = async (input) =>
    ++count === 1
      ? { status: "input_required", output: "What value?" }
      : { status: "completed", output: input.text };
  const client = service.bind(principal),
    receipt = await client.admit(request("input"));
  await service.waitForIdle();
  expect((await client.get(receipt.operation!.id)).status).toBe(
    "input_required",
  );
  await expect(client.continue(receipt.operation!.id, "")).rejects.toThrow();
  const result = await client.continue(receipt.operation!.id, "supplied value");
  expect(result.resumed).toBe(true);
  await service.waitForIdle();
  const final = await client.get(receipt.operation!.id);
  expect(final.workId).toBe(receipt.operation!.workId);
  expect(final.output).toBe("supplied value");
  expect(readAddonOperation(receipt.operation!.id)?.text).toBe(
    "supplied value",
  );
  expect(count).toBe(2);
  expect((await client.continue(receipt.operation!.id, "late")).resumed).toBe(
    false,
  );
  expect(count).toBe(2);
});

test('historical budget-only pause cannot be resumed or rewritten by the operation service',async()=>{
  const database=getDb();let executions=0;handler=async()=>{executions++;return {status:'completed'};};
  database.query("INSERT INTO addon_operations(id,addon_id,principal_id,idempotency_key,input_hash,target,text,input_bytes,grant_json,chat_jid,work_id,status,sequence,created_at,updated_at,output,reason) VALUES ('historical-paused','fixture','alice','old','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','target','old input',9,?,'operation:historical-paused','old-financial-work','budget_blocked',1,'2020-01-01','2020-01-01',NULL,'historical_budget_boundary')").run(JSON.stringify(grant));
  const before=database.query("SELECT * FROM addon_operations WHERE id='historical-paused'").get();
  const client=service.bind(principal);expect((await client.resume('historical-paused')).resumed).toBe(false);await service.waitForIdle();
  expect(executions).toBe(0);expect(database.query("SELECT * FROM addon_operations WHERE id='historical-paused'").get()).toEqual(before);
  expect(database.query("SELECT * FROM addon_operation_events WHERE operation_id='historical-paused'").all()).toEqual([]);
});

for(const changed of [false,true])test(`approval-required resume still requires the exact current grant: changed=${changed}`,async()=>{
  service.shutdown();await service.waitForIdle();let admissions=0,executions=0,current=grant;
  service=new AddonOperationService({authorize:(_principal,_target,action)=>action==='admit'&&++admissions===2?{decision:'approval_required'}:{decision:'allow',grant:current},execute:async()=>{executions++;return {status:'completed'};}});
  const client=service.bind(principal),receipt=await client.admit(request('approval'));
  await service.waitForIdle();expect((await client.get(receipt.operation!.id)).status).toBe('approval_required');expect(executions).toBe(0);
  if(changed){current={...grant,revision:'revoked-policy'};await expect(client.resume(receipt.operation!.id)).rejects.toThrow('unavailable');expect(readAddonOperation(receipt.operation!.id)?.status).toBe('approval_required');}
  else{expect((await client.resume(receipt.operation!.id)).resumed).toBe(true);await service.waitForIdle();expect((await client.get(receipt.operation!.id)).status).toBe('completed');}
  expect(executions).toBe(changed?0:1);
});

test('executors cannot reintroduce a new financial-pause result',async()=>{
  handler=async()=>({status:'budget_blocked',reason:'retired_financial_boundary'} as never);
  const client=service.bind(principal),receipt=await client.admit(request('invalid-budget-result'));await service.waitForIdle();
  expect(await client.get(receipt.operation!.id)).toMatchObject({status:'failed',reason:'execution_failed'});
  expect(getDb().query('SELECT * FROM budget_work').all()).toEqual([]);
});

test("bounded nonfinancial operation event replay reports retained gaps", async () => {
  const client = service.bind(principal);
  const next = await client.admit(request("many"));
  await service.waitForIdle();
  // Test retention with host-owned transitions; no adapter mutation API exists.
  getDb()
    .query("UPDATE addon_operations SET status='input_required' WHERE id=?")
    .run(next.operation!.id);
  for (let i = 0; i < 140; i++) {
    const row = readAddonOperation(next.operation!.id)!;
    transitionAddonOperation(
      row.id,
      [row.status],
      row.status === "queued" ? "input_required" : "queued",
    );
  }
  const replay = await client.events(next.operation!.id, 1);
  expect(replay.gap).toBe(true);
  expect(replay.events).toHaveLength(128);
});

test("concurrent active-work quota is enforced inside admission transaction", async () => {
  handler = async (input) =>
    new Promise((resolve) =>
      input.signal.addEventListener(
        "abort",
        () => resolve({ status: "cancelled" }),
        { once: true },
      ),
    );
  const client = service.bind(principal);
  const results = await Promise.allSettled(
    Array.from({ length: 17 }, (_, i) => client.admit(request("quota" + i))),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(16);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  await Bun.sleep(0);
  for (const r of results)
    if (r.status === "fulfilled") await client.cancel(r.value.operation!.id);
  await service.waitForIdle();
});

test("committed model input is not replayed by resume; explicit continuation sends only new input", async () => {
  const { markAddonOperationInputCommitted } =
    await import("../../src/db/addon-operations.js");
  const prompts: string[] = [];
  handler = async (input) => {
    prompts.push(input.text);
    if (prompts.length === 1) {
      markAddonOperationInputCommitted(input.operationId);
      return { status: "input_required" };
    }
    return { status: "completed" };
  };
  const client = service.bind(principal);
  const first = await client.admit(request("resume-committed"));
  await service.waitForIdle();
  expect((await client.resume(first.operation!.id)).resumed).toBe(false);
  expect(prompts).toEqual(['external data']);
  expect((await client.continue(first.operation!.id,'New independently supplied instruction')).resumed).toBe(true);
  await service.waitForIdle();
  expect(prompts).toEqual(['external data','New independently supplied instruction']);
});

test("cumulative input quota survives replacement of previous continuation text", async () => {
  handler = async () => ({ status: "input_required" });
  const client = service.bind(principal);
  const first = await client.admit({
    ...request("quota-continuation"),
    text: "a".repeat(16000),
  });
  await service.waitForIdle();
  await client.continue(first.operation!.id, "b".repeat(16000));
  await service.waitForIdle();
  expect(readAddonOperation(first.operation!.id)?.text).toBe("b".repeat(16000));
  await expect(
    client.continue(first.operation!.id, "c".repeat(1000)),
  ).rejects.toThrow("input limit");
});
