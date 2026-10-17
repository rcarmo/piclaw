/**
 * tools/tracked-bash.ts – Process-tracked shell execution for the agent.
 *
 * Creates a BashOperations implementation that:
 *   1. Resolves the host's preferred shell (POSIX shell on Unix, PowerShell/cmd on Windows).
 *   2. Resolves keychain placeholders in the command string and environment.
 *   3. Spawns the command in a platform-appropriate mode: detached process
 *      groups on Unix for clean tree kills, attached children on Windows so
 *      stdout/stderr stay capturable.
 *   4. Registers/unregisters the child PID with the process tracker so
 *      agent-pool.ts can force-kill lingering processes on abort/shutdown.
 *   5. Handles timeout and abort-signal cancellation.
 *
 * Consumers:
 *   - tools/context-tools.ts passes createTrackedBashOperations() into the
 *     pi-coding-agent's createBashTool() factory.
 */

import { randomBytes } from "crypto";
import { spawn } from "child_process";
import { closeSync, existsSync, mkdirSync, openSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type BashOperations } from "@earendil-works/pi-coding-agent";
import { buildInjectedShellEnv, resolveKeychainPlaceholders } from "../secure/keychain.js";

import { killProcessTree, registerProcess, unregisterProcess } from "../utils/process-tracker.js";
import { shouldDetachChildProcess } from "../utils/process-spawn.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";

export interface ShellConfig {
  shell: string;
  args: string[];
  family: "posix" | "powershell" | "cmd";
}

interface ResolveShellConfigOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pathExists?: (path: string) => boolean;
  shellPath?: string;
}

export interface TrackedBashOperationsOptions {
  shellPath?: string | (() => string | undefined);
  /** Synchronous, invocation-local admission after resolution, before every spawn.
   * Only literal true authorizes execution; throws and non-booleans fail closed.
   */
  validateSpawn?: () => boolean;
}

const POWERSHELL_ARGS = ["-NoProfile", "-Command"];
const POSIX_ARGS = ["-c"];
const CMD_ARGS = ["/c"];
export const TRACKED_BASH_OUTPUT_LIMIT_BYTES = 256 * 1024;
export const TRACKED_BASH_OUTPUT_TRUNCATION_NOTICE = "\n[output truncated]\n";
const TRACKED_BASH_POST_EXIT_STDIO_IDLE_GRACE_MS = 150;
const log = createLogger("tools.tracked-bash");
const BASH_SPOOL_TEMP_ERROR_PREFIX = "Bash output spool temp directory is unavailable";
const BASH_SPOOL_PROBE_PREFIX = ".piclaw-bash-spool-probe";

interface BashSpoolCompatibilityState {
  totalBytes: number;
  completedLines: number;
  hasOpenLine: boolean;
  prepared: boolean;
}

function createBashSpoolCompatibilityState(): BashSpoolCompatibilityState {
  return {
    totalBytes: 0,
    completedLines: 0,
    hasOpenLine: false,
    prepared: false,
  };
}

function createBashSpoolTempDirError(tempDir: string, error: unknown): Error {
  const code = typeof error === "object" && error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
  const codeText = typeof code === "string" && code ? ` (${code})` : "";
  return new Error(`${BASH_SPOOL_TEMP_ERROR_PREFIX}: ${tempDir}${codeText}. Recreate the directory or restore write access, then retry.`);
}

function ensureBashSpoolTempDirWritable(): void {
  const tempDir = tmpdir();
  try {
    mkdirSync(tempDir, { recursive: true });
  } catch (error) {
    throw createBashSpoolTempDirError(tempDir, error);
  }

  const probePath = join(tempDir, `${BASH_SPOOL_PROBE_PREFIX}-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`);
  let fd: number | undefined;
  try {
    fd = openSync(probePath, "w", 0o600);
  } catch (error) {
    throw createBashSpoolTempDirError(tempDir, error);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      rmSync(probePath, { force: true });
    } catch (error) {
      debugSuppressedError(log, "Failed to remove Bash spool probe file", error, { probePath });
    }
  }
}

