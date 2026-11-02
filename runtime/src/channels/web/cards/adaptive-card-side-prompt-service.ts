import { getDb } from "../../../db/connection.js";
import { admitSqliteWrite } from "../../../db/sqlite-async-admission.js";
import { captureWebRequestAuthority } from "../auth/auth-gateway.js";
import {
  DEFAULT_WEB_USER_ID,
  createWebSession,
  deleteAllWebSessions,
  getMessageByAnyRowId,
  getMessageByRowId,
  replaceMessageContent,
} from "../../../db.js";
import { setWebTotpSecret } from "../../../core/config.js";
import { isSingleUserAccess } from "../../../core/config-access.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import type { SendMessageOptions } from "../message-write-service.js";
import {
  buildAdaptiveCardSubmissionText,
  buildAdaptiveCardSubmitBlock,
  getAdaptiveCardSubmitBehavior,
  getAdaptiveCardSubmitState,
  getAdaptiveCardTestFailure,
  markAdaptiveCardState,
  sanitizeAdaptiveCardActionPayload,
  sanitizeAdaptiveCardSubmissionData,
  type AdaptiveCardActionPayload,
} from "./adaptive-card-actions.js";
import { randomSessionToken, verifyTotp } from "../auth/auth.js";
import type { InteractionRow } from "../../../db.js";
import { parseJsonObjectRequest } from "../json-body.js";
import { hashTotpSecret, parseTotpCardToken } from "../auth/totp-card.js";
import { handleAgentMessage as handleAgentMessageRequest } from "../handlers/agent.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { runAddonAdaptiveCardIntent } from "../../../addons/runtime-contributions.js";
import type { AgentControlResult } from "../../../agent-control/agent-control-types.js";
import { withPrivateProviderAuthResponse, commitPrivateProviderAuthResponse } from "../../../agent-control/handlers/login.js";

const log = createLogger("web");
const SIDE_PROMPT_STREAM_HEARTBEAT_MS = 30000;

type SidePromptResult = {
  status: "success" | "error";
  result: string | null;
  thinking: string | null;
  model: string | null;
  stopReason?: string;
  error?: string;
};

type SidePromptOptions = {
  systemPrompt?: string;
  signal?: AbortSignal;
  onThinkingDelta?: (delta: string) => void;
  onTextDelta?: (delta: string) => void;
};

type SidePromptAgentPoolLike = {
  runSidePrompt?: (chatJid: string, prompt: string, options?: SidePromptOptions) => Promise<SidePromptResult>;
  applyControlCommand?: (chatJid: string, command: { type: "login"; provider: string; raw: string }) => Promise<{
    status: string;
    message: string;
    contentBlocks?: unknown[];
    model_label?: string | null;
    thinking_level?: string | null;
    authPresentation?: AgentControlResult["authPresentation"];
  }>;
  getAvailableModels?: (chatJid: string) => Promise<{
    current?: string | null;
    thinking_level?: string | null;
    supports_thinking?: boolean;
  }>;
  getCurrentModelLabel?: (chatJid: string) => Promise<string | null>;
};

interface JsonResponder {
  json(payload: unknown, status?: number): Response;
}

interface AuthGatewayLike extends Partial<Pick<WebChannelLike["authGateway"], "isAuthEnabled" | "isInternalSecretEnabled" | "verifyInternalSecret" | "getPrincipal">> {
  setTotpSecret(secret: string): void;
  createTotpContext(): {
    buildSessionCookie(sessionToken: string, req: Request): string;
  };
}

interface InteractionBroadcasterLike {
  broadcastInteractionUpdated(interaction: InteractionRow): void;
}

export interface WebAdaptiveCardSidePromptServiceOptions extends JsonResponder {
  defaultChatJid: string;
  defaultAgentId: string;
  webRuntimeConfig: {
    debugCardSubmissions?: boolean;
    sessionTtl?: number;
    totpSecret?: string;
    totpWindow?: number;
  };
  agentPool: SidePromptAgentPoolLike;
  authGateway: AuthGatewayLike;
  interactionBroadcaster: InteractionBroadcasterLike;
  sendMessage(chatJid: string, text: string, options?: SendMessageOptions): Promise<void>;
  broadcastEvent(eventType: string, data: unknown): void;
  forwardAgentMessage(req: Request, pathname: string, chatJid: string, agentId: string): Promise<Response>;
}

