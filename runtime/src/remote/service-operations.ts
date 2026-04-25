/**
 * remote/service-operations.ts – Signed remote peer operation endpoint handlers.
 */

import { createUuid } from "../utils/ids.js";
import type { AgentPool } from "../agent-pool.js";
import { formatRecoverySummary } from "../agent-pool/automatic-recovery.js";
import { getRemotePeer, getRemoteRequestById, storeRemoteRequest, storeResultCallback, updateRemoteRequestDecision, updateRemotePeer, type RemotePeerRecord } from "../db/remote-interop.js";
import type { RemoteInteropConfig } from "../core/config.js";
import { verifySignedRequest } from "./auth.js";
import type { RemoteNonceCache } from "./nonce-cache.js";
import {
  DEFAULT_MAX_PROMPT_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MAX_TOOL_CALLS_FULL,
  DEFAULT_MAX_TOOL_CALLS_RESTRICTED,
  DEFAULT_REQUEST_HOP_LIMIT,
  DEFAULT_TIMEOUT_MS_FULL,
  DEFAULT_TIMEOUT_MS_RESTRICTED,
} from "./limits.js";
import {
  checkContentLength,
  getTrimmedStringField,
  jsonResponse,
  parseJsonBytes,
  readBodyBytes,
  requireJson,
  type SlidingWindowLimiter,
} from "./http-utils.js";
import { logAudit } from "./service-security.js";
import { loadOrCreateIdentity } from "./identity.js";
import { buildSignedRequestHeaders } from "../extensions/remote-pair.js";
import { RemoteExecuteConcurrency } from "./execute-concurrency.js";
import { getToolCeilingFilter } from "./policy.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("remote.service-operations");

/** Shared remote operation handler dependencies owned by the remote service runtime. */
export interface RemoteOperationHandlersContext {
  nonceCache: RemoteNonceCache;
  pingLimiter: SlidingWindowLimiter;
  proposalLimiter: SlidingWindowLimiter;
  executeLimiter: SlidingWindowLimiter;
  revokeLimiter: SlidingWindowLimiter;
  resultLimiter: SlidingWindowLimiter;
  executeConcurrency: RemoteExecuteConcurrency;
  agentPool?: AgentPool;
  remoteConfig: Readonly<RemoteInteropConfig>;
  getDecisionModel: () => string;
  notify?: (text: string) => void;
}

/** Resolve and validate paired remote peer identity from request headers. */
export function requirePeer(req: Request): RemotePeerRecord | Response {
  const instanceId = req.headers.get("x-instance-id") || "";
  if (!instanceId) return jsonResponse({ error: "Missing X-Instance-Id." }, 401);
  const peer = getRemotePeer(instanceId);
  if (!peer) return jsonResponse({ error: "Unknown peer." }, 401);
  if (peer.status !== "paired") return jsonResponse({ error: "Peer not paired." }, 403);
  return peer;
}

/** Handle `/api/remote/ping` signed liveness checks. */
export async function handlePing(req: Request, context: RemoteOperationHandlersContext): Promise<Response> {
  const peer = requirePeer(req);
  if (peer instanceof Response) return peer;

  if (!context.pingLimiter.allow(peer.instance_id)) {
    return jsonResponse({ error: "Ping rate limit exceeded." }, 429);
  }

  const bodyBytes = await readBodyBytes(req);
  const sig = verifySignedRequest(req, bodyBytes, peer, context.nonceCache);
  if (!sig.ok) {
    logAudit(peer, "/api/remote/ping", "denied", undefined, sig.error);
    return jsonResponse({ error: sig.error }, 401);
  }

  updateRemotePeer(peer.instance_id, { last_seen_at: new Date().toISOString() });

  const identity = loadOrCreateIdentity();
  logAudit(peer, "/api/remote/ping", "ok");

  return jsonResponse({
    status: "ok",
    instance_id: identity.instance_id,
    instance_name: identity.instance_name,
    fingerprint: identity.fingerprint,
    time: new Date().toISOString(),
    mode: peer.mode,
    profile: peer.profile,
  });
}

