import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

import { createTempWorkspace, importFresh, setEnv, waitFor } from "../helpers.js";
import { createAgentPoolModelOptions } from "../model-services-fixture.js";

let restoreEnv: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
});

function createRuntime(session: any): AgentSessionRuntime {
  return {
    session,
    cwd: "/workspace",
    diagnostics: [],
    services: {} as any,
    modelFallbackMessage: undefined,
    newSession: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    importFromJsonl: async () => ({ cancelled: false }),
    dispose: async () => { session.dispose?.(); },
  } as any;
}

test("remote cancellation persists before aborting only the exact gateway occupant", async () => {
  const ws = createTempWorkspace("piclaw-operation-cancel-control-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
  db.initDatabase();
  const chatJid = "web:operation-cancel-control";
  db.registerAcceptedChatSource({
    chatJid,
    sourceClass: "prompt",
    sourceKind: "queued_followup",
    sourceId: "followup-1",
    acceptedAt: "2026-08-08T08:40:00.000Z",
    payloadRef: "followup:followup-1",
  });
  const operation = db.claimNextChatOperation(chatJid).operation;
  if (!operation) throw new Error("expected operation");
  const owner = {
    operationId: operation.operationId,
    sourceSeq: operation.sourceSeq,
    phase: operation.phase,
    generation: operation.generation,
  };

  let promptStarted = false;
  let releasePrompt!: () => void;
  const promptGate = new Promise<void>((resolve) => { releasePrompt = resolve; });
  let cancellationSeenByAbort: unknown = null;
  let abortCalls = 0;
  let queuedToolCalls = 0;
  let aborted = false;
  class BlockingSession {
    subscribe() { return () => {}; }
    async prompt() {
      promptStarted = true;
      await promptGate;
      if (!aborted) queuedToolCalls += 1;
    }
    async abort() {
      abortCalls += 1;
      aborted = true;
      cancellationSeenByAbort = db.getChatOperation(chatJid)?.cancellation ?? null;
      releasePrompt();
    }
    dispose() {}
  }

  const { AgentPool } = await importFresh<typeof import("../../src/agent-pool.js")>("../src/agent-pool.js");
  const pool = new AgentPool({
    ...createAgentPoolModelOptions(),
    createSession: async () => createRuntime(new BlockingSession()) as any,
  });
  const run = pool.runAgent("continue", chatJid, { timeoutMs: 0, operationOwner: owner });
  await waitFor(() => promptStarted, 1_000);

  const stale = await pool.cancelOperationAndAbort(chatJid, `${operation.operationId}:stale`);
  expect(stale).toMatchObject({ status: "no_op", reason: "operation_mismatch", physicallyAborted: false });
  expect(abortCalls).toBe(0);
  expect(db.getChatOperation(chatJid)?.cancellation).toBeNull();

  const cancelled = await pool.cancelOperationAndAbort(chatJid, operation.operationId);
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.physicallyAborted).toBe(true);
  expect(abortCalls).toBe(1);
  expect(cancellationSeenByAbort).toMatchObject({ cause: "remote_abort" });
  expect(db.getChatOperation(chatJid)?.cancellation).toEqual(cancellationSeenByAbort);

  await run;
  expect(queuedToolCalls).toBe(0);
  expect(db.getChatOperation(chatJid)?.cancellation).toEqual(cancellationSeenByAbort);
  await pool.shutdown();
  ws.cleanup();
});