export interface WebAdaptiveCardSidePromptChannelLike extends JsonResponder {
  agentPool?: SidePromptAgentPoolLike;
  authGateway?: AuthGatewayLike;
  interactionBroadcaster?: InteractionBroadcasterLike;
  sendMessage?: (chatJid: string, text: string, options?: SendMessageOptions) => Promise<void>;
  broadcastEvent?: (eventType: string, data: unknown) => void;
}

function failMissingDependency(name: string): never {
  throw new Error(`Missing Web adaptive-card/side-prompt dependency: ${name}`);
}

function formatSseEvent(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

function parseSidePromptPayload(payload: { prompt?: string; system_prompt?: string; chat_jid?: string }, defaultChatJid: string): {
  prompt: string;
  systemPrompt: string;
  chatJid: string;
} {
  return {
    prompt: typeof payload.prompt === "string" ? payload.prompt.trim() : "",
    systemPrompt: typeof payload.system_prompt === "string" ? payload.system_prompt.trim() : "",
    chatJid: typeof payload.chat_jid === "string" && payload.chat_jid.trim() ? payload.chat_jid.trim() : defaultChatJid,
  };
}

function buildRecoveryResumePrompt(): string {
  return "Continue the previous answer from the last partial output, without repeating completed parts. Use the current session state, recover continuity cleanly, and do not rerun side-effecting tools.";
}

function buildRecoveryRetryCleanPrompt(): string {
  return "Retry the previous request cleanly as a new isolated run. Do not continue the partial answer inline. Re-answer from the current session state as a fresh attempt, and do not rerun side-effecting tools automatically.";
}

export function createWebAdaptiveCardSidePromptService(
  channel: WebAdaptiveCardSidePromptChannelLike,
  options: {
    defaultChatJid: string;
    defaultAgentId: string;
    webRuntimeConfig?: WebAdaptiveCardSidePromptServiceOptions["webRuntimeConfig"];
  },
): WebAdaptiveCardSidePromptService {
  return new WebAdaptiveCardSidePromptService({
    defaultChatJid: options.defaultChatJid,
    defaultAgentId: options.defaultAgentId,
    json: (payload, status = 200) => channel.json(payload, status),
    webRuntimeConfig: options.webRuntimeConfig ?? {},
    agentPool: channel.agentPool ?? {},
    authGateway: channel.authGateway ?? {
      setTotpSecret: () => failMissingDependency("authGateway.setTotpSecret"),
      createTotpContext: () => ({
        buildSessionCookie: () => failMissingDependency("authGateway.createTotpContext.buildSessionCookie"),
      }),
    },
    interactionBroadcaster: channel.interactionBroadcaster ?? {
      broadcastInteractionUpdated: () => {},
    },
    sendMessage: typeof channel.sendMessage === "function"
      ? async (chatJid, text, options) => channel.sendMessage?.(chatJid, text, options)
      : async () => failMissingDependency("sendMessage"),
    broadcastEvent: typeof channel.broadcastEvent === "function"
      ? (eventType, data) => channel.broadcastEvent?.(eventType, data)
      : () => {},
    forwardAgentMessage: async (req, pathname, chatJid, agentId) =>
      handleAgentMessageRequest(channel as unknown as WebChannelLike, req, pathname, chatJid, agentId),
  });
}

export class WebAdaptiveCardSidePromptService {
  constructor(private readonly options: WebAdaptiveCardSidePromptServiceOptions) {}

  private denyUnscopedAction(): Response {
    return new Response(JSON.stringify({ error: "Account-bound card and side-prompt actions are not available yet." }), {
      status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  }

  async handleAdaptiveCardAction(req: Request): Promise<Response> {
    if (!isSingleUserAccess()) return this.denyUnscopedAction();
    const authorise = captureWebRequestAuthority(this.options.authGateway, req);
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as AdaptiveCardActionPayload;
    const normalized = sanitizeAdaptiveCardActionPayload(payload);
    const requestedChatJid = normalized.chatJid ?? null;
    const rawAction = normalized.actionData && typeof normalized.actionData === "object" && !Array.isArray(normalized.actionData)
      ? normalized.actionData as Record<string, unknown> : null;
    const isAuthAction = typeof rawAction?.intent === "string" && rawAction.intent.startsWith("login-step");
    const isPrivateAuth = rawAction?.intent === "login-step2" && typeof rawAction.method === "string" && rawAction.method.startsWith("runtime_");
    if (isPrivateAuth && rawAction && Object.keys(rawAction).some(key => !["intent", "provider", "method", "auth_type", "flow_id", "action_id", "auth_value"].includes(key))) {
      return this.options.json({ error: "Unexpected authentication action field" }, 409);
    }
    if (isAuthAction && !requestedChatJid) return this.options.json({ error: "Authentication requires its initiating chat" }, 409);
    if (!normalized.postId || normalized.postId <= 0) {
      return this.options.json({ error: "Missing or invalid post_id" }, 400);
    }
    const sourcePostId = normalized.postId;
    if (!normalized.cardId) {
      return this.options.json({ error: "Missing or invalid card_id" }, 400);
    }
    if (!normalized.actionType) {
      return this.options.json({ error: "Missing or invalid action.type" }, 400);
    }

    if (normalized.actionType === "Action.OpenUrl") {
      return this.options.json({ status: "ok", handled: "client", action_type: normalized.actionType, url: normalized.actionUrl || null }, 200);
    }

    if (normalized.actionType !== "Action.Submit") {
      return this.options.json({ error: `Unsupported action type: ${normalized.actionType}` }, 400);
    }

    const sourceInteraction = (requestedChatJid ? getMessageByRowId(requestedChatJid, sourcePostId) : undefined)
      ?? (isAuthAction ? undefined : getMessageByAnyRowId(sourcePostId));
    if (!sourceInteraction) {
      return this.options.json({ error: "Source post not found" }, 404);
    }
    const chatJid = typeof sourceInteraction.chat_jid === "string" && sourceInteraction.chat_jid.trim()
      ? sourceInteraction.chat_jid.trim()
      : (requestedChatJid ?? this.options.defaultChatJid);

    const simulatedFailure = getAdaptiveCardTestFailure(normalized.cardId, normalized.actionData);
    if (simulatedFailure) {
      return this.options.json({ error: simulatedFailure }, 422);
    }

    const submittedAt = new Date().toISOString();
    const sanitizedSubmissionData = sanitizeAdaptiveCardSubmissionData(normalized.actionData);
    const loginIntents = new Set(["login-step1", "login-step1-method", "login-step2", "login-step3"]);
    const loginData = sanitizedSubmissionData && typeof sanitizedSubmissionData === "object" && !Array.isArray(sanitizedSubmissionData)
      ? sanitizedSubmissionData as Record<string, unknown> : null;
    const isLoginFlow = loginData && typeof loginData.intent === "string" && loginIntents.has(loginData.intent);
    const blocks = sourceInteraction.data?.content_blocks;
    const card = Array.isArray(blocks) ? blocks.find((block: any) => block?.type === "adaptive_card" && block.card_id === normalized.cardId && block.state === "active") as any : null;
    const actions = card?.payload?.actions;
    const isLoginCard = Array.isArray(actions) && actions.some((action: any) => loginIntents.has(action?.data?.intent));
    if (isLoginCard || isLoginFlow) {
      if (!isLoginFlow || !loginData) return this.options.json({ error: "Authentication card requires its original login action" }, 409);
      const matchingAction = Array.isArray(actions) && actions.some((action: any) => {
        const data = action?.data;
        return action.type === "Action.Submit" && data?.intent === loginData.intent
          && Object.keys(data).every(key => data[key] === loginData[key]);
      });
      if (!matchingAction) return this.options.json({ error: "Stale or mismatched authentication card action" }, 409);
    }
    if (isPrivateAuth && loginData) {
      try {
        return await withPrivateProviderAuthResponse(async () => {
          const result = await this.options.agentPool.applyControlCommand?.(chatJid, {
            type: "login", provider: `__step2 ${JSON.stringify(loginData)}`, raw: "/login __step2",
          }) ?? failMissingDependency("agentPool.applyControlCommand");
          if (result.status !== "success") {
            return this.options.json({ error: "Authentication flow unavailable. Start again with /login." }, 409);
          }
          const nextCard = result.authPresentation ? result.contentBlocks?.[0] as Record<string, unknown> : null;
          const nextBlocks = nextCard ? (blocks ?? []).map((block: any) => block === card ? nextCard : block)
            : markAdaptiveCardState(blocks, normalized.cardId, "completed", submittedAt, { title: "Authentication action" });
          if (!nextBlocks) throw new Error("Authentication card unavailable");
          const updated = await admitSqliteWrite(getDb(), () => replaceMessageContent(chatJid, sourcePostId, sourceInteraction.data?.content || "", { contentBlocks: nextBlocks }), authorise, req.signal);
          if (!updated) throw new Error("Authentication card unavailable");
          commitPrivateProviderAuthResponse();
          // Only the safe opaque card is persisted/broadcast. Sensitive presentation
          // leaves solely in this authenticated HTTP response.
          this.options.interactionBroadcaster.broadcastInteractionUpdated(updated);
          if (!result.authPresentation) await this.options.sendMessage(chatJid, result.message, { threadId: sourceInteraction.id, contentBlocks: result.contentBlocks as Array<Record<string, unknown>> | undefined });
          return new Response(JSON.stringify({
            status: "ok", auth_presentation: result.authPresentation, source_post_id: sourcePostId,
            card_id: nextCard?.card_id ?? normalized.cardId, chat_jid: chatJid,
          }), { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", Vary: "Cookie", "Referrer-Policy": "no-referrer" } });
        });
      } catch {
        return this.options.json({ error: "Authentication presentation unavailable. Retry or start again with /login." }, 409);
      }
    }
    // Auth inputs travel only through the in-memory control call. Never retain
    // password/key/redirect values in card state, submission text or the DB.
    const persistedSubmissionData = isLoginFlow
      ? Object.fromEntries(Object.entries(loginData).filter(([key]) => ["intent", "provider", "method", "auth_type", "flow_id", "action_id", "activation_id", "confirmation_id"].includes(key)))
      : sanitizedSubmissionData;
    const persistedTitle = isLoginFlow ? "Authentication action" : normalized.actionTitle;
    const submissionMeta = {
      action_type: normalized.actionType,
      title: persistedTitle || undefined,
      data: persistedSubmissionData,
      submitted_at: submittedAt,
    };
    const submitBehavior = getAdaptiveCardSubmitBehavior(sourceInteraction.data?.content_blocks, normalized.cardId);
    const targetState = getAdaptiveCardSubmitState(normalized.actionData);
    const updatedCardBlocks = submitBehavior === "keep_active"
      ? sourceInteraction.data?.content_blocks ?? null
      : markAdaptiveCardState(
          sourceInteraction.data?.content_blocks,
          normalized.cardId,
          targetState,
          submittedAt,
          submissionMeta,
        );
    if (!updatedCardBlocks) {
      return this.options.json({ error: "Adaptive card not found or no longer active" }, 409);
    }

    const threadId = normalized.threadId ?? sourceInteraction.data?.thread_id ?? sourceInteraction.id;
    const submissionText = buildAdaptiveCardSubmissionText(
      persistedTitle,
      normalized.cardId,
      persistedSubmissionData,
    );
    const submissionBlock = buildAdaptiveCardSubmitBlock({
      cardId: normalized.cardId,
      sourcePostId,
      title: persistedTitle || undefined,
      data: persistedSubmissionData,
      submittedAt,
    });

    const rawSubmissionData = normalized.actionData && typeof normalized.actionData === "object"
      ? (normalized.actionData as Record<string, unknown>)
      : null;
    const submissionData = sanitizedSubmissionData as Record<string, unknown> | null;
    const persistSourceCard = (contentBlocks: unknown[] | null) => {
      if (!contentBlocks) return null;
      return replaceMessageContent(chatJid, sourcePostId, sourceInteraction.data?.content || "", {
        contentBlocks,
        linkPreviews: Array.isArray(sourceInteraction.data?.link_previews) ? sourceInteraction.data.link_previews : undefined,
        mediaIds: Array.isArray(sourceInteraction.data?.media_ids) ? sourceInteraction.data.media_ids : undefined,
      });
    };
    const updateSourceCard = async (contentBlocks: unknown[] | null) => {
      if (!contentBlocks) return null;
      const interaction = await admitSqliteWrite(getDb(), () => persistSourceCard(contentBlocks), authorise, req.signal);
      if (interaction) this.options.interactionBroadcaster.broadcastInteractionUpdated(interaction);
      return interaction;
    };

    if (isLoginFlow && loginData) {
      const updatedCardInteraction = submitBehavior === "keep_active"
        ? null
        : await updateSourceCard(updatedCardBlocks);

      const routePrefix = loginData.intent === "login-step1" ? "__step1 "
        : loginData.intent === "login-step1-method" ? "__step1method "
        : loginData.intent === "login-step2" ? "__step2 "
        : "__step3 ";
      const authResult = await this.options.agentPool.applyControlCommand?.(chatJid, {
        type: "login",
        provider: `${routePrefix}${JSON.stringify(submissionData)}`,
        raw: `/login ${routePrefix}`,
      }) ?? failMissingDependency("agentPool.applyControlCommand");

      const sendOpts: SendMessageOptions = { threadId };
      if (authResult.contentBlocks?.length) {
        sendOpts.contentBlocks = authResult.contentBlocks as Array<Record<string, unknown>>;
      }
      await this.options.sendMessage(chatJid, authResult.message, sendOpts);

      if (authResult.status === "success" && authResult.model_label) {
        let nextModel: string | null = authResult.model_label ?? null;
        let thinkingLevel: string | null = authResult.thinking_level ?? null;
        let supportsThinking: boolean | undefined = undefined;
        try {
          const modelState = await this.options.agentPool.getAvailableModels?.(chatJid)
            ?? failMissingDependency("agentPool.getAvailableModels");
          if (!nextModel) nextModel = modelState.current ?? null;
          if (thinkingLevel == null) thinkingLevel = modelState.thinking_level ?? null;
          supportsThinking = modelState.supports_thinking;
        } catch {
          if (typeof this.options.agentPool.getCurrentModelLabel === "function") {
            nextModel = await this.options.agentPool.getCurrentModelLabel(chatJid).catch(() => null);
          }
        }

        this.options.broadcastEvent("model_changed", {
          chat_jid: chatJid,
          model: nextModel ?? null,
          thinking_level: thinkingLevel ?? null,
          supports_thinking: supportsThinking,
        });
      }

      return this.options.json({
        status: "ok",
        card_updated: Boolean(updatedCardInteraction),
        source_post_id: sourcePostId,
        card_id: normalized.cardId,
        submitted_at: submittedAt,
        auth_result: authResult.status,
      }, 200);
    }

    const isRecoveryContinue = rawSubmissionData && rawSubmissionData.intent === "recovery-continue";
    if (isRecoveryContinue) {
      await updateSourceCard(
        markAdaptiveCardState(
          sourceInteraction.data?.content_blocks,
          normalized.cardId,
          "completed",
          submittedAt,
          { action_type: normalized.actionType, title: normalized.actionTitle || "Continue", data: { intent: "recovery-continue" }, submitted_at: submittedAt },
        ),
      );

      const continueReq = new Request(`http://internal/agent/${this.options.defaultAgentId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: buildRecoveryResumePrompt(),
          thread_id: threadId,
          content_blocks: [submissionBlock],
        }),
      });
      return await this.options.forwardAgentMessage(
        continueReq,
        `/agent/${this.options.defaultAgentId}/message`,
        chatJid,
        this.options.defaultAgentId,
      );
    }

    const isRecoveryRetryClean = rawSubmissionData && rawSubmissionData.intent === "recovery-retry-clean";
    if (isRecoveryRetryClean) {
      await updateSourceCard(
        markAdaptiveCardState(
          sourceInteraction.data?.content_blocks,
          normalized.cardId,
          "completed",
          submittedAt,
          { action_type: normalized.actionType, title: normalized.actionTitle || "Retry cleanly", data: { intent: "recovery-retry-clean" }, submitted_at: submittedAt },
        ),
      );

      const retryReq = new Request(`http://internal/agent/${this.options.defaultAgentId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: buildRecoveryRetryCleanPrompt(),
          content_blocks: [submissionBlock],
        }),
      });
      return await this.options.forwardAgentMessage(
        retryReq,
        `/agent/${this.options.defaultAgentId}/message`,
        chatJid,
        this.options.defaultAgentId,
      );
    }

    const isTotpFlow = rawSubmissionData && rawSubmissionData.intent === "totp-confirm";

    const addonIntent = rawSubmissionData && typeof rawSubmissionData.intent === "string"
      ? rawSubmissionData.intent.trim()
      : "";
    if (addonIntent && !isTotpFlow) {
      try {
        const handledAddonIntent = await runAddonAdaptiveCardIntent(addonIntent, {
          chatJid,
          threadId: threadId != null ? String(threadId) : null,
          sourcePostId,
          rawSubmissionData: rawSubmissionData ?? {},
          sendMessage: (content, options = {}) => this.options.sendMessage(chatJid, content, { threadId: options.threadId != null ? Number(options.threadId) : threadId }),
        });
        if (handledAddonIntent) {
          await updateSourceCard(
            markAdaptiveCardState(
              sourceInteraction.data?.content_blocks,
              normalized.cardId,
              "completed",
              submittedAt,
              {
                action_type: normalized.actionType,
                title: normalized.actionTitle || "Submit",
                data: { intent: addonIntent },
                submitted_at: submittedAt,
              },
            ),
          );
          return this.options.json({
            status: "ok",
            card_updated: true,
            source_post_id: sourcePostId,
            card_id: normalized.cardId,
            submitted_at: submittedAt,
          }, 200);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.warn("Failed to handle addon adaptive card intent", {
          operation: "handle_adaptive_card_action.addon_intent",
          chatJid,
          intent: addonIntent,
          err: error,
        });
        await this.options.sendMessage(chatJid, `Failed to handle action: ${msg}`, { threadId });
        return this.options.json({
          status: "ok",
          card_updated: true,
          source_post_id: sourcePostId,
          card_id: normalized.cardId,
          submitted_at: submittedAt,
        }, 200);
      }
    }

    if (isTotpFlow) {
      const safeSubmissionMeta = {
        action_type: normalized.actionType,
        title: normalized.actionTitle || undefined,
        data: { intent: "totp-confirm" },
        submitted_at: submittedAt,
      };
      const completeTotpCard = (state: "completed" | "failed") => updateSourceCard(
        markAdaptiveCardState(
          sourceInteraction.data?.content_blocks,
          normalized.cardId,
          state,
          submittedAt,
          safeSubmissionMeta,
        ),
      );
      const sendTotpFeedback = async (message: string, state: "active" | "completed" | "failed", setCookie?: string | null) => {
        await this.options.sendMessage(chatJid, message, { threadId });
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (setCookie) headers["Set-Cookie"] = setCookie;
        return new Response(JSON.stringify({
          status: "ok",
          source_post_id: sourcePostId,
          card_id: normalized.cardId,
          card_state: state,
          submitted_at: submittedAt,
          totp_result: state === "completed" ? "success" : "error",
          message,
        }), { status: 200, headers });
      };

      const confirmationCode = typeof rawSubmissionData.confirmation_code === "string"
        ? rawSubmissionData.confirmation_code.trim()
        : "";
      const token = typeof rawSubmissionData.__totp_token === "string"
        ? rawSubmissionData.__totp_token.trim()
        : "";

      if (!confirmationCode) {
        return await sendTotpFeedback("TOTP validation failed: missing confirmation code. No changes were made.", "active");
      }

      const parsedTotp = parseTotpCardToken(token);
      if (!parsedTotp.ok) {
        await completeTotpCard("failed");
        const message = parsedTotp.error === "expired"
          ? "TOTP validation failed: this confirmation card expired. No changes were made. Run /totp again."
          : "TOTP validation failed: this confirmation card is invalid. No changes were made. Run /totp again.";
        return await sendTotpFeedback(message, "failed");
      }

      const activeSecret = (this.options.webRuntimeConfig.totpSecret || "").trim();
      if (hashTotpSecret(activeSecret) !== parsedTotp.state.previousSecretHash) {
        completeTotpCard("failed");
        return await sendTotpFeedback(
          "TOTP validation failed: active TOTP state changed since this card was created. No changes were made. Run /totp again.",
          "failed",
        );
      }

      if (!verifyTotp(parsedTotp.state.secret, confirmationCode, this.options.webRuntimeConfig.totpWindow)) {
        return await sendTotpFeedback(
          "TOTP validation failed: the code did not match the secret shown in the card. No changes were made.",
          "active",
        );
      }

      const rotate = parsedTotp.state.flow === "setup" || parsedTotp.state.flow === "reset";
      const feedback = parsedTotp.state.flow === "setup"
        ? "TOTP setup confirmed. Secret saved. Existing web sessions were invalidated. This browser is now TOTP-authenticated."
        : parsedTotp.state.flow === "reset"
          ? "TOTP reset confirmed. New secret saved. Existing web sessions were invalidated. This browser is now TOTP-authenticated."
          : "TOTP device validation succeeded. Existing secret unchanged. This browser is now TOTP-authenticated.";
      const sessionToken = randomSessionToken();
      const completedBlocks = markAdaptiveCardState(sourceInteraction.data?.content_blocks, normalized.cardId, "completed", submittedAt, safeSubmissionMeta);
      const updated = await admitSqliteWrite(getDb(), () => {
        const latest = getMessageByRowId(chatJid, sourcePostId);
        const active = latest?.data?.content_blocks?.find((block: any) => block?.type === "adaptive_card" && block.card_id === normalized.cardId) as { state?: string } | undefined;
        if (!active || (active.state && active.state !== "active")) throw Error("TOTP confirmation card is no longer active");
        if (rotate) deleteAllWebSessions();
        createWebSession(sessionToken, DEFAULT_WEB_USER_ID, this.getWebSessionTtlSeconds(), "totp");
        return persistSourceCard(completedBlocks);
      }, phase => {
        req.signal.throwIfAborted();
        if (!isSingleUserAccess() || !parseTotpCardToken(token).ok || hashTotpSecret((this.options.webRuntimeConfig.totpSecret || "").trim()) !== parsedTotp.state.previousSecretHash)
          throw Error("TOTP confirmation authority changed");
        // Rotation intentionally revokes this request's old cookie. The signed
        // one-use card and unchanged prior secret remain the commit authority.
        if (phase === "before") authorise();
      }, req.signal);
      // Invalidate old cookies first. No old session can authenticate during
      // writer admission after the secret changes; publish the new cookie last.
      if (rotate) { setWebTotpSecret(parsedTotp.state.secret); this.options.authGateway.setTotpSecret(parsedTotp.state.secret); }
      if (updated) this.options.interactionBroadcaster.broadcastInteractionUpdated(updated);
      const setCookie = this.options.authGateway.createTotpContext().buildSessionCookie(sessionToken, req);
      return await sendTotpFeedback(feedback, "completed", setCookie);
    }

    const forwardReq = new Request(`http://internal/agent/${this.options.defaultAgentId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: submissionText,
        thread_id: threadId,
        content_blocks: [submissionBlock],
      }),
    });

    const forwardRes = await this.options.forwardAgentMessage(
      forwardReq,
      `/agent/${this.options.defaultAgentId}/message`,
      chatJid,
      this.options.defaultAgentId,
    );
    if (!forwardRes.ok) {
      return forwardRes;
    }

    if (!this.options.webRuntimeConfig.debugCardSubmissions) {
      const forwardBody = await forwardRes.clone().json().catch(() => null);
      const forwardBodyRecord = forwardBody as
        | { id?: number | string; user_message?: { id?: number | string } }
        | null;
      const rawSubmissionPostId = forwardBodyRecord?.id ?? forwardBodyRecord?.user_message?.id;
      const submissionPostId = typeof rawSubmissionPostId === "number"
        ? rawSubmissionPostId
        : typeof rawSubmissionPostId === "string"
          ? Number(rawSubmissionPostId)
          : NaN;
      if (Number.isFinite(submissionPostId) && submissionPostId > 0) {
        this.options.broadcastEvent("interaction_deleted", { chat_jid: chatJid, ids: [submissionPostId] });
      }
    }

    const updatedInteraction = submitBehavior === "keep_active"
      ? null
      : await admitSqliteWrite(getDb(), () => replaceMessageContent(
          chatJid,
          sourcePostId,
          sourceInteraction.data?.content || "",
          {
            contentBlocks: updatedCardBlocks,
            linkPreviews: Array.isArray(sourceInteraction.data?.link_previews) ? sourceInteraction.data.link_previews : undefined,
            mediaIds: Array.isArray(sourceInteraction.data?.media_ids) ? sourceInteraction.data.media_ids : undefined,
          },
        ), authorise, req.signal);
    if (updatedInteraction) {
      this.options.interactionBroadcaster.broadcastInteractionUpdated(updatedInteraction);
    }

    const responseBody = await forwardRes.json().catch(() => ({} as Record<string, unknown>));

    return this.options.json({
      ...responseBody,
      card_updated: Boolean(updatedInteraction),
      source_post_id: sourcePostId,
      card_id: normalized.cardId,
      card_state: submitBehavior === "keep_active" ? "active" : (updatedInteraction ? targetState : null),
      submitted_at: submittedAt,
    }, forwardRes.status);
  }

  async handleAgentSidePrompt(req: Request): Promise<Response> {
    if (!isSingleUserAccess()) return this.denyUnscopedAction();
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { prompt?: string; system_prompt?: string; chat_jid?: string };
    const { prompt, systemPrompt, chatJid } = parseSidePromptPayload(payload, this.options.defaultChatJid);
    if (!prompt) {
      return this.options.json({ error: "Missing or invalid prompt" }, 400);
    }

    const result = await this.options.agentPool.runSidePrompt?.(chatJid, prompt, {
      ...(systemPrompt ? { systemPrompt } : {}),
    }) ?? failMissingDependency("agentPool.runSidePrompt");

    if (result.status === "error") {
      return this.options.json(result, 502);
    }

    return this.options.json(result, 200);
  }

  async handleAgentSidePromptStream(req: Request): Promise<Response> {
    if (!isSingleUserAccess()) return this.denyUnscopedAction();
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { prompt?: string; system_prompt?: string; chat_jid?: string };
    const { prompt, systemPrompt, chatJid } = parseSidePromptPayload(payload, this.options.defaultChatJid);
    if (!prompt) {
      return this.options.json({ error: "Missing or invalid prompt" }, 400);
    }

    const runSidePrompt = async (nextChatJid: string, nextPrompt: string, nextOptions?: SidePromptOptions) => {
      if (typeof this.options.agentPool.runSidePrompt !== "function") {
        return failMissingDependency("agentPool.runSidePrompt");
      }
      return await this.options.agentPool.runSidePrompt(nextChatJid, nextPrompt, nextOptions);
    };
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let closed = false;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        const close = () => {
          if (closed) return;
          closed = true;
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          try {
            controller.close();
          } catch (error) {
            debugSuppressedError(log, "Adaptive-card side-prompt stream controller was already closed during shutdown.", error, {
              chatJid,
            });
          }
        };
        const send = (eventType: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(formatSseEvent(eventType, data)));
          } catch (error) {
            debugSuppressedError(log, "Adaptive-card side-prompt stream enqueue raced a closed controller.", error, {
              chatJid,
              eventType,
            });
            close();
          }
        };
        const sendHeartbeat = () => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
            controller.enqueue(encoder.encode(formatSseEvent("heartbeat", { ts: Date.now(), chat_jid: chatJid })));
          } catch (error) {
            debugSuppressedError(log, "Adaptive-card side-prompt heartbeat enqueue raced a closed controller.", error, {
              chatJid,
            });
            close();
          }
        };

        req.signal.addEventListener("abort", close, { once: true });
        heartbeat = setInterval(sendHeartbeat, SIDE_PROMPT_STREAM_HEARTBEAT_MS);

        send("side_prompt_start", { chat_jid: chatJid });
        void runSidePrompt(chatJid, prompt, {
          ...(systemPrompt ? { systemPrompt } : {}),
          signal: req.signal,
          onThinkingDelta: (delta) => send("side_prompt_thinking_delta", { delta }),
          onTextDelta: (delta) => send("side_prompt_text_delta", { delta }),
        }).then((result) => {
          send(result.status === "success" ? "side_prompt_done" : "side_prompt_error", result);
          close();
        }).catch((error) => {
          send("side_prompt_error", {
            status: "error",
            result: null,
            thinking: null,
            error: error instanceof Error ? error.message : String(error),
            model: null,
          });
          close();
        });
      },
      cancel: () => {
        if (!req.signal.aborted) return;
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  private getWebSessionTtlSeconds(): number {
    const rawTtl = this.options.webRuntimeConfig.sessionTtl;
    return Math.max(60, rawTtl || 0);
  }
}
