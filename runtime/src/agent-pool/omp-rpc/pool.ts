/**
  * agent-pool/omp-rpc/pool.ts – Pool of omp RPC subprocess clients keyed by
  * chat JID, exposing a runAgent() compatible with AgentPool's contract.
  *
  * One pooled `omp --mode rpc` child process per chat (lazily spawned on first
  * use, idle-evicted alongside pi sessions, disposed at shutdown). Inbound
  * session-event frames stream through a per-chat dispatch that ALWAYS records
  * token usage and additionally forwards to the active run's onEvent /
  * onTurnComplete sinks. Message-row persistence stays at the channel layer;
  * this pool handles streaming, usage recording, and result extraction only.
  */
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { ensureNamedSessionDir } from "../session.js";
import { recordSessionEventUsage } from "../usage.js";
import type { AgentOutput, RunAgentOptions } from "../contracts.js";
import type { Usage } from "@earendil-works/pi-ai";
import { OmpRpcClient } from "./client.js";
import { bridgeOmpFrameToAgentSessionEvent, extractFinalAssistantText } from "./event-bridge.js";
import { harvestOmpHostTools, type CapturedTool } from "./host-tools.js";
import type { RpcHostToolDefinition, RpcSessionEventFrame } from "./rpc-protocol-types.js";
import { createLogger, debugSuppressedError } from "../../utils/logger.js";

const log = createLogger("agent-pool.omp-rpc.pool");

export class OmpRpcPool {
  private readonly ompBin: string;
  private clients = new Map<string, { client: OmpRpcClient; lastUsed: number }>();
  private createInFlight = new Map<string, Promise<OmpRpcClient>>();
  private activeListeners = new Map<string, (frame: RpcSessionEventFrame) => void>();
  private tools: { definitions: RpcHostToolDefinition[]; execute: Map<string, CapturedTool> } | null = null;

  constructor(
    private readonly deps: {
      workspaceDir: string;
      modelRuntime: ModelRuntime;
      onInfo: (message: string, details: Record<string, unknown>) => void;
      onWarn: (message: string, details: Record<string, unknown>) => void;
      onError: (message: string, details: Record<string, unknown>) => void;
    },
  ) {
    this.ompBin =
      process.env.PICLAW_OMP_BIN?.trim() ||
      Bun.which("omp") ||
      join(homedir(), ".bun", "bin", process.platform === "win32" ? "omp.exe" : "omp");
  }

  /** Harvest piclaw's builtin tools once; reused for every spawned client. */
  private getTools(): { definitions: RpcHostToolDefinition[]; execute: Map<string, CapturedTool> } {
    if (!this.tools) {
      this.tools = harvestOmpHostTools(this.deps.modelRuntime);
    }
    return this.tools;
  }

  /** Return the pooled client for a chat, spawning + handshaking it on first use. */
  async getOrCreate(chatJid: string): Promise<OmpRpcClient> {
    const cached = this.clients.get(chatJid);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached.client;
    }
    const inFlight = this.createInFlight.get(chatJid);
    if (inFlight) return inFlight;

