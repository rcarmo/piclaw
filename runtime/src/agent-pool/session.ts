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

import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { finished } from "stream/promises";
import {
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type ExtensionFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
  type AuthStorage,
  type ModelRegistry,
  type SettingsManager,
} from "@mariozechner/pi-coding-agent";

import { SESSIONS_DIR, WORKSPACE_DIR } from "../core/config.js";
import { buildChannelSystemPromptAppendix } from "../channels/formatting.js";
import { detectChannel } from "../router.js";
import { builtinExtensionFactories } from "../extensions/index.js";
import { bindImmediateToolActivation } from "./tool-activation-live-update.js";
import { ensureExtensionNodeModulesLink } from "./session-node-modules-link.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = getAgentDir();
const EMPTY_STRING_ARRAY: string[] = [];
const BUNDLED_EXTENSION_PATHS_CACHE = new Map<string, string[]>();
const SESSION_TOOL_RESULT_MAX_PERSIST_BYTES = parsePositiveInt(
  process.env.PICLAW_SESSION_TOOL_RESULT_MAX_PERSIST_BYTES,
  256 * 1024,
);
const SESSION_FILE_PRELOAD_SANITIZE_MIN_BYTES = parsePositiveInt(
  process.env.PICLAW_SESSION_FILE_PRELOAD_SANITIZE_MIN_BYTES,
  1024 * 1024,
);
const SESSION_TOOL_RESULT_PREVIEW_CHARS = parsePositiveInt(
  process.env.PICLAW_SESSION_TOOL_RESULT_PREVIEW_CHARS,
  4096,
);
const CHANNEL_SYSTEM_PROMPT_APPENDIX_CACHE = new Map<string, string>();
const APPEND_SYSTEM_PROMPT_OVERRIDE_CACHE = new Map<string, (base: string[]) => string[]>();
let cachedExtensionNodeModulesDir: string | null | undefined;
let ensuredExtensionNodeModulesLinkTarget: string | null | undefined;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getWorkspaceDir(): string {
  return process.env.PICLAW_WORKSPACE || WORKSPACE_DIR;
}

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
 * node_modules resolution (for @mariozechner/pi-ai internals etc.) works.
 *
 * Because bun may hoist dependencies, we create a node_modules symlink
 * next to the extensions directory pointing to the nearest real
 * node_modules so that jiti's fallback resolution finds packages like
 * @mariozechner/pi-ai/dist/providers/*.
 */
const EXTENSIONS_DIR = resolve(__dirname, "../../extensions");
const log = createLogger("agent-pool.session");

type OptionalBundledExtension = {
  path: string;
  envGate?: string;
  platforms?: NodeJS.Platform[];
  channels?: string[];
};

const OPTIONAL_EXTENSIONS: OptionalBundledExtension[] = [
  { path: resolve(EXTENSIONS_DIR, "integrations", "azure-openai-session", "index.ts"), envGate: "AOAI_BASE_URL" },
  { path: resolve(EXTENSIONS_DIR, "integrations", "context-mode.ts") },
  { path: resolve(EXTENSIONS_DIR, "integrations", "bun-runner", "index.ts") },
  { path: resolve(EXTENSIONS_DIR, "integrations", "keychain", "index.ts") },
  { path: resolve(EXTENSIONS_DIR, "integrations", "ssh", "index.ts") },
  { path: resolve(EXTENSIONS_DIR, "integrations", "proxmox", "index.ts") },
  { path: resolve(EXTENSIONS_DIR, "integrations", "portainer", "index.ts") },
  { path: resolve(EXTENSIONS_DIR, "integrations", "mcp-status-hints", "index.ts") },
  { path: resolve(EXTENSIONS_DIR, "browser", "cdp-browser-tool", "index.ts") },
  { path: resolve(EXTENSIONS_DIR, "platform", "windows", "powershell", "index.ts"), platforms: ["win32"] },
  { path: resolve(EXTENSIONS_DIR, "platform", "windows", "win-ui", "index.ts"), platforms: ["win32"] },
  { path: resolve(EXTENSIONS_DIR, "viewers", "office-viewer-tool", "index.ts"), channels: ["web"] },
  { path: resolve(EXTENSIONS_DIR, "integrations", "office-tools-tool", "index.ts") },
  { path: resolve(EXTENSIONS_DIR, "viewers", "drawio-editor-tool", "index.ts"), channels: ["web"] },
  { path: resolve(EXTENSIONS_DIR, "experimental", "m365", "index.ts"), envGate: "PICLAW_ENABLE_M365_EXPERIMENTAL" },
];

const PACKAGED_EXTENSION_ENTRIES = [
  { packageName: "pi-mcp-adapter", entry: "index.ts" },
] as const;

