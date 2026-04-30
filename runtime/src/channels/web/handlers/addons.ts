/**
 * web/handlers/addons.ts — Backend add-on management endpoints.
 *
 * GET  /agent/addons           — fetch one or more catalogs + local install state
 * POST /agent/addons/install   — install an addon by slug
 * POST /agent/addons/uninstall — uninstall an addon by slug
 *
 * IMPORTANT: first-party piclaw add-ons must install from public GitHub-hosted
 * tarball URLs (the catalog's install.spec), never from npmjs.org and never from
 * authenticated GitHub Packages registry entries. GitHub Packages npm reads still
 * require auth and caused regressions in add-on install/remove flows.
 *
 * Preferred flow: install from the catalog's public tarball URL.
 * Repo-tree / GitHub API fallback is intentionally unsupported now.
 * Explicit non-tarball package specs remain available for third-party catalogs.
 */

import { appendFileSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, mkdirSync, statSync, unlinkSync, writeFileSync, renameSync, symlinkSync } from "fs";
import { join, dirname, extname, resolve } from "path";
import { WORKSPACE_DIR } from "../../../core/config.js";
import { requestGracefulShutdown } from "../../../runtime/shutdown-registry.js";
import { validateCallbackUrl } from "../../../remote/ssrf.js";
import { createLogger } from "../../../utils/logger.js";
import { isPathWithin, isRealPathWithin } from "../../../utils/path-safety.js";
import { handleRegisteredAddonConfigApiRequest } from "./addon-config-api.js";

const DEFAULT_CATALOG_URL = "https://raw.githubusercontent.com/rcarmo/piclaw-addons/main/catalog.json";
const DEFAULT_CATALOG_URLS = [DEFAULT_CATALOG_URL] as const;
const CATALOG_CACHE_MS = 5 * 60 * 1000;
const MAX_CATALOG_BYTES = 1024 * 1024;
const MAX_TARBALL_BYTES = 64 * 1024 * 1024;
const ADDON_FETCH_TIMEOUT_MS = 30000;
const ADDON_FETCH_MAX_REDIRECTS = 3;
export const WEB_RESTART_DELAY_MS = 150;

const catalogCache = new Map<string, { data: unknown; ts: number }>();

type BunCommandResult = { ok: boolean; exitCode: number; stdout: string; stderr: string };
type AddonInstallTestHooks = {
  runBunCommand?: (args: string[], cwd: string) => Promise<BunCommandResult>;
  downloadUrlToFile?: (url: string, destPath: string) => Promise<void>;
};

let addonInstallTestHooks: AddonInstallTestHooks | null = null;

export function setAddonInstallTestHooksForTests(hooks: AddonInstallTestHooks | null): void {
  addonInstallTestHooks = hooks;
}

interface CatalogAddonInstall {
  kind?: string;
  spec?: string;
  piSource?: string;
}

interface CatalogAddon {
  slug: string;
  name: string;
  version?: string;
  type?: string;
  description?: string;
  path?: string;
  tags?: string[];
  skills?: string[];
  install?: CatalogAddonInstall;
}

interface CatalogData {
  version?: number;
  source?: string;
  addons: CatalogAddon[];
}

interface AddonPackageManifest {
  name?: string;
  version?: string;
  main?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  pi?: {
    extensions?: string[];
    web?: {
      entries?: string[];
    };
  };
}

interface InstalledAddonWebEntry {
  packageName: string;
  entry: string;
  url: string;
}

interface SlashCommandInvoker {
  applySlashCommand(chatJid: string, rawText: string): Promise<{
    status: string;
    message?: string;
    messages?: Array<{ text?: string; customType?: string }>;
  }>;
}

function getWorkspaceDir(): string {
  return process.env.PICLAW_WORKSPACE || WORKSPACE_DIR;
}

function getAddonsDir(workspaceDir = getWorkspaceDir()): string {
  return join(workspaceDir, ".pi", "extensions");
}

function ensureAddonsDir(): string {
  const addonsDir = getAddonsDir();
  const pkgJson = join(addonsDir, "package.json");
  if (!existsSync(pkgJson)) {
    mkdirSync(addonsDir, { recursive: true });
    writeFileSync(pkgJson, JSON.stringify({
      name: "piclaw-local-addons",
      private: true,
      dependencies: {},
    }, null, 2));
  }
  return addonsDir;
}

const addonLog = createLogger("web.handlers.addons");

/**
 * Remove a stale node_modules symlink (created by the session extension-link
 * helper) so that `bun add` can create a real node_modules directory.
 *
 * The session bootstrap symlinks `.pi/extensions/node_modules` → the bundled
 * (read-only) node_modules so that jiti can resolve framework packages from
 * user-written workspace extensions.  When addons are installed the directory
 * must be a real writable tree, not a symlink; otherwise every `bun add` and
 * the legacy mkdir fallback both fail with EACCES.
 */
