/**
 * test/channels/web/web-sse-client.test.ts – Tests for the browser-side SSEClient.
 *
 * Verifies reconnection scheduling, cooldown enforcement, and
 * event dispatch in the frontend SSE client class.
 */

import { expect, test } from "bun:test";
import "../../helpers.js";

import { abortAgentOperation, SSEClient, streamSidePrompt } from "../../../web/src/api.ts";

test("SSEClient scheduleReconnect triggers cooldown", () => {
  const client = new SSEClient(() => {}, () => {});

  const originalSetTimeout = globalThis.setTimeout;
  const originalNow = Date.now;
  let scheduledDelay = 0;

  globalThis.setTimeout = ((_, delay) => {
    scheduledDelay = Number(delay);
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  Date.now = () => 1000;

  client.reconnectAttempts = 10;
  client.scheduleReconnect();

  expect(client.cooldownUntil).toBe(61000);
  expect(scheduledDelay).toBe(60000);

  globalThis.setTimeout = originalSetTimeout;
  Date.now = originalNow;
});

test("SSEClient reconnectIfNeeded respects cooldown", () => {
  const client = new SSEClient(() => {}, () => {});
  let connected = false;
  client.connect = () => {
    connected = true;
  };

  client.status = "disconnected";
  client.cooldownUntil = Date.now() + 10000;
  client.reconnectIfNeeded();

  expect(connected).toBe(false);
});

test("SSEClient connects to a chat-scoped SSE stream when chatJid is provided", () => {
  const OriginalEventSource = globalThis.EventSource;
  const opened: string[] = [];

  class FakeEventSource {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(url: string) {
      opened.push(url);
    }
    addEventListener() {}
    close() {}
  }

  globalThis.EventSource = FakeEventSource as any;
  try {
    const client = new SSEClient(() => {}, () => {}, { chatJid: "web:branch-a" });
    client.connect();
    expect(opened[0]).toBe("/sse/stream?chat_jid=web%3Abranch-a");
  } finally {
    globalThis.EventSource = OriginalEventSource;
  }
});

test("SSEClient invalidates stale connection callbacks and preserves one delivery per independent client", () => {
  const OriginalEventSource = globalThis.EventSource;
  const instances: FakeEventSource[] = [];

  class FakeEventSource {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    listeners = new Map<string, Array<(event: { data: string }) => void>>();
    closed = false;
    constructor(_url: string) {
      instances.push(this);
    }
    addEventListener(event: string, listener: (event: { data: string }) => void) {
      const current = this.listeners.get(event) ?? [];
      current.push(listener);
      this.listeners.set(event, current);
    }
    emit(event: string, data: unknown = {}) {
      for (const listener of this.listeners.get(event) ?? []) {
        listener({ data: JSON.stringify(data) });
      }
    }
    close() {
      this.closed = true;
    }
  }

  globalThis.EventSource = FakeEventSource as any;
  try {
    const firstEvents: Array<{ type: string; data: any }> = [];
    const secondEvents: string[] = [];
    const first = new SSEClient((type, data) => firstEvents.push({ type, data }), () => {}, { chatJid: "web:branch-a" });
    const second = new SSEClient((type) => secondEvents.push(type), () => {}, { chatJid: "web:branch-a" });
    first.connect();
    second.connect();
    const stale = instances[0];
    const independent = instances[1];

    stale.onopen?.();
    independent.onopen?.();
    stale.onerror?.();
    expect(stale.closed).toBe(true);
    first.reconnectIfNeeded();
    const authoritative = instances[2];
    authoritative.onopen?.();

    stale.emit("agent_draft_delta", { turn_id: "turn-old", delta: "duplicate" });
    stale.emit("agent_status", { type: "thinking", operation_id: "operation-old" });
    stale.emit("new_post", { id: "post-old" });
    stale.onopen?.();
    stale.onerror?.();
    authoritative.emit("agent_draft_delta", { turn_id: "turn-new", delta: "continued" });
    authoritative.emit("agent_status", { type: "thinking", operation_id: "operation-new" });
    authoritative.emit("new_post", { id: "post-new" });
    independent.emit("agent_status", { type: "thinking" });

    expect(firstEvents).toEqual([
      { type: "agent_draft_delta", data: { turn_id: "turn-new", delta: "continued" } },
      { type: "agent_status", data: { type: "thinking", operation_id: "operation-new" } },
      { type: "new_post", data: { id: "post-new" } },
    ]);
    expect(secondEvents).toEqual(["agent_status"]);

    first.disconnect();
    stale.emit("agent_status", { type: "thinking" });
    authoritative.emit("agent_status", { type: "thinking" });
    expect(firstEvents).toHaveLength(3);
    second.disconnect();
  } finally {
    globalThis.EventSource = OriginalEventSource;
  }
});

test("SSE remount and chat switch keep Abort bound to the latest visible operation", async () => {
  const OriginalEventSource = globalThis.EventSource;
  const originalFetch = globalThis.fetch;
  const instances: FakeEventSource[] = [];
  let visibleStatus: any = null;
  let seenUrl = "";
  let seenBody: any = null;

  class FakeEventSource {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    listeners = new Map<string, Array<(event: { data: string }) => void>>();
    constructor(_url: string) {
      instances.push(this);
    }
    addEventListener(event: string, listener: (event: { data: string }) => void) {
      const current = this.listeners.get(event) ?? [];
      current.push(listener);
      this.listeners.set(event, current);
    }
    emit(event: string, data: unknown) {
      for (const listener of this.listeners.get(event) ?? []) {
        listener({ data: JSON.stringify(data) });
      }
    }
    close() {}
  }

  globalThis.EventSource = FakeEventSource as any;
  globalThis.fetch = (async (url, init) => {
    seenUrl = String(url);
    seenBody = init?.body ? JSON.parse(String(init.body)) : null;
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const mountA = new SSEClient((type, data) => {
      if (type === "agent_status") visibleStatus = data;
    }, () => {}, { chatJid: "web:branch-a" });
    mountA.connect();
    instances[0].emit("agent_status", {
      type: "thinking",
      operation_id: "operation-a",
      operation_authority: "durable",
    });
    expect(visibleStatus.operation_id).toBe("operation-a");

    mountA.disconnect();
    const remountA = new SSEClient((type, data) => {
      if (type === "agent_status") visibleStatus = data;
    }, () => {}, { chatJid: "web:branch-a" });
    remountA.connect();
    instances[0].emit("agent_status", {
      type: "thinking",
      operation_id: "operation-stale",
      operation_authority: "durable",
    });
    instances[1].emit("agent_status", {
      type: "tool",
      operation_id: "operation-a-remount",
      operation_authority: "durable",
    });
    expect(visibleStatus.operation_id).toBe("operation-a-remount");

    remountA.disconnect();
    const mountB = new SSEClient((type, data) => {
      if (type === "agent_status") visibleStatus = data;
    }, () => {}, { chatJid: "web:branch-b" });
    mountB.connect();
    instances[1].emit("agent_status", {
      type: "tool",
      operation_id: "operation-a-late",
      operation_authority: "durable",
    });
    instances[2].emit("agent_status", {
      type: "tool",
      operation_id: "operation-b",
      operation_authority: "durable",
    });

    await abortAgentOperation("web:branch-b", visibleStatus.operation_id);
    expect(seenUrl).toBe("/agent/default/message?chat_jid=web%3Abranch-b");
    expect(seenBody.expected_operation_id).toBe("operation-b");
    mountB.disconnect();
  } finally {
    globalThis.EventSource = OriginalEventSource;
    globalThis.fetch = originalFetch;
  }
});

test("SSEClient no longer registers stale agent_request listeners", () => {
  const OriginalEventSource = globalThis.EventSource;
  const seenEvents: string[] = [];

  class FakeEventSource {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_url: string) {}
    addEventListener(event: string) {
      seenEvents.push(event);
    }
    close() {}
  }

  globalThis.EventSource = FakeEventSource as any;
  try {
    const client = new SSEClient(() => {}, () => {});
    client.connect();
    expect(seenEvents).not.toContain("agent_request");
    expect(seenEvents).not.toContain("agent_request_timeout");
    expect(seenEvents).toContain("agent_status");
    expect(seenEvents).toContain("new_post");
    expect(seenEvents).toContain("workspace_update");
    expect(seenEvents).toContain("extension_ui_request");
    expect(seenEvents).toContain("extension_ui_notify");
    expect(seenEvents).toContain("extension_ui_error");
  } finally {
    globalThis.EventSource = OriginalEventSource;
  }
});

test("abortAgentOperation submits the exact operation owner for the active chat", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenBody: any = null;
  globalThis.fetch = (async (url, init) => {
    seenUrl = String(url);
    seenBody = init?.body ? JSON.parse(String(init.body)) : null;
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await abortAgentOperation("web:branch-a", "operation-123");
    expect(seenUrl).toBe("/agent/default/message?chat_jid=web%3Abranch-a");
    expect(seenBody).toMatchObject({
      content: "/abort",
      expected_operation_id: "operation-123",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("abortAgentOperation surfaces stale-owner rejection text to the compose caller", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: "The active operation changed before cancellation; no action was taken.",
    reason: "operation_mismatch",
  }), {
    status: 409,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

  try {
    await expect(abortAgentOperation("web:branch-a", "operation-stale"))
      .rejects.toThrow("The active operation changed before cancellation; no action was taken.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamSidePrompt parses SSE event frames, returns the final payload, and forwards the active chat_jid", async () => {
  const originalFetch = globalThis.fetch;
  let seenBody: any = null;
  globalThis.fetch = (async (_url, init) => {
    seenBody = init?.body ? JSON.parse(String(init.body)) : null;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: side_prompt_start\ndata: {"chat_jid":"web:branch-a"}\n\n'));
        controller.enqueue(encoder.encode('event: side_prompt_thinking_delta\ndata: {"delta":"plan"}\n\n'));
        controller.enqueue(encoder.encode('event: side_prompt_text_delta\ndata: {"delta":"answer"}\n\n'));
        controller.enqueue(encoder.encode('event: side_prompt_done\ndata: {"status":"success","result":"answer","thinking":"plan","model":"openai/gpt-test"}\n\n'));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;

  const seen: Array<string> = [];
  const result = await streamSidePrompt("What changed?", {
    chatJid: "web:branch-a",
    onThinkingDelta: (delta) => seen.push(`thinking:${delta}`),
    onTextDelta: (delta) => seen.push(`text:${delta}`),
  });

  expect(seenBody).toEqual({
    prompt: "What changed?",
    chat_jid: "web:branch-a",
  });
  expect(seen).toEqual(["thinking:plan", "text:answer"]);
  expect(result).toEqual({
    status: "success",
    result: "answer",
    thinking: "plan",
    model: "openai/gpt-test",
  });

  globalThis.fetch = originalFetch;
});
