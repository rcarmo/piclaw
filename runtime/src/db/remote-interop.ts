/**
 * db/remote-interop.ts – Persistence for cross-instance interop peers and requests.
 */

import { getDb } from "./connection.js";

type SqlBinding = string | number | bigint | boolean | Uint8Array | null;

/** Lifecycle state for a known remote peer. */
export type RemotePeerStatus = "paired" | "pending" | "denied" | "blocked" | "revoked";
/** Interop mode negotiated with a remote peer. */
export type RemotePeerMode = "mediated" | "short-circuit";
/** Capability profile attached to a remote peer. */
export type RemotePeerProfile = "read-only" | "non-mutating" | "restricted" | "full" | "custom";

/** Row shape for records stored in `remote_peers`. */
export interface RemotePeerRecord {
  instance_id: string;
  public_key: string;
  display_name: string | null;
  status: RemotePeerStatus;
  mode: RemotePeerMode;
  profile: RemotePeerProfile;
  trust_epoch: number | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  blocked_reason: string | null;
  base_url: string | null;
}

/** Row shape for records stored in `remote_pair_requests`. */
export interface RemotePairRequestRecord {
  id: string;
  instance_id: string;
  public_key: string;
  display_name: string | null;
  callback_url: string | null;
  protocol_version: string | null;
  nonce: string | null;
  expires_at: string;
  status: string;
  created_at: string;
  source_ip: string | null;
}

/** Row shape for records stored in `remote_pair_outbound_requests`. */
export interface RemotePairOutboundRecord {
  id: string;
  instance_id: string;
  public_key: string;
  fingerprint: string;
  base_url: string;
  nonce: string;
  status: string;
  expires_at: string;
  created_at: string;
}

/** Row shape for records stored in `remote_requests`. */
export interface RemoteRequestRecord {
  id: string;
  peer_instance_id: string;
  request_type: string;
  status: string;
  prompt: string | null;
  created_at: string;
  decision: string | null;
  remote_mode: string | null;
  error: string | null;
  result: string | null;
}

/** Row shape for records stored in `remote_audit_logs`. */
export interface RemoteAuditRecord {
  peer_instance_id: string | null;
  endpoint: string;
  decision: string | null;
  status: string | null;
  error: string | null;
  created_at: string;
}

/** Insert or update a remote peer by `instance_id`. */
export function upsertRemotePeer(peer: RemotePeerRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO remote_peers (
      instance_id, public_key, display_name, status, mode, profile, trust_epoch,
      created_at, updated_at, last_seen_at, blocked_reason, base_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instance_id) DO UPDATE SET
      public_key = excluded.public_key,
      display_name = excluded.display_name,
      status = excluded.status,
      mode = excluded.mode,
      profile = excluded.profile,
      trust_epoch = excluded.trust_epoch,
      updated_at = excluded.updated_at,
      last_seen_at = excluded.last_seen_at,
      blocked_reason = excluded.blocked_reason,
      base_url = excluded.base_url`
  ).run(
    peer.instance_id,
    peer.public_key,
    peer.display_name,
    peer.status,
    peer.mode,
    peer.profile,
    peer.trust_epoch,
    peer.created_at,
    peer.updated_at,
    peer.last_seen_at,
    peer.blocked_reason,
    peer.base_url ?? null
  );
}

/** Fetch a remote peer by `instance_id`. */
export function getRemotePeer(instanceId: string): RemotePeerRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT instance_id, public_key, display_name, status, mode, profile, trust_epoch,
              created_at, updated_at, last_seen_at, blocked_reason, base_url
       FROM remote_peers WHERE instance_id = ?`
    )
    .get(instanceId) as RemotePeerRecord | undefined;
  return row ?? null;
}

/**
 * Return a peer whose instance_id starts with the first 18 chars of the
 * provided fingerprint (separator dashes removed by position), or null
 * if no match is found.
 *
 * Fingerprint format: `slice(0,6) + '-' + slice(6,12) + '-' + slice(12,18)`.
 * We extract the three groups by scanning for the two separator dashes so that
 * any `-` characters already present in the instance_id are preserved correctly.
 */
