import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getKeychainEntry } from "./keychain.js";
import { createLogger } from "../utils/logger.js";

const require = createRequire(import.meta.url);
const { loadMcpConfig } = require(join(dirname(require.resolve("pi-mcp-adapter")), "config.ts")) as {
  loadMcpConfig(overridePath?: string, cwd?: string): McpConfigFile;
};
const log = createLogger("secure.mcp-keychain");

interface McpServerCredentialConfig {
  disabled?: unknown;
  bearerToken?: unknown;
  bearerTokenEnv?: unknown;
  bearerTokenKeychain?: unknown;
  url?: unknown;
  cwd?: unknown;
  socket?: unknown;
  env?: unknown;
  headers?: unknown;
  oauth?: { clientSecret?: unknown } | unknown;
}

interface McpConfigFile {
  mcpServers?: Record<string, McpServerCredentialConfig>;
}

export interface HydratedMcpCredential {
  serverName: string;
  envName: string;
  keychainName: string;
}

export interface McpStartupDiagnostic {
  serverName: string;
  reason: string;
}

let preparedMcpConfig: McpConfigFile = { mcpServers: {} };
let mcpStartupDiagnostics: McpStartupDiagnostic[] = [];

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$env:([A-Za-z_][A-Za-z0-9_]*)|\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