/** Handle `/api/remote/proposal` signed mediated proposal submissions. */
export async function handleProposal(req: Request, context: RemoteOperationHandlersContext): Promise<Response> {
  const peer = requirePeer(req);
  if (peer instanceof Response) return peer;

  if (peer.profile === "read-only") {
    logAudit(peer, "/api/remote/proposal", "denied", undefined, "read-only profile does not allow proposals");
    return jsonResponse({ error: "Peer profile is read-only (ping/status only)." }, 403);
  }

  const jsonError = requireJson(req);
  if (jsonError) return jsonResponse({ error: jsonError }, 415);
  const lengthCheck = checkContentLength(req, DEFAULT_MAX_PROMPT_BYTES);
  if (!lengthCheck.ok) return jsonResponse({ error: lengthCheck.error }, lengthCheck.status);

  const bodyBytes = await readBodyBytes(req);
  const sig = verifySignedRequest(req, bodyBytes, peer, context.nonceCache);
  if (!sig.ok) {
    logAudit(peer, "/api/remote/proposal", "denied", undefined, sig.error);
    return jsonResponse({ error: sig.error }, 401);
  }

  if (!context.proposalLimiter.allow(peer.instance_id)) {
    return jsonResponse({ error: "Proposal rate limit exceeded." }, 429);
  }

  const payload = parseJsonBytes(bodyBytes, DEFAULT_MAX_PROMPT_BYTES);
  if (payload.error) return jsonResponse({ error: payload.error }, 400);

  const prompt = getTrimmedStringField(payload.data, "prompt");
  if (!prompt) return jsonResponse({ error: "Missing prompt." }, 400);

  const hop = Number(req.headers.get("x-request-hop") || "0");
  if (hop > DEFAULT_REQUEST_HOP_LIMIT) {
    return jsonResponse({ error: "Request hop limit exceeded." }, 400);
  }

  const requestId = createUuid("proposal");
  storeRemoteRequest({
    id: requestId,
    peer_instance_id: peer.instance_id,
    request_type: "proposal",
    status: "pending",
    prompt,
    created_at: new Date().toISOString(),
    decision: null,
    remote_mode: peer.mode,
    error: null,
    result: null,
  });

  logAudit(peer, "/api/remote/proposal", "queued", "human_required");

  const peerLabel = peer.display_name ?? `\`${peer.instance_id.slice(0, 6)}-${peer.instance_id.slice(6, 12)}-${peer.instance_id.slice(12, 18)}\``;
  context.notify?.(
    `**Incoming request from ${peerLabel}:** ${prompt}\n\nProposal ID: \`${requestId}\`. Run \`/pair inbox\` to review.`
  );

  return jsonResponse({
    decision: "human_required",
    reason: "Proposal queued for review.",
    negotiation_id: requestId,
    remote_mode: peer.mode,
    decision_model: context.getDecisionModel() || null,
  });
}

