import { beforeEach, afterEach, expect, test } from "bun:test";
import { initDatabase, getDb } from "../../src/db.js";
import { AddonOperationService } from "../../src/addons/operation-service.js";
import {
  OperationConflictError,
  type OperationExecution,
  type OperationGrant,
  type OperationResult,
} from "../../src/addons/operation-contracts.js";
import {
  readAddonOperation,
  transitionAddonOperation,
  purgeAddonOperations,
  appendOperationInput,
} from "../../src/db/addon-operations.js";
import { withExecutionIdentity } from "../../src/core/execution-context.js";

let service: AddonOperationService;
let allowed = true;
let grant: OperationGrant;
let executions: OperationExecution[];
let execute: (input: OperationExecution) => Promise<OperationResult>;
beforeEach(() => {
  initDatabase();
  getDb().exec(
    "DELETE FROM addon_operation_events; DELETE FROM addon_operations;",
  );
  allowed = true;
  executions = [];
  grant = {
    revision: "operator-policy-1",
    target: "echo",
    allowedTools: [],
    timeoutMs: 5000,
    maxToolCalls: 0,
    parentWorkId: null,
  };
  execute = async () => ({ status: "completed", output: "public result" });
  service = new AddonOperationService({
    authorize: () =>
      allowed ? { decision: "allow", grant } : { decision: "rejected" },
    execute: async (input) => {
      executions.push(input);
      return execute(input);
    },
  });
});
afterEach(async () => {
  service.shutdown();
  await service.waitForIdle();
});
const principal = { addonId: "example", principalId: "client-a" };
const input = {
  target: "echo",
  idempotencyKey: "same-key",
  text: "untrusted external input",
};

test("atomic concurrent admission deduplicates without financial work and returns only scoped public results", async () => {
  const financialBefore=getDb().query('SELECT * FROM budget_work ORDER BY id').all();
  const client = service.bind(principal);
  const responses = await Promise.all(
    Array.from({ length: 12 }, () => client.admit(input)),
  );
  expect(responses.filter((r) => r.created)).toHaveLength(1);
  expect(new Set(responses.map((r) => r.operation!.id)).size).toBe(1);
  await service.waitForIdle();
  expect(executions).toHaveLength(1);
  const id = responses[0].operation!.id;
  const result = await client.get(id);
  expect(result).toMatchObject({
    status: "completed",
    output: "public result",
    sequence: 3,
  });
  expect(result).not.toHaveProperty("chatJid");
  expect(result).not.toHaveProperty("grant");
  expect(result).not.toHaveProperty("text");
  expect(executions[0].chatJid).toBe("operation:" + id);
  expect(executions[0].workId).toBe(result.workId);
  expect(getDb().query('SELECT * FROM budget_work ORDER BY id').all()).toEqual(financialBefore);
  const replay = await client.events(id);
  expect(replay.events.map((e) => e.snapshot.status)).toEqual([
    "queued",
    "working",
    "completed",
  ]);
  await expect(
    client.admit({ ...input, text: "different" }),
  ).rejects.toBeInstanceOf(OperationConflictError);
});

test("principal/target policy and family identity deny before admission or lookup", async () => {
  allowed = false;
  const client = service.bind(principal);
  expect((await client.admit(input)).admission).toBe("rejected");
  expect(
    getDb().query("SELECT COUNT(*) AS n FROM addon_operations").get(),
  ).toEqual({ n: 0 });
  allowed = true;
  const receipt = await client.admit(input);
  await service.waitForIdle();
  const other = service.bind({ ...principal, principalId: "client-b" });
  await expect(other.get(receipt.operation!.id)).rejects.toThrow(
    "Operation unavailable",
  );
  await expect(other.cancel(receipt.operation!.id)).rejects.toThrow(
    "Operation unavailable",
  );
  allowed = false;
  await expect(client.get(receipt.operation!.id)).rejects.toThrow(
    "Operation unavailable",
  );
  expect(() =>
    withExecutionIdentity({ mode: "family-shared" } as never, () =>
      service.bind(principal),
    ),
  ).toThrow("Operation unavailable");
  expect(executions).toHaveLength(1);
});