function getBundledExtensionEnvSignature(chatJid?: string): string {
  const channel = chatJid ? detectChannel(chatJid) ?? "" : "";
  return [
    `platform=${process.platform}`,
    `channel=${channel}`,
    ...OPTIONAL_EXTENSIONS.map(({ envGate, platforms, channels }) => {
      const envPart = envGate ? `${envGate}=${process.env[envGate] ? "1" : "0"}` : "always=1";
      const platformPart = platforms?.length ? `platforms=${platforms.join(",")}` : "platforms=all";
      const channelPart = channels?.length ? `channels=${channels.join(",")}` : "channels=all";
      return `${envPart};${platformPart};${channelPart}`;
    }),
  ].join("|");
}

/** Walk up from startDir looking for a node_modules that contains @mariozechner/pi-ai. */
function findNodeModules(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "node_modules");
    if (existsSync(join(candidate, "@mariozechner", "pi-ai"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolvePackagedExtensionEntries(nodeModulesDir: string | null): string[] {
  if (!nodeModulesDir) return EMPTY_STRING_ARRAY;

  const resolved: string[] = [];
  for (const candidate of PACKAGED_EXTENSION_ENTRIES) {
    const entryPath = join(nodeModulesDir, candidate.packageName, candidate.entry);
    if (existsSync(entryPath)) {
      resolved.push(entryPath);
    }
  }
  return resolved;
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
let ensuredWorkspaceExtensionLink = false;
function ensureWorkspaceExtensionNodeModulesLink(nodeModulesDir: string | null): void {
  if (!nodeModulesDir) return;
  if (ensuredWorkspaceExtensionLink) return;
  const workspaceExtensionsDir = join(getWorkspaceDir(), ".pi", "extensions");
  if (existsSync(workspaceExtensionsDir)) {
    ensureExtensionNodeModulesLink(workspaceExtensionsDir, nodeModulesDir);
  }
  ensuredWorkspaceExtensionLink = true;
}

function getBundledExtensionPaths(chatJid?: string): string[] {
  const cacheKey = getBundledExtensionEnvSignature(chatJid);
  const cached = BUNDLED_EXTENSION_PATHS_CACHE.get(cacheKey);
  if (cached) return cached;

  const channel = chatJid ? detectChannel(chatJid) : undefined;
  const nodeModulesDir = getExtensionNodeModulesDir();
  const paths = OPTIONAL_EXTENSIONS
    .filter(({ envGate }) => !envGate || !!process.env[envGate])
    .filter(({ platforms }) => !platforms || platforms.includes(process.platform))
    .filter(({ channels }) => !channels || !!channel && channels.includes(channel))
    .map(({ path }) => path);
  paths.push(...resolvePackagedExtensionEntries(nodeModulesDir));
  if (paths.length === 0) {
    BUNDLED_EXTENSION_PATHS_CACHE.set(cacheKey, EMPTY_STRING_ARRAY);
    return EMPTY_STRING_ARRAY;
  }

  // Ensure a node_modules symlink exists next to the extensions dir
  // so jiti can resolve deep package imports.
  ensureBundledExtensionNodeModulesLink(nodeModulesDir);
  ensureWorkspaceExtensionNodeModulesLink(nodeModulesDir);
  BUNDLED_EXTENSION_PATHS_CACHE.set(cacheKey, paths);
  return paths;
}

function getChannelSystemPromptAppendix(chatJid?: string): string {
  const channel = chatJid ? detectChannel(chatJid) : undefined;
  const cacheKey = channel ?? "";
  const cached = CHANNEL_SYSTEM_PROMPT_APPENDIX_CACHE.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const appendix = buildChannelSystemPromptAppendix(channel) ?? "";
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

type PersistedToolResultSanitizeResult = {
  message: PersistableSessionMessage;
  changed: boolean;
};

function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function truncatePreview(text: string, maxChars = SESSION_TOOL_RESULT_PREVIEW_CHARS): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.max(0, maxChars - 120));
  const omitted = text.length - head.length;
  return `${head}\n\n[... omitted ${omitted} chars for persisted session size ...]`;
}

function sanitizePersistedSessionMessage(message: PersistableSessionMessage): PersistedToolResultSanitizeResult {
  if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "toolResult") {
    return { message, changed: false };
  }

  const toolResultMessage = message as unknown as { content?: unknown; toolName?: string };
  const baseMessage = message as unknown as Record<string, unknown>;
  const serializedSize = Buffer.byteLength(JSON.stringify(message));
  const originalContent = Array.isArray(toolResultMessage.content)
    ? ([...toolResultMessage.content] as Array<Record<string, unknown> | null | undefined>)
    : null;

  let changed = false;
  let removedImageBlocks = 0;
  let removedImageBytes = 0;
  let previewText = "";
  const sanitizedContent: Array<Record<string, unknown>> = [];

  if (originalContent) {
    for (const block of originalContent) {
      if (!block || typeof block !== "object") {
        continue;
      }
      if (block.type === "image") {
        removedImageBlocks += 1;
        if (typeof block.data === "string") removedImageBytes += block.data.length;
        changed = true;
        continue;
      }
      if (!previewText && block.type === "text" && typeof block.text === "string") {
        previewText = block.text;
      }
      sanitizedContent.push(block);
    }
  }

  if (removedImageBlocks > 0) {
    const mimeTypes = originalContent
      ?.filter((block): block is Record<string, unknown> => !!block && typeof block === "object")
      .filter((block) => block.type === "image" && typeof block.mimeType === "string")
      .map((block) => String(block.mimeType)) ?? [];
    sanitizedContent.push({
      type: "text",
      text: `[Persisted tool result sanitized: removed ${removedImageBlocks} inline image block${removedImageBlocks === 1 ? "" : "s"}${mimeTypes.length ? ` (${Array.from(new Set(mimeTypes)).join(", ")})` : ""} totalling ~${formatBytes(removedImageBytes)}.]`,
    });
  }

  let sanitizedMessage: PersistableSessionMessage = changed
    ? ({ ...baseMessage, content: sanitizedContent } as unknown as PersistableSessionMessage)
    : message;

  const sanitizedSize = Buffer.byteLength(JSON.stringify(sanitizedMessage));
  if (sanitizedSize > SESSION_TOOL_RESULT_MAX_PERSIST_BYTES) {
    const fallbackPreview = truncatePreview(previewText || `Tool result for ${toolResultMessage.toolName || "tool"}.`);
    sanitizedMessage = {
      ...baseMessage,
      content: [{
        type: "text",
        text: `${fallbackPreview}\n\n[Persisted tool result truncated from ${formatBytes(serializedSize)} to stay within the ${formatBytes(SESSION_TOOL_RESULT_MAX_PERSIST_BYTES)} session-entry budget.]`,
      }],
    } as unknown as PersistableSessionMessage;
    changed = true;
  }

  return { message: sanitizedMessage, changed };
}

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
  let fileSize = 0;
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
  let writtenBytes = 0;

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
      writtenBytes += Buffer.byteLength(output) + 1;
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
    throw new Error(`Failed to sanitize persisted session file before load: ${latestFile}`);
  }
}

