/**
 * send-adaptive-card – dedicated internal tool for posting web Adaptive Cards as agent messages.
 */
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { getChatJid } from "../core/chat-context.js";
import { postMessagesToolMessage } from "./messages-crud.js";

const SendAdaptiveCardSchema = Type.Object({
  content: Type.String({ description: "Human-readable fallback message / timeline text." }),
  card_id: Type.String({ description: "Stable card identifier." }),
  payload: Type.Unknown({ description: "Adaptive Card payload object (payload.type should be AdaptiveCard)." }),
  chat_jid: Type.Optional(Type.String({ description: "Target chat JID (defaults to current chat)." })),
  schema_version: Type.Optional(Type.String({ description: "Top-level PiClaw adaptive-card schema version (default 1.5)." })),
  fallback_text: Type.Optional(Type.String({ description: "Fallback text stored on the content block (defaults to content)." })),
  state: Type.Optional(
    Type.Union([
      Type.Literal("active"),
      Type.Literal("completed"),
      Type.Literal("cancelled"),
      Type.Literal("failed"),
    ], { description: "Initial card state (default active)." }),
  ),
  submit_behavior: Type.Optional(
    Type.Union([
      Type.Literal("keep_active"),
    ], { description: "Optional submit behavior for iterative cards." }),
  ),
  completed_at: Type.Optional(Type.String({ description: "Completion timestamp for completed cards." })),
  last_submission: Type.Optional(Type.Unknown({ description: "Optional last_submission metadata for terminal-state cards." })),
});

const HINT = [
  "## Adaptive Card posting",
  "Use send_adaptive_card to post a PiClaw web Adaptive Card as an agent message.",
  "Prefer this over generic message posting when you need a real agent-owned adaptive_card content block.",
].join("\n");

type SendAdaptiveCardParams = {
  content: string;
  card_id: string;
  payload: unknown;
  chat_jid?: string;
  schema_version?: string;
  fallback_text?: string;
  state?: "active" | "completed" | "cancelled" | "failed";
  submit_behavior?: "keep_active";
  completed_at?: string;
  last_submission?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function buildResultError(message: string): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: "text", text: message }],
    details: { posted: 0, error: message },
  };
}

/** Dedicated tool for posting agent-owned Adaptive Cards to the web timeline. */
export const sendAdaptiveCard: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${HINT}`,
  }));

  pi.registerTool({
    name: "send_adaptive_card",
    label: "send_adaptive_card",
    description: "Post a PiClaw web Adaptive Card as an agent message.",
    promptSnippet: "send_adaptive_card: post an agent-owned adaptive_card content block to web timeline.",
    parameters: SendAdaptiveCardSchema,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    async execute(_toolCallId, params: SendAdaptiveCardParams) {
      const content = params.content?.trim();
      if (!content) return buildResultError("Provide content.");

      const cardId = params.card_id?.trim();
      if (!cardId) return buildResultError("Provide card_id.");

      if (!isRecord(params.payload)) {
        return buildResultError("payload must be an object.");
      }
      if (params.payload.type !== "AdaptiveCard") {
        return buildResultError("payload.type must be 'AdaptiveCard'.");
      }

      const block: Record<string, unknown> = {
        type: "adaptive_card",
        card_id: cardId,
        schema_version: params.schema_version?.trim() || "1.5",
        state: params.state || "active",
        fallback_text: params.fallback_text?.trim() || content,
        payload: params.payload,
      };

      if (params.submit_behavior) block.submit_behavior = params.submit_behavior;
      if (params.completed_at) block.completed_at = params.completed_at;
      if (isRecord(params.last_submission)) block.last_submission = params.last_submission;

      // Resolve chat target: prefer explicit param, then ambient context, then fail.
      // Never silently post to a synthetic default chat.
      const ambientChat = getChatJid("");
      const chatJid = params.chat_jid?.trim() || ambientChat || "";
      if (!chatJid) {
        return buildResultError("Cannot determine the active web chat. Provide chat_jid explicitly.");
      }
      const result = postMessagesToolMessage(
        {
          action: "post",
          type: "agent",
          chat_jid: chatJid,
          content,
          content_blocks: [block],
        },
        chatJid,
      );

      return {
        ...result,
        terminate: true,
        details: {
          ...(isRecord(result.details) ? result.details : {}),
          tool: "send_adaptive_card",
          card_id: cardId,
          chat_jid: chatJid,
        },
      };
    },
  });
};
