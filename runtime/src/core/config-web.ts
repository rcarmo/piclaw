/** Web server, authentication, session, terminal, VNC, and upload configuration. */

import { createLogger } from "../utils/logger.js";
import { randomBytes } from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./config-store.js";
import { pickBoolean, pickNumber, pickString } from "./config-helpers.js";
import {
  DEFAULT_TLS_CERT_PATH,
  DEFAULT_TLS_KEY_PATH,
  getConfigPath,
  getDomainConfigOptions,
  HAS_DEFAULT_TLS,
  piclawConfig,
  readCliArg,
  webConfig,
} from "./config-context.js";
import { getNetworkBootstrapConfig } from "./config-network-bootstrap.js";
import { getWebSecretBootstrapConfig, setWebSecretCompatibilityValue } from "./config-secrets.js";
import {
  boolField,
  integerField,
  readDomainConfig,
  registerDomainConfig,
  stringField,
  writeDomainConfigField,
  type DomainConfigField,
  type DomainConfigRuntimeOptions,
} from "./domain-config.js";

const configWebTotpSecret = pickString(webConfig, [
  "totpSecret",
  "totp_secret",
  "webTotpSecret",
  "web_totp_secret",
  "PICLAW_WEB_TOTP_SECRET",
  "PICLAW_TOTP_SECRET",
]);
const configWebTotpWindow = pickNumber(webConfig, [
  "totpWindow",
  "totp_window",
  "webTotpWindow",
  "web_totp_window",
  "PICLAW_WEB_TOTP_WINDOW",
]);
const configWebSessionTtl = pickNumber(webConfig, [
  "sessionTtl",
  "session_ttl",
  "webSessionTtl",
  "web_session_ttl",
  "PICLAW_WEB_SESSION_TTL",
]);
const configWebInternalSecret = pickString(webConfig, [
  "internalSecret",
  "internal_secret",
  "webInternalSecret",
  "web_internal_secret",
  "PICLAW_WEB_INTERNAL_SECRET",
  "PICLAW_INTERNAL_SECRET",
]);
const configWebWidgetToken = pickString(webConfig, [
  "widgetToken",
  "widget_token",
  "webWidgetToken",
  "web_widget_token",
  "PICLAW_WEB_WIDGET_TOKEN",
]);
const configWebPasskeyMode = pickString(webConfig, [
  "passkeyMode",
  "passkey_mode",
  "webPasskeyMode",
  "web_passkey_mode",
  "PICLAW_WEB_PASSKEY_MODE",
]);
const configWebIdleTimeout = pickNumber(webConfig, [
  "idleTimeout",
  "idle_timeout",
  "webIdleTimeout",
  "web_idle_timeout",
  "PICLAW_WEB_IDLE_TIMEOUT",
]);
const configWebPushSubscriptionCap = pickNumber(webConfig, [
  "pushSubscriptionCap",
  "push_subscription_cap",
  "webPushSubscriptionCap",
  "web_push_subscription_cap",
  "PICLAW_WEB_PUSH_SUBSCRIPTION_CAP",
]);
const configWebPushVapidSubject = pickString(webConfig, [
  "pushVapidSubject",
  "push_vapid_subject",
  "webPushVapidSubject",
  "web_push_vapid_subject",
  "PICLAW_WEB_PUSH_VAPID_SUBJECT",
]);
const configWebTerminalImageProtocol = pickString(webConfig, [
  "terminalImageProtocol",
  "terminal_image_protocol",
  "webTerminalImageProtocol",
  "web_terminal_image_protocol",
  "PICLAW_TERMINAL_IMAGE_PROTOCOL",
]);
const configWebComposeUploadLimitMb = pickNumber(webConfig, [
  "composeUploadLimitMb",
  "compose_upload_limit_mb",
  "webComposeUploadLimitMb",
  "web_compose_upload_limit_mb",
  "PICLAW_WEB_COMPOSE_UPLOAD_LIMIT_MB",
]);
const configWebWorkspaceUploadLimitMb = pickNumber(webConfig, [
  "workspaceUploadLimitMb",
  "workspace_upload_limit_mb",
  "webWorkspaceUploadLimitMb",
  "web_workspace_upload_limit_mb",
  "PICLAW_WEB_WORKSPACE_UPLOAD_LIMIT_MB",
]);
const configTrustProxy = pickBoolean(webConfig, [
  "trustProxy",
  "trust_proxy",
  "PICLAW_TRUST_PROXY",
]);