/** Handle `/api/remote/execute` short-circuit execution requests. */
export async function handleExecute(req: Request, context: RemoteOperationHandlersContext): Promise<Response> {
  const peer = requirePeer(req);
  if (peer instanceof Response) return peer;

  const jsonError = requireJson(req);
  if (jsonError) return jsonResponse({ error: jsonError }, 415);
  const lengthCheck = checkContentLength(req, DEFAULT_MAX_PROMPT_BYTES);
  if (!lengthCheck.ok) return jsonResponse({ error: lengthCheck.error }, lengthCheck.status);

  const bodyBytes = await readBodyBytes(req);
  const sig = verifySignedRequest(req, bodyBytes, peer, context.nonceCache);
  if (!sig.ok) {
    logAudit(peer, "/api/remote/execute", "denied", undefined, sig.error);
    return jsonResponse({ error: sig.error }, 401);
  }

  if (!context.remoteConfig.shortCircuitEnabled || peer.mode !== "short-circuit" || peer.profile !== "full") {
    return jsonResponse({ error: "Short-circuit execution not allowed." }, 403);
  }

  const hop = Number(req.headers.get("x-request-hop") || "0");
  if (hop > DEFAULT_REQUEST_HOP_LIMIT) {
    return jsonResponse({ error: "Request hop limit exceeded." }, 400);
  }

  if (!context.executeLimiter.allow(peer.instance_id)) {
    return jsonResponse({ error: "Execute rate limit exceeded." }, 429);
  }

  if (context.executeConcurrency.isAtLimit(peer.instance_id)) {
    return jsonResponse({ error: "Remote execution concurrency limit reached." }, 429);
  }

  const payload = parseJsonBytes(bodyBytes, DEFAULT_MAX_PROMPT_BYTES);
  if (payload.error) return jsonResponse({ error: payload.error }, 400);

  const prompt = getTrimmedStringField(payload.data, "prompt");
  if (!prompt) return jsonResponse({ error: "Missing prompt." }, 400);

  if (!context.agentPool) {
    return jsonResponse({ error: "Agent pool not available." }, 500);
  }

  context.executeConcurrency.acquire(peer.instance_id);
  const start = Date.now();
  const maxToolCalls = peer.profile === "full" ? DEFAULT_MAX_TOOL_CALLS_FULL : DEFAULT_MAX_TOOL_CALLS_RESTRICTED;
  const timeoutMs = peer.profile === "full" ? DEFAULT_TIMEOUT_MS_FULL : DEFAULT_TIMEOUT_MS_RESTRICTED;
  const toolCeilingFilter = getToolCeilingFilter(peer.profile) ?? undefined;
  try {
    const chatJid = `remote:${peer.instance_id}`;
    const output = await context.agentPool.runAgent(prompt, chatJid, { timeoutMs, maxToolCalls, toolCeilingFilter });
    const duration = Date.now() - start;
    const recoverySummary = formatRecoverySummary(output.recovery);

    if (output.status === "error") {
      logAudit(peer, "/api/remote/execute", "error", "error", recoverySummary
        ? `${output.error || "Execution failed."} ${recoverySummary}`
        : output.error);
      return jsonResponse({
        decision: "deny",
        error: output.error || "Execution failed.",
        recovery: output.recovery || null,
      }, 500);
    }

    const resultText = output.result || "";
    if (Buffer.byteLength(resultText, "utf8") > DEFAULT_MAX_RESPONSE_BYTES) {
      return jsonResponse({ decision: "deny", error: "Response too large." }, 413);
    }

    logAudit(peer, "/api/remote/execute", "ok", "accept_execute", recoverySummary || undefined);
    return jsonResponse({
      decision: "accept_execute",
      result: resultText,
      recovery: output.recovery || null,
      usage: {
        duration_ms: duration,
        tool_calls: null,
      },
      scope_applied: { profile: peer.profile },
    });
  } finally {
    context.executeConcurrency.release(peer.instance_id);
  }
}

/** Handle `/api/remote/revoke` signed trust revocation requests. */
export async function handleRevoke(req: Request, context: RemoteOperationHandlersContext): Promise<Response> {
  const peer = requirePeer(req);
  if (peer instanceof Response) return peer;

  const jsonError = requireJson(req);
  if (jsonError) return jsonResponse({ error: jsonError }, 415);
  const lengthCheck = checkContentLength(req, DEFAULT_MAX_PROMPT_BYTES);
  if (!lengthCheck.ok) return jsonResponse({ error: lengthCheck.error }, lengthCheck.status);

  if (!context.revokeLimiter.allow(peer.instance_id)) {
    return jsonResponse({ error: "Revoke rate limit exceeded." }, 429);
  }

  const bodyBytes = await readBodyBytes(req);
  const sig = verifySignedRequest(req, bodyBytes, peer, context.nonceCache);
  if (!sig.ok) {
    logAudit(peer, "/api/remote/revoke", "denied", undefined, sig.error);
    return jsonResponse({ error: sig.error }, 401);
  }

  const nextEpoch = (peer.trust_epoch || 1) + 1;
  updateRemotePeer(peer.instance_id, {
    status: "revoked",
    trust_epoch: nextEpoch,
    updated_at: new Date().toISOString(),
  });
  logAudit(peer, "/api/remote/revoke", "revoked", "revoked");
  return jsonResponse({ status: "revoked", trust_epoch: nextEpoch });
}

