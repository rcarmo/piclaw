import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  freezeExternalAddonRoutes,
  getRegisteredExternalAddonRoutes,
  handleExternalAddonRoutes,
  isExternalAddonRouteRegistryFrozen,
  registerExternalAddonRoute,
  resetExternalAddonRoutesForTests,
  withExternalAddonRegistrationContext,
} from "../../src/addons/external-routes.js";
import { resetRateLimiterStateForTests } from "../../src/channels/web/http/rate-limit.js";

beforeEach(() => {
  resetExternalAddonRoutesForTests();
  resetRateLimiterStateForTests();
});

afterEach(() => {
  resetExternalAddonRoutesForTests();
  resetRateLimiterStateForTests();
});

async function register(
  input: Partial<Parameters<typeof registerExternalAddonRoute>[0]> = {},
  owner = { packageName: "@rcarmo/piclaw-addon-remote-peer", entryPath: "/addons/remote-peer/runtime.ts" },
) {
  return await withExternalAddonRegistrationContext(owner, async () => registerExternalAddonRoute({
    addonId: "remote-peer",
    prefix: "/api/addons/remote-peer/v1",
    methods: ["GET", "POST"],
    maxBodyBytes: 32,
    handler: async (req, pathname, context) => new Response(JSON.stringify({
      body: await req.text(),
      pathname,
      context,
    }), { headers: { "Content-Type": "application/json" } }),
    ...input,
  }));
}

describe("external add-on route registry", () => {
  test("registers only within an installed package owner context and freezes", async () => {
    expect(() => registerExternalAddonRoute({
      addonId: "remote-peer",
      prefix: "/api/addons/remote-peer/v1",
      methods: ["POST"],
      maxBodyBytes: 32,
      handler: () => new Response("ok"),
    })).toThrow("startup runtime entry import");

    await register();
    expect(getRegisteredExternalAddonRoutes()).toMatchObject([{
      addonId: "remote-peer",
      packageName: "@rcarmo/piclaw-addon-remote-peer",
      entryPath: "/addons/remote-peer/runtime.ts",
      prefix: "/api/addons/remote-peer/v1",
      methods: ["GET", "POST"],
      maxBodyBytes: 32,
    }]);
    freezeExternalAddonRoutes();
    expect(isExternalAddonRouteRegistryFrozen()).toBe(true);
    await expect(register()).rejects.toThrow("frozen after startup");
  });

  test("binds add-on ids to package ownership and reserved prefixes", async () => {
    await expect(register({ addonId: "other" })).rejects.toThrow("does not match installed owner");
    await expect(register({ prefix: "/api/addons/other/v1" })).rejects.toThrow("must be /api/addons/remote-peer");
    await expect(register({}, { packageName: "unrelated-package", entryPath: "/tmp/runtime.ts" }))
      .rejects.toThrow("piclaw-addon-<id>");
    await expect(register({ methods: ["DELETE"] })).rejects.toThrow("only GET and POST");
    await expect(register({ maxBodyBytes: 0 })).rejects.toThrow("must be an integer");
  });

  test("rejects overlapping prefixes and unregisters idempotently", async () => {
    const unregister = await register();
    await expect(register({ prefix: "/api/addons/remote-peer/v1/messages" })).rejects.toThrow("overlaps route");
    unregister();
    unregister();
    expect(getRegisteredExternalAddonRoutes()).toEqual([]);
  });

  test("enforces methods and bounded declared/streamed bodies before handler execution", async () => {
    let calls = 0;
    await register({
      methods: ["POST"],
      maxBodyBytes: 4,
      handler: async (req) => {
        calls += 1;
        return new Response(await req.text());
      },
    });

    const method = await handleExternalAddonRoutes(
      new Request("http://localhost/api/addons/remote-peer/v1", { method: "GET" }),
      "/api/addons/remote-peer/v1",
    );
    expect(method?.status).toBe(405);
    expect(method?.headers.get("allow")).toBe("POST");

    const declared = await handleExternalAddonRoutes(new Request("http://localhost/api/addons/remote-peer/v1", {
      method: "POST",
      headers: { "Content-Length": "9" },
      body: "123456789",
    }), "/api/addons/remote-peer/v1");
    expect(declared?.status).toBe(413);

    const streamed = await handleExternalAddonRoutes(new Request("http://localhost/api/addons/remote-peer/v1", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("123"));
          controller.enqueue(new TextEncoder().encode("45"));
          controller.close();
        },
      }),
      duplex: "half",
    } as any), "/api/addons/remote-peer/v1");
    expect(streamed?.status).toBe(413);
    expect(calls).toBe(0);
  });

  test("preserves bounded streaming request bodies for binary add-on routes", async () => {
    const chunks: number[] = [];
    await register({
      methods: ["POST"],
      maxBodyBytes: 5,
      bodyMode: "stream",
      handler: async (req) => {
        const reader = req.body!.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value.byteLength);
        }
        return new Response("ok");
      },
    });
    const response = await handleExternalAddonRoutes(new Request("http://localhost/api/addons/remote-peer/v1/attachment", {
      method: "POST",
      body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4, 5])); controller.close(); } }),
      duplex: "half",
    } as any), "/api/addons/remote-peer/v1/attachment");
    expect(response?.status).toBe(200);
    expect(chunks.reduce((sum, value) => sum + value, 0)).toBe(5);
    expect(getRegisteredExternalAddonRoutes()[0].bodyMode).toBe("stream");
  });

  test("passes bounded requests with immutable owner context", async () => {
    await register();
    const response = await handleExternalAddonRoutes(new Request("http://localhost/api/addons/remote-peer/v1/message", {
      method: "POST",
      body: "hello",
    }), "/api/addons/remote-peer/v1/message");
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({
      body: "hello",
      pathname: "/api/addons/remote-peer/v1/message",
      context: {
        addonId: "remote-peer",
        packageName: "@rcarmo/piclaw-addon-remote-peer",
        entryPath: "/addons/remote-peer/runtime.ts",
      },
    });
  });

  test("applies a coarse source rate limit and suppresses handler errors", async () => {
    let calls = 0;
    await register({
      methods: ["GET"],
      handler: () => {
        calls += 1;
        if (calls === 1) throw new Error("secret failure");
        return new Response("ok");
      },
    });
    const first = await handleExternalAddonRoutes(
      new Request("http://localhost/api/addons/remote-peer/v1", { headers: { "x-forwarded-for": "203.0.113.7" } }),
      "/api/addons/remote-peer/v1",
    );
    expect(first?.status).toBe(500);
    expect(await first?.json()).toEqual({ error: "Internal server error." });
    resetRateLimiterStateForTests();

    for (let index = 0; index < 120; index += 1) {
      const response = await handleExternalAddonRoutes(
        new Request("http://localhost/api/addons/remote-peer/v1", { headers: { "x-forwarded-for": "203.0.113.8" } }),
        "/api/addons/remote-peer/v1",
      );
      expect(response?.status).toBe(200);
    }
    const limited = await handleExternalAddonRoutes(
      new Request("http://localhost/api/addons/remote-peer/v1", { headers: { "x-forwarded-for": "203.0.113.8" } }),
      "/api/addons/remote-peer/v1",
    );
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("retry-after")).toBe("60");
  });
});