/** Parse a numeric port string, falling back to `fallback` on failure. */
function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseOptionalIntegerArg(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseLegacyPushSubscriptionCap(value: string): number {
  const parsed = Number.parseInt(value || "32", 10);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 32;
}

function parseLegacyNonEmptyString(value: string, fallback: string): string {
  return value.trim() || fallback;
}

// ---------------------------------------------------------------------------
// Web channel configuration (HTTP server, TLS, auth).
// ---------------------------------------------------------------------------

const ENV_WEB_PORT = parseInt(process.env.PICLAW_WEB_PORT || "8080", 10);
const CLI_WEB_PORT = readCliArg("--port", "-p");
const CLI_WEB_HOST = readCliArg("--host");
const CLI_WEB_IDLE_TIMEOUT = readCliArg("--idle-timeout");
const CLI_WEB_IDLE_TIMEOUT_VALUE = parseOptionalIntegerArg(CLI_WEB_IDLE_TIMEOUT);
const CLI_WEB_TLS_CERT = readCliArg("--tls-cert");
const CLI_WEB_TLS_KEY = readCliArg("--tls-key");

/** Typed web server network/TLS settings grouped for WebChannel wiring. */
export interface WebServerConfig {
  port: number;
  host: string;
  idleTimeout: number;
  tlsCert: string;
  tlsKey: string;
}

/** Mutable web auth/session/runtime settings grouped for auth and UI wiring. */
const WEB_PASSKEY_MODES = ["totp-fallback", "totp-only", "passkey-only"] as const;
export type WebPasskeyMode = (typeof WEB_PASSKEY_MODES)[number];

function parseWebPasskeyMode(value: unknown): WebPasskeyMode {
  if (typeof value !== "string") throw new Error("Invalid string domain config value for passkeyMode");
  const normalized = value.trim().toLowerCase();
  if ((WEB_PASSKEY_MODES as readonly string[]).includes(normalized)) return normalized as WebPasskeyMode;
  throw new Error("Domain config value is not allowed for passkeyMode");
}

export interface WebRuntimeConfig {
  totpSecret: string;
  totpWindow: number;
  sessionTtl: number;
  internalSecret: string;
  widgetToken: string;
  passkeyMode: WebPasskeyMode;
  terminalEnabled: boolean;
  terminalImageProtocol: string;
  pushSubscriptionCap: number;
  pushVapidSubject: string;
  composeUploadLimitMb: number;
  workspaceUploadLimitMb: number;
  notificationDebugLabels: boolean;
  sanitizeSvgFences: boolean;
  vncAllowDirect: boolean;
  vncTargetsRaw: string;
  debugCardSubmissions: boolean;
  trustProxy: boolean;
}

export function isDefaultWebTerminalEnabled(platform = process.platform): boolean {
  return platform === "linux" || platform === "darwin";
}

export function isDefaultWebVncDirectEnabled(platform = process.platform): boolean {
  return platform === "linux" || platform === "darwin" || platform === "win32";
}

function clampWorkspaceUploadLimitMb(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1024, Math.max(1, Math.round(parsed)));
}

