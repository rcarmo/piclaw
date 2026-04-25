/**
 * core/config.ts – Centralised application configuration.
 *
 * All runtime settings are resolved here from three sources (in priority
 * order): CLI arguments, environment variables / `.env` file, and the JSON
 * config file at `<workspace>/.piclaw/config.json`.
 *
 * The exported constants and mutable variables are consumed throughout the
 * application:
 *   - WORKSPACE_DIR / STORE_DIR / DATA_DIR → db/, ipc.ts, task-scheduler.ts
 *   - WEB_* → channels/web.ts (HTTP/TLS server setup, auth)
 *   - ASSISTANT_NAME / ASSISTANT_AVATAR → agent-pool.ts, channels/formatting.ts
 *   - WHATSAPP_PHONE → channels/whatsapp.ts
 *   - PUSHOVER_* → channels/pushover.ts
 *   - AGENT_TIMEOUT / BACKGROUND_AGENT_TIMEOUT → agent-pool.ts, runtime.ts
 *   - TRIGGER_PATTERN → router.ts (decides whether to process a message)
 *   - TOOL_OUTPUT_* → db/tool-outputs.ts (retention / cleanup scheduling)
 *
 * Setter functions (setAssistantName, etc.) allow the agent-control layer to
 * update identity settings at runtime without a restart.
 */

import { resolve } from "path";
import { existsSync } from "fs";
import { readEnvFile } from "./env.js";
import { readJsonConfig, writeJsonConfig } from "./config-store.js";
import { createLogger } from "../utils/logger.js";
import { getConfiguredLogLevel, parseLogLevel } from "../utils/log-level.js";

// ---------------------------------------------------------------------------
// CLI argument parsing helpers.
// ---------------------------------------------------------------------------

const CLI_ARGS = process.argv.slice(2);

/** Read a CLI flag value, e.g. `--port 3000` or `--port=3000`. */
function readCliArg(name: string, alias?: string): string | undefined {
  const names = [name, alias].filter(Boolean) as string[];
  for (let i = 0; i < CLI_ARGS.length; i += 1) {
    const arg = CLI_ARGS[i];
    for (const flag of names) {
      if (arg === flag) {
        return CLI_ARGS[i + 1];
      }
      if (arg.startsWith(`${flag}=`)) {
        return arg.slice(flag.length + 1);
      }
    }
  }
  return undefined;
}

const CLI_WORKSPACE = readCliArg("--workspace", "-w");

// ---------------------------------------------------------------------------
// .env file – loaded once at module init and merged with process.env below.
// ---------------------------------------------------------------------------
const envConfig = readEnvFile([
  "PICLAW_ASSISTANT_NAME",
  "PICLAW_ASSISTANT_AVATAR",
  "PICLAW_USER_NAME",
  "PICLAW_USER_AVATAR",
  "PICLAW_USER_AVATAR_BACKGROUND",
  "ASSISTANT_NAME",
  "ASSISTANT_AVATAR",
  "PICLAW_AGENT_TIMEOUT",
  "AGENT_TIMEOUT",
  "PICLAW_BACKGROUND_AGENT_TIMEOUT",
  "AGENT_TIMEOUT_BACKGROUND",
  "PICLAW_WHATSAPP_PHONE",
  "WHATSAPP_PHONE",
  "PUSHOVER_APP_TOKEN",
  "PUSHOVER_USER_KEY",
  "PUSHOVER_DEVICE",
  "PUSHOVER_PRIORITY",
  "PUSHOVER_SOUND",
  "PICLAW_WEB_TLS_CERT",
  "PICLAW_WEB_TLS_KEY",
  "PICLAW_WEB_TOTP_SECRET",
  "PICLAW_WEB_TOTP_WINDOW",
  "PICLAW_WEB_SESSION_TTL",
  "PICLAW_WEB_INTERNAL_SECRET",
  "PICLAW_WEB_PASSKEY_MODE",
  "PICLAW_WEB_TERMINAL_ENABLED",
  "PICLAW_WEB_NOTIFICATION_DEBUG_LABELS",
  "PICLAW_WEB_VNC_ALLOW_DIRECT",
  "PICLAW_VNC_ALLOW_DIRECT",
  "PICLAW_WEB_VNC_TARGETS",
  "PICLAW_VNC_TARGETS",
  "PICLAW_DEBUG_CARD_SUBMISSIONS",
  "PICLAW_TRUST_PROXY",
  "PICLAW_SESSION_MAX_SIZE_MB",
  "PICLAW_SESSION_AUTO_ROTATE",
  "PICLAW_TURN_MAX_TOOL_USE_MESSAGES",
  "PICLAW_WORKSPACE_SEARCH_ROOTS",
  "PICLAW_INTERNAL_SECRET",
  "PICLAW_REMOTE_INTEROP_ENABLED",
  "PICLAW_REMOTE_INTEROP_ALLOW_HTTP",
  "PICLAW_REMOTE_INTEROP_ALLOW_PRIVATE_NETWORK",
  "PICLAW_REMOTE_INSTANCE_NAME",
  "PICLAW_REMOTE_SHORT_CIRCUIT_ENABLED",
  "PICLAW_REMOTE_INTEROP_DECISION_MODEL",
  "PICLAW_WEB_EXTERNAL_URL",
  "PICLAW_LOG_LEVEL",
  "LOG_LEVEL",
]);

import { pickString, pickNumber, pickBoolean, pickStringArray } from "./config-helpers.js";
import type { RuntimeTimingConfig } from "./config-helpers.js";
export { pickString, pickNumber, pickBoolean, pickStringArray };
export type { RuntimeTimingConfig };

// ---------------------------------------------------------------------------
// Timing constants used by the runtime message loop and scheduler.
// ---------------------------------------------------------------------------