/** Handle `/api/remote/result` signed result callbacks from a remote peer. */
export async function handleResult(req: Request, context: RemoteOperationHandlersContext): Promise<Response> {
  const peer = requirePeer(req);
  if (peer instanceof Response) return peer;

  const jsonError = requireJson(req);
  if (jsonError) return jsonResponse({ error: jsonError }, 415);
  const lengthCheck = checkContentLength(req, DEFAULT_MAX_RESPONSE_BYTES);
  if (!lengthCheck.ok) return jsonResponse({ error: lengthCheck.error }, lengthCheck.status);

  const bodyBytes = await readBodyBytes(req);
  const sig = verifySignedRequest(req, bodyBytes, peer, context.nonceCache);
  if (!sig.ok) {
    logAudit(peer, "/api/remote/result", "denied", undefined, sig.error);
    return jsonResponse({ error: sig.error }, 401);
  }

  if (!context.resultLimiter.allow(peer.instance_id)) {
    return jsonResponse({ error: "Result callback rate limit exceeded." }, 429);
  }

  const payload = parseJsonBytes(bodyBytes, DEFAULT_MAX_RESPONSE_BYTES);
  if (payload.error) return jsonResponse({ error: payload.error }, 400);

  const data = payload.data!;
  const negotiationId = getTrimmedStringField(data, "negotiation_id");
  if (!negotiationId) return jsonResponse({ error: "Missing negotiation_id." }, 400);

  const decision = getTrimmedStringField(data, "decision") || "unknown";
  const result = typeof data.result === "string" ? data.result : null;
  const reason = typeof data.reason === "string" ? data.reason : null;

  logAudit(peer, "/api/remote/result", decision, decision);

  // Store the result callback so the requesting side has a queryable record.
  storeResultCallback({
    negotiation_id: negotiationId,
    peer_instance_id: peer.instance_id,
    decision,
    result,
    reason,
    received_at: new Date().toISOString(),
  });

  const peerLabel = peer.display_name ?? `${peer.instance_id.slice(0, 6)}…`;
  if (decision === "accept_execute" && result) {
    context.notify?.(`**Result from ${peerLabel}** (proposal \`${negotiationId}\`):\n${result.slice(0, 1000)}${result.length > 1000 ? "…" : ""}`);
  } else if (decision === "deny") {
    context.notify?.(`**${peerLabel}** rejected proposal \`${negotiationId}\`${reason ? ": " + reason : "."}`);
  } else {
    context.notify?.(`**${peerLabel}** returned decision \`${decision}\` for proposal \`${negotiationId}\`.`);
  }

  return jsonResponse({ status: "ok" });
}

// ─── Proposal execution (called via IPC, not HTTP) ───────────────────────────

/**
 * Execute a previously approved mediated proposal. Called from the IPC task
 * handler when an operator runs `/pair approve <id>`.
 *
 * Fetches the proposal from the database, runs it through the agent pool,
 * stores the result, and pushes a signed result callback to the requesting peer.
 */
