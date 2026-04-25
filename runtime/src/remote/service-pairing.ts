/**
 * remote/service-pairing.ts – Pair-request and pair-confirm endpoint handlers.
 */

import { createUuid } from "../utils/ids.js";
import { getClientKey } from "../utils/request-client.js";
import {
  createPairRequest,
  getPairRequestById,
  getPendingPairRequest,
  getRemotePeer,
  getOutboundPairRequestById,
  updateOutboundPairRequestStatus,
  updatePairRequestStatus,
  upsertRemotePeer,
  type RemotePeerRecord,
} from "../db/remote-interop.js";
import { deriveFingerprint, deriveInstanceId, loadOrCreateIdentity, signPayload } from "./identity.js";
import { buildCallbackProofString } from "./service-security.js";
import { validateCallbackUrl } from "./ssrf.js";
import { verifySignedRequest } from "./auth.js";
import { DEFAULT_MAX_PROMPT_BYTES } from "./limits.js";
import type { RemoteNonceCache } from "./nonce-cache.js";
import {
  checkContentLength,
  getOptionalTrimmedStringField,
  getTrimmedStringField,
  jsonResponse,
  parseJsonBytes,
  readBodyBytes,
  readJsonBody,
  requireJson,
  type SlidingWindowLimiter,
} from "./http-utils.js";
import { logAudit } from "./service-security.js";

/** Shared pairing handler dependencies owned by the remote service runtime. */
export interface RemotePairingHandlersContext {
  pairLimiter: SlidingWindowLimiter;
  pairConfirmLimiter: SlidingWindowLimiter;
  callbackLimiter: SlidingWindowLimiter;
  nonceCache: RemoteNonceCache;
  remoteConfig?: Readonly<import("../core/config.js").RemoteInteropConfig>;
  validateCallbackUrl?: typeof validateCallbackUrl;
  /** Optional fire-and-forget callback to notify the local chat of an inbound pair request. */
  notify?: (text: string) => void;
}

/** Handle `/api/remote/pair-request` validation and pending request creation. */
export async function handlePairRequest(req: Request, context: RemotePairingHandlersContext): Promise<Response> {
  const jsonError = requireJson(req);
  if (jsonError) return jsonResponse({ error: jsonError }, 415);
  const lengthCheck = checkContentLength(req, DEFAULT_MAX_PROMPT_BYTES);
  if (!lengthCheck.ok) return jsonResponse({ error: lengthCheck.error }, lengthCheck.status);

  const { data, error } = await readJsonBody(req, DEFAULT_MAX_PROMPT_BYTES);
  if (error) return jsonResponse({ error }, 400);

  const instanceId = getTrimmedStringField(data, "instance_id");
  const publicKey = getTrimmedStringField(data, "public_key");
  const displayName = getOptionalTrimmedStringField(data, "display_name");
  const callbackUrl = getTrimmedStringField(data, "callback_url");
  const protocolVersion = getTrimmedStringField(data, "protocol_version");
  const nonce = getOptionalTrimmedStringField(data, "nonce");
  const expiresAtRaw = getTrimmedStringField(data, "expires_at");

  if (!instanceId || !publicKey || !callbackUrl || !expiresAtRaw || !nonce || !protocolVersion) {
    return jsonResponse({ error: "Missing required fields." }, 400);
  }

  if (!new Set(["1", "v1"]).has(protocolVersion)) {
    return jsonResponse({ error: "Unsupported protocol version." }, 400);
  }

  const derivedId = deriveInstanceId(publicKey);
  if (derivedId !== instanceId) {
    return jsonResponse({ error: "instance_id does not match public_key." }, 400);
  }

  const peer = getRemotePeer(instanceId);
  if (peer?.status === "blocked") {
    logAudit(peer, "/api/remote/pair-request", "blocked", "blocked");
    return jsonResponse({ error: "Peer is blocked." }, 403);
  }
  if (peer?.status === "paired") {
    logAudit(peer, "/api/remote/pair-request", "paired", "paired");
    return jsonResponse({ error: "Peer is already paired." }, 409);
  }

  const rateKey = `${getClientKey(req)}:${instanceId}`;
  if (!context.pairLimiter.allow(rateKey)) {
    return jsonResponse({ error: "Pairing rate limit exceeded." }, 429);
  }

  const callbackCheck = await (context.validateCallbackUrl ?? validateCallbackUrl)(callbackUrl, undefined, context.remoteConfig);
  if (!callbackCheck.ok) {
    return jsonResponse({ error: callbackCheck.error }, 400);
  }

  const expiresAt = Date.parse(expiresAtRaw);
  if (Number.isNaN(expiresAt)) {
    return jsonResponse({ error: "Invalid expires_at." }, 400);
  }
  const now = Date.now();
  const maxExpiry = now + 24 * 60 * 60 * 1000;
  if (expiresAt <= now || expiresAt > maxExpiry) {
    return jsonResponse({ error: "expires_at is out of range." }, 400);
  }

  const pending = getPendingPairRequest(instanceId);
  if (pending) {
    const pendingExpiry = Date.parse(pending.expires_at);
    if (!Number.isNaN(pendingExpiry) && pendingExpiry > Date.now()) {
      return jsonResponse(
        {
          error: "Pair request already pending.",
          request_id: pending.id,
          expires_at: pending.expires_at,
        },
        409
      );
    }
    updatePairRequestStatus(pending.id, "expired");
  }

  const requestId = createUuid("pair");
  const createdAt = new Date().toISOString();
  createPairRequest({
    id: requestId,
    instance_id: instanceId,
    public_key: publicKey,
    display_name: displayName,
    callback_url: callbackUrl,
    protocol_version: protocolVersion,
    nonce,
    expires_at: new Date(expiresAt).toISOString(),
    status: "pending",
    created_at: createdAt,
    source_ip: getClientKey(req),
  });

  logAudit(peer, "/api/remote/pair-request", "pending", "pending");

  const label = displayName ? `**${displayName}**` : `\`${instanceId.slice(0, 12)}…\``;
  const fp = deriveFingerprint(instanceId);
  const sourceIp = getClientKey(req);
  const callbackOrigin = callbackUrl ? (() => { try { const u = new URL(callbackUrl); return `${u.protocol}//${u.host}`; } catch { return callbackUrl; } })() : "unknown";
  context.notify?.(
    `Pair request from ${label} (\`${fp}\`).\n` +
    `- **Request ID:** \`${requestId}\`\n` +
    `- **Instance ID:** \`${instanceId}\`\n` +
    `- **Origin:** \`${callbackOrigin}\`\n` +
    (sourceIp ? `- **Source:** \`${sourceIp}\`\n` : "") +
    `\nRun \`/pair accept ${requestId}\` to accept, or \`/pair list\` to review.`
  );

  const identity = loadOrCreateIdentity();
  return jsonResponse(
    {
      status: "pending",
      request_id: requestId,
      expires_at: new Date(expiresAt).toISOString(),
      receiver_instance_id: identity.instance_id,
      receiver_public_key: identity.public_key,
      receiver_fingerprint: identity.fingerprint,
    },
    202
  );
}

