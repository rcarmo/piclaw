/**
 * local-lite-prompt-profile – shrink Piclaw's base prompt/tool set for small local models.
 *
 * Hosted models can amortize large static prompts via provider-side prefix caches.
 * Local OpenAI-compatible endpoints often cannot, so this profile keeps startup
 * context to a compact policy digest without changing SDK tool availability.
 */
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  BuildSystemPromptOptions,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getLocalLitePromptProfileEnabled } from "../core/config-tools.js";

const ALWAYS_LOCAL_PROVIDER_IDS = new Set(["llama-cpp", "ollama"]);
const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const PRIVATE_172_SECOND_OCTET_MIN = 16;
const PRIVATE_172_SECOND_OCTET_MAX = 31;
const MAX_CUSTOM_PROMPT_CHARS = 1_500;
const MAX_TOOL_SNIPPET_CHARS = 180;
const MAX_CONTEXT_FILE_PATHS = 8;

export type PromptProfileModel = Pick<Model<Api>, "id" | "name" | "provider" | "baseUrl">;

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(Array.from(values).map((value) => String(value || "").trim()).filter(Boolean))];
}

function truncate(value: string, maxChars: number): string {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function formatDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseHostname(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10
    || (a === 192 && b === 168)
    || (a === 172 && b >= PRIVATE_172_SECOND_OCTET_MIN && b <= PRIVATE_172_SECOND_OCTET_MAX);
}

export function isLocalBaseUrl(baseUrl: unknown): boolean {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) return false;
  const hostname = parseHostname(baseUrl.trim());
  if (!hostname) return false;
  return LOCALHOST_NAMES.has(hostname)
    || hostname.endsWith(".local")
    || isPrivateIpv4(hostname);
}

export function isLocalLitePromptModel(model: Pick<Model<Api>, "provider" | "baseUrl"> | null | undefined): boolean {
  if (!model) return false;
  const provider = normalize(model.provider);
  return ALWAYS_LOCAL_PROVIDER_IDS.has(provider) || isLocalBaseUrl(model.baseUrl);
}

function formatModelLabel(model?: PromptProfileModel): string {
  if (!model) return "unknown local model";
  const provider = model.provider ? `${model.provider}/` : "";
  return `${provider}${model.id || model.name || "unknown"}`;
}

function formatActiveTools(options: BuildSystemPromptOptions): string {
  const selectedTools = unique(options.selectedTools ?? []);
  if (selectedTools.length === 0) return "- No active tools are currently listed.";
  const snippets = options.toolSnippets ?? {};
  return selectedTools
    .map((name) => {
      const snippet = typeof snippets[name] === "string" ? truncate(snippets[name], MAX_TOOL_SNIPPET_CHARS) : "active tool";
      return `- ${name}: ${snippet}`;
    })
    .join("\n");
}

function formatContextFilePointers(options: BuildSystemPromptOptions): string[] {
  const contextFiles = options.contextFiles ?? [];
  if (contextFiles.length === 0) return ["- No context files were loaded."];
  const visible = contextFiles.slice(0, MAX_CONTEXT_FILE_PATHS).map((file) => `- ${file.path}`);
  const remaining = contextFiles.length - visible.length;
  if (remaining > 0) visible.push(`- …and ${remaining} more context file(s)`);
  return visible;
}

export function buildLocalLiteSystemPrompt(
  options: BuildSystemPromptOptions,
  model?: PromptProfileModel,
  date = new Date(),
): string {
  const promptCwd = options.cwd.replace(/\\/g, "/");
  const contextFilePointers = formatContextFilePointers(options);
  const customPrompt = options.customPrompt ? truncate(options.customPrompt, MAX_CUSTOM_PROMPT_CHARS) : "";
  const customPromptSection = customPrompt
    ? [
        "",
        "## Custom prompt digest",
        customPrompt,
      ]
    : [];

  return [
    "You are a concise coding assistant running inside Piclaw's local-lite prompt profile.",
    `Active model: ${formatModelLabel(model)}. Treat this as a small/local model: keep context and output short.`,
    "",
    "## Operating mode",
    "- Prefer direct, short answers and small tool calls.",
    "- If the task needs broad repository context, long chat history, many tools, images, or infrastructure changes, say that a hosted/full-context model or compaction/fresh session is recommended.",
    "- Do not assume omitted skills, memory, or long policy text are unavailable; load them only when needed.",
    "",
    "## Safety and workspace policy digest",
    "- Before code edits, restarts, secrets, or infrastructure work, read the relevant context file(s) listed below, especially AGENTS.md when present.",
    "- Read relevant files before editing; prefer targeted edits; test changes before declaring done.",
    "- Never inline secrets. Use keychain/env-injected references instead.",
    "- Do not restart/reload managed services unless the user explicitly approves it.",
    "- Preserve user/source-like work and unrelated local edits.",
    "",
    "## Active tools",
    formatActiveTools(options),
    "",
    "Tool policy:",
    "- The active tool set is intentionally left to the parent runtime and SDK/optimizer restrictions.",
    "- Keep tool usage narrow and explicit; only ask for or rely on tools that are truly needed for the task.",
    "- Do not assume broad tool access or a reconfigured tool registry is available.",
    "",
    "## Context files available on demand",
    ...contextFilePointers,
    "",
    "## Optional resources",
    "- Skills, workspace memory, integration profiles, UI/widget instructions, and detailed tool docs are available on demand; do not load or quote them unless relevant.",
    "- For generated files the user will want, attach them with attach_file when that tool is active; otherwise tell the user where the file was written.",
    "",
    "## Response formatting",
    "- Use the active chat channel's formatting. In web chats, Markdown tables/bullets are allowed.",
    ...customPromptSection,
    "",
    `Current date: ${formatDate(date)}`,
    `Current working directory: ${promptCwd}`,
  ].join("\n");
}

/** Extension factory that applies local-lite prompt behavior to local models. */
export function createLocalLitePromptProfile(isEnabled = getLocalLitePromptProfileEnabled): ExtensionFactory {
  return function localLitePromptProfile(pi: ExtensionAPI) {
    pi.on("before_agent_start", async (
      event: BeforeAgentStartEvent,
      ctx?: ExtensionContext,
    ): Promise<BeforeAgentStartEventResult | undefined> => {
      const model = ctx?.model as Model<Api> | undefined;
      if (!isEnabled() || !isLocalLitePromptModel(model)) return undefined;
      return {
        systemPrompt: buildLocalLiteSystemPrompt(event.systemPromptOptions, model),
      };
    });
  };
}
export const localLitePromptProfile = createLocalLitePromptProfile();
