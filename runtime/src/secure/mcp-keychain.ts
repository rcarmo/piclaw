import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import lockfile from "proper-lockfile";
import stripJsonComments from "strip-json-comments";
import { cloneMcpConfig, getConfigDiscoveryPaths, getServerProvenance, loadMcpConfig } from "pi-mcp-adapter/config";
import type { McpConfig, ServerEntry, ServerProvenance } from "pi-mcp-adapter/types";
import type { LoadedMcpConfig, McpServerConfig, McpServerEntry } from "@earendil-works/pi-coding-agent";
import { getKeychainEntry } from "./keychain.js";
import { createLogger } from "../utils/logger.js";
import { assertMcpServerCredentialBinding, parseMcpServerEdit, patchMcpProjectOverride, projectMcpServerEdit, type McpServerEdit } from './mcp-server-edits.js';

const log = createLogger("secure.mcp-keychain");
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$env:([A-Za-z_][A-Za-z0-9_]*)|\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;
const COMMAND_ENV_REFERENCE = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;
const OPERATIONAL_ENV = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SystemRoot", "ComSpec", "PATHEXT"] as const;
const SERVER_FIELDS = new Set([
  "command", "args", "socket", "env", "cwd", "url", "headers", "requestHeadersCommand", "auth", "bearerToken",
  "bearerTokenEnv", "bearerTokenKeychain", "bearerTokenStore", "oauth", "lifecycle", "idleTimeout", "requestTimeoutMs",
  "exposeResources", "directTools", "toolPrefix", "includeTools", "excludeTools", "searchKeywords", "approveTools", "debug",
  "trace", "httpTransport", "pluginDataDir", "literalEnv", "protocolVersion", "disabled",
]);

interface PiclawServerEntry extends ServerEntry { bearerTokenKeychain?: unknown }
interface PiclawMcpConfig extends McpConfig { mcpServers: Record<string, PiclawServerEntry> }

export interface HydratedMcpCredential { serverName: string; envName: string; keychainName: string }
export interface McpStartupDiagnostic { serverName: string; reason: string }
export interface McpBridgeProvenance { serverName: string; path: string; kind: ServerProvenance["kind"]; importKind?: string }
export interface McpBridgePreviewRow { serverName: string; status: "mapped" | "blocked" | "quarantined"; source?: string; mappings: string[]; reasons: string[] }
export interface McpBridgeDryRun { revision: string; rows: McpBridgePreviewRow[]; diagnostics: McpStartupDiagnostic[]; secretValuesPresent: false }
export interface McpBridgeSnapshot {
  revision: string;
  adapterConfig: McpConfig;
  nativePreview: LoadedMcpConfig;
  provenance: McpBridgeProvenance[];
  diagnostics: McpStartupDiagnostic[];
  sourceRevisions: Record<string, string | null>;
  dryRun: McpBridgeDryRun;
}
/** Prepared snapshots contain JSON only and are recursively frozen before publication. */
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type McpBridgeReadSnapshot = DeepReadonly<McpBridgeSnapshot>;

export interface McpSessionBridgeLease {
  config: McpConfig;
  revision: string;
  nativePreview?: LoadedMcpConfig;
  resolveRuntimeEnv(serverName: string): Readonly<NodeJS.ProcessEnv>;
  release(): void;
}

let preparedSnapshot: McpBridgeSnapshot = emptySnapshot();
let preparedSourceIdentities: Record<string, string | null> = {};
interface SecretGeneration { secrets: Map<string, Map<string, string>>; references: Map<string, Set<string>>; leases: number; retired: boolean }
let preparedGeneration: SecretGeneration = { secrets: new Map(), references: new Map(), leases: 0, retired: false };
let hydrationSequence = 0;
const WRITE_AUTHORITY = Symbol("mcp-config-write-authority");
export interface McpConfigWriteAuthority { readonly [WRITE_AUTHORITY]: true }
const writeAuthorities = new WeakMap<McpConfigWriteAuthority, { workspaceDir: string; authorise(): void; signal: AbortSignal }>();
export interface McpServerWriteCandidate { readonly prepared: true }
const serverCandidates = new WeakMap<McpServerWriteCandidate, { workspaceDir: string; snapshot: McpBridgeSnapshot; document: Record<string, unknown>; effectiveHash: string; edit: McpServerEdit; identities: Record<string, string | null> }>();
export interface McpConfigCommitReceipt { path: string; fileRevision: string; committed: true }
const commitReceipts = new WeakMap<McpConfigCommitReceipt, { workspaceDir: string; revisions: Record<string, string | null>; identities: Record<string, string | null>; effectiveHash: string }>();
export class McpConfigWriteError extends Error {
  constructor(readonly receipt: McpConfigCommitReceipt, cause: unknown) {
    super('MCP configuration was saved, but commit completion could not be confirmed.', { cause });
  }
}