const legacyWebTotpWindow = pickNumber(piclawConfig, ["webTotpWindow", "totpWindow"]);
const legacyWebSessionTtl = pickNumber(piclawConfig, ["webSessionTtl", "sessionTtl"]);
const legacyWebPasskeyMode = pickString(piclawConfig, ["webPasskeyMode", "passkeyMode"]);
const legacyWebIdleTimeout = pickNumber(piclawConfig, ["webIdleTimeout", "idleTimeout"]);
const legacyWebPushSubscriptionCap = pickNumber(piclawConfig, ["webPushSubscriptionCap", "pushSubscriptionCap"]);
const legacyWebPushVapidSubject = pickString(piclawConfig, ["webPushVapidSubject", "pushVapidSubject"]);
const legacyWebTerminalImageProtocol = pickString(piclawConfig, ["webTerminalImageProtocol", "terminalImageProtocol"]);
const nestedWebTerminalEnabled = pickBoolean(webConfig, ["terminalEnabled", "webTerminalEnabled", "PICLAW_WEB_TERMINAL_ENABLED"]);
const legacyWebTerminalEnabled = pickBoolean(piclawConfig, ["webTerminalEnabled"]);
const nestedWebNotificationDebugLabels = pickBoolean(webConfig, ["notificationDebugLabels", "notification_debug_labels", "webNotificationDebugLabels", "PICLAW_WEB_NOTIFICATION_DEBUG_LABELS"]);
const legacyWebNotificationDebugLabels = pickBoolean(piclawConfig, ["webNotificationDebugLabels"]);
const nestedWebVncAllowDirect = pickBoolean(webConfig, ["vncAllowDirect", "vnc_allow_direct", "webVncAllowDirect", "PICLAW_WEB_VNC_ALLOW_DIRECT", "PICLAW_VNC_ALLOW_DIRECT"]);
const legacyWebVncAllowDirect = pickBoolean(piclawConfig, ["webVncAllowDirect"]);
const nestedWebVncTargets = pickString(webConfig, ["vncTargets", "vnc_targets", "webVncTargets", "PICLAW_WEB_VNC_TARGETS", "PICLAW_VNC_TARGETS"]);
const legacyWebVncTargets = pickString(piclawConfig, ["webVncTargets"]);
const legacyWebComposeUploadLimitMb = pickNumber(piclawConfig, ["webComposeUploadLimitMb", "composeUploadLimitMb"]);
const legacyWebWorkspaceUploadLimitMb = pickNumber(piclawConfig, ["webWorkspaceUploadLimitMb", "workspaceUploadLimitMb"]);
const legacyWebTrustProxy = pickBoolean(piclawConfig, ["trustProxy", "PICLAW_TRUST_PROXY"]);
const debugCards = pickBoolean(piclawConfig, ["debugCardSubmissions", "PICLAW_DEBUG_CARD_SUBMISSIONS"]);

function getWebOrdinaryDomainConfigOptions(): DomainConfigRuntimeOptions {
  const options = getDomainConfigOptions();
  if (CLI_WEB_IDLE_TIMEOUT_VALUE === undefined) return options;
  return {
    ...options,
    bootstrapValues: { idleTimeout: CLI_WEB_IDLE_TIMEOUT_VALUE },
  };
}

type WebOrdinaryDomainConfig = Pick<
  WebRuntimeConfig,
  | "totpWindow"
  | "sessionTtl"
  | "passkeyMode"
  | "terminalEnabled"
  | "terminalImageProtocol"
  | "pushSubscriptionCap"
  | "pushVapidSubject"
  | "composeUploadLimitMb"
  | "workspaceUploadLimitMb"
  | "notificationDebugLabels"
  | "sanitizeSvgFences"
  | "vncAllowDirect"
  | "debugCardSubmissions"
  | "trustProxy"
> & {
  idleTimeout: number;
  persistThinking: boolean;
  persistThinkingMaxChars: number;
  vncTargets: string;
  contentMaxChars: number;
  contentPreviewChars: number;
};

