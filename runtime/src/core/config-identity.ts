/** Mutable assistant/user identity, routing, and UI theme configuration. */

import { pickString } from "./config-helpers.js";
import {
  assistantConfig,
  envConfig,
  getDomainConfigOptions,
  piclawConfig,
  userConfig,
} from "./config-context.js";
import { createLogger } from "../utils/logger.js";
import {
  readDomainConfig,
  registerDomainConfig,
  stringField,
  writeDomainConfigField,
} from "./domain-config.js";

const log = createLogger("core.config");

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

const configAssistantName = pickString(assistantConfig, [
  "assistantName", "assistant_name", "agentName", "agent_name", "name", "ASSISTANT_NAME",
]);
const configAssistantAvatar = pickString(assistantConfig, [
  "assistantAvatar", "assistant_avatar", "agentAvatar", "agent_avatar", "avatar", "ASSISTANT_AVATAR",
]);
const configUserName = pickString(userConfig, ["userName", "user_name", "name", "PICLAW_USER_NAME"]);
const configUserAvatar = pickString(userConfig, ["userAvatar", "user_avatar", "avatar", "PICLAW_USER_AVATAR"]);
const configUserAvatarBackground = pickString(userConfig, [
  "userAvatarBackground", "user_avatar_background", "userAvatarBg", "user_avatar_bg",
  "avatarBackground", "avatar_background", "PICLAW_USER_AVATAR_BACKGROUND",
]);

export interface IdentityConfig {
  assistantName: string;
  assistantAvatar: string;
  userName: string;
  userAvatar: string;
  userAvatarBackground: string;
}

const identityDomainSchema = registerDomainConfig<IdentityConfig>({
  domain: "identity",
  fields: {
    assistantName: stringField({ key: "assistantName", owner: "identity", defaultValue: configAssistantName || "PiClaw", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [
      { envKey: "PICLAW_ASSISTANT_NAME", replacement: "domains.identity.assistantName", removalVersion: "3.0.0" },
      { envKey: "ASSISTANT_NAME", replacement: "domains.identity.assistantName", removalVersion: "3.0.0" },
    ] }),
    assistantAvatar: stringField({ key: "assistantAvatar", owner: "identity", defaultValue: configAssistantAvatar || "", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [
      { envKey: "PICLAW_ASSISTANT_AVATAR", replacement: "domains.identity.assistantAvatar", removalVersion: "3.0.0" },
      { envKey: "ASSISTANT_AVATAR", replacement: "domains.identity.assistantAvatar", removalVersion: "3.0.0" },
    ] }),
    userName: stringField({ key: "userName", owner: "identity", defaultValue: configUserName || "", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_USER_NAME", replacement: "domains.identity.userName", removalVersion: "3.0.0" }] }),
    userAvatar: stringField({ key: "userAvatar", owner: "identity", defaultValue: configUserAvatar || "", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_USER_AVATAR", replacement: "domains.identity.userAvatar", removalVersion: "3.0.0" }] }),
    userAvatarBackground: stringField({ key: "userAvatarBackground", owner: "identity", defaultValue: configUserAvatarBackground || "", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_USER_AVATAR_BACKGROUND", replacement: "domains.identity.userAvatarBackground", removalVersion: "3.0.0" }] }),
  },
});

const IDENTITY_DOMAIN_CONFIG = readDomainConfig(identityDomainSchema, getDomainConfigOptions());

export const IDENTITY_CONFIG: IdentityConfig = Object.seal({
  assistantName: IDENTITY_DOMAIN_CONFIG.assistantName || process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || "PiClaw",
  assistantAvatar: IDENTITY_DOMAIN_CONFIG.assistantAvatar || process.env.ASSISTANT_AVATAR || envConfig.ASSISTANT_AVATAR || "",
  userName: IDENTITY_DOMAIN_CONFIG.userName || "",
  userAvatar: IDENTITY_DOMAIN_CONFIG.userAvatar || "",
  userAvatarBackground: IDENTITY_DOMAIN_CONFIG.userAvatarBackground || "",
});

export function getIdentityConfig(): Readonly<IdentityConfig> { return IDENTITY_CONFIG; }
export let ASSISTANT_NAME = IDENTITY_CONFIG.assistantName;
export let ASSISTANT_AVATAR = IDENTITY_CONFIG.assistantAvatar;
export let USER_NAME = IDENTITY_CONFIG.userName;
export let USER_AVATAR = IDENTITY_CONFIG.userAvatar;
export let USER_AVATAR_BACKGROUND = IDENTITY_CONFIG.userAvatarBackground;

export interface UiThemeConfig { theme: string; tint: string | null; }
const uiSection = piclawConfig.ui && typeof piclawConfig.ui === "object" ? piclawConfig.ui as Record<string, unknown> : {};
const UI_THEME = typeof uiSection.theme === "string" ? uiSection.theme.trim() : "default";
const UI_TINT: string | null = typeof uiSection.tint === "string" && uiSection.tint.trim() ? uiSection.tint.trim() : null;

export function getUiThemeConfig(): UiThemeConfig { return { theme: UI_THEME, tint: UI_TINT }; }
function escapeRegex(str: string): string { return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
export interface RoutingConfig { triggerPattern: RegExp; }
export const ROUTING_CONFIG: RoutingConfig = Object.seal({ triggerPattern: new RegExp(`(?:^|\\s)@${escapeRegex(IDENTITY_CONFIG.assistantName)}\\b`, "i") });
export function getRoutingConfig(): Readonly<RoutingConfig> { return ROUTING_CONFIG; }

function persistIdentitySetting<K extends keyof IdentityConfig>(key: K, value: IdentityConfig[K]): IdentityConfig[K] {
  writeDomainConfigField(identityDomainSchema, getDomainConfigOptions(), key, value);
  IDENTITY_DOMAIN_CONFIG[key] = value; IDENTITY_CONFIG[key] = value;
  ASSISTANT_NAME = IDENTITY_CONFIG.assistantName; ASSISTANT_AVATAR = IDENTITY_CONFIG.assistantAvatar;
  USER_NAME = IDENTITY_CONFIG.userName; USER_AVATAR = IDENTITY_CONFIG.userAvatar; USER_AVATAR_BACKGROUND = IDENTITY_CONFIG.userAvatarBackground;
  ROUTING_CONFIG.triggerPattern = new RegExp(`(?:^|\\s)@${escapeRegex(IDENTITY_CONFIG.assistantName)}\\b`, "i");
  return value;
}

export function setAssistantName(name: string): void { persistIdentitySetting("assistantName", name.trim() || "PiClaw"); }
export function setAssistantAvatar(avatar: string): void { persistIdentitySetting("assistantAvatar", avatar.trim()); }
export function setUserName(name: string): void { persistIdentitySetting("userName", name.trim()); }
export function setUserAvatar(avatar: string): void { persistIdentitySetting("userAvatar", avatar.trim()); }
export function setUserAvatarBackground(background: string): void { persistIdentitySetting("userAvatarBackground", background.trim()); }
