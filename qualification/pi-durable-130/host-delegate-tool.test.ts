import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { Type, createProvider, createAssistantMessageEventStream, type AssistantMessage, type TranscriptContext } from "../../runtime/durable-engine/qualification/ai.ts";
import { Harness, defineExtension, defineTool, type GenerationHooks } from "../../runtime/durable-engine/qualification/durable.ts";
import { createHostDelegateTool } from "../../runtime/durable-engine/src/host-delegate-tool.ts";
import { barrier, context, openFixture } from "./src/fixture.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { acceptedSteerFixture } from "./src/accepted-steer-recovery-fixture.ts";
import { OwnedSqlite } from "./src/ownership.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { configure } from "../../runtime/durable-engine/qualification/durable.ts";
import { at, effect, sealed, value } from "./src/host-handoff.ts";
import { hashCanonicalRequest } from "../../runtime/src/service-effects/contracts/common.ts";
import { storeChatMetadata } from "../../runtime/src/db.ts";

// Core consumer tests with explicitly synthetic authority/schema. These do NOT
// qualify installed Delegate content, Settings, host source capture or budgets.
for (const mode of ["parallel", "denied", "files", "timeout", "mutating-tools"] as const) {
  test(`host native Delegate factory: ${mode}`, async () => {
    const f = await openFixture({ acquired: true });
    const release = barrier(), entered = barrier();
    let childRequests = 0, captures = 0;
    const read = defineTool({ name: "read", description: "Synthetic reader", parameters: Type.Object({}),
      execute: async () => ({ output: [{ type: "text", text: "reader" }] }) });
    const readerExtension = defineExtension({ name: "native-readers", tools: [read] });
    f.registry.install(readerExtension);
    const parameters = Type.Object({ prompt: Type.String(), model: Type.Optional(Type.String()),
      files: Type.Optional(Type.Array(Type.String())), timeout_sec: Type.Optional(Type.Integer()), tools: Type.Optional(Type.String()) });
    const tool = createHostDelegateTool({ name: "delegate", description: "Synthetic registered declaration", parameters }, {
      assertCurrent() {},
      runtime: () => ({ async captureToolSource() { captures++; return { inputs: [], operation: {} } as never; }, assertCapturedSourceCurrent() {} }),
      async selectModel(_args, parent) { if (mode === "denied") throw Error("Model denied"); return parent!; },
      assertModelCurrent() {}, readonlyTools: [read], readonlyExtensions: [readerExtension],
    });
    const extension = defineExtension({ name: "native-consumer-test", tools: [tool, read] });
    f.registry.install(extension);
    await f.root.configure({ extensions: [extension], tools: [tool], thinkingLevel: "medium" }, context);
    const model = f.models.getModel("qualification", "synthetic")!;
    const stream = (_model: unknown, transcript: TranscriptContext) => {
      const user = transcript.messages.findLast(message => message.role === "user");
      const child = JSON.stringify(user?.content).includes("CHILD_TASK");
      const calls = !child && !transcript.messages.some(message => message.role === "toolResult");
      const output = createAssistantMessageEventStream();
      const args = { prompt: "CHILD_TASK", tools: mode === "mutating-tools" ? "bash" : "read_only",
        ...(mode === "files" ? { files: ["file.txt"] } : {}), ...(mode === "timeout" ? { timeout_sec: 20 } : {}) };
      const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        timestamp: 1, stopReason: calls ? "toolUse" : "stop", content: calls
          ? ["A", "B"].map(id => ({ type: "toolCall" as const, id, name: "delegate", arguments: args }))
          : [{ type: "thinking", thinking: "PRIVATE_CHILD_THINKING" }, { type: "text", text: child ? "CHILD_RESULT" : "PARENT_DONE" }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      if (child) {
        expect(JSON.stringify(transcript)).not.toContain("PARENT_SECRET");
        expect(JSON.stringify(transcript)).not.toContain('"name":"delegate"');
        if (++childRequests === 2) entered.release();
      }
      void (async () => {
        if (child) await release.promise;
        output.push({ type: "done", reason: calls ? "toolUse" : "stop", message }); output.end(message);
      })();
      return output;
    };
    f.models.setProvider(createProvider({ id: model.provider, models: [model],
      auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: {}, source: "fixture" }) } }, api: { stream, streamSimple: stream } }));
    try {
      const submission = await f.root.submit({ type: "input", content: "PARENT_SECRET", requestId: "parent" }, context);
      if (mode === "parallel") {
        await Promise.race([entered.promise, submission.wait(context).then(async () => {
          throw Error("Parent settled before both native children entered");
        })]); // Independent MODEL calls: both providers before release.
        expect(childRequests).toBe(2);
        expect((await submission.status(context)).status).toBe("placed");
        const children = await f.root.commit(tx => tx.scanConversations({}, 10), context);
        expect(children.items.filter(record => record.owner)).toHaveLength(2);
        expect(new Set(children.items.flatMap(record => record.owner ? [record.owner.taskId] : [])).size).toBe(2);
        for (const record of children.items.filter(record => record.owner)) {
          const child = (await f.harness.conversation(record.id, context))!;
          expect((await child.agent(context)).tools.map(tool => tool.name)).toEqual(["read"]);
          expect((await child.agent(context)).thinkingLevel).toBe("medium");
        }
        release.release();
      }
      expect((await submission.wait(context)).status).toBe("done");
      expect(childRequests).toBe(mode === "parallel" ? 2 : 0);
      expect(captures).toBe(mode === "parallel" || mode === "denied" ? 2 : 0);
      const entries = (await f.root.entries({}, 100, undefined, context)).items;
      const results = entries.flatMap(entry => entry.model ?? []).filter(message => message.role === "toolResult");
      expect(results).toHaveLength(2);
      expect(JSON.stringify(results)).not.toContain("PRIVATE_CHILD_THINKING");
      if (mode === "parallel") expect(JSON.stringify(results)).toContain("CHILD_RESULT");
      else expect(await f.root.commit(async tx => (await tx.scanConversations({}, 10)).items.length, context)).toBe(1);
    } finally { release.release(); await f.close(); }
  }, 10_000);
}

