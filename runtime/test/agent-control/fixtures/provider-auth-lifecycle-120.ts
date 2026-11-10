import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Credential, OAuthCredential, Provider } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { FileCredentialStore } from "../../../src/agent-pool/credential-store.js";

const PROVIDER_ID = "synthetic-auth-lifecycle-0991";
const LONG_VALIDITY_MS = 60 * 60 * 1000;
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.resolve("@earendil-works/pi-ai"))), "utf8"));
if (manifest.version !== "1.5.1") throw new Error("Exact published pi-ai 1.5.1 required");
const runtimeManifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent"))), "utf8"));
if (runtimeManifest.version !== "1.5.1") throw new Error("Exact published coding-agent 1.5.1 required");
let networkAttempts = 0;

const denyNetwork = () => {
  networkAttempts += 1;
  throw new Error("Network access is forbidden in the provider auth lifecycle fixture");
};
globalThis.fetch = Object.assign(async () => denyNetwork(), { preconnect: denyNetwork });

function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function oauth(label: string, expires = Date.now() + LONG_VALIDITY_MS): OAuthCredential {
  return {
    type: "oauth",
    access: `synthetic-access-${label}`,
    refresh: `synthetic-refresh-${label}`,
    expires,
  };
}

interface SyntheticProviderOptions {
  login?: (signal: AbortSignal) => Promise<OAuthCredential>;
  refresh?: (credential: OAuthCredential, signal: AbortSignal) => Promise<OAuthCredential>;
  ambientApiKeyFallback?: boolean;
}

function syntheticProvider(options: SyntheticProviderOptions = {}) {
  const counters = { refresh: 0, ambientApiKeyResolve: 0 };
  const provider: Provider = {
    id: PROVIDER_ID,
    name: "Synthetic Auth Lifecycle",
    auth: {
      oauth: {
        name: "Synthetic OAuth",
        login: async (interaction) => options.login
          ? options.login(interaction.signal)
          : oauth("login"),
        refresh: async (credential, signal) => {
          counters.refresh += 1;
          return options.refresh
            ? options.refresh(credential, signal)
            : oauth(`rotated-${counters.refresh}`);
        },
        toAuth: async (credential) => ({ apiKey: credential.access }),
      },
      ...(options.ambientApiKeyFallback
        ? {
            apiKey: {
              name: "Synthetic ambient API key",
              resolve: async () => {
                counters.ambientApiKeyResolve += 1;
                return { auth: { apiKey: "synthetic-ambient-fallback" }, source: "synthetic ambient" };
              },
            },
          }
        : {}),
    },
    getModels: () => [],
    stream: () => {
      throw new Error("Synthetic provider stream must not be invoked");
    },
    streamSimple: () => {
      throw new Error("Synthetic provider streamSimple must not be invoked");
    },
  };
  return { provider, counters };
}

async function createRuntime(root: string, provider: Provider) {
  const authPath = join(root, "agent", "auth.json");
  const credentials = new FileCredentialStore(authPath);
  const runtime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    modelsStorePath: join(root, "agent", "models-store.json"),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  runtime.registerNativeProvider(provider);
  // Registering starts an offline snapshot refresh. Explicitly await another
  // public refresh before testing auth; provider callbacks never use network.
  const refreshed = await runtime.refresh({ allowNetwork: false });
  ensure(!refreshed.aborted && refreshed.errors.size === 0, "Offline runtime refresh failed");
  return { runtime, credentials };
}

async function put(store: FileCredentialStore, providerId: string, credential: Credential): Promise<void> {
  await store.modify(providerId, async () => credential);
}

async function readOAuth(store: FileCredentialStore, message: string): Promise<OAuthCredential> {
  const credential = await store.read(PROVIDER_ID);
  ensure(credential?.type === "oauth", message);
  return credential;
}

function interaction(signal?: AbortSignal) {
  return {
    ...(signal ? { signal } : {}),
    prompt: async () => "unused",
    notify: () => {},
  };
}

async function rejects(promise: Promise<unknown>, message: string, expected: (error: unknown) => boolean): Promise<void> {
  let rejected = false;
  try {
    await promise;
  } catch (error) {
    ensure(expected(error), "Operation rejected for an unexpected reason");
    rejected = true;
  }
  ensure(rejected, message);
}

