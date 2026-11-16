import { test, expect } from "bun:test";
import { createHostRegretsTool } from "../../runtime/durable-engine/src/host-regrets-tool.ts";
function bindFixture(addon: any, options: any) {
  const definition = { name: "regrets_review", label: "Regrets", description: "fixture", parameters: { type: "object", properties: {} }, async execute() { throw Error("discovery only"); } } as any;
  return createHostRegretsTool({ createLateNightRegrets(ports: any) { return { tool: addon.createImapTool(ports) }; } }, {
    ...options, definition, bind(captured: any, authority: any) { return { assertCurrent: authority.assertCurrent, chatJid: captured.operation.chatJid }; },
  });
}
import { Database } from "bun:sqlite";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { at, effect, sealed, value } from "./src/host-handoff.js";
import { BACKGROUND_CONTEXT } from "../../runtime/durable-engine/qualification/context.ts";
async function fixture() {
  const root = new Database(":memory:");
  installTerminalSettlementCompositionSchema(root);
  const work = value(createCurrentPiclawServiceWorkStore(root, { hitFault: () => false, recordTrace() {} }));
  const chatJid = "web:authority";
  const source = value(await work.acceptSource(sealed({ effect: effect("authority:accept"), chatJid,
    sourceId: "authority:source", kind: "message" as const, payloadRef: "authority:payload",
    targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  const claimed = value(await work.claimNext(sealed({ effect: effect("authority:claim"), chatJid,
    expectedFrontier: 0, newOperationId: "authority:operation", claimedAt: at })))!;
  const inputs = [{ incarnation: "authority:copy", conversationId: 2 as never, chatJid, branchId: "main",
    operationId: claimed.operation.operationId, sourceSeq: source.sourceSeq, sourceId: source.sourceId,
    payloadRef: source.payloadRef, requestId: "authority:request", requestHash: "a".repeat(64), submissionId: 42 as never }];
  const before = { operation: claimed.operation, inputs };
  const operation = value(await work.bindHarness(sealed({ effect: effect("authority:bind", claimed.operation.operationId, source.sourceSeq), expectedVersion: claimed.operation.version, sessionId: "authority:session", harnessOperationId: "42" })));
  root.exec("CREATE TABLE authority_probe (value TEXT)");
  return { root, before, captured: { operation, inputs } };
}

for (const mode of ["valid", "foreign", "owner", "version", "source", "binding", "capture-await"] as const) {
  test(`Regrets actual captured operation authority: ${mode}`, async () => {
    const { root, captured } = await fixture();
    let effects = 0, captures = 0, owned = true;
    const tool = bindFixture({ createImapTool(options) {
      return { name: "imap", label: "Imap", description: "synthetic effect", parameters: { type: "object", properties: {} } as any,
        async execute() {
          await Promise.resolve();
          if (mode === "owner") owned = false;
          if (mode === "version") root.exec("UPDATE service_effect_s01_operations SET version=version+1");
          if (mode === "source") root.exec("UPDATE service_effect_s01_sources SET payload_ref='other'");
          if (mode === "binding") root.exec("UPDATE service_effect_s01_operations SET harness_operation_id='revoked'");
          options.assertCurrent(); effects++;
          expect(options.chatJid).toBe(captured.operation.chatJid);
          return { content: [{ type: "text" as const, text: "synthetic" }], details: {} };
        } };
    } }, { root, runtime: () => ({ async captureToolSource(conversation, task, call) {
      expect([conversation, task, call]).toEqual([2, 3, "call"]); captures++;
      await Promise.resolve();
      if (mode === "capture-await") owned = false;
      return captured as any;
    } }), assertOwner() { if (!owned) throw Error("owner revoked"); } });
    try {
      const execution = tool.execute({ ...(mode === "foreign" ? { chat_jid: "web:foreign" } : {}) },
        { callId: "call", conversationId: 2, taskId: 3, output() {}, async details() {} } as any, BACKGROUND_CONTEXT);
      if (mode === "valid") { expect((await execution).output).toEqual([{ type: "text", text: "synthetic" }]); expect(effects).toBe(1); }
      else { await expect(execution).rejects.toThrow(); expect(effects).toBe(0); }
      expect(captures).toBe(mode === "foreign" ? 0 : 1);
    } finally { root.close(); }
  });
}
