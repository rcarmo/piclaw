import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cdpSendWithTimeout, findCdpPort, getTargets, httpGet, httpPut, readManagedCdpPort } from "../../extensions/browser/cdp-browser/cdp.ts";

class FakeWebSocket {
  sent: string[] = [];
  listeners = new Map<string, Array<(...args: any[]) => void>>();

  addEventListener(type: string, listener: (...args: any[]) => void) {
    const current = this.listeners.get(type) || [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: (...args: any[]) => void) {
    const current = this.listeners.get(type) || [];
    this.listeners.set(type, current.filter((candidate) => candidate !== listener));
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }
}

test("cdpSendWithTimeout rejects timed out commands instead of resolving null", async () => {
  const ws = new FakeWebSocket() as unknown as WebSocket;

  await expect(cdpSendWithTimeout(ws, "Page.enable", undefined, undefined, 5)).rejects.toThrow(
    "CDP command timed out: Page.enable",
  );
});

test("cdpSendWithTimeout rejects protocol errors instead of resolving them", async () => {
  const ws = new FakeWebSocket() as unknown as WebSocket;
  const pending = cdpSendWithTimeout(ws, "Page.navigate", { url: "https://example.com" }, undefined, 50);
  const [{ id }] = ws.sent.map((payload) => JSON.parse(payload));

  (ws as any).emit("message", {
    data: JSON.stringify({
      id,
      error: {
        code: -32000,
        message: "Navigation failed",
      },
    }),
  });

  await expect(pending).rejects.toThrow("CDP command failed for Page.navigate: Navigation failed");
});

test("cdpSendWithTimeout still resolves successful protocol results", async () => {
  const ws = new FakeWebSocket() as unknown as WebSocket;
  const pending = cdpSendWithTimeout(ws, "Runtime.evaluate", { expression: "2 + 2" }, undefined, 50);
  const [{ id }] = ws.sent.map((payload) => JSON.parse(payload));

  (ws as any).emit("message", {
    data: JSON.stringify({
      id,
      result: {
        result: { type: "number", value: 4 },
      },
    }),
  });

  await expect(pending).resolves.toEqual({
    result: { type: "number", value: 4 },
  });
});

test("httpGet and httpPut return null when the response is not valid JSON", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      return new Response("<html>not json</html>", { status: 200 });
    }
    return new Response("plain text", { status: 200 });
  }) as typeof fetch;

  try {
    await expect(httpGet("http://localhost/json/version", 10)).resolves.toBeNull();
    await expect(httpPut("http://localhost/json/new", 10)).resolves.toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("findCdpPort skips non-JSON ports instead of accepting them as CDP", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(":9224/")) {
      return new Response("<html>nginx default page</html>", { status: 200 });
    }
    if (url.includes(":9225/")) {
      return new Response(JSON.stringify({ Browser: "Chrome/1.0" }), { status: 200 });
    }
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;

  try {
    await expect(findCdpPort()).resolves.toBe(9225);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("findCdpPort prefers a live managed desktop and falls back from stale state", async () => {
  const root = mkdtempSync(join(tmpdir(), "piclaw-cdp-state-"));
  const stateDir = join(root, ".piclaw", "browser");
  mkdirSync(stateDir, { recursive: true });
  const previousWorkspace = process.env.PICLAW_WORKSPACE;
  const originalFetch = globalThis.fetch;
  process.env.PICLAW_WORKSPACE = root;
  try {
    writeFileSync(join(stateDir, "managed-desktop.json"), JSON.stringify({ version: 1, cdpPort: 9228 }));
    const requests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes(":9228/")) return new Response(JSON.stringify({ Browser: "Managed" }));
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;
    expect(readManagedCdpPort(root)).toBe(9228);
    await expect(findCdpPort()).resolves.toBe(9228);
    expect(requests).toHaveLength(1);

    writeFileSync(join(stateDir, "managed-desktop.json"), JSON.stringify({ version: 1, cdpPort: 9999 }));
    expect(readManagedCdpPort(root)).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
    if (previousWorkspace === undefined) delete process.env.PICLAW_WORKSPACE;
    else process.env.PICLAW_WORKSPACE = previousWorkspace;
    rmSync(root, { recursive: true, force: true });
  }
});

test("getTargets returns an empty list when the endpoint does not return a JSON array", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "not targets" }), { status: 200 })) as typeof fetch;

  try {
    await expect(getTargets(9224)).resolves.toEqual([]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
