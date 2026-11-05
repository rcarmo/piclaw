import { captureHostDatabaseBinding } from "../../../db/connection.js";
import { getMessageByRowId } from "../../../db.js";
import { captureWebRequestAuthority } from "../auth/auth-gateway.js";
import { captureInputTarget } from "../messaging/input-request-authority.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { parsePostPayload } from "../posts-service.js";
import { handleAgentMessage } from "./agent.js";

/** Legacy post URL, same native admission boundary as compose. No worker wake. */
export async function handlePost(channel: WebChannelLike, req: Request, isReply: boolean, chatJid: string): Promise<Response> {
  const database = captureHostDatabaseBinding();
  const gateway = channel.authGateway;
  const requestAuthority = captureWebRequestAuthority(gateway, req);
  const target = captureInputTarget(chatJid);
  let body: unknown;
  try { body = await req.clone().json(); }
  catch { return channel.json({ error: "Invalid JSON" }, 400); }
  const parsed = parsePostPayload(body);
  if (!parsed.ok || !parsed.data) return channel.json({ error: parsed.error }, 400);
  if (isReply && !parsed.data.thread_id) return channel.json({ error: "Missing 'thread_id' field" }, 400);
  try {
    database(); requestAuthority(); target();
    if (channel.authGateway !== gateway) throw Error("Post authority changed");
  } catch { return channel.json({ error: "Input authority changed before admission." }, 403); }

  const response = await handleAgentMessage(channel, req, "/agent/default/message", chatJid, "default");
  if (!response.ok) return response;
  const receipt = await response.clone().json() as Record<string, unknown>;
  if (typeof receipt.row_id !== "number" || !Number.isSafeInteger(receipt.row_id)) return response;
  try {
    database();
    const interaction = getMessageByRowId(chatJid, receipt.row_id);
    if (!interaction) return response;
    // Retain the old real-row response shape, alongside the actual SDK receipt.
    return channel.json({ ...interaction, submission_id: receipt.submission_id,
      thread_id: receipt.thread_id, created: receipt.created,
      ...(receipt.queued ? { queued: receipt.queued } : {}) }, response.status);
  } catch {
    // A row-formatting failure cannot revoke acceptance or invite resubmission.
    return response;
  }
}