async function loginPersistRecreateLogout(root: string): Promise<void> {
  const { provider } = syntheticProvider();
  const first = await createRuntime(root, provider);
  await put(first.credentials, "unrelated-provider", { type: "api_key", key: "synthetic-unrelated" });

  await first.runtime.login(PROVIDER_ID, "oauth", interaction());
  const persisted = await readOAuth(first.credentials, "Login credential was not persisted");
  ensure(persisted.access === "synthetic-access-login", "Persisted login credential is not authoritative");
  ensure(statSync(first.credentials.authPath).mode % 0o1000 === 0o600, "Auth file permissions are not private");
  ensure(statSync(join(root, "agent")).mode % 0o1000 === 0o700, "Auth directory permissions are not private");
  const metadata = [...await first.runtime.listCredentials()].sort((a, b) => a.providerId.localeCompare(b.providerId));
  ensure(JSON.stringify(metadata) === JSON.stringify([
    { providerId: PROVIDER_ID, type: "oauth" },
    { providerId: "unrelated-provider", type: "api_key" },
  ]), "Credential list did not retain metadata-only boundary");

  const recreated = await createRuntime(root, provider);
  const auth = await recreated.runtime.getAuth(PROVIDER_ID);
  ensure(auth?.auth.apiKey === "synthetic-access-login", "Recreated runtime did not resolve persisted OAuth");

  await recreated.runtime.logout(PROVIDER_ID);
  ensure(await recreated.credentials.read(PROVIDER_ID) === undefined, "Logout did not remove provider credential");
  const unrelated = await recreated.credentials.read("unrelated-provider");
  ensure(unrelated?.type === "api_key" && unrelated.key === "synthetic-unrelated", "Logout changed unrelated credential");
  ensure(await first.runtime.getAuth(PROVIDER_ID) === undefined, "Existing runtime resolved a logged-out credential");
  await recreated.runtime.login(PROVIDER_ID, "oauth", interaction());
  ensure((await first.runtime.getAuth(PROVIDER_ID))?.auth.apiKey === "synthetic-access-login", "Relogin was not visible to existing runtime");
}

async function expiredGetAuthRotates(root: string): Promise<void> {
  const { provider, counters } = syntheticProvider();
  const seed = new FileCredentialStore(join(root, "agent", "auth.json"));
  await put(seed, PROVIDER_ID, oauth("expired", Date.now() - 1));
  const fixture = await createRuntime(root, provider);

  const auth = await fixture.runtime.getAuth(PROVIDER_ID);
  ensure(auth?.auth.apiKey === "synthetic-access-rotated-1", "getAuth did not return rotated OAuth access");
  ensure(counters.refresh === 1, "Expired OAuth was not refreshed exactly once");
  const stored = await readOAuth(fixture.credentials, "Rotated OAuth credential was not stored");
  ensure(stored.access === "synthetic-access-rotated-1", "Stored OAuth access was not rotated");
  ensure(stored.refresh === "synthetic-refresh-rotated-1", "Stored OAuth refresh token was not rotated");
  ensure(stored.expires > Date.now(), "Stored OAuth expiry was not rotated");
  const reopened = await createRuntime(root, provider);
  ensure((await reopened.runtime.getAuth(PROVIDER_ID))?.auth.apiKey === stored.access, "Reopened runtime lost rotated credential");
  ensure(counters.refresh === 1, "Reopened runtime reused a superseded refresh token");
}

