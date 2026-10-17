import "./src/test-guard.js";
import { describe, expect, test } from "bun:test";
import { withCancel } from "../../runtime/durable-engine/qualification/context.ts";
import { barrier, context, openFixture } from "./src/fixture.js";
import { verifyProvenance } from "./src/provenance.js";
import { fileURLToPath } from "node:url";
import { realpathSync, existsSync } from "node:fs";
import * as AI from "../../runtime/durable-engine/qualification/ai.ts";
import * as Durable from "../../runtime/durable-engine/qualification/durable.ts";
import * as Context from "../../runtime/durable-engine/qualification/context.ts";
import * as Sqlite from "../../runtime/durable-engine/qualification/sqlite.ts";
import * as Testing from "../../runtime/durable-engine/qualification/testing.ts";
import * as Chord from "../../runtime/durable-engine/qualification/chord.ts";
import * as Codemode from "../../runtime/durable-engine/qualification/codemode.ts";
import * as Telemetry from "../../runtime/durable-engine/qualification/telemetry.ts";
import * as EventStream from "../../runtime/durable-engine/qualification/event-stream.ts";

async function using(run: (fixture: Awaited<ReturnType<typeof openFixture>>) => Promise<void>) {
  const fixture = await openFixture({ acquired: true });
  try { await run(fixture); } finally { await fixture.close(); }
}

