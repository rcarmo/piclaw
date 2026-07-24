/**
 * agent-control/handlers/login.ts – Card-driven provider authentication.
 *
 * Three-card flow:
 *   Card 1: Pick a provider (Layout F column table)
 *   Card 2: Auth form (only applicable methods for that provider)
 *   Card 3: Activate — pick a model from that provider
 *
 * Logout: Card 1 → confirmation card → done (no Card 3).
 * Custom providers: Card 2 saves config → "restart + /model" (no Card 3).
 *
 * Credentials are owned by ModelRuntime login/logout. Piclaw writes only
 * custom-provider models.json configuration, with backups and awaited reload.
 */

import type { AgentSession, ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AuthEvent, AuthPrompt, AuthType, CredentialInfo } from "@earendil-works/pi-ai";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";
import { writeFileSync, readFileSync, existsSync, copyFileSync } from "fs";
import { join } from "path";
import { getPiclawAgentDir } from "../../core/agent-dir.js";
import { createLogger } from "../../utils/logger.js";
import { getProviderDefs, type ProviderDef } from "../provider-defs.js";
import { handleModel } from "./model.js";

const log = createLogger("agent-control.login");

type LoginCommand = Extract<AgentControlCommand, { type: "login" }>;
type LogoutCommand = Extract<AgentControlCommand, { type: "logout" }>;

// ── Types ───────────────────────────────────────────────────────

interface ModelRegistryLike {
  refresh?: () => Promise<void>;
  getAll(): Array<{ id: string; name: string; provider: string; contextWindow?: number }>;
  getProviderAuthStatus?: (provider: string) => { configured: boolean; source?: string; label?: string };
  getProviderDisplayName?: (provider: string) => string;
}

// ── Config paths ────────────────────────────────────────────────

function getAuthJsonPath(): string {
  return join(getPiclawAgentDir(), "auth.json");
}

function getModelsJsonPath(): string {
  return join(getPiclawAgentDir(), "models.json");
}

function backupFile(path: string): void {
  if (!existsSync(path)) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(path, `${path}.${ts}.bak`);
}

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return {}; }
}

