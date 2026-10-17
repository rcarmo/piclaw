import "./src/test-guard.ts";
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createBashTool, createLocalBashOperations, type BashOperations } from "../../node_modules/@earendil-works/pi-coding-agent";
import { Type, createModels, createProvider, type AssistantMessage, type Model } from "../../runtime/durable-engine/qualification/ai.ts";
import { AssistantMessageEventStream } from "../../runtime/durable-engine/qualification/event-stream.ts";
import { Harness, createRegistry, defineExtension, defineTool, type ConversationId, type SubmissionId } from "../../runtime/durable-engine/qualification/durable.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/index.js";
import { barrier, context } from "./src/fixture.ts";
import { withAbortSignal } from "../../runtime/durable-engine/qualification/context.ts";
import type { ToolExecutionApi } from "../../runtime/durable-engine/qualification/durable.ts";
import { createHostBashTool } from "../../runtime/durable-engine/src/index.js";

// Actual root Pi 1.2.0 SDK, not a candidate coding tool or copied executor.
// The untouched public local backend remains BLOCKED as a host-effect port:
// it awaits fsAccess after exec admission. The opt-in tracked port below instead
// fences its actual spawn after keychain/env resolution; it does not fix the SDK.
function disk(run: (directory: string) => Promise<void>) {
  const directory = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, "bash-port-"));
  return run(directory).finally(() => rmSync(directory, { recursive: true, force: true }));
}
function bash(directory: string, operations = createLocalBashOperations({ shellPath: "/bin/bash" })) {
  return createBashTool(directory, {
    operations, exposeSessionEnvironment: false,
    // No inherited credentials, BASH_ENV, profiles, command prefix or PI metadata.
    spawnHook: value => ({ ...value, env: { PATH: "/usr/bin:/bin", HOME: directory, LC_ALL: "C" } }),
  });
}
const text = (result: { content: readonly { type: string; text?: string }[] }) =>
  result.content.filter(item => item.type === "text").map(item => item.text).join("");

// All command strings below are fixed fixtures, with relative paths in an owned
// disposable cwd. No network commands, environment dumps or keychain references.
test("public createBashTool operations.exec runs an actual isolated command and streams small output", () => disk(async directory => {
  const backend = createLocalBashOperations({ shellPath: "/bin/bash" });
  let executions = 0;
  const tool = bash(directory, { exec(command, cwd, options) {
    executions++;
    expect(cwd).toBe(directory);
    expect(options.env).toEqual({ PATH: "/usr/bin:/bin", HOME: directory, LC_ALL: "C" });
    return backend.exec(command, cwd, options);
  } });
  const updates: string[] = [];
  const result = await tool.execute("authorized", { command: "printf fixture > result; printf fixture", timeout: 2 },
    undefined, update => updates.push(text(update)));
  expect(readFileSync(join(directory, "result"), "utf8")).toBe("fixture");
  expect(executions).toBe(1);
  expect(text(result)).toBe("fixture");
  expect(updates.at(-1)).toBe("fixture");
  expect(result.details).toBeUndefined(); // No output spool/context-output DB involved.
  expect(tool.outputSchema).toBeDefined(); // Generic host-tools rejects this schema;
  // do not silently strip it and claim full context-bash/structured-output support.
}));

test("opt-in registered tracked bash port delegates actual execution and preserves the public schema", () => disk(async directory => {
  const chunks: string[] = [];
  const tool = createHostBashTool({ cwd: directory, shellPath: "/bin/bash",
    authority: { assertAllowed() {} }, toolOptions: { exposeSessionEnvironment: false } });
  const api = { callId: "tracked-port", output: (value: string) => chunks.push(value), details: async () => {} } as unknown as ToolExecutionApi;
  const result = await tool.execute({ command: "printf fixture > result; printf fixture", timeout: 2 }, api, context);
  expect(readFileSync(join(directory, "result"), "utf8")).toBe("fixture");
  expect(text({ content: result.output! })).toBe("fixture");
  expect(result.structuredOutput).toMatchObject({ output: "fixture", exit_code: 0 });
  expect(tool.parameters).toEqual(bash(directory).parameters);
  expect(tool.structuredOutputSchema).toEqual(bash(directory).outputSchema);
  expect(tool.replay).toBe("unsafe"); expect(tool.callers).toEqual(["model"]);
}));

