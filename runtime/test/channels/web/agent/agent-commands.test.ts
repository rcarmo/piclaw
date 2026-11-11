import { expect, test } from "bun:test";
import { handleAgentCommandsRequest } from "../../../../src/channels/web/agent/agent-commands.js";
import { getNativeCommandCatalogue } from "../../../../src/agent-control/native-control-capabilities.js";
import type { DurableSessionPositionPort } from "../../../../src/agent-pool/durable-runtime-adapter.js";

const unsupported = ["/queue-all", "/steering-mode", "/followup-mode", "/session-name", "/switch-session", "/session-rotate", "/rollup", "/fork", "/clone", "/forks", "/label", "/labels", "/export-html"].sort();
const forbidden = () => { throw Error("Discovery must not execute native controls or read SDK history"); };
function catalogue(overrides: Partial<DurableSessionPositionPort> = {}) {
  const port = {
    sessionId: "fixture", branchId: "fixture", readPosition: forbidden,
    readModel: forbidden, setModel: forbidden, readThinkingLevel: forbidden, setThinkingLevel: forbidden,
    readReport: forbidden, readTree: forbidden, compact: forbidden, reset: forbidden,
    runBash: forbidden, abortBash: forbidden, abort: forbidden, abortRetry: forbidden,
    readExecutionPolicy: forbidden, setExecutionPolicy: forbidden,
    assertCurrent: forbidden, runOwnedControl: forbidden, lifetimeSignal: new AbortController().signal,
    ...overrides,
  } as DurableSessionPositionPort;
  return getNativeCommandCatalogue(port);
}
const json = (value: unknown, status = 200) => Response.json(value, { status });


for (const bound of [true, false]) test(`durable command discovery never hydrates legacy sessions; bound=${bound}`, async () => {
  const options: any = { defaultChatJid: "web:default", json: (value: unknown, status = 200) => Response.json(value, { status }), agentPool: {
    async getDurableSessionMetadata(chat: string) { expect(chat).toBe("web:default"); return bound ? { backend: "durable", tools: [], extensions: ["unadvertised-addon"], commandCatalogue: catalogue() } : null; },
    getSessionForIntrospection: async () => { throw Error("Legacy hydration forbidden"); },
  } };
  const response = await handleAgentCommandsRequest(new Request("http://fixture/agent/commands"), options);
  expect(response.status).toBe(bound ? 200 : 404);
  if (bound) {
    const result = await response.json() as any;
    expect(result.backend).toBe("durable");
    expect(result.commands.some((command: any) => command.name === "/model")).toBe(true);
    expect(result.commands.some((command: any) => command.name === "/passkeys")).toBe(true);
    expect(result.commands.some((command: any) => command.name === "unadvertised-addon")).toBe(false);
    expect(result.unavailable_commands).toEqual(unsupported);
    const names = result.commands.map((command: any) => command.name);
    for (const name of unsupported) expect(names).not.toContain(name);
    for (const name of ["/model", "/thinking", "/effort", "/context", "/ctx", "/queue", "/steer", "/shell", "!", "/theme", "/settings", "/login"]) expect(names).toContain(name);
    expect(names).not.toContain("/meters");
    expect(result.commands).toHaveLength(41);
    expect(result.unavailable).toEqual(["legacy-extension-commands", "prompt-templates", "skills"]);

    expect(new Set(result.commands.map((command: any) => command.name.toLowerCase())).size).toBe(result.commands.length);
  }
  expect(response.headers.get("server-timing")).toContain("agent_commands");
});

test("native metadata failure is unavailable, never successful legacy fallback", async () => {
  const response = await handleAgentCommandsRequest(new Request("http://fixture/agent/commands"), {
    defaultChatJid: "web:default", json: (value: unknown, status = 200) => Response.json(value, { status }),
    agentPool: { getDurableSessionMetadata: async () => { throw Error("private storage detail"); },
      getSessionForIntrospection: async () => { throw Error("legacy fallback forbidden"); } },
  } as any);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Native command metadata unavailable" });
  expect(response.headers.get("server-timing")).toContain("agent_commands");
});

test("native discovery follows the selected binding and removes unavailable aliases", async () => {
  const response = await handleAgentCommandsRequest(new Request("http://fixture/agent/commands?chat_jid=web:owned"), {
    defaultChatJid: "web:default", json, agentPool: {
      async getDurableSessionMetadata(chat: string) {
        expect(chat).toBe("web:owned");
        return { backend: "durable", commandCatalogue: catalogue({ readModel: undefined, setModel: undefined, readThinkingLevel: undefined, setThinkingLevel: undefined, lifetimeSignal: AbortSignal.abort() }) };
      }, getSessionForIntrospection: forbidden,
    },
  } as any);
  expect(response.status).toBe(200);
  const result = await response.json() as any;
  const names = result.commands.map((command: any) => command.name);
  for (const name of ["/model", "/cycle-model", "/thinking", "/effort", "/cycle-thinking", "/login", "/logout"]) expect(names).not.toContain(name);
  expect(result.unavailable_commands).toContain("/thinking");
  expect(result.unavailable_commands).toContain("/effort");
  for (const name of ["/context", "/ctx", "/queue", "/steer", "!", "/theme", "/passkeys"]) expect(names).toContain(name);
});

for (const commandCatalogue of [undefined, null, {}]) test("native catalogue absent/malformed fails closed: " + String(commandCatalogue), async () => {
  const response = await handleAgentCommandsRequest(new Request("http://fixture/agent/commands"), {
    defaultChatJid: "web:default", json, agentPool: {
      getDurableSessionMetadata: async () => ({ backend: "durable", commandCatalogue }),
      getSessionForIntrospection: forbidden,
    },
  } as any);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Native command metadata unavailable" });
  expect(response.headers.get("server-timing")).toContain("agent_commands");
});

test("legacy discovery preserves extension, template and skill commands", async () => {
  const response = await handleAgentCommandsRequest(new Request("http://fixture/agent/commands"), {
    defaultChatJid: "web:default", json, agentPool: {
      getDurableSessionMetadata: async () => undefined,
      getSessionForIntrospection: async () => ({
        extensionRunner: { getRegisteredCommands: () => [{ name: "legacy-addon", description: "fixture addon" }] },
        promptTemplates: [{ name: "fixture-template", description: "fixture template" }],
        resourceLoader: { getSkills: () => ({ skills: [{ name: "fixture-skill", description: "fixture skill" }] }) },
      }),
    },
  } as any);
  expect(response.status).toBe(200);
  const result = await response.json() as any;
  expect(result.backend).toBeUndefined();
  const names = result.commands.map((command: any) => command.name);
  for (const name of ["/legacy-addon", "/fixture-template", "/skill:fixture-skill", "/fork", "/effort"]) expect(names).toContain(name);
});