/**
 * Handle `POST /api/remote/pair-confirm` – initiator-side completion endpoint.
 *
 * After the receiver's operator has accepted a pending pair request and
 * completed the URL-ownership proof, the receiver calls this endpoint on the
 * initiator with a signed notification. The initiator verifies the signature
 * using the public key stored in the pending outbound request, then marks the
 * receiver as paired in its local peer registry.
 *
 * Flow (receiver → initiator):
 *   receiver sends: { request_id, trust_epoch }
 *   headers: standard signed request headers (X-Instance-Id = receiver's id)
 */
export async function handlePairConfirm(req: Request, context: RemotePairingHandlersContext): Promise<Response> {
  const jsonError = requireJson(req);
  if (jsonError) return jsonResponse({ error: jsonError }, 415);
  const lengthCheck = checkContentLength(req, DEFAULT_MAX_PROMPT_BYTES);
  if (!lengthCheck.ok) return jsonResponse({ error: lengthCheck.error }, lengthCheck.status);

  const bodyBytes = await readBodyBytes(req);
  const { data, error } = parseJsonBytes(bodyBytes, DEFAULT_MAX_PROMPT_BYTES);
  if (error) return jsonResponse({ error }, 400);

  const requestId = getTrimmedStringField(data, "request_id");
  if (!requestId) {
    return jsonResponse({ error: "Missing request_id." }, 400);
  }

  const outbound = getOutboundPairRequestById(requestId);
  if (!outbound) {
    return jsonResponse({ error: "Pair request not found." }, 404);
  }
  if (outbound.status !== "pending") {
    return jsonResponse({ error: "Pair request already completed." }, 409);
  }
  if (Date.parse(outbound.expires_at) <= Date.now()) {
    updateOutboundPairRequestStatus(requestId, "expired");
    return jsonResponse({ error: "Pair request expired." }, 410);
  }

  const rateKey = `${getClientKey(req)}:${outbound.instance_id}`;
  if (!context.pairConfirmLimiter.allow(rateKey)) {
    return jsonResponse({ error: "Pair confirmation rate limit exceeded." }, 429);
  }

  // Construct a pseudo-peer from the outbound record to verify the receiver's signature.
  const pseudoPeer: RemotePeerRecord = {
    instance_id: outbound.instance_id,
    public_key: outbound.public_key,
    display_name: null,
    status: "pending",
    mode: "mediated",
    profile: "restricted",
    trust_epoch: null,
    created_at: outbound.created_at,
    updated_at: outbound.created_at,
    last_seen_at: null,
    blocked_reason: null,
    base_url: outbound.base_url,
  };

  const sigResult = verifySignedRequest(req, bodyBytes, pseudoPeer, context.nonceCache);
  if (!sigResult.ok) {
    logAudit(pseudoPeer, "/api/remote/pair-confirm", "denied", undefined, sigResult.error);
    return jsonResponse({ error: sigResult.error }, 401);
  }

  // Activate the peer on the initiator side.
  const now = new Date().toISOString();
  const receiverDisplayName = getOptionalTrimmedStringField(data, "receiver_display_name");
  upsertRemotePeer({
    instance_id: outbound.instance_id,
    public_key: outbound.public_key,
    display_name: receiverDisplayName ?? null,
    status: "paired",
    mode: "mediated",
    profile: "restricted",
    trust_epoch: 1,
    created_at: outbound.created_at,
    updated_at: now,
    last_seen_at: now,
    blocked_reason: null,
    base_url: outbound.base_url,
  });
  updateOutboundPairRequestStatus(requestId, "accepted");

  logAudit(pseudoPeer, "/api/remote/pair-confirm", "paired", "paired");
  context.notify?.(`Paired with \`${outbound.fingerprint}\``);

  const identity = loadOrCreateIdentity();
  return jsonResponse({
    status: "paired",
    peer_instance_id: outbound.instance_id,
    peer_fingerprint: outbound.fingerprint,
    receiver_instance_id: identity.instance_id,
  });
}

