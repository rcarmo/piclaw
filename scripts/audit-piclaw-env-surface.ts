#!/usr/bin/env bun
/** Audit Piclaw environment-variable observations and reviewed disposition catalog drift. */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const observationsPath = resolve(repoRoot, "docs/config/piclaw-env-observations.json");
const catalogPath = resolve(repoRoot, "docs/config/piclaw-env-support-catalog.json");
const runtimeSrcBaselinePath = resolve(repoRoot, "docs/config/piclaw-env-runtime-src-direct-baseline.json");

export const issueBaseline = { distinctNames: 235, literalProductionReaders: 151 } as const;
export const scanRootVersion = 1;
export const scanScopes = {
  production: ["runtime/src", "runtime/extensions"],
  runtimeSrc: ["runtime/src"],
  extensions: ["runtime/extensions"],
  tooling: ["scripts", "runtime/scripts"],
  docsDeploy: ["docs", "skel", "supervisor", ".github", "Dockerfile", "docker-compose.yml", "Makefile", "package.json"],
} as const;
export const configSourcePrecedence = ["CLI flags", "process.env", ".env", ".piclaw/config.json", "defaults"] as const;
export const bootstrapEnvAllowlist = [
  "PICLAW_WORKSPACE", "PICLAW_STORE", "PICLAW_DATA", "PICLAW_RUNTIME_ROOT", "PICLAW_PI_AGENT_DIR",
  "PICLAW_KEYCHAIN_KEY", "PICLAW_KEYCHAIN_KEY_FILE", "PICLAW_WEB_TLS_CERT", "PICLAW_WEB_TLS_KEY",
  "PICLAW_INTERNAL_SECRET", "PICLAW_WEB_INTERNAL_SECRET", "PICLAW_WEB_EXTERNAL_URL",
  "PICLAW_DB_IN_MEMORY", "PICLAW_SKEL_DIR",
] as const;
const bootstrapSet = new Set<string>(bootstrapEnvAllowlist);

type ScopeName = keyof typeof scanScopes;
type CatalogStatus = "supported" | "bootstrap" | "compatibility" | "internal" | "removed" | "undocumented-runtime";
type ValueType = "boolean" | "integer" | "number" | "string" | "json" | "path" | "secret" | "enum" | "cron" | null;
type PersistenceSurface = "env" | "dotenv" | "json-config" | "cli" | "keychain";
type MigrationDisposition =
  | "constant"
  | "internal-runtime-tuning"
  | "investigate"
  | "migrated-to-domain-config"
  | "move-to-domain-config"
  | "remove"
  | "removed-reference-only"
  | "removed-test-only-env"
  | "retain-bootstrap-test-boundary"
  | "retain-cli-compatibility"
  | "retain-cli-keychain-reference"
  | "retain-deployment-binding"
  | "retain-deployment-bootstrap"
  | "retain-deployment-path"
  | "retain-experimental-emergency-override"
  | "retain-experimental-extension-gate"
  | "retain-harness-compatibility"
  | "retain-network-bootstrap"
  | "retain-path-bootstrap"
  | "retain-per-invocation-context"
  | "retain-secret-bootstrap"
  | "retain-secret-compatibility"
  | "retain-startup-tuning"
  | null;

export interface SupportEntry {
  name: string;
  owner: string;
  status: CatalogStatus;
  source: string;
  migrationDisposition: MigrationDisposition;
  type: ValueType;
  default: string | number | boolean | null;
  bounds: string | null;
  allowedValues: string[];
  secret: boolean;
  persistence: PersistenceSurface[];
  precedence: readonly string[];
  compatibilityAliasFor: string | null;
  deprecation: string | null;
  removalVersion: string | null;
  bootstrapAllowed: boolean;
}

interface ScopeObservation { referenced: boolean; directReaders: number; helperReaders: number; semanticReaders: number; files: string[]; readerFiles: string[]; }
interface ObservationEntry { name: string; scopes: Partial<Record<ScopeName, ScopeObservation>>; }
interface ScopeStats { referencedNames: number; directReaderNames: number; directReaderOccurrences: number; helperReaderNames: number; helperReaderOccurrences: number; semanticReaderNames: number; semanticReaderOccurrences: number; }
interface Observations {
  version: 1;
  generatedBy: string;
  issueBaseline: typeof issueBaseline;
  runtimeSrcDirectBaseline: { source: string; names: string[]; added: string[]; removed: string[] };
  extensionDelta: { directReaderNamesOnlyInExtensions: string[] };
  scanRootVersion: number;
  scanScopes: typeof scanScopes;
  current: Record<ScopeName, ScopeStats>;
  entries: ObservationEntry[];
}
interface BaselineFile { version: 1; source: string; names: string[] }
interface RawScopeEntry { referenced: boolean; directReaders: number; helperReaders: number; files: Set<string>; readerFiles: Set<string> }
type RawEntry = Partial<Record<ScopeName, RawScopeEntry>>;