const webOrdinaryDomainSchema = registerDomainConfig<WebOrdinaryDomainConfig>({
  domain: "web",
  retiredKeys: ["uiMode"],
  fields: {
    idleTimeout: integerField({ key: "idleTimeout", owner: "web", defaultValue: configWebIdleTimeout ?? legacyWebIdleTimeout ?? 0, min: 0, bounds: ">=0", persistence: "json-config", precedence: ["bootstrap-cli-env", "compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_WEB_IDLE_TIMEOUT", replacement: "domains.web.idleTimeout", removalVersion: "3.0.0" }] }),
    persistThinking: boolField({ key: "persistThinking", owner: "web", defaultValue: false, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_WEB_PERSIST_THINKING", replacement: "domains.web.persistThinking", removalVersion: "3.0.0" }] }),
    persistThinkingMaxChars: integerField({ key: "persistThinkingMaxChars", owner: "web", defaultValue: 100000, min: 1, bounds: "positive integer", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_WEB_PERSIST_THINKING_MAX_CHARS", replacement: "domains.web.persistThinkingMaxChars", removalVersion: "3.0.0", parse: (raw) => { const parsed = Number(raw); return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 100000; } }] }),
    totpWindow: integerField({ key: "totpWindow", owner: "web", defaultValue: configWebTotpWindow ?? legacyWebTotpWindow ?? 1, min: 0, bounds: ">=0", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_WEB_TOTP_WINDOW", replacement: "domains.web.totpWindow", removalVersion: "3.0.0" }] }),
    sessionTtl: integerField({ key: "sessionTtl", owner: "web", defaultValue: configWebSessionTtl ?? legacyWebSessionTtl ?? (7 * 24 * 60 * 60), min: 1, bounds: "positive integer", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_WEB_SESSION_TTL", replacement: "domains.web.sessionTtl", removalVersion: "3.0.0" }] }),
    passkeyMode: {
      ...stringField({ key: "passkeyMode", owner: "web", defaultValue: configWebPasskeyMode ?? legacyWebPasskeyMode ?? "totp-fallback", allowedValues: WEB_PASSKEY_MODES, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_WEB_PASSKEY_MODE", replacement: "domains.web.passkeyMode", removalVersion: "3.0.0" }] }),
      validate: parseWebPasskeyMode,
    } as DomainConfigField<WebPasskeyMode>,
    pushSubscriptionCap: integerField({ key: "pushSubscriptionCap", owner: "web", defaultValue: configWebPushSubscriptionCap ?? legacyWebPushSubscriptionCap ?? 32, min: 1, bounds: "positive integer", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_WEB_PUSH_SUBSCRIPTION_CAP", replacement: "domains.web.pushSubscriptionCap", removalVersion: "3.0.0", parse: parseLegacyPushSubscriptionCap }] }),
    pushVapidSubject: stringField({ key: "pushVapidSubject", owner: "web", defaultValue: configWebPushVapidSubject ?? legacyWebPushVapidSubject ?? "mailto:notifications@localhost.invalid", nonEmpty: true, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_WEB_PUSH_VAPID_SUBJECT", replacement: "domains.web.pushVapidSubject", removalVersion: "3.0.0", parse: (raw) => parseLegacyNonEmptyString(raw, "mailto:notifications@localhost.invalid") }] }),
    terminalEnabled: boolField({ key: "terminalEnabled", owner: "web", defaultValue: nestedWebTerminalEnabled ?? legacyWebTerminalEnabled ?? isDefaultWebTerminalEnabled(), persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_WEB_TERMINAL_ENABLED", replacement: "domains.web.terminalEnabled", removalVersion: "3.0.0" }] }),
    terminalImageProtocol: stringField({ key: "terminalImageProtocol", owner: "web", defaultValue: configWebTerminalImageProtocol ?? legacyWebTerminalImageProtocol ?? "iterm2", nonEmpty: true, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_TERMINAL_IMAGE_PROTOCOL", replacement: "domains.web.terminalImageProtocol", removalVersion: "3.0.0", parse: (raw) => parseLegacyNonEmptyString(raw, "iterm2") }] }),
    composeUploadLimitMb: integerField({ key: "composeUploadLimitMb", owner: "web", defaultValue: configWebComposeUploadLimitMb ?? legacyWebComposeUploadLimitMb ?? 32, min: 1, max: 1024, bounds: "1..1024", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_WEB_COMPOSE_UPLOAD_LIMIT_MB", replacement: "domains.web.composeUploadLimitMb", removalVersion: "3.0.0" }] }),
    workspaceUploadLimitMb: integerField({ key: "workspaceUploadLimitMb", owner: "web", defaultValue: configWebWorkspaceUploadLimitMb ?? legacyWebWorkspaceUploadLimitMb ?? configWebComposeUploadLimitMb ?? legacyWebComposeUploadLimitMb ?? 256, min: 1, max: 1024, bounds: "1..1024", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_WEB_WORKSPACE_UPLOAD_LIMIT_MB", replacement: "domains.web.workspaceUploadLimitMb", removalVersion: "3.0.0" }] }),
    notificationDebugLabels: boolField({ key: "notificationDebugLabels", owner: "web", defaultValue: nestedWebNotificationDebugLabels ?? legacyWebNotificationDebugLabels ?? false, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_WEB_NOTIFICATION_DEBUG_LABELS", replacement: "domains.web.notificationDebugLabels", removalVersion: "3.0.0" }] }),
    sanitizeSvgFences: boolField({ key: "sanitizeSvgFences", owner: "web", defaultValue: true, persistence: "json-config", precedence: ["persisted", "default"], secretClass: "none" }),
    vncAllowDirect: boolField({ key: "vncAllowDirect", owner: "web", defaultValue: nestedWebVncAllowDirect ?? legacyWebVncAllowDirect ?? isDefaultWebVncDirectEnabled(), persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [
      { envKey: "PICLAW_WEB_VNC_ALLOW_DIRECT", replacement: "domains.web.vncAllowDirect", removalVersion: "3.0.0" },
      { envKey: "PICLAW_VNC_ALLOW_DIRECT", replacement: "domains.web.vncAllowDirect", removalVersion: "3.0.0" },
    ] }),
    vncTargets: stringField({ key: "vncTargets", owner: "web", defaultValue: nestedWebVncTargets ?? legacyWebVncTargets ?? "", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [
      { envKey: "PICLAW_WEB_VNC_TARGETS", replacement: "domains.web.vncTargets", removalVersion: "3.0.0" },
      { envKey: "PICLAW_VNC_TARGETS", replacement: "domains.web.vncTargets", removalVersion: "3.0.0" },
    ] }),
    debugCardSubmissions: boolField({ key: "debugCardSubmissions", owner: "web", defaultValue: debugCards ?? false, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_DEBUG_CARD_SUBMISSIONS", replacement: "domains.web.debugCardSubmissions", removalVersion: "3.0.0" }] }),
    trustProxy: boolField({ key: "trustProxy", owner: "web", defaultValue: configTrustProxy ?? legacyWebTrustProxy ?? false, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_TRUST_PROXY", replacement: "domains.web.trustProxy", removalVersion: "3.0.0" }] }),
    contentMaxChars: integerField({ key: "contentMaxChars", owner: "web", defaultValue: 262_144, min: 1, bounds: "positive integer characters", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_WEB_MAX_CONTENT_CHARS", replacement: "domains.web.contentMaxChars", removalVersion: "3.0.0", parse: (raw) => Number.parseInt(raw, 10), skipInvalid: true }] }),
    contentPreviewChars: integerField({ key: "contentPreviewChars", owner: "web", defaultValue: 16_000, min: 1, bounds: "positive integer characters; capped at contentMaxChars when consumed", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_WEB_PREVIEW_CHARS", replacement: "domains.web.contentPreviewChars", removalVersion: "3.0.0", parse: (raw) => Number.parseInt(raw, 10), skipInvalid: true }] }),
  },
});

const WEB_ORDINARY_DOMAIN_CONFIG = readDomainConfig(webOrdinaryDomainSchema, getWebOrdinaryDomainConfigOptions());
// Preserve compose-only legacy configuration as a fallback. An explicit workspace
// limit wins when old instances have both values; it becomes the one shared cap.
const persistedWebDomain = (readJsonConfig(getConfigPath()).domains as { web?: Record<string, unknown> } | undefined)?.web;
const legacyUploadEnv = getDomainConfigOptions().env ?? {};
// Bootstrap warns once; retired selections neither select a UI nor rewrite stored settings.
const retiredUiSelections = [persistedWebDomain?.uiMode, webConfig.uiMode, piclawConfig.uiMode,
  legacyUploadEnv.PICLAW_WEB_UI_MODE];
if (retiredUiSelections.some(value => typeof value === 'string' && value.trim().toLowerCase() === 'visual')) {
  createLogger('core.config-web').warn('Visual UI has been removed; using Classic', { operation: 'web.retired_ui_mode' });
}
const hasWorkspaceLimit = legacyUploadEnv.PICLAW_WEB_WORKSPACE_UPLOAD_LIMIT_MB !== undefined
  || persistedWebDomain?.workspaceUploadLimitMb !== undefined
  || configWebWorkspaceUploadLimitMb !== undefined || legacyWebWorkspaceUploadLimitMb !== undefined;
if (!hasWorkspaceLimit && (legacyUploadEnv.PICLAW_WEB_COMPOSE_UPLOAD_LIMIT_MB !== undefined
  || persistedWebDomain?.composeUploadLimitMb !== undefined
  || configWebComposeUploadLimitMb !== undefined || legacyWebComposeUploadLimitMb !== undefined)) {
  WEB_ORDINARY_DOMAIN_CONFIG.workspaceUploadLimitMb = WEB_ORDINARY_DOMAIN_CONFIG.composeUploadLimitMb;
}

/** Grouped web server network/TLS settings. */
const NETWORK_BOOTSTRAP_CONFIG = getNetworkBootstrapConfig();
export const WEB_SERVER_CONFIG = Object.freeze<WebServerConfig>({
  port: parsePort(CLI_WEB_PORT, ENV_WEB_PORT),
  host: CLI_WEB_HOST || process.env.PICLAW_WEB_HOST || "0.0.0.0",
  idleTimeout: WEB_ORDINARY_DOMAIN_CONFIG.idleTimeout,
  tlsCert: CLI_WEB_TLS_CERT || NETWORK_BOOTSTRAP_CONFIG.tlsCert || (HAS_DEFAULT_TLS ? DEFAULT_TLS_CERT_PATH : ""),
  tlsKey: CLI_WEB_TLS_KEY || NETWORK_BOOTSTRAP_CONFIG.tlsKey || (HAS_DEFAULT_TLS ? DEFAULT_TLS_KEY_PATH : ""),
});

/** Return grouped web server settings for WebChannel wiring and tests. */
export function getWebServerConfig(): Readonly<WebServerConfig> {
  return WEB_SERVER_CONFIG;
}

/** Grouped web auth/session/runtime settings. `totpSecret` stays mutable for runtime resets. */
const WEB_SECRET_BOOTSTRAP_CONFIG = getWebSecretBootstrapConfig();
export const WEB_RUNTIME_CONFIG: WebRuntimeConfig = Object.seal({
  totpSecret: WEB_SECRET_BOOTSTRAP_CONFIG.totpSecret || configWebTotpSecret || "",
  totpWindow: WEB_ORDINARY_DOMAIN_CONFIG.totpWindow,
  sessionTtl: WEB_ORDINARY_DOMAIN_CONFIG.sessionTtl,
  internalSecret: WEB_SECRET_BOOTSTRAP_CONFIG.internalSecret || configWebInternalSecret || "",
  widgetToken: WEB_SECRET_BOOTSTRAP_CONFIG.widgetToken || configWebWidgetToken || "",
  passkeyMode: WEB_ORDINARY_DOMAIN_CONFIG.passkeyMode,
  terminalEnabled: WEB_ORDINARY_DOMAIN_CONFIG.terminalEnabled,
  terminalImageProtocol: WEB_ORDINARY_DOMAIN_CONFIG.terminalImageProtocol,
  pushSubscriptionCap: WEB_ORDINARY_DOMAIN_CONFIG.pushSubscriptionCap,
  pushVapidSubject: WEB_ORDINARY_DOMAIN_CONFIG.pushVapidSubject,
  // Legacy compose field remains an alias of the canonical workspace limit.
  composeUploadLimitMb: WEB_ORDINARY_DOMAIN_CONFIG.workspaceUploadLimitMb,
  workspaceUploadLimitMb: WEB_ORDINARY_DOMAIN_CONFIG.workspaceUploadLimitMb,
  notificationDebugLabels: WEB_ORDINARY_DOMAIN_CONFIG.notificationDebugLabels,
  sanitizeSvgFences: WEB_ORDINARY_DOMAIN_CONFIG.sanitizeSvgFences,
  vncAllowDirect: WEB_ORDINARY_DOMAIN_CONFIG.vncAllowDirect,
  vncTargetsRaw: WEB_ORDINARY_DOMAIN_CONFIG.vncTargets,
  debugCardSubmissions: WEB_ORDINARY_DOMAIN_CONFIG.debugCardSubmissions,
  trustProxy: WEB_ORDINARY_DOMAIN_CONFIG.trustProxy,
});

/** Return grouped web auth/session/runtime settings for handlers and tests. */
export function getWebRuntimeConfig(): Readonly<WebRuntimeConfig> {
  return WEB_RUNTIME_CONFIG;
}

function readWebOrdinaryDomainConfig(): WebOrdinaryDomainConfig {
  return readDomainConfig(webOrdinaryDomainSchema, getWebOrdinaryDomainConfigOptions());
}

export function isPersistThinkingEnabled(): boolean {
  return readWebOrdinaryDomainConfig().persistThinking;
}

export function getPersistThinkingMaxChars(): number {
  return readWebOrdinaryDomainConfig().persistThinkingMaxChars;
}

/** Current web timeline content presentation limits. */
export function getWebContentConfig(): Readonly<{ maxChars: number; previewChars: number }> {
  const config = readWebOrdinaryDomainConfig();
  return Object.freeze({
    maxChars: config.contentMaxChars,
    previewChars: Math.min(config.contentPreviewChars, config.contentMaxChars),
  });
}

/** Persist and apply the web terminal toggle so new requests see it immediately. */
export function setWebTerminalEnabled(enabled: boolean): boolean {
  return persistWebOrdinarySetting("terminalEnabled", Boolean(enabled));
}

export function setWebVncAllowDirect(enabled: boolean): boolean {
  return persistWebOrdinarySetting("vncAllowDirect", Boolean(enabled));
}

/** Persist whether fenced SVG is converted into bounded static images before timeline rendering. */
export function setWebSanitizeSvgFences(enabled: boolean): boolean {
  return persistWebOrdinarySetting("sanitizeSvgFences", Boolean(enabled));
}

function persistWebOrdinarySetting<K extends keyof WebOrdinaryDomainConfig>(key: K, value: WebOrdinaryDomainConfig[K]): WebOrdinaryDomainConfig[K] {
  const resolved = writeDomainConfigField(webOrdinaryDomainSchema, getWebOrdinaryDomainConfigOptions(), key, value);
  const effectiveValue = resolved[key];
  WEB_ORDINARY_DOMAIN_CONFIG[key] = effectiveValue;
  if (key in WEB_RUNTIME_CONFIG) {
    (WEB_RUNTIME_CONFIG as unknown as Record<string, unknown>)[key as string] = effectiveValue;
    if (key === "workspaceUploadLimitMb") WEB_RUNTIME_CONFIG.composeUploadLimitMb = Number(effectiveValue);
  }
  return effectiveValue;
}

function persistWebNumberSetting(options: {
  value: number;
  runtimeKey: "composeUploadLimitMb" | "workspaceUploadLimitMb";
  clamp: (value: unknown, fallback: number) => number;
}): number {
  const nextValue = options.clamp(options.value, WEB_RUNTIME_CONFIG[options.runtimeKey]);
  return persistWebOrdinarySetting(options.runtimeKey, nextValue);
}

export function setWebComposeUploadLimitMb(limitMb: number): number {
  return setWebWorkspaceUploadLimitMb(limitMb);
}

export function setWebWorkspaceUploadLimitMb(limitMb: number): number {
  return persistWebNumberSetting({
    value: limitMb,
    runtimeKey: "workspaceUploadLimitMb",
    clamp: clampWorkspaceUploadLimitMb,
  });
}

export function generateWebWidgetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function setWebWidgetToken(token: string): string {
  const next = String(token || "").trim();
  const config = readJsonConfig(getConfigPath());
  const web =
    config.web && typeof config.web === "object"
      ? { ...(config.web as Record<string, unknown>) }
      : {};
  const widgetTokenKeys = [
    "widgetToken",
    "widget_token",
    "webWidgetToken",
    "web_widget_token",
    "PICLAW_WEB_WIDGET_TOKEN",
  ];

  for (const key of widgetTokenKeys) {
    delete web[key];
    delete config[key];
  }

  if (next) {
    web.widgetToken = next;
  }
  config.web = web;
  writeJsonConfig(getConfigPath(), config);

  WEB_RUNTIME_CONFIG.widgetToken = next;
  setWebSecretCompatibilityValue("PICLAW_WEB_WIDGET_TOKEN", next);
  return WEB_RUNTIME_CONFIG.widgetToken;
}

export function getOrCreateWebWidgetToken(): string {
  const existing = WEB_RUNTIME_CONFIG.widgetToken.trim();
  if (existing) return existing;
  return setWebWidgetToken(generateWebWidgetToken());
}

export function rotateWebWidgetToken(): string {
  return setWebWidgetToken(generateWebWidgetToken());
}

/**
 * Rotate/redefine the web-login TOTP secret and persist it to config.json.
 *
 * If a runtime secret env var exists, we update it so the new value takes effect
 * immediately in the same process. Persistence remains in `.piclaw/config.json`
 * under the `web.totpSecret` key.
 */
export function setWebTotpSecret(secret: string): string {
  const next = (secret || "").trim();

  const config = readJsonConfig(getConfigPath());
  const web =
    config.web && typeof config.web === "object"
      ? { ...(config.web as Record<string, unknown>) }
      : {};
  const totpKeys = [
    "totpSecret",
    "totp_secret",
    "webTotpSecret",
    "web_totp_secret",
    "PICLAW_WEB_TOTP_SECRET",
    "PICLAW_TOTP_SECRET",
  ];

  for (const key of totpKeys) {
    delete web[key];
  }

  if (next) {
    web.totpSecret = next;
  }

  if (Object.keys(web).length > 0) {
    config.web = web;
  } else {
    delete config.web;
  }

  writeJsonConfig(getConfigPath(), config);

  WEB_RUNTIME_CONFIG.totpSecret = next;
  setWebSecretCompatibilityValue("PICLAW_WEB_TOTP_SECRET", next);

  return WEB_RUNTIME_CONFIG.totpSecret;
}