/**
 * Handle `POST /api/remote/pair-callback` – URL-ownership proof endpoint.
 *
 * During pairing Step C the receiver's `runAcceptPairFlow` POSTs a challenge
 * here. We validate the request_id and challenge against our pending outbound
 * request, sign the proof string, and return it so the receiver can verify
 * that we control this callback URL.
 */
export async function handlePairCallback(req: Request, context: Pick<RemotePairingHandlersContext, "callbackLimiter">): Promise<Response> {
  const rateKey = getClientKey(req);
  if (!context.callbackLimiter.allow(rateKey)) {
    return jsonResponse({ error: "Rate limit exceeded." }, 429);
  }
  const jsonError = requireJson(req);
  if (jsonError) return jsonResponse({ error: jsonError }, 415);
  const lengthCheck = checkContentLength(req, DEFAULT_MAX_PROMPT_BYTES);
  if (!lengthCheck.ok) return jsonResponse({ error: lengthCheck.error }, lengthCheck.status);

  const { data, error } = await readJsonBody(req, DEFAULT_MAX_PROMPT_BYTES);
  if (error) return jsonResponse({ error }, 400);

  const requestId = getTrimmedStringField(data, "request_id");
  const challenge = getTrimmedStringField(data, "challenge");
  const receiverInstanceId = getTrimmedStringField(data, "receiver_instance_id");

  if (!requestId || !challenge || !receiverInstanceId) {
    return jsonResponse({ error: "Missing required fields." }, 400);
  }

  // Validate against the pending outbound request so this endpoint cannot be
  // used to forge signatures over arbitrary data.
  const outbound = getOutboundPairRequestById(requestId);
  if (!outbound || outbound.status !== "pending") {
    return jsonResponse({ error: "Pair request not found." }, 404);
  }
  if (Date.parse(outbound.expires_at) <= Date.now()) {
    updateOutboundPairRequestStatus(requestId, "expired");
    return jsonResponse({ error: "Pair request expired." }, 410);
  }
  if (challenge !== outbound.nonce) {
    return jsonResponse({ error: "Challenge mismatch." }, 400);
  }
  if (receiverInstanceId !== outbound.instance_id) {
    return jsonResponse({ error: "Receiver instance_id mismatch." }, 400);
  }

  const identity = loadOrCreateIdentity();
  const proof = buildCallbackProofString(requestId, challenge, receiverInstanceId);
  const signature = signPayload(identity, proof);

  return jsonResponse({
    request_id: requestId,
    challenge,
    instance_id: identity.instance_id,
    signature,
  });
}
