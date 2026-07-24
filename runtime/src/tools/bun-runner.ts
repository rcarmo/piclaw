/**
 * tools/bun-runner.ts – Run workspace Bun scripts directly without a shell.
 *
 * Spawns the Bun runtime with a script path + argv array, keeps cwd/script
 * resolution inside the workspace, tracks the child process for abort/shutdown,
 * uses detached children on Unix and attached children on Windows so stdout /
 * stderr remain capturable there, optionally captures stdout, always captures
 * stderr, and stores large captured outputs via tool-output.ts so they can be
 * previewed/searched later.
 */

import { spawn } from "child_process";
import { existsSync, statSync } from "fs";
import path from "path";
import { StringDecoder } from "string_decoder";

import { WORKSPACE_DIR } from "../core/config.js";
import { buildPreview, saveToolOutput } from "../tool-output.js";
import { mergePiSessionEnv, type PiSessionEnvInput } from "../utils/pi-session-env.js";
import { killProcessTree, registerProcess, unregisterProcess } from "../utils/process-tracker.js";
import { shouldDetachChildProcess } from "../utils/process-spawn.js";

const DEFAULT_TIMEOUT_SEC = 120;
const MAX_TIMEOUT_SEC = 3600;
const STORE_THRESHOLD_BYTES = parseInt(process.env.PICLAW_TOOL_OUTPUT_STORE_BYTES || "4096", 10);
const STORE_THRESHOLD_LINES = parseInt(process.env.PICLAW_TOOL_OUTPUT_STORE_LINES || "40", 10);
const PREVIEW_LINES = parseInt(process.env.PICLAW_TOOL_OUTPUT_PREVIEW_LINES || "8", 10);
const PREVIEW_LINE_CHARS = parseInt(process.env.PICLAW_TOOL_OUTPUT_PREVIEW_LINE_CHARS || "200", 10);

export interface RunBunScriptParams {
  script: string;
  args?: string[];
  cwd?: string;
  timeoutSec?: number;
  captureStdout?: boolean;
  sessionEnv?: PiSessionEnvInput;
}

export interface ResolvedBunScriptTarget {
  scriptPath: string;
  scriptDisplayPath: string;
  cwd: string;
  cwdDisplayPath: string;
  args: string[];
  timeoutSec: number;
  captureStdout: boolean;
}

export interface CapturedBunStreamResult {
  captured: boolean;
  text: string;
  bytes: number;
  lineCount: number;
  storedOutputId?: string;
  storedOutputPath?: string;
  storedOutputBytes?: number;
  storedOutputLines?: number;
  storedOutputPreview?: string;
}

export interface RunBunScriptResult extends ResolvedBunScriptTarget {
  bunPath: string;
  exitCode: number | null;
  stdout: CapturedBunStreamResult;
  stderr: CapturedBunStreamResult;
}

interface MutableCapturedStream {
  readonly captured: boolean;
  readonly chunks: string[];
  readonly decoder: StringDecoder;
  bytes: number;
}