/** Grouped runtime timing settings. */
export const RUNTIME_TIMING_CONFIG = Object.freeze<RuntimeTimingConfig>({
  pollIntervalMs: 2000,
  schedulerPollIntervalMs: 60000,
  ipcPollIntervalMs: 1000,
  timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
});

/** Return grouped runtime timing settings for runtime wiring and tests. */
export function getRuntimeTimingConfig(): Readonly<RuntimeTimingConfig> {
  return RUNTIME_TIMING_CONFIG;
}

// ---------------------------------------------------------------------------
// Filesystem paths – all env-configurable for flexible volume layouts.
// Defaults assume /workspace is the persistent external volume.
// ---------------------------------------------------------------------------

/** Root of the persistent workspace (bind-mounted volume). */
export const WORKSPACE_DIR = resolve(CLI_WORKSPACE || process.env.PICLAW_WORKSPACE || "/workspace");
/** Directory for the SQLite database and related state. */
export const STORE_DIR = resolve(
  CLI_WORKSPACE ? `${WORKSPACE_DIR}/.piclaw/store` : (process.env.PICLAW_STORE || `${WORKSPACE_DIR}/.piclaw/store`)
);
/** Directory for runtime data (sessions, IPC files, etc.). */
export const DATA_DIR = resolve(
  CLI_WORKSPACE ? `${WORKSPACE_DIR}/.piclaw/data` : (process.env.PICLAW_DATA || `${WORKSPACE_DIR}/.piclaw/data`)
);

// ---------------------------------------------------------------------------
// TLS – optional HTTPS support for the web channel.
// ---------------------------------------------------------------------------

const DEFAULT_TLS_CERT_PATH = resolve(WORKSPACE_DIR, ".piclaw", "certs", "sandbox.local.crt");
const DEFAULT_TLS_KEY_PATH = resolve(WORKSPACE_DIR, ".piclaw", "certs", "sandbox.local.key");
/** True when default self-signed TLS certificates exist on disk. */
const HAS_DEFAULT_TLS = existsSync(DEFAULT_TLS_CERT_PATH) && existsSync(DEFAULT_TLS_KEY_PATH);

// ---------------------------------------------------------------------------
// JSON config file – loaded once and merged with env/CLI values below.
// ---------------------------------------------------------------------------

/** Absolute path to the JSON config file. */
export const PICLAW_CONFIG_PATH = resolve(WORKSPACE_DIR, ".piclaw", "config.json");

/** Resolve the config path at call time so tests can override PICLAW_WORKSPACE. */
export function getConfigPath(): string {
  const ws = process.env.PICLAW_WORKSPACE?.trim();
  return ws ? resolve(ws, ".piclaw", "config.json") : PICLAW_CONFIG_PATH;
}

const piclawConfig = readJsonConfig(PICLAW_CONFIG_PATH);

// Sub-objects inside the config file for namespaced settings.
const pushoverConfig =
  piclawConfig.pushover && typeof piclawConfig.pushover === "object"
    ? (piclawConfig.pushover as Record<string, unknown>)
    : piclawConfig;
const assistantConfig =
  piclawConfig.assistant && typeof piclawConfig.assistant === "object"
    ? (piclawConfig.assistant as Record<string, unknown>)
    : piclawConfig;
const userConfig =
  piclawConfig.user && typeof piclawConfig.user === "object"
    ? (piclawConfig.user as Record<string, unknown>)
    : piclawConfig;
const webConfig =
  piclawConfig.web && typeof piclawConfig.web === "object"
    ? (piclawConfig.web as Record<string, unknown>)
    : piclawConfig;
const toolsConfig =
  piclawConfig.tools && typeof piclawConfig.tools === "object"
    ? (piclawConfig.tools as Record<string, unknown>)
    : piclawConfig;

// Extract individual settings from the JSON config, trying multiple key aliases.
const configAppToken = pickString(pushoverConfig, ["appToken", "app_token", "PUSHOVER_APP_TOKEN"]);
const configUserKey = pickString(pushoverConfig, ["userKey", "user_key", "PUSHOVER_USER_KEY"]);
const configDevice = pickString(pushoverConfig, ["device", "PUSHOVER_DEVICE"]);
const configSound = pickString(pushoverConfig, ["sound", "PUSHOVER_SOUND"]);
const configPriority = pickNumber(pushoverConfig, ["priority", "PUSHOVER_PRIORITY"]);
const configWhatsappPhone = pickString(piclawConfig, ["whatsappPhone", "whatsapp_phone", "WHATSAPP_PHONE"]);
const configAssistantName = pickString(assistantConfig, [
  "assistantName",
  "assistant_name",
  "agentName",
  "agent_name",
  "name",
  "ASSISTANT_NAME",
]);
const configAssistantAvatar = pickString(assistantConfig, [
  "assistantAvatar",
  "assistant_avatar",
  "agentAvatar",
  "agent_avatar",
  "avatar",
  "ASSISTANT_AVATAR",
]);
const configUserName = pickString(userConfig, [
  "userName",
  "user_name",
  "name",
  "PICLAW_USER_NAME",
]);
const configUserAvatar = pickString(userConfig, [
  "userAvatar",
  "user_avatar",
  "avatar",
  "PICLAW_USER_AVATAR",
]);
const configUserAvatarBackground = pickString(userConfig, [
  "userAvatarBackground",
  "user_avatar_background",
  "userAvatarBg",
  "user_avatar_bg",
  "avatarBackground",
  "avatar_background",
  "PICLAW_USER_AVATAR_BACKGROUND",
]);
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
const configWebPasskeyMode = pickString(webConfig, [
  "passkeyMode",
  "passkey_mode",
  "webPasskeyMode",
  "web_passkey_mode",
  "PICLAW_WEB_PASSKEY_MODE",
]);
const configTrustProxy = pickBoolean(webConfig, [
  "trustProxy",
  "trust_proxy",
  "PICLAW_TRUST_PROXY",
]);

