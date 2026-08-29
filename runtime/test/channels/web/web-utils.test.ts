/**
 * test/channels/web/web-utils.test.ts – Tests for HTTP utility functions.
 *
 * Covers jsonResponse(), parseOptionalInt(), clampInt(), and static
 * file existence checks.
 */

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { clampInt, errorJson, jsonResponse, okJson, parseOptionalInt } from "../../../src/channels/web/http/http-utils.js";
import { buildPreview, createToolTitleTracker, resolveMcpToolStatusIdentity } from "../../../src/channels/web/agent/agent-utils.js";
import { handleSse, broadcastEvent } from "../../../src/channels/web/sse/sse.js";
import { serveDocsStatic, serveStatic } from "../../../src/channels/web/http/static.js";
import { UiBridge } from "../../../src/channels/web/theming/ui-bridge.js";
import { createUiContext } from "../../../src/channels/web/ui-context.js";
import { handleMedia, handleMediaInfo, handleMediaUpload } from "../../../src/channels/web/handlers/media.js";
import { getTestWorkspace, setEnv, waitFor } from "../../helpers.js";

import type { WebChannel } from "../../../src/channels/web.js";

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("http utils clamp and parse", async () => {
  const res = jsonResponse({ ok: true }, 201, { "Set-Cookie": "piclaw_session=test" });
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ ok: true });
  expect(res.headers.get("Set-Cookie")).toBe("piclaw_session=test");

  const ok = okJson({ visible: true }, 202, { "X-Test": "yes" });
  expect(ok.status).toBe(202);
  expect(await ok.json()).toEqual({ status: "ok", visible: true });
  expect(ok.headers.get("X-Test")).toBe("yes");

  const err = errorJson("Nope", 418);
  expect(err.status).toBe(418);
  expect(await err.json()).toEqual({ error: "Nope" });

  expect(clampInt("5", 1, 1, 4)).toBe(4);
  expect(parseOptionalInt("12")).toBe(12);
  expect(parseOptionalInt(null)).toBeNull();
});

test("agent utils preview and tool titles", () => {
  const { preview, totalLines } = buildPreview("one\nline two", 1, 10);
  expect(preview).toBe("one");
  expect(totalLines).toBe(2);

  const tracker = createToolTitleTracker();
  const title = tracker.remember("call-1", "bash", { command: "echo hi" });
  expect(title).toContain("bash: echo hi");
  expect(tracker.lookup("call-1", "bash")).toBe(title);
  tracker.forget("call-1");

  expect(tracker.remember("call-mcp", "mcp", { server: "memento", tool: "memory_search" }))
    .toBe("mcp: memento → memory_search");
  expect(resolveMcpToolStatusIdentity("mcp", { server: "memento", tool: "memory_search" })).toEqual({
    operation: "call",
    server: "memento",
    tool: "memory_search",
    target: "memory_search",
    label: "mcp: memento → memory_search",
  });
  expect(resolveMcpToolStatusIdentity("mcp", { connect: "memento" })?.label).toBe("mcp: memento → connect");
  expect(resolveMcpToolStatusIdentity("mcp", { describe: "memory_search", server: "memento" })?.label).toBe("mcp: memento → describe memory_search");
  expect(resolveMcpToolStatusIdentity("mcp", { search: "memory" })?.label).toBe("mcp: search → memory");
  expect(resolveMcpToolStatusIdentity("mcp", {})?.label).toBe("mcp: status");
});

test("sse helper streams connection and broadcasts", async () => {
  const channel = { clients: new Set() } as unknown as WebChannel;
  const res = handleSse(channel);
  expect(res.headers.get("Content-Type")).toContain("text/event-stream");

  const reader = res.body?.getReader();
  expect(reader).not.toBeNull();
  const first = await reader!.read();
  const text = new TextDecoder().decode(first.value);
  expect(text).toContain("connected");
  await reader!.cancel();
  await waitFor(() => channel.clients.size === 0);

  let payload = "";
  const controller = { enqueue: (value: Uint8Array) => { payload = new TextDecoder().decode(value); } };
  const heartbeat = setInterval(() => {}, 1000);
  (channel.clients as Set<any>).add({ controller, heartbeat });
  broadcastEvent(channel, "ping", { ok: true });
  clearInterval(heartbeat);
  expect(payload).toContain("event: ping");
});