function emptySnapshot(): McpBridgeSnapshot {
  const adapterConfig: McpConfig = { mcpServers: {} };
  const revision = hashJson(adapterConfig);
  return deepFreeze({ revision, adapterConfig, nativePreview: { servers: [], errors: [] }, provenance: [], diagnostics: [], sourceRevisions: {}, dryRun: { revision, rows: [], diagnostics: [], secretValuesPresent: false } });
}
function hashJson(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function fileRevision(path: string): string | null { return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null; }
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
function referencedNames(value: string): string[] {
  if (value.startsWith("!!")) value = value.slice(1);
  else if (value.startsWith("!")) {
    const names = new Set<string>();
    for (const match of value.slice(1).matchAll(COMMAND_ENV_REFERENCE)) names.add(match[1] ?? match[2]!);
    return [...names];
  }
  const names = new Set<string>();
  for (const match of value.matchAll(ENV_REFERENCE)) names.add(match[1] ?? match[2] ?? match[3]!);
  return [...names];
}
function serverValues(definition: PiclawServerEntry): Array<[string, string]> {
  const values: Array<[string, string]> = [];
  for (const key of ["url", "cwd", "socket", "bearerToken"] as const) if (typeof definition[key] === "string") values.push([key, definition[key] as string]);
  for (const [key, value] of Object.entries(stringRecord(definition.env))) values.push([`env.${key}`, value]);
  for (const [key, value] of Object.entries(stringRecord(definition.headers))) values.push([`headers.${key}`, value]);
  for (const [key, value] of Object.entries(stringRecord(definition.requestHeadersCommand && typeof definition.requestHeadersCommand === "object" ? definition.requestHeadersCommand.env : undefined))) values.push([`requestHeadersCommand.env.${key}`, value]);
  if (definition.requestHeadersCommand && typeof definition.requestHeadersCommand === "object") {
    if (typeof definition.requestHeadersCommand.command === "string") values.push(["requestHeadersCommand.command", definition.requestHeadersCommand.command]);
    for (const [index, value] of (definition.requestHeadersCommand.args ?? []).entries()) if (typeof value === "string") values.push([`requestHeadersCommand.args.${index}`, value]);
  }
  if (definition.oauth && typeof definition.oauth === "object") for (const [key, value] of Object.entries(definition.oauth)) if (typeof value === "string") values.push([`oauth.${key}`, value]);
  for (const [index, value] of (definition.args ?? []).entries()) if (typeof value === "string") values.push([`args.${index}`, value]);
  return values;
}
function isSecretReference(value: string): boolean {
  return (value.startsWith("!") && !value.startsWith("!!")) || /\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$env:[A-Za-z_][A-Za-z0-9_]*|\{env:[A-Za-z_][A-Za-z0-9_]*\}/.test(value);
}
function isSensitiveName(name: string): boolean { return /(authorization|api[-_]?key|token|secret|password)/i.test(name); }
function sanitizeSensitiveRecord(value: unknown, field: string, reasons: string[]): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) { reasons.push(`${field} must be a string record.`); return undefined; }
  const safe: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry !== "string") { reasons.push(`${field}.${name} must be a string.`); continue; }
    if (isSensitiveName(name) && !isSecretReference(entry)) { reasons.push(`${field}.${name} contains a literal secret.`); continue; }
    safe[name] = entry;
  }
  return safe;
}
function sanitizeDefinition(input: PiclawServerEntry, reasons: string[]): PiclawServerEntry {
  const definition = structuredClone(input);
  if (definition.args !== undefined && (!Array.isArray(definition.args) || definition.args.some((value) => typeof value !== "string"))) { reasons.push("args must be an array of strings."); delete definition.args; }
  const env = sanitizeSensitiveRecord(definition.env, "env", reasons); if (env === undefined) delete definition.env; else definition.env = env;
  const headers = sanitizeSensitiveRecord(definition.headers, "headers", reasons); if (headers === undefined) delete definition.headers; else definition.headers = headers;
  if (definition.bearerToken !== undefined && (typeof definition.bearerToken !== "string" || !isSecretReference(definition.bearerToken))) { reasons.push("literal bearerToken is forbidden; use a supported environment/command reference or keychain."); delete definition.bearerToken; }
  if (definition.bearerTokenEnv !== undefined && (typeof definition.bearerTokenEnv !== "string" || !ENV_NAME.test(definition.bearerTokenEnv))) reasons.push("bearerTokenEnv must be a valid environment name.");
  if (definition.bearerTokenKeychain !== undefined) {
    if (typeof definition.bearerTokenKeychain !== "string" || !definition.bearerTokenKeychain.trim()) reasons.push("bearerTokenKeychain must be a non-empty string.");
    if (typeof definition.bearerTokenEnv !== "string" || !ENV_NAME.test(definition.bearerTokenEnv)) reasons.push("bearerTokenKeychain requires a valid bearerTokenEnv.");
    if (definition.bearerToken !== undefined) reasons.push("bearerTokenKeychain cannot be combined with bearerToken.");
  }
  if (definition.oauth !== undefined && definition.oauth !== false) {
    if (!definition.oauth || typeof definition.oauth !== "object" || Array.isArray(definition.oauth)) { reasons.push("oauth must be an object or false."); delete definition.oauth; }
    else if (typeof definition.oauth.clientSecret === "string" && !isSecretReference(definition.oauth.clientSecret)) { reasons.push("oauth.clientSecret contains a literal secret."); delete definition.oauth.clientSecret; }
  }
  if (definition.requestHeadersCommand !== undefined) {
    if (!definition.requestHeadersCommand || typeof definition.requestHeadersCommand !== "object" || Array.isArray(definition.requestHeadersCommand)) { reasons.push("requestHeadersCommand must be an object."); delete definition.requestHeadersCommand; }
    else {
      const requestUnknown = Object.keys(definition.requestHeadersCommand).filter((key) => !["command", "args", "env", "timeoutMs"].includes(key));
      if (requestUnknown.length) reasons.push(`unknown requestHeadersCommand fields: ${requestUnknown.join(", ")}.`);
      if (typeof definition.requestHeadersCommand.command !== "string" || !definition.requestHeadersCommand.command.trim()) reasons.push("requestHeadersCommand.command must be a non-empty string.");
      if (definition.requestHeadersCommand.args !== undefined && (!Array.isArray(definition.requestHeadersCommand.args) || definition.requestHeadersCommand.args.some((value) => typeof value !== "string"))) { reasons.push("requestHeadersCommand.args must be strings."); delete definition.requestHeadersCommand.args; }
      if (definition.requestHeadersCommand.timeoutMs !== undefined && (!Number.isInteger(definition.requestHeadersCommand.timeoutMs) || definition.requestHeadersCommand.timeoutMs <= 0 || definition.requestHeadersCommand.timeoutMs > 60_000)) reasons.push("requestHeadersCommand.timeoutMs must be between 1 and 60000.");
      const safeEnv = sanitizeSensitiveRecord(definition.requestHeadersCommand.env, "requestHeadersCommand.env", reasons);
      definition.requestHeadersCommand = { ...definition.requestHeadersCommand, ...(safeEnv ? { env: safeEnv } : {}) };
    }
  }
  const transports = [definition.command, definition.url, definition.socket].filter((value) => typeof value === "string" && value.trim().length > 0);
  if (definition.disabled !== true && transports.length !== 1) reasons.push("must configure exactly one non-empty command, url, or socket transport.");
  if (definition.command !== undefined && (typeof definition.command !== "string" || !definition.command.trim())) reasons.push("command must be a non-empty string.");
  if (definition.url !== undefined && (typeof definition.url !== "string" || !definition.url.trim())) reasons.push("url must be a non-empty string.");
  if (definition.socket !== undefined && (typeof definition.socket !== "string" || !definition.socket.trim())) reasons.push("socket must be a non-empty string.");
  if (definition.cwd !== undefined && typeof definition.cwd !== "string") reasons.push("cwd must be a string.");
  if (definition.pluginDataDir !== undefined && typeof definition.pluginDataDir !== "string") reasons.push("pluginDataDir must be a string.");
  for (const [field, value] of [["disabled", definition.disabled], ["debug", definition.debug], ["trace", definition.trace], ["literalEnv", definition.literalEnv], ["exposeResources", definition.exposeResources]] as const) if (value !== undefined && typeof value !== "boolean") reasons.push(`${field} must be a boolean.`);
  if (definition.bearerTokenStore !== undefined && definition.bearerTokenStore !== true) reasons.push("bearerTokenStore must be true when present.");
  if (definition.auth !== undefined && !["oauth", "bearer", false].includes(definition.auth as never)) reasons.push("auth must be oauth, bearer, or false.");
  if (definition.lifecycle !== undefined && !["keep-alive", "lazy", "lazy-keep-alive", "eager"].includes(definition.lifecycle)) reasons.push("lifecycle is invalid.");
  if (definition.toolPrefix !== undefined && !["server", "none", "short", "mcp"].includes(definition.toolPrefix)) reasons.push("toolPrefix is invalid.");
  if (definition.httpTransport !== undefined && !["streamable-http", "sse"].includes(definition.httpTransport)) reasons.push("httpTransport is invalid.");
  if (definition.protocolVersion !== undefined && !["legacy", "auto", "2026-07-28"].includes(definition.protocolVersion)) reasons.push("protocolVersion is invalid.");
  for (const [field, value] of [["requestTimeoutMs", definition.requestTimeoutMs], ["idleTimeout", definition.idleTimeout]] as const) if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) reasons.push(`${field} must be a non-negative finite number.`);
  for (const [field, value] of [["includeTools", definition.includeTools], ["excludeTools", definition.excludeTools]] as const) if (value !== undefined && (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))) reasons.push(`${field} must be an array of strings.`);
  if (definition.directTools !== undefined && typeof definition.directTools !== "boolean" && (!Array.isArray(definition.directTools) || definition.directTools.some((entry) => typeof entry !== "string"))) reasons.push("directTools must be a boolean or string array.");
  if (definition.approveTools !== undefined && typeof definition.approveTools !== "boolean" && (!Array.isArray(definition.approveTools) || definition.approveTools.some((entry) => typeof entry !== "string"))) reasons.push("approveTools must be a boolean or string array.");
  if (definition.searchKeywords !== undefined) {
    if (!definition.searchKeywords || typeof definition.searchKeywords !== "object" || Array.isArray(definition.searchKeywords) || Object.values(definition.searchKeywords).some((value) => !Array.isArray(value) || value.some((entry) => typeof entry !== "string"))) reasons.push("searchKeywords must map names to string arrays.");
  }
  if (definition.oauth && typeof definition.oauth === "object") {
    const allowed = new Set(["grantType", "clientId", "clientSecret", "scope", "authorizationParams", "redirectUri", "clientName", "clientUri", "logoUri", "skipIssuerMetadataValidation", "authServerMetadataUrl"]);
    const unknown = Object.keys(definition.oauth).filter((key) => !allowed.has(key)); if (unknown.length) reasons.push(`unknown oauth fields: ${unknown.join(", ")}.`);
    for (const [key, value] of Object.entries(definition.oauth)) if (key !== "authorizationParams" && key !== "skipIssuerMetadataValidation" && typeof value !== "string") reasons.push(`oauth.${key} must be a string.`);
    if (definition.oauth.skipIssuerMetadataValidation !== undefined && typeof definition.oauth.skipIssuerMetadataValidation !== "boolean") reasons.push("oauth.skipIssuerMetadataValidation must be a boolean.");
    const safeAuthorizationParams = sanitizeSensitiveRecord(definition.oauth.authorizationParams, "oauth.authorizationParams", reasons);
    if (safeAuthorizationParams === undefined) delete definition.oauth.authorizationParams; else definition.oauth.authorizationParams = safeAuthorizationParams;
  }
  if (typeof definition.url === "string" && referencedNames(definition.url).length === 0) try {
    const url = new URL(definition.url);
    const secretQuery = [...url.searchParams.entries()].find(([name, value]) => isSensitiveName(name) && !isSecretReference(value));
    if (url.username || url.password || secretQuery) { reasons.push("URL credentials or literal secret query parameters are forbidden."); delete definition.url; }
  } catch { reasons.push("url must be a valid absolute URL or a supported environment reference."); delete definition.url; }
  return definition;
}
function inspectProjectOverrideTombstones(workspaceDir: string): { blockAll: boolean; names: Set<string>; diagnostics: McpStartupDiagnostic[] } {
  const names = new Set<string>(), diagnostics: McpStartupDiagnostic[] = [];
  for (const path of [resolve(workspaceDir, ".mcp.json"), resolve(workspaceDir, ".pi", "mcp.json")]) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(stripJsonComments(readFileSync(path, "utf8"), { trailingCommas: true })) as { mcpServers?: unknown };
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("config document must be an object");
      if (parsed.mcpServers !== undefined && (!parsed.mcpServers || typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers))) throw new Error("mcpServers must be an object");
      for (const [name, value] of Object.entries((parsed.mcpServers ?? {}) as Record<string, unknown>)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) names.add(name); else names.delete(name);
      }
    } catch (error) {
      diagnostics.push({ serverName: "(configuration)", reason: `malformed high-precedence project override ${path}: ${error instanceof Error ? error.message : String(error)}` });
      return { blockAll: true, names, diagnostics };
    }
  }
  return { blockAll: false, names, diagnostics };
}
function quarantine(_definition: PiclawServerEntry): ServerEntry { return { disabled: true }; }
function sourceRows(provenance: Map<string, ServerProvenance>): McpBridgeProvenance[] {
  return [...provenance.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([serverName, source]) => ({ serverName, path: source.path, kind: source.kind, ...(source.importKind ? { importKind: source.importKind } : {}) }));
}
function nativeMapping(name: string, definition: ServerEntry, source?: ServerProvenance): { entry?: McpServerEntry; mappings: string[]; reasons: string[] } {
  const mappings: string[] = [], reasons: string[] = [];
  if (definition.socket) reasons.push("Unix socket transport is not representable in native 0.99.1 config.");
  if (definition.lifecycle && definition.lifecycle !== "eager") reasons.push(`Lifecycle ${definition.lifecycle} has no native 0.99.1 equivalent.`);
  if (definition.includeTools?.length || definition.excludeTools?.length) reasons.push("Adapter include/exclude authorization requires the retained adapter owner.");
  if (definition.exposeResources !== undefined) reasons.push("Per-server resource exposure has no native 0.99.1 policy seam.");
  if (definition.auth !== undefined || definition.bearerTokenStore || definition.oauth !== undefined) reasons.push("Interactive OAuth/provider authentication is unavailable in constrained Native.");
  if (definition.requestHeadersCommand) reasons.push("Per-request header commands are adapter-only.");
  if (Array.isArray(definition.directTools)) reasons.push("Named direct-tool subsets require adapter policy translation.");
  for (const [field, value] of Object.entries({ idleTimeout: definition.idleTimeout, toolPrefix: definition.toolPrefix, searchKeywords: definition.searchKeywords, approveTools: definition.approveTools, debug: definition.debug, trace: definition.trace, httpTransport: definition.httpTransport, pluginDataDir: definition.pluginDataDir, literalEnv: definition.literalEnv, protocolVersion: definition.protocolVersion })) if (value !== undefined) reasons.push(`${field} is adapter-only.`);
  let config: McpServerConfig | undefined;
  if (definition.command) {
    config = { type: "stdio", command: definition.command, ...(definition.args ? { args: definition.args } : {}), ...(definition.env ? { env: definition.env } : {}), ...(definition.cwd ? { cwd: definition.cwd } : {}) };
    mappings.push("stdio transport");
  } else if (definition.url) {
    config = { type: "http", url: definition.url, headers: { ...definition.headers, ...(definition.bearerTokenEnv ? { Authorization: `Bearer ${'${'}${definition.bearerTokenEnv}}` } : {}) } };
    mappings.push("HTTP transport");
  }
  if (!config) reasons.push("Server has no supported stdio or HTTP transport.");
  if (!config || reasons.length > 0) return { mappings, reasons };
  config.enabled = definition.disabled !== true;
  if (definition.requestTimeoutMs && definition.requestTimeoutMs > 0) config.timeout = definition.requestTimeoutMs / 1000;
  config.exposure = definition.directTools === true ? "direct" : "deferred";
  mappings.push(`enabled=${config.enabled}`, `exposure=${config.exposure}`);
  return { entry: { name, config, source: source?.path ?? "piclaw-bridge", scope: source?.kind === "project" ? "project" : "global" }, mappings, reasons };
}

