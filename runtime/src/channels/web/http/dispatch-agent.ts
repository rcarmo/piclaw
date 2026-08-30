/**
 * web/http/dispatch-agent.ts – Agent route dispatch helpers.
 */

import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getVersion } from "../../../cli.js";
import { getPiclawAgentDir } from "../../../core/agent-dir.js";
import { THEME_PRESETS, THEME_LIST_COLOR_KEYS } from "../theming/ui-theme-data.js";
import { TOOLSETS } from "../../../extensions/tool-activation.js";
import { getToolCapability } from "../../../extensions/tool-capabilities.js";
import {
  handleAddonAssetRequest,
  handleAddonConfigApiRequest,
  handleGetAddons,
  handleGetAddonWebEntries,
  handleInstallAddon,
  handleRestartAddonRuntime,
  handleUninstallAddon,
} from "../handlers/addons.js";
import { getCompactionSettingsData, resetCompactionBackoff, saveCompactionSettings } from "../handlers/compaction-settings.js";
import {
  buildGeneralSettingsProfileUpdate,
  getGeneralSettingsData,
  rotateWidgetTokenSettings,
  saveGeneralSettings,
} from "../handlers/general-settings.js";
import { getQuickActionsSettingsData, saveQuickActionsSettings } from "../handlers/quick-actions-settings.js";
import { handleScheduledTasksManagementAction, handleScheduledTasksManagementList } from "../handlers/scheduled-tasks-management.js";
import { getWorkspaceSettingsData, saveWorkspaceSettings } from "../handlers/workspace-settings.js";
import { getServerUiState, setServerUiMetersConfig, setServerUiOutputConfig, setServerUiThemeConfig } from "../ui-state.js";
import {
  clearEnvironmentOverride,
  getEnvironmentSettingsData,
  setEnvironmentOverride,
} from "../../../environment-overrides.js";
import { getProviderDefs } from "../../../agent-control/provider-defs.js";
import {
  listKeychainEntriesForUi,
  getKeychainEntry,
  setKeychainEntry,
  deleteKeychainEntry,
  listInjectableKeychainEntries,
  updateKeychainEntryNotes,
  type KeychainEntryUiMetadata,
} from "../../../secure/keychain.js";
import {
  handleWebPushPresence,
  handleWebPushSubscriptionDelete,
  handleWebPushSubscriptionUpsert,
  handleWebPushVapidPublicKey,
} from "../push/web-push-routes.js";
import { getThinkingContentForChat } from "../../../db/messages.js";
import { readKeychainBootstrapKeyMaterial } from "../../../core/config.js";

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
    path: "/agent/thinking",
    handle: (_channel, _req, url) => {
      const messageId = url.searchParams.get("message_id");
      const chatJid = url.searchParams.get("chat_jid");
      if (!messageId || !chatJid) {
        return new Response(JSON.stringify({ error: "Missing message_id or chat_jid" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Single validated lookup: message must exist in chat_jid, be a bot
      // reply, and carry a thinking_ref content block. 404 is returned
      // uniformly for any failure to avoid distinguishing why (no
      // enumeration oracle for message_ids across chats).
      const result = getThinkingContentForChat(chatJid, messageId);
      if (!result) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    },
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
    method: "GET",
    path: "/agent/runs",
    handle: (channel, req) => channel.handleAgentRuns(req),
  },
  {
    method: "POST",
    path: "/agent/runs/abort",
    handle: (channel, req) => channel.handleAgentRunAbort(req),
  },
  {
    method: "POST",
    path: "/agent/runs/clear-stale",
    handle: (channel, req) => channel.handleAgentRunClearStale(req),
  },
  {
    method: "POST",
    path: "/agent/runs/drain-queue",
    handle: (channel, req) => channel.handleAgentRunDrainQueue(req),
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
    path: "/agent/system-metrics",
    handle: (channel, req) => channel.handleSystemMetrics(req),
  },
  {
    method: "GET",
    path: "/agent/scheduled-tasks",
    handle: (channel, req, url) => handleScheduledTasksManagementList(channel, req, url),
  },
  {
    method: "POST",
    path: "/agent/scheduled-tasks/action",
    handle: (channel, req) => handleScheduledTasksManagementAction(channel, req),
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
    path: "/agent/root-session",
    handle: (channel, req) => channel.handleAgentRootSessionCreate(req),
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
    path: "/agent/branch-merge-parent",
    handle: (channel, req) => channel.handleAgentBranchMergeParent(req),
  },
  {
    method: "POST",
    path: "/agent/branch-prune",
    handle: (channel, req) => channel.handleAgentBranchPrune(req),
  },
  {
    method: "GET",
    path: "/agent/branch-download",
    handle: (channel, req) => channel.handleAgentBranchDownload(req),
  },
  {
    method: "POST",
    path: "/agent/branch-purge",
    handle: (channel, req) => channel.handleAgentBranchPurge(req),
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
    path: "/agent/settings/quick-actions",
    handle: (channel) => channel.json({ ok: true, settings: getQuickActionsSettingsData() }, 200),
  },
  {
    method: "POST",
    path: "/agent/settings/quick-actions",
    handle: async (channel, req) => {
      const body = await req.json().catch(() => ({}));
      const settings = saveQuickActionsSettings(body || {});
      return channel.json({ ok: true, settings }, 200);
    },
  },
  {
    method: "GET",
    path: "/agent/ui-state",
    handle: (channel) => channel.json({ ok: true, ...getServerUiState() }, 200),
  },
  {
    method: "POST",
    path: "/agent/ui-state",
    handle: async (channel, req) => {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const response: Record<string, unknown> = { ok: true };
      if (body?.ui_theme && typeof body.ui_theme === "object") {
        const themeBody = body.ui_theme as Record<string, unknown>;
        const nextTheme = setServerUiThemeConfig({
          ...(typeof themeBody.theme === "string" ? { theme: themeBody.theme } : {}),
          ...(themeBody.tint !== undefined ? { tint: typeof themeBody.tint === "string" ? themeBody.tint : null } : {}),
        });
        response.ui_theme = nextTheme;
        channel.broadcastEvent("ui_theme", { ...nextTheme });
      }
      if (body?.ui_meters && typeof body.ui_meters === "object") {
        const metersBody = body.ui_meters as Record<string, unknown>;
        const nextMeters = setServerUiMetersConfig({
          ...(typeof metersBody.enabled === "boolean" ? { enabled: metersBody.enabled } : {}),
          ...(typeof metersBody.collapsed === "boolean" ? { collapsed: metersBody.collapsed } : {}),
        });
        response.ui_meters = nextMeters;
        channel.broadcastEvent("ui_meters", { mode: "set", ...nextMeters });
      }
      if (body?.ui_output && typeof body.ui_output === "object") {
        const outputBody = body.ui_output as Record<string, unknown>;
        const parsedPad = Number(outputBody.outputPad ?? outputBody.output_pad);
        const nextOutput = setServerUiOutputConfig({
          ...(Number.isFinite(parsedPad) ? { outputPad: parsedPad } : {}),
        });
        response.ui_output = nextOutput;
        channel.broadcastEvent("ui_theme", { outputPad: nextOutput.outputPad });
      }
      return channel.json(response, 200);
    },
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
      // Read auth + custom provider state
      const piAgentDir = getPiclawAgentDir();
      let authProviders: Record<string, unknown> = {};
      try {
        const authPath = join(piAgentDir, "auth.json");
        if (existsSync(authPath)) authProviders = JSON.parse(readFileSync(authPath, "utf-8"));
      } catch (e) { /* context usage non-critical — best effort */ void e; }
      let modelProviders: Record<string, unknown> = {};
      try {
        const modelsPath = join(piAgentDir, "models.json");
        if (existsSync(modelsPath)) {
          const parsed = JSON.parse(readFileSync(modelsPath, "utf-8")) as { providers?: Record<string, unknown> };
          modelProviders = parsed.providers || {};
        }
      } catch (e) { /* context usage non-critical — best effort */ void e; }

      const providers = getProviderDefs().map((p) => {
        const auth = authProviders[p.id] as Record<string, unknown> | undefined;
        const authTypeFromAuth = typeof auth?.type === "string" ? auth.type : null;
        const hasCustomConfig = Boolean(p.isCustom && modelProviders[p.id]);
        const configured = Boolean(authTypeFromAuth) || hasCustomConfig;
        const authType = authTypeFromAuth || (hasCustomConfig ? "custom" : null);
        return { ...p, configured, authType };
      });

      return channel.json({
        ...getGeneralSettingsData(),
        ...getCompactionSettingsData(),
        version: getVersion(),
        quickActions: getQuickActionsSettingsData(),
        workspaceSettings: getWorkspaceSettingsData(),
        environmentSettings: getEnvironmentSettingsData(),
        runtimePlatform: process.platform,
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
        channel.broadcastEvent("ui_theme", { theme: saved.uiTheme, tint: saved.uiTint, outputPad: saved.outputPad });
        channel.broadcastEvent("profile_update", buildGeneralSettingsProfileUpdate(saved));
        return channel.json({ ok: true, settings: saved });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return channel.json({ error: message || "Failed to save general settings." }, 400);
      }
    },
  },
  {
    method: "POST",
    path: "/agent/settings/widget-token/regenerate",
    handle: (channel) => {
      const settings = rotateWidgetTokenSettings();
      return channel.json({ ok: true, settings }, 200);
    },
  },
  {
    method: "POST",
    path: "/agent/settings/workspace",
    handle: async (channel, req) => {
      try {
        const body = await req.json().catch(() => ({}));
        const saved = saveWorkspaceSettings((body && typeof body === "object") ? body as Record<string, unknown> : {});
        return channel.json({ ok: true, settings: saved });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return channel.json({ error: message || "Failed to save workspace settings." }, 400);
      }
    },
  },
  {
    method: "GET",
    path: "/agent/settings/environment",
    handle: (channel) => channel.json({ ok: true, settings: getEnvironmentSettingsData() }, 200),
  },
  {
    method: "POST",
    path: "/agent/settings/environment",
    handle: async (channel, req) => {
      try {
        const body = await req.json().catch(() => ({}));
        const payload = (body && typeof body === "object") ? body as Record<string, unknown> : {};
        const action = typeof payload.action === "string" ? payload.action.trim().toLowerCase() : "set";
        const saved = action === "clear"
          ? clearEnvironmentOverride(payload.name)
          : setEnvironmentOverride(payload.name, payload.value);
        return channel.json({ ok: true, settings: saved }, 200);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return channel.json({ error: message || "Failed to save environment override." }, 400);
      }
    },
  },
  {
    method: "POST",
    path: "/agent/settings/compaction",
    handle: async (channel, req) => {
      try {
        const body = await req.json().catch(() => ({}));
        const saved = await saveCompactionSettings((body && typeof body === "object") ? body as Record<string, unknown> : {});
        return channel.json({ ok: true, settings: saved });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return channel.json({ error: message || "Failed to save compaction settings." }, 400);
      }
    },
  },
  {
    method: "POST",
    path: "/agent/settings/compaction/probe",
    handle: async (channel, req) => {
      try {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const model = typeof body.model === "string" ? body.model.trim() : "";
        if (!model) return channel.json({ error: "Provide an exact provider/model compaction model." }, 400);
        const result = await channel.agentPool.probeCompactionModel(model);
        return channel.json(result, result.ok ? 200 : 422);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return channel.json({ error: message || "Compaction model probe failed." }, 400);
      }
    },
  },
  {
    method: "POST",
    path: "/agent/settings/compaction/reset-backoff",
    handle: async (channel, req) => {
      try {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const chatJid = typeof body.chatJid === "string" ? body.chatJid.trim() : "";
        if (!chatJid) {
          return channel.json({ error: "Provide chatJid." }, 400);
        }
        return channel.json({ ok: true, settings: resetCompactionBackoff(chatJid) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return channel.json({ error: message || "Failed to reset compaction backoff." }, 400);
      }
    },
  },
  // ── Keychain management ──────────────────────────────────────────────
  {
    method: "GET",
    path: "/agent/keychain",
    handle: (channel) => {
      try {
        const entries = listKeychainEntriesForUi();
        const injectable = listInjectableKeychainEntries();
        const envMap: Record<string, string> = {};
        for (const { keychainName, envName } of injectable) {
          envMap[keychainName] = envName;
        }
        const result = entries.map((e: KeychainEntryUiMetadata) => ({
          ...e,
          envVar: envMap[e.name] || null,
        }));
        return channel.json({ ok: true, entries: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return channel.json({ error: message }, 500);
      }
    },
  },
  {
    method: "POST",
    path: "/agent/keychain",
    handle: async (channel, req) => {
      try {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const secret = typeof body.secret === "string" ? body.secret : "";
        if (!name || !secret) {
          return channel.json({ error: "Provide name and secret." }, 400);
        }
        const type = (["token", "password", "basic", "secret"] as const).includes(body.type as any)
          ? (body.type as "token" | "password" | "basic" | "secret")
          : "secret";
        const username = typeof body.username === "string" && body.username.trim() ? body.username.trim() : undefined;
        const userNote = typeof body.userNote === "string" ? body.userNote : undefined;
        const agentNote = typeof body.agentNote === "string" ? body.agentNote : undefined;
        await setKeychainEntry({ name, type, secret, username, userNote, agentNote });
        return channel.json({ ok: true, name, type });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return channel.json({ error: message }, 400);
      }
    },
  },
    {
    method: "DELETE",
    path: "/agent/keychain",
    handle: async (channel, req) => {
      try {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) {
          return channel.json({ error: "Provide name." }, 400);
        }
        const removed = deleteKeychainEntry(name);
        return channel.json({ ok: true, removed });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return channel.json({ error: message }, 400);
      }
    },
  },
  {
    method: "POST",
    path: "/agent/keychain/notes",
    handle: async (channel, req) => {
      try {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) {
          return channel.json({ error: "Provide name." }, 400);
        }
        const userNote = typeof body.userNote === "string" ? body.userNote : "";
        const agentNote = typeof body.agentNote === "string" ? body.agentNote : "";
        const updated = updateKeychainEntryNotes(name, { userNote, agentNote });
        if (!updated) return channel.json({ error: `Keychain entry not found: ${name}` }, 404);
        return channel.json({ ok: true, name, userNote, agentNote });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return channel.json({ error: message }, 400);
      }
    },
  },
  {
    method: "POST",
    path: "/agent/keychain/reveal",
    handle: async (channel, req) => {
      try {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) {
          return channel.json({ error: "Provide name." }, 400);
        }
        // Gate: TOTP if configured, otherwise master password
        const { getWebRuntimeConfig } = await import("../../../core/config.js");
        const { verifyTotp } = await import("../auth/auth.js");
        const webConfig = getWebRuntimeConfig();
        const totpSecret = (webConfig.totpSecret || "").trim();
        if (totpSecret) {
          // TOTP is configured — use it as the gate
          const code = typeof body.totp_code === "string" ? body.totp_code.trim() : "";
          if (!code) {
            return channel.json({ error: "TOTP code required.", needs_totp: true }, 401);
          }
          if (!verifyTotp(totpSecret, code, webConfig.totpWindow)) {
            return channel.json({ error: "Invalid TOTP code.", needs_totp: true }, 401);
          }
        } else {
          // No TOTP — fall back to master password
          const masterPassword = typeof body.master_password === "string" ? body.master_password : "";
          if (!masterPassword) {
            return channel.json({ error: "Master password required.", needs_master_password: true }, 401);
          }
          let expectedKey = "";
          try {
            expectedKey = readKeychainBootstrapKeyMaterial();
          } catch (e) { void e; }
          if (!expectedKey) {
            return channel.json({ error: "Keychain master key not configured on server." }, 500);
          }
          if (masterPassword !== expectedKey) {
            return channel.json({ error: "Invalid master password.", needs_master_password: true }, 401);
          }
        }
        const entry = await getKeychainEntry(name);
        return channel.json({ ok: true, name: entry.name, secret: entry.secret, username: entry.username ?? null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return channel.json({ error: message }, 400);
      }
    },
  },
  {
    method: "POST",
    path: "/agent/client-perf",
    handle: async (channel, req) => {
      try {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const label = typeof body.label === "string" ? body.label : "unknown";
        const lines = Array.isArray(body.lines) ? body.lines.filter((l: unknown) => typeof l === "string") : [];
        const { createLogger } = await import("../../../utils/logger.js");
        const log = createLogger("web.client-perf");
        log.info(`Client perf: ${label}`, { label, lines });
        return channel.json({ ok: true });
      } catch {
        return channel.json({ ok: true });
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

  if ((req.method === 'GET' || req.method === 'POST') && pathname.startsWith('/agent/addons/api/')) {
    const chatJid = url.searchParams.get('chat_jid')?.trim() || 'web:default';
    return await handleAddonConfigApiRequest(req, pathname, (body, status) => channel.json(body, status), channel.agentPool, chatJid);
  }

  const route = EXACT_AGENT_ROUTES.find((candidate) => candidate.method === req.method && candidate.path === pathname);
  return route ? await route.handle(channel, req, url) : null;
}
