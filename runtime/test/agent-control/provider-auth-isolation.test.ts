import { afterEach, expect, test } from "bun:test";
import { handleLogin, handleLogout, withPrivateProviderAuthResponse } from "../../src/agent-control/handlers/login.js";
import { withChatContext } from "../../src/core/chat-context.js";
import { addLogSink, removeLogSink, type LogRecord } from "../../src/utils/logger.js";
import { createTestModelRegistry, TestAgentControlSession } from "./session-fixture.js";
import { getTestWorkspace } from "../helpers.js";
import { withTempWorkspaceEnv } from "../helpers.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createNativeAuthFixture } from './native-auth-fixture.js';

const sessions: ReturnType<typeof createNativeAuthFixture>[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); });

function fixture(login?: (provider: string, type: string, interaction: any) => Promise<unknown>) {
  const registry = createTestModelRegistry([{ provider: "openai", id: "one", name: "One" }]);
  if (login) registry.modelRuntime.login = login;
  const session = new TestAgentControlSession(getTestWorkspace().workspace, registry);
  const native = createNativeAuthFixture(session, registry, 'web:auth-owner');
  sessions.push(native);
  const run = (step: string, data: object, chat = "web:auth-owner") => withChatContext(chat, "web", () => handleLogin(native.context, registry, {
    type: "login", provider: `__${step} ${JSON.stringify(data)}`, raw: `/login __${step}`,
  }));
  return { session, registry, run, context: native.context, dispose: native.dispose };
}

function action(result: any, method = "runtime_continue") {
  const data = result.contentBlocks?.[0]?.payload?.actions?.find((item: any) => item.data?.method === method)?.data;
  if (!data) throw new Error(`Missing action ${method}`);
  return data;
}

test("provider events and prompt metadata stay out of persisted cards and reveal is owner-bound and one-use", async () => {
  const sentinel = "PRIVATE-event-sentinel";
  const f = fixture(async (_provider, _type, input) => {
    input.notify({ type: "auth_url", url: `https://auth.example.test/?state=${sentinel}`, instructions: sentinel });
    input.notify({ type: "device_code", userCode: sentinel, verificationUri: `https://verify.example.test/?code=${sentinel}`, expiresInSeconds: 120 });
    input.notify({ type: "info", message: sentinel, links: [{ url: `https://info.example.test/?token=${sentinel}`, label: sentinel }] });
    for (let i = 0; i < 12; i++) input.notify({ type: "progress", message: `${sentinel}-${i}` });
    await input.prompt({ type: "secret", message: sentinel, placeholder: sentinel });
  });
  const start = await f.run("step1", { provider: "openai" });
  expect(JSON.stringify(start)).not.toContain(sentinel);
  const reveal = action(start, "runtime_present");
  await expect(f.run("step2", reveal, "web:foreign")).rejects.toThrow("Authentication session ended");
  expect((await f.run("step2", reveal)).status).toBe("error"); // Other control surfaces cannot receive secrets.
  const shown = await withPrivateProviderAuthResponse(() => f.run("step2", reveal));
  expect(shown.authPresentation?.events.map((event: any) => event.type)).toEqual(["auth_url", "device_code", "info", "progress"]);
  expect(shown.authPresentation?.events.at(-1).message).toBe(`${sentinel}-11`);
  expect(shown.authPresentation?.prompt).toMatchObject({ type: "secret", message: sentinel });
  expect(shown.authPresentation?.prompt.signal).toBeUndefined();
  expect(JSON.stringify({ message: shown.message, cards: shown.contentBlocks })).not.toContain(sentinel);
  expect((await f.run("step2", reveal)).status).toBe("error");
  const cancelled = await f.run("step2", { ...shown.authPresentation.action_data, method: "runtime_cancel" });
  expect(cancelled.status).toBe("success");
  expect((await f.run("step2", { ...shown.authPresentation.action_data, method: "runtime_present" })).status).toBe("error");
});

test("provider code deadline fences private reveal before its expiry timer fires", async () => {
  const f = fixture(async (_provider, _type, input) => {
    input.notify({ type: "device_code", userCode: "short-code", verificationUri: "https://verify.example.test", expiresInSeconds: 1 });
    await input.prompt({ type: "manual_code", message: "Enter code" });
  });
  const start = await f.run("step1", { provider: "openai" });
  const previous = Date.now;
  Date.now = () => previous() + 1_001;
  try { expect((await f.run("step2", action(start, "runtime_present"))).message).toContain("expired"); }
  finally { Date.now = previous; }
  expect(f.registry.authStorage.get("openai")).toBeUndefined();
});

