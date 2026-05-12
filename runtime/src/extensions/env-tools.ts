import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { applyEnvironmentOverrides } from "../environment-overrides.js";

const ENV_TOOL_SCHEMA = Type.Object({
  action: Type.Union([
    Type.Literal("get"),
    Type.Literal("set"),
    Type.Literal("clear"),
  ], {
    description: "Operation to perform: get one managed value or list all names, set/update a value, or clear one/all managed values.",
  }),
  name: Type.Optional(Type.String({ description: "Environment variable name. Optional for action=get and action=clear." })),
  value: Type.Optional(Type.String({ description: "Value for action=set. Use $NAME or ${NAME} to copy an existing environment variable." })),
  limit: Type.Optional(Type.Integer({ description: "Max names to show when action=get omits name (1-200).", minimum: 1, maximum: 200 })),
});

type EnvToolParams = {
  action: "get" | "set" | "clear";
  name?: string;
  value?: string;
  limit?: number;
};

type EnvToolDetails = {
  ok: boolean;
  action: EnvToolParams["action"];
  name?: string;
  count?: number;
  names?: string[];
  source?: "managed" | "process";
  persisted?: boolean;
  applied_immediately?: boolean;
  cleared?: boolean;
  copied_from_env?: string | null;
  env_file: string;
  state_file: string;
  reason?: string;
};

type ManagedWorkspaceEnv = Record<string, string>;

const ENV_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COPY_ENV_REGEX = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/;
const MANAGED_BLOCK_START = "# >>> piclaw env tool >>>";
const MANAGED_BLOCK_END = "# <<< piclaw env tool <<<";

const ENV_TOOL_HINT = [
  "## Workspace environment tool",
  "Use env to manage persistent workspace-scoped environment variables for non-secret configuration.",
  `env writes a managed block into ${getWorkspaceRoot()}/.env.sh, persists the source-of-truth under ${getWorkspaceRoot()}/.piclaw/env-tool.json, and updates process.env immediately so later tool calls in the same runtime see the change.`,
  "Prefer keychain for secrets/tokens/passwords; use env for deliberate persistent config like PATH helpers, config dirs, feature flags, or non-secret API endpoints.",
  "For action=set, values like $NAME or ${NAME} copy the current process environment variable of that name.",
].join("\n");

function getWorkspaceRoot(): string {
  return resolve(process.env.PICLAW_WORKSPACE || "/workspace");
}

function getEnvScriptPath(): string {
  return join(getWorkspaceRoot(), ".env.sh");
}

function getEnvStatePath(): string {
  return join(getWorkspaceRoot(), ".piclaw", "env-tool.json");
}

function pathDetails() {
  return {
    env_file: getEnvScriptPath(),
    state_file: getEnvStatePath(),
  };
}

function clampLimit(value: number | undefined, fallback = 100): number {
  if (!Number.isFinite(value)) return fallback;
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, 1), 200);
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidEnvName(name: string): boolean {
  return ENV_NAME_REGEX.test(name);
}

