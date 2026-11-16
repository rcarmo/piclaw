import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

export const TEST_FS_ISOLATION_ACTIVE_ENV = "PICLAW_TEST_FS_ISOLATION_ACTIVE";
export const TEST_FS_ISOLATION_ROOT_ENV = "PICLAW_TEST_FS_ISOLATION_ROOT";

const ROOT_PREFIX = "piclaw-test-fs-";
const MARKER_FILE = ".piclaw-test-filesystem-isolation";
const MARKER_MAGIC = "piclaw test filesystem isolation";
const PATH_ENV_KEYS = [
  "PICLAW_WORKSPACE",
  "PICLAW_STORE",
  "PICLAW_DATA",
  "PICLAW_PI_AGENT_DIR",
  "PI_CODING_AGENT_DIR",
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
] as const;
const SECRET_ENV_KEYS = [
  "PICLAW_KEYCHAIN_KEY",
  "PICLAW_KEYCHAIN_KEY_FILE",
  "PICLAW_INTERNAL_SECRET",
  "PICLAW_WEB_INTERNAL_SECRET",
  "PICLAW_WEB_TOTP_SECRET",
  "PICLAW_WEB_WIDGET_TOKEN",
  "PUSHOVER_APP_TOKEN",
  "PUSHOVER_USER_KEY",
] as const;
const DEPLOYMENT_PATH_ENV_KEYS = [
  "SUPERVISOR_CONF",
  "PICLAW_WEB_TLS_CERT",
  "PICLAW_WEB_TLS_KEY",
  "PICLAW_RUNTIME_ROOT",
  "PICLAW_WORKSPACE_SEARCH_ROOTS",
] as const;

type MutableEnv = Record<string, string | undefined>;

export type TestFilesystemIsolation = {
  readonly root: string;
  readonly workspace: string;
  readonly store: string;
  readonly data: string;
  readonly home: string;
  readonly piAgentDir: string;
  readonly createdRoot: boolean;
  cleanup: () => void;
};

function safeTempParent(): string {
  if (process.platform !== "win32" && existsSync("/tmp")) return realpathSync("/tmp");
  return realpathSync(tmpdir());
}

function isWithin(parent: string, candidate: string): boolean {
  const resolvedParent = resolve(parent);
  const resolvedCandidate = resolve(candidate);
  return resolvedCandidate === resolvedParent || resolvedCandidate.startsWith(`${resolvedParent}${sep}`);
}

function existingRealPath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function readOwnedMarker(root: string): string | null {
  try {
    const raw = readFileSync(join(root, MARKER_FILE), "utf8").trim();
    const parsed = JSON.parse(raw) as { magic?: unknown };
    return parsed.magic === MARKER_MAGIC ? raw : null;
  } catch {
    return null;
  }
}

function isSafeRoot(path: string | undefined): path is string {
  if (!path?.trim()) return false;
  const resolved = resolve(path);
  if (!resolved.split(/[\\/]/).at(-1)?.startsWith(ROOT_PREFIX)) return false;
  try {
    const stat = lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    const real = realpathSync(resolved);
    if (!isWithin(safeTempParent(), real)) return false;
    return readOwnedMarker(real) !== null;
  } catch {
    return false;
  }
}

function assertExistingAncestorsStayWithinRoot(root: string, path: string): void {
  const rootReal = realpathSync(root);
  const resolved = resolve(path);
  if (!isWithin(rootReal, resolved)) throw new Error(`[test-fs-isolation] refusing path outside isolated root: ${resolved}`);

  const relative = resolved.slice(rootReal.length).replace(/^[\\/]+/, "");
  let current = rootReal;
  if (relative.length === 0) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`[test-fs-isolation] refusing unsafe isolated root: ${current}`);
    return;
  }

  for (const part of relative.split(/[\\/]+/)) {
    current = join(current, part);
    let stat;
    try { stat = lstatSync(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`[test-fs-isolation] refusing symlink under isolated root before mutation: ${current}`);
    const real = realpathSync(current);
    if (!isWithin(rootReal, real)) throw new Error(`[test-fs-isolation] refusing symlink escape under isolated root: ${current}`);
  }
}

