import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type, createProvider, createAssistantMessageEventStream, type AssistantMessage, type TranscriptContext } from "../../runtime/durable-engine/qualification/ai.ts";
import { awaitWithContext, withAbortSignal } from "../../runtime/durable-engine/qualification/context.ts";
import { AssistantEntry, configure, defineExtension, defineTool, type ConversationId } from "../../runtime/durable-engine/qualification/durable.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.ts";
import { barrier, context, openFixture } from "./src/fixture.ts";

// Bounded public-SDK proof, NOT an installed Delegate implementation or catalog entry.
// Follows README + foreground example 22 ownership/correlation; deliberately no
// background anchors/reporters from example 23. Clean close/reopen, not SIGKILL.
// The fixture database is one SDK SQLite file, not the production messages DB.
for (const mode of ["reopen", "cancel-one", "parent-abort", "denied-model"] as const) {
  test(`native foreground parallel Delegate: ${mode}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "native-parallel-"));
    const file = join(dir, "session.sqlite");
    let fixture: Awaited<ReturnType<typeof openFixture>> | undefined;
    const holds = [barrier(), barrier()];
    let entered = [barrier(), barrier()];
    let ids: ConversationId[] = [];
    let taskId: import("../../runtime/durable-engine/qualification/durable.ts").TaskId | undefined;
    const attempts: { task: NonNullable<typeof taskId>; ids: ConversationId[] }[] = [];
    const requests: string[] = [];
    const approvedSelections: string[] = [];
    let childProviderRequests = 0;
    const open = async () => {
      const f = await openFixture({ acquired: true }, undefined,
        () => SqliteStorage.open(new BunSqliteDatabase(file), { prefix: "pi_" }));
      fixture = f;
      const read = defineTool({ name: "fixture_read", description: "Synthetic read-only capability", replay: "safe",
        parameters: Type.Object({}), execute: async () => ({ output: [{ type: "text", text: "fixture only" }] }) });
      const delegate = defineTool({ name: "native_parallel", description: "Two self-contained foreground jobs", replay: "safe", callers: ["model"],
        parameters: Type.Object({ model: Type.Optional(Type.String()) }),
        execute: async (args, api, ctx) => {
          // Trusted HOST policy, not model-supplied Settings permission. No ambient
          // credentials/catalog lookup, no Settings grant, no fallback model.
          const current = (await api.agent(ctx)).model;
          if (args.model !== undefined) {
            if (args.model !== "qualification/synthetic") throw Error("Model selection not approved");
            approvedSelections.push(args.model);
          }
          const children = await api.commit(async tx => {
            const prior = (await tx.scanConversations({ ownerTaskId: api.taskId }, 3)).items;
            if (prior.length) return prior.map(child => child.id);
            const created: ConversationId[] = [];
            for (const name of ["A", "B"]) {
              const child = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
              // SDK copies agent config, NOT history. Keep the parent's model and
              // thinking/cwd policy; strictly read-only, no recursive delegation.
              await configure(tx, child.id, { model: current, tools: [read], modelTools: [read], instructions: `Self-contained reader ${name}` });
              created.push(child.id);
            }
            return created;
          }, ctx);
          // Public typed task-local memo: survives while the tool is live, not a
          // second job ledger. Ownership scan closes the create-before-memo gap.
          ids = await api.memo<ConversationId[]>("children", children, ctx);
          taskId = api.taskId;
          attempts.push({ task: api.taskId, ids: [...ids] });
          await api.details({ children: ids.map((id, i) => ({ name: ["A", "B"][i]!, conversationId: id })) }, ctx);
          const results = await Promise.all(ids.map(async (id, ordinal) => {
            const child = (await api.conversation(id, ctx))!;
            const requestId = `native-parallel:${api.taskId}:${ordinal}`;
            requests.push(requestId);
            const settled = await (await child.submit({ type: "input", content: `JOB_${ordinal}`, requestId }, ctx)).wait(ctx);
            if (settled.status !== "done" || settled.type !== "input") return { name: ["A", "B"][ordinal], status: "error", error: settled.status === "unanswered" ? settled.reason : settled.status };
            const answer = await api.commit(tx => tx.entry(AssistantEntry, settled.answer), ctx);
            const message = answer?.model?.[0] as AssistantMessage;
            return { name: ["A", "B"][ordinal], status: "done", text: message.content.flatMap(part => part.type === "text" ? [part.text] : []).join("") };
          }));
          return { output: [{ type: "text", text: JSON.stringify(results) }] };
        } });
      const extension = defineExtension({ name: "native-parallel-proof", tools: [read, delegate] });
      f.registry.install(extension);
      await f.root.configure({ extensions: [extension], tools: [read, delegate], thinkingLevel: "medium" }, context);
      const model = f.models.getModel("qualification", "synthetic")!;
      // Entire request decision is captured synchronously, never shared through
      // mutable host.finalContent/modelHold across concurrent invocations.
      const stream = (_model: unknown, input: TranscriptContext, options?: { signal?: AbortSignal }) => {
        const transcript = JSON.stringify(input.messages);
        f.host.transcripts.push(transcript);
        const user = JSON.stringify(input.messages.findLast(message => message.role === "user")?.content);
        const ordinal = user?.includes("JOB_0") ? 0 : user?.includes("JOB_1") ? 1 : -1;
        const hold = ordinal >= 0 ? holds[ordinal] : undefined;
        const callsTool = ordinal < 0 && !input.messages.some(message => message.role === "toolResult");
        const content: AssistantMessage["content"] = ordinal >= 0
          ? [{ type: "thinking", thinking: "CHILD_PRIVATE_THINKING" }, { type: "text", text: "CHILD_RESULT" }]
          : callsTool
            ? [{ type: "toolCall", id: "parallel-call", name: "native_parallel", arguments: { model: mode === "denied-model" ? "unapproved/model" : "qualification/synthetic" } }]
            : [{ type: "text", text: "PARENT_DONE" }];
        if (ordinal >= 0) {
          expect(transcript).not.toContain("PARENT_PRIVATE_HISTORY");
          expect(transcript).not.toContain("native_parallel");
          childProviderRequests++;
          entered[ordinal]!.release();
        }
        const output = createAssistantMessageEventStream();
        let message: AssistantMessage = {
          role: "assistant", api: model.api, provider: model.provider, model: model.id,
          content, stopReason: callsTool ? "toolUse" : "stop", timestamp: Date.now(),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        };
        void (async () => {
          try {
            const requestContext = options?.signal ? withAbortSignal(options.signal, context) : context;
            if (hold) await awaitWithContext(hold.promise, requestContext);
            options?.signal?.throwIfAborted();
            f.host.modelCalls++;
            output.push({ type: "done", reason: callsTool ? "toolUse" : "stop", message });
          } catch (error) {
            message = { ...message, content: [], stopReason: "aborted", errorMessage: String(error) };
            output.push({ type: "error", reason: "aborted", error: message });
          }
          output.end(message);
        })();
        return output;
      };
      f.models.setProvider(createProvider({ id: model.provider, models: [model],
        auth: { apiKey: { name: "Synthetic keyless", resolve: async () => ({ auth: {}, source: "synthetic" }) } },
        api: { stream, streamSimple: stream },
      }));
      return f;
    };
    try {
      let f = await open();
      const submission = await f.root.submit({ type: "input", content: "PARENT_PRIVATE_HISTORY", requestId: "parallel-parent" }, context);
      if (mode === "denied-model") {
        expect((await submission.wait(context)).status).toBe("done");
        expect(await f.root.commit(async tx => (await tx.scanConversations({}, 10)).items.length, context)).toBe(1);
        expect(approvedSelections).toEqual([]);
        return;
      }
      await Promise.all(entered.map(b => b.promise)); // BOTH providers entered before EITHER release.
      expect(childProviderRequests).toBe(2);
      const parentTask = taskId!;
      const originalIds = [...ids];
      expect(new Set(ids).size).toBe(2);
      expect((await submission.status(context)).status).toBe("placed");
      expect((await f.harness.getTask(parentTask, context))?.state.status).not.toBe("terminal");
      const inspect = await f.harness.inspect(context);
      expect(inspect.tasks.filter(t => originalIds.includes(t.record.conversationId))).toHaveLength(2);
      for (const id of ids) {
        const child = (await f.harness.conversation(id, context))!;
        expect((await child.agent(context)).tools.map(t => t.name)).toEqual(["fixture_read"]);
        expect((await child.agent(context)).model).toEqual((await f.root.agent(context)).model);
        expect(await f.root.commit(tx => tx.conversation(id), context)).toMatchObject({ owner: { conversationId: f.root.id, taskId: parentTask } });
      }
      if (mode === "reopen") {
        await f.close();
        entered = [barrier(), barrier()];
        f = await open();
        const again = (await f.harness.submission(submission.id, context))!;
        f.harness.resume();
        await Promise.all(entered.map(b => b.promise));
        expect(childProviderRequests).toBe(4);
        expect(ids).toEqual(originalIds); expect(taskId).toBe(parentTask);
        expect(attempts).toHaveLength(2);
        expect(new Set(requests).size).toBe(2);
        expect((await again.status(context)).status).toBe("placed");
      } else if (mode === "cancel-one") {
        await (await f.harness.conversation(ids[0]!, context))!.abort(context);
        expect((await submission.status(context)).status).toBe("placed");
        expect((await f.harness.inspect(context)).tasks.some(t => t.record.conversationId === ids[1])).toBe(true);
      } else {
        await f.root.abort(context);
        expect((await submission.status(context)).status).toBe("unanswered");
        expect((await f.harness.inspect(context)).tasks).toHaveLength(0);
        return;
      }
      holds.forEach(b => b.release());
      const pending = (await f.harness.submission(submission.id, context))!;
      expect((await pending.wait(context)).status).toBe("done");
      const entries = (await f.root.entries({}, 100, undefined, context)).items;
      const toolResults = entries.flatMap(e => e.model ?? []).filter(m => m.role === "toolResult");
      expect(toolResults).toHaveLength(1);
      const serialized = JSON.stringify(toolResults);
      expect(serialized).not.toContain("CHILD_PRIVATE_THINKING");
      expect(serialized).not.toContain("JOB_");
      expect(serialized).toContain("CHILD_RESULT");
      if (mode === "cancel-one") expect(serialized).toContain("aborted");
      expect(await f.root.commit(async tx => (await tx.scanConversations({ ownerTaskId: parentTask }, 10)).items.map(c => c.id), context)).toEqual(originalIds);
      for (let ordinal = 0; ordinal < 2; ordinal++) {
        const child = (await f.harness.conversation(ids[ordinal]!, context))!;
        const childEntries = (await child.entries({}, 100, undefined, context)).items;
        expect(childEntries.filter(e => e.kind === "pi.user")).toHaveLength(1);
        expect(childEntries.filter(e => e.kind === "pi.assistant")).toHaveLength(mode === "cancel-one" && ordinal === 0 ? 0 : 1);
      }
      expect(f.host.credentialLookups).toBe(0);
    } finally {
      holds.forEach(b => b.release());
      await fixture?.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 15_000);
}