test("static helpers serve files and not-found", async () => {
  const root = join(import.meta.dir, "..", "..", "..");
  const indexPath = join(root, "web", "static", "classic", "index.html");
  expect(existsSync(indexPath)).toBe(true);

  const okRes = await serveStatic("classic/index.html", () => new Response("nope", { status: 404 }));
  expect(okRes.status).toBe(200);
  expect(okRes.headers.get("Content-Type")).toContain("text/html");
  expect(okRes.headers.get("Cache-Control")).toBe("no-cache, no-store, must-revalidate");
  const indexHtml = await okRes.text();
  expect(indexHtml).not.toContain("__APP_ASSET_VERSION__");
  expect(indexHtml).not.toContain("__PICLAW_NOTIFICATION_SOURCE_LABELS_FLAG__");
  expect(indexHtml).toMatch(/\/static\/classic\/dist\/app\.bundle\.js\?v=[a-z0-9]+/i);
  expect(indexHtml).toMatch(/\/manifest\.json\?v=[a-z0-9]+/i);
  expect(indexHtml).toContain('window.__PICLAW_NOTIFICATION_SOURCE_LABELS_ENABLED__ = "0" === "1";');

  const loginRes = await serveStatic("login.html", () => new Response("nope", { status: 404 }));
  expect(loginRes.status).toBe(200);
  const loginHtml = await loginRes.text();
  expect(loginHtml).not.toContain("__LOGIN_ASSET_VERSION__");
  expect(loginHtml).toMatch(/\/static\/(common\/)?dist\/login\.bundle\.js\?v=[a-z0-9]+/i);

  const appBundleRes = await serveStatic("classic/dist/app.bundle.js", () => new Response("nope", { status: 404 }));
  expect(appBundleRes.status).toBe(200);
  expect(appBundleRes.headers.get("Cache-Control")).toBe("no-cache, no-store, must-revalidate");

  const swRes = await serveStatic("sw.js", () => new Response("nope", { status: 404 }));
  expect(swRes.status).toBe(200);
  expect(swRes.headers.get("Service-Worker-Allowed")).toBe("/");
  const swText = await swRes.text();
  expect(swText).not.toContain("__PICLAW_NOTIFICATION_SOURCE_LABELS_FLAG__");
  expect(swText).toContain('const NOTIFICATION_SOURCE_LABELS_ENABLED = "0" === "1";');

  const wasmRes = await serveStatic("common/js/vendor/remote-display-decoder.wasm", () => new Response("nope", { status: 404 }));
  expect(wasmRes.status).toBe(200);
  expect(wasmRes.headers.get("Content-Type")).toBe("application/wasm");

  const notFound = await serveDocsStatic("missing.html", () => new Response("nope", { status: 404 }));
  expect(notFound.status).toBe(404);
});

test("static text helpers serve repeated html and service worker reads", async () => {
  const responses = await Promise.all(
    Array.from({ length: 20 }, async () => {
      const [indexRes, swRes] = await Promise.all([
        serveStatic("classic/index.html", () => new Response("nope", { status: 404 })),
        serveStatic("sw.js", () => new Response("nope", { status: 404 })),
      ]);
      return {
        indexText: await indexRes.text(),
        swText: await swRes.text(),
      };
    })
  );

  for (const response of responses) {
    expect(response.indexText).not.toContain("__APP_ASSET_VERSION__");
    expect(response.swText).not.toContain("__PICLAW_NOTIFICATION_SOURCE_LABELS_FLAG__");
  }
});