function emptyScopeEntry(): RawScopeEntry { return { referenced: false, directReaders: 0, helperReaders: 0, files: new Set(), readerFiles: new Set() }; }

function walk(path: string): string[] {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("docs/config/piclaw-env-") && normalized.endsWith(".json")) return [];
  const full = resolve(repoRoot, path);
  if (!existsSync(full)) return [];
  const stat = statSync(full);
  if (stat.isFile()) return [normalized];
  const files: string[] = [];
  for (const entry of readdirSync(full)) {
    if ([".git", "node_modules", "generated", "dist", "coverage"].includes(entry)) continue;
    files.push(...walk(join(path, entry)));
  }
  return files;
}

function fileScopes(file: string, scopes: Record<string, readonly string[]>): ScopeName[] {
  return Object.entries(scopes).filter(([, roots]) => roots.some((root) => file === root || file.startsWith(`${root}/`))).map(([scope]) => scope as ScopeName);
}

export function semanticHelperMatches(text: string): string[] {
  const out: string[] = [];
  const helperPattern = /\b(?:readEnvValue|readMergedEnvValue|writeEnvValue|clearEnvValue)\(\s*["'](PICLAW_[A-Z0-9_]+)["']/g;
  for (const match of text.matchAll(helperPattern)) out.push(match[1]);
  return out;
}

function scanFileTexts(fileTexts: Record<string, string>, scopes: typeof scanScopes): Map<string, RawEntry> {
  const entries = new Map<string, RawEntry>();
  const namePattern = /\bPICLAW_[A-Z0-9_]+\b/g;
  const directPattern = /process\.env\.(PICLAW_[A-Z0-9_]+)/g;
  const ensure = (name: string, scope: ScopeName) => {
    const raw = entries.get(name) ?? {};
    const scoped = raw[scope] ?? emptyScopeEntry();
    raw[scope] = scoped;
    entries.set(name, raw);
    return scoped;
  };
  for (const [file, text] of Object.entries(fileTexts)) {
    const scopedNames = fileScopes(file, scopes);
    for (const match of text.matchAll(namePattern)) for (const scope of scopedNames) { const scoped = ensure(match[0], scope); scoped.referenced = true; scoped.files.add(file); }
    for (const match of text.matchAll(directPattern)) for (const scope of scopedNames) { const scoped = ensure(match[1], scope); scoped.referenced = true; scoped.directReaders += 1; scoped.files.add(file); scoped.readerFiles.add(file); }
    for (const name of semanticHelperMatches(text)) for (const scope of scopedNames) { const scoped = ensure(name, scope); scoped.referenced = true; scoped.helperReaders += 1; scoped.files.add(file); scoped.readerFiles.add(file); }
  }
  return entries;
}
function readAllScanFiles(scopes: typeof scanScopes): Record<string, string> {
  const roots = [...new Set(Object.values(scopes).flat())];
  const files = [...new Set(roots.flatMap(walk))].sort();
  return Object.fromEntries(files.map(file => [file, readFileSync(resolve(repoRoot, file), "utf8")]));
}
function toObservationEntries(raw: Map<string, RawEntry>): ObservationEntry[] { return Array.from(raw.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([name, rawEntry]) => { const scopesOut: Partial<Record<ScopeName, ScopeObservation>> = {}; for (const [scope, scoped] of Object.entries(rawEntry) as Array<[ScopeName, RawScopeEntry]>) scopesOut[scope] = { referenced: scoped.referenced, directReaders: scoped.directReaders, helperReaders: scoped.helperReaders, semanticReaders: scoped.directReaders + scoped.helperReaders, files: Array.from(scoped.files).sort(), readerFiles: Array.from(scoped.readerFiles).sort() }; return { name, scopes: scopesOut }; }); }
function scopeStats(entries: ObservationEntry[], scope: ScopeName): ScopeStats { const scoped = entries.map((entry) => entry.scopes[scope]).filter((entry): entry is ScopeObservation => Boolean(entry)); return { referencedNames: scoped.filter((entry) => entry.referenced).length, directReaderNames: scoped.filter((entry) => entry.directReaders > 0).length, directReaderOccurrences: scoped.reduce((sum, entry) => sum + entry.directReaders, 0), helperReaderNames: scoped.filter((entry) => entry.helperReaders > 0).length, helperReaderOccurrences: scoped.reduce((sum, entry) => sum + entry.helperReaders, 0), semanticReaderNames: scoped.filter((entry) => entry.semanticReaders > 0).length, semanticReaderOccurrences: scoped.reduce((sum, entry) => sum + entry.semanticReaders, 0) }; }
function loadRuntimeSrcDirectBaseline(currentNames: string[]): BaselineFile { if (existsSync(runtimeSrcBaselinePath)) return JSON.parse(readFileSync(runtimeSrcBaselinePath, "utf8")) as BaselineFile; return { version: 1, source: "initial #747 tranche-1 snapshot from cddc4d3e9", names: currentNames }; }

export function buildObservationsFromFileTexts(fileTexts: Record<string, string>, scopes: typeof scanScopes = scanScopes, baselineNames?: string[]): Observations {
  const entries = toObservationEntries(scanFileTexts(fileTexts, scopes));
  const current = Object.fromEntries(Object.keys(scopes).map((scope) => [scope, scopeStats(entries, scope as ScopeName)])) as Record<ScopeName, ScopeStats>;
  const runtimeSrcDirectNames = entries.filter((entry) => (entry.scopes.runtimeSrc?.directReaders ?? 0) > 0).map((entry) => entry.name).sort();
  const baseline = baselineNames ? { version: 1 as const, source: "test fixture", names: baselineNames } : loadRuntimeSrcDirectBaseline(runtimeSrcDirectNames);
  const runtimeSrcSet = new Set(runtimeSrcDirectNames);
  const extensionDirectNames = entries.filter((entry) => (entry.scopes.extensions?.directReaders ?? 0) > 0).map((entry) => entry.name).sort();
  return { version: 1, generatedBy: relative(repoRoot, import.meta.path).replace(/\\/g, "/"), issueBaseline, runtimeSrcDirectBaseline: { source: baseline.source, names: baseline.names, added: runtimeSrcDirectNames.filter((name) => !baseline.names.includes(name)), removed: baseline.names.filter((name) => !runtimeSrcDirectNames.includes(name)) }, extensionDelta: { directReaderNamesOnlyInExtensions: extensionDirectNames.filter((name) => !runtimeSrcSet.has(name)) }, scanRootVersion, scanScopes, current, entries };
}
export function buildObservations(): Observations { return buildObservationsFromFileTexts(readAllScanFiles(scanScopes)); }
function loadCatalog() { return JSON.parse(readFileSync(catalogPath, "utf8")) as { version: 1; description: string; configSourcePrecedence: readonly string[]; bootstrapEnvAllowlist: readonly string[]; entries: SupportEntry[] }; }
export function buildSupportCatalog() { return loadCatalog(); }

function requiresPublicContract(status: CatalogStatus): boolean { return status === "supported" || status === "bootstrap" || status === "compatibility"; }
function isPlaceholder(value: unknown): boolean { return value === "unknown" || value === "placeholder" || value === "TODO"; }

export function validateScanContract(observations = buildObservations()): void {
  if (observations.scanRootVersion !== scanRootVersion) throw new Error("Scan root version drift");
  if (JSON.stringify(observations.scanScopes) !== JSON.stringify(scanScopes)) throw new Error("Scan root scope drift");
  const webAliases = new Set(["PICLAW_TERMINAL_IMAGE_PROTOCOL", "PICLAW_WEB_PUSH_SUBSCRIPTION_CAP", "PICLAW_WEB_PUSH_VAPID_SUBJECT"]);
  for (const entry of observations.entries) {
    if (!webAliases.has(entry.name)) continue;
    for (const file of entry.scopes.runtimeSrc?.readerFiles ?? []) {
      if (file !== "runtime/src/core/config.ts") throw new Error(`Web compatibility env reader outside core config: ${entry.name} in ${file}`);
    }
  }
  if (observations.runtimeSrcDirectBaseline.added.length > 0 || observations.runtimeSrcDirectBaseline.removed.length > 0) {
    throw new Error(
      `Runtime src direct-reader name drift: added=${observations.runtimeSrcDirectBaseline.added.join(",") || "none"} removed=${observations.runtimeSrcDirectBaseline.removed.join(",") || "none"}`,
    );
  }
}

export function validateSupportCatalog(catalog = buildSupportCatalog(), observations = buildObservations()): void {
  validateScanContract(observations);
  if (JSON.stringify(catalog.bootstrapEnvAllowlist) !== JSON.stringify(bootstrapEnvAllowlist)) throw new Error("Bootstrap env allowlist drift");
  const catalogByName = new Map(catalog.entries.map((entry) => [entry.name, entry]));
  const productionNames = observations.entries.filter((entry) => entry.scopes.production?.referenced).map((entry) => entry.name);
  for (const name of productionNames) {
    const entry = catalogByName.get(name);
    if (!entry) throw new Error(`Missing production env disposition catalog entry: ${name}`);
    if (!entry.owner || !entry.status || !entry.source || !entry.migrationDisposition) throw new Error(`Incomplete disposition metadata for ${name}`);
    if ([entry.owner, entry.status, entry.source, entry.migrationDisposition].some(isPlaceholder)) throw new Error(`Placeholder disposition metadata for ${name}`);
    if (requiresPublicContract(entry.status)) {
      if (!entry.type || entry.persistence.length === 0 || entry.precedence.length === 0) throw new Error(`Incomplete supported-config contract for ${name}`);
      if ([entry.type, entry.default, entry.bounds].some(isPlaceholder)) throw new Error(`Placeholder supported-config contract for ${name}`);
    } else {
      if (entry.persistence.includes("json-config")) throw new Error(`Internal env ${name} must not declare json-config persistence`);
    }
    if (entry.secret && entry.persistence.includes("json-config")) throw new Error(`Secret env ${name} must not declare json-config persistence`);
    if (entry.status === "bootstrap" && !entry.bootstrapAllowed) throw new Error(`Bootstrap env ${name} is not allowlisted`);
  }
  for (const entry of catalog.entries) if (entry.bootstrapAllowed && !bootstrapSet.has(entry.name)) throw new Error(`Catalog bootstrapAllowed not in allowlist: ${entry.name}`);
}
export function stableJson(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
export function isObservationTextCurrent(current: string, observations: Observations): boolean { return current === stableJson(observations); }
export function isCatalogTextCurrent(current: string, catalog: ReturnType<typeof buildSupportCatalog>): boolean { return current === stableJson(catalog); }

function currentRuntimeSrcDirectNames(observations: Observations): string[] {
  return observations.entries.filter((entry) => (entry.scopes.runtimeSrc?.directReaders ?? 0) > 0).map((entry) => entry.name).sort();
}

function main(): void {
  const acceptReduction = process.argv.includes("--accept-reduction");
  let observations = buildObservations();
  if (process.argv.includes("--write") && acceptReduction) {
    if (observations.runtimeSrcDirectBaseline.added.length > 0) {
      throw new Error(`Cannot accept env reader baseline with additions: ${observations.runtimeSrcDirectBaseline.added.join(",")}`);
    }
    if (observations.runtimeSrcDirectBaseline.removed.length > 0) {
      mkdirSync(dirname(runtimeSrcBaselinePath), { recursive: true });
      writeFileSync(runtimeSrcBaselinePath, stableJson({
        version: 1,
        source: `accepted direct-reader reduction from ${observations.runtimeSrcDirectBaseline.names.length} to ${currentRuntimeSrcDirectNames(observations).length}`,
        names: currentRuntimeSrcDirectNames(observations),
      }));
      observations = buildObservations();
    }
  }
  const catalog = buildSupportCatalog();
  validateSupportCatalog(catalog, observations);
  if (process.argv.includes("--write")) { mkdirSync(dirname(observationsPath), { recursive: true }); writeFileSync(observationsPath, stableJson(observations)); if (!existsSync(runtimeSrcBaselinePath)) writeFileSync(runtimeSrcBaselinePath, stableJson({ version: 1, source: observations.runtimeSrcDirectBaseline.source, names: observations.runtimeSrcDirectBaseline.names })); }
  if (process.argv.includes("--check")) { const obs = existsSync(observationsPath) ? readFileSync(observationsPath, "utf8") : ""; if (!isObservationTextCurrent(obs, observations)) throw new Error(`${relative(repoRoot, observationsPath)} is stale. Run: bun run scripts/audit-piclaw-env-surface.ts --write`); if (!isCatalogTextCurrent(readFileSync(catalogPath, "utf8"), catalog)) throw new Error(`${relative(repoRoot, catalogPath)} is stale`); console.log(`[env-surface] ok runtime_src_direct=${observations.current.runtimeSrc.directReaderNames} production_direct=${observations.current.production.directReaderNames} extension_delta=${observations.extensionDelta.directReaderNamesOnlyInExtensions.join(",") || "none"}`); return; }
  console.log(JSON.stringify({ current: observations.current, baselineDelta: observations.runtimeSrcDirectBaseline, extensionDelta: observations.extensionDelta }, null, 2));
}
if (import.meta.main) main();
