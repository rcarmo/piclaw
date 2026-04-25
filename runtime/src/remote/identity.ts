/**
 * remote/identity.ts – Local identity key material for remote interop.
 *
 * Handles loading/creating the container's interop identity, deriving stable
 * IDs/fingerprints, and signing/verifying payloads with stored Ed25519 keys.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "fs";
import { join, resolve } from "path";
import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from "crypto";
import { DATA_DIR, getRemoteInteropConfig } from "../core/config.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";

const log = createLogger("remote.identity");

/** Persisted local identity record for remote interop communication. */
export interface InteropIdentity {
  instance_id: string;
  public_key: string;
  private_key: string;
  fingerprint: string;
  instance_name: string;
  created_at: string;
}

let cachedIdentity: InteropIdentity | null = null;

/** Compute the identity file path from the current environment at call time. */
function getIdentityPath(): string {
  const dataDir = resolve(process.env.PICLAW_DATA || join(resolve(process.env.PICLAW_WORKSPACE || "/workspace"), ".piclaw", "data"));
  return join(dataDir, "interop", "identity.json");
}

function base64UrlEncode(buffer: Uint8Array): string {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function computeInstanceId(publicKeyDer: Uint8Array): string {
  const hash = createHash("sha256").update(publicKeyDer).digest();
  return base64UrlEncode(hash);
}

function computeFingerprint(instanceId: string): string {
  return `${instanceId.slice(0, 6)}-${instanceId.slice(6, 12)}-${instanceId.slice(12, 18)}`;
}

/** Load the interop identity from disk, creating a new one if missing. */
export function loadOrCreateIdentity(): InteropIdentity {
  if (cachedIdentity) return cachedIdentity;

  const identityPath = getIdentityPath();

  if (existsSync(identityPath)) {
    const raw = readFileSync(identityPath, "utf8");
    const parsed = JSON.parse(raw) as InteropIdentity;
    cachedIdentity = parsed;
    return parsed;
  }

  mkdirSync(join(identityPath, ".."), { recursive: true });

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const privateDer = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;

  const instanceId = computeInstanceId(publicDer);
  const identity: InteropIdentity = {
    instance_id: instanceId,
    public_key: base64UrlEncode(publicDer),
    private_key: base64UrlEncode(privateDer),
    fingerprint: computeFingerprint(instanceId),
    instance_name: getRemoteInteropConfig().instanceName || "piclaw",
    created_at: new Date().toISOString(),
  };

  writeFileSync(identityPath, JSON.stringify(identity, null, 2), "utf8");
  try {
    chmodSync(identityPath, 0o600);
  } catch (err) {
    debugSuppressedError(log, "Failed to chmod remote interop identity file to 0600.", err, {
      operation: "remote_identity.ensure_identity.chmod",
      path: identityPath,
    });
  }

  cachedIdentity = identity;
  return identity;
}

/** Reset in-memory identity cache (test helper). */
export function resetInteropIdentityForTests(): void {
  cachedIdentity = null;
}

/** Decode and return the binary public key from an identity record. */
export function exportPublicKey(identity: InteropIdentity): Buffer {
  return Buffer.from(base64UrlDecode(identity.public_key));
}

/** Decode and return the binary private key from an identity record. */
export function exportPrivateKey(identity: InteropIdentity): Buffer {
  return Buffer.from(base64UrlDecode(identity.private_key));
}

/** Sign a UTF-8 payload using the identity's private key (base64url output). */
export function signPayload(identity: InteropIdentity, payload: string): string {
  const key = createPrivateKey({ key: exportPrivateKey(identity), format: "der", type: "pkcs8" });
  const signature = sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(signature);
}

/** Verify a payload signature using a base64url-encoded public key. */
export function verifyPayload(publicKey: string, payload: string, signature: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(base64UrlDecode(publicKey)), format: "der", type: "spki" });
    return verify(null, Buffer.from(payload, "utf8"), key, base64UrlDecode(signature));
  } catch {
    return false;
  }
}

/** Derive stable instance ID from a base64url public key. */
export function deriveInstanceId(publicKey: string): string {
  return computeInstanceId(base64UrlDecode(publicKey));
}

/** Derive the short human-readable fingerprint from an instance ID. */
export function deriveFingerprint(instanceId: string): string {
  return computeFingerprint(instanceId);
}