describe("Q1 public candidate MemoryStorage only", () => {
  test("independent public package graph is exactly 1.3.0", async () => {
    for (const name of ["chord", "pi-ai", "pi-codemode", "pi-durable"]) {
      // Package metadata is a filesystem read, not an unexported package subpath import.
      const pkg = await Bun.file(new URL(`../../runtime/durable-engine/node_modules/@earendil-works/${name}/package.json`, import.meta.url)).json();
      expect(pkg.version).toBe("1.3.0");
      expect(import.meta.resolve(`../../runtime/durable-engine/node_modules/@earendil-works/${name}`)).toStartWith(new URL("../../runtime/durable-engine/node_modules/", import.meta.url).href);
    }
  });
  test("fixtures and engine share one physical public candidate graph", async () => {
    // These packages expose import-only entrypoints: resolve with ESM conditions,
    // not createRequire.resolve's require condition.
    const anchored = (anchor: string) => ({ resolve: (specifier: string) => fileURLToPath(import.meta.resolve(specifier, anchor)) });
    const engine = anchored(new URL("../../runtime/durable-engine/package.json", import.meta.url).href);
    const durable = anchored(engine.resolve("@earendil-works/pi-durable"));
    const ai = anchored(engine.resolve("@earendil-works/pi-ai"));
    const codemode = anchored(engine.resolve("@earendil-works/pi-codemode"));
    const bridges = {
      "@earendil-works/pi-ai": AI, "@earendil-works/pi-durable": Durable,
      "@earendil-works/chord/context": Context, "@earendil-works/chord": Chord,
      "@earendil-works/pi-durable/storage/sqlite": Sqlite,
      "@earendil-works/pi-durable/testing": Testing,
      "@earendil-works/pi-codemode": Codemode, "@earendil-works/pi-telemetry": Telemetry,
      "@earendil-works/pi-ai/utils/event-stream": EventStream,
    };
    for (const [specifier, bridge] of Object.entries(bridges)) {
      const actual = await import(engine.resolve(specifier));
      for (const key of Object.keys(bridge)) expect(actual[key]).toBe((bridge as Record<string, unknown>)[key]);
      expect(existsSync(new URL(`./node_modules/${specifier.split("/").slice(0, 2).join("/")}`, import.meta.url))).toBe(false);
    }
    for (const specifier of ["@earendil-works/chord", "@earendil-works/chord/context", "@earendil-works/pi-ai", "@earendil-works/pi-codemode"]) {
      expect(realpathSync(durable.resolve(specifier))).toBe(realpathSync(engine.resolve(specifier)));
    }
    expect(realpathSync(ai.resolve("@earendil-works/pi-telemetry"))).toBe(realpathSync(engine.resolve("@earendil-works/pi-telemetry")));
    expect(realpathSync(codemode.resolve("@earendil-works/chord"))).toBe(realpathSync(engine.resolve("@earendil-works/chord")));
    const actualAI = await import(durable.resolve("@earendil-works/pi-ai"));
    const actualContext = await import(durable.resolve("@earendil-works/chord/context"));
    expect(AI.createModels).toBe(actualAI.createModels);
    expect(AI.ModelsError).toBe(actualAI.ModelsError);
    expect(Context.BACKGROUND_CONTEXT).toBe(actualContext.BACKGROUND_CONTEXT);
  });
  test("registry-extracted candidate bytes match installed closure offline", async () => {
    const evidence = await verifyProvenance();
    expect(evidence.packages).toHaveLength(5);
  });
  test("test guard blocks global fetch and WebSocket without making requests", () => {
    expect(() => fetch("https://invalid.invalid")).toThrow("forbids network");
    expect(() => new WebSocket("wss://invalid.invalid")).toThrow("forbids network");
  });
  test("owner fence rejects before allocating candidate resources", async () => {
    let allocations = 0;
    await expect(openFixture({ acquired: false }, () => allocations++)).rejects.toThrow("before open");
    expect(allocations).toBe(0);
  });
  test("fresh paused open and read-only observers execute nothing", () => using(async f => {
    await f.harness.inspect(context);
    await f.root.context(context);
    const watch = await f.root.watch(context);
    watch.start(async () => {});
    const graph = await f.harness.taskGraph(context);
    await Bun.sleep(10);
    expect(f.host.modelCalls).toBe(0);
    expect(f.host.effects).toBe(0);
    expect(f.host.admissions).toHaveLength(0);
    graph.dispose(); await watch.stop();
  }));
  test("explicit conversation abort cancels placed work before model dispatch", () => using(async f => {
    f.host.modelHold = barrier();
    const submission = await f.submit("active-abort", "hello");
    expect(await submission.abort(context)).toBe("already_placed");
    await f.root.abort(context);
    const status = await submission.status(context);
    expect(status.status).toBe("unanswered");
    if (status.status === "unanswered") expect(status.reason).toBe("aborted");
    f.host.modelHold.release();
    expect(f.host.modelCalls).toBe(0);
    expect(f.host.admissions).toHaveLength(0);
  }));
  test("submit starts scheduling; host dedup rejects changed content; committed answer evidence", () => using(async f => {
    const submission = await f.submit("request-1", "hello");
    expect((await f.submit("request-1", "hello")).id).toBe(submission.id);
    expect(() => f.submit("request-1", "changed")).toThrow("content conflict");
    expect((await submission.wait(context)).status).toBe("done");
    const evidence = await f.settlement(submission);
    expect(evidence.answer.model?.[0]?.role).toBe("assistant");
    expect(f.host.modelCalls).toBe(1);
    expect(f.host.admissions.map(x => x.idempotencyKey)).toEqual(["model:1"]);
    expect(f.reports).toEqual([]);
    expect(f.host.credentialLookups).toBe(0);
  }));
  test("upstream requestId dedup alone does NOT reject changed content", () => using(async f => {
    const one = await f.root.submit({ type: "input", requestId: "raw", content: "hello" }, context);
    const two = await f.root.submit({ type: "input", requestId: "raw", content: "changed" }, context);
    expect(two.id).toBe(one.id);
    await one.wait(context);
    expect(f.host.modelCalls).toBe(1);
  }));
  test("model permission denies at actual dispatch, not a throwing fail-open hook", () => using(async f => {
    f.host.modelAllowed = false;
    const submission = await f.submit("denied", "hello");
    expect((await submission.wait(context)).status).toBe("unanswered");
    expect(f.host.modelCalls).toBe(0);
    expect(f.host.denials).toEqual(["model"]);
    await expect(f.settlement(submission)).rejects.toThrow("No committed answer");
  }));
  test("owner loss after submit denies dispatch without constructing a replacement owner", () => using(async f => {
    f.host.modelHold = barrier();
    const submission = await f.submit("owner-lost", "hello");
    f.owner.acquired = false;
    f.host.modelHold.release();
    expect((await submission.wait(context)).status).toBe("unanswered");
    expect(f.host.modelCalls).toBe(0);
    expect(f.host.denials).toEqual(["model"]);
    expect(f.host.admissions).toHaveLength(0);
  }));
  test("one delegating tool performs one gated synthetic host effect", () => using(async f => {
    const submission = await f.submit("tool", "use-tool");
    expect((await submission.wait(context)).status).toBe("done");
    expect(f.host.effects).toBe(1);
    expect(f.host.credentialLookups).toBe(0);
    expect(f.host.admissions.map(x => x.idempotencyKey.split(":")[0])).toEqual(["model", "tool", "model"]);
    expect(f.host.admissions.every(x => /^[a-f0-9]{64}$/.test(x.requestHash))).toBe(true);
    await f.settlement(submission);
  }));
  test("tool permission revoked after selection is checked immediately at host effect", () => using(async f => {
    f.host.toolHold = barrier();
    const submission = await f.submit("revoked", "use-tool");
    await f.host.toolEntered.promise;
    f.host.toolAllowed = false;
    f.host.toolHold.release();
    await submission.wait(context);
    expect(f.host.effects).toBe(0);
    expect(f.host.denials).toEqual(["tool"]);
    const entries = await f.root.entries({}, 100, undefined, context);
    expect(entries.items.some(e => e.kind === "pi.tool-result" && e.model?.some(m => m.role === "toolResult" && m.isError))).toBe(true);
  }));
  test("cancelling a wait leaves placed work alive; submission.abort only withdraws queued work", () => using(async f => {
    f.host.modelHold = barrier();
    const placed = await f.submit("placed", "hello");
    const queued = await f.submit("queued", "never execute");
    expect((await queued.status(context)).status).toBe("queued");
    const waiter = withCancel(context);
    const waiting = placed.wait(waiter.context);
    waiter.cancel(new Error("wait only"));
    await expect(waiting).rejects.toThrow();
    expect(await placed.abort(context)).toBe("already_placed");
    expect(await queued.abort(context)).toBe("aborted");
    const withdrawn = await queued.status(context);
    expect(withdrawn.status).toBe("unanswered");
    if (withdrawn.status === "unanswered") expect(withdrawn.reason).toBe("aborted");
    expect((await placed.status(context)).status).toBe("placed");
    f.host.modelHold.release();
    expect((await placed.wait(context)).status).toBe("done");
    expect(f.host.modelCalls).toBe(1);
  }));
});
