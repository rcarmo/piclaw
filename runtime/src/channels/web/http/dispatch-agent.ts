/**
 * web/http/dispatch-agent.ts – Agent route dispatch helpers.
 */

import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import {
  handleWebPushSubscriptionDelete,
  handleWebPushSubscriptionUpsert,
  handleWebPushVapidPublicKey,
} from "../push/web-push-routes.js";

const log = createLogger("web.dispatch-agent");

interface ExactAgentRoute {
  method: string;
  path: string;
  handle: (channel: WebChannelLike, req: Request, url: URL) => Response | Promise<Response>;
}

const EXACT_AGENT_ROUTES: ExactAgentRoute[] = [
  {
    method: "GET",
    path: "/agent/thought",
    handle: (channel, _req, url) => {
      const turnId = url.searchParams.get("turn_id");
      const panel = url.searchParams.get("panel");
      return channel.handleThought(panel, turnId);
    },
  },
  {
    method: "POST",
    path: "/agent/thought/visibility",
    handle: (channel, req) => channel.handleThoughtVisibility(req),
  },
  {
    method: "GET",
    path: "/agent/roster",
    handle: (channel) => channel.handleAgents(),
  },
  {
    method: "GET",
    path: "/agent/status",
    handle: (channel, req) => channel.handleAgentStatus(req),
  },
  {
    method: "GET",
    path: "/agent/context",
    handle: (channel, req) => channel.handleAgentContext(req),
  },
  {
    method: "GET",
    path: "/agent/debug",
    handle: (channel, req) => channel.handleAgentDebug(req),
  },
  {
    method: "GET",
    path: "/agent/autoresearch/status",
    handle: (channel, req) => channel.handleAutoresearchStatus(req),
  },
  {
    method: "POST",
    path: "/agent/autoresearch/stop",
    handle: (channel, req) => channel.handleAutoresearchStop(req),
  },
  {
    method: "POST",
    path: "/agent/autoresearch/dismiss",
    handle: (channel, req) => channel.handleAutoresearchDismiss(req),
  },
  {
    method: "POST" as const,
    path: "/agent/codex/dismiss",
    handle: async (_channel: any, req: Request) => {
      try {
        let taskId = "";
        let chatJid = "web:default";
        try {
          const body = await req.json();
          if (typeof body?.key === "string") taskId = body.key.replace("codex.dismiss.", "");
          if (typeof body?.chat_jid === "string" && body.chat_jid.trim()) chatJid = body.chat_jid.trim();
        } catch (error) {
          debugSuppressedError(log, "Failed to parse codex dismiss payload; using default values.", error);
        }
        if (taskId) {
          try {
            const { existsSync, readFileSync } = await import("node:fs");
            const { join } = await import("node:path");
            const metaPath = join("/workspace/.piclaw/data/extensions/codex-delegate/tasks", taskId, "task.json");
            if (existsSync(metaPath)) {
              const meta = JSON.parse(readFileSync(metaPath, "utf8"));
              if (typeof meta?.chat_jid === "string" && meta.chat_jid.trim()) chatJid = meta.chat_jid.trim();
            }
          } catch (error) {
            debugSuppressedError(log, "Failed to read codex task metadata while dismissing the widget.", error, { taskId });
          }
        }
        const broadcast = (globalThis as any).__PICLAW_BROADCAST_EVENT__;
        if (typeof broadcast === "function") {
          const wkey = taskId ? `codex-${taskId}` : "codex-delegate";
          broadcast("extension_ui_widget", { chat_jid: chatJid, key: wkey, content: [], options: { surface: "status-panel", remove: true } });
        }
        return Response.json({ ok: true });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
      }
    },
  },
  {
    method: "POST" as const,
    path: "/agent/codex/stop",
    handle: async (_channel: any, req: Request) => {
      try {
        let taskId = "";
        let chatJid = "web:default";
        try {
          const body = await req.json();
          if (typeof body?.key === "string") taskId = body.key.replace("codex.stop.", "");
          if (typeof body?.chat_jid === "string" && body.chat_jid.trim()) chatJid = body.chat_jid.trim();
        } catch (error) {
          debugSuppressedError(log, "Failed to parse codex stop payload; using default values.", error);
        }
        const { spawnSync } = await import("node:child_process");
        const { accessSync, constants, existsSync, readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const searchPath = [
          ...(process.env.PATH || "").split(":"),
          "/run/current-system/sw/bin",
          "/etc/profiles/per-user/agent/bin",
          "/home/agent/.nix-profile/bin",
          "/nix/profile/bin",
          "/home/agent/.local/bin",
          "/home/agent/.bun/bin",
        ].filter(Boolean);
        let tmuxBin = "tmux";
        for (const dir of searchPath) {
          const candidate = `${dir}/tmux`;
          try {
            accessSync(candidate, constants.X_OK);
            tmuxBin = candidate;
            break;
          } catch (error) {
            debugSuppressedError(log, "Candidate tmux binary unavailable while stopping codex session; trying next path.", error, {
              candidate,
              taskId,
            });
          }
        }
        const env = { ...process.env, PATH: Array.from(new Set(searchPath)).join(":") };
        const tmuxSession = "codex-" + taskId;
        spawnSync(tmuxBin, ["send-keys", "-t", tmuxSession, "C-c", ""], { stdio: "ignore", env });
        setTimeout(() => spawnSync(tmuxBin, ["kill-session", "-t", tmuxSession], { stdio: "ignore", env }), 2000);
        if (taskId) {
          try {
            const metaPath = join("/workspace/.piclaw/data/extensions/codex-delegate/tasks", taskId, "task.json");
            if (existsSync(metaPath)) {
              const meta = JSON.parse(readFileSync(metaPath, "utf8"));
              if (typeof meta?.chat_jid === "string" && meta.chat_jid.trim()) chatJid = meta.chat_jid.trim();
            }
          } catch (error) {
            debugSuppressedError(log, "Failed to read codex task metadata while stopping the widget.", error, { taskId });
          }
        }
        const broadcast = (globalThis as any).__PICLAW_BROADCAST_EVENT__;
        if (typeof broadcast === "function") {
          const wkey = "codex-" + taskId;
          broadcast("extension_ui_widget", { chat_jid: chatJid, key: wkey, content: [], options: { surface: "status-panel", remove: true } });
        }
        return Response.json({ ok: true });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
      }
    },
  },
  {
    method: "GET",
    path: "/agent/queue-state",
    handle: (channel, req) => channel.handleAgentQueueState(req),
  },
  {
    method: "POST",
    path: "/agent/queue-remove",
    handle: (channel, req) => channel.handleAgentQueueRemove(req),
  },
  {
    method: "POST",
    path: "/agent/queue-steer",
    handle: (channel, req) => channel.handleAgentQueueSteer(req),
  },
  {
    method: "GET",
    path: "/agent/session-tree",
    handle: (channel, req) => channel.handleSessionTree(req),
  },
  {
    method: "GET",
    path: "/agent/system-metrics",
    handle: (channel, req) => channel.handleSystemMetrics(req),
  },
  {
    method: "GET",
    path: "/agent/models",
    handle: (channel, req) => channel.handleAgentModels(req),
  },
  {
    method: "GET",
    path: "/agent/active-chats",
    handle: (channel, req) => channel.handleAgentActiveChats(req),
  },
  {
    method: "GET",
    path: "/agent/branches",
    handle: (channel, req) => channel.handleAgentBranches(req),
  },
  {
    method: "POST",
    path: "/agent/branch-fork",
    handle: (channel, req) => channel.handleAgentBranchFork(req),
  },
  {
    method: "POST",
    path: "/agent/branch-rename",
    handle: (channel, req) => channel.handleAgentBranchRename(req),
  },
  {
    method: "POST",
    path: "/agent/branch-prune",
    handle: (channel, req) => channel.handleAgentBranchPrune(req),
  },
  {
    method: "POST",
    path: "/agent/branch-restore",
    handle: (channel, req) => channel.handleAgentBranchRestore(req),
  },
  {
    method: "POST",
    path: "/agent/peer-message",
    handle: (channel, req) => channel.handleAgentPeerMessage(req),
  },
  {
    method: "POST",
    path: "/agent/respond",
    handle: (channel, req) => channel.handleAgentRespond(req),
  },
  {
    method: "POST",
    path: "/agent/card-action",
    handle: (channel, req) => channel.handleAdaptiveCardAction(req),
  },
  {
    method: "GET",
    path: "/agent/push/vapid-public-key",
    handle: () => handleWebPushVapidPublicKey(),
  },
  {
    method: "POST",
    path: "/agent/push/subscription",
    handle: (_channel, req) => handleWebPushSubscriptionUpsert(req),
  },
  {
    method: "DELETE",
    path: "/agent/push/subscription",
    handle: (_channel, req) => handleWebPushSubscriptionDelete(req),
  },
  {
    method: "POST",
    path: "/agent/side-prompt",
    handle: (channel, req) => channel.handleAgentSidePrompt(req),
  },
  {
    method: "POST",
    path: "/agent/side-prompt/stream",
    handle: (channel, req) => channel.handleAgentSidePromptStream(req),
  },
  {
    method: "POST",
    path: "/agent/whitelist",
    handle: (channel) => channel.json({ error: "Not found" }, 404),
  },
];

/**
 * Dispatch known `/agent/...` routes and return null when the path should fall through.
 * @param channel Web channel contract exposing agent route handlers.
 * @param req Incoming HTTP request.
 * @param pathname Parsed request pathname used for exact route matching.
 * @param url Parsed request URL used by handlers that consume query params.
 * @returns The matched route response, or null when no `/agent` route applies.
 */
export async function handleAgentRoutes(
  channel: WebChannelLike,
  req: Request,
  pathname: string,
  url: URL
): Promise<Response | null> {
  if (req.method === "POST" && pathname.startsWith("/agent/") && pathname.endsWith("/message")) {
    return await channel.handleAgentMessage(req, pathname);
  }

  const route = EXACT_AGENT_ROUTES.find((candidate) => candidate.method === req.method && candidate.path === pathname);
  return route ? await route.handle(channel, req, url) : null;
}