function sanitizeManagedEnv(input: unknown): ManagedWorkspaceEnv {
  if (!input || typeof input !== "object") return {};
  const entries = Object.entries(input as Record<string, unknown>)
    .map(([key, value]) => [normalizeName(key), typeof value === "string" ? value : String(value ?? "")] as const)
    .filter(([key]) => isValidEnvName(key))
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

function loadManagedEnv(): ManagedWorkspaceEnv {
  try {
    return sanitizeManagedEnv(JSON.parse(readFileSync(getEnvStatePath(), "utf8")));
  } catch {
    return {};
  }
}

function shellEscapeSingleQuoted(value: string): string {
  return `'${String(value || "").replace(/'/g, `'"'"'`)}'`;
}

function renderManagedBlock(entries: ManagedWorkspaceEnv): string {
  const names = Object.keys(entries).sort((a, b) => a.localeCompare(b));
  if (names.length === 0) return "";
  return [
    MANAGED_BLOCK_START,
    "# Managed by the piclaw env tool. Manual edits inside this block may be overwritten.",
    ...names.map((name) => `export ${name}=${shellEscapeSingleQuoted(entries[name] || "")}`),
    MANAGED_BLOCK_END,
  ].join("\n");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertManagedBlock(existingContent: string, entries: ManagedWorkspaceEnv): string {
  const normalized = String(existingContent || "");
  const block = renderManagedBlock(entries);
  const blockRegex = new RegExp(`${escapeRegex(MANAGED_BLOCK_START)}[\\s\\S]*?${escapeRegex(MANAGED_BLOCK_END)}\\n?`, "m");
  const withoutBlock = normalized.replace(blockRegex, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  if (!block) return withoutBlock ? `${withoutBlock}\n` : "";
  if (!withoutBlock) return `${block}\n`;
  return `${withoutBlock}\n\n${block}\n`;
}

function persistManagedEnv(entries: ManagedWorkspaceEnv): void {
  const next = sanitizeManagedEnv(entries);
  const statePath = getEnvStatePath();
  const scriptPath = getEnvScriptPath();
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  const currentScript = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : "";
  const nextScript = upsertManagedBlock(currentScript, next);
  if (!nextScript.trim()) {
    if (existsSync(scriptPath)) rmSync(scriptPath, { force: true });
    return;
  }
  writeFileSync(scriptPath, nextScript, "utf8");
}

function applyEnvDiff(previousEntries: ManagedWorkspaceEnv, nextEntries: ManagedWorkspaceEnv): void {
  const previousNames = new Set(Object.keys(previousEntries));
  const nextNames = new Set(Object.keys(nextEntries));
  for (const name of previousNames) {
    if (!nextNames.has(name)) delete process.env[name];
  }
  for (const [name, value] of Object.entries(nextEntries)) {
    process.env[name] = value;
  }
}

function resolveSetValue(rawValue: string): { value: string; copiedFromEnv: string | null } | { error: string; copiedFromEnv: null } {
  const match = String(rawValue).match(COPY_ENV_REGEX);
  if (!match) {
    return { value: String(rawValue), copiedFromEnv: null };
  }
  const envName = match[1] || match[2] || "";
  if (!envName) {
    return { value: String(rawValue), copiedFromEnv: null };
  }
  if (typeof process.env[envName] !== "string") {
    return { error: `Environment variable not found for copy: ${envName}`, copiedFromEnv: null };
  }
  return { value: process.env[envName] || "", copiedFromEnv: envName };
}

function buildResult(text: string, details: EnvToolDetails): AgentToolResult<EnvToolDetails> {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

export const envTools: ExtensionFactory = (pi: ExtensionAPI) => {
  const initial = loadManagedEnv();
  applyEnvDiff({}, initial);
  try { applyEnvironmentOverrides(); } catch { /* KV-backed environment overrides require runtime DB init. */ }

  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${ENV_TOOL_HINT}`,
  }));

  pi.registerTool({
    name: "env",
    label: "env",
    description: `Get, set, or clear persistent workspace-scoped environment variables. Writes a managed block into ${getWorkspaceRoot()}/.env.sh, persists state under ${getWorkspaceRoot()}/.piclaw/env-tool.json, updates process.env immediately for later tool calls, and supports copying existing vars via $NAME on set. Prefer keychain for secrets.`,
    promptSnippet: `env: get/set/clear persistent workspace-scoped environment variables in ${getWorkspaceRoot()}/.env.sh (use $NAME to copy an existing env var; prefer keychain for secrets).`,
    parameters: ENV_TOOL_SCHEMA,
    async execute(_toolCallId, params: EnvToolParams): Promise<AgentToolResult<EnvToolDetails>> {
      const current = loadManagedEnv();
      const name = normalizeName(params.name);

      if (name && !isValidEnvName(name)) {
        return buildResult(`Invalid environment variable name: ${name}`, {
          ok: false,
          action: params.action,
          name,
          reason: "invalid_name",
          ...pathDetails(),
        });
      }

      if (params.action === "get") {
        if (!name) {
          const names = Object.keys(current).sort((a, b) => a.localeCompare(b)).slice(0, clampLimit(params.limit, 100));
          if (names.length === 0) {
            return buildResult("No managed workspace environment variables found.", {
              ok: true,
              action: "get",
              count: 0,
              names: [],
              ...pathDetails(),
            });
          }
          return buildResult(`Managed workspace environment variables (${names.length}):\n${names.map((entryName) => `• ${entryName}`).join("\n")}`, {
            ok: true,
            action: "get",
            count: names.length,
            names,
            ...pathDetails(),
          });
        }

        if (Object.prototype.hasOwnProperty.call(current, name)) {
          return buildResult(current[name], {
            ok: true,
            action: "get",
            name,
            persisted: true,
            source: "managed",
            ...pathDetails(),
          });
        }
        if (typeof process.env[name] === "string") {
          return buildResult(process.env[name] || "", {
            ok: true,
            action: "get",
            name,
            persisted: false,
            source: "process",
            ...pathDetails(),
          });
        }
        return buildResult(`Environment variable not found: ${name}`, {
          ok: false,
          action: "get",
          name,
          reason: "not_found",
          ...pathDetails(),
        });
      }

      if (params.action === "set") {
        if (!name) {
          return buildResult("Provide name for action=set.", {
            ok: false,
            action: "set",
            reason: "missing_name",
            ...pathDetails(),
          });
        }
        if (params.value === undefined) {
          return buildResult("Provide value for action=set.", {
            ok: false,
            action: "set",
            name,
            reason: "missing_value",
            ...pathDetails(),
          });
        }
        const resolved = resolveSetValue(params.value);
        if ("error" in resolved) {
          return buildResult(resolved.error, {
            ok: false,
            action: "set",
            name,
            reason: "copy_source_missing",
            copied_from_env: null,
            ...pathDetails(),
          });
        }

        const next = { ...current, [name]: resolved.value };
        persistManagedEnv(next);
        applyEnvDiff(current, next);
        try { applyEnvironmentOverrides(); } catch { /* KV-backed environment overrides require runtime DB init. */ }
        const copiedSuffix = resolved.copiedFromEnv ? ` (copied from $${resolved.copiedFromEnv})` : "";
        return buildResult(`Stored ${name} in the managed workspace environment${copiedSuffix}.`, {
          ok: true,
          action: "set",
          name,
          persisted: true,
          applied_immediately: true,
          copied_from_env: resolved.copiedFromEnv,
          ...pathDetails(),
        });
      }

      if (!name) {
        persistManagedEnv({});
        applyEnvDiff(current, {});
        try { applyEnvironmentOverrides(); } catch { /* KV-backed environment overrides require runtime DB init. */ }
        return buildResult(Object.keys(current).length > 0 ? "Cleared all managed workspace environment variables." : "No managed workspace environment variables existed.", {
          ok: true,
          action: "clear",
          cleared: Object.keys(current).length > 0,
          count: 0,
          names: [],
          applied_immediately: true,
          ...pathDetails(),
        });
      }

      if (!Object.prototype.hasOwnProperty.call(current, name)) {
        return buildResult(`Managed workspace environment variable not found: ${name}`, {
          ok: false,
          action: "clear",
          name,
          reason: "not_found",
          ...pathDetails(),
        });
      }

      const next = { ...current };
      delete next[name];
      persistManagedEnv(next);
      applyEnvDiff(current, next);
      try { applyEnvironmentOverrides(); } catch { /* KV-backed environment overrides require runtime DB init. */ }
      return buildResult(`Cleared ${name} from the managed workspace environment.`, {
        ok: true,
        action: "clear",
        name,
        cleared: true,
        persisted: false,
        applied_immediately: true,
        ...pathDetails(),
      });
    },
  });
};
