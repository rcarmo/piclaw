import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ApiKeyAuth, ApiKeyCredential, AuthContext, AuthEvent, AuthPrompt, Provider } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

type RequiredApiKeyAuth = ApiKeyAuth & { login: NonNullable<ApiKeyAuth["login"]> };
const providers = builtinProviders();
let networkRequests = 0;
const originalFetch = globalThis.fetch;
beforeAll(() => {
  const deny = () => { networkRequests++; throw new Error("External-auth fixture network forbidden"); };
  globalThis.fetch = Object.assign(deny, { preconnect: deny }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = originalFetch; expect(networkRequests).toBe(0); });
const signal = new AbortController().signal;
const manifestPath = resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-ai"))), "../package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name: string; version: string };

function expectAuthApisRequired(id: string): { provider: Provider; auth: RequiredApiKeyAuth } {
  const provider = providers.find(candidate => candidate.id === id);
  const auth = provider?.auth.apiKey;
  if (!provider || !auth || typeof auth.resolve !== "function" || typeof auth.login !== "function") {
    throw new Error(`Required public API-key auth methods missing for ${id}`);
  }
  return { provider, auth: auth as RequiredApiKeyAuth };
}

function syntheticContext(
  envEntries: readonly (readonly [string, string | undefined])[] = [],
  fileEntries: readonly (readonly [string, boolean])[] = [],
) {
  const envValues = new Map(envEntries);
  const fileValues = new Map(fileEntries);
  const envCalls: string[] = [];
  const fileCalls: string[] = [];
  const ctx: AuthContext = {
    env: async name => {
      envCalls.push(name);
      if (!envValues.has(name)) throw new Error(`Unexpected env lookup: ${name}`);
      return envValues.get(name);
    },
    fileExists: async path => {
      fileCalls.push(path);
      if (!fileValues.has(path)) throw new Error(`Unexpected file lookup: ${path}`);
      return fileValues.get(path) ?? false;
    },
  };
  return { ctx, envCalls, fileCalls };
}

async function publicLogin(auth: RequiredApiKeyAuth, method: string, methods: string[], answers: string[]) {
  const prompts: AuthPrompt[] = [];
  const events: AuthEvent[] = [];
  let answerIndex = 0;
  const credential = await auth.login({
    signal,
    prompt: async prompt => {
      prompts.push(prompt);
      if (prompt.type === "select") {
        expect(prompt.options.map(option => option.id)).toEqual(methods);
        const selected = prompt.options.find(option => option.id === method);
        if (!selected) throw new Error(`Public auth method ${method} was not offered`);
        return selected.id;
      }
      const answer = answers[answerIndex++];
      if (answer === undefined) throw new Error(`Unexpected ${prompt.type} prompt: ${prompt.message}`);
      return answer;
    },
    notify: event => events.push(event),
  });
  expect(answerIndex).toBe(answers.length);
  return { credential, prompts, events };
}

test("public amazon-bedrock auth resolves stored bearer before ambient bearer", async () => {
  const { auth } = expectAuthApisRequired("amazon-bedrock");
  const stored = syntheticContext();
  expect(await auth.resolve({ ctx: stored.ctx, credential: { type: "api_key", key: "synthetic-known-stored-bedrock" }, signal }))
    .toEqual({ auth: { apiKey: "synthetic-known-stored-bedrock" }, env: undefined, source: "stored credential" });
  expect(stored.envCalls).toEqual([]);
  const ambient = syntheticContext([["AWS_BEARER_TOKEN_BEDROCK", "synthetic-known-ambient-bedrock"]]);
  expect(await auth.resolve({ ctx: ambient.ctx, signal })).toEqual({ auth: {}, source: "AWS_BEARER_TOKEN_BEDROCK" });
  expect(ambient.envCalls).toEqual(["AWS_BEARER_TOKEN_BEDROCK"]);
});