function prepareBashSpoolTempDirForChunk(state: BashSpoolCompatibilityState, chunk: Buffer): void {
  if (state.prepared || chunk.length === 0) return;

  state.totalBytes += chunk.length;
  let newlineCount = 0;
  let lastNewline = -1;
  for (let i = 0; i < chunk.length; i += 1) {
    if (chunk[i] !== 0x0a) continue;
    newlineCount += 1;
    lastNewline = i;
  }

  if (newlineCount === 0) {
    state.hasOpenLine = true;
  } else {
    state.completedLines += newlineCount;
    state.hasOpenLine = lastNewline < chunk.length - 1;
  }

  const totalLines = state.completedLines + (state.hasOpenLine ? 1 : 0);
  if (state.totalBytes <= DEFAULT_MAX_BYTES && totalLines <= DEFAULT_MAX_LINES) return;

  ensureBashSpoolTempDirWritable();
  state.prepared = true;
}

function pushUniqueShell(candidates: ShellConfig[], candidate: ShellConfig): void {
  if (!candidate.shell.trim()) return;
  if (candidates.some((entry) => entry.shell.toLowerCase() === candidate.shell.toLowerCase())) return;
  candidates.push(candidate);
}

/** Determine which shell binaries and arguments to try for command execution. */
export function resolveShellCandidates(options: ResolveShellConfigOptions = {}): ShellConfig[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? existsSync;
  const candidates: ShellConfig[] = [];
  const shellPath = options.shellPath?.trim();

  if (shellPath) {
    if (!pathExists(shellPath)) throw new Error(`Custom shell path not found: ${shellPath}`);
    return [{ shell: shellPath, args: POSIX_ARGS, family: "posix" }];
  }

  if (platform === "win32") {
    if (env.SHELL && pathExists(env.SHELL)) {
      pushUniqueShell(candidates, { shell: env.SHELL, args: POSIX_ARGS, family: "posix" });
    }

    const pwshPaths = [
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    ];
    for (const shellPath of pwshPaths) {
      if (pathExists(shellPath)) {
        pushUniqueShell(candidates, { shell: shellPath, args: POWERSHELL_ARGS, family: "powershell" });
      }
    }

    pushUniqueShell(candidates, { shell: "pwsh.exe", args: POWERSHELL_ARGS, family: "powershell" });
    pushUniqueShell(candidates, { shell: "powershell.exe", args: POWERSHELL_ARGS, family: "powershell" });

    if (env.ComSpec && env.ComSpec.trim()) {
      pushUniqueShell(candidates, { shell: env.ComSpec.trim(), args: CMD_ARGS, family: "cmd" });
    }
    pushUniqueShell(candidates, { shell: "cmd.exe", args: CMD_ARGS, family: "cmd" });
    return candidates;
  }

  if (env.SHELL && pathExists(env.SHELL)) {
    pushUniqueShell(candidates, { shell: env.SHELL, args: POSIX_ARGS, family: "posix" });
  }
  if (pathExists("/bin/bash")) {
    pushUniqueShell(candidates, { shell: "/bin/bash", args: POSIX_ARGS, family: "posix" });
  }
  pushUniqueShell(candidates, { shell: "bash", args: POSIX_ARGS, family: "posix" });
  return candidates;
}

