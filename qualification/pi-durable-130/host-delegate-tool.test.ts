import "./src/test-guard.js";
import { expect, test, spyOn } from "bun:test";
import { Type, createProvider, createAssistantMessageEventStream, type AssistantMessage, type TranscriptContext } from "../../runtime/durable-engine/qualification/ai.ts";
import { Harness, defineExtension, defineTool, type GenerationHooks } from "../../runtime/durable-engine/qualification/durable.ts";
import { createHostDelegateTool } from "../../runtime/durable-engine/src/host-delegate-tool.ts";
import { barrier, context, openFixture } from "./src/fixture.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import * as fs from "node:fs";
import { Database } from "bun:sqlite";
import { createHostBuiltinTools } from "../../runtime/durable-engine/src/host-builtins.ts";
import { awaitWithContext } from "../../runtime/durable-engine/qualification/context.ts";
import { createHostDelegateFileReader } from "../../runtime/durable-engine/src/host-delegate-files.ts";
import { acceptedSteerFixture } from "./src/accepted-steer-recovery-fixture.ts";
import { OwnedSqlite } from "./src/ownership.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { configure } from "../../runtime/durable-engine/qualification/durable.ts";
import { at, effect, sealed, value } from "./src/host-handoff.ts";
import { hashCanonicalRequest } from "../../runtime/src/service-effects/contracts/common.ts";
import { storeChatMetadata } from "../../runtime/src/db.ts";

