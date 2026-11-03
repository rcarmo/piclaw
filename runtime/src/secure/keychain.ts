/**
 * secure/keychain.ts – Encrypted credential storage using AES-256-GCM.
 *
 * Provides a simple keychain API for storing and retrieving secrets (API
 * tokens, passwords, etc.) encrypted at rest in the SQLite database.
 *
 * Encryption details:
 *   - Key derivation: PBKDF2-SHA256 with 150k iterations and a random salt.
 *   - Encryption: AES-256-GCM with a random 12-byte nonce and the entry
 *     name as additional authenticated data (AAD).
 *   - The master key material is read from the PICLAW_KEYCHAIN_KEY env var
 *     or from a file specified by PICLAW_KEYCHAIN_KEY_FILE.
 *
 * Placeholder resolution:
 *   - resolveKeychainEnv() replaces "keychain:name" values in env records.
 *   - resolveKeychainPlaceholders() replaces inline placeholders in strings.
 *   Both are used by tools/tracked-bash.ts before spawning child processes.
 *
 * Consumers:
 *   - tools/tracked-bash.ts calls resolveKeychainEnv/resolveKeychainPlaceholders.
 *   - agent-control/handlers (via CLI) calls set/get/list/delete operations.
 *   - cli.ts exposes keychain sub-commands.
 */

import { getDb, captureHostDatabaseBinding } from "../db/connection.js";
import { admitSqliteWrite } from "../db/sqlite-async-admission.js";
import { readKeychainBootstrapKeyMaterial, getKeychainBootstrapConfig } from "../core/config.js";
// External provider fallback — see docs/keychain.md#external-keychain-providers
import { getFromExternalProviders, listFromExternalProviders } from "./keychain-providers.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const KEYCHAIN_PREFIX = "keychain:";
const SHELL_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KDF_ALGO = "pbkdf2-sha256";
const KDF_ITERATIONS = 150_000;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const USERNAME_REF_FIELDS = new Set(["username", "user"]);
const SECRET_REF_FIELDS = new Set(["secret", "password", "token"]);

const toArrayBuffer = (value: Uint8Array): ArrayBuffer =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;

/** Entry type classification for display/filtering purposes. */
export type KeychainEntryType = "token" | "password" | "basic" | "secret";

/** A decrypted keychain entry with its plaintext secret and optional username. */
export interface KeychainEntry {
  name: string;
  type: KeychainEntryType;
  secret: string;
  username?: string | null;
  /** UI-only note for humans; not exposed through agent keychain list output. */
  userNote?: string | null;
  /** Agent-readable note safe to expose in keychain list metadata. */
  agentNote?: string | null;
}

/** Metadata-only view of a keychain entry (no secret), used by listKeychainEntries(). */
export interface KeychainEntryMetadata {
  name: string;
  type: KeychainEntryType;
  agentNote: string;
  createdAt: string;
  updatedAt: string;
}

/** UI metadata view that includes the user-readable note. */
export interface KeychainEntryUiMetadata extends KeychainEntryMetadata {
  userNote: string;
}

interface KeychainRow {
  name: string;
  type: KeychainEntryType;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  salt: Uint8Array;
  kdf: string;
  kdf_iterations: number;
}

/** Pluggable key material source for runtime/tests. */
export interface KeyMaterialProvider {
  getKeyMaterial(): Uint8Array;
}

function readKeyMaterialFromEnv(): Uint8Array {
  const rawKey = readKeychainBootstrapKeyMaterial();
  if (!rawKey) {
    throw new Error("Keychain is disabled. Set PICLAW_KEYCHAIN_KEY or PICLAW_KEYCHAIN_KEY_FILE.");
  }
  return encoder.encode(rawKey);
}

let keyMaterialProvider: KeyMaterialProvider = {
  getKeyMaterial: readKeyMaterialFromEnv,
};

