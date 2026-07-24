/**
 * bun-runner – registers a Bun script execution tool.
 *
 * Runs workspace Bun scripts directly (no shell), with optional argv and cwd.
 * Stdout is discarded by default, but can be captured explicitly.
 * Large captured outputs are stored as searchable tool-output logs.
 */

import { Type, type Static } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

import { registerToolStatusHintProvider } from "../tool-status-hints.js";
import type { CapturedBunStreamResult } from "../tools/bun-runner.js";
import { runBunScript } from "../tools/bun-runner.js";
import { buildSubprocessExecutionHint } from "../utils/process-spawn.js";

const BUN_STATUS_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3.2C7.4 5.2 2 7.8 1.1 11.8c-1 4.2 4 8.2 10.9 8.2s11.9-4 10.9-8.2C22 7.8 16.6 5.2 12 3.2Z"></path><path d="M12 3.2c-.8 1.1-1.3 2.3-1.6 3.6"></path><path d="M12 3.2c.1 1.2.4 2.4.7 3.5"></path><ellipse cx="7.8" cy="12" rx="1.7" ry="1.8" fill="currentColor" stroke="none"></ellipse><ellipse cx="16.2" cy="12" rx="1.7" ry="1.8" fill="currentColor" stroke="none"></ellipse><circle cx="7.25" cy="11.4" r="0.5" fill="white" stroke="none"></circle><circle cx="15.65" cy="11.4" r="0.5" fill="white" stroke="none"></circle><path d="M9.6 15.2h4.8a2.4 2.4 0 0 1-4.8 0Z" fill="currentColor" stroke="none"></path></svg>`;
const BUN_WORKING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type BunRunUiContext = {
  hasUI?: boolean;
  model?: Model<Api>;
  thinkingLevel?: string;
  sessionManager?: {
    getSessionId?: () => string;
    getPath?: () => string | null | undefined;
  };
  ui?: {
    setWorkingIndicator: (options?: { frames?: string[]; intervalMs?: number }) => void;
    setWorkingMessage: (message?: string) => void;
  };
};

function startBunRunUiProgress(ctx: BunRunUiContext | undefined, message: string): void {
  if (!ctx?.hasUI || !ctx.ui) return;
  ctx.ui.setWorkingIndicator({ frames: BUN_WORKING_FRAMES, intervalMs: 90 });
  ctx.ui.setWorkingMessage(message);
}

function finishBunRunUiProgress(ctx: BunRunUiContext | undefined): void {
  if (!ctx?.hasUI || !ctx.ui) return;
  ctx.ui.setWorkingMessage(undefined);
  ctx.ui.setWorkingIndicator({ frames: [] });
}

const BunRunSchema = Type.Object({
  script: Type.String({ description: "Workspace-relative script file to execute with Bun (for example `runtime/scripts/foo.ts`)." }),
  args: Type.Optional(Type.Array(Type.String(), { description: "Arguments passed to the script. No shell parsing is performed." })),
  cwd: Type.Optional(Type.String({ description: "Working directory relative to the workspace (defaults to the workspace root)." })),
  timeout_sec: Type.Optional(Type.Integer({ description: "Timeout in seconds.", minimum: 1, maximum: 3600 })),
  capture_stdout: Type.Optional(Type.Boolean({ description: "Capture stdout instead of discarding it. Large captured output is stored as searchable tool-output logs." })),
});

type BunRunParams = Static<typeof BunRunSchema>;

function readTrimmedString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

registerToolStatusHintProvider({
  id: "bun_run",
  buildHints: ({ toolName, args }) => {
    if (toolName !== "bun_run") return null;
    const record = args && typeof args === "object" ? args as Record<string, unknown> : null;
    const script = readTrimmedString(record?.script);
    if (!script) return null;
    return {
      key: "bun_run",
      icon_svg: BUN_STATUS_ICON_SVG,
      label: script,
      title: `Bun script • ${script}`,
      kind: "script",
    };
  },
});

export function buildBunRunHint(platform: NodeJS.Platform = process.platform): string {
  return [
    "## Direct Bun scripts",
    "Use bun_run to execute a workspace Bun script directly without a shell.",
    "Pass script arguments as an array; do not rely on shell features like pipes or redirects.",
    "Stdout is discarded by default; set capture_stdout=true when you need bounded inline output or searchable stored output.",
    "Prefer Bun scripts over Python/uv unless Bun is not viable for the task.",
    buildSubprocessExecutionHint(platform),
  ].join("\n");
}

export function buildBunRunDescription(platform: NodeJS.Platform = process.platform): string {
  return `Run a workspace Bun script directly with optional arguments and cwd. No shell parsing, piping, or redirects; stderr is always captured, stdout can be captured optionally with large outputs stored as searchable tool-output logs. ${buildSubprocessExecutionHint(platform)}`;
}

export function buildBunRunPromptSnippet(platform: NodeJS.Platform = process.platform): string {
  return `bun_run: execute a workspace Bun script directly with optional arguments and cwd, capturing stderr and optionally capturing stdout with searchable large-output storage. ${buildSubprocessExecutionHint(platform)}`;
}

