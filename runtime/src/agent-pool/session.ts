/**
 * agent-pool/session.ts – pi-agent session creation and directory management.
 *
 * Handles the setup of per-chat agent sessions:
 *   - Creates the session directory under SESSIONS_DIR for each chat JID.
 *   - Configures the resource loader with workspace extensions and skills.
 *   - Uses SessionManager.continueRecent() to resume from the most recent
 *     session tree leaf (conversation context persistence).
 *
 * Consumers:
 *   - agent-pool.ts calls createDefaultSession() to initialise or replace
 *     the agent session for a chat.
 *   - ensureSessionDir() is also used by agent-control/handlers/session.ts.
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { finished } from "stream/promises";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  DefaultResourceLoader,
  type AgentSessionRuntime,
  type AgentSessionServices,
  type ExtensionFactory,
  type SessionStartEvent,
  SessionManager,
  type ModelRuntime,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { createRequire } from "node:module";
import { getPreparedMcpConfig } from "../secure/mcp-keychain.js";
import { getPiclawAgentDir } from "../core/agent-dir.js";
import { SESSIONS_DIR, getRuntimeRoot, getSessionPersistenceConfig, getWorkspaceDir } from "../core/config.js";
import { buildChannelSystemPromptAppendix } from "../channels/formatting.js";
import { detectChannel } from "../router.js";
import { createBuiltinExtensionFactories } from "../extensions/index.js";
import { sanitizePersistedSessionMessage } from "../extensions/persisted-tool-result-sanitizer.js";
import { freezeExtensionRoutes } from "../channels/web/http/extension-routes.js";
import { ensureExtensionNodeModulesLink } from "./session-node-modules-link.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
import type { CompactionStreamFn } from "../extensions/smart-compaction/stream-complete.js";
import { normalizeLlmContext } from "./llm-context-normalizer.js";
import { writeMergedSessionArchive } from "../session-archive.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { createMcpAdapter } = require("pi-mcp-adapter") as {
  createMcpAdapter(options: { config: unknown }): ExtensionFactory;
};
const AGENT_DIR = getPiclawAgentDir();
const EMPTY_STRING_ARRAY: string[] = [];
const BUNDLED_EXTENSION_PATHS_CACHE = new Map<string, string[]>();
const SESSION_PERSISTENCE_CONFIG = getSessionPersistenceConfig();
const SESSION_FILE_PRELOAD_SANITIZE_MIN_BYTES = SESSION_PERSISTENCE_CONFIG.filePreloadSanitizeMinBytes;
const CHANNEL_SYSTEM_PROMPT_APPENDIX_CACHE = new Map<string, string>();
const APPEND_SYSTEM_PROMPT_OVERRIDE_CACHE = new Map<string, (base: string[]) => string[]>();
let cachedExtensionNodeModulesDir: string | null | undefined;
let ensuredExtensionNodeModulesLinkTarget: string | null | undefined;

function ensureValidProcessCwd(): void {
  try {
    if (existsSync(process.cwd())) return;
  } catch (error) {
    debugSuppressedError(log, "Failed to inspect current working directory; resetting to workspace.", error);
  }

  process.chdir(getWorkspaceDir());
}

type AgentSessionCreateOptions = {
  tools: NonNullable<NonNullable<Parameters<typeof createAgentSessionFromServices>[0]>["tools"]>;
  extensionFactories?: ExtensionFactory[];
};

/**
 * Bundled extension paths that are loaded when their activation env vars
 * are present.  The files live inside the piclaw package tree so that
 * node_modules resolution (for @earendil-works/pi-ai internals etc.) works.
 *
 * Because bun may hoist dependencies, we create a node_modules symlink
 * next to the extensions directory pointing to the nearest real
 * node_modules so that jiti's fallback resolution finds packages like
 * @earendil-works/pi-ai and its public API entrypoints.
 */
const EXTENSIONS_DIR = resolve(getRuntimeRoot(resolve(__dirname, "../..")), "extensions");
const log = createLogger("agent-pool.session");

type OptionalBundledExtension = {
  path: string;
  envGate?: string;
  enabled?: () => boolean;
  platforms?: NodeJS.Platform[];
  channels?: string[];
};