test("static helpers reject same-prefix sibling traversal paths", async () => {
  const root = join(import.meta.dir, "..", "..", "..");
  const staticSiblingDir = join(root, "web", "static-backup");
  const docsSiblingDir = join(root, "docs-backup");
  const staticSiblingFile = join(staticSiblingDir, "secret.txt");
  const docsSiblingFile = join(docsSiblingDir, "secret.txt");

  mkdirSync(staticSiblingDir, { recursive: true });
  mkdirSync(docsSiblingDir, { recursive: true });
  writeFileSync(staticSiblingFile, "static secret", "utf8");
  writeFileSync(docsSiblingFile, "docs secret", "utf8");

  try {
    const staticRes = await serveStatic("../static-backup/secret.txt", () => new Response("nope", { status: 404 }));
    expect(staticRes.status).toBe(404);

    const docsRes = await serveDocsStatic("../docs-backup/secret.txt", () => new Response("nope", { status: 404 }));
    expect(docsRes.status).toBe(404);
  } finally {
    rmSync(staticSiblingDir, { recursive: true, force: true });
    rmSync(docsSiblingDir, { recursive: true, force: true });
  }
});

test("ui bridge stop clears pending requests even when a pending reject throws", () => {
  const channel = { broadcastEvent: () => undefined } as any;
  const uiBridge = new UiBridge(channel);
  uiBridge.editorTextByChat.set("web:default", "draft");
  uiBridge.themeByChat.set("web:default", { theme: "tango" });
  uiBridge.pendingUiRequests.set("req-1", {
    chatJid: "web:default",
    kind: "input",
    timeoutId: setTimeout(() => undefined, 60_000),
    resolve: () => undefined,
    reject: () => { throw new Error("boom"); },
  } as any);

  expect(() => uiBridge.stop()).not.toThrow();
  expect(uiBridge.pendingUiRequests.size).toBe(0);
  expect(uiBridge.editorTextByChat.size).toBe(0);
  expect(uiBridge.themeByChat.size).toBe(0);
});

test("ui context emits requests and resolves", async () => {
  const events: Array<{ type: string; payload: any }> = [];
  const channel = {
    broadcastEvent: (type: string, payload: any) => events.push({ type, payload }),
  } as any;
  const uiBridge = new UiBridge(channel);
  channel.uiBridge = uiBridge;

  const ui = createUiContext(channel, "web:default");
  const selectPromise = ui.select("Pick", ["a", "b"]);
  const [requestId] = uiBridge.pendingUiRequests.keys();
  const pending = uiBridge.pendingUiRequests.get(requestId)!;
  clearTimeout(pending.timeoutId);
  uiBridge.pendingUiRequests.delete(requestId);
  pending.resolve("a");
  expect(await selectPromise).toBe("a");

  ui.notify("Hello", "info");
  expect(events.some((event) => event.type === "extension_ui_notify")).toBe(true);

  ui.pasteToEditor("test");
  expect(uiBridge.editorTextByChat.get("web:default")).toBe("test");
});

test("media handlers store and retrieve files", async () => {
  const ws = getTestWorkspace();
  const restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();

  const channel = { json: makeJsonResponse } as any;
  const form = new FormData();
  const file = new File(["hello"], "hello.txt", { type: "text/plain" });
  form.append("file", file);
  const req = new Request("http://test/media/upload", { method: "POST", body: form });
  const uploadRes = await handleMediaUpload(channel, req);
  const uploadJson = await uploadRes.json();
  expect(uploadJson.id).toBeDefined();

  const infoRes = handleMediaInfo(channel, uploadJson.id);
  const infoJson = await infoRes.json();
  expect(infoJson.filename).toBe("hello.txt");

  const mediaRes = handleMedia(channel, uploadJson.id, false);
  expect(mediaRes.headers.get("Content-Type")).toContain("text/plain");

  restore();
});