// ---------------------------------------------------------------------------
// Deprecation warnings for renamed environment variables.
// ---------------------------------------------------------------------------

const log = createLogger("core.config");

/** Emit a structured warning if only the old env var name is set. */
function warnDeprecatedEnv(oldName: string, newName: string): void {
  const oldValue = process.env[oldName] ?? envConfig[oldName];
  const newValue = process.env[newName] ?? envConfig[newName];
  if (oldValue && !newValue) {
    log.warn("Deprecated environment variable is set", {
      operation: "core_config.warn_deprecated_env",
      oldName,
      newName,
    });
  }
}

warnDeprecatedEnv("ASSISTANT_NAME", "PICLAW_ASSISTANT_NAME");
warnDeprecatedEnv("ASSISTANT_AVATAR", "PICLAW_ASSISTANT_AVATAR");
warnDeprecatedEnv("AGENT_TIMEOUT", "PICLAW_AGENT_TIMEOUT");
warnDeprecatedEnv("AGENT_TIMEOUT_BACKGROUND", "PICLAW_BACKGROUND_AGENT_TIMEOUT");
warnDeprecatedEnv("LOG_LEVEL", "PICLAW_LOG_LEVEL");

// ---------------------------------------------------------------------------
// Mutable identity settings – can be changed at runtime via agent-control.
// ---------------------------------------------------------------------------

/** Typed logging settings grouped for runtime diagnostics. */
export interface LoggingConfig {
  level: ReturnType<typeof parseLogLevel>;
}

/** Grouped logging settings. */
export const LOGGING_CONFIG = Object.freeze<LoggingConfig>({
  level: parseLogLevel(
    process.env.PICLAW_LOG_LEVEL ||
      envConfig.PICLAW_LOG_LEVEL ||
      process.env.LOG_LEVEL ||
      envConfig.LOG_LEVEL ||
      getConfiguredLogLevel(),
  ),
});

/** Return grouped logging settings for runtime wiring and tests. */
export function getLoggingConfig(): Readonly<LoggingConfig> {
  return LOGGING_CONFIG;
}

/** Typed mutable identity settings grouped for runtime consumers that need live values. */
export interface IdentityConfig {
  assistantName: string;
  assistantAvatar: string;
  userName: string;
  userAvatar: string;
  userAvatarBackground: string;
}

/** Grouped mutable identity settings. Legacy flat exports below stay in sync for compatibility. */
export const IDENTITY_CONFIG: IdentityConfig = Object.seal({
  assistantName:
    process.env.PICLAW_ASSISTANT_NAME ||
    envConfig.PICLAW_ASSISTANT_NAME ||
    process.env.ASSISTANT_NAME ||
    envConfig.ASSISTANT_NAME ||
    configAssistantName ||
    "PiClaw",
  assistantAvatar:
    process.env.PICLAW_ASSISTANT_AVATAR ||
    envConfig.PICLAW_ASSISTANT_AVATAR ||
    process.env.ASSISTANT_AVATAR ||
    envConfig.ASSISTANT_AVATAR ||
    configAssistantAvatar ||
    "",
  userName:
    process.env.PICLAW_USER_NAME ||
    envConfig.PICLAW_USER_NAME ||
    configUserName ||
    "",
  userAvatar:
    process.env.PICLAW_USER_AVATAR ||
    envConfig.PICLAW_USER_AVATAR ||
    configUserAvatar ||
    "",
  userAvatarBackground:
    process.env.PICLAW_USER_AVATAR_BACKGROUND ||
    envConfig.PICLAW_USER_AVATAR_BACKGROUND ||
    configUserAvatarBackground ||
    "",
});

/** Return grouped mutable identity settings for runtime wiring and tests. */
export function getIdentityConfig(): Readonly<IdentityConfig> {
  return IDENTITY_CONFIG;
}

/** Display name of the assistant. Updated by setAssistantName(). */
export let ASSISTANT_NAME = IDENTITY_CONFIG.assistantName;

/** URL or path to the assistant's avatar image. Updated by setAssistantAvatar(). */
export let ASSISTANT_AVATAR = IDENTITY_CONFIG.assistantAvatar;

/** Display name for the human user in the web UI. */
export let USER_NAME = IDENTITY_CONFIG.userName;

/** URL or path to the user's avatar image. */
export let USER_AVATAR = IDENTITY_CONFIG.userAvatar;

/** CSS background colour for the user avatar circle. */
export let USER_AVATAR_BACKGROUND = IDENTITY_CONFIG.userAvatarBackground;

// ---------------------------------------------------------------------------
// Agent timeout settings – how long a single agent turn may run.
// ---------------------------------------------------------------------------

/** Typed agent turn timeout settings grouped for runtime and handler wiring. */
export interface AgentRuntimeConfig {
  timeoutMs: number;
  backgroundTimeoutMs: number;
}

/** Grouped agent turn timeout settings. */
export const AGENT_RUNTIME_CONFIG = Object.freeze<AgentRuntimeConfig>({
  timeoutMs: parseInt(
    process.env.PICLAW_AGENT_TIMEOUT ||
      envConfig.PICLAW_AGENT_TIMEOUT ||
      process.env.AGENT_TIMEOUT ||
      envConfig.AGENT_TIMEOUT ||
      "3600000",
    10
  ),
  backgroundTimeoutMs: parseInt(
    process.env.PICLAW_BACKGROUND_AGENT_TIMEOUT ||
      envConfig.PICLAW_BACKGROUND_AGENT_TIMEOUT ||
      process.env.AGENT_TIMEOUT_BACKGROUND ||
      envConfig.AGENT_TIMEOUT_BACKGROUND ||
      "0",
    10
  ),
});

