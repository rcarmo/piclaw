/**
 * Tests for API security hardening:
 * - Security headers on responses
 * - CSRF origin validation
 * - Media upload size/type limits
 * - Post content length limits
 * - SSE client cap
 * - Content-Disposition on media downloads
 * - Agent message content length limits
 */
import { describe, test, expect } from "bun:test";
import { getTestWorkspace, setEnv } from "../../helpers.js";

// ── Post content length validation ──
import { parsePostPayload } from "../../../src/channels/web/posts-service.js";
import { createAgentProfileBuilder } from "../../../src/channels/web/agent/agent-utils.js";

describe("parsePostPayload", () => {
  test("rejects content exceeding 100 KB", () => {
    const bigContent = "x".repeat(100 * 1024 + 1);
    const result = parsePostPayload({ content: bigContent });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("too large");
  });

  test("accepts content at exactly 100 KB", () => {
    const content = "x".repeat(100 * 1024);
    const result = parsePostPayload({ content });
    expect(result.ok).toBe(true);
    expect(result.data?.content).toBe(content);
  });

  test("rejects missing content", () => {
    const result = parsePostPayload({ content: "" });
    expect(result.ok).toBe(false);
  });

  test("rejects invalid body (null)", () => {
    const result = parsePostPayload(null);
    expect(result.ok).toBe(false);
  });

  test("rejects invalid body (non-object)", () => {
    const result = parsePostPayload("hello");
    expect(result.ok).toBe(false);
  });

  test("accepts normal content", () => {
    const result = parsePostPayload({ content: "Hello world!" });
    expect(result.ok).toBe(true);
    expect(result.data?.content).toBe("Hello world!");
  });
});

// ── Agent message content length validation ──
import { parseAgentMessageRequest } from "../../../src/channels/web/messaging/agent-message-service.js";

