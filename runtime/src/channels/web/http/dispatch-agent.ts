/**
 * web/http/dispatch-agent.ts – Agent route dispatch helpers.
 */

import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { PICLAW_CONFIG_PATH } from "../../../core/config.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { THEME_PRESETS, THEME_LIST_COLOR_KEYS } from "../theming/ui-theme-data.js";
import { TOOLSETS } from "../../../extensions/tool-activation.js";
import { getToolCapability } from "../../../extensions/tool-capabilities.js";
import {
  handleAddonAssetRequest,
  handleGetAddons,
  handleGetAddonWebEntries,
  handleInstallAddon,
  handleRestartAddonRuntime,
  handleUninstallAddon,
} from "../handlers/addons.js";
import { getGeneralSettingsData, saveGeneralSettings } from "../handlers/general-settings.js";
import {
  handleWebPushPresence,
  handleWebPushSubscriptionDelete,
  handleWebPushSubscriptionUpsert,
  handleWebPushVapidPublicKey,
} from "../push/web-push-routes.js";

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
    path: "/agent/commands",
    handle: (channel, req) => channel.handleAgentCommands(req),
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
    method: "POST",
    path: "/agent/oobe/complete",
    handle: (channel, req) => channel.handleAgentOobeComplete(req),
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
    path: "/agent/queue-reorder",
    handle: (channel, req) => channel.handleAgentQueueReorder(req),
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
    path: "/agent/rename-jid",
    handle: (channel, req) => channel.handleAgentRenameJid(req),
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
    path: "/agent/push/presence",
    handle: (_channel, req) => handleWebPushPresence(req),
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
  {
    method: "GET",
    path: "/agent/settings-data",
    handle: (channel) => {
      const themes = THEME_PRESETS.map((p) => {
        const palette = p.mode === "dark" ? p.dark : p.mode === "light" ? p.light : (p.light || p.dark);
        const colors: Record<string, string> = {};
        if (palette) {
          for (const key of THEME_LIST_COLOR_KEYS) {
            if (palette[key]) colors[key] = palette[key];
          }
        }
        return { name: p.name, label: p.label, mode: p.mode, colors };
      });
      // Read raw config for extra fields
      let rawConfig: Record<string, unknown> = {};
      try {
        if (existsSync(PICLAW_CONFIG_PATH)) {
          rawConfig = JSON.parse(readFileSync(PICLAW_CONFIG_PATH, "utf-8"));
        }
      } catch (e) { /* context usage non-critical — best effort */ void e; }
      const assistantSection = typeof rawConfig.assistant === "object" && rawConfig.assistant ? rawConfig.assistant as Record<string, unknown> : rawConfig;
      const userSection = typeof rawConfig.user === "object" && rawConfig.user ? rawConfig.user as Record<string, unknown> : rawConfig;

      // Read auth state
      const piAgentDir = process.env.PICLAW_PI_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
      let authProviders: Record<string, unknown> = {};
      try {
        const authPath = join(piAgentDir, "auth.json");
        if (existsSync(authPath)) authProviders = JSON.parse(readFileSync(authPath, "utf-8"));
      } catch (e) { /* context usage non-critical — best effort */ void e; }

      const providerDefs = [
        { id: "anthropic", name: "Anthropic", hasOAuth: true, hasApiKey: true, apiKeyHint: "sk-ant-..." },
        { id: "github-copilot", name: "GitHub Copilot", hasOAuth: true, hasApiKey: false },
        { id: "google-gemini-cli", name: "Google Gemini CLI", hasOAuth: true, hasApiKey: true, apiKeyHint: "AIza..." },
        { id: "antigravity", name: "Antigravity (Google Cloud)", hasOAuth: true, hasApiKey: false },
        { id: "openai-codex", name: "OpenAI Codex", hasOAuth: true, hasApiKey: false },
        { id: "openai", name: "OpenAI", hasOAuth: false, hasApiKey: true, apiKeyHint: "sk-proj-..." },
        { id: "opencode", name: "OpenCode", hasOAuth: false, hasApiKey: true, apiKeyHint: "OPENCODE_API_KEY" },
        {
          id: "azure-openai", name: "Azure OpenAI", hasOAuth: false, hasApiKey: false, isCustom: true,
          customFields: [
            { key: "baseUrl", label: "Base URL", placeholder: "https://myresource.openai.azure.com/openai/v1", required: true },
            { key: "apiKey", label: "API Key (or empty for managed identity)", placeholder: "Bearer ...", required: false },
            { key: "modelId", label: "Model ID", placeholder: "gpt-4o", required: true },
            { key: "modelIds", label: "Additional model IDs (comma-separated)", placeholder: "gpt-4o,o3-mini", required: false },
          ],
        },
        {
          id: "ollama", name: "Ollama", hasOAuth: false, hasApiKey: false, isCustom: true,
          customFields: [
            { key: "baseUrl", label: "Base URL", placeholder: "http://192.168.1.100:11434/v1", required: true },
            { key: "modelId", label: "Model ID", placeholder: "llama3:latest", required: true },
            { key: "modelIds", label: "Additional model IDs (comma-separated)", placeholder: "qwen3:latest", required: false },
            { key: "contextWindow", label: "Context window", placeholder: "128000", required: false },
          ],
        },
        {
          id: "openai-compatible", name: "OpenAI-compatible", hasOAuth: false, hasApiKey: false, isCustom: true,
          customFields: [
            { key: "baseUrl", label: "Base URL", placeholder: "https://api.example.com/v1", required: true },
            { key: "apiKey", label: "API Key", placeholder: "sk-...", required: true },
            { key: "modelId", label: "Model ID", placeholder: "gpt-4o", required: true },
            { key: "modelIds", label: "Additional model IDs (comma-separated)", placeholder: "model-a,model-b", required: false },
            { key: "contextWindow", label: "Context window", placeholder: "128000", required: false },
          ],
        },
      ];

      const providers = providerDefs.map((p) => {
        const auth = authProviders[p.id];
        const configured = Boolean(auth);
        const authType = typeof (auth as Record<string, unknown>)?.type === "string" ? (auth as Record<string, unknown>).type : null;
        return { ...p, configured, authType };
      });

      return channel.json({
        ...getGeneralSettingsData(),
        providers,
        themes,
        colorKeys: [...THEME_LIST_COLOR_KEYS],
        toolsets: TOOLSETS.map((ts) => ({
          name: ts.name,
          description: ts.description,
          tools: ts.toolNames.map((tn) => {
            const cap = getToolCapability(tn);
            return { name: tn, kind: cap.kind, weight: cap.weight, summary: cap.summary };
          }),
        })),
      });
    },
  },
  {
    method: "GET",
    path: "/agent/addons",
    handle: (channel, req, url) => handleGetAddons((body, status) => channel.json(body, status), url),
  },
  {
    method: "GET",
    path: "/agent/addons/web-entries",
    handle: (channel) => handleGetAddonWebEntries((body, status) => channel.json(body, status)),
  },
  {
    method: "POST",
    path: "/agent/addons/install",
    handle: (channel, req, url) => handleInstallAddon(req, (body, status) => channel.json(body, status), url),
  },
  {
    method: "POST",
    path: "/agent/addons/restart",
    handle: (channel) => handleRestartAddonRuntime((body, status) => channel.json(body, status)),
  },
  {
    method: "POST",
    path: "/agent/addons/uninstall",
    handle: (channel, req, url) => handleUninstallAddon(req, (body, status) => channel.json(body, status), url),
  },
  {
    method: "POST",
    path: "/agent/settings/general",
    handle: async (channel, req) => {
      try {
        const body = await req.json().catch(() => ({}));
        const saved = await saveGeneralSettings((body && typeof body === "object") ? body as Record<string, unknown> : {});
        return channel.json({ ok: true, settings: saved });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return channel.json({ error: message || "Failed to save general settings." }, 400);
      }
    },
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

  if ((req.method === "GET" || req.method === "HEAD") && pathname.startsWith("/agent/addons/assets/")) {
    return await handleAddonAssetRequest(req, pathname);
  }

  const route = EXACT_AGENT_ROUTES.find((candidate) => candidate.method === req.method && candidate.path === pathname);
  return route ? await route.handle(channel, req, url) : null;
}