// Core consumer tests with explicitly synthetic authority/schema. These do NOT
// qualify installed Delegate content, Settings, host source capture or budgets.
for (const mode of ["parallel", "standard", "subset", "omitted", "full", "unknown-tool", "files-empty", "files-image-invalid", "files-image-disabled", "denied", "files", "files-unavailable", "files-revoked", "timeout", "timeout-fraction", "timeout-string", "timeout-large", "mutating-tools", "model-type", "model-short", "model-empty-provider", "model-empty-id"] as const) {
  test(`host native Delegate factory: ${mode}`, async () => {
    const f = await openFixture({ acquired: true });
    const release = barrier(), entered = barrier();
    let childRequests = 0, captures = 0, revoked = false;
    const read = defineTool({ name: "read", description: "Synthetic reader", parameters: Type.Object({}),
      execute: async () => ({ output: [{ type: "text", text: "reader" }] }) });
    const standard = [read, ...["bash", "edit", "write", "find", "ls", "grep"].map(name => defineTool({ name, description: "Synthetic builtin", parameters: Type.Object({}), execute: async () => ({ output: [] }) }))];
    const standardExtension = defineExtension({ name: "native-standard", tools: standard });
    f.registry.install(standardExtension);
    if (mode === "files-image-invalid" || mode === "files-image-disabled") writeFileSync(join(process.env.PICLAW_WORKSPACE!, "file.txt"), Buffer.from([0xff, 0xd8, 0xff]));
    const allowed = ["parallel", "standard", "subset", "omitted", "files-empty"].includes(mode);
    const readerExtension = defineExtension({ name: "native-readers", tools: [read] });
    f.registry.install(readerExtension);
    const parameters = Type.Object({ prompt: Type.String(), model: Type.Optional(Type.Any()),
      files: Type.Optional(Type.Array(Type.String())), timeout_sec: Type.Optional(Type.Any()), tools: Type.Optional(Type.String()) });
    const tool = createHostDelegateTool({ name: "delegate", description: "Synthetic registered declaration", parameters }, {
      assertCurrent() {},
      runtime: () => ({ async captureToolSource() { captures++; return { inputs: [], operation: {} } as never; }, async watchOwnedDelegateChild(_p, _t, _c, id, ctx) { return (await f.harness.conversation(id, ctx))!.watch(ctx); }, assertCapturedSourceCurrent() { if (revoked) throw Error("source revoked"); } }),
      ...(mode === "files-unavailable" || mode === "files-revoked" || mode === "files-empty" ? { async readFiles(_files: readonly string[], guard: () => void) {
        if (mode === "files-empty") throw Error("Empty file list must not perform attachment IO");
        if (mode === "files-unavailable") throw Error("PRIVATE_HOST_PATH");
        revoked = true; guard(); return [];
      } } : {}),
      ...(mode === "files-image-invalid" || mode === "files-image-disabled" ? {
        readFiles: createHostDelegateFileReader(process.env.PICLAW_WORKSPACE!),
        modelSupportsImages: () => mode === "files-image-invalid",
      } : {}),
      async selectModel(_args, parent) { if (mode === "denied") throw Error("Model denied"); return parent!; },
      assertModelCurrent() {}, readonlyTools: [read], readonlyExtensions: [readerExtension],
      ...(["standard", "subset", "full", "unknown-tool"].includes(mode) ? { standardTools: standard, standardExtensions: [standardExtension] } : {}),
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
      const args = { prompt: "CHILD_TASK", ...(mode === "omitted" ? {} : { tools: mode === "mutating-tools" ? "bash" : mode === "standard" ? "standard" : mode === "subset" ? "read,write" : mode === "full" ? "full" : mode === "unknown-tool" ? "read,delegate" : "read_only" }),
        ...(mode.startsWith("model-") ? { model: ({ "model-type": 42, "model-short": "synthetic", "model-empty-provider": "/synthetic", "model-empty-id": "qualification/" } as Record<string, string | number>)[mode] } : {}),
        ...(mode.startsWith("files") ? { files: mode === "files-empty" ? [] : ["file.txt"] } : {}), ...(mode.startsWith("timeout") ? { timeout_sec: ({ timeout: -1, "timeout-fraction": 10.5, "timeout-string": "10", "timeout-large": 301 } as Record<string, string | number>)[mode] } : {}) };
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
      if (allowed) {
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
          expect((await child.agent(context)).tools.map(tool => tool.name)).toEqual(mode === "standard" ? standard.map(tool => tool.name) : mode === "subset" ? ["read", "write"] : ["read"]);
          expect((await child.agent(context)).thinkingLevel).toBe("medium");
        }
        release.release();
      }
      expect((await submission.wait(context)).status).toBe("done");
      expect(childRequests).toBe(allowed ? 2 : 0);
      expect(captures).toBe(allowed || mode === "denied" || mode === "files-unavailable" || mode === "files-revoked" || mode === "files-image-invalid" || mode === "files-image-disabled" ? 2 : 0);
      const entries = (await f.root.entries({}, 100, undefined, context)).items;
      const results = entries.flatMap(entry => entry.model ?? []).filter(message => message.role === "toolResult");
      expect(results).toHaveLength(2);
      expect(JSON.stringify(results)).not.toContain("PRIVATE_CHILD_THINKING");
      expect(JSON.stringify(results)).not.toContain("PRIVATE_HOST_PATH");
      if (allowed) expect(JSON.stringify(results)).toContain("CHILD_RESULT");
      else expect(await f.root.commit(async tx => (await tx.scanConversations({}, 10)).items.length, context)).toBe(1);
    } finally { release.release(); await f.close(); }
  }, 10_000);
}