/** Return grouped agent timeout settings for runtime wiring and tests. */
export function getAgentRuntimeConfig(): Readonly<AgentRuntimeConfig> {
  return AGENT_RUNTIME_CONFIG;
}

/** Parse a numeric port string, falling back to `fallback` on failure. */
function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

// ---------------------------------------------------------------------------
// Web channel configuration (HTTP server, TLS, auth).
// ---------------------------------------------------------------------------

const ENV_WEB_PORT = parseInt(process.env.PICLAW_WEB_PORT || "8080", 10);
const CLI_WEB_PORT = readCliArg("--port", "-p");
const CLI_WEB_HOST = readCliArg("--host");
const ENV_WEB_IDLE_TIMEOUT = parseInt(process.env.PICLAW_WEB_IDLE_TIMEOUT || "0", 10);
const CLI_WEB_IDLE_TIMEOUT = readCliArg("--idle-timeout");
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

/** Grouped web server network/TLS settings. */
export const WEB_SERVER_CONFIG = Object.freeze<WebServerConfig>({
  port: parsePort(CLI_WEB_PORT, ENV_WEB_PORT),
  host: CLI_WEB_HOST || process.env.PICLAW_WEB_HOST || "0.0.0.0",
  idleTimeout: parsePort(CLI_WEB_IDLE_TIMEOUT, ENV_WEB_IDLE_TIMEOUT),
  tlsCert:
    CLI_WEB_TLS_CERT ||
    process.env.PICLAW_WEB_TLS_CERT ||
    envConfig.PICLAW_WEB_TLS_CERT ||
    (HAS_DEFAULT_TLS ? DEFAULT_TLS_CERT_PATH : ""),
  tlsKey:
    CLI_WEB_TLS_KEY ||
    process.env.PICLAW_WEB_TLS_KEY ||
    envConfig.PICLAW_WEB_TLS_KEY ||
    (HAS_DEFAULT_TLS ? DEFAULT_TLS_KEY_PATH : ""),
});

/** Return grouped web server settings for WebChannel wiring and tests. */
export function getWebServerConfig(): Readonly<WebServerConfig> {
  return WEB_SERVER_CONFIG;
}