test("cancel asks only its own executor and awaits truthful outcome, then stays immutable", async () => {
  execute = async ({ signal }) =>
    new Promise((resolve) =>
      signal.addEventListener(
        "abort",
        () => resolve({ status: "cancelled", reason: "caller_cancelled" }),
        { once: true },
      ),
    );
  const client = service.bind(principal);
  const receipt = await client.admit(input);
  await Bun.sleep(0);
  const cancelled = await client.cancel(receipt.operation!.id);
  expect(cancelled.outcome).toBe("requested");
  await service.waitForIdle();
  expect((await client.get(receipt.operation!.id)).status).toBe("cancelled");
  expect((await client.cancel(receipt.operation!.id)).outcome).toBe(
    "cancelled",
  );
  expect(
    transitionAddonOperation(
      receipt.operation!.id,
      ["cancelled"],
      "completed",
      "late",
    ),
  ).toBeNull();
});

test("completion wins over unconfirmed cancellation rather than fabricating a cancelled result", async () => {
  let finish!: (result: OperationResult) => void;
  execute = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const client = service.bind(principal);
  const receipt = await client.admit(input);
  await Bun.sleep(0);
  expect((await client.cancel(receipt.operation!.id)).outcome).toBe(
    "requested",
  );
  finish({ status: "completed", output: "already finished" });
  await service.waitForIdle();
  expect((await client.get(receipt.operation!.id)).status).toBe("completed");
  expect((await client.cancel(receipt.operation!.id)).outcome).toBe(
    "not_cancellable",
  );
});

test("host failures and oversized output do not leak raw exceptions", async () => {
  execute = async () => {
    throw new Error("secret access token fixture");
  };
  const client = service.bind(principal);
  const receipt = await client.admit(input);
  await service.waitForIdle();
  expect(await client.get(receipt.operation!.id)).toMatchObject({
    status: "failed",
    reason: "execution_failed",
    output: null,
  });
  execute = async () => ({
    status: "completed",
    output: "x".repeat(256 * 1024 + 1),
  });
  const second = await client.admit({ ...input, idempotencyKey: "large" });
  await service.waitForIdle();
  expect((await client.get(second.operation!.id)).status).toBe("failed");
});

test("restart reconciles unknown active executions without repeating work, but preserves terminal lookup", async () => {
  const client = service.bind(principal);
  const receipt = await client.admit(input);
  await service.waitForIdle();
  const prior = readAddonOperation(receipt.operation!.id)!;
  getDb()
    .query("UPDATE addon_operations SET status='working' WHERE id=?")
    .run(prior.id);
  service.shutdown();
  service = new AddonOperationService({
    authorize: () => ({ decision: "allow", grant }),
    execute: async () => {
      throw new Error("Must not replay");
    },
  });
  expect(service.recover()).toBe(1);
  expect(await service.bind(principal).get(prior.id)).toMatchObject({
    status: "failed",
    reason: "interrupted_execution_unknown",
  });
  expect(service.recover()).toBe(0);
});

test('native owner receipt recovery: a stale recovered result cannot replace a later input',async()=>{
  const receipt=await service.bind(principal).admit(input);service.shutdown();await service.waitForIdle();
  const id=receipt.operation!.id;expect(transitionAddonOperation(id,['queued'],'working')?.status).toBe('working');
  let entered!:()=>void,finish!:(value:OperationResult)=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
  const recovering=new AddonOperationService({authorize(){throw Error('Recovery must not borrow a spending grant');},async execute(){throw Error('Recovery must never execute');},async recover(record){expect(record.inputSequence).toBe(1);entered();return new Promise<OperationResult>(resolve=>{finish=resolve;});}});
  try{
    expect(recovering.recover()).toBe(1);await ready;
    transitionAddonOperation(id,['working'],'input_required');appendOperationInput(id,'later input');transitionAddonOperation(id,['queued'],'working');const current=readAddonOperation(id);
    finish({status:'completed',output:'stale answer'});await recovering.waitForIdle();expect(readAddonOperation(id)).toEqual(current);expect(executions).toHaveLength(0);
  }finally{finish?.({status:'failed',reason:'fixture_cleanup'});recovering.shutdown();await recovering.waitForIdle();}
});

test("terminal retention expiry releases only the correct principal keys", async () => {
  const client = service.bind(principal);
  const receipt = await client.admit(input);
  await service.waitForIdle();
  const future = new Date(Date.now() + 1000).toISOString();
  expect(
    purgeAddonOperations({ ...principal, principalId: "other" }, future),
  ).toBe(0);
  expect(purgeAddonOperations(principal, future)).toBe(1);
  await expect(client.get(receipt.operation!.id)).rejects.toThrow(
    "unavailable",
  );
  expect((await client.admit(input)).created).toBe(true);
  await service.waitForIdle();
});
