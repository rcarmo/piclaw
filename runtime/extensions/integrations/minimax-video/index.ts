import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { extname, join } from "node:path";

const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_TASK_TIMEOUT_MS = 15 * 60_000;
const API_REQUEST_TIMEOUT_MS = 30_000;
const VIDEO_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const MAX_VIDEO_BYTES = 256 * 1024 * 1024;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type MiniMaxVideoArgs = {
  prompt: string;
  duration?: 6 | 10;
  resolution?: "720P" | "768P" | "1080P";
  promptOptimizer?: boolean;
};

export type MiniMaxVideoConfig = {
  apiKey: string;
  baseUrl: string;
  modelId: string;
};

export type SavedVideoFile = {
  absPath: string;
  relPath: string;
  rawUrl: string;
};

type MiniMaxVideoMessenger = Pick<ExtensionAPI, "sendMessage">;

type MiniMaxBaseResponse = {
  status_code?: number;
  status_msg?: string;
};

type CreateVideoResponse = {
  task_id?: string | number;
  base_resp?: MiniMaxBaseResponse;
};

type QueryVideoResponse = {
  status?: string;
  file_id?: string | number;
  base_resp?: MiniMaxBaseResponse;
};

type RetrieveFileResponse = {
  file?: { download_url?: string };
  base_resp?: MiniMaxBaseResponse;
};

type MiniMaxVideoHandlers = {
  fetch: FetchLike;
  sleep: (milliseconds: number) => Promise<void>;
  saveVideo: (downloadUrl: string) => Promise<SavedVideoFile>;
};

class MiniMaxVideoUsageError extends Error {}

function parseOptionValue(tokens: string[], index: number, option: string): string {
  const value = tokens[index + 1];
  if (!value || value.startsWith("--")) {
    throw new MiniMaxVideoUsageError(`${option} requires a value.`);
  }
  return value;
}

export function parseMiniMaxVideoArgs(input: string): MiniMaxVideoArgs {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const promptParts: string[] = [];
  let duration: MiniMaxVideoArgs["duration"];
  let resolution: MiniMaxVideoArgs["resolution"];
  let promptOptimizer: boolean | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--duration") {
      const value = Number(parseOptionValue(tokens, index, token));
      if (value !== 6 && value !== 10) {
        throw new MiniMaxVideoUsageError("--duration must be 6 or 10 seconds.");
      }
      duration = value;
      index += 1;
      continue;
    }
    if (token === "--resolution") {
      const value = parseOptionValue(tokens, index, token).toUpperCase();
      if (value !== "720P" && value !== "768P" && value !== "1080P") {
        throw new MiniMaxVideoUsageError("--resolution must be 720P, 768P, or 1080P.");
      }
      resolution = value;
      index += 1;
      continue;
    }
    if (token === "--no-prompt-optimizer") {
      promptOptimizer = false;
      continue;
    }
    if (token.startsWith("--")) {
      throw new MiniMaxVideoUsageError(`Unknown option: ${token}`);
    }
    promptParts.push(token);
  }

  const prompt = promptParts.join(" ").trim();
  if (!prompt) throw new MiniMaxVideoUsageError("A video prompt is required.");
  if (prompt.length > 5_000) throw new MiniMaxVideoUsageError("The video prompt is too long.");

  return {
    prompt,
    ...(duration ? { duration } : {}),
    ...(resolution ? { resolution } : {}),
    ...(promptOptimizer === false ? { promptOptimizer } : {}),
  };
}

export function buildMiniMaxVideoPayload(modelId: string, args: MiniMaxVideoArgs): Record<string, unknown> {
  return {
    model: modelId,
    prompt: args.prompt,
    ...(args.duration ? { duration: args.duration } : {}),
    ...(args.resolution ? { resolution: args.resolution } : {}),
    ...(args.promptOptimizer === false ? { prompt_optimizer: false } : {}),
  };
}

export function normalizeMiniMaxVideoBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("MINIMAX_VIDEO_BASE_URL must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("MINIMAX_VIDEO_BASE_URL must use HTTPS.");
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function miniMaxApiKeyName(baseUrl: string): "MINIMAX_API_KEY" | "MINIMAX_CN_API_KEY" {
  return new URL(baseUrl).hostname.toLowerCase() === "api.minimaxi.com"
    ? "MINIMAX_CN_API_KEY"
    : "MINIMAX_API_KEY";
}

export function readMiniMaxVideoConfig(env: NodeJS.ProcessEnv = process.env): MiniMaxVideoConfig {
  const baseUrlInput = env.MINIMAX_VIDEO_BASE_URL?.trim() || "";
  const modelId = env.MINIMAX_VIDEO_MODEL_ID?.trim() || "";
  const baseUrl = baseUrlInput ? normalizeMiniMaxVideoBaseUrl(baseUrlInput) : "";
  const apiKeyName = baseUrl ? miniMaxApiKeyName(baseUrl) : null;
  const apiKey = apiKeyName ? env[apiKeyName]?.trim() || "" : "";
  const missing = [
    !baseUrl && "MINIMAX_VIDEO_BASE_URL",
    !modelId && "MINIMAX_VIDEO_MODEL_ID",
    !apiKey && (apiKeyName || "MINIMAX_API_KEY or MINIMAX_CN_API_KEY"),
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Missing MiniMax video configuration: ${missing.join(", ")}.`);
  }
  return { apiKey, baseUrl, modelId };
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson<T extends { base_resp?: MiniMaxBaseResponse }>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchWithTimeout(url, init, API_REQUEST_TIMEOUT_MS);
  const text = await response.text();
  let payload: T;
  try {
    payload = JSON.parse(text) as T;
  } catch {
    throw new Error(`MiniMax returned an invalid JSON response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const detail = payload.base_resp?.status_msg || text.slice(0, 300);
    throw new Error(`MiniMax request failed (HTTP ${response.status}): ${detail}`);
  }
  const statusCode = Number(payload.base_resp?.status_code || 0);
  if (statusCode !== 0) {
    throw new Error(`MiniMax request failed (${statusCode}): ${payload.base_resp?.status_msg || "Unknown error"}`);
  }
  return payload;
}

async function createVideoTask(config: MiniMaxVideoConfig, args: MiniMaxVideoArgs): Promise<string> {
  const payload = await requestJson<CreateVideoResponse>(endpoint(config.baseUrl, "/video_generation"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildMiniMaxVideoPayload(config.modelId, args)),
  });
  if (payload.task_id === undefined || payload.task_id === null || payload.task_id === "") {
    throw new Error("MiniMax did not return a video task ID.");
  }
  return String(payload.task_id);
}

async function waitForVideoFile(config: MiniMaxVideoConfig, taskId: string): Promise<string> {
  const deadline = Date.now() + VIDEO_TASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const url = new URL(endpoint(config.baseUrl, "/query/video_generation"));
    url.searchParams.set("task_id", taskId);
    const payload = await requestJson<QueryVideoResponse>(url.toString(), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    const status = payload.status?.trim().toLowerCase();
    if (status === "success") {
      if (payload.file_id === undefined || payload.file_id === null || payload.file_id === "") {
        throw new Error("MiniMax completed the video task without a file ID.");
      }
      return String(payload.file_id);
    }
    if (status === "fail" || status === "failed") {
      throw new Error("MiniMax video generation failed.");
    }
    await sleepImpl(VIDEO_POLL_INTERVAL_MS);
  }
  throw new Error("MiniMax video generation timed out.");
}