function resolveWorkspacePath(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const resolved = path.resolve(WORKSPACE_DIR, raw);
  const rel = path.relative(WORKSPACE_DIR, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

function displayWorkspacePath(absPath: string): string {
  const rel = path.relative(WORKSPACE_DIR, absPath);
  if (!rel || rel === ".") return ".";
  return rel.split(path.sep).join("/");
}

function normalizeArgs(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new Error("args must be an array of strings.");
  }
  return input.map((value, index) => {
    if (typeof value !== "string") {
      throw new Error(`args[${index}] must be a string.`);
    }
    if (value.includes("\0")) {
      throw new Error(`args[${index}] contains an invalid null byte.`);
    }
    return value;
  });
}

function createMutableCapturedStream(captured: boolean): MutableCapturedStream {
  return {
    captured,
    chunks: [],
    decoder: new StringDecoder("utf8"),
    bytes: 0,
  };
}

function appendCapturedStream(stream: MutableCapturedStream, chunk: string | Buffer | Uint8Array): void {
  if (!stream.captured) return;
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  stream.bytes += buffer.length;
  const text = stream.decoder.write(buffer);
  if (text) stream.chunks.push(text);
}

function finalizeCapturedText(stream: MutableCapturedStream): string {
  if (!stream.captured) return "";
  const tail = stream.decoder.end();
  if (tail) stream.chunks.push(tail);
  return stream.chunks.join("");
}

function countLines(text: string): number {
  return text ? text.replace(/\r\n/g, "\n").split("\n").length : 0;
}

function shouldStoreOutput(text: string, lineCount: number): boolean {
  const bytes = Buffer.byteLength(text || "", "utf8");
  return bytes > STORE_THRESHOLD_BYTES || lineCount > STORE_THRESHOLD_LINES;
}

function finalizeCapturedStream(
  label: "stdout" | "stderr",
  target: ResolvedBunScriptTarget,
  stream: MutableCapturedStream,
): CapturedBunStreamResult {
  if (!stream.captured) {
    return {
      captured: false,
      text: "",
      bytes: 0,
      lineCount: 0,
    };
  }

  const text = finalizeCapturedText(stream);
  const lineCount = countLines(text);
  if (!shouldStoreOutput(text, lineCount)) {
    return {
      captured: true,
      text,
      bytes: stream.bytes,
      lineCount,
    };
  }

  const preview = buildPreview(text, PREVIEW_LINES, PREVIEW_LINE_CHARS);
  const saved = saveToolOutput(text, {
    source: `bun_run:${label}:${target.scriptDisplayPath}`,
    summary: preview,
  });

  return {
    captured: true,
    text: preview,
    bytes: stream.bytes,
    lineCount,
    storedOutputId: saved.id,
    storedOutputPath: saved.path,
    storedOutputBytes: saved.sizeBytes,
    storedOutputLines: saved.lineCount,
    storedOutputPreview: preview,
  };
}

export function resolveBunScriptTarget(params: RunBunScriptParams): ResolvedBunScriptTarget {
  const resolvedScript = resolveWorkspacePath(params.script);
  if (!resolvedScript) {
    throw new Error("script must resolve to a file inside the workspace.");
  }
  if (!existsSync(resolvedScript)) {
    throw new Error(`Script not found: ${params.script}`);
  }

  let scriptStats;
  try {
    scriptStats = statSync(resolvedScript);
  } catch {
    throw new Error(`Failed to stat script: ${params.script}`);
  }
  if (!scriptStats.isFile()) {
    throw new Error("script must be a file, not a directory.");
  }

  const resolvedCwd = params.cwd && String(params.cwd).trim()
    ? resolveWorkspacePath(params.cwd)
    : WORKSPACE_DIR;
  if (!resolvedCwd) {
    throw new Error("cwd must stay within the workspace.");
  }
  if (!existsSync(resolvedCwd)) {
    throw new Error(`cwd does not exist: ${params.cwd}`);
  }

  let cwdStats;
  try {
    cwdStats = statSync(resolvedCwd);
  } catch {
    throw new Error(`Failed to stat cwd: ${params.cwd}`);
  }
  if (!cwdStats.isDirectory()) {
    throw new Error("cwd must be a directory.");
  }

  const timeoutSec = Number.isFinite(params.timeoutSec)
    ? Math.min(Math.max(Number(params.timeoutSec), 1), MAX_TIMEOUT_SEC)
    : DEFAULT_TIMEOUT_SEC;

  return {
    scriptPath: resolvedScript,
    scriptDisplayPath: displayWorkspacePath(resolvedScript),
    cwd: resolvedCwd,
    cwdDisplayPath: displayWorkspacePath(resolvedCwd),
    args: normalizeArgs(params.args),
    timeoutSec,
    captureStdout: Boolean(params.captureStdout),
  };
}

export async function runBunScript(
  params: RunBunScriptParams,
  signal?: AbortSignal,
): Promise<RunBunScriptResult> {
  const target = resolveBunScriptTarget(params);
  const bunPath = process.execPath || "bun";

  return await new Promise<RunBunScriptResult>((resolve, reject) => {
    let settled = false;
    let child: ReturnType<typeof spawn> | null = null;
    let timedOut = false;
    let aborted = false;
    const stdoutCapture = createMutableCapturedStream(target.captureStdout);
    const stderrCapture = createMutableCapturedStream(true);

    const cleanup = (timeoutHandle?: NodeJS.Timeout) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (child?.pid) unregisterProcess(child.pid);
    };

    const finish = (result: RunBunScriptResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const fail = (error: Error, timeoutHandle?: NodeJS.Timeout) => {
      if (settled) return;
      settled = true;
      cleanup(timeoutHandle);
      reject(error);
    };

    const onAbort = () => {
      aborted = true;
      if (child?.pid) killProcessTree(child.pid);
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (child?.pid) killProcessTree(child.pid);
    }, target.timeoutSec * 1000);

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child = spawn(bunPath, [target.scriptPath, ...target.args], {
      cwd: target.cwd,
      detached: shouldDetachChildProcess(process.platform),
      env: mergePiSessionEnv(process.env, params.sessionEnv),
      stdio: ["ignore", target.captureStdout ? "pipe" : "ignore", "pipe"],
    });

    if (child.pid) registerProcess(child.pid);

    child.stdout?.on("data", (chunk) => {
      appendCapturedStream(stdoutCapture, chunk);
    });

    child.stderr?.on("data", (chunk) => {
      appendCapturedStream(stderrCapture, chunk);
    });

    child.on("error", (error) => {
      fail(error, timeoutHandle);
    });

    child.on("close", (exitCode) => {
      cleanup(timeoutHandle);

      if (aborted || signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      if (timedOut) {
        reject(new Error(`timeout:${target.timeoutSec}`));
        return;
      }

      finish({
        ...target,
        bunPath,
        exitCode,
        stdout: finalizeCapturedStream("stdout", target, stdoutCapture),
        stderr: finalizeCapturedStream("stderr", target, stderrCapture),
      });
    });
  });
}