function removeNodeModulesSymlinkIfPresent(addonsDir: string): void {
  const nodeModulesPath = join(addonsDir, "node_modules");
  try {
    const stat = lstatSync(nodeModulesPath);
    if (stat.isSymbolicLink()) {
      unlinkSync(nodeModulesPath);
    }
  } catch (e) {
    // Not found or inaccessible — nothing to remove.
    void e;
  }
}

function ensureWritableAddonsNodeModulesDir(addonsDir: string): void {
  removeNodeModulesSymlinkIfPresent(addonsDir);
  mkdirSync(join(addonsDir, "node_modules"), { recursive: true });
}

function readAddonManifest(manifestPath: string): AddonPackageManifest | null {
  try {
    if (!existsSync(manifestPath)) return null;
    return JSON.parse(readFileSync(manifestPath, "utf-8")) as AddonPackageManifest;
  } catch {
    return null;
  }
}

function hasAddonRuntimeDependencies(manifest: AddonPackageManifest | null | undefined): boolean {
  const dependencies = manifest?.dependencies;
  return !!dependencies && typeof dependencies === "object" && Object.keys(dependencies).length > 0;
}

function findBundledNodeModulesDir(startDir = __dirname): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "node_modules");
    if (existsSync(join(candidate, "@mariozechner", "pi-ai"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const globalCandidate = "/usr/local/lib/bun/install/global/node_modules";
  return existsSync(join(globalCandidate, "@mariozechner", "pi-ai")) ? globalCandidate : null;
}

function linkBundledNodeModulesIntoAddon(addonDir: string): void {
  const bundledNodeModulesDir = findBundledNodeModulesDir();
  if (!bundledNodeModulesDir) return;
  const addonNodeModulesDir = join(addonDir, "node_modules");
  if (existsSync(addonNodeModulesDir)) return;
  try {
    symlinkSync(bundledNodeModulesDir, addonNodeModulesDir);
  } catch (error) {
    void error;
  }
}

function getInstalledVersion(packageName: string): string | null {
  const workspaceDir = getWorkspaceDir();
  for (const dir of [getAddonsDir(workspaceDir)]) {
    const pkgJsonPath = join(dir, "node_modules", packageName, "package.json");
    try {
      if (!existsSync(pkgJsonPath)) continue;
      const raw = readFileSync(pkgJsonPath, "utf-8");
      const pkg = JSON.parse(raw);
      if (typeof pkg.version === "string") return pkg.version;
    } catch (e) { /* package.json unreadable — skip */ void e; }
  }
  return null;
}

function listAddonPackageDirs(addonsNodeModulesDir: string): string[] {
  if (!existsSync(addonsNodeModulesDir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(addonsNodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const entryPath = join(addonsNodeModulesDir, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSync(entryPath, { withFileTypes: true })) {
        if (scoped.isDirectory()) results.push(join(entryPath, scoped.name));
      }
      continue;
    }
    results.push(entryPath);
  }
  return results;
}

function isValidAddonPackageName(packageName: string): boolean {
  const name = String(packageName || '').trim();
  if (!name || name === '.' || name === '..' || name.includes('\\')) return false;
  if (name.startsWith('@')) {
    return /^@[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+$/.test(name)
      && !name.split('/').some((segment) => segment === '.' || segment === '..');
  }
  return /^[A-Za-z0-9._~-]+$/.test(name);
}

function getInstalledAddonPackageDir(packageName: string, workspaceDir = getWorkspaceDir()): string | null {
  if (!isValidAddonPackageName(packageName)) return null;
  const addonsNodeModulesDir = join(workspaceDir, '.pi', 'extensions', 'node_modules');
  const packageDir = join(addonsNodeModulesDir, packageName);
  return existsSync(packageDir) ? packageDir : null;
}

export function getInstalledAddonWebEntries(workspaceDir = getWorkspaceDir()): InstalledAddonWebEntry[] {
  const addonsNodeModulesDir = join(workspaceDir, '.pi', 'extensions', 'node_modules');
  const entries: InstalledAddonWebEntry[] = [];
  for (const packageDir of listAddonPackageDirs(addonsNodeModulesDir)) {
    const packageJsonPath = join(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as AddonPackageManifest;
      const packageName = typeof manifest.name === 'string' ? manifest.name.trim() : '';
      const webEntries = Array.isArray(manifest?.pi?.web?.entries)
        ? manifest.pi.web.entries.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
        : [];
      if (!packageName || webEntries.length === 0) continue;
      for (const entry of webEntries) {
        const normalizedEntry = entry.replace(/^\.\//, '');
        const fullPath = join(packageDir, normalizedEntry);
        if (!existsSync(fullPath)) continue;
        entries.push({
          packageName,
          entry: normalizedEntry,
          url: `/agent/addons/assets/${encodeURIComponent(packageName)}/${normalizedEntry.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`,
        });
      }
    } catch {
      continue;
    }
  }
  return entries;
}

function parseAddonAssetRequestPath(pathname: string): { packageName: string; relativePath: string } | null {
  const prefix = '/agent/addons/assets/';
  if (!pathname.startsWith(prefix)) return null;
  let rest: string[];
  try {
    rest = pathname.slice(prefix.length).split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (rest.length < 2) return null;
  const packageName = rest[0].startsWith('@')
    ? rest[0].includes('/')
      ? rest[0]
      : rest.length >= 3
        ? `${rest[0]}/${rest[1]}`
        : ''
    : rest[0];
  const relativeSegments = rest[0].startsWith('@')
    ? rest[0].includes('/')
      ? rest.slice(1)
      : rest.slice(2)
    : rest.slice(1);
  if (relativeSegments.some((segment) => segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))) {
    return null;
  }
  const relativePath = relativeSegments.join('/');
  if (!packageName || !isValidAddonPackageName(packageName) || !relativePath) return null;
  return { packageName, relativePath };
}

function getAddonAssetMimeType(assetPath: string): string {
  switch (extname(assetPath).toLowerCase()) {
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.html':
      return 'text/html; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function maybeTranspileAddonAsset(assetPath: string, source: string): string {
  const extension = extname(assetPath).toLowerCase();
  if (extension === '.tsx') {
    return new Bun.Transpiler({ loader: 'tsx' }).transformSync(source);
  }
  if (extension === '.jsx') {
    return new Bun.Transpiler({ loader: 'jsx' }).transformSync(source);
  }
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return new Bun.Transpiler({ loader: 'js' }).transformSync(source);
  }
  if (extension === '.ts') {
    return new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
  }
  return source;
}

export function parseCatalogUrlList(values: Array<string | null | undefined>): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const parts = String(value || "")
      .split(/[\r\n,]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (seen.has(part)) continue;
      seen.add(part);
      urls.push(part);
    }
  }
  return urls;
}

export function resolveRequestedCatalogUrls(url?: URL): string[] {
  const requested = parseCatalogUrlList(url?.searchParams.getAll("catalog_url") || []);
  if (requested.length === 0) return [...DEFAULT_CATALOG_URLS];
  // Always include the default catalog; additional URLs are merged on top.
  const merged: string[] = [...DEFAULT_CATALOG_URLS];
  for (const u of requested) {
    if (!merged.includes(u)) merged.push(u);
  }
  return merged;
}

async function assertSafeAddonFetchUrl(rawUrl: string): Promise<URL | null> {
  const check = await validateCallbackUrl(rawUrl, undefined, { allowHttp: true, allowPrivateNetwork: false });
  return check.ok && check.url ? check.url : null;
}

async function fetchSafeAddonUrl(rawUrl: string, timeoutMs = ADDON_FETCH_TIMEOUT_MS): Promise<Response | null> {
  let current = rawUrl;
  for (let redirects = 0; redirects <= ADDON_FETCH_MAX_REDIRECTS; redirects += 1) {
    const safeUrl = await assertSafeAddonFetchUrl(current);
    if (!safeUrl) return null;
    const response = await fetch(safeUrl.href, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = new URL(location, safeUrl).href;
      continue;
    }
    return response;
  }
  return null;
}

async function readBoundedResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;
  if (!response.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const rawChunk of response.body as unknown as AsyncIterable<Uint8Array | ArrayBuffer>) {
    const chunk = rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
    total += chunk.length;
    if (total > maxBytes) return null;
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function fetchCatalog(catalogUrl: string): Promise<CatalogData | null> {
  const url = String(catalogUrl || "").trim();
  if (!url) return null;
  const now = Date.now();
  const cached = catalogCache.get(url);
  if (cached && now - cached.ts < CATALOG_CACHE_MS) {
    return cached.data as CatalogData;
  }
  try {
    const response = await fetchSafeAddonUrl(url, 8000);
    if (!response?.ok) return null;
    const bytes = await readBoundedResponseBytes(response, MAX_CATALOG_BYTES);
    if (!bytes) return null;
    const data = JSON.parse(new TextDecoder().decode(bytes));
    catalogCache.set(url, { data, ts: now });
    return data as CatalogData;
  } catch (error) {
    addonLog.warn("Failed to fetch add-on catalog", {
      operation: "addons.catalog.fetch",
      url,
      err: error,
    });
    return (catalogCache.get(url)?.data as CatalogData | undefined) ?? null;
  }
}

export function mergeCatalogs(catalogs: CatalogData[]): CatalogData | null {
  const validCatalogs = catalogs.filter((catalog) => catalog && Array.isArray(catalog.addons));
  if (validCatalogs.length === 0) return null;
  const addons: CatalogAddon[] = [];
  const seenKeys = new Set<string>();
  const sources: string[] = [];
  let version = 0;

  for (const catalog of validCatalogs) {
    version = Math.max(version, Number(catalog.version) || 0);
    const source = typeof catalog.source === "string" ? catalog.source.trim() : "";
    if (source && !sources.includes(source)) sources.push(source);
    for (const addon of catalog.addons) {
      const slugKey = typeof addon?.slug === "string" && addon.slug.trim() ? `slug:${addon.slug.trim()}` : "";
      const nameKey = typeof addon?.name === "string" && addon.name.trim() ? `name:${addon.name.trim()}` : "";
      const dedupeKey = slugKey || nameKey;
      if (!dedupeKey || seenKeys.has(dedupeKey)) continue;
      if (slugKey) seenKeys.add(slugKey);
      if (nameKey) seenKeys.add(nameKey);
      addons.push(addon);
    }
  }

  return {
    version: version || undefined,
    source: sources.join(", "),
    addons,
  };
}

async function fetchMergedCatalog(catalogUrls: string[]): Promise<{ catalog: CatalogData | null; urls: string[]; failedUrls: string[] }> {
  const urls = parseCatalogUrlList(catalogUrls);
  const results = await Promise.all(urls.map(async (catalogUrl) => ({
    url: catalogUrl,
    catalog: await fetchCatalog(catalogUrl),
  })));
  const catalogs = results
    .map((result) => result.catalog)
    .filter((catalog): catalog is CatalogData => Boolean(catalog && Array.isArray(catalog.addons)));
  const failedUrls = results.filter((result) => !result.catalog || !Array.isArray(result.catalog.addons)).map((result) => result.url);
  return {
    catalog: mergeCatalogs(catalogs),
    urls,
    failedUrls,
  };
}

export function resolveAddonInstallSpec(addon: Pick<CatalogAddon, "name" | "version" | "install">): { kind: string; spec: string; piSource?: string } {
  const explicitSpec = addon.install?.spec?.trim();
  if (explicitSpec) {
    return {
      kind: addon.install?.kind?.trim() || "tarball",
      spec: explicitSpec,
      piSource: addon.install?.piSource?.trim() || undefined,
    };
  }
  // Catalogs should provide an explicit install spec. If they do not, surface the
  // package name as a best-effort bun add target rather than falling back to any
  // repo-tree or GitHub API download path.
  return {
    kind: "package",
    spec: addon.name,
  };
}

async function runBunCommand(args: string[], cwd: string): Promise<BunCommandResult> {
  try {
    const proc = Bun.spawn(args, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        BUN_INSTALL: undefined,
        // Use a writable cache dir to avoid EACCES errors on system bun cache
        BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR || join(cwd, ".cache"),
      },
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return {
      ok: exitCode === 0,
      exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: String((error as { message?: string })?.message || error),
    };
  }
}

function getRuntimePlatform(): NodeJS.Platform {
  const override = process.env.PICLAW_TEST_PLATFORM;
  return (override || process.platform) as NodeJS.Platform;
}

export function isAddonFsLockError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '').toUpperCase();
  const message = String((error as { message?: string })?.message || error || '').toLowerCase();
  return code === 'EBUSY'
    || code === 'EPERM'
    || code === 'ENOTEMPTY'
    || message.includes('resource busy')
    || message.includes('operation not permitted')
    || message.includes('permission denied')
    || message.includes('access is denied')
    || message.includes('directory not empty');
}

type AddonFsOps = {
  existsSync?: typeof existsSync;
  rmSync?: typeof rmSync;
  mkdirSync?: typeof mkdirSync;
  renameSync?: typeof renameSync;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
  platform?: NodeJS.Platform;
};

export async function removeAddonDirRobustly(
  targetDir: string,
  addonsDir: string,
  ops: AddonFsOps = {},
): Promise<{ removed: boolean; deferred: boolean; movedTo?: string }> {
  const pathExists = ops.existsSync || existsSync;
  const removePath = ops.rmSync || rmSync;
  const makeDir = ops.mkdirSync || mkdirSync;
  const renamePath = ops.renameSync || renameSync;
  const sleep = ops.sleep || ((ms: number) => Bun.sleep(ms));
  const now = ops.now || (() => Date.now());
  const platform = ops.platform || getRuntimePlatform();

  if (!pathExists(targetDir)) {
    return { removed: false, deferred: false };
  }

  const delays = [40, 120, 260];
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      removePath(targetDir, { recursive: true, force: true });
      return { removed: true, deferred: false };
    } catch (error) {
      lastError = error;
      if (!(platform === 'win32' && isAddonFsLockError(error)) || attempt === delays.length) break;
      await sleep(delays[attempt]!);
    }
  }

  if (platform === 'win32' && lastError && isAddonFsLockError(lastError) && pathExists(targetDir)) {
    const quarantineDir = join(addonsDir, '.trash');
    makeDir(quarantineDir, { recursive: true });
    const movedTo = join(quarantineDir, `${getPathLeaf(targetDir)}-${now()}`);
    renamePath(targetDir, movedTo);
    return { removed: true, deferred: true, movedTo };
  }

  throw lastError;
}