describe("parseAgentMessageRequest", () => {
  test("rejects content exceeding 100 KB", async () => {
    const bigContent = "x".repeat(100 * 1024 + 1);
    const req = new Request("http://localhost/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: bigContent }),
    });
    const result = await parseAgentMessageRequest(req);
    expect(result.error).toContain("too large");
    expect(result.payload).toBeUndefined();
  });

  test("accepts content at exactly 100 KB", async () => {
    const content = "x".repeat(100 * 1024);
    const req = new Request("http://localhost/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const result = await parseAgentMessageRequest(req);
    expect(result.error).toBeUndefined();
    expect(result.payload?.content).toBe(content);
  });

  test("accepts normal content", async () => {
    const req = new Request("http://localhost/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });
    const result = await parseAgentMessageRequest(req);
    expect(result.error).toBeUndefined();
    expect(result.payload?.content).toBe("Hello");
  });

  test("rejects invalid JSON", async () => {
    const req = new Request("http://localhost/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const result = await parseAgentMessageRequest(req);
    expect(result.error).toBe("Invalid JSON");
  });
});

// ── Media upload validation ──
import { MediaService } from "../../../src/channels/web/media/media-service.js";

describe("MediaService.createFromFile", () => {
  const service = new MediaService();

  test("rejects files over 10 MB", async () => {
    const bigData = new Uint8Array(10 * 1024 * 1024 + 1);
    const file = new File([bigData], "big.png", { type: "image/png" });
    const result = await service.createFromFile(file);
    expect(result.status).toBe(413);
    expect((result.body as any).error).toContain("too large");
  });

  test("accepts general file attachments (executables are stored as downloads)", async () => {
    const data = new Uint8Array(100);
    const file = new File([data], "evil.exe", { type: "application/x-msdownload" });
    try {
      const result = await service.createFromFile(file);
      expect(result.status).toBe(200);
      expect((result.body as any).contentType).toBe("application/x-msdownload");
    } catch (e: any) {
      expect(e.message).toContain("Database not initialized");
    }
  });

  test("accepts general file attachments (java archives are stored as downloads)", async () => {
    const data = new Uint8Array(100);
    const file = new File([data], "app.jar", { type: "application/java-archive" });
    try {
      const result = await service.createFromFile(file);
      expect(result.status).toBe(200);
      expect((result.body as any).contentType).toBe("application/java-archive");
    } catch (e: any) {
      expect(e.message).toContain("Database not initialized");
    }
  });

  test("accepts allowed image types (validation only)", async () => {
    const data = new Uint8Array(100);
    const file = new File([data], "photo.jpg", { type: "image/jpeg" });
    // If DB isn't initialized the validation pass but createMedia throws.
    // We only care that the size/type checks don't reject it.
    try {
      const result = await service.createFromFile(file);
      expect(result.status).toBe(200);
      expect((result.body as any).id).toBeDefined();
    } catch (e: any) {
      // DB not initialized in unit test context — that's fine,
      // the important thing is it passed the size + type checks.
      expect(e.message).toContain("Database not initialized");
    }
  });

  test("accepts allowed text types (validation only)", async () => {
    const data = new TextEncoder().encode("hello world");
    const file = new File([data], "readme.md", { type: "text/markdown" });
    try {
      const result = await service.createFromFile(file);
      expect(result.status).toBe(200);
    } catch (e: any) {
      expect(e.message).toContain("Database not initialized");
    }
  });

  test("accepts unknown image subtypes via image/* prefix", async () => {
    const data = new Uint8Array(100);
    const file = new File([data], "photo.tiff", { type: "image/tiff" });
    try {
      const result = await service.createFromFile(file);
      expect(result.status).toBe(200);
    } catch (e: any) {
      expect(e.message).toContain("Database not initialized");
    }
  });

  test("accepts image/svg+xml explicitly", async () => {
    const data = new TextEncoder().encode("<svg></svg>");
    const file = new File([data], "vector.svg", { type: "image/svg+xml" });
    try {
      const result = await service.createFromFile(file);
      expect(result.status).toBe(200);
    } catch (e: any) {
      expect(e.message).toContain("Database not initialized");
    }
  });

  test("accepts unknown content types as binary downloads", async () => {
    const data = new Uint8Array(10);
    const file = new File([data], "unknown.bin", { type: "application/x-unknown" });
    try {
      const result = await service.createFromFile(file);
      expect(result.status).toBe(200);
      expect((result.body as any).contentType).toBe("application/x-unknown");
    } catch (e: any) {
      expect(e.message).toContain("Database not initialized");
    }
  });
});

// ── SSE client cap ──
import { broadcastEvent, handleSse, requiresChatScopedDelivery, type SseClientContainer, type PendingClient } from "../../../src/channels/web/sse/sse.js";

describe("SSE client cap", () => {
  test("rejects connections when at capacity (50)", () => {
    const channel: SseClientContainer = {
      clients: new Set<PendingClient>(),
    };
    // Fill up to 50 clients with dummy entries
    for (let i = 0; i < 50; i++) {
      channel.clients.add({
        controller: {} as any,
        heartbeat: setTimeout(() => {}, 0) as any,
      });
    }

    const response = handleSse(channel);
    expect(response.status).toBe(503);

    // Cleanup timers
    for (const client of channel.clients) {
      clearTimeout(client.heartbeat);
    }
  });

  test("accepts connection when under capacity", () => {
    const channel: SseClientContainer = {
      clients: new Set<PendingClient>(),
    };

    const response = handleSse(channel);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    // Cleanup
    for (const client of channel.clients) {
      clearInterval(client.heartbeat);
    }
  });

  test("broadcastEvent filters chat-scoped SSE events per subscribed chat", () => {
    const seenA: Uint8Array[] = [];
    const seenB: Uint8Array[] = [];
    const seenGlobal: Uint8Array[] = [];
    const channel: SseClientContainer = {
      clients: new Set<PendingClient>([
        { controller: { enqueue: (bytes: Uint8Array) => { seenA.push(bytes); } } as any, heartbeat: setTimeout(() => {}, 0) as any, chatJid: "web:a" },
        { controller: { enqueue: (bytes: Uint8Array) => { seenB.push(bytes); } } as any, heartbeat: setTimeout(() => {}, 0) as any, chatJid: "web:b" },
        { controller: { enqueue: (bytes: Uint8Array) => { seenGlobal.push(bytes); } } as any, heartbeat: setTimeout(() => {}, 0) as any, chatJid: null },
      ]),
    };

    broadcastEvent(channel, "agent_status", { chat_jid: "web:a", type: "thinking" });

    expect(seenA.length).toBe(1);
    expect(seenB.length).toBe(0);
    expect(seenGlobal.length).toBe(1);

    for (const client of channel.clients) {
      clearTimeout(client.heartbeat);
    }
  });

  test("broadcastEvent drops chat-scoped events that omit chat_jid", () => {
    const seen: Uint8Array[] = [];
    const channel: SseClientContainer = {
      clients: new Set<PendingClient>([
        { controller: { enqueue: (bytes: Uint8Array) => { seen.push(bytes); } } as any, heartbeat: setTimeout(() => {}, 0) as any, chatJid: "web:a" },
      ]),
    };

    expect(requiresChatScopedDelivery("agent_status")).toBe(true);
    broadcastEvent(channel, "agent_status", { type: "thinking" });
    expect(seen.length).toBe(0);

    for (const client of channel.clients) {
      clearTimeout(client.heartbeat);
    }
  });

  test("broadcastEvent still delivers explicitly global events without chat_jid", () => {
    const seen: Uint8Array[] = [];
    const channel: SseClientContainer = {
      clients: new Set<PendingClient>([
        { controller: { enqueue: (bytes: Uint8Array) => { seen.push(bytes); } } as any, heartbeat: setTimeout(() => {}, 0) as any, chatJid: "web:a" },
      ]),
    };

    expect(requiresChatScopedDelivery("workspace_update")).toBe(false);
    broadcastEvent(channel, "workspace_update", { updates: [] });
    expect(seen.length).toBe(1);

    for (const client of channel.clients) {
      clearTimeout(client.heartbeat);
    }
  });

  test("createAgentProfileBuilder stamps chat_jid onto streamed agent payloads", () => {
    const withProfile = createAgentProfileBuilder("web:branch-a", "Pi");
    const payload = withProfile({ type: "thinking", turn_id: "turn-1" });

    expect(payload.chat_jid).toBe("web:branch-a");
    expect(payload.agent_name).toBe("Pi");
    expect(payload.turn_id).toBe("turn-1");
  });

  test("accepts connection at 49 clients (below cap)", () => {
    const channel: SseClientContainer = {
      clients: new Set<PendingClient>(),
    };
    for (let i = 0; i < 49; i++) {
      channel.clients.add({
        controller: {} as any,
        heartbeat: setTimeout(() => {}, 0) as any,
      });
    }

    const response = handleSse(channel);
    expect(response.status).toBe(200);

    for (const client of channel.clients) {
      clearInterval(client.heartbeat);
      clearTimeout(client.heartbeat);
    }
  });

  test("rejects connection when over capacity (51)", () => {
    const channel: SseClientContainer = {
      clients: new Set<PendingClient>(),
    };
    for (let i = 0; i < 51; i++) {
      channel.clients.add({
        controller: {} as any,
        heartbeat: setTimeout(() => {}, 0) as any,
      });
    }

    const response = handleSse(channel);
    expect(response.status).toBe(503);

    for (const client of channel.clients) {
      clearInterval(client.heartbeat);
      clearTimeout(client.heartbeat);
    }
  });

  test("clears heartbeat interval on client disconnect", async () => {
    const channel: SseClientContainer = {
      clients: new Set<PendingClient>(),
    };

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const intervals: any[] = [];
    const cleared: any[] = [];

    globalThis.setInterval = ((fn: any, ms?: number) => {
      const id = originalSetInterval(fn, ms as any);
      intervals.push(id);
      return id as any;
    }) as typeof setInterval;

    globalThis.clearInterval = ((id: any) => {
      cleared.push(id);
      return originalClearInterval(id);
    }) as typeof clearInterval;

    try {
      const response = handleSse(channel);
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      await reader?.read();
      await reader?.cancel();

      expect(channel.clients.size).toBe(0);
      expect(cleared.length).toBeGreaterThan(0);
      expect(cleared).toContain(intervals[0]);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });
});

// ── CSRF origin checks ──
import { RequestRouterService } from "../../../src/channels/web/request-router-service.js";

describe("CSRF origin checks", () => {
  class StubChannel {
    authGateway = {
      isAuthEnabled: () => false,
      isInternalSecretEnabled: () => false,
      verifyInternalSecret: () => false,
      isAuthenticated: () => false,
    };
    endpointContexts = {
      auth: () => ({
        createTotpContext: () => ({}) as any,
        createWebauthnContext: () => ({}) as any,
        createWebauthnEnrolPageContext: () => ({}) as any,
        serveStatic: async (_relPath: string) => this.json({ ok: false }, 401),
      }),
    };
    handlePost() { return this.json({ ok: true }, 200); }
    clampInt(value: string | null, fallback: number) {
      const parsed = value ? parseInt(value, 10) : fallback;
      return Number.isFinite(parsed) ? parsed : fallback;
    }
    parseOptionalInt(value: string | null) {
      if (!value) return null;
      const parsed = parseInt(value, 10);
      return Number.isNaN(parsed) ? null : parsed;
    }
    json(data: unknown, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  test("blocks mismatched Origin/Host", async () => {
    const router = new RequestRouterService(new StubChannel() as any);
    const req = new Request("http://localhost/post", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        Host: "localhost",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "hello" }),
    });

    const res = await router.handle(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Origin not allowed");
  });

  test("auth-gates /agent/queue-steer before route dispatch", async () => {
    let reached = false;
    class AuthChannel extends StubChannel {
      authGateway = {
        isAuthEnabled: () => true,
        isInternalSecretEnabled: () => false,
        verifyInternalSecret: () => false,
        isAuthenticated: () => false,
      };
      async handleAgentQueueSteer() {
        reached = true;
        return this.json({ ok: true }, 200);
      }
    }

    const router = new RequestRouterService(new AuthChannel() as any);
    const req = new Request("http://localhost/agent/queue-steer", {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        Host: "localhost",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ row_id: 1 }),
    });

    const res = await router.handle(req);
    expect(res.status).toBe(401);
    expect(reached).toBe(false);
  });

  test("auth-gates /agent/active-chats before route dispatch", async () => {
    let reached = false;
    class AuthChannel extends StubChannel {
      authGateway = {
        isAuthEnabled: () => true,
        isInternalSecretEnabled: () => false,
        verifyInternalSecret: () => false,
        isAuthenticated: () => false,
      };
      async handleAgentActiveChats() {
        reached = true;
        return this.json({ ok: true }, 200);
      }
    }

    const router = new RequestRouterService(new AuthChannel() as any);
    const req = new Request("http://localhost/agent/active-chats", {
      method: "GET",
      headers: {
        Host: "localhost",
      },
    });

    const res = await router.handle(req);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
    expect(reached).toBe(false);
  });

  test("auth-gates /agent/branches before route dispatch", async () => {
    let reached = false;
    class AuthChannel extends StubChannel {
      authGateway = {
        isAuthEnabled: () => true,
        isInternalSecretEnabled: () => false,
        verifyInternalSecret: () => false,
        isAuthenticated: () => false,
      };
      async handleAgentBranches() {
        reached = true;
        return this.json({ ok: true }, 200);
      }
    }

    const router = new RequestRouterService(new AuthChannel() as any);
    const req = new Request("http://localhost/agent/branches?root_chat_jid=web:default", {
      method: "GET",
      headers: {
        Host: "localhost",
      },
    });

    const res = await router.handle(req);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
    expect(reached).toBe(false);
  });

  test("auth-gates /agent/branch-fork before route dispatch", async () => {
    let reached = false;
    class AuthChannel extends StubChannel {
      authGateway = {
        isAuthEnabled: () => true,
        isInternalSecretEnabled: () => false,
        verifyInternalSecret: () => false,
        isAuthenticated: () => false,
      };
      async handleAgentBranchFork() {
        reached = true;
        return this.json({ ok: true }, 200);
      }
    }

    const router = new RequestRouterService(new AuthChannel() as any);
    const req = new Request("http://localhost/agent/branch-fork", {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        Host: "localhost",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source_chat_jid: "web:default" }),
    });

    const res = await router.handle(req);
    expect(res.status).toBe(401);
    expect(reached).toBe(false);
  });

  test("auth-gates /agent/branch-rename before route dispatch", async () => {
    let reached = false;
    class AuthChannel extends StubChannel {
      authGateway = {
        isAuthEnabled: () => true,
        isInternalSecretEnabled: () => false,
        verifyInternalSecret: () => false,
        isAuthenticated: () => false,
      };
      async handleAgentBranchRename() {
        reached = true;
        return this.json({ ok: true }, 200);
      }
    }

    const router = new RequestRouterService(new AuthChannel() as any);
    const req = new Request("http://localhost/agent/branch-rename", {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        Host: "localhost",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat_jid: "web:default", agent_name: "renamed" }),
    });

    const res = await router.handle(req);
    expect(res.status).toBe(401);
    expect(reached).toBe(false);
  });

  test("auth-gates /agent/branch-prune before route dispatch", async () => {
    let reached = false;
    class AuthChannel extends StubChannel {
      authGateway = {
        isAuthEnabled: () => true,
        isInternalSecretEnabled: () => false,
        verifyInternalSecret: () => false,
        isAuthenticated: () => false,
      };
      async handleAgentBranchPrune() {
        reached = true;
        return this.json({ ok: true }, 200);
      }
    }

    const router = new RequestRouterService(new AuthChannel() as any);
    const req = new Request("http://localhost/agent/branch-prune", {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        Host: "localhost",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat_jid: "web:default:branch:1" }),
    });

    const res = await router.handle(req);
    expect(res.status).toBe(401);
    expect(reached).toBe(false);
  });

  test("auth-gates /agent/peer-message before route dispatch", async () => {
    let reached = false;
    class AuthChannel extends StubChannel {
      authGateway = {
        isAuthEnabled: () => true,
        isInternalSecretEnabled: () => false,
        verifyInternalSecret: () => false,
        isAuthenticated: () => false,
      };
      async handleAgentPeerMessage() {
        reached = true;
        return this.json({ ok: true }, 200);
      }
    }

    const router = new RequestRouterService(new AuthChannel() as any);
    const req = new Request("http://localhost/agent/peer-message", {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        Host: "localhost",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source_chat_jid: "web:a", target_chat_jid: "web:b", content: "hello" }),
    });

    const res = await router.handle(req);
    expect(res.status).toBe(401);
    expect(reached).toBe(false);
  });

  test("allows matching Origin/Host/Protocol", async () => {
    const router = new RequestRouterService(new StubChannel() as any);
    const req = new Request("http://example.com/post", {
      method: "POST",
      headers: {
        Origin: "http://example.com",
        Host: "example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "hello" }),
    });

    const res = await router.handle(req);
    expect(res.status).toBe(200);
  });

  test("blocks mismatched Origin port", async () => {
    const router = new RequestRouterService(new StubChannel() as any);
    const req = new Request("https://example.com/post", {
      method: "POST",
      headers: {
        Origin: "https://example.com:8443",
        Host: "example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "hello" }),
    });

    const res = await router.handle(req);
    expect(res.status).toBe(403);
  });
});

