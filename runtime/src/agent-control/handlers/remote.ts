/**
 * agent-control/handlers/remote.ts – Cross-instance IPC slash commands.
 *
 * Commands:
 *   /ask <instance_id|fingerprint> <prompt>
 *     – Send a prompt to a paired remote instance via the mediated proposal
 *       endpoint. Requires PICLAW_REMOTE_INTEROP_ENABLED=1 and a paired peer
 *       record with a base_url.
 */

import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";
import { getRemoteInteropConfig } from "../../core/config.js";
import { getRemotePeer, getRemotePeerByDisplayName, getRemotePeerByFingerprint } from "../../db/remote-interop.js";
import { loadOrCreateIdentity, deriveFingerprint } from "../../remote/identity.js";
import { buildSignedRequestHeaders } from "../../extensions/remote-pair.js";
import { randomUUID } from "crypto";

type AskCommand = Extract<AgentControlCommand, { type: "ask" }>;

/** Fingerprint pattern: three 6-char groups separated by dashes. */
const FINGERPRINT_RE = /^[A-Za-z0-9_-]{6}-[A-Za-z0-9_-]{6}-[A-Za-z0-9_-]{6}$/;

/** Handle `/ask <instance_id|fingerprint> <prompt>` for cross-instance IPC. */
export async function handleAsk(_session: AgentSession, command: AskCommand): Promise<AgentControlResult> {
  const config = getRemoteInteropConfig();
  if (!config.enabled) {
    return {
      status: "error",
      message: "Cross-instance IPC is disabled. Set PICLAW_REMOTE_INTEROP_ENABLED=1 to enable it.",
    };
  }

  const { instanceId, prompt } = command;

  if (!instanceId) {
    return {
      status: "error",
      message: "Usage: /ask <instance_id|fingerprint> <prompt>",
    };
  }

  if (!prompt) {
    return {
      status: "error",
      message: "Usage: /ask <instance_id|fingerprint> <prompt>\n\nNo prompt provided.",
    };
  }

  // Resolve peer by fingerprint, instance_id, or display_name.
  const peer = FINGERPRINT_RE.test(instanceId)
    ? getRemotePeerByFingerprint(instanceId)
    : (getRemotePeer(instanceId) ?? getRemotePeerByDisplayName(instanceId));

  if (!peer) {
    return {
      status: "error",
      message: `No paired peer found for "${instanceId}". Use /pair list to see paired instances.`,
    };
  }

  if (peer.status !== "paired") {
    return {
      status: "error",
      message: `Peer "${instanceId}" is not paired (status: ${peer.status}).`,
    };
  }

  if (!peer.base_url) {
    return {
      status: "error",
      message:
        `Peer "${peer.display_name ?? peer.instance_id}" has no base URL stored.\n\n` +
        `This usually means the peer was paired before the \`base_url\` field was introduced, ` +
        `or the pair request arrived without a resolvable callback URL.\n\n` +
        `Fix: re-run \`/pair request <url>\` targeting that instance to refresh its record, ` +
        `and make sure \`PICLAW_WEB_EXTERNAL_URL\` is set to this instance's reachable base URL ` +
        `before initiating pairing.`,
    };
  }

  const isShortCircuit = peer.mode === "short-circuit" && peer.profile === "full";
  const remotePath = isShortCircuit ? "/api/remote/execute" : "/api/remote/proposal";
  const targetUrl = `${peer.base_url.replace(/\/$/, "")}${remotePath}`;

  // Build signed outbound request using the shared signing helper.
  const identity = loadOrCreateIdentity();
  const body = JSON.stringify({ prompt });
  const bodyBytes = new TextEncoder().encode(body);
  const headers = buildSignedRequestHeaders(identity, remotePath, bodyBytes, peer.trust_epoch ?? undefined);
  headers["X-Request-Hop"] = "0";
  headers["X-Request-Chain-Id"] = randomUUID();

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", message: `Failed to reach peer: ${msg}` };
  }

  let data: unknown;
  let rawBody: string;
  try {
    rawBody = await response.text();
  } catch {
    return { status: "error", message: `Peer returned unreadable response (HTTP ${response.status}).` };
  }

  try {
    data = JSON.parse(rawBody);
  } catch {
    return {
      status: "error",
      message: `Peer returned non-JSON response (HTTP ${response.status}).\n\nBody: ${rawBody.slice(0, 200)}`,
    };
  }

  if (!response.ok) {
    const errMsg = (data && typeof data === "object" && "error" in data)
      ? String((data as Record<string, unknown>).error)
      : `HTTP ${response.status}`;
    return { status: "error", message: `Remote peer rejected request: ${errMsg}` };
  }

  const peerLabel = peer.display_name ?? peer.instance_id;
  const d = (data && typeof data === "object") ? (data as Record<string, unknown>) : {};
  const decision = d.decision ? String(d.decision) : "unknown";
  const fingerprint = deriveFingerprint(peer.instance_id);
  const lines = [`**Sent to ${peerLabel}** (${fingerprint})`, `Decision: \`${decision}\``];

  if (isShortCircuit) {
    const result = d.result ? String(d.result) : "";
    if (result) lines.push("", result);
  } else {
    const reason = d.reason ? String(d.reason) : "";
    const negotiationId = d.negotiation_id ? String(d.negotiation_id) : "";
    if (reason) lines.push(`Reason: ${reason}`);
    if (negotiationId) lines.push(`Negotiation ID: \`${negotiationId}\``);
  }

  return { status: "success", message: lines.join("\n") };
}