export async function executeApprovedProposal(
  proposalId: string,
  agentPool: AgentPool,
  notify?: (text: string) => void | Promise<void>,
): Promise<void> {
  const proposal = getRemoteRequestById(proposalId);
  if (!proposal) {
    log.warn("execute_proposal: proposal not found", { proposalId });
    return;
  }
  if (proposal.status !== "pending") {
    log.warn("execute_proposal: proposal not pending", { proposalId, status: proposal.status });
    return;
  }

  const peer = getRemotePeer(proposal.peer_instance_id);
  if (!peer || peer.status !== "paired") {
    updateRemoteRequestDecision(proposalId, "rejected", null, "Peer no longer paired.");
    log.warn("execute_proposal: peer not paired", { proposalId, peerId: proposal.peer_instance_id });
    return;
  }

  const prompt = proposal.prompt;
  if (!prompt) {
    updateRemoteRequestDecision(proposalId, "rejected", null, "Empty prompt.");
    return;
  }

  const maxToolCalls = peer.profile === "full" ? DEFAULT_MAX_TOOL_CALLS_FULL : DEFAULT_MAX_TOOL_CALLS_RESTRICTED;
  const timeoutMs = peer.profile === "full" ? DEFAULT_TIMEOUT_MS_FULL : DEFAULT_TIMEOUT_MS_RESTRICTED;
  const toolCeilingFilter = getToolCeilingFilter(peer.profile) ?? undefined;
  const chatJid = `remote:${peer.instance_id}`;
  const start = Date.now();

  try {
    const output = await agentPool.runAgent(prompt, chatJid, {
      timeoutMs,
      maxToolCalls,
      toolCeilingFilter,
    });
    const duration = Date.now() - start;

    if (output.status === "error") {
      updateRemoteRequestDecision(proposalId, "accepted", null, output.error || "Execution failed.");
      notify?.(`Proposal \`${proposalId}\` execution failed: ${output.error || "unknown error"}`);
      return;
    }

    const resultText = output.result || "";
    updateRemoteRequestDecision(proposalId, "accepted", resultText);

    const peerLabel = peer.display_name ?? `${peer.instance_id.slice(0, 6)}…`;
    notify?.(`Proposal \`${proposalId}\` from **${peerLabel}** executed (${duration}ms).\n\n**Result:**\n${resultText.slice(0, 500)}${resultText.length > 500 ? "…" : ""}`);

    // Push result callback to the requesting peer.
    if (peer.base_url) {
      try {
        const identity = loadOrCreateIdentity();
        const endpoint = "/api/remote/result";
        const body = JSON.stringify({
          negotiation_id: proposalId,
          decision: "accept_execute",
          result: resultText,
          usage: { duration_ms: duration },
        });
        const bodyBytes = new TextEncoder().encode(body);
        const headers = buildSignedRequestHeaders(identity, endpoint, bodyBytes, peer.trust_epoch ?? undefined);
        await fetch(`${peer.base_url}${endpoint}`, { method: "POST", headers, body });
      } catch (err) {
        log.warn("Failed to push result callback", { operation: "execute_proposal.callback", proposalId, err });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateRemoteRequestDecision(proposalId, "accepted", null, msg);
    notify?.(`Proposal \`${proposalId}\` execution threw: ${msg}`);
  }
}

// ─── Proposal rejection (called via IPC, not HTTP) ───────────────────────────

/**
 * Reject a pending mediated proposal. Called from the IPC task handler when
 * an operator or skill runs a rejection command.
 *
 * Updates the proposal status in the database, pushes a signed rejection
 * callback to the requesting peer, and optionally notifies the local chat.
 */
export async function rejectProposal(
  proposalId: string,
  reason?: string | null,
  notify?: (text: string) => void | Promise<void>,
): Promise<void> {
  const proposal = getRemoteRequestById(proposalId);
  if (!proposal) {
    log.warn("reject_proposal: proposal not found", { proposalId });
    return;
  }
  if (proposal.status !== "pending") {
    log.warn("reject_proposal: proposal not pending", { proposalId, status: proposal.status });
    return;
  }

  const rejectReason = reason || "Rejected by operator.";
  updateRemoteRequestDecision(proposalId, "rejected", null, rejectReason);

  const peer = getRemotePeer(proposal.peer_instance_id);
  if (peer?.base_url) {
    try {
      const identity = loadOrCreateIdentity();
      const endpoint = "/api/remote/result";
      const body = JSON.stringify({
        negotiation_id: proposalId,
        decision: "deny",
        reason: rejectReason,
      });
      const bodyBytes = new TextEncoder().encode(body);
      const headers = buildSignedRequestHeaders(identity, endpoint, bodyBytes, peer.trust_epoch ?? undefined);
      await fetch(`${peer.base_url}${endpoint}`, { method: "POST", headers, body });
    } catch (err) {
      log.warn("Failed to push rejection callback", { operation: "reject_proposal.callback", proposalId, err });
    }
  }

  const peerLabel = peer?.display_name ?? `${proposal.peer_instance_id.slice(0, 6)}…`;
  notify?.(`Proposal \`${proposalId}\` from **${peerLabel}** rejected.${rejectReason !== "Rejected by operator." ? ` Reason: ${rejectReason}` : ""}`);
}
