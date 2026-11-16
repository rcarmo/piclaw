import { expect, test } from "bun:test";
import { createHostFetch } from "../../runtime/durable-engine/src/host-fetch.ts";
import { context } from "./src/fixture.ts";

test("codemode fetch returns bounded structured text and omits private headers", async () => {
  let checks = 0;
  const tool = createHostFetch({ async captureSource() { return () => { checks++; }; }, fetch: (async (_url, options) => {
    expect(options).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
    return new Response('{"value":7}', { headers: { "content-type": "application/json", "set-cookie": "SECRET" } });
  }) });
  const result = await tool.execute({ url: "http://127.0.0.1/data" }, {} as any, context);
  expect(result.structuredOutput).toMatchObject({ status: 200, ok: true, body: '{"value":7}', headers: { "content-type": "application/json" } });
  expect(JSON.stringify(result)).not.toContain("SECRET");
  expect(checks).toBeGreaterThan(2);
});

test("fetch denies revoked sources, credential URLs and oversized bodies", async () => {
  let calls = 0;
  const request = (async () => { calls++; return new Response("oversize"); });
  const denied = createHostFetch({ async captureSource() { return () => { throw Error("revoked"); }; }, fetch: request });
  await expect(denied.execute({ url: "https://example.com" }, {} as any, context)).rejects.toThrow("revoked");
  const tool = createHostFetch({ async captureSource() { return () => {}; }, fetch: request });
  await expect(tool.execute({ url: "https://user:secret@example.com" }, {} as any, context)).rejects.toThrow("without credentials");
  expect(calls).toBe(0);
  await expect(tool.execute({ url: "https://example.com", max_bytes: 2 }, {} as any, context)).rejects.toThrow("max_bytes");
});

test("fetch revocation during body reading cancels the stream and returns no body", async () => {
  let allowed = true, cancelled = false;
  const tool = createHostFetch({ async captureSource() { return () => { if (!allowed) throw Error("revoked"); }; },
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { allowed = false; controller.enqueue(new TextEncoder().encode("MUST_NOT_RETURN")); },
      cancel() { cancelled = true; },
    })),
  });
  await expect(tool.execute({ url: "https://fixture.invalid" }, {} as any, context)).rejects.toThrow("revoked");
  expect(cancelled).toBe(true);
});

test("fetch propagates cancellation to an outstanding body read", async () => {
  const { withAbortSignal } = await import("../../runtime/durable-engine/qualification/context.ts");
  const abort = new AbortController();
  let entered!: () => void;
  const reading = new Promise<void>(resolve => entered = resolve);
  const tool = createHostFetch({ async captureSource() { return () => {}; }, fetch: async (_url, options) => {
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      options.signal!.addEventListener("abort", () => controller.error(options.signal!.reason), { once: true });
      entered();
    } }));
  } });
  const result = tool.execute({ url: "https://fixture.invalid" }, {} as any, withAbortSignal(abort.signal, context));
  await reading;
  abort.abort(Error("caller cancelled"));
  await expect(result).rejects.toThrow("caller cancelled");
});

test("fetch redirect refusal does not issue a second request", async () => {
  let calls = 0;
  const tool = createHostFetch({ async captureSource() { return () => {}; }, fetch: async (_url, options) => {
    calls++;
    expect(options.redirect).toBe("error");
    throw TypeError("redirect refused"); // Match native fetch's redirect:error rejection.
  } });
  await expect(tool.execute({ url: "https://fixture.invalid/redirect" }, {} as any, context)).rejects.toThrow("redirect refused");
  expect(calls).toBe(1);
});
