/**
  * agent-pool/omp-rpc/client.ts – Subprocess client for one `omp --mode rpc`
  * process, speaking omp's newline-delimited-JSON protocol over stdin/stdout.
  *
  * Responsibilities: spawn + ready handshake, `set_host_tools` bootstrap,
  * command/response correlation by id, streaming session-event forwarding,
  * host_tool_call dispatch into piclaw's captured tools (with host_tool_update
  * partials and host_tool_cancel aborts), and graceful shutdown via stdin EOF
  * (omp exits on stdin close per rpc-mode.ts) with a kill fallback.
  *
  * Wire shapes verified against D:/oh-my-pi/packages/coding-agent/src/modes/rpc/.
  */
import { createUuid } from "../../utils/ids.js";
import { createLogger } from "../../utils/logger.js";

import type { CapturedTool } from "./host-tools.js";
import type {
  RpcCommand,
  RpcHostToolCallFrame,
  RpcHostToolCancelFrame,
  RpcHostToolDefinition,
  RpcHostToolResult,
  RpcResponseFrame,
  RpcSessionEventFrame,
} from "./rpc-protocol-types.js";

const log = createLogger("agent-pool.omp-rpc.client");

/** Session-event frame types forwarded to the onSessionEvent callback. */
const SESSION_EVENT_TYPES: Record<string, true> = {
  agent_start: true,
  agent_end: true,
  turn_start: true,
  turn_end: true,
  message_start: true,
  message_update: true,
  message_end: true,
  tool_execution_start: true,
  tool_execution_update: true,
  tool_execution_end: true,
};

export interface OmpRpcClientSpawnOptions {
  /** Resolved omp binary path (Bun.which("omp") or PICLAW_OMP_BIN). */
  bin: string;
  /** Working directory for the omp process. */
  workspaceDir: string;
  /** Per-chat omp session directory (ensureNamedSessionDir output). */
  sessionDir: string;
  /** Harvested piclaw tools: wire definitions + executors for host_tool_call dispatch. */
  tools: { definitions: RpcHostToolDefinition[]; execute: Map<string, CapturedTool> };
  /** Streaming session-event sink, called once per session-event frame in arrival order. */
  onSessionEvent: (frame: RpcSessionEventFrame) => void;
  /** Non-fatal protocol warnings (e.g. unparseable stdout lines). */
  onWarn?: (message: string, details: Record<string, unknown>) => void;
}

type PendingCommand = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type ActiveTurn = { resolve: (messages: unknown[]) => void; reject: (error: Error) => void };

export class OmpRpcClient {
  private readonly child: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private readonly tools: OmpRpcClientSpawnOptions["tools"];
  private readonly onSessionEvent: (frame: RpcSessionEventFrame) => void;
  private readonly onWarn: (message: string, details: Record<string, unknown>) => void;

  private readonly pending = new Map<string, PendingCommand>();
  private readonly hostToolCalls = new Map<string, AbortController>();
  private activeTurn: ActiveTurn | null = null;

  private readonly readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readySettled = false;

  private stdinClosed = false;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;

  private constructor(child: Bun.Subprocess<"pipe", "pipe", "pipe">, opts: OmpRpcClientSpawnOptions) {
    this.child = child;
    this.tools = opts.tools;
    this.onSessionEvent = opts.onSessionEvent;
    this.onWarn = opts.onWarn ?? ((message, details) => log.warn(message, details));

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // The handshake waiter (spawn) owns this promise; avoid unhandled-rejection noise on early exit.
    void this.readyPromise.catch(() => { });

    void this.readStdout();
    void this.drainStderr();
    void this.child.exited.then((exitCode) => this.handleExit(exitCode));
  }

  /** Spawn an omp RPC child, await its ready frame, then register piclaw's host tools. */
  static async spawn(opts: OmpRpcClientSpawnOptions): Promise<OmpRpcClient> {
    const child = Bun.spawn([opts.bin, "--mode", "rpc", "--cwd", opts.workspaceDir, "--session-dir", opts.sessionDir], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      cwd: opts.workspaceDir,
    });
    const client = new OmpRpcClient(child, opts);