function createTrackedShellOperations(resolveCandidates: () => ShellConfig[], validateSpawn?: () => boolean): BashOperations {
  return {
    exec: (command, cwd, { onData, signal, timeout, env }) => {
      return new Promise((resolve, reject) => {
        (async () => {
          let shellCandidates: ShellConfig[];
          try {
            shellCandidates = resolveCandidates();
          } catch (error) {
            reject(error as Error);
            return;
          }

          if (!existsSync(cwd)) {
            reject(new Error(`Working directory does not exist: ${cwd}\nCannot execute shell commands.`));
            return;
          }

          let resolvedEnv: NodeJS.ProcessEnv;
          let resolvedCommand: string;
          try {
            resolvedEnv = await buildInjectedShellEnv({
              explicitEnv: env,
              includeProcessEnv: true,
              referencedTexts: [command],
            });
            resolvedCommand = await resolveKeychainPlaceholders(command);
          } catch (error) {
            reject(error as Error);
            return;
          }

          let timedOut = false;
          let aborted = false;
          let child: ReturnType<typeof spawn> | null = null;
          let settled = false;
          let attemptedShells: string[] = [];
          let emittedBytes = 0;
          let outputTruncated = false;
          const spoolCompatibility = createBashSpoolCompatibilityState();

          let timeoutHandle: NodeJS.Timeout | undefined;
          const onAbort = () => {
            aborted = true;
            if (child?.pid) {
              killProcessTree(child.pid);
            }
          };
          const cleanup = () => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (signal) signal.removeEventListener("abort", onAbort);
            if (child?.pid) unregisterProcess(child.pid);
          };

          if (timeout !== undefined && timeout > 0) {
            timeoutHandle = setTimeout(() => {
              timedOut = true;
              if (child?.pid) {
                killProcessTree(child.pid);
              }
            }, timeout * 1000);
          }

          if (signal) {
            if (signal.aborted) {
              onAbort();
            } else {
              signal.addEventListener("abort", onAbort, { once: true });
            }
          }

          const settleError = (err: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
          };

          const settleSuccess = (exitCode: number | null) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ exitCode });
          };

          const emitChunk = (text: string) => {
            if (!text || outputTruncated || settled) return;
            const buffer = Buffer.from(text, "utf8");
            const remaining = TRACKED_BASH_OUTPUT_LIMIT_BYTES - emittedBytes;
            if (remaining <= 0) {
              onData(Buffer.from(TRACKED_BASH_OUTPUT_TRUNCATION_NOTICE, "utf8"));
              outputTruncated = true;
              return;
            }
            if (buffer.length <= remaining) {
              emittedBytes += buffer.length;
              onData(buffer);
              return;
            }

            onData(buffer.subarray(0, remaining));
            emittedBytes += remaining;
            onData(Buffer.from(TRACKED_BASH_OUTPUT_TRUNCATION_NOTICE, "utf8"));
            outputTruncated = true;
          };

          const trySpawn = (candidateIndex: number) => {
            if (settled) return;
            const candidate = shellCandidates[candidateIndex];
            if (!candidate) {
              const attempted = attemptedShells.length > 0 ? attemptedShells.join(", ") : "(none)";
              settleError(new Error(`No supported shell found. Tried: ${attempted}`));
              return;
            }

            // This fence must stay synchronous and outside shell-unavailable retry
            // handling: denial is terminal, never a reason to try another shell.
            if (aborted || signal?.aborted) {
              settleError(new Error("aborted"));
              return;
            }
            if (validateSpawn) {
              let outcome: unknown;
              try {
                outcome = validateSpawn();
                if (outcome !== true) {
                  // Observe invalid async results without awaiting admission. This
                  // also contains rejecting thenables and throwing then getters.
                  Promise.resolve(outcome).then(() => undefined, () => undefined);
                }
              } catch {
                // Authority exceptions may contain credentials; never export them.
                settleError(new Error("Bash execution no longer authorized"));
                return;
              }
              if (outcome !== true) {
                settleError(new Error("Bash execution no longer authorized"));
                return;
              }
            }
            // The callback itself may synchronously abort the invocation.
            if (signal?.aborted) {
              settleError(new Error("aborted"));
              return;
            }
            attemptedShells.push(candidate.shell);
            const spawned = spawn(candidate.shell, [...candidate.args, resolvedCommand], {
              cwd,
              detached: shouldDetachChildProcess(process.platform),
              env: resolvedEnv,
              stdio: ["ignore", "pipe", "pipe"],
            });
            child = spawned;

            if (spawned.pid) {
              registerProcess(spawned.pid);
            }

            let shellUnavailable = false;
            let exited = false;
            let exitCode: number | null = null;
            let stdoutEnded = !spawned.stdout;
            let stderrEnded = !spawned.stderr;
            let postExitTimer: NodeJS.Timeout | undefined;

            const clearPostExitTimer = () => {
              if (postExitTimer) clearTimeout(postExitTimer);
              postExitTimer = undefined;
            };

            const cleanupSpawnedListeners = () => {
              clearPostExitTimer();
              spawned.stdout?.removeListener("data", onData);
              spawned.stderr?.removeListener("data", onData);
              spawned.stdout?.removeListener("end", onStdoutEnd);
              spawned.stderr?.removeListener("end", onStderrEnd);
              spawned.removeListener("error", onError);
              spawned.removeListener("exit", onExit);
              spawned.removeListener("close", onClose);
            };

            const finalizeExitedProcess = (code: number | null) => {
              cleanupSpawnedListeners();
              if (spawned.pid) unregisterProcess(spawned.pid);
              if (shellUnavailable) return;

              if (aborted || signal?.aborted) {
                settleError(new Error("aborted"));
                return;
              }

              if (timedOut) {
                settleError(new Error(`timeout:${timeout}`));
                return;
              }

              settleSuccess(code);
            };

            const maybeFinalizeAfterExit = () => {
              if (exited && stdoutEnded && stderrEnded) {
                finalizeExitedProcess(exitCode);
              }
            };

            const armPostExitIdleTimer = () => {
              clearPostExitTimer();
              postExitTimer = setTimeout(() => finalizeExitedProcess(exitCode), TRACKED_BASH_POST_EXIT_STDIO_IDLE_GRACE_MS);
            };

            function onData(chunk: Buffer) {
              if (settled) return;
              try {
                prepareBashSpoolTempDirForChunk(spoolCompatibility, chunk);
              } catch (error) {
                cleanupSpawnedListeners();
                if (spawned.pid) unregisterProcess(spawned.pid);
                if (spawned.pid) killProcessTree(spawned.pid);
                settleError(error as Error);
                return;
              }

              emitChunk(chunk.toString("utf8"));
              if (exited && !settled) armPostExitIdleTimer();
            }

            function onStdoutEnd() {
              stdoutEnded = true;
              maybeFinalizeAfterExit();
            }

            function onStderrEnd() {
              stderrEnded = true;
              maybeFinalizeAfterExit();
            }

            function onError(err: Error) {
              cleanupSpawnedListeners();
              if (spawned.pid) unregisterProcess(spawned.pid);
              const errWithCode = err as NodeJS.ErrnoException;
              if (!settled && errWithCode.code === "ENOENT") {
                shellUnavailable = true;
                trySpawn(candidateIndex + 1);
                return;
              }
              settleError(err);
            }

            function onExit(code: number | null) {
              exited = true;
              exitCode = code;
              maybeFinalizeAfterExit();
              if (!settled) armPostExitIdleTimer();
            }

            function onClose(code: number | null) {
              finalizeExitedProcess(code);
            }

            spawned.stdout?.on("data", onData);
            spawned.stderr?.on("data", onData);
            spawned.stdout?.once("end", onStdoutEnd);
            spawned.stderr?.once("end", onStderrEnd);
            spawned.once("error", onError);
            spawned.once("exit", onExit);
            spawned.once("close", onClose);
          };

          trySpawn(0);
        })();
      });
    },
  };
}

/** Create host-shell tool operations with child process tracking and keychain resolution. */
export function createTrackedBashOperations(options: TrackedBashOperationsOptions = {}): BashOperations {
  return createTrackedShellOperations(() => {
    const shellPath = typeof options.shellPath === "function" ? options.shellPath() : options.shellPath;
    return resolveShellCandidates({ shellPath });
  }, options.validateSpawn);
}

/** Create Windows PowerShell-only tool operations. */
export function createTrackedPowerShellOperations(): BashOperations {
  return createTrackedShellOperations(() => resolveShellCandidates().filter((entry) => entry.family === "powershell"));
}