function formatArgs(args: string[]): string {
  if (args.length === 0) return "(none)";
  return args.map((arg) => JSON.stringify(arg)).join(" ");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildStreamSection(label: "stdout" | "stderr", stream: CapturedBunStreamResult): string[] {
  if (!stream.captured) {
    return [`${label}: discarded`];
  }

  if (stream.storedOutputId) {
    const sizeBytes = stream.storedOutputBytes ?? stream.bytes;
    const lineCount = stream.storedOutputLines ?? stream.lineCount;
    return [
      `${label} stored as tool-output:${stream.storedOutputId} (${lineCount} lines, ${formatBytes(sizeBytes)}).`,
      stream.storedOutputPreview ? `Preview:\n${stream.storedOutputPreview}` : null,
      `Use search_tool_output with handle "${stream.storedOutputId}" and a query to retrieve relevant snippets.`,
    ].filter((line): line is string => Boolean(line));
  }

  if (stream.text) {
    return [`${label}:`, stream.text];
  }

  return [`${label}: (empty)`];
}

function buildResultText(result: {
  scriptDisplayPath: string;
  cwdDisplayPath: string;
  args: string[];
  exitCode: number | null;
  stdout: CapturedBunStreamResult;
  stderr: CapturedBunStreamResult;
}): string {
  const status = result.exitCode === 0
    ? `bun_run completed successfully for ${result.scriptDisplayPath}.`
    : `bun_run finished with exit code ${result.exitCode ?? "unknown"} for ${result.scriptDisplayPath}.`;

  const sections = [
    [
      status,
      `cwd: ${result.cwdDisplayPath}`,
      `args: ${formatArgs(result.args)}`,
    ].join("\n"),
    buildStreamSection("stdout", result.stdout).join("\n"),
    buildStreamSection("stderr", result.stderr).join("\n"),
  ];

  return sections.join("\n\n");
}

export const bunRunner: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${buildBunRunHint()}`,
  }));

  pi.registerTool({
    name: "bun_run",
    label: "bun_run",
    description: buildBunRunDescription(),
    promptSnippet: buildBunRunPromptSnippet(),
    parameters: BunRunSchema,
    async execute(
      _toolCallId: string,
      params: BunRunParams,
      signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: BunRunUiContext,
    ): Promise<AgentToolResult<Record<string, unknown>>> {
      startBunRunUiProgress(ctx, `Bun: running ${params.script}…`);
      try {
        const result = await runBunScript({
          script: params.script,
          args: params.args,
          cwd: params.cwd,
          timeoutSec: params.timeout_sec,
          captureStdout: params.capture_stdout,
          sessionEnv: {
            sessionId: ctx?.sessionManager?.getSessionId?.(),
            sessionFile: ctx?.sessionManager?.getPath?.(),
            model: ctx?.model,
            thinkingLevel: ctx?.thinkingLevel,
          },
        }, signal);

        return {
          content: [{ type: "text", text: buildResultText(result) }],
          details: {
            ok: result.exitCode === 0,
            script: result.scriptDisplayPath,
            cwd: result.cwdDisplayPath,
            args: result.args,
            bun_path: result.bunPath,
            exit_code: result.exitCode,
            capture_stdout: result.captureStdout,
            stdout: result.stdout.text,
            stdout_captured: result.stdout.captured,
            stdout_bytes: result.stdout.bytes,
            stdout_lines: result.stdout.lineCount,
            stdout_truncated: false,
            stdout_stored_output_id: result.stdout.storedOutputId,
            stdout_stored_output_path: result.stdout.storedOutputPath,
            stdout_stored_output_bytes: result.stdout.storedOutputBytes,
            stdout_stored_output_lines: result.stdout.storedOutputLines,
            stderr: result.stderr.text,
            stderr_bytes: result.stderr.bytes,
            stderr_lines: result.stderr.lineCount,
            stderr_truncated: false,
            stderr_stored_output_id: result.stderr.storedOutputId,
            stderr_stored_output_path: result.stderr.storedOutputPath,
            stderr_stored_output_bytes: result.stderr.storedOutputBytes,
            stderr_stored_output_lines: result.stderr.storedOutputLines,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const timedOut = message.startsWith("timeout:");
        const aborted = message === "aborted";
        return {
          content: [{
            type: "text",
            text: timedOut
              ? `bun_run timed out after ${params.timeout_sec ?? 120}s while running ${params.script}.`
              : aborted
                ? `bun_run was aborted while running ${params.script}.`
                : `bun_run failed: ${message}`,
          }],
          details: {
            ok: false,
            script: params.script,
            cwd: params.cwd || ".",
            args: Array.isArray(params.args) ? params.args : [],
            timeout_sec: params.timeout_sec ?? 120,
            capture_stdout: Boolean(params.capture_stdout),
            timed_out: timedOut,
            aborted,
            error: message,
          },
        };
      } finally {
        finishBunRunUiProgress(ctx);
      }
    },
  });
};