test("disposed or replaced owners cannot reveal provider events", async () => {
  const f = fixture();
  const start = await f.run("step1", { provider: "openai" });
  f.session.sessionId = "replacement";
  expect((await f.run("step2", action(start, "runtime_present"))).status).toBe("error");
  const next = await f.run("step1", { provider: "openai" });
  f.dispose();
  await expect(f.run("step2", action(next, "runtime_present"))).rejects.toThrow("Authentication session ended");
});

test("failed private reveal delivery restores the prior action while failed continuation delivery aborts", async () => {
  const f = fixture(async (_provider, _type, input) => {
    await input.prompt({ type: "secret", message: "First secret" });
    await input.prompt({ type: "text", message: "Next field" });
  });
  const start = await f.run("step1", { provider: "openai" });
  const reveal = action(start, "runtime_present");
  await expect(withPrivateProviderAuthResponse(async () => {
    await f.run("step2", reveal);
    throw new Error("Synthetic delivery failure");
  })).rejects.toThrow("Synthetic delivery failure");
  const shown = await withPrivateProviderAuthResponse(() => f.run("step2", reveal));
  expect(shown.authPresentation?.prompt.type).toBe("secret");
  const continuation = { ...shown.authPresentation.action_data, method: "runtime_continue", auth_value: "owned-value" };
  await expect(withPrivateProviderAuthResponse(async () => {
    const next = await f.run("step2", continuation);
    expect(next.authPresentation?.prompt).toMatchObject({ type: "text", message: "Next field" });
    expect(JSON.stringify(next.contentBlocks)).not.toContain("Next field");
    throw new Error("Synthetic continuation delivery failure");
  })).rejects.toThrow("Synthetic continuation delivery failure");
  expect((await withPrivateProviderAuthResponse(() => f.run("step2", continuation))).status).toBe("error");
  expect(f.registry.authStorage.get("openai")).toBeUndefined();
});

test("same-provider flows stay session-local and foreign prompt IDs cannot resolve either", async () => {
  const first = fixture(), second = fixture();
  const firstCard = await first.run("step1", { provider: "openai" });
  const secondCard = await second.run("step1", { provider: "openai" });
  expect(action(firstCard).flow_id).not.toBe(action(secondCard).flow_id);
  const denied = await second.run("step2", { ...action(firstCard), auth_value: "foreign-sentinel" });
  expect(denied.status).toBe("error");
  expect(second.registry.authStorage.get("openai")).toBeUndefined();
  expect((await first.run("step2", { ...action(firstCard), auth_value: "first-key" })).status).toBe("success");
  expect((await second.run("step2", { ...action(secondCard), auth_value: "second-key" })).status).toBe("success");
  expect(first.registry.authStorage.get("openai").key).toBe("first-key");
  expect(second.registry.authStorage.get("openai").key).toBe("second-key");
});

test("foreign chat cannot consume or cancel an initiating session's prompt", async () => {
  const f = fixture();
  const start = await f.run("step1", { provider: "openai" });
  await expect(f.run("step2", { ...action(start, "runtime_cancel") }, "web:foreign")).rejects.toThrow("Authentication session ended");
  expect((await f.run("step2", { ...action(start), auth_value: "owned-key" })).status).toBe("success");
});

test("consumed prompt card cannot supply a second provider-owned prompt", async () => {
  const observed: string[] = [];
  const f = fixture(async (_provider, _type, interaction) => {
    observed.push(await interaction.prompt({ type: "secret", message: "First" }));
    observed.push(await interaction.prompt({ type: "text", message: "Second" }));
  });
  const first = await f.run("step1", { provider: "openai" });
  const next = await f.run("step2", { ...action(first), auth_value: "first" });
  expect((await f.run("step2", { ...action(first), auth_value: "replay" })).status).toBe("error");
  expect(observed).toEqual(["first"]);
  expect((await f.run("step2", { ...action(next), auth_value: "second" })).status).toBe("success");
  expect(observed).toEqual(["first", "second"]);
});

