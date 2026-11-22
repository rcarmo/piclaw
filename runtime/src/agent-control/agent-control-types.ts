/**
 * agent-control/agent-control-types.ts – Type definitions for the control command system.
 *
 * Defines the discriminated union AgentControlCommand (one variant per command
 * type like /model, /thinking, /abort, /tree, etc.) and the AgentControlResult
 * returned by command handlers.
 *
 * Consumers:
 *   - agent-control-parser.ts produces AgentControlCommand objects.
 *   - agent-control-handlers.ts consumes them and returns AgentControlResult.
 *   - agent-pool.ts, runtime/message-loop.ts, channels/web.ts use both types.
 */

/** Commands which require idle execution after the preceding turn. */
export const MODEL_COMMAND_TYPES = new Set(["model", "thinking", "cycle_model", "cycle_thinking"]);
export const DEFERRED_CONTROL_COMMAND_TYPES = new Set(["compact", ...MODEL_COMMAND_TYPES]);

/** Parsed control command variants accepted by the agent-control subsystem. */
export type AgentControlCommand =
  | {
      type: "model";
      provider?: string;
      modelId?: string;
      compact?: boolean;
      raw: string;
    }
  | {
      type: "thinking";
      level?: string;
      raw: string;
    }
  | {
      type: "commands";
      raw: string;
    }
  | {
      type: "restart";
      raw: string;
    }
  | {
      type: "exit";
      raw: string;
    }
  | {
      type: "shell";
      command?: string;
      raw: string;
    }
  | {
      type: "bash";
      command?: string;
      raw: string;
    }
  | {
      type: "queue";
      message?: string;
      raw: string;
    }
  | {
      type: "queue_all";
      message?: string;
      raw: string;
    }
  | {
      type: "steer";
      message?: string;
      raw: string;
    }
  | {
      type: "state";
      raw: string;
    }
  | {
      type: "stats";
      raw: string;
    }
  | {
      type: "context";
      raw: string;
    }
  | {
      type: "quota";
      raw: string;
    }
  | {
      type: "last";
      raw: string;
    }
  | {
      type: "compact";
      instructions?: string;
      raw: string;
    }
  | {
      type: "auto_compact";
      enabled?: boolean;
      raw: string;
    }
  | {
      type: "auto_retry";
      enabled?: boolean;
      raw: string;
    }
  | {
      type: "abort";
      raw: string;
    }
  | {
      type: "abort_retry";
      raw: string;
    }
  | {
      type: "abort_bash";
      raw: string;
    }
  | {
      type: "cycle_model";
      direction?: "forward" | "backward";
      raw: string;
    }
  | {
      type: "cycle_thinking";
      raw: string;
    }
  | {
      type: "steering_mode";
      mode?: "all" | "one-at-a-time";
      raw: string;
    }
  | {
      type: "followup_mode";
      mode?: "all" | "one-at-a-time";
      raw: string;
    }
  | {
      type: "session_name";
      name?: string;
      raw: string;
    }
  | {
      type: "new_session";
      parent?: string;
      raw: string;
    }
  | {
      type: "switch_session";
      path?: string;
      raw: string;
    }
  | {
      type: "session_rotate";
      instructions?: string;
      raw: string;
    }
  | {
      type: "rollup";
      raw: string;
    }
  | {
      type: "fork";
      entryId?: string;
      raw: string;
    }
  | {
      type: "clone";
      raw: string;
    }
  | {
      type: "forks";
      raw: string;
    }
  | {
      type: "export_html";
      path?: string;
      raw: string;
    }
  | {
      type: "passkey";
      action?: "enrol" | "enroll" | "list" | "delete" | "remove";
      target?: string;
      raw: string;
    }
  | {
      type: "login";
      provider?: string;
      /** Constructed only by the owned provider surface, never by slash parsing. */
      interaction?: { step: "step1" | "step1method" | "step2" | "step3"; data: Record<string, unknown> };
      raw: string;
    }
  | {
      type: "logout";
      provider?: string;
      raw: string;
    }
  | {
      type: "totp";
      action?: "enrol" | "enroll" | "reset";
      /**
       * Confirmation value for reset operations.
       * Expected to be the current 6-digit TOTP code.
       */
      code?: string;
      raw: string;
    }
  | {
      type: "qr";
      text?: string;
      raw: string;
    }
  | {
      type: "search_workspace";
      query?: string;
      scope?: "notes" | "skills" | "all";
      limit?: number;
      offset?: number;
      refresh?: boolean;
      max_kb?: number;
      raw: string;
    }
  | {
      type: "tree";
      targetId?: string;
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
      limit?: number;
      offset?: number;
      mode?: "head" | "tail";
      raw: string;
    }
  | {
      type: "label";
      targetId?: string;
      label?: string;
      raw: string;
    }
  | {
      type: "labels";
      raw: string;
    }
  | {
      type: "agent_name";
      name?: string;
      raw: string;
    }
  | {
      type: "agent_avatar";
      avatar?: string;
      raw: string;
    }
  | {
      type: "user_name";
      name?: string;
      raw: string;
    }
  | {
      type: "user_avatar";
      avatar?: string;
      raw: string;
    }
  | {
      type: "user_github";
      profile?: string;
      raw: string;
    };

/** Result returned by command handlers: status, message, and optional side-effects. */
export interface AgentControlResult {
  status: "success" | "error";
  message: string;
  messages?: Array<{ role: string; text: string; customType?: string }>;
  refresh_runtime?: boolean;
  queued_followup?: boolean;
  queued_steer?: boolean;
  /** A steer lost its active stream race and should be retried as a normal follow-up. */
  retry_as_followup?: boolean;
  model_label?: string | null;
  /** Active Pi session identity after the command completes. */
  sessionGeneration?: string;
  /** True only when the command replaced the active Pi session. */
  sessionGenerationChanged?: boolean;
  thinking_level?: string | null;
  thinking_level_label?: string | null;
  rolled_up_to?: string;
  source_chat_jid?: string;
  /** Optional media attachment ids to include with the response message. */
  mediaIds?: number[];
  /** Optional adaptive card content blocks to include with the response message. */
  contentBlocks?: unknown[];
  /** Sensitive provider UI data: direct authenticated response only, never timeline content. */
  authPresentation?: {
    expires_at: number;
    events: import("@earendil-works/pi-ai").AuthEvent[];
    prompt: Omit<import("@earendil-works/pi-ai").AuthPrompt, "signal"> | null;
  };
  /** Fresh context indicator payload to broadcast after commands that rewrite context. */
  contextUsage?: {
    /** Internal reader hint; public projections translate it to replacement semantics. */
    tokensAreAuthoritative?: true;
    tokens: number | null;
    contextWindow: number | null;
    percent: number | null;
    sessionGeneration?: string;
    estimated?: boolean;
    source?: string;
    phase?: string;
  };
}
