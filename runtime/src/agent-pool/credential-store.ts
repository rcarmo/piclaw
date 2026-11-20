import { execSync } from "node:child_process";
import { closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CredentialFileCommitError, type CredentialFileIO, writeCredentialFileAtomic } from "./credential-file.js";

import { ModelsError, type AuthOperationOptions, type Credential, type CredentialInfo, type CredentialStore } from "@earendil-works/pi-ai";
import lockfile from "proper-lockfile";

import { getPiclawAgentDir } from "../core/agent-dir.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("agent-pool.credential-store");

const AUTH_FILE_MODE = 0o600;
const AUTH_DIRECTORY_MODE = 0o700;
// Pi 1.1 auth/resolve uses this inclusive default window but does not export
// DEFAULT_OAUTH_MINIMUM_VALIDITY_MS. Keep this compatibility mirror covered by
// tests through Models.getAuth(), rather than importing SDK-private internals.
const OAUTH_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_OAUTH_REFRESH_MAX_RETRIES = 2;
const DEFAULT_OAUTH_REFRESH_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_OAUTH_REFRESH_RETRY_MAX_DELAY_MS = 2_000;
const LOCK_OPTIONS = {
  retries: { retries: 10, factor: 2, minTimeout: 100, maxTimeout: 10_000, randomize: true },
  stale: 30_000,
} as const;

type CredentialData = Record<string, Credential>;

type OAuthRefreshRetryOptions = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  random: () => number;
  sleep: (delayMs: number) => Promise<void>;
};

export interface PiclawCredentialStore extends CredentialStore {
  readonly authPath: string;
  drainErrors(): Error[];
}

const commandValueCache = new Map<string, string | undefined>();