test("superseded provider settlement cannot remove the replacement flow", async () => {
  const f = fixture();
  const old = await f.run("step1", { provider: "openai" });
  const replacement = await f.run("step1", { provider: "openai" });
  expect((await f.run("step2", { ...action(old), auth_value: "stale" })).status).toBe("error");
  expect((await f.run("step2", { ...action(replacement), auth_value: "replacement" })).status).toBe("success");
  expect(f.registry.authStorage.get("openai").key).toBe("replacement");
});

test("disposal cancels pending interaction and disposed sessions cannot restart login", async () => {
  let signal!: AbortSignal;
  const f = fixture(async (_provider, _type, interaction) => {
    signal = interaction.signal;
    await interaction.prompt({ type: "secret", message: "Key" });
  });
  const start = await f.run("step1", { provider: "openai" });
  f.dispose();
  expect(signal.aborted).toBe(true);
  await expect(f.run("step2", { ...action(start), auth_value: "after-dispose" })).rejects.toThrow("Authentication session ended");
  await expect(f.run("step1", { provider: "openai" })).rejects.toThrow("Authentication session ended");
});

test("session-generation and runtime replacement reject prior cards", async () => {
  const f = fixture();
  const start = await f.run("step1", { provider: "openai" });
  f.session.sessionId = "replacement-generation";
  expect((await f.run("step2", { ...action(start), auth_value: "stale-generation" })).status).toBe("error");
  const next = await f.run("step1", { provider: "openai" });
  f.session.modelRuntime = createTestModelRegistry([{ provider: "openai", id: "one" }]).modelRuntime;
  expect((await f.run("step2", { ...action(next), auth_value: "stale-runtime" })).status).toBe("error");
});

test("expired flow rejects input even before its timer callback runs", async () => {
  const f = fixture();
  const start = await f.run("step1", { provider: "openai" });
  const previous = Date.now;
  Date.now = () => previous() + 300_001;
  try { expect((await f.run("step2", { ...action(start), auth_value: "expired" })).message).toContain("expired"); }
  finally { Date.now = previous; }
  expect(f.registry.authStorage.get("openai")).toBeUndefined();
});

test("provider errors containing secrets never enter results or structured log fields", async () => {
  const sentinel = "SENTINEL-secret-provider-error";
  const logs: LogRecord[] = [], sink = (record: LogRecord) => logs.push(record);
  addLogSink(sink);
  try {
    const f = fixture(async () => { throw new Error(`https://example.test/?access_token=${sentinel}`); });
    const result = await f.run("step1", { provider: "openai" });
    expect(result.status).toBe("error");
    expect(JSON.stringify({ result, logs })).not.toContain(sentinel);
    expect(result.message).toContain("Start again");
  } finally { removeLogSink(sink); }
});

test("single-model login refreshes availability but requires owner-bound one-time activation", async () => {
  const f = fixture();
  const { createNativeControlFixture } = await import('./native-control-fixture.js');
  const control = createNativeControlFixture(f.session, f.registry, 'web:auth-owner');
  const previous = f.run;
  f.run = (step, data, chat = 'web:auth-owner') => control.facade.applyControlCommand(chat, {
    type: 'login', provider: '__' + step + ' ' + JSON.stringify(data), raw: '/login',
  });
  try {
  let refreshes = 0;
  f.registry.refresh = async () => { refreshes++; };
  const start = await f.run("step1", { provider: "openai" });
  const done = await f.run("step2", { ...action(start), auth_value: "key" });
  expect(done.model_label).toBeUndefined();
  expect(f.session.model.id).toBe("gpt-test");
  expect(refreshes).toBe(1);
  const data = (done.contentBlocks?.[0] as any).payload.actions[0].data;
  const foreign = fixture();
  expect((await foreign.run("step3", { ...data, model: "one" })).status).toBe("error");
  expect((await f.run("step3", { ...data, model: "one" })).model_label).toBe("openai/one");
  expect((await f.run("step3", { ...data, model: "one" })).status).toBe("error");
  } finally { control.dispose(); f.run = previous; }
});

test("disposal during availability refresh cannot mint a post-login activation", async () => {
  const f = fixture();
  f.registry.refresh = async () => { f.dispose(); };
  const start = await f.run("step1", { provider: "openai" });
  const done = await f.run("step2", { ...action(start), auth_value: "key" });
  expect(done.status).toBe("error");
  expect(done.contentBlocks).toBeUndefined();
  expect(f.session.model.id).toBe("gpt-test");
});

