import { describe, expect, test } from "bun:test";
import { getDataRateLimitRule } from "../../../src/channels/web/http/rate-limit-rules.js";
import { getRouteFlags, shouldSkipAuthCheck } from "../../../src/channels/web/http/route-flags.js";

const MUTATING_ROUTE_COVERAGE = [
  { method: "POST", pathname: "/post", coverage: "data/post" },
  { method: "POST", pathname: "/post/reply", coverage: "data/reply" },
  { method: "PATCH", pathname: "/post/123", coverage: "data/post_update" },
  { method: "DELETE", pathname: "/post/123", coverage: "data/delete_post" },
  { method: "POST", pathname: "/internal/post", coverage: "internal-secret" },
  { method: "POST", pathname: "/agent/default/message", coverage: "data/agent_message" },
  { method: "POST", pathname: "/agent/thought/visibility", coverage: "data/agent_ui" },
  { method: "POST", pathname: "/agent/queue-remove", coverage: "data/agent_queue" },
  { method: "POST", pathname: "/agent/queue-steer", coverage: "data/agent_queue" },
  { method: "POST", pathname: "/agent/branch-fork", coverage: "data/agent_branch" },
  { method: "POST", pathname: "/agent/branch-rename", coverage: "data/agent_branch" },
  { method: "POST", pathname: "/agent/branch-prune", coverage: "data/agent_branch" },
  { method: "POST", pathname: "/agent/branch-purge", coverage: "data/agent_branch" },
  { method: "POST", pathname: "/agent/branch-restore", coverage: "data/agent_branch" },
  { method: "POST", pathname: "/agent/peer-message", coverage: "data/agent_peer" },
  { method: "POST", pathname: "/agent/respond", coverage: "data/agent_ui" },
  { method: "POST", pathname: "/agent/card-action", coverage: "data/agent_ui" },
  { method: "POST", pathname: "/agent/tool-abort", coverage: "data/agent_ui" },
  { method: "POST", pathname: "/agent/side-prompt", coverage: "data/agent_side_prompt" },
  { method: "POST", pathname: "/agent/side-prompt/stream", coverage: "data/agent_side_prompt" },
  { method: "POST", pathname: "/agent/whitelist", coverage: "deprecated-noop" },
  { method: "POST", pathname: "/workspace/attach", coverage: "data/workspace_attach" },
  { method: "POST", pathname: "/workspace/upload", coverage: "data/workspace_upload" },
  { method: "POST", pathname: "/workspace/upload-chunk", coverage: "data/workspace_upload_chunk" },
  { method: "POST", pathname: "/workspace/file", coverage: "data/write" },
  { method: "PUT", pathname: "/workspace/file", coverage: "data/write" },
  { method: "DELETE", pathname: "/workspace/file", coverage: "data/write" },
  { method: "POST", pathname: "/workspace/rename", coverage: "data/write" },
  { method: "POST", pathname: "/workspace/move", coverage: "data/write" },
  { method: "POST", pathname: "/workspace/visibility", coverage: "data/workspace_ui" },
  { method: "POST", pathname: "/workspace/reindex", coverage: "data/workspace_ui" },
  { method: "POST", pathname: "/media/upload", coverage: "data/media_upload" },
  { method: "POST", pathname: "/auth/verify", coverage: "auth-rate-limit" },
  { method: "POST", pathname: "/auth/webauthn/login/start", coverage: "auth-rate-limit" },
  { method: "POST", pathname: "/auth/webauthn/login/finish", coverage: "auth-rate-limit" },
  { method: "POST", pathname: "/auth/webauthn/register/start", coverage: "enrol-rate-limit" },
  { method: "POST", pathname: "/auth/webauthn/register/finish", coverage: "enrol-rate-limit" },
] as const;

