/**
 * web/handlers/general-settings.ts — Persist/apply General settings from the web UI.
 */

import {
  getSessionIsolationLevel,
  setSessionIsolationLevel,
  type SessionIsolationLevel,
} from "../../../extensions/session-status.js";
import {
  getIdentityConfig,
  getOrCreateWebWidgetToken,
  getToolUseBudget,
  getWebRuntimeConfig,
  getSearchMatchMode,
  getScopedModelsOnly,
  setAssistantAvatar,
  setAssistantName,
  setToolUseBudget,
  getToolOutputStoreThreshold,
  setToolOutputStoreThreshold,
  setSearchMatchMode,
  setScopedModelsOnly,
  setUserAvatar,
  setUserAvatarBackground,
  setUserName,
  rotateWebWidgetToken,
  setWebComposeUploadLimitMb,
  setWebTerminalEnabled,
  setWebWorkspaceUploadLimitMb,
  type SearchMatchMode,
} from "../../../core/config.js";
import { generateTotpQr } from "../../../utils/totp-qr.js";
import { ensureAvatarCache, resolveAvatarUrl, type AvatarKind } from "../media/avatar-service.js";
import { getServerUiState, admitServerUiState, type ServerUiStatePatch } from "../ui-state.js";

export interface GeneralSettingsData {
  assistantName: string;
  assistantAvatar: string;
  userName: string;
  userAvatar: string;
  userAvatarBackground: string;

  webTerminalEnabled: boolean;
  composeUploadLimitMb: number;
  workspaceUploadLimitMb: number;
  toolUseBudget: number;
  toolOutputStoreThreshold: number;

  instanceTotp: {
    configured: boolean;
    issuer: string;
    label: string;
    secret: string;
    otpauth: string;
    qrSvg: string;
  };
  sessionIsolation: "none" | "summary" | "full";
  searchMatchMode: "or" | "and";
  scopedModelsOnly: boolean;

  uiTheme: string;
  uiTint: string | null;
  outputPad: number;
  widgetToken: string;
}

export interface GeneralSettingsInput {
  assistantName?: unknown;
  assistantAvatar?: unknown;
  userName?: unknown;
  userAvatar?: unknown;

  webTerminalEnabled?: unknown;
  composeUploadLimitMb?: unknown;
  workspaceUploadLimitMb?: unknown;
  toolUseBudget?: unknown;
  toolOutputStoreThreshold?: unknown;

  sessionIsolation?: unknown;
  searchMatchMode?: unknown;
  scopedModelsOnly?: unknown;

  uiTheme?: unknown;
  uiTint?: unknown;
  outputPad?: unknown;
}