for (const action of ["revoke", "cancel"] as const) {
  test(`registered tracked port fences ${action} INSIDE actual asynchronous backend preparation`, () => disk(async directory => {
    let allowed = true, checks = 0;
    const controller = new AbortController();
    const tool = createHostBashTool({ cwd: directory, shellPath: "/bin/bash", authority: {
      assertAllowed() { checks++; if (!allowed) throw new Error("private authority error", { cause: new Error("private cause") }); },
    }, toolOptions: { exposeSessionEnvironment: false } });
    const api = { callId: "tracked-gap", output: () => { throw new Error("Unexpected output"); }, details: async () => {} } as unknown as ToolExecutionApi;
    const execution = tool.execute({ command: "printf forbidden > sentinel", timeout: 2 }, api,
      withAbortSignal(controller.signal, context));
    // Backend already entered; its real env/keychain awaits, not an adapter hold.
    queueMicrotask(() => { if (action === "revoke") allowed = false; else controller.abort(); });
    await expect(execution).rejects.toThrow("Bash execution no longer authorized");
    expect(existsSync(join(directory, "sentinel"))).toBe(false);
    // Initial admission, empty initial progress + ACK, then (only for
    // revoke) actual spawn denial and sanitized final-release denial.
    expect(checks).toBe(action === "revoke" ? 6 : 4);
  }));
}

for (const failure of ["revoke", "output", "details", "throttled-output", "cancel"] as const) {
  test(`tracked port contains running-child ${failure} progress failure and kills its tree`, () => disk(async directory => {
    const controller = new AbortController();
    const marker = "PRIVATE_PROGRESS_FAILURE_SENTINEL";
    let allowed = true, checks = 0, outputs = 0, acks = 0, failedAt = 0;
    const escaped: unknown[] = [];
    const record = (error: unknown) => { escaped.push(error); };
    process.on("unhandledRejection", record);
    process.on("uncaughtExceptionMonitor", record);
    const tool = createHostBashTool({ cwd: directory, shellPath: "/bin/bash", authority: {
      assertAllowed() { checks++; if (!allowed) throw new Error(marker); },
    }, toolOptions: { exposeSessionEnvironment: false } });
    const api = { callId: "running-progress", output: () => {
      outputs++;
      if (failure === "throttled-output" && outputs === 1) return;
      failedAt = checks;
      if (failure === "revoke") allowed = false;
      if (failure === "cancel") controller.abort(new Error(marker));
      if (failure === "output" || failure === "throttled-output") throw new Error(marker);
    }, details: async () => {
      acks++;
      if (outputs && failure === "details") { failedAt = checks; throw new Error(marker); }
    } } as unknown as ToolExecutionApi;
    try {
      let error: unknown;
      try {
        await tool.execute({ command: "printf '%s' \"$$\" > shell.pid; ( /bin/sleep 0.5; printf late > subtree-late ) & printf first; /bin/sleep 0.02; printf second; /bin/sleep 0.6; printf late > late", timeout: 2 },
          api, withAbortSignal(controller.signal, context));
      } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Bash execution failed");
      expect(error).not.toHaveProperty("cause");
      expect(Number(readFileSync(join(directory, "shell.pid"), "utf8"))).toBeGreaterThan(0);
      expect(outputs).toBe(failure === "throttled-output" ? 2 : 1);
      // Only the first revalidation can consult revoked authority; all queued
      // updates and final callbacks are suppressed after failure is recorded.
      expect(checks - failedAt).toBeLessThanOrEqual(failure === "revoke" || failure === "details" ? 1 : 0);
      expect(acks).toBe(failure === "details" || failure === "throttled-output" ? 2 : 1);
      await Bun.sleep(700);
      expect(existsSync(join(directory, "late"))).toBe(false);
      expect(existsSync(join(directory, "subtree-late"))).toBe(false);
      expect(escaped).toEqual([]);
    } finally {
      controller.abort();
      process.off("unhandledRejection", record);
      process.off("uncaughtExceptionMonitor", record);
    }
  }));
}