test("public amazon-bedrock auth detects AWS profile and static access-key configuration", async () => {
  const { auth } = expectAuthApisRequired("amazon-bedrock");
  const profile = syntheticContext([["AWS_BEARER_TOKEN_BEDROCK", undefined], ["AWS_PROFILE", "synthetic-profile"]]);
  expect(await auth.resolve({ ctx: profile.ctx, signal })).toEqual({ auth: {}, source: "AWS_PROFILE" });
  const chain = syntheticContext([["AWS_BEARER_TOKEN_BEDROCK", undefined], ["AWS_PROFILE", undefined], ["AWS_ACCESS_KEY_ID", "synthetic-access-id"], ["AWS_SECRET_ACCESS_KEY", "synthetic-known-secret"]]);
  expect(await auth.resolve({ ctx: chain.ctx, signal })).toEqual({ auth: {}, source: "AWS access keys" });
  const missing = syntheticContext([
    ["AWS_BEARER_TOKEN_BEDROCK", undefined], ["AWS_PROFILE", undefined], ["AWS_ACCESS_KEY_ID", undefined],
    ["AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", undefined], ["AWS_CONTAINER_CREDENTIALS_FULL_URI", undefined], ["AWS_WEB_IDENTITY_TOKEN_FILE", undefined],
  ]);
  expect(await auth.resolve({ ctx: missing.ctx, signal })).toBeUndefined();
  expect(missing.fileCalls).toEqual([]);
});

test("public amazon-bedrock login owns select and text prompts for an AWS profile", async () => {
  const { auth } = expectAuthApisRequired("amazon-bedrock");
  const result = await publicLogin(auth, "aws-profile", ["bearer-token", "aws-profile", "credential-chain"], ["synthetic-profile"]);
  expect(result.credential).toEqual({ type: "api_key", env: { AWS_PROFILE: "synthetic-profile" } });
  expect(result.prompts.map(prompt => [prompt.type, prompt.message])).toEqual([
    ["select", "Select Amazon Bedrock authentication method:"], ["text", "Enter AWS profile name"],
  ]);
  expect(result.events).toHaveLength(1);
});

test("public google-vertex auth gives a stored API key precedence over its env key", async () => {
  const { auth } = expectAuthApisRequired("google-vertex");
  const stored = syntheticContext();
  expect(await auth.resolve({ ctx: stored.ctx, credential: { type: "api_key", key: "synthetic-known-vertex-stored" }, signal }))
    .toEqual({ auth: { apiKey: "synthetic-known-vertex-stored" }, source: "stored credential" });
  expect(stored.envCalls).toEqual([]);
  const ambient = syntheticContext([["GOOGLE_CLOUD_API_KEY", "synthetic-known-vertex-env"]]);
  expect(await auth.resolve({ ctx: ambient.ctx, signal })).toEqual({ auth: { apiKey: "synthetic-known-vertex-env" }, source: "GOOGLE_CLOUD_API_KEY" });
});

test("public google-vertex ADC requires a synthetic file, project, and location and honors stored env", async () => {
  const { auth } = expectAuthApisRequired("google-vertex");
  const adc = "~/.config/gcloud/application_default_credentials.json";
  for (const [file, project, location] of [[false, "synthetic-project", "synthetic-location"], [true, undefined, "synthetic-location"], [true, "synthetic-project", undefined]] as const) {
    const probe = syntheticContext([
      ["GOOGLE_CLOUD_API_KEY", undefined], ["GOOGLE_APPLICATION_CREDENTIALS", undefined], ["GOOGLE_CLOUD_PROJECT", project],
      ["GCLOUD_PROJECT", undefined], ["GOOGLE_CLOUD_LOCATION", location],
    ], [[adc, file]]);
    expect(await auth.resolve({ ctx: probe.ctx, signal })).toBeUndefined();
    expect(probe.fileCalls).toEqual([adc]);
  }
  const credential: ApiKeyCredential = { type: "api_key", env: { GOOGLE_APPLICATION_CREDENTIALS: "/synthetic/stored-adc.json", GOOGLE_CLOUD_PROJECT: "stored-project", GOOGLE_CLOUD_LOCATION: "stored-location" } };
  const stored = syntheticContext([["GOOGLE_CLOUD_API_KEY", undefined]], [["/synthetic/stored-adc.json", true]]);
  expect(await auth.resolve({ ctx: stored.ctx, credential, signal })).toEqual({ auth: {}, env: credential.env, source: "stored credential" });
  expect(stored.envCalls).toEqual(["GOOGLE_CLOUD_API_KEY"]);
  expect(stored.fileCalls).toEqual(["/synthetic/stored-adc.json"]);
});