function getPathLeaf(input: string): string {
  return String(input || '').split(/[\\/]+/).filter(Boolean).at(-1) || 'addon';
}

function cleanupAddonDependencyRecord(addonsDir: string, addonName: string): { cleaned: boolean; error?: string } {
  const pkgJsonPath = join(addonsDir, 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    if (!pkg.dependencies || !(addonName in pkg.dependencies)) return { cleaned: false };
    delete pkg.dependencies[addonName];
    writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2));
    return { cleaned: true };
  } catch (error) {
    return { cleaned: false, error: String((error as { message?: string })?.message || error) };
  }
}

function setAddonDependencyRecord(addonsDir: string, addonName: string, spec: string): { updated: boolean; error?: string } {
  const pkgJsonPath = join(addonsDir, 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    if (!pkg.dependencies) pkg.dependencies = {};
    if (pkg.dependencies[addonName] === spec) return { updated: false };
    pkg.dependencies[addonName] = spec;
    writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2));
    return { updated: true };
  } catch (error) {
    return { updated: false, error: String((error as { message?: string })?.message || error) };
  }
}

function normalizeCatalogDependencySpecs(addonsDir: string, catalogAddons: CatalogAddon[]): { updated: number; errors: string[] } {
  const pkgJsonPath = join(addonsDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return { updated: 0, errors: [] };
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    if (!pkg.dependencies || typeof pkg.dependencies !== 'object') return { updated: 0, errors: [] };
    let updated = 0;
    for (const addon of catalogAddons) {
      if (!addon?.name || !(addon.name in pkg.dependencies)) continue;
      const plan = resolveAddonInstallSpec(addon);
      // First-party catalog entries should always use public tarball URLs in package.json.
      if (plan.kind !== 'tarball' || !/^https?:\/\//.test(plan.spec)) continue;
      if (pkg.dependencies[addon.name] === plan.spec) continue;
      pkg.dependencies[addon.name] = plan.spec;
      updated++;
    }
    if (updated > 0) writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2));
    return { updated, errors: [] };
  } catch (error) {
    return { updated: 0, errors: [String((error as { message?: string })?.message || error)] };
  }
}