/** Mutable web auth/session/runtime settings grouped for auth and UI wiring. */
export interface WebRuntimeConfig {
  totpSecret: string;
  totpWindow: number;
  sessionTtl: number;
  internalSecret: string;
  passkeyMode: string;
  terminalEnabled: boolean;
  notificationDebugLabels: boolean;
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

const nestedWebTerminalEnabled = pickBoolean(webConfig, ["terminalEnabled", "webTerminalEnabled", "PICLAW_WEB_TERMINAL_ENABLED"]);
const legacyWebTerminalEnabled = pickBoolean(piclawConfig, ["webTerminalEnabled"]);
const envWebTerminalEnabled = pickBoolean({ PICLAW_WEB_TERMINAL_ENABLED: process.env.PICLAW_WEB_TERMINAL_ENABLED ?? envConfig.PICLAW_WEB_TERMINAL_ENABLED }, ["PICLAW_WEB_TERMINAL_ENABLED"]);
const nestedWebNotificationDebugLabels = pickBoolean(webConfig, ["notificationDebugLabels", "notification_debug_labels", "webNotificationDebugLabels", "PICLAW_WEB_NOTIFICATION_DEBUG_LABELS"]);
const legacyWebNotificationDebugLabels = pickBoolean(piclawConfig, ["webNotificationDebugLabels"]);
const envWebNotificationDebugLabels = pickBoolean({ PICLAW_WEB_NOTIFICATION_DEBUG_LABELS: process.env.PICLAW_WEB_NOTIFICATION_DEBUG_LABELS ?? envConfig.PICLAW_WEB_NOTIFICATION_DEBUG_LABELS }, ["PICLAW_WEB_NOTIFICATION_DEBUG_LABELS"]);
const nestedWebVncAllowDirect = pickBoolean(webConfig, ["vncAllowDirect", "vnc_allow_direct", "webVncAllowDirect", "PICLAW_WEB_VNC_ALLOW_DIRECT", "PICLAW_VNC_ALLOW_DIRECT"]);
const legacyWebVncAllowDirect = pickBoolean(piclawConfig, ["webVncAllowDirect"]);
const envWebVncAllowDirect = pickBoolean({ PICLAW_WEB_VNC_ALLOW_DIRECT: process.env.PICLAW_WEB_VNC_ALLOW_DIRECT ?? envConfig.PICLAW_WEB_VNC_ALLOW_DIRECT ?? process.env.PICLAW_VNC_ALLOW_DIRECT ?? envConfig.PICLAW_VNC_ALLOW_DIRECT }, ["PICLAW_WEB_VNC_ALLOW_DIRECT"]);
const nestedWebVncTargets = pickString(webConfig, ["vncTargets", "vnc_targets", "webVncTargets", "PICLAW_WEB_VNC_TARGETS", "PICLAW_VNC_TARGETS"]);
const legacyWebVncTargets = pickString(piclawConfig, ["webVncTargets"]);
const debugCards = pickBoolean(piclawConfig, ["debugCardSubmissions", "PICLAW_DEBUG_CARD_SUBMISSIONS"]);
const envDebugCards = pickBoolean({ PICLAW_DEBUG_CARD_SUBMISSIONS: process.env.PICLAW_DEBUG_CARD_SUBMISSIONS ?? envConfig.PICLAW_DEBUG_CARD_SUBMISSIONS }, ["PICLAW_DEBUG_CARD_SUBMISSIONS"]);
const envTrustProxyRaw = process.env.PICLAW_TRUST_PROXY ?? envConfig.PICLAW_TRUST_PROXY;
const envTrustProxy = pickBoolean({ PICLAW_TRUST_PROXY: envTrustProxyRaw }, ["PICLAW_TRUST_PROXY"]);

/** Grouped web auth/session/runtime settings. `totpSecret` stays mutable for runtime resets. */
export const WEB_RUNTIME_CONFIG: WebRuntimeConfig = Object.seal({
  totpSecret:
    process.env.PICLAW_WEB_TOTP_SECRET ||
    envConfig.PICLAW_WEB_TOTP_SECRET ||
    configWebTotpSecret ||
    "",
  totpWindow: parseInt(
    process.env.PICLAW_WEB_TOTP_WINDOW ||
      envConfig.PICLAW_WEB_TOTP_WINDOW ||
      (configWebTotpWindow !== undefined ? String(configWebTotpWindow) : "1"),
    10
  ),
  sessionTtl: parseInt(
    process.env.PICLAW_WEB_SESSION_TTL ||
      envConfig.PICLAW_WEB_SESSION_TTL ||
      (configWebSessionTtl !== undefined ? String(configWebSessionTtl) : String(7 * 24 * 60 * 60)),
    10
  ),
  internalSecret:
    process.env.PICLAW_INTERNAL_SECRET ||
    process.env.PICLAW_WEB_INTERNAL_SECRET ||
    envConfig.PICLAW_INTERNAL_SECRET ||
    envConfig.PICLAW_WEB_INTERNAL_SECRET ||
    configWebInternalSecret ||
    "",
  passkeyMode: (
    process.env.PICLAW_WEB_PASSKEY_MODE ||
    envConfig.PICLAW_WEB_PASSKEY_MODE ||
    configWebPasskeyMode ||
    "totp-fallback"
  ).toLowerCase(),
  terminalEnabled: envWebTerminalEnabled ?? nestedWebTerminalEnabled ?? legacyWebTerminalEnabled ?? isDefaultWebTerminalEnabled(),
  notificationDebugLabels: envWebNotificationDebugLabels ?? nestedWebNotificationDebugLabels ?? legacyWebNotificationDebugLabels ?? false,
  vncAllowDirect: envWebVncAllowDirect ?? nestedWebVncAllowDirect ?? legacyWebVncAllowDirect ?? isDefaultWebVncDirectEnabled(),
  vncTargetsRaw:
    process.env.PICLAW_WEB_VNC_TARGETS ||
    envConfig.PICLAW_WEB_VNC_TARGETS ||
    process.env.PICLAW_VNC_TARGETS ||
    envConfig.PICLAW_VNC_TARGETS ||
    nestedWebVncTargets ||
    legacyWebVncTargets ||
    "",
  debugCardSubmissions: envDebugCards ?? debugCards ?? false,
  trustProxy: envTrustProxy ?? configTrustProxy ?? false,
});

/** Return grouped web auth/session/runtime settings for handlers and tests. */
export function getWebRuntimeConfig(): Readonly<WebRuntimeConfig> {
  return WEB_RUNTIME_CONFIG;
}

/** Persist and apply the web terminal toggle so new requests see it immediately. */
export function setWebTerminalEnabled(enabled: boolean): boolean {
  const nextEnabled = Boolean(enabled);
  const config = readJsonConfig(getConfigPath());
  const web =
    config.web && typeof config.web === "object"
      ? { ...(config.web as Record<string, unknown>) }
      : {};
  const webKeys = ["terminalEnabled", "webTerminalEnabled", "PICLAW_WEB_TERMINAL_ENABLED"];
  for (const key of webKeys) {
    delete web[key];
  }
  web.terminalEnabled = nextEnabled;
  config.web = web;
  delete config.webTerminalEnabled;
  writeJsonConfig(getConfigPath(), config);

  process.env.PICLAW_WEB_TERMINAL_ENABLED = nextEnabled ? "1" : "0";
  WEB_RUNTIME_CONFIG.terminalEnabled = nextEnabled;
  return WEB_RUNTIME_CONFIG.terminalEnabled;
}

// ---------------------------------------------------------------------------
// Remote interop configuration (cross-instance IPC).
// ---------------------------------------------------------------------------

/** Typed remote interop settings grouped for lower-coupling service wiring. */
export interface RemoteInteropConfig {
  enabled: boolean;
  allowHttp: boolean;
  allowPrivateNetwork: boolean;
  shortCircuitEnabled: boolean;
  instanceName: string;
  decisionModel: string;
}

const remoteInteropEnabledRaw = pickBoolean(piclawConfig, ["remoteInteropEnabled", "PICLAW_REMOTE_INTEROP_ENABLED"]);
const remoteInteropAllowHttpRaw = pickBoolean(piclawConfig, ["remoteInteropAllowHttp", "PICLAW_REMOTE_INTEROP_ALLOW_HTTP"]);
const remoteInteropAllowPrivateNetworkRaw = pickBoolean(piclawConfig, ["remoteInteropAllowPrivateNetwork", "PICLAW_REMOTE_INTEROP_ALLOW_PRIVATE_NETWORK"]);
const remoteShortCircuitRaw = pickBoolean(piclawConfig, ["remoteInteropShortCircuitEnabled", "PICLAW_REMOTE_SHORT_CIRCUIT_ENABLED"]);

/** Grouped remote interop settings with existing config/env precedence preserved. */
export const REMOTE_INTEROP_CONFIG = Object.freeze<RemoteInteropConfig>({
  enabled:
    remoteInteropEnabledRaw ??
    ((process.env.PICLAW_REMOTE_INTEROP_ENABLED || "").toLowerCase() === "true" ||
      process.env.PICLAW_REMOTE_INTEROP_ENABLED === "1"),
  allowHttp:
    remoteInteropAllowHttpRaw ??
    ((process.env.PICLAW_REMOTE_INTEROP_ALLOW_HTTP || "").toLowerCase() === "true" ||
      process.env.PICLAW_REMOTE_INTEROP_ALLOW_HTTP === "1"),
  allowPrivateNetwork:
    remoteInteropAllowPrivateNetworkRaw ??
    ((process.env.PICLAW_REMOTE_INTEROP_ALLOW_PRIVATE_NETWORK || "").toLowerCase() === "true" ||
      process.env.PICLAW_REMOTE_INTEROP_ALLOW_PRIVATE_NETWORK === "1"),
  shortCircuitEnabled:
    remoteShortCircuitRaw ??
    ((process.env.PICLAW_REMOTE_SHORT_CIRCUIT_ENABLED || "").toLowerCase() === "true" ||
      process.env.PICLAW_REMOTE_SHORT_CIRCUIT_ENABLED === "1"),
  instanceName:
    pickString(piclawConfig, ["remoteInstanceName", "PICLAW_REMOTE_INSTANCE_NAME"]) ||
    process.env.PICLAW_REMOTE_INSTANCE_NAME ||
    "",
  decisionModel:
    pickString(piclawConfig, ["remoteInteropDecisionModel", "PICLAW_REMOTE_INTEROP_DECISION_MODEL"]) ||
    process.env.PICLAW_REMOTE_INTEROP_DECISION_MODEL ||
    "",
});

/** Return the grouped remote interop settings for service wiring and tests. */
export function getRemoteInteropConfig(): Readonly<RemoteInteropConfig> {
  return REMOTE_INTEROP_CONFIG;
}

/** Directory for persisted Pi session files. */
export const SESSIONS_DIR = resolve(DATA_DIR, "sessions");

const configSessionMaxSizeMb = pickNumber(piclawConfig, [
  "sessionMaxSizeMb",
  "session_max_size_mb",
  "PICLAW_SESSION_MAX_SIZE_MB",
]);
const configSessionAutoRotate = pickBoolean(piclawConfig, [
  "sessionAutoRotate",
  "session_auto_rotate",
  "PICLAW_SESSION_AUTO_ROTATE",
]);
const configTurnMaxToolUseMessages = pickNumber(piclawConfig, [
  "turnMaxToolUseMessages",
  "turn_max_tool_use_messages",
  "toolUseBudget",
  "tool_use_budget",
  "PICLAW_TURN_MAX_TOOL_USE_MESSAGES",
]);
const configAdditionalDefaultTools = pickStringArray(toolsConfig, [
  "additionalDefaultTools",
  "additional_default_tools",
  "PICLAW_ADDITIONAL_DEFAULT_TOOLS",
]);
const configWorkspaceSearchRoots = pickStringArray(toolsConfig, [
  "workspaceSearchRoots",
  "workspace_search_roots",
  "PICLAW_WORKSPACE_SEARCH_ROOTS",
]);
const configWorkspaceSearchExtensions = pickStringArray(toolsConfig, [
  "workspaceSearchExtensions",
  "workspace_search_extensions",
  "PICLAW_WORKSPACE_SEARCH_EXTENSIONS",
]);

/** Typed session-file safeguards grouped for runtime/session wiring. */
export interface SessionStorageConfig {
  maxSizeMb: number;
  maxSizeBytes: number;
  maxLines: number;
  autoRotate: boolean;
}

const sessionMaxSizeMb =
  pickNumber({ PICLAW_SESSION_MAX_SIZE_MB: process.env.PICLAW_SESSION_MAX_SIZE_MB ?? envConfig.PICLAW_SESSION_MAX_SIZE_MB }, [
    "PICLAW_SESSION_MAX_SIZE_MB",
  ]) ?? configSessionMaxSizeMb ?? 32;

const sessionMaxLines =
  pickNumber({ PICLAW_SESSION_MAX_LINES: process.env.PICLAW_SESSION_MAX_LINES ?? envConfig.PICLAW_SESSION_MAX_LINES }, [
    "PICLAW_SESSION_MAX_LINES",
  ]) ?? 8000;

/** Grouped session-file safeguards. */
export let SESSION_STORAGE_CONFIG = Object.freeze<SessionStorageConfig>({
  maxSizeMb: sessionMaxSizeMb,
  maxSizeBytes: sessionMaxSizeMb * 1024 * 1024,
  maxLines: sessionMaxLines,
  autoRotate:
    pickBoolean({ PICLAW_SESSION_AUTO_ROTATE: process.env.PICLAW_SESSION_AUTO_ROTATE ?? envConfig.PICLAW_SESSION_AUTO_ROTATE }, [
      "PICLAW_SESSION_AUTO_ROTATE",
    ]) ?? configSessionAutoRotate ?? true,
});

/** Return grouped session-file safeguards for runtime wiring and tests. */
export function getSessionStorageConfig(): Readonly<SessionStorageConfig> {
  return SESSION_STORAGE_CONFIG;
}

/** Persist and apply session storage settings so new turns use them immediately. */
export function setSessionStorageConfig(patch: { maxSizeMb?: number; autoRotate?: boolean }): Readonly<SessionStorageConfig> {
  const nextMaxSizeMb = Number.isFinite(patch.maxSizeMb)
    ? Math.min(256, Math.max(1, Math.round(Number(patch.maxSizeMb))))
    : SESSION_STORAGE_CONFIG.maxSizeMb;
  const nextAutoRotate = typeof patch.autoRotate === "boolean"
    ? patch.autoRotate
    : SESSION_STORAGE_CONFIG.autoRotate;

  const config = readJsonConfig(getConfigPath());
  const clearRootKeys = [
    "sessionMaxSizeMb",
    "session_max_size_mb",
    "PICLAW_SESSION_MAX_SIZE_MB",
    "sessionAutoRotate",
    "session_auto_rotate",
    "PICLAW_SESSION_AUTO_ROTATE",
  ];
  for (const key of clearRootKeys) {
    delete config[key];
  }
  config.sessionMaxSizeMb = nextMaxSizeMb;
  config.sessionAutoRotate = nextAutoRotate;
  writeJsonConfig(getConfigPath(), config);

  process.env.PICLAW_SESSION_MAX_SIZE_MB = String(nextMaxSizeMb);
  process.env.PICLAW_SESSION_AUTO_ROTATE = nextAutoRotate ? "1" : "0";

  SESSION_STORAGE_CONFIG = Object.freeze<SessionStorageConfig>({
    ...SESSION_STORAGE_CONFIG,
    maxSizeMb: nextMaxSizeMb,
    maxSizeBytes: nextMaxSizeMb * 1024 * 1024,
    autoRotate: nextAutoRotate,
  });
  return SESSION_STORAGE_CONFIG;
}

/** Current per-turn tool-use budget used by the agent orchestrator. */
export let TOOL_USE_MESSAGE_BUDGET =
  pickNumber({
    PICLAW_TURN_MAX_TOOL_USE_MESSAGES:
      process.env.PICLAW_TURN_MAX_TOOL_USE_MESSAGES ?? envConfig.PICLAW_TURN_MAX_TOOL_USE_MESSAGES,
  }, ["PICLAW_TURN_MAX_TOOL_USE_MESSAGES"]) ?? configTurnMaxToolUseMessages ?? 64;

/** Return the current tool-use budget for a single turn. */
export function getToolUseMessageBudget(): number {
  return TOOL_USE_MESSAGE_BUDGET;
}

/** Persist and apply the tool-use budget so subsequent turns use it immediately. */
export function setToolUseMessageBudget(budget: number): number {
  const nextBudget = Number.isFinite(budget)
    ? Math.min(512, Math.max(8, Math.round(Number(budget))))
    : TOOL_USE_MESSAGE_BUDGET;
  const config = readJsonConfig(getConfigPath());
  const clearRootKeys = [
    "turnMaxToolUseMessages",
    "turn_max_tool_use_messages",
    "toolUseBudget",
    "tool_use_budget",
    "PICLAW_TURN_MAX_TOOL_USE_MESSAGES",
  ];
  for (const key of clearRootKeys) {
    delete config[key];
  }
  config.turnMaxToolUseMessages = nextBudget;
  writeJsonConfig(getConfigPath(), config);

  process.env.PICLAW_TURN_MAX_TOOL_USE_MESSAGES = String(nextBudget);
  TOOL_USE_MESSAGE_BUDGET = nextBudget;
  return TOOL_USE_MESSAGE_BUDGET;
}

// ---------------------------------------------------------------------------
// Tool activation defaults – used by lazy tool activation.
// ---------------------------------------------------------------------------

/** Typed tool-activation config grouped for default active-tool selection. */
export interface ToolActivationConfig {
  additionalDefaultTools: string[];
}

/** Grouped tool-activation config loaded from `.piclaw/config.json`. */
export const TOOL_ACTIVATION_CONFIG = Object.freeze<ToolActivationConfig>({
  additionalDefaultTools: configAdditionalDefaultTools ?? [],
});

/** Typed workspace-search config grouped for FTS root and extension selection. */
export interface WorkspaceSearchConfig {
  roots: string[];
  /** Additional file extensions to index (merged with built-in defaults). */
  extraExtensions: string[];
}

const workspaceSearchRoots = pickStringArray(
  { PICLAW_WORKSPACE_SEARCH_ROOTS: process.env.PICLAW_WORKSPACE_SEARCH_ROOTS ?? envConfig.PICLAW_WORKSPACE_SEARCH_ROOTS },
  ["PICLAW_WORKSPACE_SEARCH_ROOTS"],
) ?? configWorkspaceSearchRoots ?? ["notes", ".pi/skills"];

const workspaceSearchExtensions = pickStringArray(
  { PICLAW_WORKSPACE_SEARCH_EXTENSIONS: process.env.PICLAW_WORKSPACE_SEARCH_EXTENSIONS ?? envConfig.PICLAW_WORKSPACE_SEARCH_EXTENSIONS },
  ["PICLAW_WORKSPACE_SEARCH_EXTENSIONS"],
) ?? configWorkspaceSearchExtensions ?? [];

/** Grouped workspace-search config loaded from env/config. */
export const WORKSPACE_SEARCH_CONFIG = Object.freeze<WorkspaceSearchConfig>({
  roots: workspaceSearchRoots,
  extraExtensions: workspaceSearchExtensions,
});

/** Return grouped workspace-search config for runtime wiring and tests. */
export function getWorkspaceSearchConfig(): Readonly<WorkspaceSearchConfig> {
  return WORKSPACE_SEARCH_CONFIG;
}

/** Return grouped tool-activation config for runtime wiring and tests. */
export function getToolActivationConfig(): Readonly<ToolActivationConfig> {
  return TOOL_ACTIVATION_CONFIG;
}

// ---------------------------------------------------------------------------
// Trigger pattern – used by router.ts to decide if a message mentions the bot.
// ---------------------------------------------------------------------------

/** Escape special regex characters in a literal string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Mutable routing settings grouped for live assistant-name updates. */
export interface RoutingConfig {
  triggerPattern: RegExp;
}

/** Grouped routing settings. `triggerPattern` stays mutable with assistant renames. */
export const ROUTING_CONFIG: RoutingConfig = Object.seal({
  triggerPattern: new RegExp(`(?:^|\\s)@${escapeRegex(IDENTITY_CONFIG.assistantName)}\\b`, "i"),
});

/** Return grouped routing settings for runtime wiring and tests. */
export function getRoutingConfig(): Readonly<RoutingConfig> {
  return ROUTING_CONFIG;
}

// ---------------------------------------------------------------------------
// Runtime setters – called by agent-control handlers to update identity.
// ---------------------------------------------------------------------------

/** Update the assistant's display name and re-derive the trigger pattern. */
export function setAssistantName(name: string): void {
  IDENTITY_CONFIG.assistantName = name.trim() || "PiClaw";
  ASSISTANT_NAME = IDENTITY_CONFIG.assistantName;
  ROUTING_CONFIG.triggerPattern = new RegExp(`(?:^|\\s)@${escapeRegex(IDENTITY_CONFIG.assistantName)}\\b`, "i");
}

/** Update the assistant's avatar URL/path. */
export function setAssistantAvatar(avatar: string): void {
  IDENTITY_CONFIG.assistantAvatar = avatar.trim();
  ASSISTANT_AVATAR = IDENTITY_CONFIG.assistantAvatar;
}

/** Update the human user's display name. */
export function setUserName(name: string): void {
  IDENTITY_CONFIG.userName = name.trim();
  USER_NAME = IDENTITY_CONFIG.userName;
}

/** Update the human user's avatar URL/path. */
export function setUserAvatar(avatar: string): void {
  IDENTITY_CONFIG.userAvatar = avatar.trim();
  USER_AVATAR = IDENTITY_CONFIG.userAvatar;
}

/** Update the human user's avatar background colour. */
export function setUserAvatarBackground(background: string): void {
  IDENTITY_CONFIG.userAvatarBackground = background.trim();
  USER_AVATAR_BACKGROUND = IDENTITY_CONFIG.userAvatarBackground;
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
  if (next) {
    process.env.PICLAW_WEB_TOTP_SECRET = next;
  } else {
    delete process.env.PICLAW_WEB_TOTP_SECRET;
  }

  return WEB_RUNTIME_CONFIG.totpSecret;
}

// ---------------------------------------------------------------------------
// Tool output retention settings – used by db/tool-outputs.ts.
// ---------------------------------------------------------------------------

/** Typed tool-output retention settings grouped for runtime startup wiring. */
export interface ToolOutputConfig {
  retentionMs: number;
  cleanupIntervalMs: number;
}

const DEFAULT_TOOL_OUTPUT_RETENTION_MS = 4 * 60 * 60 * 1000;
const DEFAULT_TOOL_OUTPUT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const legacyToolOutputRetentionDays = parseInt(process.env.PICLAW_TOOL_OUTPUT_RETENTION_DAYS || "", 10);
const toolOutputRetentionMs = parseInt(process.env.PICLAW_TOOL_OUTPUT_RETENTION_MS || "", 10);

/** Grouped tool-output retention settings. */
export const TOOL_OUTPUT_CONFIG = Object.freeze<ToolOutputConfig>({
  retentionMs: Number.isFinite(toolOutputRetentionMs) && toolOutputRetentionMs > 0
    ? toolOutputRetentionMs
    : Number.isFinite(legacyToolOutputRetentionDays) && legacyToolOutputRetentionDays > 0
      ? legacyToolOutputRetentionDays * 24 * 60 * 60 * 1000
      : DEFAULT_TOOL_OUTPUT_RETENTION_MS,
  cleanupIntervalMs: parseInt(
    process.env.PICLAW_TOOL_OUTPUT_CLEANUP_INTERVAL_MS || String(DEFAULT_TOOL_OUTPUT_CLEANUP_INTERVAL_MS),
    10
  ),
});

/** Return the grouped tool-output settings for startup wiring and tests. */
export function getToolOutputConfig(): Readonly<ToolOutputConfig> {
  return TOOL_OUTPUT_CONFIG;
}

// ---------------------------------------------------------------------------
// WhatsApp channel settings.
// ---------------------------------------------------------------------------

/** Typed WhatsApp channel settings grouped for startup/channel wiring. */
export interface WhatsAppConfig {
  phoneNumber: string;
}

/** Grouped WhatsApp channel settings. */
export const WHATSAPP_CONFIG = Object.freeze<WhatsAppConfig>({
  phoneNumber:
    process.env.WHATSAPP_PHONE ||
    envConfig.WHATSAPP_PHONE ||
    process.env.PICLAW_WHATSAPP_PHONE ||
    envConfig.PICLAW_WHATSAPP_PHONE ||
    configWhatsappPhone ||
    "",
});

/** Return the grouped WhatsApp settings for startup and channel wiring. */
export function getWhatsAppConfig(): Readonly<WhatsAppConfig> {
  return WHATSAPP_CONFIG;
}

// ---------------------------------------------------------------------------
// Pushover notification channel settings.
// ---------------------------------------------------------------------------

/** Typed Pushover channel settings grouped for runtime startup wiring. */
export interface PushoverConfig {
  appToken: string;
  userKey: string;
  device: string;
  priority: number;
  sound: string;
}

/** Grouped Pushover channel settings. */
export const PUSHOVER_CONFIG = Object.freeze<PushoverConfig>({
  appToken: process.env.PUSHOVER_APP_TOKEN || envConfig.PUSHOVER_APP_TOKEN || configAppToken || "",
  userKey: process.env.PUSHOVER_USER_KEY || envConfig.PUSHOVER_USER_KEY || configUserKey || "",
  device: process.env.PUSHOVER_DEVICE || envConfig.PUSHOVER_DEVICE || configDevice || "",
  priority: parseInt(
    process.env.PUSHOVER_PRIORITY || envConfig.PUSHOVER_PRIORITY || (configPriority !== undefined ? String(configPriority) : "0"),
    10
  ),
  sound: process.env.PUSHOVER_SOUND || envConfig.PUSHOVER_SOUND || configSound || "",
});

/** Return the grouped Pushover settings for startup wiring and tests. */
export function getPushoverConfig(): Readonly<PushoverConfig> {
  return PUSHOVER_CONFIG;
}
