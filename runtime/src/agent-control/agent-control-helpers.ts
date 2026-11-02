/**
 * agent-control/agent-control-helpers.ts – Shared helpers for control handlers.
 *
 * Provides utility functions used across multiple handler modules:
 *   - THINKING_LEVELS constant array.
 *   - Shell command formatting (formatShellBlock, resolveShellCwd).
 *   - Session state inspection (getModelLabel, formatSessionState).
 *   - Config file persistence for identity changes.
 *   - Context usage and stats formatting.
 *
 * Consumers:
 *   - All handler modules under handlers/*.ts.
 *   - agent-pool.ts for model label resolution.
 */

import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import { MODEL_THINKING_LEVELS } from "@earendil-works/pi-ai/providers/model-schema";
import { existsSync } from "fs";
import { getConfigPath, WORKSPACE_DIR } from "../core/config.js";
import { readJsonConfig, writeJsonConfig } from "../core/config-store.js";
import type { AgentControlCommand, AgentControlResult } from "./agent-control-types.js";

/** Ordered list of supported thinking levels from off to max. */
const THINKING_LEVELS = MODEL_THINKING_LEVELS;

type ThinkingLevelMapWithFutureLevels = Record<string, string | null | undefined>;
type ThinkingModelDescriptor = Pick<Model<Api>, "provider" | "reasoning" | "thinkingLevelMap">;

/**
 * Detect pre-0.80.6/custom model metadata that exposed provider `max` through
 * Pi's old `xhigh` slot. Native `max` must remain distinct when both exist.
 */
export function usesLegacyMaxThinkingAlias(model: ThinkingModelDescriptor | null | undefined): boolean {
  const thinkingLevelMap = model?.thinkingLevelMap as ThinkingLevelMapWithFutureLevels | undefined;
  return thinkingLevelMap?.xhigh === "max" && thinkingLevelMap.max == null;
}

/** Resolve the legacy `max` alias without collapsing native 0.80.6 `max`. */
export function resolveThinkingAlias(level: string, model: ThinkingModelDescriptor | null | undefined): string {
  return level === "max" && usesLegacyMaxThinkingAlias(model) ? "xhigh" : level;
}

/** Display legacy `xhigh: max` metadata as max while preserving native xhigh. */
export function formatThinkingLevelForDisplay(level: string, model: ThinkingModelDescriptor | null | undefined): string {
  return level === "xhigh" && usesLegacyMaxThinkingAlias(model) ? "max" : level;
}

/**
 * Return Piclaw's view of model-supported thinking levels.
 *
 * Pi 0.80.x still exposes the historical `off..xhigh` type surface, while
 * provider metadata can already advertise native `max`. Merge explicit
 * thinkingLevelMap slots so UI/status/control paths can surface and preserve
 * native max without treating legacy `xhigh: max` aliases as the same thing.
 */
export function getAvailableThinkingLevelsForModel(
  model: ThinkingModelDescriptor | null | undefined,
  baseLevels?: readonly string[],
): string[] {
  if (!model?.reasoning) return ["off"];

  const levels: string[] = [];
  const add = (level: string | null | undefined) => {
    if (!level || levels.includes(level)) return;
    levels.push(level);
  };

  for (const level of baseLevels ?? getSupportedThinkingLevels(model as Model<Api>)) {
    add(level);
  }

  const thinkingLevelMap = model.thinkingLevelMap as ThinkingLevelMapWithFutureLevels | undefined;
  if (thinkingLevelMap) {
    for (const level of THINKING_LEVELS) {
      if (thinkingLevelMap[level] !== null && thinkingLevelMap[level] !== undefined) {
        add(level);
      }
    }
  }

  return levels.length > 0 ? levels : ["off"];
}

/** Return the preferred working directory for shell commands (configured workspace or cwd). */
export function resolveShellCwd(): string {
  if (existsSync(WORKSPACE_DIR)) return WORKSPACE_DIR;
  const legacyPreferred = "/workspace";
  if (existsSync(legacyPreferred)) return legacyPreferred;
  return process.cwd();
}

/** Format a shell command and its output as a markdown-style code block. */
export function formatShellBlock(command: string, output: string, meta: string[] = []): string {
  const lines: string[] = [`$ ${command}`];
  const trimmed = output.trimEnd();
  if (trimmed) {
    lines.push(trimmed);
  } else {
    lines.push("(no output)");
  }
  if (meta.length > 0) {
    lines.push(...meta);
  }
  return ["```", ...lines, "```"].join("\n");
}

/** Format a byte count using human-readable binary units. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return String(bytes);
  const abs = Math.abs(bytes);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = abs;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
  const trimmed = formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted;
  return `${bytes < 0 ? "-" : ""}${trimmed} ${units[unitIndex]}`;
}

/** Format a number with K/M suffixes for compact display. */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  const format = (divisor: number, suffix: string) => {
    const raw = (value / divisor).toFixed(1);
    const trimmed = raw.endsWith(".0") ? raw.slice(0, -2) : raw;
    return `${trimmed}${suffix}`;
  };
  if (abs >= 1_000_000_000) return format(1_000_000_000, "B");
  if (abs >= 1_000_000) return format(1_000_000, "M");
  if (abs >= 1_000) return format(1_000, "K");
  return String(value);
}

/** Format a number as a USD currency string. */
export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "$0";
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/** Truncate text to maxLen characters, appending '…' if truncated. */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