// Public consumer deadline lifecycle with keyless providers and real SQLite
// reopen. Timer interception only captures the valid 10-second deadline; SDK
// scheduling and cancellation retain their real timers.
for (const mode of ["success", "expiry", "reopen"] as const) {
  test(`native Delegate deadline: ${mode}`, async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "delegate-deadline-"));
    const { BunSqliteDatabase } = await import("../../runtime/durable-engine/src/bun-sqlite.ts");
    const { awaitWithContext, withAbortSignal } = await import("../../runtime/durable-engine/qualification/context.ts");
    let f: Awaited<ReturnType<typeof openFixture>> | undefined;
    const hold = barrier(), entered = barrier(), aborted = barrier(), timerReady = barrier();
    let requests = 0, started = 0, cleared = 0, attachmentReads = 0;
    writeFileSync(join(dir, "task.txt"), "ORIGINAL_FILE_CONTENT\r\n\t");
    const readFiles = createHostDelegateFileReader(dir);
    let fire: (() => void) | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const realNow = Date.now.bind(Date);
    const realTimer = globalThis.setTimeout, realClear = globalThis.clearTimeout;
    const timers = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms?: number, ...args: unknown[]) => {
      if (ms !== undefined && ms <= 10000 && new Error().stack?.split("\n")[3]?.includes("host-delegate-tool.ts")) {
        started++;
        fire = callback;
        deadlineTimer = realTimer(() => {}, 60_000);
        timerReady.release();
        return deadlineTimer;
      }
      return realTimer(callback, ms, ...args);
    }) as typeof setTimeout);
    const clears = spyOn(globalThis, "clearTimeout").mockImplementation(((timer: ReturnType<typeof setTimeout>) => {
      if (timer !== undefined && timer === deadlineTimer) cleared++;
      return realClear(timer);
    }) as typeof clearTimeout);
    let clock: ReturnType<typeof spyOn> | undefined;
    const open = async () => {
      const base = await openFixture({ acquired: true }, undefined,
        () => SqliteStorage.open(new BunSqliteDatabase(join(dir, "session.sqlite")), { prefix: "pi_" }));
      f = base;
      const read = defineTool({ name: "read", description: "reader", parameters: Type.Object({}), execute: async () => ({ output: [] }) });
      const readers = defineExtension({ name: "deadline-readers", tools: [read] }); base.registry.install(readers);
      const tool = createHostDelegateTool({ name: "delegate", description: "deadline", parameters: Type.Object({ prompt: Type.String(), timeout_sec: Type.Optional(Type.Integer()), files: Type.Optional(Type.Array(Type.String())) }) }, {
        assertCurrent() {}, runtime: () => ({ async captureToolSource() { return { inputs: [] } as never; }, async watchOwnedDelegateChild(_p, _t, _c, id, ctx) { return (await base.harness.conversation(id, ctx))!.watch(ctx); }, assertCapturedSourceCurrent() {} }),
        async selectModel(_args, parent) { return parent!; }, assertModelCurrent() {},
        async readFiles(files, guard) { attachmentReads++; return readFiles(files, guard); }, readonlyTools: [read], readonlyExtensions: [readers],
      });
      const extension = defineExtension({ name: "deadline-consumer", tools: [tool] }); base.registry.install(extension);
      await base.root.configure({ extensions: [extension], tools: [tool] }, context);
      const model = base.models.getModel("qualification", "synthetic")!;
      const stream = (_model: unknown, transcript: TranscriptContext, options?: { signal?: AbortSignal }) => {
        const user = JSON.stringify(transcript.messages.findLast(m => m.role === "user")?.content);
        const child = user.includes("CHILD_");
        const a = user.includes("CHILD_A");
        const calls = !child && !transcript.messages.some(m => m.role === "toolResult");
        const output = createAssistantMessageEventStream();
        let message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: 1,
          stopReason: calls ? "toolUse" : "stop", content: calls ? ["A", "B"].map(id => ({ type: "toolCall" as const, id, name: "delegate", arguments: { prompt: `CHILD_${id}`, ...(id === "A" ? { timeout_sec: 10 } : { files: ["task.txt"] }) } })) : [{ type: "text", text: child ? "CHILD_ANSWER" : "PARENT_DONE" }],
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        if (child) {
          expect(user.includes("ORIGINAL_FILE_CONTENT")).toBe(!a);
          expect(user).not.toContain("MUTATED_FILE_CONTENT");
          requests++; if (requests === 2) entered.release();
        }
        void (async () => {
          try {
            if (child) await awaitWithContext(hold.promise, options?.signal ? withAbortSignal(options.signal, context) : context);
            options?.signal?.throwIfAborted();
            output.push({ type: "done", reason: calls ? "toolUse" : "stop", message });
          } catch (error) {
            if (a) aborted.release();
            message = { ...message, content: [], stopReason: "aborted", errorMessage: String(error) };
            output.push({ type: "error", reason: "aborted", error: message });
          }
          output.end(message);
        })();
        return output;
      };
      base.models.setProvider(createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: "keyless", resolve: async () => ({ auth: {}, source: "fixture" }) } }, api: { stream, streamSimple: stream } }));
      return base;
    };
    try {
      let base = await open();
      const submission = await base.root.submit({ type: "input", content: "ROOT", requestId: "deadline-root" }, context);
      await entered.promise; await timerReady.promise;
      const ids = (await base.root.commit(tx => tx.scanConversations({}, 10), context)).items.filter(c => c.owner).map(c => c.id);
      expect(ids).toHaveLength(2); expect(started).toBe(1);
      if (mode === "reopen") {
        const deadlines = async () => base.root.commit(async tx => {
          const children = (await tx.scanConversations({}, 10)).items.filter(child => child.owner);
          return Promise.all(children.map(async child => {
            const task = await tx.task(child.owner!.taskId);
            return { taskId: task!.id, deadline: task!.memos?.deadline };
          }));
        }, context);
        const originalDeadlines = await deadlines();
        expect(originalDeadlines).toHaveLength(2);
        for (const entry of originalDeadlines) expect(typeof entry.deadline).toBe("number");
        await base.close();
        writeFileSync(join(dir, "task.txt"), "MUTATED_FILE_CONTENT");
        expect(cleared).toBe(1);
        // Advance beyond A's persisted deadline, but keep time moving: SDK 1.4
        // paces awaited progress commits against its Harness clock. Freezing it
        // prevents the replay from getting past progress publication to expiry.
        clock = spyOn(Date, "now").mockImplementation(() => realNow() + 11_000);
        base = await open();
        expect(await deadlines()).toEqual(originalDeadlines);
        base.harness.resume();
        // Keep providers held until replay actually observes the persisted
        // expiry. Releasing first would legitimately commit an answer before
        // the replay's completed-submission check.
        let replayed = false;
        for (let attempt = 0; attempt < 1000; attempt++) {
          const entries = (await base.root.entries({}, 100, undefined, context)).items;
          if (entries.some(e => e.model?.some(m => m.role === "toolResult" && m.isError))) { replayed = true; break; }
          await new Promise(resolve => realTimer(resolve, 1));
        }
        expect(replayed).toBe(true);
      } else if (mode === "expiry") {
        fire!(); await aborted.promise;
        expect((await submission.status(context)).status).toBe("placed");
        // The sibling remains held/live while the timed-out child joins.
        expect((await base.harness.inspect(context)).tasks.some(t => ids.includes(t.record.conversationId))).toBe(true);
      }
      hold.release();
      expect((await (await base.harness.submission(submission.id, context))!.wait(context)).status).toBe("done");
      expect((await base.harness.inspect(context)).tasks).toHaveLength(0);
      expect(started).toBe(1); expect(cleared).toBe(1);
      expect(attachmentReads).toBe(1);
      const results = (await base.root.entries({}, 100, undefined, context)).items.flatMap(e => e.model ?? []).filter(m => m.role === "toolResult");
      expect(results).toHaveLength(2);
      expect(results.filter(r => r.isError)).toHaveLength(mode === "success" ? 0 : 1);
      expect(JSON.stringify(results)).toContain("CHILD_ANSWER");
      if (mode !== "success") expect(JSON.stringify(results)).toContain("timed out after 10s");
      if (mode === "reopen") {
        // SDK recovery may restart the already-owned provider before its parent
        // replays. No new durable submission or input is admitted.
        expect(requests).toBeGreaterThanOrEqual(3); expect(requests).toBeLessThanOrEqual(4);
        for (const id of ids) {
          const child = (await base.harness.conversation(id, context))!;
          expect((await child.entries({}, 100, undefined, context)).items.filter(e => e.kind === "pi.user")).toHaveLength(1);
        }
      }
      // No callback remains scheduled to abort later work.
      expect((await base.root.commit(tx => tx.scanConversations({}, 10), context)).items.filter(c => c.owner).map(c => c.id)).toEqual(ids);
    } finally {
      hold.release(); await f?.close(); clock?.mockRestore(); timers.mockRestore(); clears.mockRestore();
      if (deadlineTimer) realClear(deadlineTimer);
      await rm(dir, { recursive: true, force: true });
    }
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
      const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: child ? "actual-child-model" : model.id,
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
      value(await f.ports.work.bindHarness(sealed({ effect: effect(`${f.incarnation}:native-running`, f.incarnation, source.sourceSeq), expectedVersion: claimed.operation.version, sessionId: f.incarnation, harnessOperationId: String(id) })));
      waiting = f.runtime!.wait(input, id);
      await Promise.race([entered.promise, waiting.then(() => { throw Error("Root settled before owned child source capture"); })]);
      expect(children).toBe(1); expect(proofs).toHaveLength(1);
      expect(proofs[0]!.inputs[0]!.operationId).toBe(f.incarnation);
      expect(proofs[0]!.sourceModel).toEqual({ provider: model.provider, id: "actual-child-model", api: model.api });
      expect(proofs[0]!.inputs[0]!.conversationId).toBe(f.base.root.id);
      expect(() => f.runtime!.assertCapturedSourceCurrent(proofs[0]!.inputs)).not.toThrow();
      const inspection = (await f.runtime!.inspectAuthority()).inspection;
      const parentTool = inspection.tasks.find(t => t.record.kind === "pi.tool" && t.record.conversationId === f.base.root.id)!.record;
      const childId = inspection.tasks.find(t => t.record.conversationId !== f.base.root.id)!.record.conversationId;
      await expect(f.runtime!.watchOwnedDelegateChild(f.base.root.id, parentTool.id, "owned-call", f.base.root.id, context)).rejects.toThrow("Exact Delegate child ownership");
      const childWatch = await f.runtime!.watchOwnedDelegateChild(f.base.root.id, parentTool.id, "owned-call", childId, context);
      expect(childWatch.value.conversation.id).toBe(childId); await childWatch.stop();
      if (cancel) {
        const cancellation = value(await f.ports.work.acceptSource(sealed({ effect: effect(`${f.incarnation}:cancel-source`), chatJid: f.chatJid,
          sourceId: "native-cancel", kind: "cancellation" as const, payloadRef: "cancel", targetOperationId: f.incarnation,
          parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
        const operation = value(await f.ports.work.getOperation(f.incarnation))!;
        value(await f.ports.work.acceptCancellation(sealed({ effect: effect(`${f.incarnation}:native-cancel`, f.incarnation, cancellation.sourceSeq),
          expectedVersion: operation.version, sourceId: cancellation.sourceId, sourceSeq: cancellation.sourceSeq, cause: "user" as const, requestedAt: at })));
        expect(() => f.runtime!.assertCapturedSourceCurrent(proofs[0]!.inputs)).toThrow("Host operation authority unavailable");
        await expect(f.runtime!.watchOwnedDelegateChild(f.base.root.id, parentTool.id, "owned-call", childId, context)).rejects.toThrow();
      }
      release.release(); await waiting;
      expect((await f.runtime!.reconcile(input)).status?.status).toBe("done");
    } finally { release.release(); await waiting?.catch(() => {}); await f.close(); await rm(dir, { recursive: true, force: true }); }
  }, 10_000);
}