function ensureSafeDirectory(root: string, path: string): void {
  const resolved = resolve(path);
  assertExistingAncestorsStayWithinRoot(root, resolved);
  mkdirSync(resolved, { recursive: true });
  assertExistingAncestorsStayWithinRoot(root, resolved);
  const real = realpathSync(resolved);
  if (!isWithin(realpathSync(root), real)) throw new Error(`[test-fs-isolation] refusing symlink escape under isolated root: ${resolved}`);
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`[test-fs-isolation] refusing non-directory isolated path: ${resolved}`);
}

function createRoot(): string {
  const root = mkdtempSync(join(safeTempParent(), ROOT_PREFIX));
  const real = realpathSync(root);
  if (!isSafeRootCandidate(real)) throw new Error(`[test-fs-isolation] unsafe scratch root: ${real}`);
  writeFileSync(join(real, MARKER_FILE), `${JSON.stringify({ magic: MARKER_MAGIC, pid: process.pid, createdAt: new Date().toISOString() })}\n`, { flag: "wx" });
  return real;
}

function isSafeRootCandidate(path: string): boolean {
  const resolved = resolve(path);
  const basename = resolved.split(/[\\/]/).at(-1) ?? "";
  if (!basename.startsWith(ROOT_PREFIX)) return false;
  if (!isWithin(safeTempParent(), resolved)) return false;
  const stat = lstatSync(resolved);
  return stat.isDirectory() && !stat.isSymbolicLink();
}

function buildPaths(root: string) {
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const store = join(workspace, ".piclaw", "store");
  const data = join(workspace, ".piclaw", "data");
  const piAgentDir = join(home, ".pi", "agent");
  return {
    home,
    workspace,
    store,
    data,
    piAgentDir,
    xdgConfig: join(home, ".config"),
    xdgCache: join(home, ".cache"),
    xdgData: join(home, ".local", "share"),
    tmp: join(root, "tmp"),
  };
}

function runtimePathOverridesAreSafeDisposable(env: MutableEnv, root: string): boolean {
  if (!env.PICLAW_WORKSPACE?.trim()) return false;
  const values = [env.PICLAW_WORKSPACE, env.PICLAW_STORE, env.PICLAW_DATA].filter((value): value is string => Boolean(value?.trim()));
  return values.every((value) => {
    const resolved = resolve(value);
    if (!isWithin(root, resolved)) return false;
    assertExistingAncestorsStayWithinRoot(root, resolved);
    return true;
  });
}

function inheritedRootIsUsable(env: MutableEnv): boolean {
  if (env[TEST_FS_ISOLATION_ACTIVE_ENV] !== "1") return false;
  if (!isSafeRoot(env[TEST_FS_ISOLATION_ROOT_ENV])) return false;
  const root = realpathSync(resolve(env[TEST_FS_ISOLATION_ROOT_ENV]!));
  return PATH_ENV_KEYS.every((key) => {
    const value = env[key];
    if (!value?.trim()) return true;
    const resolved = resolve(value);
    if (!isWithin(root, resolved)) return false;
    assertExistingAncestorsStayWithinRoot(root, resolved);
    const real = existingRealPath(resolved);
    return real === null || isWithin(root, real);
  });
}

