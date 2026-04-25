/**
 * agent-pool/runtime-facade.ts – Lightweight runtime/status/control helpers for AgentPool.
 *
 * Extracts session-status lookups, model registry access, slash/control routing,
 * and queued-message mutations so AgentPool can remain a thinner orchestrator.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession, AgentSessionRuntime, ModelRegistry, AuthStorage } from "@mariozechner/pi-coding-agent";

import { applyControlCommand, type AgentControlCommand, type AgentControlResult } from "../agent-control/index.js";
import { formatThinkingLevelForDisplay } from "../agent-control/agent-control-helpers.js";
import { SESSIONS_DIR } from "../core/config.js";
import { detectChannel } from "../router.js";
import { executeSlashCommand } from "./slash-command.js";
import { peekProviderUsage, warmProviderUsage } from "./provider-usage.js";
import { resolveModelLabel } from "../utils/model-utils.js";
import { createLogger } from "../utils/logger.js";
import { withChatContext } from "../core/chat-context.js";
import { sanitiseJid } from "./session.js";
import type { PoolEntry } from "./session-manager.js";

const log = createLogger("agent-pool.runtime-facade");
const persistedModelStateCache = new Map<string, {
  signature: string;
  current: string | null;
  thinkingLevel: string | null;
}>();

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "\u2026";
}

function extractTextPreview(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") return b.text;
  }
  return "";
}

interface PromptEnvelopeMessage {
  sender: string;
  time: string;
  text: string;
}

function getMostRecentSessionFile(sessionDir: string): string | null {
  try {
    const files = readdirSync(sessionDir)
      .filter((entry) => entry.endsWith(".jsonl"))
      .map((entry) => ({ fullPath: join(sessionDir, entry), entry }))
      .map((file) => ({
        ...file,
        mtimeMs: statSync(file.fullPath).mtimeMs,
      }))
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    return files[0]?.fullPath ?? null;
  } catch {
    return null;
  }
}

function getPersistedSessionState(chatJid: string): { current: string | null; thinkingLevel: string | null } {
  const sessionDir = join(SESSIONS_DIR, sanitiseJid(chatJid));
  if (!existsSync(sessionDir)) {
    persistedModelStateCache.delete(chatJid);
    return { current: null, thinkingLevel: null };
  }

  const fullPath = getMostRecentSessionFile(sessionDir);
  if (!fullPath) {
    persistedModelStateCache.delete(chatJid);
    return { current: null, thinkingLevel: null };
  }
  let signature = fullPath;
  try {
    const stat = statSync(fullPath);
    signature = `${fullPath}:${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    persistedModelStateCache.delete(chatJid);
    return { current: null, thinkingLevel: null };
  }

  const cached = persistedModelStateCache.get(chatJid);
  if (cached?.signature === signature) {
    return { current: cached.current, thinkingLevel: cached.thinkingLevel };
  }

  let current: string | null = null;
  let thinkingLevel: string | null = null;
  try {
    const lines = readFileSync(fullPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: any;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (entry?.type === "model_change" && typeof entry.provider === "string" && typeof entry.modelId === "string") {
        current = `${entry.provider}/${entry.modelId}`;
        continue;
      }
      if (entry?.type === "thinking_level_change" && typeof entry.thinkingLevel === "string") {
        thinkingLevel = entry.thinkingLevel;
        continue;
      }
      if (entry?.type === "message" && entry.message?.role === "assistant" && typeof entry.message?.provider === "string" && typeof entry.message?.model === "string") {
        current = `${entry.message.provider}/${entry.message.model}`;
      }
    }
  } catch {
    current = null;
    thinkingLevel = null;
  }

  persistedModelStateCache.set(chatJid, { signature, current, thinkingLevel });
  return { current, thinkingLevel };
}

function parseTranscriptPromptEnvelope(raw: string): PromptEnvelopeMessage[] | null {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized || (!normalized.startsWith("Channel:") && !normalized.startsWith("Messages:") && !/^.+\s@\s.+:\n/m.test(normalized))) {
    return null;
  }

  const lines = normalized.split("\n");
  const messages: PromptEnvelopeMessage[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("Channel:")) {
      index += 1;
      continue;
    }
    if (line === "Messages:") {
      index += 1;
      continue;
    }
    const headerMatch = line.match(/^(.*?)\s@\s(.*?):$/);
    if (!headerMatch) {
      index += 1;
      continue;
    }

    const sender = headerMatch[1].trim();
    const time = headerMatch[2].trim();
    index += 1;
    const bodyLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (!current.trim()) {
        const following = lines[index + 1] || "";
        if (/^.+\s@\s.+:$/.test(following)) {
          index += 1;
          break;
        }
        bodyLines.push("");
        index += 1;
        continue;
      }
      if (/^.+\s@\s.+:$/.test(current) && !current.startsWith("  ")) break;
      bodyLines.push(current.startsWith("  ") ? current.slice(2) : current);
      index += 1;
    }

    messages.push({ sender, time, text: bodyLines.join("\n").trim() });
  }

  return messages.length > 0 ? messages : null;
}

function formatPromptEnvelopePreview(raw: string): { preview: string; rowPreview: string } | null {
  const messages = parseTranscriptPromptEnvelope(raw);
  if (!messages || messages.length === 0) return null;
  const lines = messages.map((message) => {
    const sender = message.sender.trim() || "user";
    const time = message.time.trim();
    const text = message.text.trim();
    const prefix = time ? `${sender} (${time})` : sender;
    return text ? `${prefix}: ${text}` : prefix;
  });
  const preview = lines.join("\n\n").trim();
  const rowPreview = messages.map((message) => message.text.trim()).filter(Boolean).join("\n\n").trim();
  return {
    preview,
    rowPreview: rowPreview || preview,
  };
}

function getToolCallName(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "toolCall" && typeof b.name === "string") return b.name;
  }
  return null;
}

function parseToolArgs(block: Record<string, unknown>): Record<string, unknown> | null {
  // Try all known field names for tool arguments
  for (const key of ["input", "args", "arguments"]) {
    const val = block[key];
    if (!val) continue;
    if (typeof val === "object" && val !== null) return val as Record<string, unknown>;
    if (typeof val === "string") {
      try { const parsed = JSON.parse(val); if (parsed && typeof parsed === "object") return parsed; } catch (err) {
        log.debug("Failed to parse tool arguments JSON.", { err, key, valuePreview: truncateText(val, 120) });
      }
    }
  }
  // Try partialJson field
  if (typeof block.partialJson === "string") {
    try { const parsed = JSON.parse(block.partialJson); if (parsed && typeof parsed === "object") return parsed; } catch (err) {
      log.debug("Failed to parse partial tool JSON.", { err, valuePreview: truncateText(block.partialJson, 120) });
    }
  }
  return null;
}

function formatToolInput(toolName: string, args: Record<string, unknown>): string {
  const trunc = (s: string, max: number) => s.length > max ? s.slice(0, max - 1) + "\u2026" : s;

  switch (toolName) {
    case "bash":
    case "bun_run": {
      const cmd = typeof args.command === "string" ? args.command : null;
      return cmd ? trunc(cmd, 500) : JSON.stringify(args).slice(0, 200);
    }
    case "read":
    case "read_file": {
      let s = typeof args.path === "string" ? args.path : "";
      if (typeof args.offset === "number") s += `:${args.offset}`;
      if (typeof args.limit === "number") s += `-${(args.offset as number || 0) + (args.limit as number)}`;
      return s || JSON.stringify(args).slice(0, 200);
    }
    case "write":
    case "write_file": {
      const p = typeof args.path === "string" ? args.path : "";
      const contentLen = typeof args.content === "string" ? args.content.length : 0;
      return contentLen ? `${p} (${contentLen} chars)` : p || JSON.stringify(args).slice(0, 200);
    }
    case "edit":
    case "edit_file": {
      const p = typeof args.path === "string" ? args.path : (typeof args.file === "string" ? args.file : "");
      const old = typeof args.oldText === "string" ? args.oldText : (typeof args.old_string === "string" ? args.old_string : "");
      if (old) return `${p}  \u2016 ${trunc(old.split("\n")[0], 80)} \u2192 \u2026`;
      return p || JSON.stringify(args).slice(0, 200);
    }
    case "search_workspace":
    case "grep":
    case "rg": {
      const q = typeof args.query === "string" ? args.query : (typeof args.pattern === "string" ? args.pattern : "");
      const p = typeof args.path === "string" ? ` in ${args.path}` : "";
      return q ? `"${trunc(q, 80)}"${p}` : JSON.stringify(args).slice(0, 200);
    }
    case "messages": {
      const action = typeof args.action === "string" ? args.action : "";
      const q = typeof args.query === "string" ? ` "${trunc(args.query, 60)}"` : "";
      return `${action}${q}` || JSON.stringify(args).slice(0, 200);
    }
    case "keychain": {
      const action = typeof args.action === "string" ? args.action : "";
      const name = typeof args.name === "string" ? ` ${args.name}` : "";
      return `${action}${name}` || JSON.stringify(args).slice(0, 200);
    }
    default: {
      // Generic: show key=value pairs, skip large values
      const parts: string[] = [];
      for (const [k, v] of Object.entries(args)) {
        if (typeof v === "string" && v.length > 120) {
          parts.push(`${k}: ${trunc(v.split("\n")[0], 80)}`);
        } else if (typeof v === "string") {
          parts.push(`${k}: ${v}`);
        } else {
          parts.push(`${k}: ${JSON.stringify(v).slice(0, 60)}`);
        }
      }
      return trunc(parts.join(", "), 500);
    }
  }
}

function formatToolInputFull(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "bash":
    case "bun_run":
      return typeof args.command === "string" ? args.command : JSON.stringify(args, null, 2);
    case "read":
    case "read_file": {
      let s = typeof args.path === "string" ? args.path : "";
      if (typeof args.offset === "number") s += `:${args.offset}`;
      if (typeof args.limit === "number") s += `-${(args.offset as number || 0) + (args.limit as number)}`;
      return s || JSON.stringify(args, null, 2);
    }
    case "write":
    case "write_file": {
      const p = typeof args.path === "string" ? args.path : "";
      const content = typeof args.content === "string" ? args.content : "";
      return content ? `${p}\n\n${content}` : p || JSON.stringify(args, null, 2);
    }
    case "edit":
    case "edit_file": {
      const p = typeof args.path === "string" ? args.path : (typeof args.file === "string" ? args.file : "");
      const old = typeof args.oldText === "string" ? args.oldText : (typeof args.old_string === "string" ? args.old_string : "");
      const nw = typeof args.newText === "string" ? args.newText : (typeof args.new_string === "string" ? args.new_string : "");
      const edits = Array.isArray(args.edits) ? args.edits : null;
      if (edits) {
        return `${p}\n\n${edits.map((e: any, i: number) => `[${i + 1}] - ${e.oldText || e.old_string || ''}\n    + ${e.newText || e.new_string || ''}`).join('\n')}`;
      }
      if (old || nw) return `${p}\n\n- ${old}\n+ ${nw}`;
      return p || JSON.stringify(args, null, 2);
    }
    default:
      return JSON.stringify(args, null, 2);
  }
}

function getToolCallInput(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "toolCall") continue;
    const toolName = typeof b.name === "string" ? b.name : "";
    const args = parseToolArgs(b);
    if (args) return formatToolInput(toolName, args);
  }
  return null;
}

function getToolCallInputFull(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "toolCall") continue;
    const toolName = typeof b.name === "string" ? b.name : "";
    const args = parseToolArgs(b);
    if (args) return formatToolInputFull(toolName, args);
  }
  return null;
}

function getEntryMeta(entry: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  if (entry.type !== "message") return meta;
  const msg = (entry.message && typeof entry.message === "object")
    ? (entry.message as Record<string, unknown>)
    : {};
  const role = typeof msg.role === "string" ? msg.role : null;
  if (role) meta.role = role;
  if (role === "toolResult" && typeof msg.toolName === "string") meta.toolName = msg.toolName;
  const toolCallName = getToolCallName(msg.content);
  if (toolCallName) meta.toolName = toolCallName;
  // Tool call input (compact for row, full for sidebar)
  const toolInput = getToolCallInput(msg.content);
  if (toolInput) meta.toolInput = toolInput;
  const toolInputFull = getToolCallInputFull(msg.content);
  if (toolInputFull) meta.toolInputFull = toolInputFull;
  const text = extractTextPreview(msg.content);
  if (text) {
    const promptEnvelopePreview = role === "user" ? formatPromptEnvelopePreview(text) : null;
    if (promptEnvelopePreview) {
      meta.contentLength = promptEnvelopePreview.preview.length;
      meta.detail = promptEnvelopePreview.preview;
      meta.previewText = promptEnvelopePreview.rowPreview;
      meta.rawDetail = text;
      meta.rawContentLength = text.length;
    } else {
      meta.contentLength = text.length;
      meta.detail = text;
    }
  }
  const thinking = (msg as any).thinking;
  if (thinking) {
    const thinkingText = typeof thinking === "string" ? thinking : extractTextPreview(thinking);
    if (thinkingText && thinkingText.length > 0) {
      meta.hasThinking = true;
      meta.thinkingLength = thinkingText.length;
    }
  }
  return meta;
}

function describeTreeEntry(entry: Record<string, unknown>): string {
  switch (entry.type) {
    case "message": {
      const msg = (entry.message && typeof entry.message === "object")
        ? (entry.message as Record<string, unknown>)
        : {};
      const role = typeof msg.role === "string" ? msg.role : "message";
      if (role === "toolResult") {
        const toolName = typeof msg.toolName === "string" ? msg.toolName : "tool";
        return `toolResult: ${toolName}`;
      }
      const text = extractTextPreview(msg.content);
      if (text) {
        const promptEnvelopePreview = role === "user" ? formatPromptEnvelopePreview(text) : null;
        const previewText = promptEnvelopePreview?.rowPreview || text;
        return `${role}: \"${truncateText(previewText, 80)}\"`;
      }
      const toolCallName = getToolCallName(msg.content);
      if (toolCallName) return `${role}: [tool ${toolCallName}]`;
      return role;
    }
    case "compaction":
      return `[compaction]`;
    case "branch_summary":
      return `[branch summary]`;
    case "thinking_level_change":
      return `[thinking ${entry.thinkingLevel}]`;
    case "model_change":
      return `[model ${entry.provider}/${entry.modelId}]`;
    case "label":
      return `[label ${entry.label || "clear"}]`;
    case "session_info":
      return `[session ${entry.name || "(unnamed)"}]`;
  }
  return "[entry]";
}

/** Structured model option returned to the web model picker. */
export interface AvailableModelOption {
  label: string;
  provider: string;
  id: string;
  name: string | null;
  context_window: number | null;
  reasoning: boolean;
}