test("activation permit is provider-specific and expires without changing model", async () => {
  const f = fixture();
  const start = await f.run("step1", { provider: "openai" });
  const done = await f.run("step2", { ...action(start), auth_value: "key" });
  const data = (done.contentBlocks?.[0] as any).payload.actions[0].data;
  expect((await f.run("step3", { ...data, provider: "anthropic", model: "one" })).status).toBe("error");
  const previous = Date.now;
  Date.now = () => previous() + 300_001;
  try { expect((await f.run("step3", { ...data, model: "one" })).status).toBe("error"); }
  finally { Date.now = previous; }
  expect(f.session.model.id).toBe("gpt-test");
});

test("logout cancels pending provider prompt and invalidates existing activation permits", async () => {
  const f = fixture();
  const start = await f.run("step1", { provider: "openai" });
  const done = await f.run("step2", { ...action(start), auth_value: "stored" });
  const activation = (done.contentBlocks?.[0] as any).payload.actions[0].data;
  const pending = await f.run("step1method", { provider: "openai", action: "api_key" });
  const logout = await withChatContext("web:auth-owner", "web", () => handleLogout(f.context, f.registry, { type: "logout", provider: "openai", raw: "/logout openai" }));
  expect(logout.status).toBe("success");
  expect((await f.run("step2", { ...action(pending), auth_value: "resurrect" })).status).toBe("error");
  expect((await f.run("step3", { ...activation, model: "one" })).status).toBe("error");
  expect(f.registry.authStorage.get("openai")).toBeUndefined();
});

test("shared-runtime authentication replaces the prior provider flow across sessions", async () => {
  const first = fixture(), second = fixture();
  second.session.modelRuntime = first.session.modelRuntime;
  const prior = await first.run("step1", { provider: "openai" });
  const latest = await second.run("step1", { provider: "openai" });
  expect((await first.run("step2", { ...action(prior), auth_value: "old" })).status).toBe("error");
  expect((await second.run("step2", { ...action(latest), auth_value: "latest" })).status).toBe("success");
  expect(first.registry.authStorage.get("openai").key).toBe("latest");
});

test("logout during model refresh cannot mint a new activation permit", async () => {
  const f = fixture();
  f.registry.refresh = async () => {
    await handleLogout(f.context, f.registry, { type: "logout", provider: "openai", raw: "/logout openai" });
  };
  const start = await f.run("step1", { provider: "openai" });
  const done = await f.run("step2", { ...action(start), auth_value: "key" });
  expect(done.status).toBe("error");
  expect(done.contentBlocks).toBeUndefined();
  expect(f.registry.authStorage.get("openai")).toBeUndefined();
});

test("changing auth method supersedes the same provider's previous credential flow", async () => {
  const f = fixture(async (_provider, _type, interaction) => {
    await interaction.prompt({ type: "text", message: "Provider-owned code or key" });
  });
  const providers = f.registry.modelRuntime.getProviders;
  f.registry.modelRuntime.getProviders = () => providers().map((entry: any) => ({ ...entry, auth: { ...entry.auth, oauth: { login: async () => ({}) } } }));
  const old = await f.run("step1method", { provider: "openai", action: "api_key" });
  const latest = await f.run("step1method", { provider: "openai", action: "oauth" });
  expect((await f.run("step2", { ...action(old), auth_value: "old-key" })).status).toBe("error");
  expect((await f.run("step2", { ...action(latest), auth_value: "new-code" })).status).toBe("success");
});

test("logout joins a canceled login's already-admitted credential mutation before deleting it", async () => {
  let release!: () => void, mutationStarted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { mutationStarted = resolve; });
  const f = fixture(async (_provider, _type, interaction) => {
    const key = await interaction.prompt({ type: "secret", message: "Key" });
    mutationStarted();
    await gate; // Represents an already-admitted write that cannot be canceled.
    f.registry.authStorage.set("openai", { type: "api_key", key });
  });
  const start = await f.run("step1", { provider: "openai" });
  const continuing = f.run("step2", { ...action(start), auth_value: "late-write" });
  await started;
  let logoutSettled = false;
  const logout = withChatContext("web:auth-owner", "web", () => handleLogout(f.context, f.registry, { type: "logout", provider: "openai", raw: "/logout openai" })).then(result => { logoutSettled = true; return result; });
  await Bun.sleep(5);
  expect(logoutSettled).toBe(false);
  release();
  expect((await logout).status).toBe("success");
  expect((await continuing).status).toBe("error");
  expect(f.registry.authStorage.get("openai")).toBeUndefined();
});