async function retrieveDownloadUrl(config: MiniMaxVideoConfig, fileId: string): Promise<string> {
  const url = new URL(endpoint(config.baseUrl, "/files/retrieve"));
  url.searchParams.set("file_id", fileId);
  const payload = await requestJson<RetrieveFileResponse>(url.toString(), {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  const downloadUrl = payload.file?.download_url?.trim() || "";
  if (!downloadUrl) throw new Error("MiniMax did not return a video download URL.");
  return downloadUrl;
}

function videoExtension(downloadUrl: string): string {
  const extension = extname(new URL(downloadUrl).pathname).toLowerCase();
  return extension === ".webm" || extension === ".mov" ? extension : ".mp4";
}

async function saveVideo(downloadUrl: string): Promise<SavedVideoFile> {
  const url = new URL(downloadUrl);
  if (url.protocol !== "https:") throw new Error("MiniMax returned a non-HTTPS video download URL.");

  const response = await fetchWithTimeout(url, {}, VIDEO_DOWNLOAD_TIMEOUT_MS);
  if (!response.ok) throw new Error(`MiniMax video download failed (HTTP ${response.status}).`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_VIDEO_BYTES) throw new Error("MiniMax video exceeds the 256 MB workspace limit.");

  const blob = await response.blob();
  if (blob.size > MAX_VIDEO_BYTES) throw new Error("MiniMax video exceeds the 256 MB workspace limit.");

  const outDir = join("/workspace", "exports", "videos");
  mkdirSync(outDir, { recursive: true });
  const filename = `minimax-video-${Date.now()}${videoExtension(downloadUrl)}`;
  const relPath = join("exports", "videos", filename).replace(/\\/g, "/");
  const absPath = join("/workspace", relPath);
  const tempPath = `${absPath}.part`;
  try {
    await Bun.write(tempPath, blob);
    renameSync(tempPath, absPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
  return {
    absPath,
    relPath,
    rawUrl: `/workspace/raw?path=${encodeURIComponent(relPath)}`,
  };
}

async function generateVideo(config: MiniMaxVideoConfig, args: MiniMaxVideoArgs): Promise<SavedVideoFile> {
  const taskId = await createVideoTask(config, args);
  const fileId = await waitForVideoFile(config, taskId);
  const downloadUrl = await retrieveDownloadUrl(config, fileId);
  return await saveVideoImpl(downloadUrl);
}

export function formatGeneratedVideoMessage(
  modelId: string,
  prompt: string,
  file: SavedVideoFile,
): string {
  return [
    `MiniMax video (${modelId}) - ${prompt}`,
    "",
    `[Open generated video](${file.rawUrl})`,
    "",
    "Files:",
    `- ${file.absPath}`,
  ].join("\n");
}

export function formatMiniMaxVideoError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "MiniMax video generation failed: The provider request timed out.";
  }
  const message = error instanceof Error ? error.message : String(error);
  return `MiniMax video generation failed: ${message.slice(0, 500)}`;
}

let fetchImpl: FetchLike = fetch;
let sleepImpl = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};
let saveVideoImpl = saveVideo;

export function setMiniMaxVideoHandlersForTests(handlers?: Partial<MiniMaxVideoHandlers> | null): void {
  fetchImpl = handlers?.fetch ?? fetch;
  sleepImpl = handlers?.sleep ?? (async (milliseconds: number) => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  });
  saveVideoImpl = handlers?.saveVideo ?? saveVideo;
}

function sendVideoMessage(pi: MiniMaxVideoMessenger, content: string): void {
  pi.sendMessage({ customType: "minimax-video", content, display: true } as any);
}

export async function executeMiniMaxVideoCommand(
  pi: MiniMaxVideoMessenger,
  input: string,
  configOverride?: MiniMaxVideoConfig,
): Promise<void> {
  let args: MiniMaxVideoArgs;
  let config: MiniMaxVideoConfig;
  try {
    args = parseMiniMaxVideoArgs(input || "");
    config = configOverride ?? readMiniMaxVideoConfig();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const usage = "Usage: /minimax-video <prompt> [--duration 6|10] [--resolution 720P|768P|1080P] [--no-prompt-optimizer]";
    sendVideoMessage(pi, `${detail}\n\n${usage}`);
    return;
  }

  sendVideoMessage(pi, `Generating MiniMax video... (${config.modelId})`);
  void (async () => {
    try {
      const file = await generateVideo(config, args);
      sendVideoMessage(pi, formatGeneratedVideoMessage(config.modelId, args.prompt, file));
    } catch (error) {
      sendVideoMessage(pi, formatMiniMaxVideoError(error));
    }
  })();
}

export default function registerMiniMaxVideo(pi: ExtensionAPI): void {
  pi.registerCommand("minimax-video", {
    description: "Generate a MiniMax video and save it to the workspace",
    handler: async (input) => {
      await executeMiniMaxVideoCommand(pi, input || "");
    },
  });
}
