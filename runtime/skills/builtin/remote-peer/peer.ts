#!/usr/bin/env bun
/**
 * SCRIPT_JDOC:
 * {
 *   "summary": "Send prompts to paired remote piclaw peers, list peers, and manage incoming proposals.",
 *   "aliases": [
 *     "remote peer",
 *     "peer"
 *   ],
 *   "domains": [
 *     "remote",
 *     "interop",
 *     "peer"
 *   ],
 *   "verbs": [
 *     "send",
 *     "list",
 *     "decide",
 *     "pending"
 *   ],
 *   "nouns": [
 *     "peer",
 *     "proposal",
 *     "prompt",
 *     "remote"
 *   ],
 *   "keywords": [
 *     "remote-peer",
 *     "signed request",
 *     "IPC",
 *     "proposal",
 *     "accept",
 *     "reject",
 *     "execute",
 *     "short-circuit"
 *   ],
 *   "guidance": [
 *     "Runnable script entrypoint.",
 *     "Packaged script surface.",
 *     "Uses Ed25519 signing to authenticate requests to remote peers."
 *   ],
 *   "examples": [
 *     "send a prompt to a remote peer",
 *     "list remote peers",
 *     "show pending proposals",
 *     "accept a proposal",
 *     "reject all pending proposals"
 *   ],
 *   "kind": "mixed",
 *   "weight": "standard",
 *   "role": "entrypoint"
 * }
 */
/**
 * runtime/skills/builtin/remote-peer/peer.ts
 *
 * CLI helper for piclaw remote-peer operations.
 *
 * Commands:
 *   list                          — list all paired peers
 *   send <fingerprint> <prompt>   — send a prompt to a peer
 *   pending                       — show pending incoming proposals
 *   decide <id> accept|reject     — accept or reject a pending proposal
 *   decide-all accept|reject      — bulk-decide all pending proposals
 *
 * Environment (auto-injected by piclaw bash tool):
 *   PICLAW_DATA      — piclaw data dir  (default: /workspace/.piclaw/data)
 *   PICLAW_STORE     — piclaw store dir (default: /workspace/.piclaw/store)
 *
 * CLI overrides:
 *   --store-dir <dir>  — override PICLAW_STORE for DB location
 *   --data-dir <dir>   — override PICLAW_DATA for identity/IPC location
 */

import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash, createPrivateKey, sign } from "crypto";
import Database from "bun:sqlite";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Identity {
  instance_id: string;
  private_key: string;
  public_key: string;
}

interface RemotePeer {
  instance_id: string;
  display_name: string | null;
  status: string;
  mode: string;
  profile: string;
  base_url: string | null;
  trust_epoch: number;
  updated_at: string;
}

interface RemoteRequest {
  id: string;
  peer_instance_id: string;
  request_type: string;
  remote_mode: string;
  prompt: string | null;
  status: string;
  decision: string | null;
  error: string | null;
  created_at: string;
}

interface CanonicalParts {
  method: string;
  path: string;
  contentType: string;
  bodyHash: string;
  timestamp: string;
  nonce: string;
  instanceId: string;
  trustEpoch?: number;
}