// Real shared-file host EF-S01/bindings/runtime and public SDK ownership.
// Declaration/model policy remain synthetic: this is NOT catalog qualification.
for (const cancel of [false, true]) {
  test(`native Delegate actual host source walk; cancel=${cancel}`, async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "native-source-"));
    const f = await acceptedSteerFixture(dir, "before-submit", undefined, false, { sharedDatabase: true });
    const entered = barrier(), release = barrier();
    let children = 0;
    const proofs: Awaited<ReturnType<NonNullable<typeof f.runtime>["captureRunSource"]>>[] = [];
    const read = defineTool({ name: "read", description: "Fixture reader", parameters: Type.Object({}),
      execute: async (_args, api) => {
        proofs.push(await f.runtime!.captureToolSource(api.conversationId, api.taskId, api.callId));
        entered.release(); await release.promise;
        return { output: [{ type: "text", text: "read" }] };
      } });
    const readers = defineExtension({ name: "source-readers", tools: [read] });
    f.base.registry.install(readers);
    const delegate = createHostDelegateTool({ name: "delegate", description: "Synthetic declaration", parameters: Type.Object({ prompt: Type.String() }) }, {
      assertCurrent() {}, runtime: () => f.runtime!, async selectModel(_args, parent) { return parent!; },
      assertModelCurrent() {}, readonlyTools: [read], readonlyExtensions: [readers],
    });
    const extension = defineExtension({ name: "source-delegate", tools: [delegate], hooks: [{ task: "pi.generation", handlers: {
      async beforeRequest(_request: Parameters<NonNullable<GenerationHooks["beforeRequest"]>>[0], api: Parameters<NonNullable<GenerationHooks["beforeRequest"]>>[1]) {
        if (api.conversationId !== f.base.root.id) {
          proofs.push(await f.runtime!.captureRunSource(api.conversationId, api.taskId));
        }
      },
    } }] });
    f.base.registry.install(extension);
    const model = f.base.models.getModel("qualification", "synthetic")!;
    const stream = (_model: unknown, transcript: TranscriptContext) => {
      const child = JSON.stringify(transcript.messages.findLast(m => m.role === "user")?.content).includes("CHILD_SOURCE");
      const calls = transcript.messages.findLast(m => m.role !== "system")?.role === "user";
      const output = createAssistantMessageEventStream();
      const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        timestamp: 1, stopReason: calls ? "toolUse" : "stop", content: calls
          ? [{ type: "toolCall", id: "owned-call", name: child ? "read" : "delegate", arguments: child ? {} : { prompt: "CHILD_SOURCE" } }]
          : [{ type: "text", text: child ? "SOURCE_CHILD_ANSWER" : "ROOT_ANSWER" }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      void (async () => {
        if (child && calls) children++;
        output.push({ type: "done", reason: calls ? "toolUse" : "stop", message }); output.end(message);
      })();
      return output;
    };
    f.base.models.setProvider(createProvider({ id: model.provider, models: [model],
      auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: {}, source: "fixture" }) } }, api: { stream, streamSimple: stream } }));
    let waiting: Promise<void> | undefined;
    try {
      const harness = await Harness.open(await SqliteStorage.open(new OwnedSqlite(f.owner)), { models: f.base.models, registry: f.base.registry }, context);
      try { await harness.commit(tx => configure(tx, f.base.root.id, { tools: [delegate], extensions: [extension] }), context); }
      finally { await harness.close(context); }
      await f.open(); f.permit = true;
      storeChatMetadata(f.chatJid, at);
      const source = value(await f.ports.work.acceptSource(sealed({ effect: effect(`${f.incarnation}:native`), chatJid: f.chatJid,
        sourceId: "native", kind: "message" as const, payloadRef: "native", targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
      f.db.query("INSERT INTO messages(id,chat_jid,content,timestamp) VALUES (?,?,?,?)").run("native", f.chatJid, "ROOT_SOURCE", at);
      const claimed = value(await f.ports.work.claimNext(sealed({ effect: effect(`${f.incarnation}:claim-native`), chatJid: f.chatJid, expectedFrontier: 0, newOperationId: f.incarnation, claimedAt: at })))!;
      const input = { incarnation: f.incarnation, conversationId: f.base.root.id, chatJid: f.chatJid, branchId: "main", operationId: f.incarnation,
        sourceSeq: source.sourceSeq, sourceId: source.sourceId, payloadRef: source.payloadRef, requestId: f.primaryRequestId,
        requestHash: hashCanonicalRequest({ type: "input", requestId: f.primaryRequestId, content: "ROOT_SOURCE" }) };
      const id = await f.runtime!.submit(input);
      value(await f.ports.work.bindHarness(sealed({ effect: effect(`${f.incarnation}:native-running`, f.incarnation, source.sourceSeq), expectedVersion: claimed.operation.version,
        sessionId: f.incarnation, lane: "main", harnessOperationId: String(id), state: "running" as const, watchGeneration: f.generation })));
      waiting = f.runtime!.wait(input, id);
      await Promise.race([entered.promise, waiting.then(() => { throw Error("Root settled before owned child source capture"); })]);
      expect(children).toBe(1); expect(proofs).toHaveLength(1);
      expect(proofs[0]!.inputs[0]!.operationId).toBe(f.incarnation);
      expect(proofs[0]!.inputs[0]!.conversationId).toBe(f.base.root.id);
      expect(() => f.runtime!.assertCapturedSourceCurrent(proofs[0]!.inputs)).not.toThrow();
      if (cancel) {
        const cancellation = value(await f.ports.work.acceptSource(sealed({ effect: effect(`${f.incarnation}:cancel-source`), chatJid: f.chatJid,
          sourceId: "native-cancel", kind: "cancellation" as const, payloadRef: "cancel", targetOperationId: f.incarnation,
          parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
        const operation = value(await f.ports.work.getOperation(f.incarnation))!;
        value(await f.ports.work.acceptCancellation(sealed({ effect: effect(`${f.incarnation}:native-cancel`, f.incarnation, cancellation.sourceSeq),
          expectedVersion: operation.version, sourceId: cancellation.sourceId, sourceSeq: cancellation.sourceSeq, cause: "user" as const, requestedAt: at })));
        expect(() => f.runtime!.assertCapturedSourceCurrent(proofs[0]!.inputs)).toThrow("Host operation authority unavailable");
      }
      release.release(); await waiting;
      expect((await f.runtime!.reconcile(input)).status?.status).toBe("done");
    } finally { release.release(); await waiting?.catch(() => {}); await f.close(); await rm(dir, { recursive: true, force: true }); }
  }, 10_000);
}