async function concurrentCrossRuntimeRefreshOnce(root: string): Promise<void> {
  const { provider, counters } = syntheticProvider({
    refresh: async () => {
      await Bun.sleep(20);
      return oauth("concurrent-rotated");
    },
  });
  const seed = new FileCredentialStore(join(root, "agent", "auth.json"));
  await put(seed, PROVIDER_ID, oauth("concurrent-expired", Date.now() - 1));
  const first = await createRuntime(root, provider);
  const second = await createRuntime(root, provider);

  const [firstAuth, secondAuth] = await Promise.all([
    first.runtime.getAuth(PROVIDER_ID),
    second.runtime.getAuth(PROVIDER_ID),
  ]);
  ensure(counters.refresh === 1, "Concurrent runtimes refreshed OAuth more than once");
  ensure(firstAuth?.auth.apiKey === "synthetic-access-concurrent-rotated", "First runtime missed authoritative OAuth");
  ensure(secondAuth?.auth.apiKey === "synthetic-access-concurrent-rotated", "Second runtime missed authoritative OAuth");
  const stored = await readOAuth(second.credentials, "Concurrent OAuth result was not stored");
  ensure(stored.refresh === "synthetic-refresh-concurrent-rotated", "Concurrent refresh token was not rotated");
}

async function invalidGrantPreservesCredential(root: string): Promise<void> {
  let failRefresh = true;
  const { provider, counters } = syntheticProvider({
    ambientApiKeyFallback: true,
    refresh: async () => {
      if (failRefresh) throw new Error("invalid_grant");
      return oauth("recovered");
    },
  });
  const seed = new FileCredentialStore(join(root, "agent", "auth.json"));
  const original = { ...oauth("invalid-grant", Date.now() - 1), accountId: "synthetic-working-account" };
  await put(seed, PROVIDER_ID, original);
  await put(seed, "unrelated-provider", { type: "api_key", key: "synthetic-unrelated" });
  const fixture = await createRuntime(root, provider);

  await rejects(fixture.runtime.getAuth(PROVIDER_ID), "invalid_grant refresh unexpectedly resolved", error =>
    error instanceof Error && "code" in error && error.code === "oauth" && error.cause instanceof Error && error.cause.message === "invalid_grant");
  ensure(counters.refresh === 1, "invalid_grant refresh was retried");
  ensure(counters.ambientApiKeyResolve === 0, "Failed OAuth fell back to API-key auth");
  const preserved = await readOAuth(fixture.credentials, "invalid_grant removed the stored OAuth credential");
  ensure(JSON.stringify(preserved) === JSON.stringify(original), "invalid_grant changed stored OAuth credential");
  const unrelated = await fixture.credentials.read("unrelated-provider");
  ensure(unrelated?.type === "api_key" && unrelated.key === "synthetic-unrelated", "invalid_grant changed unrelated credential");

  failRefresh = false;
  const recovered = await fixture.runtime.getAuth(PROVIDER_ID);
  ensure(recovered?.auth.apiKey === "synthetic-access-recovered", "Preserved OAuth data could not be retried");
  ensure(Number(counters.refresh) === 2, "OAuth recovery did not use one new refresh attempt");
  ensure(counters.ambientApiKeyResolve === 0, "OAuth recovery consulted API-key fallback");
}

