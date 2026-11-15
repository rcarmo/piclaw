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

import { CredentialSynchronizationError, type ModelRegistry, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AuthEvent, AuthPrompt, AuthType, CredentialInfo } from "@earendil-works/pi-ai";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";
import { writeFileSync, readFileSync, existsSync, chmodSync, unlinkSync } from "fs";
import { join } from "path";
import { randomUUID } from "node:crypto";
import { getPiclawAgentDir } from "../../core/agent-dir.js";
import { getChatJid } from "../../core/chat-context.js";
import { isSingleUserAccess } from "../../core/config-access.js";
import { createLogger } from "../../utils/logger.js";
import { getProviderDefs, type ProviderDef } from "../provider-defs.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type { NativeProviderAuthContext } from "../provider-auth-context.js";

const log = createLogger("agent-control.login");
const privateAuthResponse = new AsyncLocalStorage<{ rollback?: () => void }>();
/** Admit sensitive presentation only from the authenticated, non-persisting HTTP callback. */
export function withPrivateProviderAuthResponse<T>(run: () => Promise<T>): Promise<T> {
  const delivery: { rollback?: () => void } = {};
  return privateAuthResponse.run(delivery, async () => {
    try { return await run(); }
    catch (error) { delivery.rollback?.(); throw error; }
  });
}
export function commitPrivateProviderAuthResponse(): void {
  const delivery = privateAuthResponse.getStore();
  if (delivery) delivery.rollback = undefined;
}

type LoginCommand = Extract<AgentControlCommand, { type: "login" }>;
type LogoutCommand = Extract<AgentControlCommand, { type: "logout" }>;

// ── Config paths ────────────────────────────────────────────────

// Earendil 0.99.1 keyless Ollama/llama.cpp availability requires a configured
// placeholder. This non-secret compatibility marker never enters the credential store.
const KEYLESS_LOCAL_MARKER = "piclaw-keyless-local";
const KEYLESS_LOCAL_PROVIDERS = new Set(["ollama", "llama-cpp"]);

function getModelsJsonPath(): string {
  return join(getPiclawAgentDir(), "models.json");
}

// Different providers share one configuration file; provider locks alone do
// not protect its read/modify/write across asynchronous auth operations.
const modelConfigWrites = new Map<string, Promise<void>>();
async function serializeModelsConfig<T>(path: string, run: () => Promise<T>): Promise<T> {
  const prior = modelConfigWrites.get(path) ?? Promise.resolve();
  const operation = prior.then(run);
  const tail = operation.then(() => undefined, () => undefined);
  modelConfigWrites.set(path, tail);
  try { return await operation; }
  finally { if (modelConfigWrites.get(path) === tail) modelConfigWrites.delete(path); }
}

function backupModelsConfig(path: string): void {
  if (!existsSync(path)) return;
  const snapshot = JSON.parse(readFileSync(path, "utf-8")) as { providers?: Record<string, Record<string, unknown>> };
  // New backups must not duplicate provider API keys. Existing backups are
  // preserved for a separately reviewed migration/retention decision.
  for (const provider of Object.values(snapshot.providers ?? {})) delete provider.apiKey;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  writeJsonFile(`${path}.${ts}.bak`, snapshot);
}

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return {}; }
}

function writeJsonFile(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  chmodSync(path, 0o600);
}

// ── Helpers ──────────────────────────────────────────────────────

function assertNativeAuthCurrent(session: NativeProviderAuthContext): void {
  if (disposedAuthSessions.has(session) || session.signal.aborted || session.chatJid !== getChatJid()) throw Error("Authentication session ended");
  const result: unknown = session.assertCurrent();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => {
      createLogger("agent_control_login").warn("invalid_auth_authority", { message: "Rejected asynchronous authentication authority" });
    });
    throw Error("Authentication authority must be synchronous");
  }
}
async function runOwnedAuth<T>(session: NativeProviderAuthContext, operation: () => Promise<T>): Promise<T> {
  assertNativeAuthCurrent(session);
  return session.runOwned(async () => { assertNativeAuthCurrent(session); return operation(); });
}

function runOwnedAuthCommand(session: NativeProviderAuthContext, operation: () => Promise<AgentControlResult>): Promise<AgentControlResult> {
  if (!isSingleUserAccess()) return Promise.resolve({ status: "error", message: "Provider authentication is an instance-owner operation; requires single-user access." });
  if (session.kind !== "native-provider-auth") return Promise.resolve({ status: "error", message: "Native authentication context required. No legacy runtime was opened." });
  return runOwnedAuth(session, async () => {
    try { return await operation(); }
    catch (error) {
      const saved = error instanceof CredentialSynchronizationError;
      let recovered = false;
      if (saved) {
        try {
          assertNativeAuthCurrent(session);
          await session.runtime.refresh({ allowNetwork: false });
          assertNativeAuthCurrent(session);
          recovered = true;
        } catch { /* No credential rollback, login replay or exception forwarding. */ }
      }
      log.warn("Native provider authentication did not finish", { operation: "agent_control_login.native_control_failed",
        outcome: saved ? "saved_credentials_sync_failed" : "failed" });
      return { status: "error", message: saved
        ? recovered ? "Credential changes may already be saved. Model availability was refreshed offline. Check /model; do not repeat authentication."
          : "Credential changes may already be saved, but local model state could not be updated. Do not repeat authentication or restore old credentials."
        : "Provider authentication failed. Check saved credentials before retrying." };
    }
  });
}