function writeJsonFile(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ── Provider definitions ────────────────────────────────────────

// ── Helpers ──────────────────────────────────────────────────────

function getModelRuntime(session: AgentSession): ModelRuntime {
  return session.modelRuntime;
}

function getModelRegistry(session: AgentSession, modelRegistry: ModelRegistry): ModelRegistryLike {
  return ((session as AgentSession & { modelRegistry?: ModelRegistryLike }).modelRegistry ?? modelRegistry) as ModelRegistryLike;
}

interface ProviderStatus {
  def: ProviderDef;
  authType: "oauth" | "api_key" | "custom" | "external" | "none";
}

function getProviderDef(modelRuntime: ModelRuntime, registry: ModelRegistryLike, providerId: string): ProviderDef | undefined {
  return getProviderDefs(registry, modelRuntime).find((provider) => provider.id === providerId);
}

async function getProviderStatuses(modelRuntime: ModelRuntime, registry?: ModelRegistryLike): Promise<ProviderStatus[]> {
  const credentials = new Map<string, CredentialInfo>((await modelRuntime.listCredentials()).map((entry) => [entry.providerId, entry]));
  return getProviderDefs(registry, modelRuntime).map((def) => {
    const credential = credentials.get(def.id);
    let authType: ProviderStatus["authType"] = credential?.type === "oauth"
      ? "oauth"
      : credential?.type === "api_key"
        ? "api_key"
        : "none";
    if (authType === "none" && def.isCustom) {
      const models = readJsonFile(getModelsJsonPath()) as { providers?: Record<string, unknown> };
      if (models.providers?.[def.id]) authType = "custom";
    }
    if (authType === "none") {
      const runtimeStatus = modelRuntime.getProviderAuthStatus(def.id);
      if (runtimeStatus.configured) {
        authType = runtimeStatus.source === "environment" ? "api_key" : "external";
      }
    }
    return { def, authType };
  });
}

function statusLabel(s: ProviderStatus): string {
  if (s.authType === "oauth") return "✓ OAuth";
  if (s.authType === "api_key") return "✓ API key";
  if (s.authType === "custom") return "✓ Configured";
  if (s.authType === "external") return "✓ External";
  return "—";
}

function methodsLabel(def: ProviderDef): string {
  const parts: string[] = [];
  if (def.hasOAuth) parts.push("OAuth");
  if (def.hasApiKey) parts.push("Key");
  if (def.isCustom) parts.push("Configure");
  if (def.hasExternalAuth) parts.push("External");
  return parts.join(" · ") || "—";
}

// ── Card 1: Provider Picker ─────────────────────────────────────

function buildCard1(statuses: ProviderStatus[]): Record<string, unknown> {
  const choices = statuses.map((s) => ({ title: s.def.name, value: s.def.id }));

  const headerRow = {
    type: "ColumnSet", spacing: "medium",
    columns: [
      { type: "Column", width: "stretch", items: [{ type: "TextBlock", text: "Provider", weight: "Bolder", size: "Small" }] },
      { type: "Column", width: "80px", items: [{ type: "TextBlock", text: "Status", weight: "Bolder", size: "Small" }] },
      { type: "Column", width: "100px", items: [{ type: "TextBlock", text: "Methods", weight: "Bolder", size: "Small" }] },
    ],
  };

  const dataRows = statuses.map((s) => ({
    type: "ColumnSet",
    columns: [
      { type: "Column", width: "stretch", items: [{ type: "TextBlock", text: s.def.name }] },
      { type: "Column", width: "80px", items: [{ type: "TextBlock", text: s.authType !== "none" ? statusLabel(s) : "—", color: s.authType !== "none" ? "Good" : "Attention" }] },
      { type: "Column", width: "100px", items: [{ type: "TextBlock", text: methodsLabel(s.def), size: "Small", isSubtle: true }] },
    ],
  }));

  return {
    type: "adaptive_card",
    card_id: `login-1-pick-${Date.now()}`,
    schema_version: "1.5",
    state: "active",
    fallback_text: "Provider authentication — select a provider.",
    payload: {
      type: "AdaptiveCard", version: "1.5",
      body: [
        { type: "TextBlock", text: "Provider Authentication", weight: "Bolder", size: "Medium" },
        headerRow,
        ...dataRows,
        { type: "TextBlock", text: "Select a provider", weight: "Bolder", separator: true, spacing: "medium" },
        { type: "Input.ChoiceSet", id: "provider", style: "compact", choices, value: choices[0]?.value || "" },
      ],
      actions: [
        { type: "Action.Submit", title: "Next →", data: { intent: "login-step1" } },
      ],
    },
  };
}

// ── Card 2: Auth Form ───────────────────────────────────────────

function buildCard2Config(def: ProviderDef): Record<string, unknown> {
  const models = readJsonFile(getModelsJsonPath()) as { providers?: Record<string, Record<string, unknown>> };
  const existing = models.providers?.[def.id] || {};

  const body: unknown[] = [
    { type: "TextBlock", text: `${def.name} — Configuration`, weight: "Bolder", size: "Medium" },
    { type: "TextBlock", text: "Saved to `~/.pi/agent/models.json` (backup created first) and applied immediately.", wrap: true, isSubtle: true },
  ];

  for (const field of def.customFields || []) {
    let currentValue = ""; // eslint-disable-line no-useless-assignment
    if (field.key === "modelId") {
      const m = existing.models as Array<{ id: string }> | undefined;
      currentValue = m?.[0]?.id || "";
    } else if (field.key === "modelIds") {
      const m = existing.models as Array<{ id: string }> | undefined;
      currentValue = m?.map((x) => x.id).join(", ") || "";
    } else {
      currentValue = String(existing[field.key] || "");
    }
    body.push({
      type: "Input.Text", id: field.key,
      label: `${field.label}${field.required ? " *" : ""}`,
      placeholder: field.placeholder, value: currentValue,
    });
  }

  return {
    type: "adaptive_card",
    card_id: `login-2-config-${def.id}-${Date.now()}`,
    schema_version: "1.5", state: "active",
    fallback_text: `Configure ${def.name}.`,
    payload: {
      type: "AdaptiveCard", version: "1.5", body,
      actions: [
        { type: "Action.Submit", title: "Save Configuration", data: { intent: "login-step2", provider: def.id, method: "configure" } },
      ],
    },
  };
}

function buildCard2Logout(def: ProviderDef, currentAuth: string): Record<string, unknown> {
  return {
    type: "adaptive_card",
    card_id: `login-2-logout-${def.id}-${Date.now()}`,
    schema_version: "1.5", state: "active",
    fallback_text: `Confirm removal of ${def.name}.`,
    payload: {
      type: "AdaptiveCard", version: "1.5",
      body: [
        { type: "TextBlock", text: `${def.name} — Remove`, weight: "Bolder", size: "Medium" },
        { type: "TextBlock", text: `Currently: **${currentAuth}**`, wrap: true },
        { type: "TextBlock", text: "Removes credentials from config files. Backup created first.", wrap: true, isSubtle: true },
      ],
      actions: [
        { type: "Action.Submit", title: "Confirm Remove", data: { intent: "login-step2", provider: def.id, method: "logout" } },
      ],
    },
  };
}

function buildCard2ExternalInfo(def: ProviderDef): Record<string, unknown> {
  return {
    type: "adaptive_card",
    card_id: `login-2-external-${def.id}-${Date.now()}`,
    schema_version: "1.5", state: "active",
    fallback_text: `${def.name} uses external authentication.`,
    payload: {
      type: "AdaptiveCard", version: "1.5",
      body: [
        { type: "TextBlock", text: `${def.name} — External Authentication`, weight: "Bolder", size: "Medium" },
        {
          type: "TextBlock",
          text: def.authNote || "Configure this provider outside Piclaw, then return to /model once credentials are available.",
          wrap: true,
        },
      ],
    },
  };
}

function buildCard2AuthPicker(def: ProviderDef): Record<string, unknown> {
  const methods: Array<{ title: string; value: string }> = [];
  if (def.hasOAuth) methods.push({ title: "Login with OAuth", value: "oauth" });
  if (def.hasApiKey) methods.push({ title: "Enter API key", value: "api_key" });
  if (def.isCustom) methods.push({ title: "Configure provider", value: "configure" });
  if (def.hasExternalAuth) methods.push({ title: "External credential setup", value: "external" });
  methods.push({ title: "Logout / Remove", value: "logout" });

  return {
    type: "adaptive_card",
    card_id: `login-2-pick-${def.id}-${Date.now()}`,
    schema_version: "1.5", state: "active",
    fallback_text: `Choose auth method for ${def.name}.`,
    payload: {
      type: "AdaptiveCard", version: "1.5",
      body: [
        { type: "TextBlock", text: `${def.name} — Choose Action`, weight: "Bolder", size: "Medium" },
        {
          type: "Input.ChoiceSet", id: "action", style: "expanded",
          choices: methods, value: methods[0]?.value || "",
        },
      ],
      actions: [
        { type: "Action.Submit", title: "Next →", data: { intent: "login-step1-method", provider: def.id } },
      ],
    },
  };
}

// ── Card 3: Activate / Model Picker ─────────────────────────────

function buildCard3(def: ProviderDef, models: Array<{ id: string; name: string }>): Record<string, unknown> {
  const choices = models.map((m) => ({ title: m.name || m.id, value: m.id }));

  return {
    type: "adaptive_card",
    card_id: `login-3-activate-${def.id}-${Date.now()}`,
    schema_version: "1.5", state: "active",
    fallback_text: `Select a model from ${def.name}.`,
    payload: {
      type: "AdaptiveCard", version: "1.5",
      body: [
        { type: "TextBlock", text: `${def.name} — Select Model`, weight: "Bolder", size: "Medium" },
        { type: "TextBlock", text: `✓ Authentication successful. ${models.length} model${models.length !== 1 ? "s" : ""} available.`, wrap: true, color: "Good" },
        {
          type: "Input.ChoiceSet", id: "model", style: "compact",
          choices, value: choices[0]?.value || "",
        },
      ],
      actions: [
        { type: "Action.Submit", title: "Activate Model", data: { intent: "login-step3", provider: def.id } },
      ],
    },
  };
}

// ── Provider-owned auth interaction ─────────────────────────────

type PendingAuthPrompt = {
  prompt: AuthPrompt;
  resolve(value: string): void;
  reject(error: Error): void;
};

type RuntimeAuthFlow = {
  providerId: string;
  authType: AuthType;
  controller: AbortController;
  pending: PendingAuthPrompt | null;
  events: AuthEvent[];
  status: "running" | "completed" | "failed";
  error: string | null;
  version: number;
  expiry: ReturnType<typeof setTimeout>;
};

const runtimeAuthFlows = new Map<string, RuntimeAuthFlow>();

function flowKey(providerId: string, authType: AuthType): string {
  return `${providerId}\u0000${authType}`;
}

function updateAuthFlow(flow: RuntimeAuthFlow): void {
  flow.version += 1;
}

function beginRuntimeAuthFlow(modelRuntime: ModelRuntime, providerId: string, authType: AuthType): RuntimeAuthFlow {
  const key = flowKey(providerId, authType);
  const previous = runtimeAuthFlows.get(key);
  if (previous) {
    clearTimeout(previous.expiry);
    previous.controller.abort(new Error("Superseded by a new authentication flow"));
    previous.pending?.reject(new Error("Superseded by a new authentication flow"));
  }

  const flow: RuntimeAuthFlow = {
    providerId,
    authType,
    controller: new AbortController(),
    pending: null,
    events: [],
    status: "running",
    error: null,
    version: 0,
    expiry: undefined as unknown as ReturnType<typeof setTimeout>,
  };
  flow.expiry = setTimeout(() => {
    if (runtimeAuthFlows.get(key) !== flow) return;
    flow.controller.abort(new Error("Authentication flow expired"));
    flow.pending?.reject(new Error("Authentication flow expired"));
    runtimeAuthFlows.delete(key);
  }, 300_000);
  (flow.expiry as { unref?: () => void }).unref?.();
  runtimeAuthFlows.set(key, flow);

  void modelRuntime.login(providerId, authType, {
    signal: flow.controller.signal,
    prompt: (prompt) => new Promise<string>((resolve, reject) => {
      const finish = (value: string | Error) => {
        prompt.signal?.removeEventListener("abort", onAbort);
        if (flow.pending?.resolve === finishValue) flow.pending = null;
        if (value instanceof Error) reject(value);
        else resolve(value);
        updateAuthFlow(flow);
      };
      const finishValue = (value: string) => finish(value);
      const onAbort = () => finish(new Error("Authentication prompt cancelled"));
      prompt.signal?.addEventListener("abort", onAbort, { once: true });
      flow.pending = { prompt, resolve: finishValue, reject: (error) => finish(error) };
      updateAuthFlow(flow);
      if (prompt.signal?.aborted) onAbort();
    }),
    notify: (event) => {
      flow.events.push(event);
      if (flow.events.length > 8) flow.events.shift();
      updateAuthFlow(flow);
    },
  }).then(() => {
    flow.status = "completed";
    updateAuthFlow(flow);
    log.info("Provider authentication completed", {
      operation: "agent_control_login.runtime_login_completed",
      providerId,
      authType,
    });
  }).catch((error) => {
    flow.status = "failed";
    flow.error = error instanceof Error ? error.message : String(error);
    updateAuthFlow(flow);
    log.warn("Provider authentication failed", {
      operation: "agent_control_login.runtime_login_failed",
      providerId,
      authType,
      error: flow.error,
    });
  });

  return flow;
}

async function waitForAuthFlowUpdate(flow: RuntimeAuthFlow, previousVersion: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (flow.version === previousVersion && flow.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForRenderableAuthFlow(flow: RuntimeAuthFlow, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (flow.status === "running" && !flow.pending && flow.events.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function deleteRuntimeAuthFlow(flow: RuntimeAuthFlow): void {
  clearTimeout(flow.expiry);
  runtimeAuthFlows.delete(flowKey(flow.providerId, flow.authType));
}

function buildRuntimeAuthCard(def: ProviderDef, flow: RuntimeAuthFlow): Record<string, unknown> {
  const body: Record<string, unknown>[] = [
    { type: "TextBlock", text: `${def.name} — ${flow.authType === "oauth" ? "OAuth" : "API Key"} Login`, weight: "Bolder", size: "Medium" },
  ];
  const actions: Record<string, unknown>[] = [];
  for (const event of flow.events) {
    if (event.type === "auth_url") {
      body.push({ type: "TextBlock", text: event.instructions || "Open the login page and complete authentication.", wrap: true });
      actions.push({ type: "Action.OpenUrl", title: "Open login page ↗", url: event.url });
    } else if (event.type === "device_code") {
      body.push(
        { type: "TextBlock", text: `Open ${event.verificationUri} and enter code:`, wrap: true },
        { type: "TextBlock", text: event.userCode, wrap: true, weight: "Bolder", fontType: "Monospace" },
      );
      actions.push({ type: "Action.OpenUrl", title: "Open login page ↗", url: event.verificationUri });
    } else if (event.type === "info") {
      body.push({ type: "TextBlock", text: event.message, wrap: true, isSubtle: true });
      for (const link of event.links ?? []) actions.push({ type: "Action.OpenUrl", title: link.label || "Open link ↗", url: link.url });
    } else {
      body.push({ type: "TextBlock", text: event.message, wrap: true, isSubtle: true });
    }
  }

  const prompt = flow.pending?.prompt;
  if (prompt?.type === "select") {
    body.push({
      type: "Input.ChoiceSet",
      id: "auth_value",
      label: prompt.message,
      style: "expanded",
      choices: prompt.options.map((option) => ({ title: option.description ? `${option.label} — ${option.description}` : option.label, value: option.id })),
      value: prompt.options[0]?.id || "",
    });
  } else if (prompt) {
    body.push({
      type: "Input.Text",
      id: "auth_value",
      label: prompt.message,
      placeholder: prompt.placeholder || "",
      style: prompt.type === "secret" ? "password" : "text",
    });
  }

  if (prompt) {
    actions.push({ type: "Action.Submit", title: "Continue →", data: { intent: "login-step2", provider: def.id, method: "runtime_continue", auth_type: flow.authType } });
  } else if (flow.status === "running") {
    actions.push({ type: "Action.Submit", title: "Check & Continue →", data: { intent: "login-step2", provider: def.id, method: "runtime_check", auth_type: flow.authType } });
  }
  if (flow.status === "running") {
    actions.push({ type: "Action.Submit", title: "Cancel", data: { intent: "login-step2", provider: def.id, method: "runtime_cancel", auth_type: flow.authType } });
  }

  return {
    type: "adaptive_card",
    card_id: `login-runtime-${def.id}-${Date.now()}`,
    schema_version: "1.5",
    state: "active",
    fallback_text: `Authentication for ${def.name}.`,
    payload: { type: "AdaptiveCard", version: "1.5", body, actions },
  };
}

async function startRuntimeAuth(
  modelRuntime: ModelRuntime,
  def: ProviderDef,
  authType: AuthType,
  onComplete?: () => Promise<AgentControlResult>,
): Promise<AgentControlResult> {
  const flow = beginRuntimeAuthFlow(modelRuntime, def.id, authType);
  await waitForRenderableAuthFlow(flow);
  if (flow.status === "completed") {
    deleteRuntimeAuthFlow(flow);
    return onComplete ? await onComplete() : { status: "success", message: `✓ **${def.name}** authenticated.` };
  }
  if (flow.status === "failed") {
    deleteRuntimeAuthFlow(flow);
    return { status: "error", message: `Could not start authentication for **${def.name}**: ${flow.error}` };
  }
  return { status: "success", message: `Authentication for ${def.name}`, contentBlocks: [buildRuntimeAuthCard(def, flow)] };
}

// ── Step handlers ───────────────────────────────────────────────

/** Card 1 submitted → show Card 2 (auth method picker or direct form). */
async function handleStep1(
  modelRuntime: ModelRuntime,
  registry: ModelRegistryLike,
  data: Record<string, unknown>,
): Promise<AgentControlResult> {
  const providerId = String(data.provider || "").trim();
  const def = getProviderDef(modelRuntime, registry, providerId);
  if (!def) return { status: "error", message: `Unknown provider "${providerId}".` };

  // Count applicable methods
  const methods = [def.hasOAuth, def.hasApiKey, def.isCustom, def.hasExternalAuth].filter(Boolean).length;
  const hasLogoutOption = (await getProviderStatuses(modelRuntime, registry)).find((s) => s.def.id === providerId)?.authType !== "none";

  // If only one auth method (+ optional logout), go straight to the form
  if (methods === 1 && !hasLogoutOption) {
    if (def.hasOAuth) {
      return await startRuntimeAuth(modelRuntime, def, "oauth");
    }
    if (def.hasApiKey) return await startRuntimeAuth(modelRuntime, def, "api_key");
    if (def.isCustom) return { status: "success", message: `Configure ${def.name}`, contentBlocks: [buildCard2Config(def)] };
    if (def.hasExternalAuth) return { status: "success", message: `${def.name} uses external authentication`, contentBlocks: [buildCard2ExternalInfo(def)] };
  }

  // Multiple methods → show method picker
  return { status: "success", message: `Choose action for ${def.name}`, contentBlocks: [buildCard2AuthPicker(def)] };
}

/** Card 2 method picker submitted → show the actual auth form. */
async function handleStep1Method(
  session: AgentSession,
  modelRuntime: ModelRuntime,
  modelRegistry: ModelRegistry,
  registry: ModelRegistryLike,
  data: Record<string, unknown>,
): Promise<AgentControlResult> {
  const providerId = String(data.provider || "").trim();
  const action = String(data.action || "").trim();
  const def = getProviderDef(modelRuntime, registry, providerId);
  if (!def) return { status: "error", message: `Unknown provider "${providerId}".` };

  if (action === "oauth") {
    if (!def.hasOAuth) return { status: "error", message: `**${def.name}** doesn't support OAuth.` };
    return await startRuntimeAuth(modelRuntime, def, "oauth", () => showCard3OrComplete(session, modelRegistry, def, providerId, def.name, registry));
  }
  if (action === "api_key") {
    if (!def.hasApiKey) return { status: "error", message: `**${def.name}** doesn't support API key auth.` };
    return await startRuntimeAuth(modelRuntime, def, "api_key", () => showCard3OrComplete(session, modelRegistry, def, providerId, def.name, registry));
  }
  if (action === "configure") {
    if (!def.isCustom) return { status: "error", message: `**${def.name}** doesn't need configuration.` };
    return { status: "success", message: `Configure ${def.name}`, contentBlocks: [buildCard2Config(def)] };
  }
  if (action === "external") {
    if (!def.hasExternalAuth) return { status: "error", message: `**${def.name}** does not require external setup.` };
    return { status: "success", message: `${def.name} uses external authentication`, contentBlocks: [buildCard2ExternalInfo(def)] };
  }
  if (action === "logout") {
    const status = (await getProviderStatuses(modelRuntime, registry)).find((s) => s.def.id === providerId);
    if (!status || status.authType === "none") return { status: "error", message: `**${def.name}** is not configured.` };
    return { status: "success", message: `Confirm removal for ${def.name}`, contentBlocks: [buildCard2Logout(def, statusLabel(status))] };
  }

  return { status: "error", message: `Unknown action: ${action}` };
}

/** Card 2 auth/config form submitted → continue the provider-owned flow. */
async function handleStep2(
  session: AgentSession,
  modelRuntime: ModelRuntime,
  modelRegistry: ModelRegistry,
  registry: ModelRegistryLike,
  data: Record<string, unknown>,
): Promise<AgentControlResult> {
  const providerId = String(data.provider || "").trim();
  const method = String(data.method || "").trim();
  const def = getProviderDef(modelRuntime, registry, providerId);
  const name = def?.name || providerId;

  if (method === "runtime_continue" || method === "runtime_check" || method === "runtime_cancel" || method === "oauth_check" || method === "api_key") {
    const authType = String(data.auth_type || (method === "api_key" ? "api_key" : "oauth")) as AuthType;
    if (authType !== "api_key" && authType !== "oauth") return { status: "error", message: "Invalid authentication type." };
    const flow = runtimeAuthFlows.get(flowKey(providerId, authType));
    if (!flow) return { status: "error", message: `No active authentication flow for **${name}**. Start again with \`/login\`.` };
    if (method === "runtime_cancel") {
      flow.controller.abort(new Error("Authentication cancelled by user"));
      flow.pending?.reject(new Error("Authentication cancelled by user"));
      deleteRuntimeAuthFlow(flow);
      return { status: "success", message: `Authentication for **${name}** cancelled.` };
    }

    let previousVersion = flow.version;
    if (method === "runtime_continue" || method === "oauth_check" || method === "api_key") {
      const value = String(data.auth_value ?? data.redirect_url ?? data.api_key ?? "");
      if (!flow.pending) return { status: "error", message: `**${name}** is not waiting for input. Use Check & Continue.` };
      flow.pending.resolve(value);
      previousVersion = flow.version;
    }
    await waitForAuthFlowUpdate(flow, previousVersion, method === "runtime_check" ? 2_000 : 10_000);

    if (flow.status === "completed") {
      deleteRuntimeAuthFlow(flow);
      return await showCard3OrComplete(session, modelRegistry, def, providerId, name, registry);
    }
    if (flow.status === "failed") {
      deleteRuntimeAuthFlow(flow);
      return { status: "error", message: `Authentication for **${name}** failed: ${flow.error || "unknown error"}` };
    }
    return { status: "success", message: `Authentication for ${name}`, contentBlocks: [buildRuntimeAuthCard(def!, flow)] };
  }

  if (method === "configure" || method === "custom") {
    if (!def?.customFields) return { status: "error", message: "No configuration fields." };
    const baseUrl = String(data.baseUrl || "").trim();
    const apiKey = String(data.apiKey || "").trim();
    const modelId = String(data.modelId || "").trim();
    const modelIds = String(data.modelIds || "").trim();
    const contextWindow = parseInt(String(data.contextWindow || ""), 10) || undefined;

    if (!baseUrl) return { status: "error", message: "Base URL is required." };
    if (!modelId && !modelIds) return { status: "error", message: "At least one model ID is required." };

    const allIds = modelIds ? modelIds.split(",").map((s) => s.trim()).filter(Boolean) : [modelId];
    if (modelId && !allIds.includes(modelId)) allIds.unshift(modelId);
    const models = allIds.map((id) => ({
      id,
      name: id,
      ...(contextWindow ? { contextWindow } : {}),
      ...(def.customCompat ? { compat: def.customCompat } : {}),
    }));

    backupFile(getModelsJsonPath());
    const modelsJson = readJsonFile(getModelsJsonPath()) as { providers?: Record<string, unknown> };
    if (!modelsJson.providers) modelsJson.providers = {};
    modelsJson.providers[providerId] = { baseUrl, api: def.customApi || "openai-completions", ...(apiKey ? { apiKey } : {}), models };
    writeJsonFile(getModelsJsonPath(), modelsJson);
    await modelRuntime.refresh({ allowNetwork: false });

    return await showCard3OrComplete(session, modelRegistry, def, providerId, name, registry);
  }

  if (method === "logout") {
    backupFile(getAuthJsonPath());
    await modelRuntime.logout(providerId);
    if (def?.isCustom) {
      const modelsJson = readJsonFile(getModelsJsonPath()) as { providers?: Record<string, unknown> };
      if (modelsJson.providers?.[providerId]) {
        backupFile(getModelsJsonPath());
        delete modelsJson.providers[providerId];
        writeJsonFile(getModelsJsonPath(), modelsJson);
        await modelRuntime.refresh({ allowNetwork: false });
      }
    }
    return { status: "success", message: `✓ **${name}** removed. Backups created.` };
  }

  return { status: "error", message: `Unknown method: ${method}` };
}

async function activateProviderModel(
  session: AgentSession,
  modelRegistry: ModelRegistry,
  providerId: string,
  modelId: string,
): Promise<AgentControlResult> {
  return handleModel(session, modelRegistry, {
    type: "model",
    provider: providerId,
    modelId,
    raw: `/model ${providerId}/${modelId}`,
  });
}

/** Show Card 3 (model picker) or auto-complete if only one model. */
async function showCard3OrComplete(
  session: AgentSession,
  modelRegistry: ModelRegistry,
  def: ProviderDef | undefined,
  providerId: string,
  name: string,
  registry: ModelRegistryLike,
): Promise<AgentControlResult> {
  const models = registry.getAll().filter((m) => m.provider === providerId);
  if (models.length === 0) {
    return { status: "success", message: `✓ **${name}** authenticated, but no models found for this provider. Use \`/model\` to check available models.` };
  }
  if (models.length === 1) {
    return activateProviderModel(session, modelRegistry, models[0].provider, models[0].id);
  }

  return {
    status: "success",
    message: `${name} — select a model`,
    contentBlocks: [buildCard3(def!, models)],
  };
}

/** Card 3 submitted → activate model. */
async function handleStep3(
  session: AgentSession,
  modelRegistry: ModelRegistry,
  data: Record<string, unknown>,
): Promise<AgentControlResult> {
  const providerId = String(data.provider || "").trim();
  const modelId = String(data.model || "").trim();
  if (!providerId) return { status: "error", message: "No provider selected." };
  if (!modelId) return { status: "error", message: "No model selected." };

  return activateProviderModel(session, modelRegistry, providerId, modelId);
}

// ── Command handlers ────────────────────────────────────────────

export async function handleLogin(
  session: AgentSession,
  modelRegistry: ModelRegistry,
  command: LoginCommand,
): Promise<AgentControlResult> {
  const modelRuntime = getModelRuntime(session);
  const registry = getModelRegistry(session, modelRegistry);

  // Internal routing from card submissions. Parse errors are UI errors, while
  // provider/runtime failures must retain their actionable messages.
  const parseCardData = (json: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(json) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  };
  if (command.provider?.startsWith("__step1 ")) {
    const data = parseCardData(command.provider.slice(8));
    return data ? handleStep1(modelRuntime, registry, data) : { status: "error", message: "Invalid card data." };
  }
  if (command.provider?.startsWith("__step1method ")) {
    const data = parseCardData(command.provider.slice(14));
    return data ? handleStep1Method(session, modelRuntime, modelRegistry, registry, data) : { status: "error", message: "Invalid card data." };
  }
  if (command.provider?.startsWith("__step2 ")) {
    const data = parseCardData(command.provider.slice(8));
    return data ? handleStep2(session, modelRuntime, modelRegistry, registry, data) : { status: "error", message: "Invalid card data." };
  }
  if (command.provider?.startsWith("__step3 ")) {
    const data = parseCardData(command.provider.slice(8));
    return data ? handleStep3(session, modelRegistry, data) : { status: "error", message: "Invalid card data." };
  }

  // No args → show Card 1
  const statuses = await getProviderStatuses(modelRuntime, registry);
  return { status: "success", message: "Provider authentication", contentBlocks: [buildCard1(statuses)] };
}

export async function handleLogout(
  session: AgentSession,
  modelRegistry: ModelRegistry,
  command: LogoutCommand,
): Promise<AgentControlResult> {
  const modelRuntime = getModelRuntime(session);
  const registry = getModelRegistry(session, modelRegistry);

  if (command.provider) {
    const providerId = command.provider.trim().toLowerCase();
    const credentials = await modelRuntime.listCredentials();
    if (!credentials.some((entry) => entry.providerId === providerId)) return { status: "error", message: `**${providerId}** is not logged in.` };
    backupFile(getAuthJsonPath());
    await modelRuntime.logout(providerId);
    return { status: "success", message: `✓ Logged out from **${providerId}**.` };
  }

  const statuses = await getProviderStatuses(modelRuntime, registry);
  return { status: "success", message: "Provider authentication", contentBlocks: [buildCard1(statuses)] };
}