test("a new login waits behind pending logout rather than having its credentials deleted", async () => {
  const f = fixture();
  f.registry.authStorage.set("openai", { type: "api_key", key: "old" });
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const arrival = new Promise<void>(resolve => { arrived = resolve; });
  const originalLogout = f.registry.modelRuntime.logout;
  f.registry.modelRuntime.logout = async (provider: string) => { arrived(); await gate; await originalLogout(provider); };
  const logout = withChatContext("web:auth-owner", "web", () => handleLogout(f.context, f.registry, { type: "logout", provider: "openai", raw: "/logout openai" }));
  await arrival;
  const login = f.run("step1method", { provider: "openai", action: "api_key" });
  release();
  expect((await logout).status).toBe("success");
  const latest = await login;
  expect((await f.run("step2", { ...action(latest), auth_value: "new" })).status).toBe("success");
  expect(f.registry.authStorage.get("openai").key).toBe("new");
});

test("logout confirmation cannot replay after reauthentication or cross to another session", async () => {
  const f = fixture();
  f.registry.authStorage.set("openai", { type: "api_key", key: "old" });
  const confirmation = await f.run("step1method", { provider: "openai", action: "logout" });
  const data = (confirmation.contentBlocks?.[0] as any).payload.actions[0].data;
  const foreign = fixture();
  expect((await foreign.run("step2", data)).status).toBe("error");
  const start = await f.run("step1method", { provider: "openai", action: "api_key" });
  expect((await f.run("step2", { ...action(start), auth_value: "new" })).status).toBe("success");
  expect((await f.run("step2", data)).status).toBe("error");
  expect(f.registry.authStorage.get("openai").key).toBe("new");
  const latest = await f.run("step1method", { provider: "openai", action: "logout" });
  const latestData = (latest.contentBlocks?.[0] as any).payload.actions[0].data;
  expect((await f.run("step2", latestData)).status).toBe("success");
  expect((await f.run("step2", latestData)).status).toBe("error");
});

test("disposed-session logout cannot delete shared-runtime credentials", async () => {
  const f = fixture();
  const start = await f.run("step1", { provider: "openai" });
  await f.run("step2", { ...action(start), auth_value: "key" });
  f.dispose();
  await expect(withChatContext("web:auth-owner", "web", () => handleLogout(f.context, f.registry, { type: "logout", provider: "openai", raw: "/logout openai" }))).rejects.toThrow("Authentication session ended");
  expect(f.registry.authStorage.get("openai").key).toBe("key");
});

test("custom-provider configuration never prefills its stored API key into a card", async () => {
  await withTempWorkspaceEnv("auth-custom-form-", {}, async workspace => {
    const agentDir = join(workspace.base, "agent");
    const restore = process.env.PICLAW_PI_AGENT_DIR;
    process.env.PICLAW_PI_AGENT_DIR = agentDir;
    mkdirSync(agentDir, { recursive: true });
    const sentinel = "STORED-custom-key-sentinel";
    writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { "openai-compatible": { baseUrl: "https://example.test/v1", apiKey: sentinel, models: [{ id: "one" }] } } }));
    const registry = createTestModelRegistry([{ provider: "openai-compatible", id: "one" }]);
    const session = new TestAgentControlSession(workspace.workspace, registry);
    const native = createNativeAuthFixture(session, registry, 'web:auth-custom');
    try {
      const result = await withChatContext('web:auth-custom', 'web', () => handleLogin(native.context, registry, { type: "login", provider: `__step1method ${JSON.stringify({ provider: "openai-compatible", action: "configure" })}`, raw: "/login __step1method" }));
      expect(JSON.stringify(result)).not.toContain(sentinel);
      expect((result.contentBlocks?.[0] as any).payload.body.find((item: any) => item.id === "apiKey")).toMatchObject({ value: "", style: "password" });
    } finally {
      native.dispose();
      if (restore === undefined) delete process.env.PICLAW_PI_AGENT_DIR;
      else process.env.PICLAW_PI_AGENT_DIR = restore;
    }
  });
});