    const createPromise = (async (): Promise<OmpRpcClient> => {
      const sessionDir = ensureNamedSessionDir(chatJid, "omp-rpc");
      mkdirSync(sessionDir, { recursive: true });
      this.deps.onInfo("Spawning omp RPC process", {
        operation: "omp_rpc.spawn",
        chatJid,
        bin: this.ompBin,
        sessionDir,
      });
      const client = await OmpRpcClient.spawn({
        bin: this.ompBin,
        workspaceDir: this.deps.workspaceDir,
        sessionDir,
        tools: this.getTools(),
        onSessionEvent: (frame) => this.dispatchSessionEvent(chatJid, frame),
        onWarn: (message, details) => this.deps.onWarn(message, details),
      });
      this.clients.set(chatJid, { client, lastUsed: Date.now() });
      return client;
    })();
    this.createInFlight.set(chatJid, createPromise);
    try {
      return await createPromise;
    } finally {
      this.createInFlight.delete(chatJid);
    }
  }

  /**
    * Per-client session-event sink. Usage recording is unconditional (mirrors
    * installSessionUsageRecorder's try/warn pattern); the bridged-event forward
    * only happens while a run has a listener registered.
    */
  private dispatchSessionEvent(chatJid: string, frame: RpcSessionEventFrame): void {
    try {
      recordSessionEventUsage(chatJid, frame);
    } catch (err) {
      this.deps.onWarn("Failed to persist session usage metadata", {
        operation: "session_usage_recorder.record_event_usage",
        chatJid,
        eventType: frame.type,
        err,
      });
    }
    this.activeListeners.get(chatJid)?.(frame);
  }

  /** Run one prompt turn through the chat's omp process, bridging events into the caller's sinks. */
  async runAgent(prompt: string, chatJid: string, options: RunAgentOptions): Promise<AgentOutput> {
    const client = await this.getOrCreate(chatJid);
    let pendingAssistant: { message: Record<string, unknown>; pendingToolUse: boolean } | null = null;
    const flushPending = () => {
      if (!pendingAssistant) return;
      const entry = pendingAssistant;
      pendingAssistant = null;
      const turnUsage: Usage | undefined =
        "usage" in entry.message && entry.message.usage !== null && typeof entry.message.usage === "object"
          ? (entry.message.usage as Usage)
          : undefined;
      options.onTurnComplete?.({
        text: extractFinalAssistantText([entry.message]) ?? "",
        attachments: [],
        usage: turnUsage,
        followedByToolUse: entry.pendingToolUse,
      });
    };
    this.activeListeners.set(chatJid, (frame) => {
      const bridged = bridgeOmpFrameToAgentSessionEvent(frame);
      if (bridged) options.onEvent?.(bridged);
      // Mirror the pi session's commit contract: an assistant message commits
      // via onTurnComplete only when tool dispatch follows (followedByToolUse).
      // The FINAL message is persisted once by channel-layer finalization from
      // AgentOutput.result — committing it here too would duplicate the row.
      if (frame.type === "message_end") {
        const message = frame.message;
        if (message && typeof message === "object" && message.role === "assistant") {
          pendingAssistant = { message, pendingToolUse: false };
        }
      } else if (frame.type === "tool_execution_start") {
        if (pendingAssistant) {
          pendingAssistant.pendingToolUse = true;
          flushPending();
        }
      }
    });
    try {
      const messages = await client.prompt(prompt);
      // Clear any pending state without committing: the final assistant
      // message is persisted exactly once by channel-layer finalization from
      // AgentOutput.result (a commit here would duplicate it).
      pendingAssistant = null;
      const cached = this.clients.get(chatJid);
      if (cached) cached.lastUsed = Date.now();
      return { status: "success", result: extractFinalAssistantText(messages) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.onError("omp agent run failed", {
        operation: "omp_rpc.run_agent",
        chatJid,
        errorMessage: message,
      });
      return { status: "error", result: null, error: message };
    } finally {
      // The client stays pooled; only the per-run listener is released.
      this.activeListeners.delete(chatJid);
    }
  }

  /** Dispose pooled clients idle past the TTL that have no active run. */
  evictIdle(idleTtlMs: number): void {
    const now = Date.now();
    for (const [chatJid, entry] of this.clients) {
      if (now - entry.lastUsed <= idleTtlMs) continue;
      if (this.activeListeners.has(chatJid)) continue;
      this.clients.delete(chatJid);
      this.deps.onInfo("Evicting idle omp RPC client", {
        operation: "omp_rpc.evict_idle",
        chatJid,
        idleMs: now - entry.lastUsed,
      });
      entry.client.dispose().catch((error) => { debugSuppressedError(log, "Idle omp RPC client dispose failed during eviction.", error, { chatJid }); });
    }
  }

  /** Dispose every pooled client; called from AgentPool.shutdown(). */
  async dispose(): Promise<void> {
    const entries = [...this.clients.values()];
    this.clients.clear();
    this.createInFlight.clear();
    this.activeListeners.clear();
    for (const entry of entries) {
      try {
        await entry.client.dispose();
      } catch (error) {
        // Best-effort per client; keep disposing the rest.
        debugSuppressedError(log, "omp RPC client dispose failed during pool shutdown.", error);
      }
    }
  }
}