function describeAddonOperationFailure(action: 'install' | 'uninstall', error: unknown): string {
  const message = String((error as { message?: string })?.message || error || 'unknown error');
  if (getRuntimePlatform() === 'win32' && isAddonFsLockError(error)) {
    const verb = action === 'install' ? 'install' : 'remove';
    return `Windows file locking blocked the add-on ${verb}. Restart piclaw (or close panes using the add-on) and try again. Raw error: ${message}`;
  }
  return message;
}

async function downloadUrlToFile(url: string, destPath: string): Promise<void> {
  const resp = await fetchSafeAddonUrl(url);
  if (!resp) throw new Error(`Refused unsafe add-on download URL: ${url}`);
  if (!resp.ok) throw new Error(`Failed to download ${url}: ${resp.status}`);
  const contentLength = Number(resp.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_TARBALL_BYTES) {
    throw new Error(`Add-on tarball exceeds ${MAX_TARBALL_BYTES} byte limit.`);
  }
  const dir = dirname(destPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(destPath, new Uint8Array());
  let total = 0;
  try {
    if (resp.body) {
      for await (const rawChunk of resp.body as unknown as AsyncIterable<Uint8Array | ArrayBuffer>) {
        const chunk = rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
        total += chunk.length;
        if (total > MAX_TARBALL_BYTES) {
          throw new Error(`Add-on tarball exceeds ${MAX_TARBALL_BYTES} byte limit.`);
        }
        appendFileSync(destPath, chunk);
      }
    }
  } catch (error) {
    try { if (existsSync(destPath)) rmSync(destPath, { force: true }); } catch (cleanupError) {
      addonLog.warn("Failed to remove partial add-on tarball download", {
        operation: "addons.download.cleanup_partial",
        destPath,
        err: cleanupError,
      });
    }
    throw error;
  }
}

function resolveExtractedAddonRoot(stagingDir: string): string {
  if (existsSync(join(stagingDir, "package.json"))) return stagingDir;

  const npmPackRoot = join(stagingDir, "package");
  if (existsSync(join(npmPackRoot, "package.json"))) return npmPackRoot;

  for (const entry of readdirSync(stagingDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(stagingDir, entry.name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
  }

  throw new Error("Downloaded tarball did not contain a package.json at its root");
}

async function extractTarballToDir(archivePath: string, destDir: string): Promise<void> {
  const result = await runBunCommand(["tar", "xzf", archivePath, "-C", destDir], getWorkspaceDir());
  if (result.ok) return;
  const detail = result.stderr || result.stdout || `tar exited ${result.exitCode}`;
  throw new Error(`Failed to extract add-on tarball: ${detail}`);
}

async function installAddonFromTarball(
  addonsDir: string,
  destDir: string,
  addon: CatalogAddon,
  installPlan: { kind: string; spec: string },
): Promise<{ installedVersion: string | null; warning?: string; peerOnly: boolean }> {
  const stagingRoot = join(addonsDir, ".staging");
  const stagingLeaf = `${addon.name.replace(/[\\/]+/g, "__")}-${Date.now()}`;
  const stagingDir = join(stagingRoot, stagingLeaf);
  const archivePath = join(stagingRoot, `${stagingLeaf}.tgz`);
  mkdirSync(stagingRoot, { recursive: true });
  mkdirSync(stagingDir, { recursive: true });

  try {
    await (addonInstallTestHooks?.downloadUrlToFile || downloadUrlToFile)(installPlan.spec, archivePath);
    await extractTarballToDir(archivePath, stagingDir);

    const installRoot = resolveExtractedAddonRoot(stagingDir);
    const manifest = readAddonManifest(join(installRoot, "package.json"));
    if (!manifest?.name) throw new Error("Downloaded tarball did not contain a valid package.json");
    if (manifest.name !== addon.name) {
      throw new Error(`Downloaded tarball package mismatch: expected ${addon.name}, got ${manifest.name}`);
    }

    const peerOnly = !hasAddonRuntimeDependencies(manifest);
    if (!peerOnly) {
      const nestedInstall = await (addonInstallTestHooks?.runBunCommand || runBunCommand)(["bun", "install", "--force"], installRoot);
      if (!nestedInstall.ok) {
        const detail = nestedInstall.stderr || nestedInstall.stdout || `bun install exited ${nestedInstall.exitCode}`;
        throw new Error(`Add-on dependency install failed: ${detail}`);
      }
    }

    ensureWritableAddonsNodeModulesDir(addonsDir);
    const cleanup = await removeAddonDirRobustly(destDir, addonsDir);
    mkdirSync(dirname(destDir), { recursive: true });
    renameSync(installRoot, destDir);
    if (peerOnly) linkBundledNodeModulesIntoAddon(destDir);
    setAddonDependencyRecord(addonsDir, addon.name, installPlan.spec);

    return {
      installedVersion: getInstalledVersion(addon.name),
      ...(cleanup.deferred ? { warning: "Existing files were moved aside for cleanup on restart." } : {}),
      peerOnly,
    };
  } finally {
    try {
      if (existsSync(archivePath)) rmSync(archivePath, { force: true });
      if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
    } catch (e) { void e; /* staging cleanup is best-effort */ }
  }
}

export async function handleGetAddons(
  json: (body: unknown, status?: number) => Response,
  url?: URL,
): Promise<Response> {
  const { catalog, urls, failedUrls } = await fetchMergedCatalog(resolveRequestedCatalogUrls(url));
  if (!catalog || !Array.isArray(catalog.addons)) {
    return json({ error: "Failed to fetch add-on catalog" }, 502);
  }

  const addons = catalog.addons.map((addon) => {
    const installedVersion = getInstalledVersion(addon.name);
    const hasUpdate = installedVersion && addon.version && installedVersion !== addon.version;
    return {
      slug: addon.slug,
      name: addon.name,
      version: addon.version || null,
      type: addon.type || "extension",
      description: addon.description || "",
      path: addon.path || "",
      tags: addon.tags || [],
      skills: addon.skills || [],
      installed: Boolean(installedVersion),
      installedVersion: installedVersion || null,
      hasUpdate: Boolean(hasUpdate),
      installKind: resolveAddonInstallSpec(addon).kind,
    };
  });

  return json({ addons, source: catalog.source || "", sources: urls, failed_sources: failedUrls });
}

export async function handleGetAddonWebEntries(
  json: (body: unknown, status?: number) => Response,
): Promise<Response> {
  return json({ entries: getInstalledAddonWebEntries() });
}

function parseAddonConfigApiPath(pathname: string): { addonId: string; action: string } | null {
  const match = /^\/agent\/addons\/api\/([^/]+)\/([a-z0-9-]+)$/i.exec(pathname);
  if (!match) return null;
  let addonId: string;
  let action: string;
  try {
    addonId = decodeURIComponent(match[1] || '').trim();
    action = decodeURIComponent(match[2] || '').trim();
  } catch {
    return null;
  }
  if (!addonId || !action) return null;
  return { addonId, action };
}

function parseAddonCommandJsonPayload(
  addonId: string,
  result: { message?: string; messages?: Array<{ text?: string; customType?: string }> },
): unknown {
  const candidates = [
    ...(Array.isArray(result.messages) ? result.messages : [])
      .filter((message) => message?.customType === addonId)
      .map((message) => message?.text || ''),
    result.message || '',
  ].map((value) => String(value || '').trim()).filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  throw new Error(`Add-on ${addonId} did not return valid JSON.`);
}

function isUnknownAddonCommandMessage(message: unknown): boolean {
  return /unknown extension command/i.test(String(message || ''));
}

function buildAddonSlashCommand(commandName: string, payload?: string): string {
  return payload ? `/${commandName} ${payload}` : `/${commandName}`;
}

async function applyAddonConfigSlashCommand(
  agentPool: SlashCommandInvoker,
  chatJid: string,
  commandBaseName: string,
  payload?: string,
): Promise<{ status: string; message?: string; messages?: Array<{ text?: string; customType?: string }> }> {
  let lastResult: { status: string; message?: string; messages?: Array<{ text?: string; customType?: string }> } | null = null;
  const maxSuffix = 8;

  for (let suffix = 0; suffix <= maxSuffix; suffix += 1) {
    const commandName = suffix === 0 ? commandBaseName : `${commandBaseName}:${suffix}`;
    const result = await agentPool.applySlashCommand(chatJid, buildAddonSlashCommand(commandName, payload));
    if (result.status === 'success') return result;
    lastResult = result;
    if (!isUnknownAddonCommandMessage(result.message)) return result;
  }

  return lastResult ?? { status: 'error', message: 'Add-on command failed' };
}

export async function handleAddonConfigApiRequest(
  req: Request,
  pathname: string,
  json: (body: unknown, status?: number) => Response,
  agentPool: SlashCommandInvoker,
  chatJid = 'web:default',
): Promise<Response | null> {
  const parsed = parseAddonConfigApiPath(pathname);
  if (!parsed) return null;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const directResponse = await handleRegisteredAddonConfigApiRequest(req, parsed.addonId, parsed.action, json);
  if (directResponse) return directResponse;

  const commandBaseName = `${parsed.addonId}-${parsed.action}-${req.method === 'GET' ? 'get' : 'set'}`;
  const payload = req.method === 'POST'
    ? JSON.stringify(await req.json().catch(() => ({})))
    : undefined;

  const result = await applyAddonConfigSlashCommand(agentPool, chatJid, commandBaseName, payload);
  if (result.status !== 'success') {
    const message = String(result.message || 'Add-on command failed');
    return json({ error: message }, isUnknownAddonCommandMessage(message) ? 404 : 500);
  }

  try {
    return json(parseAddonCommandJsonPayload(parsed.addonId, result));
  } catch (error) {
    return json({ error: String((error as Error)?.message || error) }, 502);
  }
}

export async function handleAddonAssetRequest(
  req: Request,
  pathname: string,
): Promise<Response | null> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const parsed = parseAddonAssetRequestPath(pathname);
  if (!parsed) return null;
  const packageDir = getInstalledAddonPackageDir(parsed.packageName);
  if (!packageDir) return new Response('Not Found', { status: 404 });

  const resolvedPath = resolve(packageDir, parsed.relativePath);
  const packageRoot = resolve(packageDir);
  if (resolvedPath === packageRoot || !isPathWithin(packageRoot, resolvedPath)) {
    return new Response('Not Found', { status: 404 });
  }

  let realPackageRoot: string;
  let realAssetPath: string;
  try {
    realPackageRoot = realpathSync.native ? realpathSync.native(packageRoot) : realpathSync(packageRoot);
    realAssetPath = realpathSync.native ? realpathSync.native(resolvedPath) : realpathSync(resolvedPath);
  } catch {
    return new Response('Not Found', { status: 404 });
  }
  if (!isRealPathWithin(realPackageRoot, realAssetPath)) {
    return new Response('Not Found', { status: 404 });
  }

  try {
    const stats = statSync(resolvedPath);
    if (!stats.isFile()) {
      return new Response('Not Found', { status: 404 });
    }
  } catch {
    return new Response('Not Found', { status: 404 });
  }

  const mimeType = getAddonAssetMimeType(resolvedPath);
  const headers = {
    'Content-Type': mimeType,
    'Cache-Control': 'no-store',
  } as Record<string, string>;

  if (req.method === 'HEAD') {
    return new Response(null, { headers });
  }

  if (mimeType.startsWith('text/javascript')) {
    const source = readFileSync(resolvedPath, 'utf8');
    const code = maybeTranspileAddonAsset(resolvedPath, source);
    return new Response(code, { headers });
  }

  if (mimeType.includes('charset=utf-8')) {
    return new Response(readFileSync(resolvedPath, 'utf8'), { headers });
  }

  return new Response(readFileSync(resolvedPath), { headers });
}

export async function handleInstallAddon(
  req: Request,
  json: (body: unknown, status?: number) => Response,
  url?: URL,
): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const rawSlug = (body as Record<string, unknown> | null)?.slug;
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
  if (!slug) return json({ error: "Missing slug" }, 400);

  const { catalog } = await fetchMergedCatalog(resolveRequestedCatalogUrls(url));
  const addon = catalog?.addons?.find((a) => a.slug === slug);
  if (!addon) return json({ error: `Add-on "${slug}" not found in catalog` }, 404);

  const addonsDir = ensureAddonsDir();
  if (catalog?.addons?.length) normalizeCatalogDependencySpecs(addonsDir, catalog.addons);
  const destDir = join(addonsDir, "node_modules", addon.name);
  const installPlan = resolveAddonInstallSpec(addon);
  const installPlanIsTarballUrl = installPlan.kind === 'tarball' && /^https?:\/\//.test(installPlan.spec);

  try {
    if (installPlanIsTarballUrl) {
      addonLog.info("Installing add-on from public tarball URL", {
        operation: "addons.install.tarball",
        slug,
        spec: installPlan.spec,
      });
      const tarballInstall = await installAddonFromTarball(addonsDir, destDir, addon, installPlan);
      return json({
        ok: true,
        slug,
        name: addon.name,
        installedVersion: tarballInstall.installedVersion,
        installKind: installPlan.kind,
        installSpec: installPlan.spec,
        message: tarballInstall.peerOnly
          ? `Installed ${addon.name}@${tarballInstall.installedVersion || addon.version || "?"} via public tarball without installing redundant peer dependencies. Restart required to load.`
          : `Installed ${addon.name}@${tarballInstall.installedVersion || addon.version || "?"} via public tarball. Restart required to load.`,
        ...(tarballInstall.warning ? { warning: tarballInstall.warning } : {}),
      });
    }

    if (installPlan.kind === 'direct-download') {
      return json({ error: 'Catalog add-on installs must provide a tarball URL or package spec. Direct repo downloads are no longer supported.' }, 400);
    }

    addonLog.info("Installing add-on via explicit package spec", {
      operation: "addons.install.bun_add",
      slug,
      spec: installPlan.spec,
      installKind: installPlan.kind,
    });
    ensureWritableAddonsNodeModulesDir(addonsDir);
    const packageInstall = await (addonInstallTestHooks?.runBunCommand || runBunCommand)(["bun", "add", "--force", installPlan.spec], addonsDir);
    if (packageInstall.ok) {
      const installedVersion = getInstalledVersion(addon.name);
      return json({
        ok: true,
        slug,
        name: addon.name,
        installedVersion,
        installKind: installPlan.kind,
        installSpec: installPlan.spec,
        message: `Installed ${addon.name}@${installedVersion || addon.version || "?"} via ${installPlan.kind}. Restart required to load.`,
      });
    }

    const detail = packageInstall.stderr || packageInstall.stdout || `bun add exited ${packageInstall.exitCode}`;
    return json({ error: `Install failed: ${detail}` }, 500);
  } catch (e) {
    return json({ error: `Install failed: ${describeAddonOperationFailure('install', e)}` }, 500);
  }
}

export function handleRestartAddonRuntime(
  json: (body: unknown, status?: number) => Response,
): Response {
  setTimeout(() => {
    requestGracefulShutdown("web addons restart");
  }, WEB_RESTART_DELAY_MS);
  return json({
    ok: true,
    message: "Restarting piclaw… The UI should reconnect automatically.",
  });
}

export async function handleUninstallAddon(
  req: Request,
  json: (body: unknown, status?: number) => Response,
  url?: URL,
): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const rawSlug = (body as Record<string, unknown> | null)?.slug;
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
  if (!slug) return json({ error: "Missing slug" }, 400);

  const { catalog } = await fetchMergedCatalog(resolveRequestedCatalogUrls(url));
  const addon = catalog?.addons?.find((a) => a.slug === slug);
  if (!addon) return json({ error: `Add-on "${slug}" not found in catalog` }, 404);

  const addonsDir = ensureAddonsDir();
  if (catalog?.addons?.length) normalizeCatalogDependencySpecs(addonsDir, catalog.addons);
  const uninstallPlan = resolveAddonInstallSpec(addon);
  if (uninstallPlan.kind === 'tarball' && /^https?:\/\//.test(uninstallPlan.spec)) {
    setAddonDependencyRecord(addonsDir, addon.name, uninstallPlan.spec);
  }
  const destDir = join(addonsDir, "node_modules", addon.name);

  try {
    const removal = await runBunCommand(["bun", "remove", addon.name], addonsDir);
    let cleanup = { removed: false, deferred: false };
    let dependencyCleanup: { cleaned: boolean; error?: string } = { cleaned: false };
    if (!removal.ok) {
      cleanup = await removeAddonDirRobustly(destDir, addonsDir);
      dependencyCleanup = cleanupAddonDependencyRecord(addonsDir, addon.name);
    }

    if (!removal.ok && existsSync(destDir)) {
      const detail = removal.stderr || removal.stdout || `bun remove exited ${removal.exitCode}`;
      return json({ error: `Uninstall failed via bun remove: ${detail}` }, 500);
    }

    const warnings: string[] = [];
    if (!removal.ok) {
      const detail = removal.stderr || removal.stdout || `bun remove exited ${removal.exitCode}`;
      warnings.push(`bun remove failed first: ${detail}`);
      if (cleanup.deferred) warnings.push('Locked files were moved aside for cleanup on restart.');
      if (dependencyCleanup.error) warnings.push(`package.json cleanup failed: ${dependencyCleanup.error}`);
    }

    return json({
      ok: true,
      slug,
      name: addon.name,
      message: `Removed ${addon.name}. Restart required to unload.`,
      ...(warnings.length ? { warning: warnings.join(' ') } : {}),
    });
  } catch (e) {
    return json({ error: `Uninstall failed: ${describeAddonOperationFailure('uninstall', e)}` }, 500);
  }
}