/** Shape returned by available-model inspection. */
export interface AvailableModelsResult {
  current: string | null;
  models: string[];
  model_options: AvailableModelOption[];
  thinking_level: string | null;
  thinking_level_label: string | null;
  supports_thinking: boolean;
  available_thinking_levels: string[];
  provider_usage: Awaited<ReturnType<typeof warmProviderUsage>>;
}

/** Dependencies required by AgentRuntimeFacade. */
export interface AgentRuntimeFacadeOptions {
  pool: Map<string, PoolEntry>;
  getOrCreateRuntime: (chatJid: string) => Promise<AgentSessionRuntime>;
  modelRegistry: ModelRegistry;
  authStorage: AuthStorage;
  clearAttachments: (chatJid: string) => void;
  refreshRuntime: (chatJid: string, runtime: AgentSessionRuntime) => Promise<void>;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
  onError?: (message: string, details: Record<string, unknown>) => void;
  applyControlCommandFn?: typeof applyControlCommand;
  executeSlashCommandFn?: typeof executeSlashCommand;
}

/**
 * Provides session-runtime helpers that do not belong in the core prompt loop.
 */
export class AgentRuntimeFacade {
  constructor(private readonly options: AgentRuntimeFacadeOptions) {}

  async applyControlCommand(chatJid: string, command: AgentControlCommand): Promise<AgentControlResult> {
    const runtime = await this.options.getOrCreateRuntime(chatJid);
    const session = runtime.session;
    const channel = detectChannel(chatJid);
    const apply = this.options.applyControlCommandFn ?? applyControlCommand;
    const result = await withChatContext(chatJid, channel, () => apply(runtime, this.options.modelRegistry, command));
    if (result.refresh_runtime || runtime.session !== session) {
      await this.options.refreshRuntime(chatJid, runtime);
    }
    return result;
  }