/** Secret-free availability for authenticated settings surfaces. */
export function getKeychainStatus(): { enabled: boolean; reason: 'ready' | 'not_configured' | 'unavailable' } {
  try { return loadKeyMaterial().length > 0 ? { enabled: true, reason: 'ready' } : { enabled: false, reason: 'not_configured' }; }
  catch { const config = getKeychainBootstrapConfig(); return { enabled: false, reason: config.key || config.keyFile ? 'unavailable' : 'not_configured' }; }
}

function loadKeyMaterial(): Uint8Array {
  return keyMaterialProvider.getKeyMaterial();
}

/** Override/reset key material provider for tests and advanced runtime composition. */
export function setKeyMaterialProviderForTests(provider: KeyMaterialProvider | null): void {
  keyMaterialProvider = provider ?? { getKeyMaterial: readKeyMaterialFromEnv };
}

async function deriveAesKey(salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const keyMaterial = loadKeyMaterial();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyMaterial),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

function parseSecretPayload(payload: string): { secret: string; username?: string | null } {
  const data = JSON.parse(payload) as { secret?: string; username?: string | null };
  if (!data?.secret) {
    throw new Error("Invalid keychain payload.");
  }
  return { secret: data.secret, username: data.username };
}

async function encryptPayload(name: string, secret: string, username?: string | null) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await deriveAesKey(salt, KDF_ITERATIONS);
  const additionalData = encoder.encode(name);
  const payload = encoder.encode(JSON.stringify({ secret, username: username ?? null }));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData }, key, payload)
  );
  return { ciphertext, nonce, salt, kdf: KDF_ALGO, kdfIterations: KDF_ITERATIONS };
}

async function decryptPayload(name: string, row: KeychainRow): Promise<{ secret: string; username?: string | null }> {
  const key = await deriveAesKey(new Uint8Array(row.salt), row.kdf_iterations);
  const additionalData = encoder.encode(name);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(row.nonce), additionalData },
    key,
    new Uint8Array(row.ciphertext)
  );
  return parseSecretPayload(decoder.decode(plaintext));
}

/** Encrypt and store (or update) a keychain entry in the database. */
export async function setKeychainEntry(input: KeychainEntry, authorise: () => void = () => {}, signal?: AbortSignal): Promise<void> {
  const entry = structuredClone(input);
  if (!entry.name) {
    throw new Error("Keychain entry name is required.");
  }
  if (!entry.secret) {
    throw new Error("Keychain entry secret is required.");
  }
  const db = getDb(), binding = captureHostDatabaseBinding(db);
  const check = (phase?: 'before' | 'after') => { binding(); authorise(); if (phase === undefined && db.inTransaction) throw Error("Keychain mutation requires its own transaction"); };
  check(); signal?.throwIfAborted();
  const payload = await encryptPayload(entry.name, entry.secret, entry.username ?? null);
  const hasUserNote = entry.userNote !== undefined;
  const hasAgentNote = entry.agentNote !== undefined;
  await admitSqliteWrite(db, () => { db.prepare(
    `INSERT INTO keychain_entries (
        name,
        type,
        ciphertext,
        nonce,
        salt,
        kdf,
        kdf_iterations,
        user_note,
        agent_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        type = excluded.type,
        ciphertext = excluded.ciphertext,
        nonce = excluded.nonce,
        salt = excluded.salt,
        kdf = excluded.kdf,
        kdf_iterations = excluded.kdf_iterations,
        user_note = CASE WHEN ? THEN excluded.user_note ELSE keychain_entries.user_note END,
        agent_note = CASE WHEN ? THEN excluded.agent_note ELSE keychain_entries.agent_note END,
        updated_at = CURRENT_TIMESTAMP`
  ).run(
    entry.name,
    entry.type,
    Buffer.from(payload.ciphertext),
    Buffer.from(payload.nonce),
    Buffer.from(payload.salt),
    payload.kdf,
    payload.kdfIterations,
    String(entry.userNote ?? ""),
    String(entry.agentNote ?? ""),
    hasUserNote ? 1 : 0,
    hasAgentNote ? 1 : 0,
  ); }, check, signal, undefined, check);
}