function resolveConfigValue(config: string, env?: Record<string, string>): string | undefined {
  if (config.startsWith("!")) {
    if (commandValueCache.has(config)) return commandValueCache.get(config);
    let value: string | undefined;
    try {
      value = execSync(config.slice(1), { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
    } catch {
      value = undefined;
    }
    commandValueCache.set(config, value);
    return value;
  }

  let resolved = "";
  for (let index = 0; index < config.length;) {
    if (config[index] !== "$") {
      resolved += config[index++];
      continue;
    }
    const next = config[index + 1];
    if (next === "$" || next === "!") {
      resolved += next;
      index += 2;
      continue;
    }
    if (next === "{") {
      const end = config.indexOf("}", index + 2);
      if (end < 0) {
        resolved += "$";
        index += 1;
        continue;
      }
      const name = config.slice(index + 2, end);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) resolved += config.slice(index, end + 1);
      else {
        const value = env?.[name] || process.env[name] || undefined;
        if (value === undefined) return undefined;
        resolved += value;
      }
      index = end + 1;
      continue;
    }
    const match = config.slice(index + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!match) {
      resolved += "$";
      index += 1;
      continue;
    }
    const value = env?.[match[0]] || process.env[match[0]] || undefined;
    if (value === undefined) return undefined;
    resolved += value;
    index += match[0].length + 1;
  }
  return resolved;
}

function errorChainText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current !== undefined && current !== null && !seen.has(current) && parts.length < 8) {
    seen.add(current);
    if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message}`);
      current = current.cause;
      continue;
    }
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      for (const key of ["status", "statusCode", "code", "error", "error_description"]) {
        if (record[key] !== undefined) parts.push(String(record[key]));
      }
      current = record.cause;
      continue;
    }
    parts.push(String(current));
    break;
  }
  return parts.join(" | ");
}

/** Retry only failures that can plausibly succeed without replacing the refresh token. */
export function isTransientOAuthRefreshError(error: unknown): boolean {
  const detail = errorChainText(error);
  if (!detail) return false;
  if (/invalid[_ -]?grant|invalid[_ -]?client|unauthorized[_ -]?client|access[_ -]?denied|refresh token[^|]*(?:expired|revoked|invalid)|\b(?:400|401|403)\b/i.test(detail)) {
    return false;
  }
  return /\b(?:408|425|429|500|502|503|504)\b|fetch failed|network(?: error)?|socket hang up|econnreset|econnrefused|etimedout|enotfound|timed? out|timeout|temporar(?:y|ily)|rate limit|too many requests|overloaded|service unavailable|bad gateway|gateway timeout/i.test(detail);
}

function cloneCredential<T extends Credential | undefined>(credential: T): T {
  return credential === undefined ? credential : structuredClone(credential);
}

function resolveCredential(credential: Credential | undefined): Credential | undefined {
  if (credential?.type !== "api_key" || credential.key === undefined) return cloneCredential(credential);
  return { ...cloneCredential(credential), key: resolveConfigValue(credential.key, credential.env) };
}

function parseCredentialData(content: string | undefined): CredentialData {
  if (!content?.trim()) return {};
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("auth.json must contain a JSON object");
  return parsed as CredentialData;
}

/** App-owned, cross-process serialized CredentialStore for ModelRuntime. */
export class FileCredentialStore implements PiclawCredentialStore {
  private pendingRead: Promise<CredentialData> | undefined;
  private errors: Error[] = [];
  private readonly oauthRefreshRetry: OAuthRefreshRetryOptions;

  constructor(
    readonly authPath: string = join(getPiclawAgentDir(), "auth.json"),
    oauthRefreshRetry: Partial<OAuthRefreshRetryOptions> = {},
    private readonly credentialFileIO?: CredentialFileIO,
  ) {
    this.oauthRefreshRetry = {
      maxRetries: Math.max(0, Math.min(DEFAULT_OAUTH_REFRESH_MAX_RETRIES, oauthRefreshRetry.maxRetries ?? DEFAULT_OAUTH_REFRESH_MAX_RETRIES)),
      baseDelayMs: oauthRefreshRetry.baseDelayMs ?? DEFAULT_OAUTH_REFRESH_RETRY_BASE_DELAY_MS,
      maxDelayMs: oauthRefreshRetry.maxDelayMs ?? DEFAULT_OAUTH_REFRESH_RETRY_MAX_DELAY_MS,
      random: oauthRefreshRetry.random ?? Math.random,
      sleep: oauthRefreshRetry.sleep ?? (async (delayMs) => { await Bun.sleep(delayMs); }),
    };
  }

  private recordError(error: unknown): Error {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.errors.push(normalized);
    return normalized;
  }

  private ensureFile(): void {
    const parent = dirname(this.authPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: AUTH_DIRECTORY_MODE });
    const parentStat = lstatSync(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error("Credential directory must be a real directory.");
    if (process.platform !== "win32") {
      const dir = openSync(parent, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = fstatSync(dir);
        if (!stat.isDirectory() || stat.uid !== process.getuid?.()) throw new Error("Credential directory ownership mismatch.");
        fchmodSync(dir, AUTH_DIRECTORY_MODE);
      } finally { closeSync(dir); }
    }
    if (!existsSync(this.authPath)) {
      try { writeFileSync(this.authPath, "{}", { encoding: "utf8", mode: AUTH_FILE_MODE, flag: "wx" }); }
      catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error; }
    }
    const target = lstatSync(this.authPath);
    if (!target.isFile() || target.isSymbolicLink() || target.nlink !== 1) throw new Error("Credential target must be a private regular file.");
    const fd = openSync(this.authPath, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || (process.platform !== "win32" && stat.uid !== process.getuid?.())) throw new Error("Credential file ownership mismatch.");
      fchmodSync(fd, AUTH_FILE_MODE);
    } finally { closeSync(fd); }
  }

  private readFileData(): CredentialData {
    this.ensureFile();
    const fd = openSync(this.authPath, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
    try { return parseCredentialData(readFileSync(fd, "utf8")); }
    finally { closeSync(fd); }
  }

  private writeFileData(data: CredentialData): void {
    try { writeCredentialFileAtomic(this.authPath, `${JSON.stringify(data, null, 2)}\n`, this.credentialFileIO); }
    catch (error) {
      // After rename, the new credential is authoritative. Reporting a failed
      // mutation would let callers mistakenly restore a superseded token.
      if (!(error instanceof CredentialFileCommitError)) throw error;
      this.recordError(error);
      log.warn("Credential file committed without confirmed directory synchronization", { operation: "credential_store.directory_sync_failed" });
    }
  }

  private async withLock<T>(fn: (current: CredentialData, assertLock: () => void) => Promise<T>): Promise<T> {
    this.ensureFile();
    let compromised: Error | null = null;
    const assertLock = () => { if (compromised) throw compromised; };
    const release = await lockfile.lock(this.authPath, { ...LOCK_OPTIONS, onCompromised: (error) => { compromised = error; } });
    try {
      assertLock();
      const result = await fn(this.readFileData(), assertLock);
      assertLock();
      return result;
    } finally {
      try { await release(); }
      catch (error) { this.recordError(new Error("Failed to release credential storage lock", { cause: error })); }
    }
  }

  drainErrors(): Error[] {
    const drained = [...this.errors];
    this.errors = [];
    return drained;
  }

  private readSnapshot(): Promise<CredentialData> {
    if (this.pendingRead) return this.pendingRead;
    // SDK discovery asks about many providers at once. Calls waiting for the
    // same file can share its locked read, but not a snapshot already taken.
    const pending = this.withLock(async (data) => {
      this.pendingRead = undefined;
      return data;
    }).finally(() => {
      if (this.pendingRead === pending) this.pendingRead = undefined;
    });
    this.pendingRead = pending;
    return pending;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return resolveCredential((await this.readSnapshot())[providerId]);
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(await this.readSnapshot()).map(([providerId, credential]) => ({ providerId, type: credential.type }));
  }

  async modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    return this.withLock(async (current, assertLock) => {
      const storedCredential = current[providerId];
      let nextCredential: Credential | undefined;
      let retryAttempt = 0;
      while (true) {
        assertLock();
        options?.signal?.throwIfAborted();
        try {
          nextCredential = await fn(cloneCredential(storedCredential));
          break;
        } catch (error) {
          // Expired-token callbacks retain the existing retry behavior. For
          // proactive refresh, require Pi's public OAuth failure wrapper: modify
          // also runs unrelated login/config callbacks against future tokens.
          const isOAuthRefresh = storedCredential?.type === "oauth"
            && Date.now() + OAUTH_REFRESH_WINDOW_MS >= storedCredential.expires
            && (Date.now() >= storedCredential.expires || (error instanceof ModelsError && error.code === "oauth"));
          // Pi supplies a 15-second signal per provider attempt. Do not retry an
          // aborted/deadline-exceeded attempt, even though timeout is otherwise
          // transient. Pi detaches caller cancellation once refresh starts so a
          // successful rotated token must still be persisted below.
          const aborted = /\b(?:AbortError|TimeoutError)\b/.test(errorChainText(error));
          if (!isOAuthRefresh || aborted || retryAttempt >= this.oauthRefreshRetry.maxRetries || !isTransientOAuthRefreshError(error)) {
            throw error;
          }
          retryAttempt += 1;
          assertLock();
          const exponentialDelay = Math.min(
            this.oauthRefreshRetry.maxDelayMs,
            this.oauthRefreshRetry.baseDelayMs * (2 ** (retryAttempt - 1)),
          );
          const jitteredDelay = Math.max(0, Math.round(exponentialDelay * (0.75 + this.oauthRefreshRetry.random() * 0.5)));
          log.warn("Transient OAuth refresh failed; retrying under the credential lock", {
            operation: "credential_store.oauth_refresh_retry",
            providerId,
            retryAttempt,
            maxRetries: this.oauthRefreshRetry.maxRetries,
            delayMs: jitteredDelay,
          });
          await this.oauthRefreshRetry.sleep(jitteredDelay);
        }
      }
      assertLock();
      if (nextCredential === undefined) return cloneCredential(current[providerId]);
      // Provider JSON can violate the public Credential type (for example a
      // malformed successful Radius token response). Reject before any write;
      // this is not a transient refresh failure and must never replay fn.
      if (nextCredential.type === "oauth" && (typeof nextCredential.access !== "string"
        || typeof nextCredential.refresh !== "string" || !Number.isFinite(nextCredential.expires))) {
        throw new Error("Invalid OAuth credential.");
      }
      const next = { ...current, [providerId]: cloneCredential(nextCredential) };
      this.writeFileData(next);
      return cloneCredential(nextCredential);
    });
  }

  async delete(providerId: string): Promise<void> {
    await this.withLock(async (current, assertLock) => {
      const next = { ...current };
      delete next[providerId];
      assertLock();
      this.writeFileData(next);
    });
  }
}
