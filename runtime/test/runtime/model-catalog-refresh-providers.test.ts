import { afterEach, expect, test } from "bun:test";
import { InMemoryModelsStore, type Credential, type CredentialInfo } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { registerGitHubCopilotDynamicModels, setGitHubCopilotDynamicModelsFetchForTests } from "../../src/extensions/github-copilot-dynamic-models.js";
import { refreshModelCatalogs } from "../../src/runtime/model-catalog-refresh.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; setGitHubCopilotDynamicModelsFetchForTests(null); });

function credentials(entries: Record<string, Credential>) {
  const map = new Map(Object.entries(entries));
  return {
    read: async (id: string) => map.get(id),
    list: async (): Promise<readonly CredentialInfo[]> => [...map.entries()].map(([providerId, value]) => ({ providerId, type: value.type })),
    modify: async (id: string, fn: any) => { const next = await fn(map.get(id)); if (next !== undefined) map.set(id, next); return next ?? map.get(id); },
    delete: async (id: string) => { map.delete(id); },
  };
}
const catalogModel = (provider: string, id: string, template: any) => ({ ...template, id, name: id, provider });

test("Update catalogues refreshes Copilot, OpenAI, Anthropic and OpenRouter, and new models are selectable at once", async () => {
  const runtime = await ModelRuntime.create({
    credentials: credentials({
      "github-copilot": { type: "oauth", access: "tid=x;exp=1", refresh: "gh", expires: Date.now() + 3_600_000 } as any,
      openai: { type: "api_key", key: "sk-openai" } as any,
      anthropic: { type: "api_key", key: "sk-ant" } as any,
      openrouter: { type: "api_key", key: "sk-or" } as any,
    }),
    modelsPath: null, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false,
  });
  registerGitHubCopilotDynamicModels(runtime);
  await runtime.refresh({ allowNetwork: false });
  const templates = Object.fromEntries(["openai", "anthropic", "openrouter"].map(id => [id, runtime.getModels(id)[0]]));
  const fresh = { openai: "gpt-catalogue-new", anthropic: "claude-catalogue-new", openrouter: "vendor/router-new" } as Record<string, string>;
  const catalogueRequests: string[] = [], allRequests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    allRequests.push(`${url.hostname}${url.pathname}`);
    const match = url.pathname.match(/^\/api\/models\/providers\/([^/]+)$/);
    if (url.hostname === "pi.dev" && match) {
      const provider = decodeURIComponent(match[1]!);
      catalogueRequests.push(provider);
      const models = fresh[provider] ? [catalogModel(provider, fresh[provider]!, templates[provider])] : [];
      return new Response(JSON.stringify(models), { status: 200, headers: { "content-type": "application/json", "last-modified": new Date(Date.now() + 60_000).toUTCString() } });
    }
    if (url.hostname === "openrouter.ai") return new Response(JSON.stringify({ data: [{ id: fresh.openrouter }] }), { status: 200 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  setGitHubCopilotDynamicModelsFetchForTests((async () => new Response(JSON.stringify({ data: [{
    id: "gpt-copilot-new", name: "gpt-copilot-new", model_picker_enabled: true, policy: { state: "enabled" }, supported_endpoints: ["/responses"],
    capabilities: { family: "gpt-copilot-new", limits: { max_context_window_tokens: 400000, max_output_tokens: 64000 }, supports: { tool_calls: true } },
  }] }), { status: 200 })) as any);

  const outcome = await refreshModelCatalogs(runtime);
  expect(outcome).toMatchObject({ status: "completed", skipped: [], failed: [] });
  expect(outcome.providers).toEqual(expect.arrayContaining(["anthropic", "github-copilot", "openai", "openrouter"]));
  expect(outcome.models!.after).toBeGreaterThan(0);
  expect(catalogueRequests).toEqual(expect.arrayContaining(["openai", "anthropic", "openrouter"]));
  expect(allRequests).toContain("openrouter.ai/api/v1/models/user"); // OpenRouter narrows to the key's own catalogue
  // No restart or second refresh: the runtime snapshot already lists them.
  const available = new Set(runtime.getAvailableSnapshot().map(model => `${model.provider}/${model.id}`));
  for (const key of ["github-copilot/gpt-copilot-new", "openai/gpt-catalogue-new", "anthropic/claude-catalogue-new", "openrouter/vendor/router-new"]) expect(available.has(key)).toBe(true);
});

test("a provider whose catalogue fetch fails is reported while the others still update", async () => {
  const runtime = await ModelRuntime.create({
    credentials: credentials({
      "github-copilot": { type: "oauth", access: "tid=x;exp=1", refresh: "gh", expires: Date.now() + 3_600_000 } as any,
      openai: { type: "api_key", key: "sk-openai" } as any,
    }),
    modelsPath: null, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false,
  });
  registerGitHubCopilotDynamicModels(runtime);
  await runtime.refresh({ allowNetwork: false });
  const template = runtime.getModels("openai")[0];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname === "/api/models/providers/openai") return new Response(JSON.stringify([catalogModel("openai", "gpt-still-updates", template)]), { status: 200, headers: { "last-modified": new Date(Date.now() + 60_000).toUTCString() } });
    return new Response(JSON.stringify([]), { status: 200 });
  }) as typeof fetch;
  setGitHubCopilotDynamicModelsFetchForTests((async () => new Response("unavailable", { status: 503 })) as any);
  const outcome = await refreshModelCatalogs(runtime);
  expect(outcome.status).toBe("partial");
  expect(outcome.failed.map(item => item.provider)).toEqual(["github-copilot"]);
  expect(runtime.getAvailableSnapshot().some(model => model.provider === "openai" && model.id === "gpt-still-updates")).toBe(true);
});