/**
 * Retrieve and decrypt a keychain entry by name.
 *
 * Lookup order:
 *   1. Internal encrypted SQLite keychain
 *   2. Registered external keychain providers (see keychain-providers.ts)
 *
 * Throws if the entry is not found in any source.
 */
export async function getKeychainEntry(name: string): Promise<KeychainEntry> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT name, type, ciphertext, nonce, salt, kdf, kdf_iterations
       FROM keychain_entries
       WHERE name = ?`
    )
    .get(name) as KeychainRow | undefined;
  if (row) {
    if (row.kdf !== KDF_ALGO) {
      throw new Error(`Unsupported keychain KDF: ${row.kdf}`);
    }
    const payload = await decryptPayload(row.name, row);
    return { name: row.name, type: row.type, secret: payload.secret, username: payload.username };
  }
  // Fallback to registered external keychain providers
  const external = await getFromExternalProviders(name);
  if (external) {
    return external;
  }
  throw new Error(`Keychain entry not found: ${name}`);
}

/** List all keychain entry names and types (no secrets). Internal entries only (sync). */
export function listKeychainEntries(): KeychainEntryMetadata[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT name, type, agent_note as agentNote, created_at as createdAt, updated_at as updatedAt
       FROM keychain_entries
       ORDER BY name`
    )
    .all() as KeychainEntryMetadata[];
  return rows;
}