async function cancelRejectLoginPreservesCredential(root: string): Promise<void> {
  let loginMode: "cancel" | "reject" = "cancel";
  let markCancelStarted: (() => void) | undefined;
  const cancelStarted = new Promise<void>((resolve) => { markCancelStarted = resolve; });
  const { provider } = syntheticProvider({
    login: async (signal) => {
      if (loginMode === "reject") throw new Error("Synthetic provider rejected login");
      markCancelStarted?.();
      return new Promise<OAuthCredential>((_resolve, reject) => {
        const onAbort = () => reject(signal.reason ?? new Error("Synthetic login cancelled"));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
    },
  });
  const seed = new FileCredentialStore(join(root, "agent", "auth.json"));
  const original = { ...oauth("working"), accountId: "synthetic-working-account" };
  await put(seed, PROVIDER_ID, original);
  const fixture = await createRuntime(root, provider);

  const controller = new AbortController();
  const cancelled = fixture.runtime.login(PROVIDER_ID, "oauth", interaction(controller.signal));
  await cancelStarted;
  const cancellation = new DOMException("Synthetic cancellation", "AbortError");
  controller.abort(cancellation);
  await rejects(cancelled, "Cancelled provider login unexpectedly resolved", error => error === cancellation);
  let stored = await readOAuth(fixture.credentials, "Cancelled login removed working OAuth");
  ensure(JSON.stringify(stored) === JSON.stringify(original), "Cancelled login changed working OAuth");

  loginMode = "reject";
  await rejects(fixture.runtime.login(PROVIDER_ID, "oauth", interaction()), "Rejected provider login unexpectedly resolved", error =>
    error instanceof Error && error.message === "Synthetic provider rejected login");
  stored = await readOAuth(fixture.credentials, "Rejected login removed working OAuth");
  ensure(JSON.stringify(stored) === JSON.stringify(original), "Rejected login changed working OAuth");
  const auth = await fixture.runtime.getAuth(PROVIDER_ID);
  ensure(auth?.auth.apiKey === "synthetic-access-working", "Working OAuth no longer resolves after failed logins");
}

async function apiKeyStoredAmbientLogout(root: string): Promise<void> {
  const { provider } = syntheticProvider();
  process.env.PICLAW_SYNTHETIC_AMBIENT_KEY = "synthetic-ambient-key";
  const apiProvider: Provider = {
    ...provider,
    auth: { apiKey: {
      name: "Synthetic API key",
      login: async (input) => {
        const key = await input.prompt({ type: "secret", message: "Synthetic key" });
        input.signal.throwIfAborted();
        if (!key.trim()) throw new Error("Empty synthetic key");
        return { type: "api_key", key };
      },
      resolve: async ({ ctx, credential }) => {
        const key = credential?.key ?? await ctx.env("PICLAW_SYNTHETIC_AMBIENT_KEY");
        return key ? { auth: { apiKey: key }, source: credential?.key ? "stored synthetic key" : "PICLAW_SYNTHETIC_AMBIENT_KEY" } : undefined;
      },
    } },
  };
  const fixture = await createRuntime(root, apiProvider);
  ensure((await fixture.runtime.getAuth(PROVIDER_ID))?.source === "PICLAW_SYNTHETIC_AMBIENT_KEY", "Ambient auth source missing");
  await fixture.runtime.login(PROVIDER_ID, "api_key", { prompt: async () => "synthetic-stored-key", notify: () => {} });
  ensure((await fixture.runtime.getAuth(PROVIDER_ID))?.auth.apiKey === "synthetic-stored-key", "Stored key did not take precedence");
  await rejects(fixture.runtime.login(PROVIDER_ID, "api_key", { prompt: async () => "", notify: () => {} }), "Empty key login succeeded", error =>
    error instanceof Error && error.message === "Empty synthetic key");
  ensure((await fixture.runtime.getAuth(PROVIDER_ID))?.auth.apiKey === "synthetic-stored-key", "Failed key login replaced stored key");
  await fixture.runtime.logout(PROVIDER_ID);
  ensure(await fixture.credentials.read(PROVIDER_ID) === undefined, "Stored key survived logout");
  const remaining = await fixture.runtime.getAuth(PROVIDER_ID);
  ensure(remaining?.source === "PICLAW_SYNTHETIC_AMBIENT_KEY" && remaining.auth.apiKey === "synthetic-ambient-key", "Logout misrepresented remaining ambient auth");
  ensure(process.env.PICLAW_SYNTHETIC_AMBIENT_KEY === "synthetic-ambient-key", "Logout revoked external environment auth");
}

const scenario = process.argv[2];
const root = process.argv[3];
ensure(scenario, "Scenario name is required");
ensure(root, "Fixture root is required");

switch (scenario) {
  case "login-persist-recreate-logout":
    await loginPersistRecreateLogout(root);
    break;
  case "expired-get-auth-rotates":
    await expiredGetAuthRotates(root);
    break;
  case "concurrent-cross-runtime-refresh-once":
    await concurrentCrossRuntimeRefreshOnce(root);
    break;
  case "invalid-grant-preserves-credential":
    await invalidGrantPreservesCredential(root);
    break;
  case "cancel-reject-login-preserves-credential":
    await cancelRejectLoginPreservesCredential(root);
    break;
  case "api-key-stored-ambient-logout":
    await apiKeyStoredAmbientLogout(root);
    break;
  default:
    throw new Error("Unknown provider auth lifecycle scenario");
}

ensure(networkAttempts === 0, "Fixture attempted a network call");
process.stdout.write(`${scenario}\n`);