// Bounded public-factory recovery, not production startup authorization: the
// fixture's host gate must reject the pending owned child. Only an explicit
// public SDK resume below qualifies safe parent / unsafe child replay.
for (const boundary of ["before-effect", "after-effect"] as const) {
  test(`native Delegate standard unsafe child recovery: ${boundary}`, async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "delegate-standard-recovery-"));
    const f = await acceptedSteerFixture(dir, "before-submit");
    const hold = barrier(), entered = barrier();
    const sentinel = join(dir, "sentinel.txt");
    let executions = 0, writes = 0, captures = 0, modelCaptures = 0;
    let recovery: Harness | undefined;
    const realWriteFileSync = fs.writeFileSync;
    const writeSpy = spyOn(fs, "writeFileSync").mockImplementation(((...args: Parameters<typeof writeFileSync>) => {
      if (String(args[0]) === sentinel) writes++;
      return realWriteFileSync(...args);
    }) as typeof writeFileSync);
    const builtins = createHostBuiltinTools({ cwd: dir, authority: { assertAllowed() { f.owner.assert(); } },
      async captureSourceGuard(call) {
        const proof = await f.runtime!.captureToolSource(call.conversationId, call.taskId, call.toolCallId);
        captures++;
        expect(proof.inputs[0]!.operationId).toBe(f.incarnation);
        return () => f.runtime!.assertCapturedSourceCurrent(proof.inputs);
      } });
    const actualWrite = builtins.find(tool => tool.name === "write")!;
    const write = defineTool({ ...actualWrite, async execute(args, api, ctx) {
      executions++;
      if (boundary === "before-effect") { entered.release(); await awaitWithContext(hold.promise, ctx); }
      const result = await actualWrite.execute(args, api, ctx);
      if (boundary === "after-effect") { entered.release(); await awaitWithContext(hold.promise, ctx); }
      return result;
    } });
    const standard = builtins.map(tool => tool === actualWrite ? write : tool);
    const standardExtension = defineExtension({ name: "standard-recovery-builtins", tools: standard });
    f.base.registry.install(standardExtension);
    const delegate = createHostDelegateTool({ name: "delegate", description: "Synthetic declaration; actual native consumer",
      parameters: Type.Object({ prompt: Type.String(), tools: Type.String() }) }, {
      assertCurrent() { f.owner.assert(); }, runtime: () => f.runtime!,
      async selectModel(_args, parent) { return parent!; }, assertModelCurrent() {},
      readonlyTools: [], readonlyExtensions: [], standardTools: standard, standardExtensions: [standardExtension],
    });
    const extension = defineExtension({ name: "standard-recovery-consumer", tools: [delegate], hooks: [{ task: "pi.generation", handlers: {
      async beforeRequest(_request: Parameters<NonNullable<GenerationHooks["beforeRequest"]>>[0], api: Parameters<NonNullable<GenerationHooks["beforeRequest"]>>[1]) {
        const proof = await f.runtime!.captureRunSource(api.conversationId, api.taskId);
        expect(proof.inputs[0]!.operationId).toBe(f.incarnation);
        modelCaptures++;
      },
    } }] });
    f.base.registry.install(extension);
    const model = f.base.models.getModel("qualification", "synthetic")!;
    const stream = (_model: unknown, transcript: TranscriptContext) => {
      const child = JSON.stringify(transcript.messages.findLast(m => m.role === "user")?.content).includes("CHILD_WRITE");
      const calls = transcript.messages.findLast(m => m.role !== "system")?.role === "user";
      const output = createAssistantMessageEventStream();
      const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        timestamp: 1, stopReason: calls ? "toolUse" : "stop", content: calls
          ? [{ type: "toolCall", id: "standard-owned-call", name: child ? "write" : "delegate", arguments: child
            ? { path: "sentinel.txt", content: "SENTINEL\n" } : { prompt: "CHILD_WRITE", tools: "standard" } }]
          : [{ type: "text", text: child ? "CHILD_DONE" : "ROOT_DONE" }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      output.push({ type: "done", reason: calls ? "toolUse" : "stop", message }); output.end(message); return output;
    };
    f.base.models.setProvider(createProvider({ id: model.provider, models: [model],
      auth: { apiKey: { name: "keyless", resolve: async () => ({ auth: {}, source: "fixture" }) } }, api: { stream, streamSimple: stream } }));
    let waiting: Promise<void> | undefined;
    try {
      // Separate candidate file, explicitly WAL/FULL. No one-root-DB claim.
      const policy = new Database(f.path);
      try { policy.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL"); } finally { policy.close(); }
      const setup = await Harness.open(await SqliteStorage.open(new OwnedSqlite(f.owner)), { models: f.base.models, registry: f.base.registry }, context);
      try { await setup.commit(tx => configure(tx, f.base.root.id, { tools: [delegate], extensions: [extension] }), context); }
      finally { await setup.close(context); }
      await f.open(); f.permit = true;
      expect(await f.candidateDatabase.get("SELECT * FROM pragma_journal_mode")).toEqual({ journal_mode: "wal" });
      expect(await f.candidateDatabase.get("SELECT * FROM pragma_synchronous")).toEqual({ synchronous: 2 });
      storeChatMetadata(f.chatJid, at);
      const source = value(await f.ports.work.acceptSource(sealed({ effect: effect(`${f.incarnation}:standard`), chatJid: f.chatJid,
        sourceId: "standard", kind: "message" as const, payloadRef: "standard", targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
      f.db.query("INSERT INTO messages(id,chat_jid,content,timestamp) VALUES (?,?,?,?)").run("standard", f.chatJid, "ROOT_STANDARD", at);
      const claimed = value(await f.ports.work.claimNext(sealed({ effect: effect(`${f.incarnation}:claim-standard`), chatJid: f.chatJid,
        expectedFrontier: 0, newOperationId: f.incarnation, claimedAt: at })))!;
      const input = { incarnation: f.incarnation, conversationId: f.base.root.id, chatJid: f.chatJid, branchId: "main", operationId: f.incarnation,
        sourceSeq: source.sourceSeq, sourceId: source.sourceId, payloadRef: source.payloadRef, requestId: f.primaryRequestId,
        requestHash: hashCanonicalRequest({ type: "input", requestId: f.primaryRequestId, content: "ROOT_STANDARD" }) };
      const id = await f.runtime!.submit(input);
      value(await f.ports.work.bindHarness(sealed({ effect: effect(`${f.incarnation}:standard-running`, f.incarnation, source.sourceSeq), expectedVersion: claimed.operation.version, sessionId: f.incarnation, harnessOperationId: String(id) })));
      waiting = f.runtime!.wait(input, id); void waiting.catch(() => {});
      await Promise.race([entered.promise, waiting.then(() => { throw Error("Parent settled before write boundary"); })]);
      expect(delegate.replay).toBe("safe"); expect(write.replay).toBe("unsafe");
      expect(executions).toBe(1); expect(writes).toBe(boundary === "after-effect" ? 1 : 0);
      expect(existsSync(sentinel)).toBe(boundary === "after-effect");
      const before = await f.candidateStorage.scanConversations({}, 10, undefined, context);
      const owned = before.items.filter(c => c.owner);
      expect(owned).toHaveLength(1);
      await f.runtime!.close(); await waiting.catch(() => {}); waiting = undefined;
      await f.open();
      // The fixture controller cannot authorize pending child work. Do not
      // weaken it to turn this bounded SDK qualification into startup approval.
      await expect(f.runtime!.wait(input, id)).rejects.toThrow("Unknown recovered authority");
      recovery = await Harness.open(await SqliteStorage.open(new OwnedSqlite(f.owner)), { models: f.base.models, registry: f.base.registry }, context);
      recovery.resume();
      const submission = (await recovery.submission(id, context))!;
      expect((await submission.wait(context)).status).toBe("done");
      const root = (await recovery.conversation(f.base.root.id, context))!;
      const after = await root.commit(tx => tx.scanConversations({}, 10), context);
      expect(after.items.filter(c => c.owner)).toEqual(owned);
      const child = (await recovery.conversation(owned[0]!.id, context))!;
      const entries = (await child.entries({}, 100, undefined, context)).items;
      expect(entries.filter(e => e.kind === "pi.user")).toHaveLength(1);
      const results = entries.flatMap(e => e.model ?? []).filter(m => m.role === "toolResult");
      expect(results).toHaveLength(1);
      expect(results[0]!.isError).toBe(true);
      expect(JSON.stringify(results[0]!.content)).toContain("interrupted");
      expect(executions).toBe(1); expect(writes).toBe(boundary === "after-effect" ? 1 : 0);
      if (boundary === "after-effect") expect(readFileSync(sentinel, "utf8")).toBe("SENTINEL\n");
      else expect(existsSync(sentinel)).toBe(false);
      expect(captures).toBe(boundary === "after-effect" ? 1 : 0);
      expect(modelCaptures).toBeGreaterThan(0);
      expect((await recovery.inspect(context)).tasks).toHaveLength(0);
    } finally {
      hold.release(); await waiting?.catch(() => {}); await recovery?.close(context); await f.close(); writeSpy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  }, 10_000);
}