describe("web http route classification", () => {
  test("classifies auth endpoints and static/public assets", () => {
    const authReq = new Request("https://example.com/auth/verify", { method: "POST" });
    const authFlags = getRouteFlags(authReq, "/auth/verify");
    expect(authFlags.isAuthVerify).toBe(true);
    expect(authFlags.isAuthEndpoint).toBe(true);
    expect(authFlags.isMutating).toBe(true);

    const staticReq = new Request("https://example.com/static/common/dist/login.bundle.js", { method: "GET" });
    const staticFlags = getRouteFlags(staticReq, "/static/common/dist/login.bundle.js");
    expect(staticFlags.isStaticAsset).toBe(true);
    expect(staticFlags.isPublicStatic).toBe(true);
    expect(shouldSkipAuthCheck(staticFlags, false)).toBe(true);
  });

  test("classifies favicon/apple and non-public assets correctly", () => {
    const faviconReq = new Request("https://example.com/favicon.ico", { method: "GET" });
    const faviconFlags = getRouteFlags(faviconReq, "/favicon.ico");
    expect(faviconFlags.isFavicon).toBe(true);
    expect(shouldSkipAuthCheck(faviconFlags, false)).toBe(true);

    const appReq = new Request("https://example.com/static/classic/dist/app.bundle.js", { method: "GET" });
    const appFlags = getRouteFlags(appReq, "/static/classic/dist/app.bundle.js");
    expect(appFlags.isStaticAsset).toBe(true);
    expect(appFlags.isPublicStatic).toBe(false);
    expect(shouldSkipAuthCheck(appFlags, false)).toBe(false);
  });

  test("maps data rate-limit rules by method and pathname", () => {
    expect(getDataRateLimitRule("POST", "/post")?.bucket).toBe("data/post");
    expect(getDataRateLimitRule("POST", "/post/reply")?.bucket).toBe("data/reply");
    expect(getDataRateLimitRule("PATCH", "/post/123")?.bucket).toBe("data/post_update");
    expect(getDataRateLimitRule("POST", "/agent/abc/message")?.bucket).toBe("data/agent_message");
    expect(getDataRateLimitRule("POST", "/agent/queue-remove")?.bucket).toBe("data/agent_queue");
    expect(getDataRateLimitRule("POST", "/agent/queue-steer")?.bucket).toBe("data/agent_queue");
    expect(getDataRateLimitRule("POST", "/agent/branch-fork")?.bucket).toBe("data/agent_branch");
    expect(getDataRateLimitRule("POST", "/agent/branch-rename")?.bucket).toBe("data/agent_branch");
    expect(getDataRateLimitRule("POST", "/agent/branch-prune")?.bucket).toBe("data/agent_branch");
    expect(getDataRateLimitRule("POST", "/agent/branch-purge")?.bucket).toBe("data/agent_branch");
    expect(getDataRateLimitRule("POST", "/agent/branch-restore")?.bucket).toBe("data/agent_branch");
    expect(getDataRateLimitRule("POST", "/agent/peer-message")?.bucket).toBe("data/agent_peer");
    expect(getDataRateLimitRule("POST", "/agent/thought/visibility")?.bucket).toBe("data/agent_ui");
    expect(getDataRateLimitRule("POST", "/agent/respond")?.bucket).toBe("data/agent_ui");
    expect(getDataRateLimitRule("POST", "/agent/card-action")?.bucket).toBe("data/agent_ui");
    expect(getDataRateLimitRule("POST", "/agent/tool-abort")?.bucket).toBe("data/agent_ui");
    expect(getDataRateLimitRule("POST", "/agent/side-prompt")?.bucket).toBe("data/agent_side_prompt");
    expect(getDataRateLimitRule("POST", "/agent/side-prompt/stream")?.bucket).toBe("data/agent_side_prompt");
    expect(getDataRateLimitRule("POST", "/workspace/attach")?.bucket).toBe("data/workspace_attach");
    expect(getDataRateLimitRule("POST", "/workspace/upload-chunk")?.bucket).toBe("data/workspace_upload_chunk");
    expect(getDataRateLimitRule("POST", "/workspace/visibility")?.bucket).toBe("data/workspace_ui");
    expect(getDataRateLimitRule("POST", "/workspace/reindex")?.bucket).toBe("data/workspace_ui");
    expect(getDataRateLimitRule("DELETE", "/workspace/file")?.bucket).toBe("data/write");
    expect(getDataRateLimitRule("PUT", "/workspace/file")?.bucket).toBe("data/write");
    expect(getDataRateLimitRule("GET", "/workspace/file")).toBeNull();
  });

  test("documents coverage for all known mutating web routes", () => {
    for (const route of MUTATING_ROUTE_COVERAGE) {
      const rule = getDataRateLimitRule(route.method, route.pathname);
      if (route.coverage.startsWith("data/")) {
        expect(rule?.bucket).toBe(route.coverage);
        continue;
      }
      expect(rule).toBeNull();
      const flags = getRouteFlags(new Request(`https://example.com${route.pathname}`, { method: route.method }), route.pathname);
      if (route.coverage === "auth-rate-limit" || route.coverage === "enrol-rate-limit") {
        expect(flags.isAuthEndpoint || flags.isWebauthnEnrollPage).toBe(true);
      }
      if (route.coverage === "internal-secret") {
        expect(flags.isInternalPost).toBe(true);
      }
      if (route.coverage === "deprecated-noop") {
        expect(route.pathname).toBe("/agent/whitelist");
      }
    }
  });
});