/** Extract plain text from a pi-agent content block array. */
export function extractTextFromContent(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const textBlock = block as { type?: unknown; text?: unknown };
        if (textBlock.type !== "text") return "";
        return typeof textBlock.text === "string" ? textBlock.text : "";
      })
      .join("");
  }
  return "";
}

/** Persist assistant identity changes (name, avatar) to the config file. */
export function updateAssistantConfig(patch: { name?: string | null; avatar?: string | null }): {
  name?: string;
  avatar?: string;
} {
  const config = readJsonConfig(getConfigPath());
  const assistant =
    config.assistant && typeof config.assistant === "object"
      ? { ...(config.assistant as Record<string, unknown>) }
      : {};
  const nameKeys = ["assistantName", "assistant_name", "agentName", "agent_name", "name", "ASSISTANT_NAME"];
  const avatarKeys = [
    "assistantAvatar",
    "assistant_avatar",
    "agentAvatar",
    "agent_avatar",
    "avatar",
    "ASSISTANT_AVATAR",
  ];

  const clearKeys = (keys: string[]) => {
    for (const key of keys) {
      if (key in assistant) delete assistant[key];
    }
  };

  if (patch.name !== undefined) {
    clearKeys(nameKeys);
    if (patch.name !== null) {
      assistant.assistantName = patch.name;
    }
  }

  if (patch.avatar !== undefined) {
    clearKeys(avatarKeys);
    if (patch.avatar !== null) {
      assistant.assistantAvatar = patch.avatar;
    }
  }

  if (Object.keys(assistant).length > 0) {
    config.assistant = assistant;
  } else {
    delete config.assistant;
  }

  writeJsonConfig(getConfigPath(), config);

  return {
    name: typeof assistant.assistantName === "string" ? assistant.assistantName : undefined,
    avatar: typeof assistant.assistantAvatar === "string" ? assistant.assistantAvatar : undefined,
  };
}

/** Persist user identity changes (name, avatar, github) to the config file. */
export function updateUserConfig(patch: {
  name?: string | null;
  avatar?: string | null;
  avatarBackground?: string | null;
}): {
  name?: string;
  avatar?: string;
  avatarBackground?: string;
} {
  const config = readJsonConfig(getConfigPath());
  const user =
    config.user && typeof config.user === "object"
      ? { ...(config.user as Record<string, unknown>) }
      : {};
  const nameKeys = ["userName", "user_name", "name", "PICLAW_USER_NAME"];
  const avatarKeys = ["userAvatar", "user_avatar", "avatar", "PICLAW_USER_AVATAR"];
  const backgroundKeys = [
    "userAvatarBackground",
    "user_avatar_background",
    "userAvatarBg",
    "user_avatar_bg",
    "avatarBackground",
    "avatar_background",
    "PICLAW_USER_AVATAR_BACKGROUND",
  ];

  const clearKeys = (keys: string[]) => {
    for (const key of keys) {
      if (key in user) delete user[key];
    }
  };

  if (patch.name !== undefined) {
    clearKeys(nameKeys);
    if (patch.name !== null) {
      user.userName = patch.name;
    }
  }

  if (patch.avatar !== undefined) {
    clearKeys(avatarKeys);
    if (patch.avatar !== null) {
      user.userAvatar = patch.avatar;
    }
  }

  if (patch.avatarBackground !== undefined) {
    clearKeys(backgroundKeys);
    if (patch.avatarBackground !== null) {
      user.userAvatarBackground = patch.avatarBackground;
    }
  }

  if (Object.keys(user).length > 0) {
    config.user = user;
  } else {
    delete config.user;
  }

  writeJsonConfig(getConfigPath(), config);

  return {
    name: typeof user.userName === "string" ? user.userName : undefined,
    avatar: typeof user.userAvatar === "string" ? user.userAvatar : undefined,
    avatarBackground:
      typeof user.userAvatarBackground === "string" ? user.userAvatarBackground : undefined,
  };
}

/** Fuzzy-match a model input string against available models. */
export function normalizeModelMatch(
  models: Model<Api>[],
  provider: string,
  modelId: string
): Model<Api> | undefined {
  const providerLower = provider.toLowerCase();
  const modelLower = modelId.toLowerCase();
  return models.find((model) => model.provider.toLowerCase() === providerLower && model.id.toLowerCase() === modelLower);
}

/** Resolve a native model command against the shared cached catalogue. */
type ModelCommand = Extract<AgentControlCommand, { type: "model" }>;
export function resolveControlModelSelection(registry: Pick<ModelRegistry, "getAll">, command: ModelCommand): Model<Api> | AgentControlResult {
  if (!command.modelId) return { status: "error", message: "Select one exact available model." };
  const models = registry.getAll();
  let selected: Model<Api> | undefined;
  if (command.provider) {
    selected = normalizeModelMatch(models, command.provider, command.modelId!);
    if (!selected) {
      return {
        status: "error",
        message: `Model not found: ${command.provider}/${command.modelId}.`,
      };
    }
  } else {
    const matches = models.filter((model) => model.id.toLowerCase() === command.modelId!.toLowerCase());
    if (matches.length === 0) {
      return {
        status: "error",
        message: `Model not found: ${command.modelId}.`,
      };
    }
    if (matches.length > 1) {
      const providers = matches.map((model) => `${model.provider}/${model.id}`).join(", ");
      return {
        status: "error",
        message: `Model "${command.modelId}" matches multiple providers: ${providers}. Use /model <provider>/<modelId>.`,
      };
    }
    selected = matches[0];
  }

  return selected!;
}