test("public google-vertex login produces service-account env without an API key and resolves it", async () => {
  const { auth } = expectAuthApisRequired("google-vertex");
  const result = await publicLogin(auth, "service-account", ["api-key", "adc", "service-account"], ["synthetic-project", "synthetic-location", "/synthetic/service-account.json"]);
  expect(result.credential).toEqual({ type: "api_key", env: { GOOGLE_CLOUD_PROJECT: "synthetic-project", GOOGLE_CLOUD_LOCATION: "synthetic-location", GOOGLE_APPLICATION_CREDENTIALS: "/synthetic/service-account.json" } });
  expect(result.credential.key).toBeUndefined();
  expect(result.prompts.map(prompt => prompt.type)).toEqual(["select", "text", "text", "text"]);
  const ctx = syntheticContext([["GOOGLE_CLOUD_API_KEY", undefined]], [["/synthetic/service-account.json", true]]);
  expect(await auth.resolve({ ctx: ctx.ctx, credential: result.credential, signal })).toEqual({ auth: {}, env: result.credential.env, source: "stored credential" });
});

test("public azure auth resolves stored, env, and missing API-key states", async () => {
  const { auth } = expectAuthApisRequired("azure");
  const stored = syntheticContext();
  expect(await auth.resolve({ ctx: stored.ctx, credential: { type: "api_key", key: "synthetic-known-azure-stored" }, signal }))
    .toEqual({ auth: { apiKey: "synthetic-known-azure-stored" }, env: undefined, source: "stored credential" });
  const ambient = syntheticContext([["AZURE_OPENAI_API_KEY", "synthetic-known-azure-env"]]);
  expect(await auth.resolve({ ctx: ambient.ctx, signal })).toEqual({ auth: { apiKey: "synthetic-known-azure-env" }, source: "AZURE_OPENAI_API_KEY" });
  const missing = syntheticContext([["AZURE_OPENAI_API_KEY", undefined]]);
  expect(await auth.resolve({ ctx: missing.ctx, signal })).toBeUndefined();
});

test("public azure keeps endpoint setup separate from exact auth method metadata", () => {
  const { provider, auth } = expectAuthApisRequired("azure");
  expect({ package: `${manifest.name}@${manifest.version}`, id: provider.id, name: provider.name, baseUrl: provider.baseUrl,
    authName: auth.name, authKeys: Object.keys(auth).sort(), oauth: provider.auth.oauth }).toEqual({
    package: "@earendil-works/pi-ai@1.5.2", id: "azure", name: "Azure", baseUrl: undefined,
    authName: "Azure OpenAI API key", authKeys: ["login", "name", "resolve"], oauth: undefined,
  });
});

// Measured installed 1.5.2 fingerprints (unchanged bytes); historical receipts remain immutable.
test("external auth methods are bound to the exact published 1.5.2 payload", () => {
  expect(manifest.version).toBe("1.5.2");
  const fingerprints = {
    "providers/amazon-bedrock.js": "2529299b0e820465cb3bcbec1ef4d4f2e3513385084e25b80c0e4c016779fa2e",
    "providers/google-vertex.js": "26c13449ea7b57d40878742db956210e70af0c89638cb87a1d9b4739f2bac59a",
    "providers/azure.js": "365152aaae1ffde873497da5e3af4b93faebf2628ffb7a798c989be06bda7e71",
    "auth/helpers.js": "afa67f03895ace888d574c0c86c226cab35521cecc51fe4c0320ba710fb32a97"
  };
  for (const [path, hash] of Object.entries(fingerprints)) {
    const bytes = readFileSync(fileURLToPath(new URL(path, import.meta.resolve("@earendil-works/pi-ai"))));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
  }
});