export function getRemotePeerByFingerprint(fingerprint: string): RemotePeerRecord | null {
  const fp = fingerprint.trim();
  // Fingerprint format is always exactly XXXXXX-YYYYYY-ZZZZZZ (20 chars) with
  // separator dashes at fixed positions 6 and 13. instance_id is base64url-encoded
  // (SHA-256 hash) and can itself contain '-', so we must NOT use indexOf("-") to
  // locate separators — that would mis-parse fingerprints whose data groups contain
  // embedded dashes. Use fixed positions instead.
  if (fp.length < 20 || fp[6] !== "-" || fp[13] !== "-") return null;
  const prefix = fp.slice(0, 6) + fp.slice(7, 13) + fp.slice(14, 20);
  if (!prefix) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT instance_id, public_key, display_name, status, mode, profile, trust_epoch,
              created_at, updated_at, last_seen_at, blocked_reason, base_url
       FROM remote_peers WHERE instance_id LIKE ?`
    )
    .get(`${prefix}%`) as RemotePeerRecord | undefined;
  return row ?? null;
}

/** Return a peer whose display_name matches (case-insensitive), or null. */
export function getRemotePeerByDisplayName(displayName: string): RemotePeerRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT instance_id, public_key, display_name, status, mode, profile, trust_epoch,
              created_at, updated_at, last_seen_at, blocked_reason, base_url
       FROM remote_peers WHERE lower(display_name) = lower(?)`
    )
    .get(displayName) as RemotePeerRecord | undefined;
  return row ?? null;
}

/** Apply a partial update to a remote peer record. */
export function updateRemotePeer(instanceId: string, updates: Partial<RemotePeerRecord>): void {
  const fields: string[] = [];
  const values: SqlBinding[] = [];
  const addField = (name: keyof RemotePeerRecord, value: SqlBinding | undefined) => {
    if (value === undefined) return;
    fields.push(`${name} = ?`);
    values.push(value);
  };

  addField("public_key", updates.public_key);
  addField("display_name", updates.display_name);
  addField("status", updates.status);
  addField("mode", updates.mode);
  addField("profile", updates.profile);
  addField("trust_epoch", updates.trust_epoch);
  addField("updated_at", updates.updated_at);
  addField("last_seen_at", updates.last_seen_at);
  addField("blocked_reason", updates.blocked_reason);
  addField("base_url", updates.base_url);

  if (!fields.length) return;
  values.push(instanceId);
  const db = getDb();
  db.prepare(`UPDATE remote_peers SET ${fields.join(", ")} WHERE instance_id = ?`).run(...values);
}

/** Insert a new inbound pair request. */
export function createPairRequest(request: RemotePairRequestRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO remote_pair_requests (
      id, instance_id, public_key, display_name, callback_url, protocol_version,
      nonce, expires_at, status, created_at, source_ip
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    request.id,
    request.instance_id,
    request.public_key,
    request.display_name,
    request.callback_url,
    request.protocol_version,
    request.nonce,
    request.expires_at,
    request.status,
    request.created_at,
    request.source_ip
  );
}

/** Fetch a pair request by request ID. */
export function getPairRequestById(id: string): RemotePairRequestRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, instance_id, public_key, display_name, callback_url, protocol_version,
              nonce, expires_at, status, created_at, source_ip
       FROM remote_pair_requests WHERE id = ?`
    )
    .get(id) as RemotePairRequestRecord | undefined;
  return row ?? null;
}

/** Return all pending pair requests, newest first. */
export function getPendingPairRequests(): RemotePairRequestRecord[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, instance_id, public_key, display_name, callback_url, protocol_version,
              nonce, expires_at, status, created_at, source_ip
       FROM remote_pair_requests
       WHERE status = 'pending'
       ORDER BY created_at DESC`
    )
    .all() as RemotePairRequestRecord[];
}

/** Return the newest pending pair request for a remote instance, if any. */
export function getPendingPairRequest(instanceId: string): RemotePairRequestRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, instance_id, public_key, display_name, callback_url, protocol_version,
              nonce, expires_at, status, created_at, source_ip
       FROM remote_pair_requests
       WHERE instance_id = ? AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(instanceId) as RemotePairRequestRecord | undefined;
  return row ?? null;
}

/** Update only the status field on a pair request row. */
export function updatePairRequestStatus(id: string, status: string): void {
  const db = getDb();
  db.prepare("UPDATE remote_pair_requests SET status = ? WHERE id = ?").run(status, id);
}