export interface GeneralSettingsProfileUpdatePayload {
  agent_id: "default";
  agent_name: string;
  agent_avatar: string | null;
  user_name: string | null;
  user_avatar: string | null;
  user_avatar_background: string | null;
}

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalInt(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

async function maybePrecacheAvatar(kind: AvatarKind, source: string | null | undefined): Promise<void> {
  if (!source) return;
  const cached = await ensureAvatarCache(kind, source, { refresh: true });
  if (!cached?.file) {
    throw new Error(`Failed to prepare ${kind} avatar image.`);
  }
}

function withAvatarVersion(url: string | null, version?: string): string | null {
  if (!url || !version) return url;
  return `${url.split("?")[0]}?v=${encodeURIComponent(version)}`;
}

export function buildGeneralSettingsProfileUpdate(
  settings: GeneralSettingsData,
  version?: string,
): GeneralSettingsProfileUpdatePayload {
  return {
    agent_id: "default",
    agent_name: settings.assistantName || "PiClaw",
    agent_avatar: withAvatarVersion(resolveAvatarUrl("agent", settings.assistantAvatar), version),
    user_name: settings.userName || null,
    user_avatar: withAvatarVersion(resolveAvatarUrl("user", settings.userAvatar), version),
    user_avatar_background: settings.userAvatarBackground || null,
  };
}

function buildTotpSettingsData(): GeneralSettingsData["instanceTotp"] {
  const identity = getIdentityConfig();
  const web = getWebRuntimeConfig();
  const secret = (web.totpSecret || "").trim();
  const issuer = identity.assistantName || "Piclaw";
  const label = identity.userName ? `${issuer}:${identity.userName}` : issuer;

  if (!secret) {
    return {
      configured: false,
      issuer,
      label,
      secret: "",
      otpauth: "",
      qrSvg: "",
    };
  }

  const qr = generateTotpQr({ secret, issuer, label });
  return {
    configured: true,
    issuer: qr.issuer,
    label: qr.label,
    secret: qr.secret,
    otpauth: qr.otpauth,
    qrSvg: qr.svg,
  };
}

export function getGeneralSettingsData(): GeneralSettingsData {
  const uiState = getServerUiState();
  const identity = getIdentityConfig();
  const web = getWebRuntimeConfig();
  const uiTheme = uiState.ui_theme;
  const uiOutput = uiState.ui_output;
  return {
    assistantName: identity.assistantName || "PiClaw",
    assistantAvatar: identity.assistantAvatar || "",
    userName: identity.userName || "",
    userAvatar: identity.userAvatar || "",
    userAvatarBackground: identity.userAvatarBackground || "",

    webTerminalEnabled: web.terminalEnabled,
    composeUploadLimitMb: web.composeUploadLimitMb,
    workspaceUploadLimitMb: web.workspaceUploadLimitMb,
    toolUseBudget: getToolUseBudget(),
    toolOutputStoreThreshold: getToolOutputStoreThreshold(),

    instanceTotp: buildTotpSettingsData(),
    sessionIsolation: getSessionIsolationLevel(),
    searchMatchMode: getSearchMatchMode(),
    scopedModelsOnly: getScopedModelsOnly(),

    uiTheme: uiTheme.theme,
    uiTint: uiTheme.tint,
    outputPad: uiOutput.outputPad,
    widgetToken: getOrCreateWebWidgetToken(),
  };
}

export function rotateWidgetTokenSettings(): GeneralSettingsData {
  rotateWebWidgetToken();
  return getGeneralSettingsData();
}

const RETIRED_EXECUTION_SETTINGS=["sessionAutoRotate","sessionMaxSizeMb","sessionMaxLines","sessionMaxCompactions","automaticRecoveryEnabled","automaticRecoveryMaxAttempts","automaticRecoveryTotalBudgetMs","automaticRecoveryEffectiveBudgetMs"] as const;

export async function saveGeneralSettings(input: GeneralSettingsInput, authorise: () => void = () => {}, signal?: AbortSignal): Promise<GeneralSettingsData> {
  const current = () => { signal?.throwIfAborted(); authorise(); };
  current();
  const retired=RETIRED_EXECUTION_SETTINGS.filter(key=>Object.hasOwn(input,key));
  if(retired.length)throw Error('Unsupported native general settings: '+retired.join(', ')+'. No settings were changed.');
  const nextAssistantName = normalizeOptionalString(input.assistantName);
  if (nextAssistantName !== undefined) {
    setAssistantName(nextAssistantName || "PiClaw");
  }

  const nextAssistantAvatar = normalizeOptionalString(input.assistantAvatar);
  if (nextAssistantAvatar !== undefined) {
    const effectiveAvatar = nextAssistantAvatar || "";
    await maybePrecacheAvatar("agent", effectiveAvatar); current();
    setAssistantAvatar(effectiveAvatar);
  }

  const nextUserName = normalizeOptionalString(input.userName);
  if (nextUserName !== undefined) {
    setUserName(nextUserName || "");
  }

  const nextUserAvatar = normalizeOptionalString(input.userAvatar);
  if (nextUserAvatar !== undefined) {
    const effectiveAvatar = nextUserAvatar || "";
    await maybePrecacheAvatar("user", effectiveAvatar); current();
    setUserAvatar(effectiveAvatar);
    if (nextUserAvatar === null) {
      setUserAvatarBackground("");
    }
  }

  const nextWebTerminalEnabled = normalizeOptionalBoolean(input.webTerminalEnabled);
  if (nextWebTerminalEnabled !== undefined) {
    setWebTerminalEnabled(nextWebTerminalEnabled);
  }

  const nextComposeUploadLimitMb = normalizeOptionalInt(input.composeUploadLimitMb, 1, 1024);
  if (nextComposeUploadLimitMb !== undefined) {
    setWebComposeUploadLimitMb(nextComposeUploadLimitMb);
  }

  const nextWorkspaceUploadLimitMb = normalizeOptionalInt(input.workspaceUploadLimitMb, 1, 1024);
  if (nextWorkspaceUploadLimitMb !== undefined) {
    setWebWorkspaceUploadLimitMb(nextWorkspaceUploadLimitMb);
  }

  const nextToolUseBudget = normalizeOptionalInt(input.toolUseBudget, 8, 512);
  if (nextToolUseBudget !== undefined) {
    setToolUseBudget(nextToolUseBudget);
  }

  const nextToolOutputThreshold = normalizeOptionalInt(input.toolOutputStoreThreshold, 500, 100000);
  if (nextToolOutputThreshold !== undefined) {
    setToolOutputStoreThreshold(nextToolOutputThreshold);
  }

  const nextSessionIsolation = typeof input.sessionIsolation === "string" ? input.sessionIsolation.trim().toLowerCase() : undefined;
  if (nextSessionIsolation === "none" || nextSessionIsolation === "summary" || nextSessionIsolation === "full") {
    setSessionIsolationLevel(nextSessionIsolation as SessionIsolationLevel);
  }

  const nextSearchMatchMode = typeof input.searchMatchMode === "string" ? input.searchMatchMode.trim().toLowerCase() : undefined;
  if (nextSearchMatchMode === "or" || nextSearchMatchMode === "and") {
    setSearchMatchMode(nextSearchMatchMode as SearchMatchMode);
  }

  const nextScopedModelsOnly = normalizeOptionalBoolean(input.scopedModelsOnly);
  if (nextScopedModelsOnly !== undefined) {
    setScopedModelsOnly(nextScopedModelsOnly);
  }

  const nextUiTheme = typeof input.uiTheme === "string" ? input.uiTheme.trim().toLowerCase() : undefined;
  const nextUiTint = input.uiTint === undefined
    ? undefined
    : (typeof input.uiTint === "string" && input.uiTint.trim())
      ? input.uiTint.trim()
      : null;
  const uiPatch: ServerUiStatePatch = {};
  if (nextUiTheme !== undefined || nextUiTint !== undefined) uiPatch.ui_theme = {
    ...(nextUiTheme !== undefined ? { theme: nextUiTheme || "default" } : {}),
    ...(nextUiTint !== undefined ? { tint: nextUiTint } : {}),
  };
  const nextOutputPad = normalizeOptionalInt(input.outputPad, 0, 24);
  if (nextOutputPad !== undefined) uiPatch.ui_output = { outputPad: nextOutputPad };
  current();
  // Response preparation may create the widget token or fail reading config.
  // Complete that work before SQL; no fallible getters follow the commit.
  const data = getGeneralSettingsData();
  if (!Object.keys(uiPatch).length) return data;
  const uiState = await admitServerUiState(uiPatch, current, signal);
  return { ...data, uiTheme: uiState.ui_theme.theme, uiTint: uiState.ui_theme.tint, outputPad: uiState.ui_output.outputPad };
}