  async getCurrentModelLabel(chatJid: string): Promise<string | null> {
    const session = (await this.options.getOrCreateRuntime(chatJid)).session;
    const model = session.model;
    return model ? `${model.provider}/${model.id}` : null;
  }

  async getAvailableModels(chatJid: string): Promise<AvailableModelsResult> {
    // Passive UI refreshes should not hydrate a cold runtime just to render
    // model state for the picker.
    const session = this.options.pool.get(chatJid)?.runtime.session ?? null;
    const persistedState = session ? { current: null, thinkingLevel: null } : getPersistedSessionState(chatJid);
    const registry = (session as (AgentSession & { modelRegistry?: ModelRegistry }) | null)?.modelRegistry ?? this.options.modelRegistry;
    registry.refresh();
    const available = registry.getAvailable();
    const modelOptions = available.map((model) => ({
      label: `${model.provider}/${model.id}`,
      provider: model.provider,
      id: model.id,
      name: typeof model.name === "string" && model.name.trim() ? model.name.trim() : null,
      context_window: typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow) && model.contextWindow > 0
        ? model.contextWindow
        : null,
      reasoning: Boolean(model.reasoning),
    }));
    const models = modelOptions.map((model) => model.label);
    const currentModel = session?.model ? `${session.model.provider}/${session.model.id}` : persistedState.current;
    const currentModelOption = currentModel ? modelOptions.find((model) => model.label === currentModel) ?? null : null;
    const thinkingLevel = session?.thinkingLevel ?? persistedState.thinkingLevel ?? null;
    const supportsThinking = session && typeof (session as AgentSession & { supportsThinking?: () => boolean }).supportsThinking === "function"
      ? (session as AgentSession & { supportsThinking: () => boolean }).supportsThinking()
      : Boolean(session?.model?.reasoning ?? currentModelOption?.reasoning);
    const availableThinkingLevels: string[] = session && typeof (session as AgentSession & { getAvailableThinkingLevels?: () => string[] }).getAvailableThinkingLevels === "function"
      ? (session as AgentSession & { getAvailableThinkingLevels: () => string[] }).getAvailableThinkingLevels()
      : supportsThinking ? ["off", "minimal", "low", "medium", "high"] : ["off"];
    const providerUsage = session?.model?.provider
      ? (peekProviderUsage(session.model.provider, { allowStale: true }) ?? null)
      : currentModelOption?.provider
        ? (peekProviderUsage(currentModelOption.provider, { allowStale: true }) ?? null)
        : null;
    const activeProvider = session?.model?.provider ?? currentModelOption?.provider ?? null;
    if (activeProvider) {
      void warmProviderUsage(this.options.authStorage, activeProvider);
    }
    const thinkingProvider = session?.model?.provider ?? currentModelOption?.provider ?? null;
    const thinkingLevelLabel = thinkingLevel && thinkingProvider
      ? formatThinkingLevelForDisplay(thinkingLevel, thinkingProvider)
      : thinkingLevel;
    return {
      current: currentModel,
      models,
      model_options: modelOptions,
      thinking_level: thinkingLevel,
      thinking_level_label: thinkingLevelLabel,
      supports_thinking: supportsThinking,
      available_thinking_levels: availableThinkingLevels,
      provider_usage: providerUsage,
    };
  }

  getContextUsageForChat(chatJid: string): {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  } | null {
    const entry = this.options.pool.get(chatJid);
    if (!entry) return null;
    return entry.runtime.session.getContextUsage() ?? null;
  }

  getSessionTreeForChat(chatJid: string): { leafId: string | null; nodes: unknown[]; flat: true; total: number } | null {
    const entry = this.options.pool.get(chatJid);
    if (!entry) return null;
    const sm = entry.runtime.session.sessionManager;
    const leafId = sm.getLeafId();
    const roots = sm.getTree();
    // Iterative DFS to avoid stack overflow on deep linear chains
    const flatNodes: unknown[] = [];
    const stack: any[] = [];
    for (let i = roots.length - 1; i >= 0; i--) stack.push(roots[i]);
    while (stack.length > 0) {
      const node = stack.pop()!;
      flatNodes.push({
        id: node.entry.id,
        parentId: node.entry.parentId ?? null,
        type: node.entry.type,
        timestamp: node.entry.timestamp,
        label: node.label ?? null,
        active: node.entry.id === leafId,
        preview: describeTreeEntry(node.entry),
        childCount: (node.children || []).length,
        ...getEntryMeta(node.entry as Record<string, unknown>),
      });
      const children = node.children || [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
    return { leafId, nodes: flatNodes, flat: true, total: flatNodes.length };
  }

  async saveSessionPosition(chatJid: string): Promise<string | null> {
    const session = (await this.options.getOrCreateRuntime(chatJid)).session;
    return session.sessionManager.getLeafId();
  }

  async restoreSessionPosition(chatJid: string, leafId: string | null): Promise<void> {
    if (leafId === null) return;
    const session = (await this.options.getOrCreateRuntime(chatJid)).session;
    const currentLeaf = session.sessionManager.getLeafId();
    if (currentLeaf === leafId) return;
    try {
      await session.navigateTree(leafId);
    } catch (err) {
      this.options.onError?.("Failed to restore session position", {
        operation: "restore_session_position",
        chatJid,
        leafId,
        err,
      });
    }
  }

  hasProviderModels(provider: string): boolean {
    return this.options.modelRegistry.getAll().some((model) => model.provider === provider);
  }

  registerModelProvider(providerName: string, config: Parameters<ModelRegistry["registerProvider"]>[1]): void {
    this.options.modelRegistry.registerProvider(providerName, config);
  }

  resolveModelInput(input: string): { model?: string; error?: string } {
    return resolveModelLabel(this.options.modelRegistry, input);
  }

  isStreaming(chatJid: string): boolean {
    return this.options.pool.get(chatJid)?.runtime.session.isStreaming ?? false;
  }

  isActive(chatJid: string): boolean {
    const session = this.options.pool.get(chatJid)?.runtime.session;
    if (!session) return false;
    return Boolean(session.isStreaming || session.isCompacting || session.isRetrying || session.isBashRunning);
  }

  async queueStreamingMessage(
    chatJid: string,
    text: string,
    behavior: "steer" | "followUp",
  ): Promise<{ queued: boolean; error?: string }> {
    const session = (await this.options.getOrCreateRuntime(chatJid)).session;
    if (!session.isStreaming) return { queued: false };

    const channel = detectChannel(chatJid);
    try {
      return await withChatContext(chatJid, channel, async () => {
        await session.prompt(text, { streamingBehavior: behavior });
        return { queued: true };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { queued: false, error: message };
    }
  }

  async removeQueuedFollowupMessage(chatJid: string, queuedContent?: string): Promise<boolean> {
    const session = (await this.options.getOrCreateRuntime(chatJid)).session;
    if (!session.isStreaming) return false;

    const followups = [...session.getFollowUpMessages()];
    if (followups.length === 0) return false;

    const normalized = typeof queuedContent === "string" ? queuedContent.trim() : "";
    let removeIndex = -1;
    if (normalized) {
      removeIndex = followups.findIndex((item) => item === queuedContent || item.trim() === normalized);
    }
    if (removeIndex < 0) removeIndex = 0;

    const channel = detectChannel(chatJid);
    try {
      return await withChatContext(chatJid, channel, async () => {
        const cleared = session.clearQueue();
        const nextFollowups = cleared.followUp.filter((_, idx) => idx !== removeIndex);

        try {
          await this.restoreQueuedMessages(session, cleared.steering, nextFollowups);
        } catch (err) {
          try {
            session.clearQueue();
            await this.restoreQueuedMessages(session, cleared.steering, cleared.followUp);
          } catch (restoreErr) {
            this.options.onWarn?.("Failed to restore queued follow-up after removal error", {
              operation: "remove_queued_follow_up.restore",
              chatJid,
              err: restoreErr,
              originalError: err,
            });
          }
          throw err;
        }

        return true;
      });
    } catch (err) {
      this.options.onWarn?.("Failed to remove queued follow-up", {
        operation: "remove_queued_follow_up",
        chatJid,
        err,
      });
      return false;
    }
  }

  private async restoreQueuedMessages(
    session: { prompt: (text: string, options?: { streamingBehavior?: "steer" | "followUp" }) => Promise<unknown> },
    steering: readonly string[],
    followUp: readonly string[],
  ): Promise<void> {
    for (const steer of steering) {
      await session.prompt(steer, { streamingBehavior: "steer" });
    }
    for (const queued of followUp) {
      await session.prompt(queued, { streamingBehavior: "followUp" });
    }
  }

  async applySlashCommand(chatJid: string, rawText: string): Promise<AgentControlResult> {
    this.options.clearAttachments(chatJid);
    const runtime = await this.options.getOrCreateRuntime(chatJid);
    const session = runtime.session;
    const channel = detectChannel(chatJid);
    const exec = this.options.executeSlashCommandFn ?? executeSlashCommand;
    const result = await withChatContext(chatJid, channel, () => exec(session, chatJid, rawText));
    if (result.refresh_runtime || runtime.session !== session) {
      await this.options.refreshRuntime(chatJid, runtime);
    }
    this.options.clearAttachments(chatJid);
    return result;
  }
}