/** Insert a new outbound pairing request (initiator side). */
export function createOutboundPairRequest(record: RemotePairOutboundRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO remote_pair_outbound_requests
       (id, instance_id, public_key, fingerprint, base_url, nonce, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.instance_id,
    record.public_key,
    record.fingerprint,
    record.base_url,
    record.nonce,
    record.status,
    record.expires_at,
    record.created_at
  );
}

/** Fetch an outbound pair request by ID. */
export function getOutboundPairRequestById(id: string): RemotePairOutboundRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, instance_id, public_key, fingerprint, base_url, nonce, status, expires_at, created_at
       FROM remote_pair_outbound_requests WHERE id = ?`
    )
    .get(id) as RemotePairOutboundRecord | undefined;
  return row ?? null;
}

/** Return the newest pending outbound pair request for a given receiver instance_id. */
export function getPendingOutboundPairRequest(instanceId: string): RemotePairOutboundRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, instance_id, public_key, fingerprint, base_url, nonce, status, expires_at, created_at
       FROM remote_pair_outbound_requests
       WHERE instance_id = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(instanceId) as RemotePairOutboundRecord | undefined;
  return row ?? null;
}

/** Update only the status field on an outbound pair request row. */
export function updateOutboundPairRequestStatus(id: string, status: string): void {
  const db = getDb();
  db.prepare("UPDATE remote_pair_outbound_requests SET status = ? WHERE id = ?").run(status, id);
}


export function storeRemoteRequest(request: RemoteRequestRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO remote_requests (
      id, peer_instance_id, request_type, status, prompt, created_at, decision, remote_mode, error, result
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    request.id,
    request.peer_instance_id,
    request.request_type,
    request.status,
    request.prompt,
    request.created_at,
    request.decision,
    request.remote_mode,
    request.error,
    request.result
  );
}

/** Fetch a remote request record by ID. */
export function getRemoteRequestById(id: string): RemoteRequestRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, peer_instance_id, request_type, status, prompt, created_at, decision, remote_mode, error, result
       FROM remote_requests WHERE id = ?`
    )
    .get(id) as RemoteRequestRecord | undefined;
  return row ?? null;
}

/** Return all pending remote requests, newest first. */
export function getPendingRemoteRequests(): RemoteRequestRecord[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, peer_instance_id, request_type, status, prompt, created_at, decision, remote_mode, error, result
       FROM remote_requests
       WHERE status = 'pending'
       ORDER BY created_at DESC`
    )
    .all() as RemoteRequestRecord[];
}

/** Return all remote requests (any status), newest first. Supports pagination. */
export function getAllRemoteRequests(limit = 50, offset = 0): RemoteRequestRecord[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, peer_instance_id, request_type, status, prompt, created_at, decision, remote_mode, error, result
       FROM remote_requests
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as RemoteRequestRecord[];
}

/** Return the total count of remote requests. */
export function countRemoteRequests(): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM remote_requests`).get() as { cnt: number };
  return row.cnt;
}

/** Update the decision, result, and status of a remote request. */
export function updateRemoteRequestDecision(
  id: string,
  decision: string,
  result?: string | null,
  error?: string | null,
): void {
  const db = getDb();
  db.prepare(
    `UPDATE remote_requests SET decision = ?, result = ?, error = ?, status = ? WHERE id = ?`
  ).run(decision, result ?? null, error ?? null, decision === "accepted" ? "completed" : decision, id);
}

/** Append an audit event for remote interop endpoint activity. */
export function logRemoteAudit(entry: RemoteAuditRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO remote_audit_logs (peer_instance_id, endpoint, decision, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    entry.peer_instance_id,
    entry.endpoint,
    entry.decision,
    entry.status,
    entry.error,
    entry.created_at
  );
}

/** Row shape for received result callbacks (requesting side). */
export interface RemoteResultCallbackRecord {
  negotiation_id: string;
  peer_instance_id: string;
  decision: string;
  result: string | null;
  reason: string | null;
  received_at: string;
}

/** Store a result callback received from a remote peer. */
export function storeResultCallback(record: RemoteResultCallbackRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO remote_result_callbacks
       (negotiation_id, peer_instance_id, decision, result, reason, received_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    record.negotiation_id,
    record.peer_instance_id,
    record.decision,
    record.result,
    record.reason,
    record.received_at
  );
}