function missingEnvironmentReferences(value: string): string[] {
  const escapedCommandMarker = value.startsWith("!!");
  const candidate = escapedCommandMarker ? value.slice(1) : value;
  // A leading single ! is an adapter command-secret expression. Its shell owns
  // any variable expansion, so Piclaw must not reject those references here.
  if (!escapedCommandMarker && candidate.startsWith("!")) return [];
  const missing = new Set<string>();
  for (const match of candidate.matchAll(ENV_REFERENCE)) {
    const name = match[1] ?? match[2] ?? match[3];
    if (name && process.env[name] === undefined) missing.add(name);
  }
  return [...missing];
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function validateMcpEnvironmentReferences(config: McpConfigFile): void {
  for (const [serverName, definition] of Object.entries(config.mcpServers ?? {})) {
    const values: Array<[string, string]> = [];
    for (const key of ["url", "cwd", "socket", "bearerToken"] as const) {
      const value = definition[key];
      if (typeof value === "string") values.push([key, value]);
    }
    for (const [key, value] of Object.entries(stringRecord(definition.env))) values.push([`env.${key}`, value]);
    for (const [key, value] of Object.entries(stringRecord(definition.headers))) values.push([`headers.${key}`, value]);
    if (definition.oauth && typeof definition.oauth === "object" && !Array.isArray(definition.oauth)) {
      const secret = (definition.oauth as { clientSecret?: unknown }).clientSecret;
      if (typeof secret === "string") values.push(["oauth.clientSecret", secret]);
    }
    for (const [field, value] of values) {
      const missing = missingEnvironmentReferences(value);
      if (missing.length > 0) {
        throw new Error(`MCP server ${serverName} ${field} references missing environment variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
      }
    }
  }
}

function serverReason(definition: McpServerCredentialConfig): string | null {
  const keychainName = definition.bearerTokenKeychain;
  if (keychainName === undefined) return null;
  if (typeof keychainName !== "string" || !keychainName.trim()) {
    return "bearerTokenKeychain must be a non-empty string.";
  }
  if (definition.bearerToken !== undefined) {
    return "cannot combine bearerToken and bearerTokenKeychain.";
  }
  const envName = definition.bearerTokenEnv;
  if (typeof envName !== "string" || !ENV_NAME.test(envName)) {
    return "must set a valid bearerTokenEnv with bearerTokenKeychain.";
  }
  if (process.env[envName] !== undefined) {
    return `bearerTokenEnv ${envName} is already set.`;
  }
  return null;
}

function disabledServerDefinition(definition: McpServerCredentialConfig): McpServerCredentialConfig {
  const { bearerTokenKeychain: _keychain, ...rest } = definition;
  return { ...rest, disabled: true };
}

function setMcpStartupDiagnostics(diagnostics: McpStartupDiagnostic[]): void {
  mcpStartupDiagnostics = diagnostics.map((diagnostic) => ({ ...diagnostic }));
  for (const diagnostic of diagnostics) {
    log.warn("Quarantined invalid optional MCP server during startup", {
      operation: "mcp.startup_quarantined",
      serverName: diagnostic.serverName,
      reason: diagnostic.reason,
    });
  }
}

/** Return the sanitized effective MCP config prepared during runtime bootstrap. */
export function getPreparedMcpConfig(): McpConfigFile {
  return structuredClone(preparedMcpConfig);
}

/** Safe startup diagnostics for optional MCP servers quarantined from the adapter. */
export function getMcpStartupDiagnostics(): McpStartupDiagnostic[] {
  return mcpStartupDiagnostics.map((diagnostic) => ({ ...diagnostic }));
}

export function resetMcpStartupStateForTests(): void {
  preparedMcpConfig = { mcpServers: {} };
  mcpStartupDiagnostics = [];
}

export async function hydrateMcpKeychainCredentials(
  workspaceDir: string,
  resolveEntry: typeof getKeychainEntry = getKeychainEntry,
): Promise<HydratedMcpCredential[]> {
  let config: McpConfigFile;
  const diagnostics: McpStartupDiagnostic[] = [];
  try {
    config = structuredClone(loadMcpConfig(undefined, workspaceDir) as McpConfigFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    config = { mcpServers: {} };
    diagnostics.push({ serverName: "(configuration)", reason: `could not be loaded: ${message}` });
  }
  const hydrated: HydratedMcpCredential[] = [];
  const servers = config.mcpServers ?? (config.mcpServers = {});
  const candidates: Array<[string, McpServerCredentialConfig]> = [];

  for (const [serverName, rawDefinition] of Object.entries(servers)) {
    const definition = rawDefinition && typeof rawDefinition === "object" && !Array.isArray(rawDefinition)
      ? rawDefinition as McpServerCredentialConfig
      : null;
    if (!definition) {
      servers[serverName] = { disabled: true };
      diagnostics.push({ serverName, reason: "configuration must be an object." });
      continue;
    }
    if (definition.disabled === true) continue;
    const reason = serverReason(definition);
    if (reason) {
      servers[serverName] = disabledServerDefinition(definition);
      diagnostics.push({ serverName, reason });
      continue;
    }
    candidates.push([serverName, definition]);
  }

  const claimedEnvNames = new Set<string>();
  for (const [serverName, definition] of candidates) {
    const keychainName = definition.bearerTokenKeychain;
    if (keychainName === undefined) continue;
    const envName = definition.bearerTokenEnv as string;
    if (claimedEnvNames.has(envName)) {
      servers[serverName] = disabledServerDefinition(definition);
      diagnostics.push({ serverName, reason: `bearerTokenEnv ${envName} is already claimed by another MCP server.` });
      continue;
    }
    try {
      const entry = await resolveEntry(keychainName as string);
      if (!entry.secret) throw new Error("missing secret");
      process.env[envName] = entry.secret;
      claimedEnvNames.add(envName);
      hydrated.push({ serverName, envName, keychainName: keychainName as string });
    } catch {
      servers[serverName] = disabledServerDefinition(definition);
      diagnostics.push({ serverName, reason: "keychain entry is unavailable or has no secret." });
    }
  }

  for (const [serverName, definition] of candidates) {
    if (servers[serverName]?.disabled === true) continue;
    try {
      validateMcpEnvironmentReferences({ mcpServers: { [serverName]: definition } });
    } catch (error) {
      servers[serverName] = disabledServerDefinition(definition);
      const message = error instanceof Error ? error.message.replace(/^MCP server [^ ]+ /, "") : "references an unavailable environment variable.";
      diagnostics.push({ serverName, reason: message });
      const hydratedEntry = hydrated.find((entry) => entry.serverName === serverName);
      if (hydratedEntry) {
        delete process.env[hydratedEntry.envName];
        hydrated.splice(hydrated.indexOf(hydratedEntry), 1);
      }
    }
  }

  preparedMcpConfig = config;
  setMcpStartupDiagnostics(diagnostics);
  return hydrated;
}

export function clearHydratedMcpCredentials(entries: HydratedMcpCredential[]): void {
  for (const entry of entries) delete process.env[entry.envName];
}