// ── Security headers ──

describe("security headers", () => {
  test("expected header names are defined", () => {
    // Verify the security header names we expect
    const expectedHeaders = [
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Content-Security-Policy",
    ];
    expect(expectedHeaders.length).toBe(5);
  });

  test("CSP and security headers are present on real responses", async () => {
    class StubChannel {
      authGateway = {
        isAuthEnabled: () => false,
        isInternalSecretEnabled: () => false,
        verifyInternalSecret: () => false,
        isAuthenticated: () => false,
      };
      endpointContexts = {
        auth: () => ({
          createTotpContext: () => ({}) as any,
          createWebauthnContext: () => ({}) as any,
          createWebauthnEnrolPageContext: () => ({}) as any,
          serveStatic: async (_relPath: string) => this.json({ ok: false }, 401),
        }),
      };
      handleTimeline() { return this.json({ ok: true }, 200); }
      clampInt(value: string | null, fallback: number, _min: number, _max: number) {
        const parsed = value ? parseInt(value, 10) : fallback;
        return Number.isFinite(parsed) ? parsed : fallback;
      }
      parseOptionalInt(value: string | null) {
        if (!value) return null;
        const parsed = parseInt(value, 10);
        return Number.isNaN(parsed) ? null : parsed;
      }
      json(data: unknown, status = 200) {
        return new Response(JSON.stringify(data), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const router = new RequestRouterService(new StubChannel() as any);
    const res = await router.handle(new Request("http://localhost/timeline?limit=1"));

    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("Content-Security-Policy")).toContain("'wasm-unsafe-eval'");
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=");
    expect(res.headers.get("x-request-id")).toMatch(/^req-/);
    expect(res.headers.get("Server-Timing")).toContain("app;dur=");
    expect(res.headers.get("Strict-Transport-Security")).toBe(null);
  });

  test("HSTS header is set on HTTPS responses", async () => {
    class StubChannel {
      authGateway = {
        isAuthEnabled: () => false,
        isInternalSecretEnabled: () => false,
        verifyInternalSecret: () => false,
        isAuthenticated: () => false,
      };
      endpointContexts = {
        auth: () => ({
          createTotpContext: () => ({}) as any,
          createWebauthnContext: () => ({}) as any,
          createWebauthnEnrolPageContext: () => ({}) as any,
          serveStatic: async (_relPath: string) => this.json({ ok: false }, 401),
        }),
      };
      handleTimeline() { return this.json({ ok: true }, 200); }
      clampInt(value: string | null, fallback: number, _min: number, _max: number) {
        const parsed = value ? parseInt(value, 10) : fallback;
        return Number.isFinite(parsed) ? parsed : fallback;
      }
      parseOptionalInt(value: string | null) {
        if (!value) return null;
        const parsed = parseInt(value, 10);
        return Number.isNaN(parsed) ? null : parsed;
      }
      json(data: unknown, status = 200) {
        return new Response(JSON.stringify(data), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const router = new RequestRouterService(new StubChannel() as any);
    const res = await router.handle(new Request("https://localhost/timeline?limit=1"));

    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
  });
});

// ── Media download headers ──
import { handleMedia } from "../../../src/channels/web/handlers/media.js";

describe("media download headers", () => {
  test("non-image downloads use attachment disposition", async () => {
    const ws = getTestWorkspace();
    const restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

    const db = await import("../../../src/db.js");
    db.initDatabase();
    const mediaId = db.createMedia(
      "report.txt",
      "text/plain",
      new TextEncoder().encode("report"),
      null,
      { size: 6 }
    );

    class StubChannel {
      json(data: unknown, status = 200) {
        return new Response(JSON.stringify(data), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const res = handleMedia(new StubChannel() as any, mediaId, false);
    expect(res.headers.get("Content-Disposition")).toBe("attachment");

    restoreEnv();
  });

  test("inline-safe images omit Content-Disposition", async () => {
    const ws = getTestWorkspace();
    const restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

    const db = await import("../../../src/db.js");
    db.initDatabase();
    const mediaId = db.createMedia(
      "vector.svg",
      "image/svg+xml",
      new TextEncoder().encode("<svg></svg>"),
      null,
      { size: 11 }
    );

    class StubChannel {
      json(data: unknown, status = 200) {
        return new Response(JSON.stringify(data), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const res = handleMedia(new StubChannel() as any, mediaId, false);
    expect(res.headers.get("Content-Disposition")).toBeNull();

    restoreEnv();
  });
});