export function validateMcpEnvironmentReferences(config: { mcpServers?: Record<string, PiclawServerEntry> }): void {
  for (const [serverName, definition] of Object.entries(config.mcpServers ?? {})) for (const [field, value] of serverValues(definition)) {
    const missing = referencedNames(value).filter((name) => process.env[name] === undefined);
    if (missing.length) throw new Error(`MCP server ${serverName} ${field} references missing environment variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
  }
}

export function getPreparedMcpConfig(): McpConfig { return cloneMcpConfig(preparedSnapshot.adapterConfig); }
export function getMcpBridgeSnapshot(): McpBridgeSnapshot { return structuredClone(preparedSnapshot); }
/** Read-only consumers retain one immutable generation; hydration replaces it atomically. */
export function getMcpBridgeReadSnapshot(): McpBridgeReadSnapshot { return preparedSnapshot; }
export function getMcpBridgeDryRun(): McpBridgeDryRun { return structuredClone(preparedSnapshot.dryRun); }
export function getMcpStartupDiagnostics(): McpStartupDiagnostic[] { return structuredClone(preparedSnapshot.diagnostics); }
export function resetMcpStartupStateForTests(): void { retireGeneration(preparedGeneration); preparedGeneration = { secrets: new Map(), references: new Map(), leases: 0, retired: false }; preparedSnapshot = emptySnapshot(); preparedSourceIdentities = {}; hydrationSequence = 0; }

export async function hydrateMcpKeychainCredentials(workspaceDir: string, resolveEntry: typeof getKeychainEntry = getKeychainEntry,
  admission?: { authorise(): void; signal: AbortSignal }): Promise<HydratedMcpCredential[]> {
  const check = () => { if (admission) { admission.signal.throwIfAborted(); admission.authorise(); admission.signal.throwIfAborted(); } };
  check();
  const sequence = ++hydrationSequence;
  const diagnostics: McpStartupDiagnostic[] = [], secrets = new Map<string, Map<string, string>>(), references = new Map<string, Set<string>>(), rows: McpBridgePreviewRow[] = [];
  let published = false;
  try {
  const tombstones = inspectProjectOverrideTombstones(workspaceDir); diagnostics.push(...tombstones.diagnostics);
  let loaded: PiclawMcpConfig; let provenance = new Map<string, ServerProvenance>();
  try { loaded = structuredClone(loadMcpConfig(undefined, workspaceDir)) as PiclawMcpConfig; provenance = getServerProvenance(undefined, workspaceDir); }
  catch (error) { loaded = { mcpServers: {} }; diagnostics.push({ serverName: "(configuration)", reason: `could not be loaded: ${error instanceof Error ? error.message : String(error)}` }); }
  const projectOverride = resolve(workspaceDir, '.pi', 'mcp.json');
  const sourcePaths = [...new Set([...getConfigDiscoveryPaths(undefined, workspaceDir).map(entry => entry.path), ...[...provenance.values()].map(row => row.path), projectOverride])].sort();
  const sourceRevisions = Object.fromEntries(sourcePaths.map(path => [path, fileRevision(path)]));
  const sourceIdentities = Object.fromEntries([...new Set([resolve(workspaceDir), dirname(projectOverride), ...sourcePaths])].map(path => [path, sourceIdentity(path)]));
  if (tombstones.blockAll) for (const name of Object.keys(loaded.mcpServers)) loaded.mcpServers[name] = { disabled: true };
  else for (const name of tombstones.names) loaded.mcpServers[name] = { disabled: true };
  // Server-initiated model spending and interaction are opt-in only. A future
  // policy/budget child may provide an authorized handler; config alone cannot.
  const sanitized: McpConfig = { ...loaded, settings: { ...loaded.settings, sampling: false, samplingAutoApprove: false, elicitation: false }, mcpServers: {} }; const nativeServers: McpServerEntry[] = [], nativeErrors: string[] = [], hydrated: HydratedMcpCredential[] = [], claimed = new Set<string>();
  for (const [serverName, raw] of Object.entries(loaded.mcpServers ?? {})) {
    const reasons: string[] = [], mappings: string[] = []; const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
    if (!input) reasons.push("configuration must be an object.");
    const unknown = Object.keys(input ?? {}).filter((key) => !SERVER_FIELDS.has(key)); if (unknown.length) reasons.push(`unknown semantic fields: ${unknown.sort().join(", ")}.`);
    const definition = sanitizeDefinition(input ?? {}, reasons);
    if (tombstones.blockAll || tombstones.names.has(serverName)) reasons.push("blocked by malformed higher-precedence project override.");
    const keychainName = definition.bearerTokenKeychain;
    if (keychainName !== undefined) {
      const envName = definition.bearerTokenEnv;
      if (typeof keychainName !== "string" || !keychainName.trim() || typeof envName !== "string" || !ENV_NAME.test(envName)) {
        // sanitizeDefinition already recorded the exact schema error.
      } else if (process.env[envName] !== undefined) reasons.push(`bearerTokenEnv ${envName} is already set in the process environment.`);
      else if (claimed.has(envName)) reasons.push(`bearerTokenEnv ${envName} is already claimed by another MCP server.`);
      else if (reasons.length === 0) {
        check();
        try {
          const entry = await resolveEntry(keychainName as string); check();
          if (!entry.secret) throw new Error("missing secret");
          secrets.set(serverName, new Map([[envName, entry.secret]])); claimed.add(envName); mappings.push("keychain bearer reference");
        } catch { reasons.push("keychain entry is unavailable or has no secret."); }
        // Revocation/cancellation must reject the transition, not turn into
        // an optional quarantined credential and publish a new generation.
        check();
      }
    }
    const refs = new Set<string>(); for (const [, value] of serverValues(definition)) for (const name of referencedNames(value)) refs.add(name);
    if (typeof definition.bearerTokenEnv === "string" && keychainName === undefined) refs.add(definition.bearerTokenEnv);
    for (const name of refs) if (process.env[name] === undefined && !secrets.get(serverName)?.has(name)) reasons.push(`references missing environment variable: ${name}.`);
    references.set(serverName, refs);
    if (reasons.length === 0 && typeof keychainName === "string" && typeof definition.bearerTokenEnv === "string" && secrets.has(serverName)) {
      hydrated.push({ serverName, envName: definition.bearerTokenEnv, keychainName });
    } else if (reasons.length > 0) {
      secrets.get(serverName)?.clear(); secrets.delete(serverName);
    }
    const clean = { ...definition } as PiclawServerEntry; delete clean.bearerTokenKeychain; sanitized.mcpServers[serverName] = reasons.length ? quarantine(clean) : clean;
    if (reasons.length) diagnostics.push(...reasons.map((reason) => ({ serverName, reason })));
    const native = nativeMapping(serverName, sanitized.mcpServers[serverName]!, provenance.get(serverName)); if (native.entry && reasons.length === 0) nativeServers.push(native.entry); else nativeErrors.push(...native.reasons.map((reason) => `${serverName}: ${reason}`));
    rows.push({ serverName, status: reasons.length ? "quarantined" : native.reasons.length ? "blocked" : "mapped", source: provenance.get(serverName)?.path, mappings: [...mappings, ...native.mappings], reasons: [...reasons, ...native.reasons] });
  }
  const provenanceRows = sourceRows(provenance);
  const revision = hashJson({ adapterConfig: sanitized, provenance: provenanceRows, sourceRevisions });
  rows.sort((a, b) => a.serverName.localeCompare(b.serverName));
  const dryRun: McpBridgeDryRun = { revision, rows, diagnostics, secretValuesPresent: false };
  if (sequence !== hydrationSequence) { for (const values of secrets.values()) values.clear(); throw new Error("MCP bridge hydration was superseded."); }
  check();
  if (Object.entries(sourceRevisions).some(([path, revision]) => fileRevision(path) !== revision)
    || Object.entries(sourceIdentities).some(([path, identity]) => sourceIdentity(path) !== identity)) throw new Error('MCP configuration changed during hydration.');
  preparedSnapshot = deepFreeze({ revision, adapterConfig: sanitized, nativePreview: { servers: nativeServers, errors: nativeErrors }, provenance: provenanceRows, diagnostics, sourceRevisions, dryRun });
  preparedSourceIdentities = sourceIdentities;
  retireGeneration(preparedGeneration);
  preparedGeneration = { secrets, references, leases: 0, retired: false };
  published = true;
  for (const diagnostic of diagnostics) log.warn("Quarantined invalid optional MCP server during startup", { operation: "mcp.startup_quarantined", serverName: diagnostic.serverName, reason: diagnostic.reason });
  return hydrated;
  } finally { if (!published) for (const values of secrets.values()) values.clear(); }
}

export function acquireMcpSessionBridge(): McpSessionBridgeLease {
  const snapshot = preparedSnapshot, generation = preparedGeneration; if (generation.retired) throw new Error("MCP credential generation is retired."); let released = false; generation.leases++;
  return {
    config: cloneMcpConfig(snapshot.adapterConfig), revision: snapshot.revision, nativePreview: structuredClone(snapshot.nativePreview),
    resolveRuntimeEnv(serverName: string): Readonly<NodeJS.ProcessEnv> {
      const environment: NodeJS.ProcessEnv = {};
      for (const name of OPERATIONAL_ENV) if (process.env[name] !== undefined) environment[name] = process.env[name];
      if (released) return Object.freeze(environment);
      for (const name of generation.references.get(serverName) ?? []) if (process.env[name] !== undefined) environment[name] = process.env[name];
      for (const [name, value] of generation.secrets.get(serverName) ?? []) environment[name] = value;
      return Object.freeze(environment);
    },
    release() { if (released) return; released = true; generation.leases = Math.max(0, generation.leases - 1); clearGenerationIfRetired(generation); },
  };
}
function clearGenerationIfRetired(generation: SecretGeneration): void { if (!generation.retired || generation.leases > 0) return; for (const values of generation.secrets.values()) values.clear(); generation.secrets.clear(); generation.references.clear(); }
function retireGeneration(generation: SecretGeneration): void { generation.retired = true; clearGenerationIfRetired(generation); }
export function clearHydratedMcpCredentials(_entries: HydratedMcpCredential[]): void { retireGeneration(preparedGeneration); }

function assertWritableConfig(config: McpConfig): void {
  if (!config || typeof config !== "object" || !config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers)) throw new Error("MCP config must contain an mcpServers object.");
  for (const [serverName, raw] of Object.entries(config.mcpServers as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`MCP server ${serverName} must be an object.`);
    const reasons: string[] = [];
    const unknown = Object.keys(raw).filter((key) => !SERVER_FIELDS.has(key));
    if (unknown.length) reasons.push(`unknown semantic fields: ${unknown.sort().join(", ")}.`);
    sanitizeDefinition(raw as PiclawServerEntry, reasons);
    if (reasons.length) throw new Error(`MCP server ${serverName} cannot be written: ${reasons.join(" ")}`);
  }
}
function assertNoSymlinkComponents(root: string, target: string): void {
  if (realpathSync(root) !== root) throw new Error("MCP workspace root must not be a symlink.");
  let current = root;
  const relative = target.slice(root.length).split("/").filter(Boolean);
  for (const part of relative) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("MCP config target path must not contain symlinks.");
  }
}
function sourceIdentity(path: string): string | null { const stat = existsSync(path) ? lstatSync(path) : null; return stat ? `${stat.dev}:${stat.ino}` : null; }
function sourceRevisionsMatch(snapshot: McpBridgeSnapshot, identities = preparedSourceIdentities): boolean {
  return Object.entries(snapshot.sourceRevisions).every(([path, revision]) => fileRevision(path) === revision)
    && Object.entries(identities).every(([path, identity]) => sourceIdentity(path) === identity);
}
export function assertMcpBridgeSourcesCurrent(): void {
  if (!sourceRevisionsMatch(preparedSnapshot)) throw new Error('MCP config revision conflict.');
}
function readProjectDocument(workspaceDir: string): Record<string, unknown> {
  const path = resolve(workspaceDir, '.pi', 'mcp.json');
  assertNoSymlinkComponents(resolve(workspaceDir), path);
  if (!existsSync(path)) return { mcpServers: {} };
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.size > 512 * 1024) throw new Error('MCP project configuration is not editable.');
  const value: unknown = JSON.parse(stripJsonComments(readFileSync(path, 'utf8'), { trailingCommas: true }));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP project configuration is not editable.');
  return value as Record<string, unknown>;
}
/** Safe editor read: raw source/secret values stay inside this module. */
export function inspectMcpServerDefinitions(workspaceDir: string) {
  assertMcpBridgeSourcesCurrent();
  const local = readProjectDocument(workspaceDir), effective = loadMcpConfig(undefined, workspaceDir);
  const localServers = (local.mcpServers ?? local['mcp-servers'] ?? {}) as Record<string, unknown>;
  if (!localServers || typeof localServers !== 'object' || Array.isArray(localServers)) throw new Error('MCP project configuration is not editable.');
  const provenance = getServerProvenance(undefined, workspaceDir);
  assertMcpBridgeSourcesCurrent();
  return Object.entries(effective.mcpServers).sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => ({
    name, ...projectMcpServerEdit(name, entry), localOverride: Object.hasOwn(localServers, name),
    source: provenance.get(name)?.kind === 'project' ? 'project' : 'inherited',
    enabled: entry.disabled !== true,
  }));
}
/** Exact public virtual projection; no credential/command resolution. */
export function prepareMcpServerEdit(workspaceDir: string, value: unknown) {
  if (process.env.PI_MCP_CONFIG_MODE?.trim().toLowerCase() === 'exclusive') throw new Error('Workspace MCP editing is unavailable in exclusive mode.');
  assertMcpBridgeSourcesCurrent();
  const edit = parseMcpServerEdit(value), document = patchMcpProjectOverride(readProjectDocument(workspaceDir), edit);
  const original = loadMcpConfig(undefined, workspaceDir);
  if (edit.action === 'create' && Object.hasOwn(original.mcpServers, edit.name)) throw new Error('MCP server already exists; select it to edit its configuration.');
  const effective = loadMcpConfig(undefined, workspaceDir, { projectOverride: document });
  const definition = effective.mcpServers[edit.name] as PiclawServerEntry | undefined;
  if (definition) {
    assertMcpServerCredentialBinding(original.mcpServers[edit.name], definition);
    if (definition.disabled !== true && Object.keys(definition).some(key => !SERVER_FIELDS.has(key))) throw new Error('Enabled server has unsupported advanced configuration; disable or repair it before applying.');
    const reasons: string[] = [];
    // Unknown pre-existing fields remain private. Validate supported fields,
    // but do not force unrelated servers through the narrower editor schema.
    const known = Object.fromEntries(Object.entries(definition).filter(([key]) => SERVER_FIELDS.has(key))) as PiclawServerEntry;
    const sanitized = sanitizeDefinition(known, reasons);
    if (definition.disabled !== true && (reasons.length || JSON.stringify(sanitized) !== JSON.stringify(known))) throw new Error('Edited MCP server configuration is unsafe or incompatible.');
  }
  assertMcpBridgeSourcesCurrent();
  const candidate = Object.freeze({ prepared: true as const });
  serverCandidates.set(candidate, { workspaceDir: resolve(workspaceDir), snapshot: preparedSnapshot, document, effectiveHash: hashJson(effective), edit, identities: { ...preparedSourceIdentities } });
  return { candidate, preview: { name: edit.name, action: edit.action, present: !!definition, enabled: definition?.disabled !== true && !!definition,
    ...(definition ? projectMcpServerEdit(edit.name, definition) : { patch: {}, withheldFields: [] }),
    effect: 'abort_turns_and_reload_extensions', applicable: true } };
}
export function createMcpConfigWriteAuthority(input: { workspaceDir: string; authorise(): void; signal: AbortSignal }): McpConfigWriteAuthority {
  input.signal.throwIfAborted(); input.authorise(); input.signal.throwIfAborted();
  const authority = Object.freeze({ [WRITE_AUTHORITY]: true as const });
  writeAuthorities.set(authority, { ...input, workspaceDir: resolve(input.workspaceDir) });
  return authority;
}
/** Carry the approved generation across rename/unlock/hydration/startup.
 * A fresh hydration snapshot cannot turn an external file mutation into consent. */
export function assertMcpCommittedSourcesCurrent(receipt: McpConfigCommitReceipt): void {
  const binding = commitReceipts.get(receipt);
  if (!binding || Object.entries(binding.revisions).some(([path, revision]) => fileRevision(path) !== revision)
    || Object.entries(binding.identities).some(([path, identity]) => sourceIdentity(path) !== identity)
    || hashJson(loadMcpConfig(undefined, binding.workspaceDir)) !== binding.effectiveHash) throw new Error('Committed MCP configuration changed before activation.');
}
/** Commit only. The fenced runtime controller owns exactly one subsequent hydration. */
export async function writeMcpProjectOverride(input: { workspaceDir: string; expectedRevision: string; authority: McpConfigWriteAuthority; onCommit?: (receipt: McpConfigCommitReceipt) => void } & ({ config: McpConfig; candidate?: never } | { candidate: McpServerWriteCandidate; config?: never })): Promise<McpConfigCommitReceipt> {
  const admission = writeAuthorities.get(input.authority);
  const check = () => {
    if (!admission || resolve(input.workspaceDir) !== admission.workspaceDir) throw new Error('MCP config write is not authorized.');
    admission.signal.throwIfAborted(); admission.authorise(); admission.signal.throwIfAborted();
  };
  check();
  const capturedSnapshot = preparedSnapshot;
  if (input.expectedRevision !== preparedSnapshot.revision || !sourceRevisionsMatch(preparedSnapshot)) throw new Error("MCP config revision conflict.");
  const candidate = input.candidate ? serverCandidates.get(input.candidate) : undefined;
  if (input.candidate && (!candidate || candidate.snapshot !== capturedSnapshot || candidate.workspaceDir !== resolve(input.workspaceDir))) throw new Error('MCP server candidate is not authorized.');
  const config = structuredClone(candidate?.document ?? input.config!) as unknown as Record<string, unknown>;
  if (!candidate) assertWritableConfig(config as unknown as McpConfig);
  const effectiveHash = candidate?.effectiveHash ?? hashJson(loadMcpConfig(undefined, input.workspaceDir, { projectOverride: config }));
  const path = resolve(input.workspaceDir, ".pi", "mcp.json"); const root = resolve(input.workspaceDir); if (!path.startsWith(`${root}/`)) throw new Error("MCP config target escapes workspace.");
  assertNoSymlinkComponents(root, path);
  const expectedFileRevision = preparedSnapshot.sourceRevisions[path] ?? null;
  // Establish our private parent synchronously before capturing its lifetime;
  // subsequent await boundaries may not adopt a replaced directory.
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const originalIdentities = { ...(candidate?.identities ?? preparedSourceIdentities) };
  if (originalIdentities[dirname(path)] === null) originalIdentities[dirname(path)] = sourceIdentity(dirname(path));
  const identities = Object.fromEntries([...new Set([root, dirname(path), ...Object.keys(capturedSnapshot.sourceRevisions)])].map(source => {
    const stat = existsSync(source) ? lstatSync(source) : null;
    return [source, stat ? `${stat.dev}:${stat.ino}` : null];
  }));
  const checkRevision = () => {
    check(); assertNoSymlinkComponents(root, path);
    if (capturedSnapshot !== preparedSnapshot || input.expectedRevision !== preparedSnapshot.revision || !sourceRevisionsMatch(capturedSnapshot, originalIdentities)
      || hashJson(loadMcpConfig(undefined, input.workspaceDir, { projectOverride: config })) !== effectiveHash
      || fileRevision(path) !== expectedFileRevision || Object.entries(identities).some(([source, identity]) => {
        const stat = existsSync(source) ? lstatSync(source) : null;
        return (stat ? `${stat.dev}:${stat.ino}` : null) !== identity;
      })) throw new Error('MCP config revision conflict.');
    // Filesystem checks are synchronous, but final owner hooks may dispatch
    // cancellation too; do not rename after that authority is withdrawn.
    check();
  };
  const text = `${JSON.stringify(config, null, 2)}\n`; if (!candidate && /"(?:bearerToken|clientSecret)"\s*:\s*"(?![!$]|\{env:)/.test(text)) throw new Error("MCP config write contains a literal secret.");
  const release = await lockfile.lock(dirname(path), { realpath: false, retries: 0 });
  let temp: string | undefined;
  let receipt: McpConfigCommitReceipt | undefined;
  let failure: unknown;
  try {
    checkRevision();
    temp = `${path}.${process.pid}.${randomUUID()}.tmp`; const fd = openSync(temp, "wx", 0o600);
    try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
    checkRevision();
    renameSync(temp, path); temp = undefined;
    if (input.candidate) serverCandidates.delete(input.candidate);
    receipt = Object.freeze({ path, fileRevision: createHash('sha256').update(text).digest('hex'), committed: true as const });
    commitReceipts.set(receipt, { workspaceDir: root, revisions: { ...capturedSnapshot.sourceRevisions, [path]: receipt.fileRevision },
      identities: { ...originalIdentities, [path]: sourceIdentity(path) }, effectiveHash });
    input.onCommit?.(receipt);
    const dirFd = openSync(dirname(path), "r"); try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  } catch (error) { failure = error; }
  finally {
    if (temp) try { unlinkSync(temp); } catch (error) { failure ??= error; }
    try { await release(); } catch (error) { failure ??= error; }
  }
  if (receipt) {
    try { check(); assertMcpCommittedSourcesCurrent(receipt); } catch (error) { failure ??= error; }
    if (failure !== undefined) throw new McpConfigWriteError(receipt, failure);
    return receipt;
  }
  throw failure;
}