interface ProviderStatus {
  def: ProviderDef;
  authType: "oauth" | "api_key" | "custom" | "external" | "none";
}

function getProviderDef(modelRuntime: ModelRuntime, registry: ModelRegistry, providerId: string): ProviderDef | undefined {
  return getProviderDefs(registry, modelRuntime).find((provider) => provider.id === providerId);
}

async function getProviderStatuses(modelRuntime: ModelRuntime, registry: ModelRegistry | undefined, session: NativeProviderAuthContext): Promise<ProviderStatus[]> {
  const entries = await modelRuntime.listCredentials();
  assertNativeAuthCurrent(session);
  const credentials = new Map<string, CredentialInfo>(entries.map((entry) => [entry.providerId, entry]));
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
    { type: "TextBlock", text: "Model configuration is applied immediately. Keys are saved through provider authentication, not in models.json or its new backups. Leave the key blank to retain a stored credential.", wrap: true, isSubtle: true },
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
    if (field.key === "apiKey") currentValue = "";
    body.push({
      type: "Input.Text", id: field.key,
      label: `${field.label}${field.required && field.key !== "apiKey" ? " *" : ""}`,
      placeholder: field.placeholder, value: currentValue,
      ...(field.key === "apiKey" ? { style: "password" } : {}),
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

function buildCard2Logout(def: ProviderDef, currentAuth: string, confirmationId: string): Record<string, unknown> {
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
        { type: "Action.Submit", title: "Confirm Remove", data: { intent: "login-step2", provider: def.id, method: "logout", confirmation_id: confirmationId } },
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

function buildCard3(def: ProviderDef, models: Array<{ id: string; name: string }>, activationId: string): Record<string, unknown> {
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
        { type: "Action.Submit", title: "Activate Model", data: { intent: "login-step3", provider: def.id, activation_id: activationId } },
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
  id: string;
  actionId: string;
  owner: RuntimeAuthOwner;
  providerId: string;
  authType: AuthType;
  controller: AbortController;
  pending: PendingAuthPrompt | null;
  events: AuthEvent[];
  status: "running" | "completed" | "failed";
  error: string | null;
  locallyRecovered: boolean;
  version: number;
  expiry: ReturnType<typeof setTimeout>;
  expiresAt: number;
};

type RuntimeAuthOwner = {
  session: NativeProviderAuthContext;
  chatJid: string;
  sessionId: string;
  runtime: ModelRuntime;
  flows: Map<string, RuntimeAuthFlow>;
  activations: Map<string, { provider: string; models: Set<string>; expiresAt: number; providerRevision: number }>;
  logouts: Map<string, { provider: string; expiresAt: number; providerRevision: number }>;
};
const runtimeAuthOwners = new WeakMap<NativeProviderAuthContext, RuntimeAuthOwner>();
const disposedAuthSessions = new WeakSet<NativeProviderAuthContext>();
const nativeLifetimeCleanups = new WeakMap<NativeProviderAuthContext, () => void>();
// Runtime credentials have one slot per provider, across sessions and methods.
type ProviderAuthState = { revision: number; flow?: RuntimeAuthFlow; mutation: Promise<void> };
const runtimeProviderAuth = new WeakMap<ModelRuntime, Map<string, ProviderAuthState>>();

function providerAuthState(runtime: ModelRuntime, provider: string) {
  let providers = runtimeProviderAuth.get(runtime);
  if (!providers) { providers = new Map(); runtimeProviderAuth.set(runtime, providers); }
  let state = providers.get(provider);
  if (!state) { state = { revision: 0, mutation: Promise.resolve() }; providers.set(provider, state); }
  return state;
}

/** Join old provider credential work before login/logout can mutate the same slot. */
function serializeProviderAuth<T>(runtime: ModelRuntime, provider: string, mutate: () => Promise<T>): Promise<T> {
  const state = providerAuthState(runtime, provider);
  const operation = state.mutation.then(mutate);
  // The caller observes failure; queue settlement must still release the next operation.
  state.mutation = operation.then(() => undefined, () => undefined);
  return operation;
}

function retireProviderAuth(runtime: ModelRuntime, provider: string): void {
  const state = providerAuthState(runtime, provider);
  state.revision++;
  const previous = state.flow;
  if (!previous) return;
  previous.controller.abort(new Error("Provider authentication replaced or removed"));
  previous.pending?.reject(new Error("Provider authentication replaced or removed"));
  deleteRuntimeAuthFlow(previous);
}

function isRuntimeAuthOwnerActive(owner: RuntimeAuthOwner): boolean {
  if (runtimeAuthOwners.get(owner.session) !== owner || disposedAuthSessions.has(owner.session)
    || owner.session.bindingId !== owner.sessionId || owner.session.runtime !== owner.runtime) return false;
  try { assertNativeAuthCurrent(owner.session); return true; } catch { return false; }
}

export function revokeNativeProviderAuthContext(context: NativeProviderAuthContext): void {
  disposedAuthSessions.add(context);
  cancelProviderAuthFlows(context);
}

/** Provider credentials belong to the instance owner. */
function getRuntimeAuthOwner(session: NativeProviderAuthContext): RuntimeAuthOwner {
  assertNativeAuthCurrent(session);
  const chatJid = getChatJid(), sessionId = session.bindingId, runtime = session.runtime;
  let owner = runtimeAuthOwners.get(session);
  if (owner && (owner.chatJid !== chatJid || owner.sessionId !== sessionId || owner.runtime !== runtime)) {
    cancelProviderAuthFlows(session);
    owner = undefined;
  }
  if (!owner) {
    owner = { session, chatJid, sessionId, runtime, flows: new Map(), activations: new Map(), logouts: new Map() };
    runtimeAuthOwners.set(session, owner);
  }
  if (!nativeLifetimeCleanups.has(session)) {
    const revoke = () => revokeNativeProviderAuthContext(session);
    session.signal.addEventListener("abort", revoke, { once: true });
    nativeLifetimeCleanups.set(session, () => session.signal.removeEventListener("abort", revoke));
  }
  return owner;
}

export function cancelProviderAuthFlows(session: NativeProviderAuthContext): void {
  nativeLifetimeCleanups.get(session)?.(); nativeLifetimeCleanups.delete(session);
  const owner = runtimeAuthOwners.get(session);
  if (!owner) return;
  runtimeAuthOwners.delete(session);
  owner.activations.clear();
  owner.logouts.clear();
  for (const flow of owner.flows.values()) {
    clearTimeout(flow.expiry);
    flow.controller.abort(new Error("Authentication session ended"));
    flow.pending?.reject(new Error("Authentication session ended"));
    flow.events.length = 0;
    const state = providerAuthState(owner.runtime, flow.providerId);
    if (state.flow === flow) { state.flow = undefined; state.revision++; }
  }
  owner.flows.clear();
}

function flowKey(providerId: string, authType: AuthType): string {
  return `${providerId}\u0000${authType}`;
}

function updateAuthFlow(flow: RuntimeAuthFlow): void {
  flow.version += 1;
}

function beginRuntimeAuthFlow(owner: RuntimeAuthOwner, modelRuntime: ModelRuntime, providerId: string, authType: AuthType): RuntimeAuthFlow {
  const key = flowKey(providerId, authType);
  retireProviderAuth(modelRuntime, providerId);

  const flow: RuntimeAuthFlow = {
    id: randomUUID(),
    actionId: randomUUID(),
    owner,
    providerId,
    authType,
    controller: new AbortController(),
    pending: null,
    events: [],
    status: "running",
    error: null,
    locallyRecovered: false,
    version: 0,
    expiry: undefined as unknown as ReturnType<typeof setTimeout>,
    expiresAt: Date.now() + 300_000,
  };
  flow.expiry = setTimeout(() => {
    if (owner.flows.get(key) !== flow) return;
    flow.controller.abort(new Error("Authentication flow expired"));
    flow.pending?.reject(new Error("Authentication flow expired"));
    deleteRuntimeAuthFlow(flow);
  }, 300_000);
  (flow.expiry as { unref?: () => void }).unref?.();
  owner.flows.set(key, flow);
  providerAuthState(modelRuntime, providerId).flow = flow;

  void runOwnedAuth(owner.session, () => serializeProviderAuth(modelRuntime, providerId, async () => {
    if (!isRuntimeAuthOwnerActive(owner) || flow.controller.signal.aborted || owner.flows.get(key) !== flow) throw new Error("Authentication session ended");
    try {
      await modelRuntime.login(providerId, authType, {
    signal: flow.controller.signal,
    prompt: (prompt) => new Promise<string>((resolve, reject) => {
      if (!isRuntimeAuthOwnerActive(owner) || flow.controller.signal.aborted || owner.flows.get(key) !== flow) {
        reject(new Error("Authentication session ended"));
        return;
      }
      let finished = false;
      const finish = (value: string | Error) => {
        if (finished) return;
        finished = true;
        prompt.signal?.removeEventListener("abort", onAbort);
        if (flow.pending?.resolve === finishValue) flow.pending = null;
        flow.actionId = randomUUID();
        if (value instanceof Error) reject(value);
        else resolve(value);
        updateAuthFlow(flow);
      };
      const finishValue = (value: string) => finish(value);
      const onAbort = () => finish(new Error("Authentication prompt cancelled"));
      prompt.signal?.addEventListener("abort", onAbort, { once: true });
      flow.actionId = randomUUID();
      flow.pending = { prompt, resolve: finishValue, reject: (error) => finish(error) };
      updateAuthFlow(flow);
      if (prompt.signal?.aborted) onAbort();
    }),
    notify: (event) => {
      if (!isRuntimeAuthOwnerActive(owner) || flow.controller.signal.aborted || owner.flows.get(key) !== flow) return;
      // Retain the latest actionable URL/code even during verbose progress.
      flow.events = flow.events.filter(previous => previous.type !== event.type);
      flow.events.push(event);
      if (event.type === "device_code" && typeof event.expiresInSeconds === "number" && Number.isFinite(event.expiresInSeconds)) {
        flow.expiresAt = Math.min(flow.expiresAt, Date.now() + Math.max(0, event.expiresInSeconds) * 1000);
        clearTimeout(flow.expiry);
        flow.expiry = setTimeout(() => {
          flow.controller.abort(new Error("Authentication code expired"));
          flow.pending?.reject(new Error("Authentication code expired"));
          deleteRuntimeAuthFlow(flow);
        }, Math.max(0, flow.expiresAt - Date.now()));
        (flow.expiry as { unref?: () => void }).unref?.();
      }
      updateAuthFlow(flow);
    },
      });
    } catch (error) {
      if (!(error instanceof CredentialSynchronizationError) || error.operation !== "login") throw error;
      // This exception contains the committed credential and possibly a secret
      // cause. Inspect only its category; never log or present the exception.
      flow.error = "Credentials were saved, but local model state could not be updated. Retry local model refresh; do not log in again or restore older credentials.";
      if (!isRuntimeAuthOwnerActive(owner) || flow.controller.signal.aborted || owner.flows.get(key) !== flow || providerAuthState(modelRuntime, providerId).flow !== flow) return;
      // Keep recovery inside the provider write queue. No login, credential
      // mutation, rollback, network refresh or request replay is admitted here.
      const result = await modelRuntime.refresh({ allowNetwork: false });
      if (!isRuntimeAuthOwnerActive(owner) || flow.controller.signal.aborted || owner.flows.get(key) !== flow || providerAuthState(modelRuntime, providerId).flow !== flow) return;
      if (result.aborted || result.errors.size > 0 || modelRuntime.getError() || !modelRuntime.getProviderAuthStatus(providerId).configured) {
        // CredentialSynchronizationError can contain committed credentials and secret causes.
        // eslint-disable-next-line preserve-caught-error
        throw new Error("Local credential synchronization failed");
      }
      flow.locallyRecovered = true;
      flow.error = null;
    }
  })).then(() => {
    if (!isRuntimeAuthOwnerActive(owner) || flow.controller.signal.aborted || owner.flows.get(key) !== flow) return;
    flow.status = "completed";
    updateAuthFlow(flow);
    log.info("Provider authentication completed", {
      operation: "agent_control_login.runtime_login_completed",
    });
  }).catch(() => {
    flow.status = "failed";
    // Provider errors can contain tokens, codes or secret-bearing URLs. Never
    // forward their text to logs/cards; the provider-owned flow may be retried.
    flow.error = flow.controller.signal.aborted ? "Authentication cancelled." : flow.error ?? "Authentication failed. Start again with /login.";
    updateAuthFlow(flow);
    log.warn("Provider authentication failed", {
      operation: "agent_control_login.runtime_login_failed",
      outcome: flow.controller.signal.aborted ? "cancelled" : flow.error.startsWith("Credentials were saved") ? "saved_credentials_sync_failed" : "failed",
    });
  });

  return flow;
}

async function waitForAuthFlowUpdate(flow: RuntimeAuthFlow, previousVersion: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (flow.version === previousVersion && flow.status === "running" && !flow.controller.signal.aborted && isRuntimeAuthOwnerActive(flow.owner) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForRenderableAuthFlow(flow: RuntimeAuthFlow, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (flow.status === "running" && !flow.controller.signal.aborted && isRuntimeAuthOwnerActive(flow.owner) && !flow.pending && flow.events.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function deleteRuntimeAuthFlow(flow: RuntimeAuthFlow): void {
  clearTimeout(flow.expiry);
  const key = flowKey(flow.providerId, flow.authType);
  if (flow.owner.flows.get(key) === flow) flow.owner.flows.delete(key);
  const state = providerAuthState(flow.owner.runtime, flow.providerId);
  if (state.flow === flow) state.flow = undefined;
  flow.events.length = 0;
}

function buildRuntimeAuthCard(def: ProviderDef, flow: RuntimeAuthFlow): Record<string, unknown> {
  flow.actionId = randomUUID();
  const actionData = { intent: "login-step2", provider: def.id, auth_type: flow.authType, flow_id: flow.id, action_id: flow.actionId };
  const body: Record<string, unknown>[] = [
    { type: "TextBlock", text: `${def.name} — ${flow.authType === "oauth" ? "OAuth" : "API Key"} Login`, weight: "Bolder", size: "Medium" },
  ];
  const actions: Record<string, unknown>[] = [];
  // Provider text, URLs, codes and choice values may contain credentials. Keep
  // them in the flow and reveal only through the authenticated direct response.
  body.push({ type: "TextBlock", text: "Open the private authentication dialog to view provider instructions and enter credentials.", wrap: true });
  const prompt = flow.pending?.prompt;
  actions.push({ type: "Action.Submit", title: "Open private authentication", data: { ...actionData, method: "runtime_present" } });
  if (prompt) {
    actions.push({ type: "Action.Submit", title: "Continue →", data: { ...actionData, method: "runtime_continue" } });
  } else if (flow.status === "running") {
    actions.push({ type: "Action.Submit", title: "Check & Continue →", data: { ...actionData, method: "runtime_check" } });
  }
  if (flow.status === "running") {
    actions.push({ type: "Action.Submit", title: "Cancel", data: { ...actionData, method: "runtime_cancel" } });
  }

  return {
    type: "adaptive_card",
    card_id: `login-runtime-${flow.id}-${flow.actionId}`,
    schema_version: "1.5",
    state: "active",
    expires_at: flow.expiresAt,
    fallback_text: `Authentication for ${def.name}.`,
    payload: { type: "AdaptiveCard", version: "1.5", body, actions },
  };
}

async function startRuntimeAuth(
  session: NativeProviderAuthContext,
  modelRuntime: ModelRuntime,
  def: ProviderDef,
  authType: AuthType,
  onComplete?: (locallyRecovered: boolean) => Promise<AgentControlResult>,
): Promise<AgentControlResult> {
  const owner = getRuntimeAuthOwner(session);
  const flow = beginRuntimeAuthFlow(owner, modelRuntime, def.id, authType);
  await waitForRenderableAuthFlow(flow);
  if (!isRuntimeAuthOwnerActive(owner) || flow.controller.signal.aborted || owner.flows.get(flowKey(def.id, authType)) !== flow) return { status: "error", message: "Authentication flow ended. Start again with /login." };
  if (flow.status === "completed") {
    deleteRuntimeAuthFlow(flow);
    return onComplete ? await onComplete(flow.locallyRecovered) : { status: "success", message: `✓ **${def.name}** authenticated.` };
  }
  if (flow.status === "failed") {
    deleteRuntimeAuthFlow(flow);
    return { status: "error", message: flow.error! };
  }
  return { status: "success", message: `Authentication for ${def.name}`, contentBlocks: [buildRuntimeAuthCard(def, flow)] };
}

// ── Step handlers ───────────────────────────────────────────────

/** Card 1 submitted → show Card 2 (auth method picker or direct form). */
async function handleStep1(
  session: NativeProviderAuthContext,
  modelRuntime: ModelRuntime,
  registry: ModelRegistry,
  data: Record<string, unknown>,
): Promise<AgentControlResult> {
  const providerId = String(data.provider || "").trim();
  const def = getProviderDef(modelRuntime, registry, providerId);
  if (!def) return { status: "error", message: `Unknown provider "${providerId}".` };

  // Count applicable methods
  const methods = [def.hasOAuth, def.hasApiKey, def.isCustom, def.hasExternalAuth].filter(Boolean).length;
  const hasLogoutOption = (await getProviderStatuses(modelRuntime, registry, session)).find((s) => s.def.id === providerId)?.authType !== "none";

  // If only one auth method (+ optional logout), go straight to the form
  if (methods === 1 && !hasLogoutOption) {
    if (def.hasOAuth) {
      return await startRuntimeAuth(session, modelRuntime, def, "oauth", recovered => showCard3OrComplete(session, def, providerId, def.name, registry, undefined, recovered));
    }
    if (def.hasApiKey) return await startRuntimeAuth(session, modelRuntime, def, "api_key", recovered => showCard3OrComplete(session, def, providerId, def.name, registry, undefined, recovered));
    if (def.isCustom) return { status: "success", message: `Configure ${def.name}`, contentBlocks: [buildCard2Config(def)] };
    if (def.hasExternalAuth) return { status: "success", message: `${def.name} uses external authentication`, contentBlocks: [buildCard2ExternalInfo(def)] };
  }

  // Multiple methods → show method picker
  return { status: "success", message: `Choose action for ${def.name}`, contentBlocks: [buildCard2AuthPicker(def)] };
}

/** Card 2 method picker submitted → show the actual auth form. */
async function handleStep1Method(
  session: NativeProviderAuthContext,
  modelRuntime: ModelRuntime,
  registry: ModelRegistry,
  data: Record<string, unknown>,
): Promise<AgentControlResult> {
  const providerId = String(data.provider || "").trim();
  const action = String(data.action || "").trim();
  const def = getProviderDef(modelRuntime, registry, providerId);
  if (!def) return { status: "error", message: `Unknown provider "${providerId}".` };

  if (action === "oauth") {
    if (!def.hasOAuth) return { status: "error", message: `**${def.name}** doesn't support OAuth.` };
    return await startRuntimeAuth(session, modelRuntime, def, "oauth", recovered => showCard3OrComplete(session, def, providerId, def.name, registry, undefined, recovered));
  }
  if (action === "api_key") {
    if (!def.hasApiKey) return { status: "error", message: `**${def.name}** doesn't support API key auth.` };
    return await startRuntimeAuth(session, modelRuntime, def, "api_key", recovered => showCard3OrComplete(session, def, providerId, def.name, registry, undefined, recovered));
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
    const status = (await getProviderStatuses(modelRuntime, registry, session)).find((s) => s.def.id === providerId);
    if (!status || status.authType === "none") return { status: "error", message: `**${def.name}** is not configured.` };
    const owner = getRuntimeAuthOwner(session), confirmationId = randomUUID();
    owner.logouts.clear();
    owner.logouts.set(confirmationId, { provider: providerId, expiresAt: Date.now() + 300_000, providerRevision: providerAuthState(modelRuntime, providerId).revision });
    return { status: "success", message: `Confirm removal for ${def.name}`, contentBlocks: [buildCard2Logout(def, statusLabel(status), confirmationId)] };
  }

  return { status: "error", message: `Unknown action: ${action}` };
}

/** Card 2 auth/config form submitted → continue the provider-owned flow. */
async function handleStep2(
  session: NativeProviderAuthContext,
  modelRuntime: ModelRuntime,
  registry: ModelRegistry,
  data: Record<string, unknown>,
): Promise<AgentControlResult> {
  const providerId = String(data.provider || "").trim();
  const method = String(data.method || "").trim();
  const def = getProviderDef(modelRuntime, registry, providerId);
  const name = def?.name || providerId;

  if (method === "runtime_present" || method === "runtime_continue" || method === "runtime_check" || method === "runtime_cancel" || method === "oauth_check" || method === "api_key") {
    const authType = String(data.auth_type || (method === "api_key" ? "api_key" : "oauth")) as AuthType;
    if (authType !== "api_key" && authType !== "oauth") return { status: "error", message: "Invalid authentication type." };
    const owner = getRuntimeAuthOwner(session);
    const flow = owner.flows.get(flowKey(providerId, authType));
    if (!flow) return { status: "error", message: `No active authentication flow for **${name}**. Start again with \`/login\`.` };
    if (Date.now() >= flow.expiresAt) {
      flow.controller.abort(new Error("Authentication flow expired"));
      flow.pending?.reject(new Error("Authentication flow expired"));
      deleteRuntimeAuthFlow(flow);
      return { status: "error", message: "Authentication flow expired. Start again with /login." };
    }
    if (data.flow_id !== flow.id || data.action_id !== flow.actionId) return { status: "error", message: "Stale or foreign authentication submission. Use the latest card in the initiating session." };
    if (method === "runtime_present") {
      if (!privateAuthResponse.getStore()) return { status: "error", message: "Open authentication from its private web dialog." };
      if (flow.status !== "running") return { status: "error", message: "Authentication flow ended. Start again with /login." };
      const oldActionId = flow.actionId;
      const card = buildRuntimeAuthCard(def!, flow); // Consume reveal and rotate continuation before returning.
      const nextActionId = flow.actionId;
      privateAuthResponse.getStore()!.rollback = () => {
        if (flow.actionId === nextActionId && owner.flows.get(flowKey(providerId, authType)) === flow) flow.actionId = oldActionId;
      };
      const pending = flow.pending?.prompt;
      const prompt = pending ? (({ signal: _signal, ...safe }) => safe)(pending) : null;
      return {
        status: "success", message: "Private authentication instructions.", contentBlocks: [card],
        authPresentation: {
          expires_at: flow.expiresAt, events: structuredClone(flow.events), prompt,
          action_data: { intent: "login-step2", provider: providerId, auth_type: authType, flow_id: flow.id, action_id: flow.actionId },
        },
      };
    }
    if (method === "runtime_cancel") {
      flow.actionId = randomUUID();
      flow.controller.abort(new Error("Authentication cancelled by user"));
      flow.pending?.reject(new Error("Authentication cancelled by user"));
      deleteRuntimeAuthFlow(flow);
      return { status: "success", message: `Authentication for **${name}** cancelled.` };
    }

    let previousVersion = flow.version;
    const delivery = privateAuthResponse.getStore();
    if (delivery) delivery.rollback = () => {
      // Provider input cannot be undone after delivery. Fail closed rather than
      // leave a running flow with no usable persisted continuation.
      flow.controller.abort(new Error("Authentication presentation delivery failed"));
      flow.pending?.reject(new Error("Authentication presentation delivery failed"));
      deleteRuntimeAuthFlow(flow);
    };
    if (method === "runtime_continue" || method === "oauth_check" || method === "api_key") {
      const value = String(data.auth_value ?? data.redirect_url ?? data.api_key ?? "");
      if (!flow.pending) return { status: "error", message: `**${name}** is not waiting for input. Use Check & Continue.` };
      if (flow.pending.prompt.type === "select" && !flow.pending.prompt.options.some(option => option.id === value)) return { status: "error", message: "Invalid authentication choice. Start again with /login." };
      flow.actionId = randomUUID(); // Consume before any provider callback.
      flow.pending.resolve(value);
      previousVersion = flow.version;
    }
    else flow.actionId = randomUUID();
    await waitForAuthFlowUpdate(flow, previousVersion, method === "runtime_check" ? 2_000 : 10_000);
    if (!isRuntimeAuthOwnerActive(owner) || flow.controller.signal.aborted || owner.flows.get(flowKey(providerId, authType)) !== flow) return { status: "error", message: "Authentication flow ended. Start again with /login." };

    if (flow.status === "completed") {
      deleteRuntimeAuthFlow(flow);
      return await showCard3OrComplete(session, def, providerId, name, registry, undefined, flow.locallyRecovered);
    }
    if (flow.status === "failed") {
      deleteRuntimeAuthFlow(flow);
      return { status: "error", message: flow.error || "Authentication failed." };
    }
    const card = buildRuntimeAuthCard(def!, flow);
    const pending = flow.pending?.prompt;
    const prompt = pending ? (({ signal: _signal, ...safe }) => safe)(pending) : null;
    return { status: "success", message: `Authentication for ${name}`, contentBlocks: [card],
      ...(privateAuthResponse.getStore() ? { authPresentation: {
        expires_at: flow.expiresAt, events: structuredClone(flow.events), prompt,
        action_data: { intent: "login-step2", provider: providerId, auth_type: authType, flow_id: flow.id, action_id: flow.actionId },
      } } : {}),
    };
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

    const owner = getRuntimeAuthOwner(session);
    let revision = -1;
    const active = () => isRuntimeAuthOwnerActive(owner) && revision === providerAuthState(modelRuntime, providerId).revision;
    try {
      const path = getModelsJsonPath();
      await serializeProviderAuth(modelRuntime, providerId, () => serializeModelsConfig(path, async () => {
        // Custom setup admission is ordered with credential writes. A later
        // setup cannot supersede a credential that is already committing.
        retireProviderAuth(modelRuntime, providerId);
        revision = providerAuthState(modelRuntime, providerId).revision;
        if (!active()) throw new Error("Authentication owner replaced");
        const original = existsSync(path) ? readFileSync(path, "utf-8") : null;
        const modelsJson = (original === null ? {} : JSON.parse(original)) as { providers?: Record<string, Record<string, unknown>> };
        // Never silently discard or migrate a legacy credential. That path
        // needs an explicit compatibility and historical-backup decision.
        const existingKey = modelsJson.providers?.[providerId]?.apiKey;
        if (existingKey && !(KEYLESS_LOCAL_PROVIDERS.has(providerId) && existingKey === KEYLESS_LOCAL_MARKER)) throw new Error("Legacy key migration required");
        const stored = (await modelRuntime.listCredentials()).some(entry => entry.providerId === providerId);
        const usableStoredKey = stored ? (await modelRuntime.getAuth(providerId))?.auth.apiKey : undefined;
        if (def.customFields?.some(field => field.key === "apiKey" && field.required) && !apiKey && !usableStoredKey) throw new Error("API key required");
        if (!active()) throw new Error("Authentication owner replaced");
        backupModelsConfig(path);
        if (!modelsJson.providers) modelsJson.providers = {};
        modelsJson.providers[providerId] = { baseUrl, api: def.customApi || "openai-completions",
          ...(KEYLESS_LOCAL_PROVIDERS.has(providerId) && !apiKey && !usableStoredKey ? { apiKey: KEYLESS_LOCAL_MARKER } : {}), models };
        let written = false;
        try {
          writeJsonFile(path, modelsJson);
          written = true;
          await modelRuntime.refresh({ allowNetwork: false });
          if (!active()) throw new Error("Authentication owner replaced");
          if (apiKey) await modelRuntime.login(providerId, "api_key", {
            prompt: async prompt => {
              if (!active() || prompt.type !== "secret") throw new Error("Unsupported custom credential prompt");
              return apiKey;
            },
            notify: () => {},
          });
          if (!active()) throw new CredentialSynchronizationError(providerId, "login", undefined, { cause: new Error("Authentication owner changed after commit") });
        } catch (error) {
          // The public runtime distinguishes a committed credential from a
          // post-write snapshot failure. Never restore a superseded credential.
          if (error instanceof CredentialSynchronizationError) throw error;
          if (written) {
            if (original === null) unlinkSync(path);
            else { writeFileSync(path, original, { encoding: "utf-8", mode: 0o600 }); chmodSync(path, 0o600); }
            await modelRuntime.refresh({ allowNetwork: false });
          }
          throw error;
        }
      }));
    } catch (error) {
      return { status: "error", message: error instanceof CredentialSynchronizationError
        ? "The credential was saved, but model availability could not be refreshed. Retry model refresh; do not restore an older credential."
        : "Custom authentication configuration failed. Supply a required key or review legacy model configuration, then retry. The prior configuration and stored credential are retained." };
    }
    return await showCard3OrComplete(session, def, providerId, name, registry, revision);
  }

  if (method === "logout") {
    const owner = getRuntimeAuthOwner(session), id = typeof data.confirmation_id === "string" ? data.confirmation_id : "";
    const confirmation = owner.logouts.get(id);
    if (!confirmation || confirmation.provider !== providerId || confirmation.expiresAt <= Date.now() || confirmation.providerRevision !== providerAuthState(modelRuntime, providerId).revision) return { status: "error", message: "Stale or foreign logout confirmation. Use /logout or request a new confirmation." };
    owner.logouts.delete(id);
    retireProviderAuth(modelRuntime, providerId);
    await serializeProviderAuth(modelRuntime, providerId, async () => {
      assertNativeAuthCurrent(session);
      if (def?.isCustom) await removeCustomModelConfig(modelRuntime, providerId, true, () => assertNativeAuthCurrent(session));
      else await modelRuntime.logout(providerId);
      assertNativeAuthCurrent(session);
    });
    return { status: "success", message: `✓ **${name}** removed. New configuration backups omit API keys; credentials are not snapshotted.` };
  }

  return { status: "error", message: `Unknown method: ${method}` };
}

async function removeCustomModelConfig(modelRuntime: ModelRuntime, providerId: string, removeCredential: boolean, assertCurrent: () => void = () => {}): Promise<boolean> {
  const path = getModelsJsonPath();
  return serializeModelsConfig(path, async () => {
    assertCurrent();
    const original = existsSync(path) ? readFileSync(path, "utf-8") : null;
    const config = (original === null ? {} : JSON.parse(original)) as { providers?: Record<string, unknown> };
    const configured = Boolean(config.providers?.[providerId]);
    let written = false;
    try {
      // Configuration errors must not remove an otherwise working credential.
      if (configured) {
        backupModelsConfig(path);
        delete config.providers![providerId];
        writeJsonFile(path, config);
        written = true;
        await modelRuntime.refresh({ allowNetwork: false });
      }
      assertCurrent();
      if (removeCredential) await modelRuntime.logout(providerId);
      assertCurrent();
    } catch (error) {
      if (written && !(error instanceof CredentialSynchronizationError)) {
        assertCurrent();
        writeFileSync(path, original!, { encoding: "utf-8", mode: 0o600 });
        chmodSync(path, 0o600);
        await modelRuntime.refresh({ allowNetwork: false });
      }
      throw error;
    }
    return configured;
  });
}

/** Authentication never changes the active model; even one model needs confirmation. */
async function showCard3OrComplete(
  session: NativeProviderAuthContext,
  def: ProviderDef | undefined,
  providerId: string,
  name: string,
  registry: ModelRegistry,
  expectedRevision?: number,
  locallyRecovered = false,
): Promise<AgentControlResult> {
  const owner = getRuntimeAuthOwner(session);
  const providerRevision = expectedRevision ?? providerAuthState(owner.runtime, providerId).revision;
  if (!locallyRecovered) await registry.refresh();
  if (!isRuntimeAuthOwnerActive(owner) || owner.chatJid !== getChatJid() || providerRevision !== providerAuthState(owner.runtime, providerId).revision) return { status: "error", message: "Authentication session changed. Use /login in the active session." };
  const models = registry.getAll().filter((m) => m.provider === providerId);
  if (models.length === 0) {
    return { status: "success", message: `✓ **${name}** authenticated, but no models found for this provider. Use \`/model\` to check available models.` };
  }
  const activationId = randomUUID();
  owner.activations.clear();
  owner.activations.set(activationId, { provider: providerId, models: new Set(models.map(model => model.id)), expiresAt: Date.now() + 300_000, providerRevision });

  return {
    status: "success",
    message: `${name} — select a model`,
    contentBlocks: [buildCard3(def!, models, activationId)],
  };
}

/** Card 3 submitted → activate model. */
async function handleStep3(
  session: NativeProviderAuthContext,
  data: Record<string, unknown>,
): Promise<AgentControlResult> {
  const providerId = String(data.provider || "").trim();
  const modelId = String(data.model || "").trim();
  if (!providerId) return { status: "error", message: "No provider selected." };
  if (!modelId) return { status: "error", message: "No model selected." };
  const owner = getRuntimeAuthOwner(session);
  const id = typeof data.activation_id === "string" ? data.activation_id : "";
  const activation = owner.activations.get(id);
  if (!activation || activation.expiresAt <= Date.now() || activation.provider !== providerId || !activation.models.has(modelId) || activation.providerRevision !== providerAuthState(owner.runtime, providerId).revision) return { status: "error", message: "Stale or foreign model activation. Authenticate again or use /model explicitly." };
  owner.activations.delete(id);

  assertNativeAuthCurrent(session);
  return session.activateModel(providerId, modelId);
}

// ── Command handlers ────────────────────────────────────────────

export function handleLogin(session: NativeProviderAuthContext, modelRegistry: ModelRegistry, command: LoginCommand): Promise<AgentControlResult> {
  return runOwnedAuthCommand(session, () => handleLoginOwned(session, modelRegistry, command));
}

async function handleLoginOwned(
  session: NativeProviderAuthContext,
  modelRegistry: ModelRegistry,
  command: LoginCommand,
): Promise<AgentControlResult> {
  const existingOwner = runtimeAuthOwners.get(session);
  if (disposedAuthSessions.has(session) || (existingOwner && existingOwner.chatJid !== getChatJid())) return { status: "error", message: "Provider authentication belongs to its initiating session and chat." };
  const modelRuntime = session.runtime;

  // Internal routing from card submissions. Authentication failure text is
  // deliberately generic because provider diagnostics can contain credentials.
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
    return data ? handleStep1(session, modelRuntime, modelRegistry, data) : { status: "error", message: "Invalid card data." };
  }
  if (command.provider?.startsWith("__step1method ")) {
    const data = parseCardData(command.provider.slice(14));
    return data ? handleStep1Method(session, modelRuntime, modelRegistry, data) : { status: "error", message: "Invalid card data." };
  }
  if (command.provider?.startsWith("__step2 ")) {
    const data = parseCardData(command.provider.slice(8));
    return data ? handleStep2(session, modelRuntime, modelRegistry, data) : { status: "error", message: "Invalid card data." };
  }
  if (command.provider?.startsWith("__step3 ")) {
    const data = parseCardData(command.provider.slice(8));
    return data ? handleStep3(session, data) : { status: "error", message: "Invalid card data." };
  }

  // No args → show Card 1
  const statuses = await getProviderStatuses(modelRuntime, modelRegistry, session);
  assertNativeAuthCurrent(session);
  return { status: "success", message: "Provider authentication", contentBlocks: [buildCard1(statuses)] };
}

export function handleLogout(session: NativeProviderAuthContext, modelRegistry: ModelRegistry, command: LogoutCommand): Promise<AgentControlResult> {
  return runOwnedAuthCommand(session, () => handleLogoutOwned(session, modelRegistry, command));
}

async function handleLogoutOwned(
  session: NativeProviderAuthContext,
  modelRegistry: ModelRegistry,
  command: LogoutCommand,
): Promise<AgentControlResult> {
  const existingOwner = runtimeAuthOwners.get(session);
  if (disposedAuthSessions.has(session) || (existingOwner && existingOwner.chatJid !== getChatJid())) return { status: "error", message: "Provider authentication belongs to its initiating session and chat." };
  const modelRuntime = session.runtime;

  if (command.provider) {
    const providerId = command.provider.trim().toLowerCase();
    retireProviderAuth(modelRuntime, providerId);
    const removed = await serializeProviderAuth(modelRuntime, providerId, async () => {
      assertNativeAuthCurrent(session);
      const credentials = await modelRuntime.listCredentials();
      assertNativeAuthCurrent(session);
      const stored = credentials.some((entry) => entry.providerId === providerId);
      const custom = getProviderDef(modelRuntime, modelRegistry, providerId)?.isCustom;
      const configured = custom ? await removeCustomModelConfig(modelRuntime, providerId, stored, () => assertNativeAuthCurrent(session)) : false;
      assertNativeAuthCurrent(session);
      if (stored && !custom) await modelRuntime.logout(providerId);
      assertNativeAuthCurrent(session);
      return stored || configured;
    });
    if (!removed) return { status: "error", message: `**${providerId}** is not logged in.` };
    return { status: "success", message: `✓ Logged out from **${providerId}**.` };
  }

  const statuses = await getProviderStatuses(modelRuntime, modelRegistry, session);
  assertNativeAuthCurrent(session);
  return { status: "success", message: "Provider authentication", contentBlocks: [buildCard1(statuses)] };
}
