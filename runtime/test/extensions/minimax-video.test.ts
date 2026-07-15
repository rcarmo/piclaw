import { afterEach, expect, test } from "bun:test";

import {
  buildMiniMaxVideoPayload,
  executeMiniMaxVideoCommand,
  normalizeMiniMaxVideoBaseUrl,
  parseMiniMaxVideoArgs,
  readMiniMaxVideoConfig,
  setMiniMaxVideoHandlersForTests,
  type MiniMaxVideoConfig,
} from "../../extensions/integrations/minimax-video/index.ts";
import { waitFor } from "../helpers.js";

const CONFIG: MiniMaxVideoConfig = {
  apiKey: "test-key",
  baseUrl: "https://api.example.com/v1",
  modelId: "video-model",
};

afterEach(() => {
  setMiniMaxVideoHandlersForTests(null);
});

test("parseMiniMaxVideoArgs builds supported generation options", () => {
  const args = parseMiniMaxVideoArgs(
    "a paper city at sunrise --duration 10 --resolution 1080p --no-prompt-optimizer",
  );

  expect(args).toEqual({
    prompt: "a paper city at sunrise",
    duration: 10,
    resolution: "1080P",
    promptOptimizer: false,
  });
  expect(buildMiniMaxVideoPayload("video-model", args)).toEqual({
    model: "video-model",
    prompt: "a paper city at sunrise",
    duration: 10,
    resolution: "1080P",
    prompt_optimizer: false,
  });
});

test("normalizeMiniMaxVideoBaseUrl removes trailing separators and rejects insecure URLs", () => {
  expect(normalizeMiniMaxVideoBaseUrl("https://api.example.com/v1///"))
    .toBe("https://api.example.com/v1");
  expect(() => normalizeMiniMaxVideoBaseUrl("http://api.example.com/v1"))
    .toThrow("must use HTTPS");
});

test("executeMiniMaxVideoCommand creates, polls, retrieves, and reports a workspace video", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    { task_id: "task-1", base_resp: { status_code: 0 } },
    { status: "Processing", base_resp: { status_code: 0 } },
    { status: "Success", file_id: "file-1", base_resp: { status_code: 0 } },
    { file: { download_url: "https://cdn.example.com/video.mp4" }, base_resp: { status_code: 0 } },
  ];
  const sent: Array<{ customType: string; content: string; display?: boolean }> = [];

  setMiniMaxVideoHandlersForTests({
    fetch: async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    sleep: async () => {},
    saveVideo: async () => ({
      absPath: "/workspace/exports/videos/minimax-video-test.mp4",
      relPath: "exports/videos/minimax-video-test.mp4",
      rawUrl: "/workspace/raw?path=exports%2Fvideos%2Fminimax-video-test.mp4",
    }),
  });

  await executeMiniMaxVideoCommand({
    sendMessage(message: any) { sent.push(message); },
  } as any, "a paper city at sunrise --duration 6", CONFIG);

  expect(sent[0]?.content).toContain("Generating MiniMax video...");
  await waitFor(() => sent.length >= 2, 1_000, 10);

  expect(requests.map((request) => request.url)).toEqual([
    "https://api.example.com/v1/video_generation",
    "https://api.example.com/v1/query/video_generation?task_id=task-1",
    "https://api.example.com/v1/query/video_generation?task_id=task-1",
    "https://api.example.com/v1/files/retrieve?file_id=file-1",
  ]);
  expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
    model: "video-model",
    prompt: "a paper city at sunrise",
    duration: 6,
  });
  expect(sent[1]?.content).toContain("[Open generated video]");
  expect(sent[1]?.content).toContain("/workspace/exports/videos/minimax-video-test.mp4");
});

test("readMiniMaxVideoConfig reports every required setting", () => {
  expect(() => readMiniMaxVideoConfig({})).toThrow(
    "Missing MiniMax video configuration: MINIMAX_VIDEO_BASE_URL, MINIMAX_VIDEO_MODEL_ID, MINIMAX_API_KEY or MINIMAX_CN_API_KEY.",
  );
});

test("readMiniMaxVideoConfig selects the API key for the configured region", () => {
  expect(readMiniMaxVideoConfig({
    MINIMAX_API_KEY: "global-key",
    MINIMAX_VIDEO_BASE_URL: "https://api.minimax.io/v1",
    MINIMAX_VIDEO_MODEL_ID: "video-model",
  }).apiKey).toBe("global-key");

  expect(readMiniMaxVideoConfig({
    MINIMAX_CN_API_KEY: "china-key",
    MINIMAX_VIDEO_BASE_URL: "https://api.minimaxi.com/v1",
    MINIMAX_VIDEO_MODEL_ID: "video-model",
  }).apiKey).toBe("china-key");
});

test("executeMiniMaxVideoCommand reports invalid input without starting a request", async () => {
  const sent: Array<{ content: string }> = [];

  await executeMiniMaxVideoCommand({
    sendMessage(message: any) { sent.push(message); },
  } as any, "--duration 6", CONFIG);

  expect(sent[0]?.content).toContain("A video prompt is required");
  expect(sent[0]?.content).toContain("Usage: /minimax-video");
});