for (const action of ["revoke", "cancel"] as const) {
  test(`${action} while arguments are held BEFORE exec prevents backend entry and file mutation`, () => disk(async directory => {
    const entered = barrier(), held = barrier(), controller = new AbortController();
    let allowed = true, executions = 0;
    const backend = createLocalBashOperations({ shellPath: "/bin/bash" });
    const check = () => { if (!allowed || controller.signal.aborted) throw new Error("denied"); };
    const tool = bash(directory, { exec(command, cwd, options) {
      check(); executions++;
      return backend.exec(command, cwd, options);
    } });
    const execution = (async () => {
      entered.release(); await held.promise;
      check();
      return tool.execute("held", { command: "printf forbidden > result", timeout: 2 }, controller.signal);
    })();
    await entered.promise;
    if (action === "revoke") allowed = false; else controller.abort();
    held.release();
    await expect(execution).rejects.toThrow("denied");
    expect(executions).toBe(0);
    expect(existsSync(join(directory, "result"))).toBe(false);
  }));
}

test("NOT ADMITTED: check around public default exec does not fence its asynchronous pre-spawn preparation", () => disk(async directory => {
  const backend = createLocalBashOperations({ shellPath: "/bin/bash" });
  let allowed = true, executions = 0;
  const check = () => { if (!allowed) throw new Error("revoked"); };
  const tool = bash(directory, { async exec(command, cwd, options) {
    check(); executions++;
    const pending = backend.exec(command, cwd, options); // Suspended at actual SDK fsAccess.
    allowed = false;
    expect(existsSync(join(directory, "result"))).toBe(false);
    const result = await pending;
    check(); // A completion fence cannot undo the child effect below.
    return result;
  } });
  await expect(tool.execute("gap", { command: "printf stale > result", timeout: 2 })).rejects.toThrow("revoked");
  expect(executions).toBe(1);
  expect(readFileSync(join(directory, "result"), "utf8")).toBe("stale");
}));

test("actual public backend abort kills running shell tree before delayed file effect", () => disk(async directory => {
  const controller = new AbortController(), ready = barrier();
  const tool = bash(directory);
  const execution = tool.execute("running", {
    command: "printf '%s' \"$$\" > shell.pid; printf ready; /bin/sleep 0.4; printf late > late",
    timeout: 2,
  }, controller.signal, update => {
    if (text(update).includes("ready")) { ready.release(); controller.abort(); }
  });
  // Attach the rejection observer before waiting for readiness.
  const settled = execution.then(() => "unexpected success", error => String(error));
  try {
    await Promise.race([ready.promise, Bun.sleep(2500).then(() => { throw new Error("No child readiness"); })]);
    expect(await settled).toContain("Command aborted");
    expect(Number(readFileSync(join(directory, "shell.pid"), "utf8"))).toBeGreaterThan(0);
    await Bun.sleep(550); // Beyond the fixture's delayed write; bounded by test timeout.
    expect(existsSync(join(directory, "late"))).toBe(false);
  } finally { controller.abort(); await settled; }
}));

test("post-return authority denial suppresses result release, not an already admitted bash effect", () => disk(async directory => {
  const entered = barrier(), held = barrier();
  let allowed = true, released = false;
  const execution = (async () => {
    const result = await bash(directory).execute("release", { command: "printf admitted > result; printf private-result", timeout: 2 });
    entered.release(); await held.promise;
    if (!allowed) throw new Error("revoked before release");
    released = true; return result;
  })();
  await entered.promise; allowed = false; held.release();
  await expect(execution).rejects.toThrow("revoked before release");
  expect(released).toBe(false);
  expect(readFileSync(join(directory, "result"), "utf8")).toBe("admitted");
}));

