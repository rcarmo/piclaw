/**
 * context-mode.ts – Tool-output storage and search extension.
 *
 * Intercepts large bash tool results, stores them on disk, and replaces
 * the inline output with a compact preview + search handle.  Also
 * registers the batch_exec and search_tool_output tools.
 *
 * Activated unconditionally (no env-var gate).
 */
import { isBashToolResult } from "@mariozechner/pi-coding-agent";

import {
  buildPreview,
  createBatchExecTool,
  createToolOutputSearchTool,
  readToolOutputFile,
  saveToolOutput,
} from "../../src/extensions/context-mode-api.js";

const STORE_THRESHOLD_BYTES = parseInt(process.env.PICLAW_TOOL_OUTPUT_STORE_BYTES || "4096", 10);
const STORE_THRESHOLD_LINES = parseInt(process.env.PICLAW_TOOL_OUTPUT_STORE_LINES || "40", 10);
const PREVIEW_LINES = parseInt(process.env.PICLAW_TOOL_OUTPUT_PREVIEW_LINES || "8", 10);
const PREVIEW_LINE_CHARS = parseInt(process.env.PICLAW_TOOL_OUTPUT_PREVIEW_LINE_CHARS || "200", 10);
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extractText(content: Array<{ type: string; text?: string }> | undefined): string {
  if (!content) return "";
  return content.map((item) => (item.type === "text" ? item.text || "" : "")).join("");
}

function shouldStoreOutput(text: string, lineCount: number): boolean {
  const bytes = Buffer.byteLength(text || "", "utf8");
  return bytes > STORE_THRESHOLD_BYTES || lineCount > STORE_THRESHOLD_LINES;
}

export default function (pi: any) {
  // Tool-output cleanup is process-scoped and starts from runtime startup.
  // Keep this session extension focused on registering the tools/hooks needed
  // for the active session so cold session creation does not repeat lifecycle work.
  pi.registerTool(createToolOutputSearchTool());
  pi.registerTool(createBatchExecTool(process.cwd()));

  pi.on("tool_result", async (event: any) => {
    if (!isBashToolResult(event)) return;
    if (event.isError) return;
    if (event.details?.storedOutputId || event.details?.storedOutputPath) return;

    const text = extractText(event.content);
    const fullOutputPath = event.details?.fullOutputPath;
    let fullOutput = text;
    if (fullOutputPath) {
      const fileText = readToolOutputFile(fullOutputPath);
      if (fileText !== null) fullOutput = fileText;
    }

    const lineCount = fullOutput ? fullOutput.replace(/\r\n/g, "\n").split("\n").length : 0;
    if (!shouldStoreOutput(fullOutput, lineCount)) return;

    const preview = buildPreview(fullOutput, PREVIEW_LINES, PREVIEW_LINE_CHARS);
    const saved = saveToolOutput(fullOutput, {
      source: `bash:${event.input?.command || ""}`,
      summary: preview,
    });

    const summaryText = [
      `Output stored as tool-output:${saved.id} (${saved.lineCount} lines, ${formatBytes(saved.sizeBytes)}).`,
      preview ? `Preview:\n${preview}` : null,
      `Use search_tool_output with handle "${saved.id}" and a query to retrieve relevant snippets.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      content: [{ type: "text", text: summaryText }],
      details: {
        storedOutputId: saved.id,
        storedOutputPath: saved.path,
        storedOutputLines: saved.lineCount,
        storedOutputBytes: saved.sizeBytes,
      },
    };
  });
}