interface SendResult {
  status: number;
  isShortCircuit: boolean;
  remotePath: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

function cliArg(flag: string, fallback: string): string {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length && !argv[idx + 1].startsWith("--")) {
    return argv[idx + 1];
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_DIR  = cliArg("--data-dir",  process.env.PICLAW_DATA  || "/workspace/.piclaw/data");
const STORE_DIR = cliArg("--store-dir", process.env.PICLAW_STORE || "/workspace/.piclaw/store");
const IDENTITY_PATH = join(DATA_DIR, "interop", "identity.json");
const DB_PATH       = join(STORE_DIR, "messages.db");

// ---------------------------------------------------------------------------
// Crypto helpers (mirrors piclaw runtime signing)
// ---------------------------------------------------------------------------

function b64uEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64uDecode(str: string): Buffer {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function hashBody(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildCanonical(parts: CanonicalParts): string {
  const lines = [
    parts.method,
    parts.path,
    parts.contentType,
    parts.bodyHash,
    parts.timestamp,
    parts.nonce,
    parts.instanceId,
    "v1",
  ];
  if (parts.trustEpoch !== undefined) lines.push(String(parts.trustEpoch));
  return lines.join("\n");
}

function signPayload(identity: Identity, payload: string): string {
  const key = createPrivateKey({
    key: b64uDecode(identity.private_key),
    format: "der",
    type: "pkcs8",
  });
  return b64uEncode(sign(null, Buffer.from(payload, "utf8"), key));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadIdentity(): Identity {
  return JSON.parse(readFileSync(IDENTITY_PATH, "utf8"));
}

function openDb(): InstanceType<typeof Database> {
  return new Database(DB_PATH);
}

function fingerprint(instanceId: string): string {
  return `${instanceId.slice(0, 6)}-${instanceId.slice(6, 12)}-${instanceId.slice(12, 18)}`;
}

function peerMap(db: InstanceType<typeof Database>): Map<string, string> {
  const rows = db.query("SELECT instance_id, display_name FROM remote_peers").all() as Pick<RemotePeer, "instance_id" | "display_name">[];
  return new Map(rows.map((r) => [r.instance_id, r.display_name ?? r.instance_id.slice(0, 16)]));
}

function resolvePeer(db: InstanceType<typeof Database>, ref: string): RemotePeer | undefined {
  const all = db.query("SELECT * FROM remote_peers WHERE status = 'paired'").all() as RemotePeer[];
  return all.find(
    (p) =>
      p.display_name === ref ||
      p.instance_id === ref ||
      p.instance_id.startsWith(ref) ||
      fingerprint(p.instance_id) === ref,
  );
}

function buildSignedHeaders(
  identity: Identity,
  peer: RemotePeer,
  endpoint: string,
  body: string,
): Record<string, string> {
  const bodyBytes = new TextEncoder().encode(body);
  const timestamp = new Date().toISOString();
  const nonce = `nonce-${crypto.randomUUID().replace(/-/g, "")}`;

  const canonical = buildCanonical({
    method: "POST",
    path: endpoint,
    contentType: "application/json",
    bodyHash: hashBody(bodyBytes),
    timestamp,
    nonce,
    instanceId: identity.instance_id,
    trustEpoch: peer.trust_epoch,
  });
  const signature = signPayload(identity, canonical);

  return {
    "Content-Type": "application/json",
    "X-Instance-Id": identity.instance_id,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "X-Sig-Version": "v1",
    "X-Signature": signature,
    "X-Trust-Epoch": String(peer.trust_epoch),
    "X-Request-Hop": "0",
  };
}

async function sendToPeer(peer: RemotePeer, prompt: string): Promise<SendResult> {
  const identity = loadIdentity();
  const isShortCircuit = peer.mode === "short-circuit" && peer.profile === "full";
  const remotePath = isShortCircuit ? "/api/remote/execute" : "/api/remote/proposal";
  const targetUrl = `${peer.base_url!.replace(/\/$/, "")}${remotePath}`;
  const body = JSON.stringify({ prompt });

  const headers = buildSignedHeaders(identity, peer, remotePath, body);
  const response = await fetch(targetUrl, { method: "POST", headers, body });
  const data = (await response.json()) as Record<string, unknown>;
  return { status: response.status, isShortCircuit, remotePath, data };
}

// ---------------------------------------------------------------------------
// IPC helpers
// ---------------------------------------------------------------------------

/**
 * Write an IPC task file to trigger proposal execution via the agent pool.
 * This mirrors what `/pair approve` does in the runtime.
 */
function writeExecuteProposalIpc(proposalId: string): void {
  const dir = join(DATA_DIR, "ipc", "tasks");
  mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify({ type: "execute_proposal", proposal_id: proposalId });
  writeFileSync(join(dir, `proposal-${proposalId}-${Date.now()}.json`), payload);
}

/**
 * Write an IPC task file to trigger proposal rejection via the runtime.
 * The runtime handles DB update + signed rejection callback push.
 * This mirrors what `/pair reject` does in the runtime.
 */
function writeRejectProposalIpc(proposalId: string, reason?: string): void {
  const dir = join(DATA_DIR, "ipc", "tasks");
  mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify({ type: "reject_proposal", proposal_id: proposalId, reason: reason || undefined });
  writeFileSync(join(dir, `reject-${proposalId}-${Date.now()}.json`), payload);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdList(): void {
  const db = openDb();
  const rows = db.query("SELECT * FROM remote_peers ORDER BY updated_at DESC").all() as RemotePeer[];
  if (!rows.length) {
    console.log("No remote peers found.");
    return;
  }
  for (const p of rows) {
    const fp = fingerprint(p.instance_id);
    console.log(
      `${p.display_name ?? "(unnamed)"} | ${fp} | ${p.status} / ${p.mode} / ${p.profile} | ${p.base_url ?? "no url"}`,
    );
  }
}

async function cmdSend(ref: string | undefined, prompt: string | undefined): Promise<void> {
  if (!ref || !prompt) {
    console.error("Usage: peer.ts send <fingerprint|name> <prompt>");
    process.exit(1);
  }
  const db = openDb();
  const peer = resolvePeer(db, ref);
  if (!peer) {
    console.error(`No paired peer found for "${ref}".`);
    process.exit(1);
  }

  const fp = fingerprint(peer.instance_id);
  console.log(`Sending to ${peer.display_name ?? fp} (${fp}) via ${peer.mode}/${peer.profile} ...`);

  let res: SendResult;
  try {
    res = await sendToPeer(peer, prompt);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to reach peer: ${msg}`);
    process.exit(1);
  }
  const { status, isShortCircuit, remotePath, data } = res;
  console.log(`HTTP ${status}  →  ${remotePath}`);

  if (!isShortCircuit) {
    console.log(`Decision : ${(data.decision as string) ?? "unknown"}`);
    if (data.reason) console.log(`Reason   : ${data.reason}`);
    if (data.negotiation_id) console.log(`Neg ID   : ${data.negotiation_id}`);
  } else {
    console.log(`Decision : ${(data.decision as string) ?? "unknown"}`);
    if (data.result) {
      console.log("\n--- Peer response ---");
      console.log(data.result);
    }
    if (data.error) console.log(`Error    : ${data.error}`);
  }
}

function cmdPending(): void {
  const db = openDb();
  const names = peerMap(db);
  const rows = db
    .query("SELECT * FROM remote_requests WHERE status = 'pending' ORDER BY created_at ASC")
    .all() as RemoteRequest[];
  if (!rows.length) {
    console.log("No pending requests.");
    return;
  }
  console.log(`${rows.length} pending request(s):\n`);
  for (const r of rows) {
    const name = names.get(r.peer_instance_id) ?? r.peer_instance_id.slice(0, 16) + "...";
    const prompt = (r.prompt ?? "").replace(/^"|"$/g, "").trim();
    console.log(`ID      : ${r.id}`);
    console.log(`From    : ${name}`);
    console.log(`Type    : ${r.request_type}  |  mode: ${r.remote_mode}`);
    console.log(`Created : ${r.created_at}`);
    console.log(`Prompt  : ${prompt}`);
    console.log();
  }
}

function cmdDecide(id: string | undefined, verdict: string | undefined): void {
  if (!id || !verdict || !["accept", "reject"].includes(verdict)) {
    console.error("Usage: peer.ts decide <request-id> accept|reject");
    process.exit(1);
  }
  const db = openDb();
  const proposal = db
    .query("SELECT * FROM remote_requests WHERE id = ? AND status = 'pending'")
    .get(id) as RemoteRequest | null;
  if (!proposal) {
    console.log(`No pending request found with id "${id}".`);
    return;
  }

  if (verdict === "accept") {
    writeExecuteProposalIpc(id);
    console.log(`Request ${id} → queued for execution.`);
  } else {
    writeRejectProposalIpc(id);
    console.log(`Request ${id} → queued for rejection.`);
  }
}

function cmdDecideAll(verdict: string | undefined): void {
  if (!verdict || !["accept", "reject"].includes(verdict)) {
    console.error("Usage: peer.ts decide-all accept|reject");
    process.exit(1);
  }
  const db = openDb();
  const rows = db.query("SELECT * FROM remote_requests WHERE status = 'pending'").all() as RemoteRequest[];
  if (!rows.length) {
    console.log("No pending requests.");
    return;
  }

  for (const proposal of rows) {
    if (verdict === "accept") {
      writeExecuteProposalIpc(proposal.id);
    } else {
      writeRejectProposalIpc(proposal.id);
    }
  }
  console.log(`${rows.length} request(s) → ${verdict === "accept" ? "queued for execution" : "queued for rejection"}.`);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

// Strip --flag args so positional parsing works
const positional = argv.filter((a, i) => {
  if (a.startsWith("--")) return false;
  if (i > 0 && argv[i - 1].startsWith("--") && !a.startsWith("-")) return false;
  return true;
});

const [cmd, ...args] = positional;

switch (cmd) {
  case "list":
    cmdList();
    break;
  case "send":
    await cmdSend(args[0], args.slice(1).join(" "));
    break;
  case "pending":
    cmdPending();
    break;
  case "decide":
    cmdDecide(args[0], args[1]);
    break;
  case "decide-all":
    cmdDecideAll(args[0]);
    break;
  default:
    console.log(
      "Commands: list | send <peer> <prompt> | pending | decide <id> accept|reject | decide-all accept|reject",
    );
    process.exit(1);
}