for (const phase of ["committed", "interrupted"] as const) {
test(`public Harness disk reopen does not replay a ${phase} unsafe actual bash call`, () => disk(async directory => {
  let executions = 0, modelCalls = 0;
  const builtin = bash(directory), ready = barrier();
  // Narrow test registration, not an effect-fenced adapter. Only JSON values cross
  // graphs; the root schema/context/TypeBox objects are never handed to durable.
  const tool = defineTool({ name: "fixture_bash", description: "One fixed isolated command",
    parameters: Type.Object({}), callers: ["model"], replay: "unsafe",
    async execute(_args, api, callContext) {
      executions++;
      const command = phase === "committed" ? "printf 'once\\n' >> effects; printf done"
        : "printf 'once\\n' >> effects; printf ready; /bin/sleep 0.4; printf late > late";
      const result = await builtin.execute(api.callId, { command, timeout: 2 }, callContext.abortSignal,
        update => { if (text(update).includes("ready")) ready.release(); });
      return { output: [{ type: "text", text: text(result) }] };
    },
  });
  const extension = defineExtension({ name: "bash-reopen-fixture", tools: [tool] });
  const registry = createRegistry(); registry.install(extension);
  const model: Model<"openai-completions"> = { id: "synthetic", name: "Synthetic", provider: "qualification", api: "openai-completions",
    baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 10000, maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const stream = (_model: unknown, transcript: { messages: readonly { role: string }[] }) => {
    modelCalls++;
    const call = transcript.messages.at(-1)?.role === "user";
    const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      timestamp: 1, stopReason: call ? "toolUse" : "stop",
      content: call ? [{ type: "toolCall", id: "bash-call", name: tool.name, arguments: {} }] : [{ type: "text", text: "done" }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const output = new AssistantMessageEventStream();
    output.push({ type: "done", reason: call ? "toolUse" : "stop", message }); output.end(); return output;
  };
  const forbidden = async (): Promise<never> => { throw new Error("Ambient credentials forbidden"); };
  const models = createModels({ authContext: { env: forbidden, fileExists: forbidden } });
  models.setProvider(createProvider({ id: model.provider, models: [model],
    auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: {}, source: "fixture" }) } },
    api: { stream, streamSimple: stream } }));
  const open = async () => Harness.open(
    await SqliteStorage.open(new BunSqliteDatabase(join(directory, "candidate.sqlite"))),
    { models, registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
  const first = await open();
  let id: ConversationId, submissionId: SubmissionId;
  try {
    const root = await first.root(context, { agent: { model: { provider: model.provider, modelId: model.id }, extensions: [extension], tools: [tool] } });
    id = root.id;
    const submission = await root.submit({ type: "input", requestId: "actual-bash", content: "run fixture" }, context);
    submissionId = submission.id;
    if (phase === "committed") await submission.wait(context);
    else await ready.promise; // The actual child has already written its first effect.
    expect(readFileSync(join(directory, "effects"), "utf8")).toBe("once\n");
    expect(executions).toBe(1); expect(modelCalls).toBe(phase === "committed" ? 2 : 1);
  } finally { await first.close(context); }
  const reopened = await open(); // Public open is paused by default.
  try {
    expect((await reopened.inspect(context)).scheduling).toBe("paused");
    if (phase === "interrupted") {
      const recovered = await reopened.submission(submissionId!, context);
      if (!recovered) throw new Error("Persisted submission missing");
      await recovered.wait(context); // Explicit recovery; unsafe call must become interrupted, not run again.
      await Bun.sleep(550);
      expect(existsSync(join(directory, "late"))).toBe(false);
    }
    const root = await reopened.conversation(id!, context);
    if (!root) throw new Error("Persisted conversation missing");
    const entries = (await root.entries({}, 100, undefined, context)).items;
    const results = entries.flatMap(entry => entry.model ?? []).filter(message => message.role === "toolResult");
    expect(results).toHaveLength(1);
    if (phase === "committed") expect(results[0]).toMatchObject({ content: [{ type: "text", text: "done" }], isError: false });
    else { expect(results[0]?.isError).toBe(true); expect(JSON.stringify(results[0]?.content)).toContain("interrupted"); }
    const duplicate = await root.submit({ type: "input", requestId: "actual-bash", content: "run fixture" }, context);
    await duplicate.wait(context);
    expect(executions).toBe(1); expect(modelCalls).toBe(2);
    expect(readFileSync(join(directory, "effects"), "utf8")).toBe("once\n");
    expect(tool.replay).toBe("unsafe");
  } finally { await reopened.close(context); }
  // Graceful same-process close/abort/reopen only. No SIGKILL/exactly-once assertion.
}));
}