const OPTIONAL_EXTENSIONS: OptionalBundledExtension[] = [
  { path: resolve(EXTENSIONS_DIR, "integrations", "azure-openai-session", "index.ts"), envGate: "AOAI_BASE_URL" },
  { path: resolve(EXTENSIONS_DIR, "integrations", "context-mode.ts") },
  { path: resolve(EXTENSIONS_DIR, "integrations", "bun-runner", "index.ts") },
  { path: resolve(EXTENSIONS_DIR, "integrations", "keychain", "index.ts") },
  { path: resolve(EXTENSIONS_DIR, "integrations", "ssh", "index.ts") },
  { path: resolve(EXTENSIONS_DIR, "integrations", "mcp-status-hints", "index.ts") },
  { path: resolve(EXTENSIONS_DIR, "browser", "cdp-browser-tool", "index.ts") },
  { path: resolve(EXTENSIONS_DIR, "platform", "windows", "powershell", "index.ts"), platforms: ["win32"] },
  // win-ui removed: now shipped as @rcarmo/piclaw-addon-win-ui
  // office-viewer-tool removed: now shipped as @rcarmo/piclaw-addon-office-viewer
  // office-tools-tool removed: now shipped as @rcarmo/piclaw-addon-office-tools
];

function getWorkspaceAddonNodeModulesFingerprint(workspaceDir: string): string {
  const addonNodeModulesDir = join(workspaceDir, ".pi", "extensions", "node_modules");
  try {
    const stat = statSync(addonNodeModulesDir);
    if (!stat.isDirectory()) return "missing";
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "missing";
  }
}

function getBundledExtensionEnvSignature(chatJid?: string): string {
  const channel = chatJid ? detectChannel(chatJid) ?? "" : "";
  const workspaceDir = getWorkspaceDir();
  return [
    `platform=${process.platform}`,
    `channel=${channel}`,
    `workspace=${workspaceDir}`,
    `addonNodeModules=${getWorkspaceAddonNodeModulesFingerprint(workspaceDir)}`,
    ...OPTIONAL_EXTENSIONS.map(({ envGate, enabled, platforms, channels }) => {
      const envPart = envGate ? `${envGate}=${process.env[envGate] ? "1" : "0"}` : `enabled=${enabled ? (enabled() ? "1" : "0") : "1"}`;
      const platformPart = platforms?.length ? `platforms=${platforms.join(",")}` : "platforms=all";
      const channelPart = channels?.length ? `channels=${channels.join(",")}` : "channels=all";
      return `${envPart};${platformPart};${channelPart}`;
    }),
  ].join("|");
}

