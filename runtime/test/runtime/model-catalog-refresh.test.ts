import { expect, test } from "bun:test";
import { ModelsError } from "@earendil-works/pi-ai";
import { refreshModelCatalogs, refreshModelCatalogForSelection, resolveLiveModelSelection } from "../../src/runtime/model-catalog-refresh.js";

function runtime(result: () => Promise<{ aborted: boolean; errors: ReadonlyMap<string, Error> }>) {
  const calls: Array<Record<string, unknown>> = [];
  return { calls, refresh(options: Record<string, unknown>) { calls.push(options); return result(); } };
}

test("forces a networked refresh like `pi update --models`", async () => {
  const fake = runtime(async () => ({ aborted: false, errors: new Map() }));
  expect(await refreshModelCatalogs(fake)).toEqual({ status: "completed", skipped: [], failed: [] });
  expect(fake.calls).toHaveLength(1);
  expect(fake.calls[0]).toMatchObject({ allowNetwork: true, force: true });
  expect(fake.calls[0]!.signal).toBeInstanceOf(AbortSignal);
});

test("stale logins are skipped providers; other provider errors are failures", async () => {
  const fake = runtime(async () => ({ aborted: false, errors: new Map<string, Error>([
    ["github-copilot", new ModelsError("oauth", "Token expired")],
    ["openrouter", new Error("HTTP 503")],
  ]) }));
  expect(await refreshModelCatalogs(fake)).toEqual({
    status: "partial",
    skipped: [{ provider: "github-copilot", message: "Token expired" }],
    failed: [{ provider: "openrouter", message: "HTTP 503" }],
  });
});

test("only skipped logins still counts as updated", async () => {
  const fake = runtime(async () => ({ aborted: false, errors: new Map<string, Error>([["github-copilot", new ModelsError("oauth", "Log in again")]]) }));
  expect((await refreshModelCatalogs(fake)).status).toBe("completed");
});

test("concurrent requests share one refresh", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fake = runtime(async () => { await gate; return { aborted: false, errors: new Map() }; });
  const first = refreshModelCatalogs(fake), second = refreshModelCatalogs(fake);
  release();
  expect(await first).toEqual(await second);
  expect(fake.calls).toHaveLength(1);
  await refreshModelCatalogs(fake);
  expect(fake.calls).toHaveLength(2);
});

test("a refresh that outlives the deadline is aborted and reported", async () => {
  const fake = runtime(() => new Promise((resolve) => {
    const signal = fake.calls[0]!.signal as AbortSignal;
    signal.addEventListener("abort", () => resolve({ aborted: true, errors: new Map() }));
  }));
  expect(await refreshModelCatalogs(fake, { timeoutMs: 20 })).toEqual({ status: "timed_out", skipped: [], failed: [] });
});

test("selection refreshes a missing model once and reads the newly authenticated catalogue", async () => {
  let models = [{ provider: "one", id: "old" }], calls = 0;
  const refresh = async () => { calls++; models = [...models, { provider: "one", id: "new" }]; };
  expect(await resolveLiveModelSelection("ONE/NEW", () => models, refresh)).toEqual([{ provider: "one", id: "new" }]);
  expect(await resolveLiveModelSelection("new", () => models, refresh)).toHaveLength(1);
  expect(calls).toBe(1);
  expect(await resolveLiveModelSelection("missing", () => models, refresh)).toEqual([]);
  expect(calls).toBe(2);
});

test("ambiguous authenticated matches do not trigger another network refresh", async () => {
  let calls = 0;
  const models = [{ provider: "one", id: "new" }, { provider: "two", id: "new" }];
  expect(await resolveLiveModelSelection("new", () => models, async () => { calls++; })).toHaveLength(2);
  expect(calls).toBe(0);
});

test("selection uses the same coalesced provider refresh and rejects failed activation", async () => {
  const fake = runtime(async () => ({ aborted: false, errors: new Map() }));
  await refreshModelCatalogForSelection(fake);
  expect(fake.calls[0]).toMatchObject({ allowNetwork: true, force: true });
  const failed = runtime(async () => { throw Error("provider failed"); });
  await expect(refreshModelCatalogForSelection(failed)).rejects.toThrow("catalogue refresh failed");
});

test("caller cancellation reaches the shared provider refresh without detached work", async () => {
  const caller = new AbortController(); let finished = false;
  const fake = runtime(() => new Promise(resolve => {
    const signal = fake.calls[0]!.signal as AbortSignal;
    signal.addEventListener("abort", () => { finished = true; resolve({ aborted: true, errors: new Map() }); });
  }));
  const pending = refreshModelCatalogForSelection(fake, { signal: caller.signal });
  caller.abort(Error("cancel catalogue update"));
  await expect(pending).rejects.toThrow("catalogue refresh failed");
  expect(finished).toBe(true);
});

test("a thrown refresh is a failure, not an exception", async () => {
  const fake = runtime(async () => { throw new Error("catalogue unavailable"); });
  expect(await refreshModelCatalogs(fake)).toEqual({ status: "failed", skipped: [], failed: [{ provider: "", message: "catalogue unavailable" }] });
});