    // omp writes {"type":"ready"} as the first stdout line; never send commands before it.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.readyPromise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("omp RPC ready frame not received")), 60_000);
        }),
      ]);
    } catch (error) {
      try {
        child.kill();
      } catch {
        // already dead
      }
      client.rejectAll(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      clearTimeout(timer);
    }

    // Bootstrap: register host tools before any prompt. success:false rejects via response dispatch.
    await client.sendCommand({ type: "set_host_tools", tools: opts.tools.definitions });
    log.info("omp RPC process ready", {
      bin: opts.bin,
      workspaceDir: opts.workspaceDir,
      sessionDir: opts.sessionDir,
      hostTools: opts.tools.definitions.length,
    });
    return client;
  }

  /** Send a command and await its correlated response frame. */
  async sendCommand(command: RpcCommand): Promise<unknown> {
    if (this.disposed) throw new Error("omp RPC client is disposed");
    const id = createUuid("omp-rpc");
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.writeLine({ ...command, id });
    return response;
  }

  /**
    * Run one prompt turn. The prompt response only confirms acceptance; the turn
    * completes when the streamed agent_end frame arrives. Resolves with agent_end's
    * messages array; rejects if the process exits first.
    */
  async prompt(message: string): Promise<unknown[]> {
    if (this.disposed) throw new Error("omp RPC client is disposed");
    if (this.activeTurn) throw new Error("omp RPC turn already in progress");
    let resolveTurn!: (messages: unknown[]) => void;
    let rejectTurn!: (error: Error) => void;
    const turnPromise = new Promise<unknown[]>((resolve, reject) => {
      resolveTurn = resolve;
      rejectTurn = reject;
    });
    // Guard against unhandled rejection if the send fails before we start awaiting.
    void turnPromise.catch(() => { });
    this.activeTurn = { resolve: resolveTurn, reject: rejectTurn };
    try {
      await this.sendCommand({ type: "prompt", message });
    } catch (error) {
      this.activeTurn = null;
      throw error;
    }
    try {
      return await turnPromise;
    } finally {
      this.activeTurn = null;
    }
  }

  /** Idempotent shutdown: close stdin (omp exits on EOF), kill after a 3s grace period. */
  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = this.performDispose();
    return this.disposePromise;
  }

  private async performDispose(): Promise<void> {
    this.disposed = true;
    this.stdinClosed = true;
    try {
      await this.child.stdin.end();
    } catch {
      // stdin already closed
    }
    const exited = await Promise.race([
      this.child.exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 3000)),
    ]);
    if (!exited) {
      try {
        this.child.kill();
      } catch {
        // already dead
      }
      await this.child.exited.catch(() => { });
    }
    this.rejectAll(new Error("omp RPC client disposed"));
  }

  /** Write one ndjson frame to child stdin; never throws (closed stdin is a no-op). */
  private writeLine(obj: unknown): void {
    if (this.stdinClosed) return;
    try {
      const written = this.child.stdin.write(`${JSON.stringify(obj)}\n`);
      if (written instanceof Promise) written.catch(() => { this.stdinClosed = true; });
      const flushed = this.child.stdin.flush();
      if (flushed instanceof Promise) flushed.catch(() => { this.stdinClosed = true; });
    } catch {
      this.stdinClosed = true;
    }
  }

  /** Accumulate stdout bytes, split on newlines, dispatch each parsed frame. */
  private async readStdout(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    const reader = this.child.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          this.handleLine(line);
          newline = buffer.indexOf("\n");
        }
      }
      const tail = buffer.trim();
      if (tail) this.handleLine(tail);
    } catch (error) {
      this.onWarn("omp RPC stdout reader failed", { error: String(error) });
    }
  }

  /** Drain stderr and discard; log the first 4KB once for spawn diagnostics. */
  private async drainStderr(): Promise<void> {
    const decoder = new TextDecoder();
    const reader = this.child.stderr.getReader();
    let captured = "";
    let logged = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!logged) {
          captured += decoder.decode(value, { stream: true });
          if (captured.length >= 4096) {
            logged = true;
            log.warn("omp RPC stderr (first 4KB)", { stderr: captured.slice(0, 4096) });
          }
        }
      }
      if (!logged && captured.trim()) {
        log.warn("omp RPC stderr", { stderr: captured.slice(0, 4096) });
      }
    } catch {
      // stderr is diagnostics-only; discard failures
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      this.onWarn("Skipping unparseable omp RPC stdout line", { line: trimmed.slice(0, 200) });
      return;
    }
    this.dispatch(frame);
  }

  private dispatch(frame: Record<string, unknown>): void {
    switch (frame.type) {
      case "ready":
        if (!this.readySettled) {
          this.readySettled = true;
          this.readyResolve();
        }
        return;
      case "response":
        this.handleResponse(frame as unknown as RpcResponseFrame);
        return;
      case "prompt_result":
        // Acceptance signal only; the turn completes via agent_end.
        return;
      case "host_tool_call":
        this.handleHostToolCall(frame as unknown as RpcHostToolCallFrame);
        return;
      case "host_tool_cancel":
        this.hostToolCalls.get((frame as unknown as RpcHostToolCancelFrame).targetId)?.abort();
        return;
      default:
        if (typeof frame.type === "string" && SESSION_EVENT_TYPES[frame.type]) {
          const event = frame as unknown as RpcSessionEventFrame;
          this.onSessionEvent(event);
          if (event.type === "agent_end") {
            this.activeTurn?.resolve(event.messages);
          }
        }
    }
  }

  private handleResponse(frame: RpcResponseFrame): void {
    if (!frame.id) return;
    const entry = this.pending.get(frame.id);
    if (!entry) return;
    this.pending.delete(frame.id);
    if (frame.success) entry.resolve(frame.data);
    else entry.reject(new Error(frame.error || "omp RPC command failed"));
  }

  /** Execute one omp-requested host tool against piclaw's captured tool map. */
  private handleHostToolCall(frame: RpcHostToolCallFrame): void {
    const tool = this.tools.execute.get(frame.toolName);
    if (!tool) {
      log.warn("omp requested unknown host tool", { toolName: frame.toolName });
      this.writeLine({
        type: "host_tool_result",
        id: frame.id,
        result: { content: [{ type: "text", text: `Unknown tool: ${frame.toolName}` }] },
        isError: true,
      });
      return;
    }
    const controller = new AbortController();
    this.hostToolCalls.set(frame.toolCallId, controller);
    void (async () => {
      try {
        const result = await tool.execute(frame.toolCallId, frame.arguments, controller.signal, (partial) => {
          this.writeLine({
            type: "host_tool_update",
            id: frame.id,
            partialResult: partial as RpcHostToolResult["result"],
          });
        });
        this.writeLine({ type: "host_tool_result", id: frame.id, result, isError: false });
      } catch (error) {
        const message = (error as Error)?.message || "Tool execution failed";
        log.warn("omp host tool execution failed", { toolName: frame.toolName, error: message });
        this.writeLine({
          type: "host_tool_result",
          id: frame.id,
          result: { content: [{ type: "text", text: message }] },
          isError: true,
        });
      } finally {
        this.hostToolCalls.delete(frame.toolCallId);
      }
    })();
  }

  private handleExit(exitCode: number | null): void {
    this.stdinClosed = true;
    const error = new Error("omp process exited");
    if (!this.readySettled) {
      this.readySettled = true;
      this.readyReject(error);
    }
    // After a deliberate dispose() the pending maps are already drained by performDispose.
    if (!this.disposed) {
      this.disposed = true;
      this.rejectAll(error);
    }
    log.info("omp RPC process exited", { exitCode });
  }

  private rejectAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    if (this.activeTurn) {
      this.activeTurn.reject(error);
      this.activeTurn = null;
    }
  }
}