/** Walk up from startDir looking for a node_modules that contains @earendil-works/pi-ai. */
function findNodeModules(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "node_modules");
    if (existsSync(join(candidate, "@earendil-works", "pi-ai"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function getExtensionNodeModulesDir(): string | null {
  if (cachedExtensionNodeModulesDir !== undefined) {
    return cachedExtensionNodeModulesDir;
  }
  cachedExtensionNodeModulesDir = findNodeModules(EXTENSIONS_DIR);
  return cachedExtensionNodeModulesDir;
}

function ensureBundledExtensionNodeModulesLink(nodeModulesDir: string | null): void {
  if (!nodeModulesDir) return;
  if (ensuredExtensionNodeModulesLinkTarget === nodeModulesDir) return;
  ensureExtensionNodeModulesLink(EXTENSIONS_DIR, nodeModulesDir);
  ensuredExtensionNodeModulesLinkTarget = nodeModulesDir;
}

/**
 * Ensure workspace .pi/extensions/ has a node_modules symlink so that jiti can
 * resolve framework-provided packages (e.g. @sinclair/typebox) on cold boot.
 *
 * In non-binary mode, jiti uses `alias` + `tryNative: true` which fails to
 * resolve aliased packages from the workspace extensions directory.  A symlink
 * to the nearest node_modules containing the pi runtime packages is enough to
 * let standard Node module resolution succeed.
 */
let ensuredWorkspaceExtensionLinkKey: string | null = null;
function ensureWorkspaceExtensionNodeModulesLink(nodeModulesDir: string | null): void {
  if (!nodeModulesDir) return;
  const workspaceExtensionsDir = join(getWorkspaceDir(), ".pi", "extensions");
  if (!existsSync(workspaceExtensionsDir)) return;

  const ensureKey = `${workspaceExtensionsDir}=>${nodeModulesDir}`;
  if (ensuredWorkspaceExtensionLinkKey === ensureKey) return;

  ensureExtensionNodeModulesLink(workspaceExtensionsDir, nodeModulesDir);
  ensuredWorkspaceExtensionLinkKey = ensureKey;
}

type AddonPackageManifest = {
  name?: string;
  main?: string;
  pi?: {
    extensions?: string[];
  };
};

function listAddonPackageDirs(addonsNodeModulesDir: string): string[] {
  if (!existsSync(addonsNodeModulesDir)) return EMPTY_STRING_ARRAY;
  const results: string[] = [];
  for (const entry of readdirSync(addonsNodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const entryPath = join(addonsNodeModulesDir, entry.name);
    if (!existsSync(entryPath)) continue; // broken symlink
    if (entry.name.startsWith("@")) {
      try {
        for (const scoped of readdirSync(entryPath, { withFileTypes: true })) {
          if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue;
          const scopedPath = join(entryPath, scoped.name);
          if (existsSync(scopedPath)) results.push(scopedPath);
        }
      } catch (error) {
        debugSuppressedError(log, "Skipping unreadable scoped directory during extension scan.", error, { scopedDir: entryPath });
      }
      continue;
    }
    results.push(entryPath);
  }
  return results;
}

export function getInstalledAddonExtensionPaths(workspaceDir = getWorkspaceDir()): string[] {
  const addonsNodeModulesDir = join(workspaceDir, ".pi", "extensions", "node_modules");
  const extensionPaths: string[] = [];
  for (const packageDir of listAddonPackageDirs(addonsNodeModulesDir)) {
    const packageJsonPath = join(packageDir, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as AddonPackageManifest;
      const declared = Array.isArray(manifest?.pi?.extensions) && manifest.pi?.extensions?.length
        ? manifest.pi.extensions
        : [];
      for (const relativePath of declared) {
        const fullPath = join(packageDir, relativePath);
        if (existsSync(fullPath) && statSync(fullPath).isFile()) extensionPaths.push(fullPath);
      }
    } catch {
      continue;
    }
  }
  return extensionPaths;
}

function getBundledExtensionPaths(chatJid?: string): string[] {
  const cacheKey = getBundledExtensionEnvSignature(chatJid);
  const cached = BUNDLED_EXTENSION_PATHS_CACHE.get(cacheKey);
  if (cached) return cached;

  const channel = chatJid ? detectChannel(chatJid) : undefined;
  const nodeModulesDir = getExtensionNodeModulesDir();
  const paths = OPTIONAL_EXTENSIONS
    .filter(({ envGate, enabled }) => (!envGate || !!process.env[envGate]) && (!enabled || enabled()))
    .filter(({ platforms }) => !platforms || platforms.includes(process.platform))
    .filter(({ channels }) => !channels || !!channel && channels.includes(channel))
    .map(({ path }) => path);
  paths.push(...getInstalledAddonExtensionPaths(getWorkspaceDir()));

  // The MCP adapter is now a programmatic built-in factory so Piclaw can
  // supply the startup-sanitized effective config. The remaining path-loaded
  // extensions still need normal module resolution support.
  if (paths.length > 0) {
    ensureBundledExtensionNodeModulesLink(nodeModulesDir);
    ensureWorkspaceExtensionNodeModulesLink(nodeModulesDir);
  }
  BUNDLED_EXTENSION_PATHS_CACHE.set(cacheKey, paths.length > 0 ? paths : EMPTY_STRING_ARRAY);
  return paths.length > 0 ? paths : EMPTY_STRING_ARRAY;
}

function getChannelSystemPromptAppendix(chatJid?: string): string {
  const channel = chatJid ? detectChannel(chatJid) : undefined;
  const normalizedChatJid = typeof chatJid === "string" && chatJid.trim() ? chatJid.trim() : "";
  const cacheKey = `${channel ?? ""}|${normalizedChatJid}`;
  const cached = CHANNEL_SYSTEM_PROMPT_APPENDIX_CACHE.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const appendix = buildChannelSystemPromptAppendix(channel, normalizedChatJid) ?? "";
  CHANNEL_SYSTEM_PROMPT_APPENDIX_CACHE.set(cacheKey, appendix);
  return appendix;
}

function getAppendSystemPromptOverride(channelSystemPromptAppendix: string): ((base: string[]) => string[]) | undefined {
  if (!channelSystemPromptAppendix) return undefined;
  const cached = APPEND_SYSTEM_PROMPT_OVERRIDE_CACHE.get(channelSystemPromptAppendix);
  if (cached) return cached;
  const appendOverride = (base: string[]) => [...base, channelSystemPromptAppendix];
  APPEND_SYSTEM_PROMPT_OVERRIDE_CACHE.set(channelSystemPromptAppendix, appendOverride);
  return appendOverride;
}

type PersistableSessionMessage = Parameters<SessionManager["appendMessage"]>[0];

function getLatestSessionFile(sessionDir: string): string | null {
  if (!existsSync(sessionDir)) return null;
  const latest = readdirSync(sessionDir)
    .filter((entry) => entry.endsWith(".jsonl"))
    .sort()
    .pop();
  return latest ? join(sessionDir, latest) : null;
}

async function sanitizePersistedSessionFileBeforeLoad(sessionDir: string): Promise<void> {
  const latestFile = getLatestSessionFile(sessionDir);
  if (!latestFile) return;
  let fileSize: number;
  try {
    fileSize = statSync(latestFile).size;
  } catch {
    return;
  }
  if (fileSize < SESSION_FILE_PRELOAD_SANITIZE_MIN_BYTES) return;

  const tempPath = `${latestFile}.sanitizing-${process.pid}-${Date.now()}.tmp`;
  const reader = createInterface({
    input: createReadStream(latestFile, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const writer = createWriteStream(tempPath, { encoding: "utf8" });
  let changedEntries = 0;

  try {
    for await (const line of reader) {
      let output = line;
      try {
        const entry = JSON.parse(line) as { type?: string; message?: PersistableSessionMessage };
        if (entry?.type === "message" && entry.message) {
          const sanitized = sanitizePersistedSessionMessage(entry.message);
          if (sanitized.changed) {
            entry.message = sanitized.message;
            output = JSON.stringify(entry);
            changedEntries += 1;
          }
        }
      } catch (error) {
        debugSuppressedError(log, "Preserving unreadable session persistence line during sanitization.", error, {
          latestFile,
        });
      }
      writer.write(`${output}\n`);
    }
    writer.end();
    await finished(writer);
    if (changedEntries > 0) {
      renameSync(tempPath, latestFile);
    } else {
      rmSync(tempPath, { force: true });
    }
  } catch (error) {
    debugSuppressedError(log, "Failed to sanitize persisted session file before load; removing temp file.", error, {
      latestFile,
      tempPath,
    });
    writer.destroy();
    rmSync(tempPath, { force: true });
    throw new Error(`Failed to sanitize persisted session file before load: ${latestFile}`, { cause: error });
  }
}

/**
 * B2: Trim pre-compaction entries from a session JSONL file before the SDK loads it.
 *
 * When a session has been compacted, entries before `firstKeptEntryId` are not
 * needed for the LLM context. Removing them from the file before the SDK
 * parses it avoids loading 80-95% of session data into the JS heap.
 *
 * The original file is preserved in the archive/ directory for disaster recovery.
 * Only runs on files larger than 512KB to avoid overhead on small sessions.
 */
const TRIM_MIN_BYTES = 512 * 1024;

export function trimPreCompactionEntries(sessionDir: string): void {
  const latestFile = getLatestSessionFile(sessionDir);
  if (!latestFile) return;

  let fileSize: number;
  try {
    fileSize = statSync(latestFile).size;
  } catch (e) {
    void e;
    return;
  }
  if (fileSize < TRIM_MIN_BYTES) return;

  // Read and parse all lines
  let content: string;
  try {
    content = readFileSync(latestFile, "utf8");
  } catch (e) {
    void e;
    return;
  }
  const lines = content.trimEnd().split("\n");
  if (lines.length < 10) return; // too small to bother

  // Find the last compaction entry (scan from end)
  let lastCompLine = -1;
  let compEntry: { type: string; firstKeptEntryId?: string } | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed.type === "compaction" && parsed.firstKeptEntryId) {
        lastCompLine = i;
        compEntry = parsed;
        break;
      }
    } catch (e) { void e; continue; }
  }
  if (!compEntry || lastCompLine < 2) return;

  // Find firstKeptEntryId line index
  let keptIdx = -1;
  for (let i = 0; i < lastCompLine; i++) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed.id === compEntry.firstKeptEntryId) {
        keptIdx = i;
        break;
      }
    } catch (e) { void e; continue; }
  }
  if (keptIdx <= 1) return; // nothing meaningful to trim (0 = header)

  // Carry the active branch's effective model/thinking settings across the
  // destructive boundary. Earendil restores thinking only from surviving
  // thinking_level_change entries; without this, a cold hydration falls back
  // to the instance default and appends that fallback (typically "low") as a
  // real branch change.
  const parsedEntries = lines.map((line) => {
    try { return JSON.parse(line) as any; } catch { return null; }
  });
  const entriesById = new Map<string, any>();
  for (const entry of parsedEntries) {
    if (entry && typeof entry.id === "string") entriesById.set(entry.id, entry);
  }
  let effectiveModel: { provider: string; modelId: string; timestamp?: string } | null = null;
  let effectiveThinking: { thinkingLevel: string; timestamp?: string } | null = null;
  let ancestorId = typeof parsedEntries[keptIdx]?.parentId === "string" ? parsedEntries[keptIdx].parentId : null;
  const visited = new Set<string>();
  while (ancestorId && !visited.has(ancestorId) && (!effectiveModel || !effectiveThinking)) {
    visited.add(ancestorId);
    const ancestor = entriesById.get(ancestorId);
    if (!ancestor) break;
    if (!effectiveThinking && ancestor.type === "thinking_level_change" && typeof ancestor.thinkingLevel === "string") {
      effectiveThinking = { thinkingLevel: ancestor.thinkingLevel, timestamp: ancestor.timestamp };
    }
    if (!effectiveModel && ancestor.type === "model_change" && typeof ancestor.provider === "string" && typeof ancestor.modelId === "string") {
      effectiveModel = { provider: ancestor.provider, modelId: ancestor.modelId, timestamp: ancestor.timestamp };
    } else if (!effectiveModel && ancestor.type === "message" && ancestor.message?.role === "assistant"
      && typeof ancestor.message.provider === "string" && typeof ancestor.message.model === "string") {
      effectiveModel = { provider: ancestor.message.provider, modelId: ancestor.message.model, timestamp: ancestor.timestamp };
    }
    ancestorId = typeof ancestor.parentId === "string" ? ancestor.parentId : null;
  }

  const usedIds = new Set(entriesById.keys());
  const makeCarriedId = (kind: string): string => {
    let suffix = 0;
    let id = `trim-${kind}`;
    while (usedIds.has(id)) id = `trim-${kind}-${++suffix}`;
    usedIds.add(id);
    return id;
  };
  const carriedEntries: any[] = [];
  let carriedParentId: string | null = null;
  if (effectiveModel) {
    const id = makeCarriedId("model");
    carriedEntries.push({
      type: "model_change",
      id,
      parentId: carriedParentId,
      timestamp: effectiveModel.timestamp ?? new Date().toISOString(),
      provider: effectiveModel.provider,
      modelId: effectiveModel.modelId,
    });
    carriedParentId = id;
  }
  if (effectiveThinking) {
    const id = makeCarriedId("thinking");
    carriedEntries.push({
      type: "thinking_level_change",
      id,
      parentId: carriedParentId,
      timestamp: effectiveThinking.timestamp ?? new Date().toISOString(),
      thinkingLevel: effectiveThinking.thinkingLevel,
    });
    carriedParentId = id;
  }

  const retainedEntries = parsedEntries.slice(keptIdx);
  const firstRetained = retainedEntries[0];
  if (carriedParentId && firstRetained && typeof firstRetained === "object") {
    retainedEntries[0] = { ...firstRetained, parentId: carriedParentId };
  }
  const retainedLines = retainedEntries.map((entry, index) => entry ? JSON.stringify(entry) : lines[keptIdx + index]);
  const trimmedLines = [lines[0], ...carriedEntries.map((entry) => JSON.stringify(entry)), ...retainedLines];
  const trimmedContent = trimmedLines.join("\n") + "\n";

  // Only proceed if we actually save meaningful space (>25%)
  if (trimmedContent.length > content.length * 0.75) return;

  // Preserve a cumulative full-history archive before every destructive trim.
  // The active file may already have been trimmed once, so merge its newer
  // entries into the older archive rather than assuming the first snapshot is
  // sufficient forever.
  const archiveDir = join(sessionDir, "archive");
  const fileName = latestFile.split(/[/\\]/).pop()!;
  const archivePath = join(archiveDir, fileName);
  const archiveExisted = existsSync(archivePath);
  try {
    writeMergedSessionArchive(latestFile, archivePath, archiveExisted ? archivePath : undefined);
  } catch (e) {
    void e;
    return; // can't preserve full history, don't trim
  }

  // Write the trimmed file (atomic: write to temp, then rename)
  const tmpPath = `${latestFile}.trim.tmp`;
  try {
    writeFileSync(tmpPath, trimmedContent, "utf8");
    renameSync(tmpPath, latestFile);
    log.info("Trimmed pre-compaction entries from session file before load", {
      operation: "trim_pre_compaction",
      originalEntries: lines.length,
      trimmedEntries: trimmedLines.length,
      originalBytes: content.length,
      trimmedBytes: trimmedContent.length,
      savedPercent: Math.round((1 - trimmedContent.length / content.length) * 100),
      carriedModel: effectiveModel ? `${effectiveModel.provider}/${effectiveModel.modelId}` : null,
      carriedThinkingLevel: effectiveThinking?.thinkingLevel ?? null,
    });
  } catch (err) {
    // Clean up temp file; original latestFile is still intact (we copied,
    // not renamed, and the atomic rename above is all-or-nothing).
    try { rmSync(tmpPath, { force: true }); } catch (e) { void e; }
    // Remove a newly created archive if the matching first trim did not
    // commit. Existing cumulative archives remain valid and must be retained.
    if (!archiveExisted) {
      try { rmSync(archivePath, { force: true }); } catch (e) { void e; }
    }
    debugSuppressedError(log, "Failed to write trimmed session file", err, { latestFile });
  }
}

/** Ensure the session directory exists for a chat and return its path. */
export function ensureSessionDir(chatJid: string): string {
  const chatSessionDir = join(SESSIONS_DIR, sanitiseJid(chatJid));
  mkdirSync(chatSessionDir, { recursive: true });
  return chatSessionDir;
}

/** Ensure a named auxiliary session directory exists for a chat and return its path. */
export function ensureNamedSessionDir(chatJid: string, name: string): string {
  const dir = join(SESSIONS_DIR, `${sanitiseJid(chatJid)}__${sanitiseJid(name)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Create a fully-configured pi-agent session for the given chat.
 * Loads workspace resources (AGENTS.md, skills, extensions, prompt templates)
 * and resumes the most recent session tree.
 */
export function createCompactionStreamFn(modelRuntime: ModelRuntime, settingsManager: SettingsManager): CompactionStreamFn {
  return (model, context, options) => {
    const providerRetrySettings = settingsManager.getProviderRetrySettings();
    return modelRuntime.streamSimple(model, normalizeLlmContext(context), {
      ...options,
      timeoutMs: options?.timeoutMs ?? providerRetrySettings.timeoutMs,
      maxRetries: options?.maxRetries ?? providerRetrySettings.maxRetries,
      maxRetryDelayMs: options?.maxRetryDelayMs ?? providerRetrySettings.maxRetryDelayMs,
    });
  };
}

export async function createSessionInDir(
  sessionDir: string,
  options: {
    modelRuntime: ModelRuntime;
    settingsManager: SettingsManager;
    tools: NonNullable<AgentSessionCreateOptions["tools"]>;
    customTools?: unknown[];
    extensionFactories?: ExtensionFactory[];
    chatJid?: string;
  }
): Promise<AgentSessionRuntime> {
  ensureValidProcessCwd();
  const channelSystemPromptAppendix = getChannelSystemPromptAppendix(options.chatJid);
  const appendSystemPromptOverride = getAppendSystemPromptOverride(channelSystemPromptAppendix);
  const additionalExtensionPaths = getBundledExtensionPaths(options.chatJid);

  const workspaceDir = getWorkspaceDir();
  await sanitizePersistedSessionFileBeforeLoad(sessionDir);
  trimPreCompactionEntries(sessionDir);

  const createRuntime = async ({
    cwd,
    agentDir,
    sessionManager,
    sessionStartEvent,
  }: {
    cwd: string;
    agentDir: string;
    sessionManager: SessionManager;
    sessionStartEvent?: SessionStartEvent;
  }) => {
    const builtinExtensionFactories = [
      ...createBuiltinExtensionFactories({
        compactionStreamFn: createCompactionStreamFn(options.modelRuntime, options.settingsManager),
        modelRuntime: options.modelRuntime,
        chatJid: options.chatJid,
      }),
      createMcpAdapter({ config: getPreparedMcpConfig() }),
    ];
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: options.settingsManager,
      extensionFactories: options.extensionFactories?.length
        ? [...builtinExtensionFactories, ...options.extensionFactories]
        : builtinExtensionFactories,
      additionalExtensionPaths,
      ...(appendSystemPromptOverride ? { appendSystemPromptOverride } : {}),
    });
    await resourceLoader.reload();
    freezeExtensionRoutes();

    const services: AgentSessionServices = {
      cwd,
      agentDir,
      modelRuntime: options.modelRuntime,
      settingsManager: options.settingsManager,
      resourceLoader,
      diagnostics: [],
    };

    const result = await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      // Do not pass `tools` here — pi-coding-agent ≥0.68 treats it as an
      // allowlist that silently blocks every extension tool not listed.
      // The tool-activation extension sets the correct default-active set
      // via its session_start handler instead.
      customTools: options.customTools as any,
    });

    const normalizeResourceDiagnostics = (items: Array<{ path?: string; error?: string }> = []) =>
      items.map((item) => ({
        type: "warning" as const,
        message: item.path ? `${item.path}: ${item.error || "resource diagnostic"}` : (item.error || "resource diagnostic"),
      }));

    const diagnostics = [
      ...normalizeResourceDiagnostics(result.extensionsResult?.errors ?? []),
      ...normalizeResourceDiagnostics(resourceLoader.getSkills().diagnostics ?? []),
      ...normalizeResourceDiagnostics(resourceLoader.getPrompts().diagnostics ?? []),
      ...normalizeResourceDiagnostics(resourceLoader.getThemes().diagnostics ?? []),
    ];
    services.diagnostics = diagnostics;

    // Disable upstream auto-compaction — piclaw manages compaction at safe
    // boundaries via maybeAutoCompactSessionBeforePrompt and recovery paths.
    // Upstream auto-compaction fires at agent_end which can interfere with
    // multi-step tool sequences and break generated file context.
    if (typeof result.session.setAutoCompactionEnabled === "function") {
      result.session.setAutoCompactionEnabled(false);
    }

    return {
      ...result,
      services,
      diagnostics,
    };
  };

  return await createAgentSessionRuntime(createRuntime as any, {
    cwd: workspaceDir,
    agentDir: AGENT_DIR,
    sessionManager: SessionManager.continueRecent(workspaceDir, sessionDir),
  });
}

export async function createDefaultSession(
  chatJid: string,
  options: {
    modelRuntime: ModelRuntime;
    settingsManager: SettingsManager;
    tools: NonNullable<AgentSessionCreateOptions["tools"]>;
    customTools?: unknown[];
    extensionFactories?: ExtensionFactory[];
  }
): Promise<AgentSessionRuntime> {
  const chatSessionDir = ensureSessionDir(chatJid);
  return createSessionInDir(chatSessionDir, {
    ...options,
    chatJid,
  });
}

/**
 * Prime lightweight per-chat startup caches without creating a live runtime.
 * This keeps recent-chat background prewarm cheap while still front-loading
 * deterministic filesystem and extension-resolution work.
 */
export async function lightweightPrewarmSession(
  chatJid: string,
  options: {
    getSessionExtensionFactories?: (chatJid: string) => Promise<ExtensionFactory[]>;
  } = {},
): Promise<void> {
  ensureSessionDir(chatJid);
  const appendix = getChannelSystemPromptAppendix(chatJid);
  void getAppendSystemPromptOverride(appendix);
  void getBundledExtensionPaths(chatJid);
  await options.getSessionExtensionFactories?.(chatJid);
}

/** Replace characters that are unsafe for filesystem paths. */
export function sanitiseJid(jid: string): string {
  return jid.replace(/[^a-zA-Z0-9._-]/g, "_");
}
