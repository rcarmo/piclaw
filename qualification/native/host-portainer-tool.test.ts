import { getExtensionKvStore } from "../../runtime/src/extension-kv-registry.ts";
import { test, expect } from "bun:test";
import { createHostPortainerTool } from "../../runtime/durable-engine/src/host-portainer-tool.ts";
test("Portainer schema discovery grants no invocation authority", () => {
  let checks = 0;
  const tool = createHostPortainerTool({ createPortainerTool(options) {
    expect(() => options.assertCurrent()).toThrow("Invocation-local"); checks++;
    return { name: "portainer", label: "Portainer", description: "fixture", parameters: { type: "object", properties: {} } as any,
      async execute() { throw Error("not invoked"); } };
  } }, { root: {} as any, runtime() { throw Error("not invoked"); }, assertOwner() {} });
  expect(tool).toBeDefined(); expect(checks).toBe(1);
});

import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { getRuntimeConfigPaths } from "../../runtime/src/core/config.js";
import { registerRootExtensionKvStore } from "../../runtime/src/db/register-extension-kv.js";
import { resetExtensionKvStoreForTests } from "../../runtime/src/extension-kv-registry.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { at, effect, sealed, value } from "./src/host-handoff.js";
import { BACKGROUND_CONTEXT } from "../../runtime/durable-engine/qualification/context.ts";
async function fixture() {
  await closeDatabase(); initDatabase({ ...getRuntimeConfigPaths(), databasePath: ":memory:" });
  const root = getDb(); registerRootExtensionKvStore();
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
  test(`Portainer actual captured operation authority: ${mode}`, async () => {
    const { root, captured } = await fixture();
    let effects = 0, captures = 0, owned = true;
    const tool = createHostPortainerTool({ createPortainerTool(options) {
      return { name: "portainer", label: "Portainer", description: "synthetic effect", parameters: { type: "object", properties: {} } as any,
        async execute() {
          await Promise.resolve();
          if (mode === "owner") owned = false;
          if (mode === "version") root.exec("UPDATE service_effect_s01_operations SET version=version+1");
          if (mode === "source") root.exec("UPDATE service_effect_s01_sources SET payload_ref='other'");
          if (mode === "binding") root.exec("UPDATE service_effect_s01_operations SET harness_operation_id='revoked'");
          const kv = getExtensionKvStore();
          kv.get("portainer", "settings", "global");
          expect(() => kv.get("foreign", "settings", "global")).toThrow();
          expect(() => kv.get("portainer", "profile", "chat", "web:foreign")).toThrow();
          expect(() => kv.set("portainer", "settings", {}, "global")).toThrow();
          options.assertCurrent(); effects++;
          expect(options.chatJid).toBe(captured.operation.chatJid);
          return { content: [{ type: "text" as const, text: "synthetic" }], details: {} };
        } };
    } }, { root, runtime: () => ({ async captureToolSource(conversation, task, call) {
      expect(Number(conversation)).toBe(2); expect(Number(task)).toBe(3); expect(call).toBe("call"); captures++;
      await Promise.resolve();
      if (mode === "capture-await") owned = false;
      return captured as any;
    } }), assertOwner() { if (!owned) throw Error("owner revoked"); } });
    try {
      const execution = tool.execute({ action: "request", ...(mode === "foreign" ? { chat_jid: "web:foreign" } : {}) },
        { callId: "call", conversationId: 2, taskId: 3, output() {}, async details() {} } as any, BACKGROUND_CONTEXT);
      if (mode === "valid") { expect((await execution).output).toEqual([{ type: "text", text: "synthetic" }]); expect(effects).toBe(1); }
      else { await expect(execution).rejects.toThrow(); expect(effects).toBe(0); }
      expect(captures).toBe(1);
    } finally { resetExtensionKvStoreForTests(); await closeDatabase(); }
  });
}