test("remote cancellation persists when the exact operation has no gateway occupant", async () => {
  const ws = createTempWorkspace("piclaw-operation-cancel-idle-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
  db.initDatabase();
  const chatJid = "web:operation-cancel-idle";
  db.registerAcceptedChatSource({
    chatJid,
    sourceClass: "prompt",
    sourceKind: "queued_followup",
    sourceId: "followup-idle",
    acceptedAt: "2026-08-08T08:41:00.000Z",
    payloadRef: "followup:followup-idle",
  });
  const operation = db.claimNextChatOperation(chatJid).operation;
  if (!operation) throw new Error("expected operation");

  let abortCalls = 0;
  class IdleSession {
    subscribe() { return () => {}; }
    async prompt() {}
    async abort() { abortCalls += 1; }
    dispose() {}
  }
  const { AgentPool } = await importFresh<typeof import("../../src/agent-pool.js")>("../src/agent-pool.js");
  const pool = new AgentPool({
    ...createAgentPoolModelOptions(),
    createSession: async () => createRuntime(new IdleSession()) as any,
  });

  const result = await pool.cancelOperationAndAbort(chatJid, operation.operationId);
  expect(result).toMatchObject({ status: "cancelled", physicallyAborted: false });
  expect(abortCalls).toBe(0);
  expect(db.getChatOperation(chatJid)?.cancellation).toMatchObject({ cause: "remote_abort" });

  await pool.shutdown();
  ws.cleanup();
});

test("repeated exact-owner cancellation is idempotent after the cancelled operation settles", async () => {
  const ws = createTempWorkspace("piclaw-operation-cancel-repeat-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
  db.initDatabase();
  const chatJid = "web:operation-cancel-repeat";
  db.registerAcceptedChatSource({
    chatJid,
    sourceClass: "prompt",
    sourceKind: "queued_followup",
    sourceId: "followup-repeat",
    acceptedAt: "2026-08-10T08:43:00.000Z",
    payloadRef: "followup:followup-repeat",
  });
  const operation = db.claimNextChatOperation(chatJid).operation;
  if (!operation) throw new Error("expected operation");

  class IdleSession {
    subscribe() { return () => {}; }
    async prompt() {}
    async abort() {}
    dispose() {}
  }
  const { AgentPool } = await importFresh<typeof import("../../src/agent-pool.js")>("../src/agent-pool.js");
  const pool = new AgentPool({
    ...createAgentPoolModelOptions(),
    createSession: async () => createRuntime(new IdleSession()) as any,
  });

  const accepted = await pool.cancelOperationAndAbort(chatJid, operation.operationId, "user_abort");
  expect(accepted).toMatchObject({ status: "cancelled", physicallyAborted: false });
  if (accepted.status !== "cancelled" || !accepted.operation) throw new Error("expected cancellation");
  expect(db.completeChatOperation(chatJid, {
    owner: {
      operationId: accepted.operation.operationId,
      sourceSeq: accepted.operation.sourceSeq,
      phase: accepted.operation.phase,
      generation: accepted.operation.generation,
    },
    outcome: "cancelled",
    cause: "user_abort",
    provenance: "operation_cancellation_control_test",
    createdAt: "2026-08-10T08:43:01.000Z",
  }).status).toBe("completed");
  expect(db.getChatOperation(chatJid)).toBeNull();

  const repeated = await pool.cancelOperationAndAbort(chatJid, operation.operationId, "user_abort");
  expect(repeated).toMatchObject({
    status: "cancelled",
    reason: "already_cancelled",
    operation: null,
    physicallyAborted: false,
  });

  await pool.shutdown();
  ws.cleanup();
});

test("durable operation cancellation remains terminal across a process restart", { timeout: 15000 }, async () => {
  const ws = createTempWorkspace("piclaw-operation-cancel-restart-");
  const scriptPath = join(ws.workspace, "restart-cancellation-proof.ts");
  const dbModuleUrl = new URL("../../src/db.ts", import.meta.url).href;
  writeFileSync(scriptPath, `
    import {
      cancelChatOperation,
      claimNextChatOperation,
      closeDatabase,
      getChatOperation,
      initDatabase,
      promoteChatOperation,
      registerAcceptedChatSource,
    } from ${JSON.stringify(dbModuleUrl)};
    const chatJid = "web:operation-cancel-restart";
    initDatabase();
    registerAcceptedChatSource({
      chatJid,
      sourceClass: "prompt",
      sourceKind: "queued_followup",
      sourceId: "restart-source",
      acceptedAt: "2026-08-08T08:42:00.000Z",
      payloadRef: "followup:restart-source",
    });
    const claimed = claimNextChatOperation(chatJid).operation;
    if (!claimed) throw new Error("expected operation");
    const owner = { operationId: claimed.operationId, sourceSeq: claimed.sourceSeq, phase: claimed.phase, generation: claimed.generation };
    const cancelled = cancelChatOperation(chatJid, owner, { cause: "user_abort", requestedAt: "2026-08-08T08:42:01.000Z" });
    if (cancelled.status !== "applied") throw new Error("expected cancellation");
    closeDatabase();
    initDatabase();
    const restarted = getChatOperation(chatJid);
    if (!restarted?.cancellation) throw new Error("cancellation did not survive restart");
    const restartedOwner = { operationId: restarted.operationId, sourceSeq: restarted.sourceSeq, phase: restarted.phase, generation: restarted.generation };
    const advance = promoteChatOperation(chatJid, restartedOwner, "running");
    console.log(JSON.stringify({ cause: restarted.cancellation.cause, status: advance.status, reason: advance.reason }));
    closeDatabase();
  `);

  const childEnv = { ...process.env };
  delete childEnv.PICLAW_MCP_MEMENTO_TOKEN;
  delete childEnv.PICLAW_WEB_VNC_ALLOW_DIRECT;
  Object.assign(childEnv, {
    NODE_ENV: "test",
    PICLAW_DB_IN_MEMORY: "0",
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
  });
  const child = Bun.spawn([process.execPath, scriptPath], {
    cwd: ws.workspace,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const result = JSON.parse(stdout.trim().split("\n").at(-1) || "{}");
  expect(result).toEqual({ cause: "user_abort", status: "rejected", reason: "operation_cancelled" });
  ws.cleanup();
});
