import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import { withExecutionIdentity } from "../../../core/execution-context.js";
import { authoriseExecutionIdentity } from "../../../agent-pool/execution-identity.js";
import { parseControlCommand } from "../../../agent-control/index.js";
import { getDb } from "../../../db/connection.js";
import { requireAccountActor } from "../../../db/account-administration.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "../../../db/session-ownership.js";
import { createUuid } from "../../../utils/ids.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { publicContextUsage } from "../context-usage.js";
import { isRateLimited } from "./rate-limit.js";
import { checkCsrfOrigin, rateLimitResponse } from "./security.js";

function selector(url: URL, key: string): string | undefined {
  const values = url.searchParams.getAll(key);
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !values[0]?.trim()) throw new ChatAccessDenied();
  return values[0].trim();
}

export function projectFamilyModelState(state: Awaited<ReturnType<WebChannelLike["agentPool"]["getAvailableModels"]>>, contextUsage: unknown) {
  const options = Array.isArray(state?.model_options) ? state.model_options : [];
  return {
    current: typeof state?.current === "string" ? state.current : null,
    model_options: options.map(value => ({
      label: value.label, provider: value.provider, id: value.id, name: value.name,
      context_window: value.context_window, pricing: value.pricing, reasoning: value.reasoning === true,
      thinking_levels: Array.isArray(value.thinking_levels) ? value.thinking_levels : [],
      thinking_level_labels: Array.isArray(value.thinking_level_labels) ? value.thinking_level_labels : [],
    })),
    thinking_level: typeof state?.thinking_level === "string" ? state.thinking_level : null,
    thinking_level_label: typeof state?.thinking_level_label === "string" ? state.thinking_level_label : null,
    supports_thinking: state?.supports_thinking === true,
    available_thinking_levels: Array.isArray(state?.available_thinking_levels) ? state.available_thinking_levels : [],
    available_thinking_level_labels: Array.isArray(state?.available_thinking_level_labels) ? state.available_thinking_level_labels : [],
    latest_requested_model: typeof state?.latest_requested_model === "string" ? state.latest_requested_model : null,
    latest_response_model: typeof state?.latest_response_model === "string" ? state.latest_response_model : null,
    context_usage: publicContextUsage(contextUsage),
  };
}

export async function handleFamilyModelControl(channel: WebChannelLike, req: Request, principal: AuthenticatedPrincipal): Promise<Response> {
  const deny = () => channel.json({ error: "Session access denied." }, 403);
  try {
    const url = new URL(req.url);
    if ([...url.searchParams.keys()].some(key => key !== "chat_jid")) return deny();
    const database = getDb();
    const target = resolveAuthorisedChat(database, principal, selector(url, "chat_jid"), req.method === "GET" ? "session.read" : "session.write");
    if (req.method === "GET") {
      const state = await channel.agentPool.getAvailableModels(target.chatJid, { includeProviderUsage: false, includeProviderDiagnostics: false });
      const context = await channel.agentPool.getContextUsageForChat(target.chatJid);
      requireAccountActor(getDb(), principal);
      resolveAuthorisedChat(getDb(), principal, target.chatJid, "session.read");
      return channel.json(projectFamilyModelState(state, context));
    }
    if (req.method !== "PATCH" || !req.headers.get("origin") || !checkCsrfOrigin(req)) return deny();
    if (isRateLimited(req, "data/family_model_control", 60_000, 30)) return rateLimitResponse("Too many model changes.");
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["action", "value"].includes(key))
      || !["model", "thinking"].includes(body.action) || typeof body.value !== "string" || !body.value.trim() || body.value.length > 512) {
      return channel.json({ error: "Invalid model request." }, 400);
    }
    const raw = body.action === "model" ? `/model ${body.value.trim()}` : `/thinking ${body.value.trim()}`;
    const command = parseControlCommand(raw);
    if (!command || (command.type !== "model" && command.type !== "thinking")) return channel.json({ error: "Invalid model request." }, 400);
    const identity = authoriseExecutionIdentity(database, "family-shared", target.chatJid, {
      actorUserId: principal.userId, ownerUserId: principal.userId, chatJid: target.chatJid, kind: "interactive", authenticationSessionId: principal.authentication.sessionId ?? undefined,
    });
    if (!identity) throw new ChatAccessDenied();
    let cancelled = req.signal.aborted;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const result = await new Promise<unknown>((resolve, reject) => {
      onAbort = () => { cancelled = true; reject(new Error("Model request cancelled.")); };
      if (cancelled) { onAbort(); return; }
      req.signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(onAbort, 30_000);
      channel.queue.enqueue(async () => {
        try {
          if (cancelled) return;
          const current = authoriseExecutionIdentity(getDb(), "family-shared", target.chatJid, identity.provenance);
          if (!current) throw new ChatAccessDenied();
          resolve(await withExecutionIdentity(current, () => channel.agentPool.applyOwnedModelControl(target.chatJid, command)));
        } catch (error) { reject(error); }
      }, createUuid("family-model"), `chat:${target.chatJid}`);
    }).finally(() => {
      if (timer) clearTimeout(timer);
      if (onAbort) req.signal.removeEventListener("abort", onAbort);
    });
    const state = await channel.agentPool.getAvailableModels(target.chatJid, { includeProviderUsage: false, includeProviderDiagnostics: false });
    const context = await channel.agentPool.getContextUsageForChat(target.chatJid);
    requireAccountActor(getDb(), principal);
    resolveAuthorisedChat(getDb(), principal, target.chatJid, "session.read");
    return channel.json({ command: result, ...projectFamilyModelState(state, context) });
  } catch (error) {
    if (error instanceof ChatAccessDenied) return deny();
    return channel.json({ error: "Model change failed." }, 400);
  }
}