export function ensureTestFilesystemIsolation(env: MutableEnv = process.env): TestFilesystemIsolation {
  const e2eSecret = env.PICLAW_E2E_DISPOSABLE === "1" ? env.PICLAW_E2E_INTERNAL_SECRET : undefined;
  const reusedRoot = inheritedRootIsUsable(env);
  const root = reusedRoot
    ? realpathSync(resolve(env[TEST_FS_ISOLATION_ROOT_ENV]!))
    : createRoot();
  const createdRoot = !reusedRoot;
  const paths = buildPaths(root);
  const preserveRuntimePathOverrides = reusedRoot && runtimePathOverridesAreSafeDisposable(env, root);
  const workspace = preserveRuntimePathOverrides ? resolve(env.PICLAW_WORKSPACE!) : paths.workspace;
  const store = preserveRuntimePathOverrides ? resolve(env.PICLAW_STORE || join(workspace, ".piclaw", "store")) : paths.store;
  const data = preserveRuntimePathOverrides ? resolve(env.PICLAW_DATA || join(workspace, ".piclaw", "data")) : paths.data;

  for (const path of Object.values(paths)) ensureSafeDirectory(root, path);
  for (const path of [workspace, store, data]) ensureSafeDirectory(root, path);

  env[TEST_FS_ISOLATION_ACTIVE_ENV] = "1";
  env[TEST_FS_ISOLATION_ROOT_ENV] = root;
  env.PICLAW_WORKSPACE = workspace;
  env.PICLAW_STORE = store;
  env.PICLAW_DATA = data;
  env.PICLAW_PI_AGENT_DIR = paths.piAgentDir;
  env.PI_CODING_AGENT_DIR = paths.piAgentDir;
  env.HOME = paths.home;
  env.XDG_CONFIG_HOME = paths.xdgConfig;
  env.XDG_CACHE_HOME = paths.xdgCache;
  env.XDG_DATA_HOME = paths.xdgData;
  env.TMPDIR = paths.tmp;
  env.TMP = paths.tmp;
  env.TEMP = paths.tmp;
  env.PICLAW_DB_IN_MEMORY = env.PICLAW_DB_IN_MEMORY ?? "1";

  for (const key of SECRET_ENV_KEYS) delete env[key];
  // Bash/SSH tools inject the entire keychain; none belongs in a test child.
  for (const key of Object.keys(env)) {
    if (/(?:API_KEY|ACCESS_KEY|ACCOUNT_KEY|PRIVATE_KEY|PASSWORD|TOKEN|SECRET|CONNECTION_STRING|_PAT)$/.test(key) || /^(SSH_|GITHUB_|GH_|AZURE_|AWS_|PORTAINER_|PROXMOX_|RESTIC_|MEMENTO_|BORGBACKUPSERVER_)/.test(key)) delete env[key];
  }
  for (const key of DEPLOYMENT_PATH_ENV_KEYS) delete env[key];
  if (e2eSecret) env.PICLAW_E2E_INTERNAL_SECRET = e2eSecret;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned || !createdRoot) return;
    cleaned = true;
    cleanupTestFilesystemIsolationRoot(root);
  };
  if (createdRoot && env === process.env) process.once("exit", cleanup);
  return {
    root,
    workspace, store, data,
    home: paths.home,
    piAgentDir: paths.piAgentDir,
    createdRoot,
    cleanup,
  };
}

export function getActiveTestFilesystemIsolationRoot(env: MutableEnv = process.env): string | null {
  const rootEnv = env[TEST_FS_ISOLATION_ROOT_ENV];
  if (env[TEST_FS_ISOLATION_ACTIVE_ENV] !== "1" || !isSafeRoot(rootEnv)) return null;
  return realpathSync(resolve(rootEnv));
}

/** CLI workspace selection outranks all three environment path overrides. */
export function assertTestWorkspaceArguments(args: readonly string[], env: MutableEnv = process.env): void {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    let path: string | undefined;
    if (arg === "--workspace" || arg === "-w") path = args[++i];
    else if (arg.startsWith("--workspace=") || arg.startsWith("-w=")) path = arg.slice(arg.indexOf("=") + 1);
    else continue;
    if (!path?.trim()) throw new Error("[test-fs-isolation] workspace argument requires an isolated path");
    assertPathWithinTestFilesystemIsolation(path, env, { allowRoot: false });
  }
}

export function assertPathWithinTestFilesystemIsolation(path: string, env: MutableEnv = process.env, options: { readonly allowRoot?: boolean } = {}): void {
  const root = getActiveTestFilesystemIsolationRoot(env);
  if (!root) throw new Error("[test-fs-isolation] test filesystem isolation is not active");
  const resolved = resolve(path);
  assertExistingAncestorsStayWithinRoot(root, resolved);
  if (options.allowRoot === false && resolved === root) {
    throw new Error(`[test-fs-isolation] refusing isolated root as destructive target: ${resolved}`);
  }
}

export function cleanupTestFilesystemIsolationRoot(root: string): void {
  const resolved = resolve(root);
  if (!isSafeRoot(resolved)) return;
  const real = realpathSync(resolved);
  if (!isWithin(safeTempParent(), real)) return;
  assertNoTestMounts(real);
  rmSync(real, { recursive: true, force: true });
}

/** Never walk into an active mount during recursive fixture cleanup. */
export function assertNoTestMounts(path: string, mountInfo?: string): void {
  if (mountInfo === undefined && process.platform !== "linux") return;
  const mounts = mountInfo ?? readFileSync("/proc/self/mountinfo", "utf8");
  for (const line of mounts.split("\n")) {
    const escaped = line.split(" ")[4];
    if (!escaped) continue;
    const mount = escaped.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
    if (isWithin(path, mount)) throw new Error(`[test-fs-isolation] refusing cleanup with active mount: ${mount}`);
  }
}
