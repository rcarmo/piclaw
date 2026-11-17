import { expect, test } from "bun:test";
import { ModelsError } from "@earendil-works/pi-ai";
import { refreshModelCatalogs } from "../../src/runtime/model-catalog-refresh.js";

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

test("a thrown refresh is a failure, not an exception", async () => {
  const fake = runtime(async () => { throw new Error("catalogue unavailable"); });
  expect(await refreshModelCatalogs(fake)).toEqual({ status: "failed", skipped: [], failed: [{ provider: "", message: "catalogue unavailable" }] });
});