function installPersistedToolResultSanitizer(runtime: AgentSessionRuntime): void {
  const sessionManager = runtime.session.sessionManager as SessionManager & {
    __piclawPersistedToolResultSanitizerInstalled?: boolean;
    appendMessage: (message: PersistableSessionMessage) => string;
  };
  if (sessionManager.__piclawPersistedToolResultSanitizerInstalled) return;
  const originalAppendMessage = sessionManager.appendMessage.bind(sessionManager);
  sessionManager.appendMessage = ((message: PersistableSessionMessage) => {
    const sanitized = sanitizePersistedSessionMessage(message);
    return originalAppendMessage(sanitized.message);
  }) as typeof sessionManager.appendMessage;
  sessionManager.__piclawPersistedToolResultSanitizerInstalled = true;
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
export async function createSessionInDir(
  sessionDir: string,
  options: {
    authStorage: AuthStorage;
    modelRegistry: ModelRegistry;
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

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir: AGENT_DIR,
      authStorage: options.authStorage,
      modelRegistry: options.modelRegistry,
      settingsManager: options.settingsManager,
      resourceLoaderOptions: {
        extensionFactories: options.extensionFactories?.length
          ? [...builtinExtensionFactories, ...options.extensionFactories]
          : builtinExtensionFactories,
        additionalExtensionPaths,
        ...(appendSystemPromptOverride ? { appendSystemPromptOverride } : {}),
      },
    });

    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        tools: options.tools,
        customTools: options.customTools as any,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const workspaceDir = getWorkspaceDir();
  await sanitizePersistedSessionFileBeforeLoad(sessionDir);
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: workspaceDir,
    agentDir: AGENT_DIR,
    sessionManager: SessionManager.continueRecent(workspaceDir, sessionDir),
  });

  installPersistedToolResultSanitizer(runtime);
  bindImmediateToolActivation(runtime.session as any);
  return runtime;
}

export async function createDefaultSession(
  chatJid: string,
  options: {
    authStorage: AuthStorage;
    modelRegistry: ModelRegistry;
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
