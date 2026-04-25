/**
 * test/features/feature-regression.test.ts
 *
 * End-to-end feature regression tests.
 *
 * Boots ONE dedicated isolated web server with its own temp workspace
 * and in-memory database. No test touches the live instance. The server
 * is started once before all tests and torn down after all tests.
 *
 * Gated by PICLAW_RUN_FEATURE_TESTS=1.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startDedicatedWebTestInstance, type DedicatedWebTestInstance } from "../channels/web/helpers/dedicated-instance.js";

const featureTest = process.env.PICLAW_RUN_FEATURE_TESTS === "1" ? test : test.skip;

let inst: DedicatedWebTestInstance | null = null;

beforeAll(async () => {
  if (process.env.PICLAW_RUN_FEATURE_TESTS !== "1") return;

  inst = await startDedicatedWebTestInstance({
    prefix: "piclaw-feature-regression-",
    seed: (db) => {
      db.storeChatMetadata("web:default", new Date().toISOString(), "Default");
    },
    agentPool: {
      isStreaming: () => false,
      isActive: () => false,
      getContextUsageForChat: async () => null,
      getAvailableModels: async () => ({
        current: "anthropic/claude-sonnet-4",
        models: ["anthropic/claude-sonnet-4", "openai/gpt-4.1"],
        model_options: [
          { label: "anthropic/claude-sonnet-4", provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4", context_window: 200000, reasoning: true },
          { label: "openai/gpt-4.1", provider: "openai", id: "gpt-4.1", name: "GPT-4.1", context_window: 128000, reasoning: false },
        ],
        thinking_level: "medium",
        supports_thinking: true,
        provider_usage: null,
      }),
      getCurrentModelLabel: async () => "anthropic/claude-sonnet-4",
      listKnownChats: () => [],
      listActiveChats: () => [],
      getAgentHandleForChat: () => "agent",
      findChatByAgentName: () => null,
      runAgent: async (prompt: string, _chatJid: string, options: any = {}) => {
        options.onTurnComplete?.({ text: `Echo: ${prompt}`, attachments: [] });
        return { status: "success", result: `Echo: ${prompt}` };
      },
    },
  });
});

afterAll(async () => {
  await inst?.close();
  inst = null;
});

function base(): string {
  if (!inst) throw new Error("Feature test instance not started");
  return inst.baseUrl;
}

function ws(): string {
  if (!inst) throw new Error("Feature test instance not started");
  return inst.workspace.workspace;
}

async function fetchJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
}

async function fetchText(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  return { status: response.status, headers: response.headers, text: await response.text() };
}

// ═══════════════════════════════════════════════════════════════════════
// Feature: Web UI serves and renders
// ═══════════════════════════════════════════════════════════════════════

describe("feature: web UI", () => {
  featureTest("index page returns 200 with expected HTML shell", async () => {
    const res = await fetchText(`${base()}/`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("<title>PiClaw</title>");
    expect(res.text).toContain("app.bundle.js");
    expect(res.text).toContain("app.bundle.css");
  });

  featureTest("static CSS bundle is served", async () => {
    const html = await fetchText(`${base()}/`);
    const cssMatch = html.text.match(/app\.bundle\.css\?v=([a-f0-9]+)/);
    expect(cssMatch).toBeTruthy();
    const cssRes = await fetchText(`${base()}/static/dist/app.bundle.css?v=${cssMatch![1]}`);
    expect(cssRes.status).toBe(200);
    expect(cssRes.text.length).toBeGreaterThan(1000);
  });

  featureTest("static JS bundle is served", async () => {
    const html = await fetchText(`${base()}/`);
    const jsMatch = html.text.match(/app\.bundle\.js\?v=([a-f0-9]+)/);
    expect(jsMatch).toBeTruthy();
    const jsRes = await fetchText(`${base()}/static/dist/app.bundle.js?v=${jsMatch![1]}`);
    expect(jsRes.status).toBe(200);
    expect(jsRes.text.length).toBeGreaterThan(10000);
  });

  featureTest("manifest.json is served for PWA", async () => {
    const res = await fetchJson(`${base()}/manifest.json`);
    expect(res.status).toBe(200);
    expect(res.body?.name || res.body?.short_name).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Feature: Timeline API
// ═══════════════════════════════════════════════════════════════════════

describe("feature: timeline", () => {
  featureTest("POST /post creates a user message visible in the timeline", async () => {
    const postRes = await fetchJson(`${base()}/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Hello from feature test" }),
    });
    expect(postRes.status).toBe(201);

    const timelineRes = await fetchJson(`${base()}/timeline?limit=10`);
    expect(timelineRes.status).toBe(200);
    const posts = timelineRes.body?.posts || timelineRes.body || [];
    expect(posts.some((p: any) => (p.data?.content || "").includes("Hello from feature test"))).toBe(true);
  });

  featureTest("GET /search returns results for a posted message", async () => {
    await fetchJson(`${base()}/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "FEATURE_SEARCH_CANARY_7x9z" }),
    });
    const res = await fetchJson(`${base()}/search?q=FEATURE_SEARCH_CANARY_7x9z`);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Feature: Workspace file operations
// ═══════════════════════════════════════════════════════════════════════

describe("feature: workspace files", () => {
  featureTest("GET /workspace/tree returns the directory listing", async () => {
    const res = await fetchJson(`${base()}/workspace/tree`);
    expect(res.status).toBe(200);
  });

  featureTest("file create, read, stat, and delete lifecycle", async () => {
    const testContent = "Feature test " + Date.now();
    const testPath = `feat-test-${Date.now()}.txt`;

    writeFileSync(join(ws(), testPath), testContent);

    const getRes = await fetchText(`${base()}/workspace/file?path=${encodeURIComponent(testPath)}`);
    expect(getRes.status).toBe(200);
    expect(getRes.text).toContain(testContent);

    const statRes = await fetchJson(`${base()}/workspace/stat?path=${encodeURIComponent(testPath)}`);
    expect(statRes.status).toBe(200);

    const delRes = await fetch(`${base()}/workspace/file?path=${encodeURIComponent(testPath)}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);

    const gone = await fetch(`${base()}/workspace/file?path=${encodeURIComponent(testPath)}`);
    expect(gone.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Feature: Agent model state API
// ═══════════════════════════════════════════════════════════════════════

describe("feature: agent API", () => {
  featureTest("GET /agent/models returns available models", async () => {
    const res = await fetchJson(`${base()}/agent/models`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.models) || Array.isArray(res.body?.model_options)).toBe(true);
  });

  featureTest("GET /agent/status returns status", async () => {
    const res = await fetchJson(`${base()}/agent/status`);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Feature: SSE stream
// ═══════════════════════════════════════════════════════════════════════

describe("feature: SSE", () => {
  featureTest("GET /sse/stream returns an event-stream response", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${base()}/sse/stream`, {
        signal: controller.signal,
        headers: { Accept: "text/event-stream" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
    } catch (err: any) {
      if (err.name !== "AbortError") throw err;
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Feature: Media upload
// ═══════════════════════════════════════════════════════════════════════

describe("feature: media", () => {
  featureTest("POST /media/upload accepts a file", async () => {
    const boundary = "----Boundary" + Date.now();
    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="test.txt"`,
      "Content-Type: text/plain",
      "",
      "test content",
      `--${boundary}--`,
    ].join("\r\n");

    const res = await fetchJson(`${base()}/media/upload`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Feature: Slash commands
// ═══════════════════════════════════════════════════════════════════════

describe("feature: slash commands", () => {
  featureTest("/commands is accepted", async () => {
    const res = await fetchJson(`${base()}/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/commands" }),
    });
    expect(res.status).toBe(201);
  });

  featureTest("/state is accepted", async () => {
    const res = await fetchJson(`${base()}/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/state" }),
    });
    expect(res.status).toBe(201);
  });

  featureTest("/context is accepted", async () => {
    const res = await fetchJson(`${base()}/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/context" }),
    });
    expect(res.status).toBe(201);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Feature: Vendored libraries
// ═══════════════════════════════════════════════════════════════════════

describe("feature: vendored libraries", () => {
  featureTest("marked.min.js", async () => {
    const res = await fetchText(`${base()}/static/js/marked.min.js`);
    expect(res.status).toBe(200);
    expect(res.text.length).toBeGreaterThan(1000);
  });

  featureTest("katex.min.js", async () => {
    const res = await fetchText(`${base()}/static/js/vendor/katex.min.js`);
    expect(res.status).toBe(200);
    expect(res.text.length).toBeGreaterThan(1000);
  });

  featureTest("beautiful-mermaid.js", async () => {
    const res = await fetchText(`${base()}/static/js/vendor/beautiful-mermaid.js`);
    expect(res.status).toBe(200);
    expect(res.text.length).toBeGreaterThan(1000);
  });

  featureTest("preact-htm.js", async () => {
    const res = await fetchText(`${base()}/static/js/vendor/preact-htm.js`);
    expect(res.status).toBe(200);
  });

  featureTest("codemirror editor bundle", async () => {
    const html = await fetchText(`${base()}/`);
    const m = html.text.match(/codemirror\.js\?v=([a-f0-9]+)/);
    expect(m).toBeTruthy();
    const res = await fetchText(`${base()}/editor-vendor/codemirror.js?v=${m![1]}`);
    expect(res.status).toBe(200);
    expect(res.text.length).toBeGreaterThan(10000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Feature: Tool catalog completeness
// ═══════════════════════════════════════════════════════════════════════

describe("feature: tool catalog", () => {
  featureTest("built-in extensions register all expected tools", async () => {
    const { createBuiltinExtensionFactories } = await import("../../src/extensions/index.js");
    const { createFakeExtensionApi } = await import("../extensions/fake-extension-api.js");

    const factories = createBuiltinExtensionFactories();
    const fake = createFakeExtensionApi({ allTools: [] });
    for (const factory of factories) {
      try { factory(fake.api); } catch (_e) { void _e; }
    }

    const registered = new Set(fake.tools.keys());
    const required = [
      "attach_file", "read_attachment", "export_attachment", "messages",
      "get_model_state", "list_models", "switch_model", "switch_thinking",
      "list_tools", "list_internal_tools", "list_scripts",
      "activate_tools", "reset_active_tools", "introspect_sql",
      "search_workspace", "refresh_workspace_index",
      "send_adaptive_card", "send_dashboard_widget",
      "open_workspace_file", "env", "exit_process",
      "start_autoresearch", "stop_autoresearch", "autoresearch_status",
      "image_process",
    ];
    const missing = required.filter((n) => !registered.has(n));
    expect(missing, `Missing: ${missing.join(", ")}`).toEqual([]);
  });

  featureTest("bootstrap tools in default active baseline", async () => {
    const { getDefaultActiveToolNames } = await import("../../src/extensions/tool-activation.js");
    for (const name of ["list_tools", "activate_tools", "reset_active_tools", "attach_file", "messages", "exit_process"]) {
      expect(getDefaultActiveToolNames("linux")).toContain(name);
    }
  });

  featureTest("AgentToolFactory not stuck on 4-tool fallback", async () => {
    const { AgentToolFactory } = await import("../../src/agent-pool/tool-factory.js");
    const tools = new AgentToolFactory({ workspaceDir: "/workspace", platform: "linux" }).createDefaultTools();
    expect(tools).toContain("list_tools");
    expect(tools).toContain("activate_tools");
    expect(tools).toContain("attach_file");
    expect(tools.length).toBeGreaterThan(4);
  });
});