/** Metadata-only view for the web UI, including user-readable notes. */
export function listKeychainEntriesForUi(): KeychainEntryUiMetadata[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT name, type, user_note as userNote, agent_note as agentNote, created_at as createdAt, updated_at as updatedAt
       FROM keychain_entries
       ORDER BY name`
    )
    .all() as KeychainEntryUiMetadata[];
  return rows;
}

/** Update non-secret notes for an existing keychain entry. */
export async function updateKeychainEntryNotes(name: string, notes: { userNote?: string | null; agentNote?: string | null }, authorise: () => void = () => {}, signal?: AbortSignal): Promise<boolean> {
  const userNote = typeof notes.userNote === "string" ? notes.userNote : "";
  const agentNote = typeof notes.agentNote === "string" ? notes.agentNote : "";
  const db = getDb(), binding = captureHostDatabaseBinding(db);
  const check = (phase?: 'before' | 'after') => { binding(); authorise(); if (phase === undefined && db.inTransaction) throw Error("Keychain mutation requires its own transaction"); };
  return admitSqliteWrite(db, () => { const result = db.prepare(
    `UPDATE keychain_entries
     SET user_note = ?, agent_note = ?, updated_at = CURRENT_TIMESTAMP
     WHERE name = ?`
  ).run(userNote, agentNote, name);
  return result.changes > 0; }, check, signal, undefined, check);
}

/**
 * List all entries from both internal keychain and registered external providers.
 *
 * Internal entries take precedence — if both internal and external have the
 * same name, only the internal entry appears. External-only entries are
 * appended with null timestamps.
 */
export async function listAllKeychainEntries(): Promise<KeychainEntryMetadata[]> {
  const internal = listKeychainEntries();
  const internalNames = new Set(internal.map((e) => e.name));
  const external = await listFromExternalProviders();
  // Merge: internal entries take precedence, external entries fill in gaps
  const merged = [...internal];
  for (const ext of external) {
    if (!internalNames.has(ext.name)) {
      merged.push({ name: ext.name, type: ext.type, agentNote: "", createdAt: "", updatedAt: "" });
    }
  }
  return merged;
}

/** Delete a keychain entry by name. Returns true if the entry existed. */
export async function deleteKeychainEntry(name: string, authorise: () => void = () => {}, signal?: AbortSignal): Promise<boolean> {
  const db = getDb(), binding = captureHostDatabaseBinding(db);
  const check = (phase?: 'before' | 'after') => { binding(); authorise(); if (phase === undefined && db.inTransaction) throw Error("Keychain mutation requires its own transaction"); };
  return admitSqliteWrite(db, () => db.prepare("DELETE FROM keychain_entries WHERE name = ?").run(name).changes > 0, check, signal, undefined, check);
}

function parseKeychainReference(value: string): { name: string; field: "secret" | "username" } {
  const raw = value.slice(KEYCHAIN_PREFIX.length);
  if (!raw || raw.startsWith(":")) {
    throw new Error(`Invalid keychain reference: ${value}`);
  }

  const lastColon = raw.lastIndexOf(":");
  if (lastColon < 0) {
    return { name: raw, field: "secret" };
  }

  const name = raw.slice(0, lastColon);
  const field = raw.slice(lastColon + 1);
  if (!name) {
    throw new Error(`Invalid keychain reference: ${value}`);
  }

  if (USERNAME_REF_FIELDS.has(field)) {
    return { name, field: "username" };
  }
  if (SECRET_REF_FIELDS.has(field)) {
    return { name, field: "secret" };
  }

  if (!name.includes(":")) {
    throw new Error(`Invalid keychain reference: ${value}`);
  }

  return { name: raw, field: "secret" };
}

function isKeychainReferenceChar(char: string): boolean {
  return /[A-Za-z0-9._\/:-]/.test(char);
}

function findKeychainPlaceholders(input: string): string[] {
  const matches: string[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const start = input.indexOf(KEYCHAIN_PREFIX, cursor);
    if (start < 0) break;

    let end = start + KEYCHAIN_PREFIX.length;
    const firstChar = input[end];
    if (!firstChar || !/[A-Za-z0-9._\/-]/.test(firstChar)) {
      cursor = end;
      continue;
    }

    while (end < input.length) {
      if (input.startsWith(`:${KEYCHAIN_PREFIX}`, end)) break;
      const char = input[end];
      if (!isKeychainReferenceChar(char)) break;
      end += 1;
    }

    matches.push(input.slice(start, end));
    cursor = end;
  }

  return matches;
}

export function isInjectableKeychainEnvName(name: string): boolean {
  return SHELL_ENV_NAME.test(name);
}

/**
 * Sanitize a keychain entry name into a valid POSIX shell environment variable name.
 * Replaces `/`, `-`, and `.` with `_` and uppercases the result.
 * Returns null if the sanitized name is empty or starts with a digit.
 */
export function toShellEnvName(keychainName: string): string | null {
  const sanitized = keychainName
    .replace(/[\/\-\.]+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .toUpperCase();
  if (!sanitized || /^\d/.test(sanitized)) return null;
  return sanitized;
}

/**
 * Build a list of injectable env entries: { envName, keychainName } pairs.
 * Entries whose names are already valid shell identifiers use the name as-is.
 * Entries with `/`, `-`, or `.` are sanitized via toShellEnvName.
 * Collisions (two keychain names mapping to the same env name) keep the first entry.
 */
export function listInjectableKeychainEntries(): Array<{ envName: string; keychainName: string }> {
  const entries = listKeychainEntries();
  const seen = new Set<string>();
  const result: Array<{ envName: string; keychainName: string }> = [];
  for (const entry of entries) {
    const envName = SHELL_ENV_NAME.test(entry.name)
      ? entry.name
      : toShellEnvName(entry.name);
    if (!envName || seen.has(envName)) continue;
    seen.add(envName);
    result.push({ envName, keychainName: entry.name });
  }
  return result;
}

function isImplicitKeychainUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("Keychain is disabled")
    || error.message.includes("Database not initialized")
    || error.message.includes("Cannot use a closed database")
    || error.message.includes("no such table: keychain_entries");
}

export function listInjectableKeychainEnvNames(): string[] {
  return listInjectableKeychainEntries().map((entry) => entry.envName);
}

function collectReferencedShellEnvNames(texts: string[]): Set<string> {
  const names = new Set<string>();
  const regexes = [
    /\$env:([A-Za-z_][A-Za-z0-9_]*)/g,
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    /\$([A-Za-z_][A-Za-z0-9_]*)/g,
    /%([A-Za-z_][A-Za-z0-9_]*)%/g,
  ];

  for (const text of texts) {
    for (const regex of regexes) {
      regex.lastIndex = 0;
      for (const match of text.matchAll(regex)) {
        const name = match[1];
        if (name) names.add(name);
      }
    }
  }
  return names;
}

export async function loadAutoInjectedKeychainEnv(referencedTexts?: string[]): Promise<Record<string, string>> {
  const referencedEnvNames = Array.isArray(referencedTexts) ? collectReferencedShellEnvNames(referencedTexts) : null;
  const injectable = listInjectableKeychainEntries().filter((entry) => referencedEnvNames === null || referencedEnvNames.has(entry.envName));
  const resolved: Record<string, string> = {};
  for (const { envName, keychainName } of injectable) {
    const entry = await getKeychainEntry(keychainName);
    resolved[envName] = entry.secret;
  }
  return resolved;
}

export async function buildInjectedShellEnv(options: {
  explicitEnv?: Record<string, string | undefined>;
  includeProcessEnv?: boolean;
  referencedTexts?: string[];
} = {}): Promise<Record<string, string>> {
  const merged: Record<string, string> = options.includeProcessEnv ? { ...process.env } as Record<string, string> : {};

  try {
    const autoInjected = await loadAutoInjectedKeychainEnv(options.referencedTexts);
    for (const [key, value] of Object.entries(autoInjected)) {
      if (merged[key] === undefined) merged[key] = value;
    }
  } catch (error) {
    if (!isImplicitKeychainUnavailableError(error)) throw error;
  }

  if (!options.explicitEnv) return merged;
  const resolvedExplicitEnv = await resolveKeychainEnv(options.explicitEnv);
  return { ...merged, ...resolvedExplicitEnv };
}

/** Replace "keychain:name" values in an env record with decrypted secrets. */
export async function resolveKeychainEnv(
  env: Record<string, string | undefined>
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (!value.startsWith(KEYCHAIN_PREFIX)) {
      resolved[key] = value;
      continue;
    }
    const ref = parseKeychainReference(value);
    const entry = await getKeychainEntry(ref.name);
    if (ref.field === "username") {
      if (!entry.username) {
        throw new Error(`Keychain entry ${ref.name} has no username.`);
      }
      resolved[key] = entry.username;
      continue;
    }
    resolved[key] = entry.secret;
  }
  return resolved;
}

/** Replace inline "keychain:name" placeholders in a string with decrypted secrets. */
export async function resolveKeychainPlaceholders(input: string): Promise<string> {
  if (!input || !input.includes(KEYCHAIN_PREFIX)) {
    return input;
  }

  const matches = findKeychainPlaceholders(input);
  if (!matches?.length) {
    return input;
  }

  const unique = Array.from(new Set(matches));
  const replacements = new Map<string, string>();

  for (const placeholder of unique) {
    const ref = parseKeychainReference(placeholder);
    const entry = await getKeychainEntry(ref.name);
    if (ref.field === "username") {
      if (!entry.username) {
        throw new Error(`Keychain entry ${ref.name} has no username.`);
      }
      replacements.set(placeholder, entry.username);
    } else {
      replacements.set(placeholder, entry.secret);
    }
  }

  let output = input;
  for (const placeholder of Array.from(replacements.keys()).sort((a, b) => b.length - a.length)) {
    output = output.replaceAll(placeholder, replacements.get(placeholder) ?? placeholder);
  }
  return output;
}
