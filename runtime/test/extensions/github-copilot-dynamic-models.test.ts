import { afterEach, describe, expect, test } from "bun:test";
import { InMemoryModelsStore, type Credential, type CredentialInfo, type Model, type ModelsStoreEntry } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import {
  createGitHubCopilotDynamicModelsProvider,
  fetchGitHubCopilotLiveModels,
  mergeGitHubCopilotDynamicModels,
  registerGitHubCopilotDynamicModels,
  setGitHubCopilotDynamicModelsFetchForTests,
  shouldImportGitHubCopilotLiveModelId,
} from "../../src/extensions/github-copilot-dynamic-models.js";

function makeModel(overrides: Partial<Model<any>> = {}): Model<any> {
  return {
    id: "gpt-5.5", name: "GPT-5.5", provider: "github-copilot", api: "openai-responses" as any,
    baseUrl: "https://api.individual.githubcopilot.com", reasoning: true,
    thinkingLevelMap: { off: null, minimal: "low", xhigh: "xhigh" } as any,
    input: ["text", "image"], cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
    contextWindow: 400000, maxTokens: 128000,
    headers: { "Copilot-Integration-Id": "vscode-chat" }, ...overrides,
  };
}

function makeLiveModel(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, name: id, model_picker_enabled: true, policy: { state: "enabled" }, supported_endpoints: ["/responses"],
    capabilities: {
      family: id,
      limits: { max_context_window_tokens: 1050000, max_output_tokens: 128000, vision: { max_prompt_images: 1 } },
      supports: { reasoning_effort: ["none", "low", "medium", "high", "xhigh"], tool_calls: true },
    },
    ...overrides,
  };
}

function createRefreshHarness(initial?: ModelsStoreEntry) {
  let value = initial ? structuredClone(initial) : undefined;
  let acceptedPublicationLimit = Number.POSITIVE_INFINITY;
  let acceptedPublicationCount = 0;
  const publications: Array<{ persist?: ModelsStoreEntry | null; hasUpdate: boolean }> = [];
  return {
    context(overrides: Record<string, unknown> = {}) {
      return {
        stored: value ? structuredClone(value) : undefined,
        allowNetwork: false,
        signal: new AbortController().signal,
        publish: async (publication: { persist?: ModelsStoreEntry | null; update?: () => void }) => {
          publications.push({ persist: publication.persist, hasUpdate: typeof publication.update === "function" });
          if (acceptedPublicationCount >= acceptedPublicationLimit) return false;
          acceptedPublicationCount += 1;
          if (publication.persist === null) value = undefined;
          else if (publication.persist !== undefined) value = structuredClone(publication.persist);
          publication.update?.();
          return true;
        },
        ...overrides,
      };
    },
    read: async () => value ? structuredClone(value) : undefined,
    rejectPublications() { acceptedPublicationLimit = 0; },
    rejectPublicationsAfter(acceptedCount: number) { acceptedPublicationLimit = Math.max(0, acceptedCount); },
    publications,
  };
}

function oauth(access: string, extras: Record<string, unknown> = {}) {
  return { type: "oauth", access, refresh: "github-token", expires: Date.now() + 60_000, ...extras } as any;
}

describe("github-copilot dynamic models overlay", () => {
  afterEach(() => setGitHubCopilotDynamicModelsFetchForTests(null));

  test("filters live model IDs to chat-capable non-embedding model IDs", () => {
    expect(shouldImportGitHubCopilotLiveModelId("gpt-5.6")).toBe(true);
    expect(shouldImportGitHubCopilotLiveModelId("claude-opus-4.7-high")).toBe(true);
    expect(shouldImportGitHubCopilotLiveModelId("text-embedding-3-small")).toBe(false);
    expect(shouldImportGitHubCopilotLiveModelId("trajectory-compaction")).toBe(false);
  });

  test("merges unknown live chat models while preserving known static metadata", () => {
    const existing = [
      makeModel({ id: "gpt-5.5" }),
      makeModel({ id: "gpt-4.1", name: "GPT-4.1", api: "openai-completions" as any, reasoning: false, contextWindow: 128000, maxTokens: 16384 }),
      makeModel({ provider: "openai", id: "gpt-5.5" }),
    ];
    const merged = mergeGitHubCopilotDynamicModels(existing, [
      makeLiveModel("gpt-5.6", { capabilities: { limits: { max_context_window_tokens: 1050000, max_output_tokens: 128000, vision: {} }, supports: { reasoning_effort: ["max"], tool_calls: true } } }),
      makeLiveModel("claude-opus-4.7-high", { supported_endpoints: ["/v1/messages"] }),
      makeLiveModel("text-embedding-3-small"),
      makeLiveModel("gpt-disabled", { policy: { state: "disabled" } }),
      makeLiveModel("gpt-hidden", { model_picker_enabled: false }),
      makeLiveModel("gpt-no-tools", { capabilities: { limits: { max_context_window_tokens: 128000 }, supports: { tool_calls: false } } }),
    ]);
    expect(merged.map((model) => model.id)).toEqual(["claude-opus-4.7-high", "gpt-4.1", "gpt-5.5", "gpt-5.6"]);
    expect(merged.find((model) => model.id === "gpt-5.5")?.contextWindow).toBe(400000);
    expect(merged.find((model) => model.id === "gpt-5.6")?.thinkingLevelMap).toMatchObject({ max: "max" });
    expect(merged.find((model) => model.id === "gpt-5.6")?.headers?.["Editor-Version"]).toBe("vscode/1.107.0");
    expect(merged.find((model) => model.id === "gpt-5.5")?.headers?.["Editor-Version"]).toBe("vscode/1.107.0");
    expect(merged.find((model) => model.id === "claude-opus-4.7-high")?.api).toBe("anthropic-messages");

    const authoritative = mergeGitHubCopilotDynamicModels(existing, [
      makeLiveModel("gpt-5.6"),
      makeLiveModel("gpt-hidden", { model_picker_enabled: false }),
    ], { includeExisting: false });
    expect(authoritative.map((model) => model.id)).toEqual(["gpt-5.6"]);
  });

  test("deduplicates built-in Copilot Opus 5 while preserving 1M adaptive-thinking metadata", () => {
    const existing = [makeModel({
      id: "claude-opus-5",
      api: "anthropic-messages" as any,
      reasoning: true,
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      thinkingLevelMap: { off: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" } as any,
    })];

    const merged = mergeGitHubCopilotDynamicModels(existing, [
      makeLiveModel("claude-opus-5", {
        supported_endpoints: ["/v1/messages"],
        capabilities: {
          limits: { max_context_window_tokens: 1_000_000, max_output_tokens: 128_000 },
          supports: { reasoning_effort: ["low", "medium", "high", "xhigh", "max"], tool_calls: true },
        },
      }),
    ]);

    expect(merged.filter((model) => model.id === "claude-opus-5")).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "claude-opus-5",
      api: "anthropic-messages",
      reasoning: true,
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    });
  });

  test("fetch uses the shared abort signal and bounded endpoint", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ data: [makeLiveModel("gpt-5.6")] }), { status: 200 });
    }) as typeof fetch;
    const models = await fetchGitHubCopilotLiveModels({ baseUrl: "https://api.individual.githubcopilot.com/", apiKey: "token", signal: controller.signal, fetchImpl });
    expect(calls).toEqual(["https://api.individual.githubcopilot.com/models"]);
    expect(models[0]?.id).toBe("gpt-5.6");
  });

  test("offline refresh restores cached extension catalog without network", async () => {
    const baseline = [makeModel({ id: "gpt-5.5" })];
    const runtime = { getModels: () => baseline, getProvider: () => ({ id: "github-copilot", name: "GitHub Copilot", auth: { oauth: {} }, getModels: () => baseline, stream: () => { throw new Error("unused"); }, streamSimple: () => { throw new Error("unused"); } }) } as any;
    const overlay = createGitHubCopilotDynamicModelsProvider(runtime)!;
    const harness = createRefreshHarness({ models: [makeModel({ id: "cached-unknown", name: "Cached Unknown" })], checkedAt: Date.now() });
    let fetchCalls = 0;
    setGitHubCopilotDynamicModelsFetchForTests((async () => { fetchCalls += 1; throw new Error("network forbidden"); }) as any);
    await overlay.refreshModels!(harness.context({ credential: oauth("token"), allowNetwork: false }) as any);
    expect(fetchCalls).toBe(0);
    expect(overlay.getModels().map((model) => model.id)).toEqual(["cached-unknown"]);
  });

  test("cached image and classifier entries cannot enter the chat-only overlay", async () => {
    const baseline=[makeModel({id:"baseline-chat"})];
    const runtime={getProvider:()=>({id:"github-copilot",name:"GitHub Copilot",auth:{oauth:{}},getModels:()=>baseline,stream:()=>{throw Error("unused")},streamSimple:()=>{throw Error("unused")}})} as any;
    const overlay=createGitHubCopilotDynamicModelsProvider(runtime)!;
    const harness=createRefreshHarness({models:[makeModel({id:"cached-chat"}),{type:"image",id:"cached-image",name:"Cached Image",provider:"github-copilot",api:"openai-images"},{type:"classifier",id:"cached-classifier",name:"Cached Classifier",provider:"github-copilot",api:"typesafe-classifier"}] as any,checkedAt:Date.now()});
    await overlay.refreshModels!(harness.context({credential:oauth("token"),allowNetwork:false}) as any);
    expect(overlay.getModels().map(model=>model.id)).toEqual(["cached-chat"]);
  });

  test("rejected cached publication does not mutate the in-memory catalog", async () => {
    const baseline = [makeModel({ id: "gpt-5.5" })];
    const runtime = { getModels: () => baseline, getProvider: () => ({ id: "github-copilot", name: "GitHub Copilot", auth: { oauth: {} }, getModels: () => baseline, stream: () => { throw new Error("unused"); }, streamSimple: () => { throw new Error("unused"); } }) } as any;
    const overlay = createGitHubCopilotDynamicModelsProvider(runtime)!;
    const harness = createRefreshHarness({ models: [makeModel({ id: "stale-cached", name: "Stale Cached" })], checkedAt: Date.now() });
    harness.rejectPublications();

    await overlay.refreshModels!(harness.context({ credential: oauth("token"), allowNetwork: false }) as any);

    expect(overlay.getModels().map((model) => model.id)).toEqual(["gpt-5.5"]);
    expect(harness.publications).toEqual([{ persist: undefined, hasUpdate: true }]);
  });

  test("network refresh avoids the wrapped remote catalog and uses live model templates", async () => {
    let baseModels = [makeModel({ id: "gpt-5.5" })];
    let baseRefreshCalls = 0;
    const baseProvider = {
      id: "github-copilot",
      name: "GitHub Copilot",
      auth: { oauth: {} },
      getModels: () => baseModels,
      refreshModels: async () => {
        baseRefreshCalls += 1;
        baseModels = [...baseModels, makeModel({ id: "gpt-5.4", name: "GPT-5.4" })];
      },
      stream: () => { throw new Error("unused"); },
      streamSimple: () => { throw new Error("unused"); },
    };
    const runtime = { getProvider: () => baseProvider } as any;
    const overlay = createGitHubCopilotDynamicModelsProvider(runtime)!;
    setGitHubCopilotDynamicModelsFetchForTests((async () => new Response(JSON.stringify({ data: [makeLiveModel("gpt-5.6")] }), { status: 200 })) as any);

    const harness = createRefreshHarness();
    await overlay.refreshModels!(harness.context({ credential: oauth("token"), allowNetwork: true }) as any);

    expect(baseRefreshCalls).toBe(0);
    expect(overlay.getModels().map((model) => model.id)).toEqual(["gpt-5.6"]);
  });

  test("network refresh inherits OAuth credential, persists the complete catalog, and derives token-specific endpoint", async () => {
    const baseline = [makeModel({ id: "gpt-5.5" })];
    const runtime = { getModels: () => baseline, getProvider: () => ({ id: "github-copilot", name: "GitHub Copilot", auth: { oauth: {} }, getModels: () => baseline, stream: () => { throw new Error("unused"); }, streamSimple: () => { throw new Error("unused"); } }) } as any;
    const overlay = createGitHubCopilotDynamicModelsProvider(runtime)!;
    const calls: Array<{ url: string; auth: string | null }> = [];
    setGitHubCopilotDynamicModelsFetchForTests((async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("Authorization") });
      return new Response(JSON.stringify({ data: [makeLiveModel("gpt-5.6")] }), { status: 200 });
    }) as any);
    const harness = createRefreshHarness({ models: baseline, checkedAt: 123, lastModified: 456, etag: '"catalog"' });
    await overlay.refreshModels!(harness.context({
      credential: oauth("tid=x;proxy-ep=proxy.business.githubcopilot.com;exp=1"),
      allowNetwork: true,
    }) as any);
    expect(calls).toEqual([{ url: "https://api.business.githubcopilot.com/models", auth: "Bearer tid=x;proxy-ep=proxy.business.githubcopilot.com;exp=1" }]);
    expect(overlay.getModels().map((model) => model.id)).toEqual(["gpt-5.6"]);
    expect(await harness.read()).toMatchObject({
      lastModified: 456,
      etag: '"catalog"',
      models: [{ id: "gpt-5.6" }],
    });
    // checkedAt must advance on a successful live refresh, otherwise the cached
    // catalog is permanently treated as freshly validated.
    expect((await harness.read())!.checkedAt).toBeGreaterThan(123);
  });

  test("concurrent network refreshes coalesce", async () => {
    const runtime = { getModels: () => [makeModel()], getProvider: () => ({ id: "github-copilot", name: "GitHub Copilot", auth: { oauth: {} }, getModels: () => [makeModel()], stream: () => { throw new Error("unused"); }, streamSimple: () => { throw new Error("unused"); } }) } as any;
    const overlay = createGitHubCopilotDynamicModelsProvider(runtime)!;
    let calls = 0;
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    setGitHubCopilotDynamicModelsFetchForTests((async () => {
      calls += 1;
      await blocker;
      return new Response(JSON.stringify({ data: [makeLiveModel("gpt-5.6")] }), { status: 200 });
    }) as any);
    const harness = createRefreshHarness();
    const context = harness.context({ credential: oauth("token"), allowNetwork: true }) as any;
    const first = overlay.refreshModels!(context);
    const second = overlay.refreshModels!(context);
    for (let attempt = 0; attempt < 20 && calls === 0; attempt += 1) await Bun.sleep(1);
    expect(calls).toBe(1);
    release();
    expect(await first).toEqual(await second);
  });

  test("a rejected stale network publication cannot overwrite a newer generation", async () => {
    const runtime = { getModels: () => [makeModel()], getProvider: () => ({ id: "github-copilot", name: "GitHub Copilot", auth: { oauth: {} }, getModels: () => [makeModel()], stream: () => { throw new Error("unused"); }, streamSimple: () => { throw new Error("unused"); } }) } as any;
    const overlay = createGitHubCopilotDynamicModelsProvider(runtime)!;
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    let call = 0;
    setGitHubCopilotDynamicModelsFetchForTests((async () => {
      call += 1;
      if (call === 1) {
        await oldGate;
        return new Response(JSON.stringify({ data: [makeLiveModel("old-generation")] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [makeLiveModel("new-generation")] }), { status: 200 });
    }) as any);
    const oldHarness = createRefreshHarness();
    oldHarness.rejectPublicationsAfter(1);
    const newHarness = createRefreshHarness();
    const oldController = new AbortController();
    const newController = new AbortController();

    const oldRefresh = overlay.refreshModels!(oldHarness.context({ credential: oauth("token"), allowNetwork: true, force: true, signal: oldController.signal }) as any);
    for (let attempt = 0; attempt < 20 && call === 0; attempt += 1) await Bun.sleep(1);
    const newRefresh = overlay.refreshModels!(newHarness.context({ credential: oauth("token"), allowNetwork: true, force: true, signal: newController.signal }) as any);
    await newRefresh;
    releaseOld();
    await oldRefresh;

    expect(call).toBe(2);
    expect(overlay.getModels().map((model) => model.id)).toEqual(["new-generation"]);
    expect((await newHarness.read())?.models.map((model) => model.id)).toEqual(["new-generation"]);
    expect(await oldHarness.read()).toBeUndefined();
  });

  test("sequential refreshes use the fresh live catalog unless forced", async () => {
    const runtime = { getModels: () => [makeModel()], getProvider: () => ({ id: "github-copilot", name: "GitHub Copilot", auth: { oauth: {} }, getModels: () => [makeModel()], stream: () => { throw new Error("unused"); }, streamSimple: () => { throw new Error("unused"); } }) } as any;
    const overlay = createGitHubCopilotDynamicModelsProvider(runtime)!;
    let calls = 0;
    setGitHubCopilotDynamicModelsFetchForTests((async () => {
      calls += 1;
      return new Response(JSON.stringify({ data: [makeLiveModel("gpt-5.6")] }), { status: 200 });
    }) as any);
    const harness = createRefreshHarness();

    await overlay.refreshModels!(harness.context({ credential: oauth("token"), allowNetwork: true }) as any);
    await overlay.refreshModels!(harness.context({ credential: oauth("token"), allowNetwork: true }) as any);
    expect(calls).toBe(1);

    await overlay.refreshModels!(harness.context({ credential: oauth("token"), allowNetwork: true, force: true }) as any);
    expect(calls).toBe(2);
  });

  test("enterprise metadata derives the credential-specific endpoint", async () => {
    const runtime = { getModels: () => [makeModel()], getProvider: () => ({ id: "github-copilot", name: "GitHub Copilot", auth: { oauth: {} }, getModels: () => [makeModel()], stream: () => { throw new Error("unused"); }, streamSimple: () => { throw new Error("unused"); } }) } as any;
    const overlay = createGitHubCopilotDynamicModelsProvider(runtime)!;
    let url = "";
    setGitHubCopilotDynamicModelsFetchForTests((async (input: string | URL | Request) => {
      url = String(input);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as any);
    const harness = createRefreshHarness();
    await overlay.refreshModels!(harness.context({ credential: oauth("opaque", { enterpriseUrl: "ghe.example.com" }), allowNetwork: true }) as any);
    expect(url).toBe("https://copilot-api.ghe.example.com/models");
  });

  test("network failure and abort preserve the last-good catalog", async () => {
    const runtime = { getModels: () => [makeModel()], getProvider: () => ({ id: "github-copilot", name: "GitHub Copilot", auth: { oauth: {} }, getModels: () => [makeModel()], stream: () => { throw new Error("unused"); }, streamSimple: () => { throw new Error("unused"); } }) } as any;
    const overlay = createGitHubCopilotDynamicModelsProvider(runtime)!;
    setGitHubCopilotDynamicModelsFetchForTests((async () => { throw new Error("catalog unavailable"); }) as any);
    const harness = createRefreshHarness();
    await overlay.refreshModels!(harness.context({ credential: oauth("token"), allowNetwork: true }) as any);
    expect(overlay.getModels().map((model) => model.id)).toEqual(["gpt-5.5"]);
    const controller = new AbortController();
    controller.abort();
    await overlay.refreshModels!(harness.context({ credential: oauth("token"), allowNetwork: true, signal: controller.signal }) as any);
    expect(overlay.getModels().map((model) => model.id)).toEqual(["gpt-5.5"]);
  });

  test("real ModelRuntime composition preserves built-in OAuth and streams while importing unknown models", async () => {
    const credentials = new Map<string, Credential>();
    const credentialStore = {
      read: async (providerId: string) => credentials.get(providerId),
      list: async (): Promise<readonly CredentialInfo[]> => [...credentials.entries()].map(([providerId, credential]) => ({ providerId, type: credential.type })),
      modify: async (providerId: string, fn: any) => {
        const next = await fn(credentials.get(providerId));
        if (next !== undefined) credentials.set(providerId, next);
        return next ?? credentials.get(providerId);
      },
      delete: async (providerId: string) => { credentials.delete(providerId); },
    };
    credentials.set("github-copilot", oauth("tid=x;proxy-ep=proxy.business.githubcopilot.com;exp=1", { expires: Date.now() + 60 * 60_000 }));
    const runtime = await ModelRuntime.create({ credentials: credentialStore, modelsPath: null, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false });
    const before = runtime.getProvider("github-copilot")!;
    const nonChat = before.getAllModels!().filter(model => model.type && model.type !== 'chat');
    expect(nonChat.length).toBeGreaterThan(0);
    registerGitHubCopilotDynamicModels(runtime);
    await runtime.refresh({allowNetwork:false}); await Bun.sleep(0); // Join SDK registration's metadata refresh.
    let fetched=0;
    setGitHubCopilotDynamicModelsFetchForTests((async () => {fetched++;return new Response(JSON.stringify({ data: [makeLiveModel("gpt-5.6")] }), { status: 200 });}) as any);
    const result = await runtime.refresh({ allowNetwork: true });
    expect(result.aborted).toBe(false);expect(fetched).toBe(1);
    const after = runtime.getProvider("github-copilot")!;
    expect(result.errors.size).toBe(0);
    expect(after.auth.oauth?.name).toBe(before.auth.oauth?.name);
    expect(typeof after.auth.oauth?.login).toBe("function");
    expect(typeof after.auth.oauth?.refresh).toBe("function");
    expect(typeof after.auth.oauth?.toAuth).toBe("function");
    expect(typeof after.streamSimple).toBe("function");
    expect(after.getAllModels!().filter(model => model.type && model.type !== 'chat')).toEqual(nonChat);
    const imported = runtime.getModel("github-copilot", "gpt-5.6");
    expect(imported).toBeDefined();
    expect(imported?.baseUrl).toBe("https://api.individual.githubcopilot.com");
    expect(() => imported!.baseUrl.includes("githubcopilot.com")).not.toThrow();
    const prepared = await runtime.prepareRequest(imported!);
    expect(prepared.model.baseUrl).toBe("https://api.business.githubcopilot.com");
    expect(prepared.options.headers?.["Editor-Version"]).toBe("vscode/1.107.0");
    expect(prepared.options.headers?.["Editor-Plugin-Version"]).toBe("copilot-chat/0.35.0");
  });

  test("cached dynamic models retain a valid fallback while request auth remains dynamic", async () => {
    const baseline = [makeModel({ id: "gpt-5.5" })];
    const runtime = { getModels: () => baseline, getProvider: () => ({ id: "github-copilot", name: "GitHub Copilot", auth: { oauth: {} }, getModels: () => baseline, stream: () => { throw new Error("unused"); }, streamSimple: () => { throw new Error("unused"); } }) } as any;
    const overlay = createGitHubCopilotDynamicModelsProvider(runtime)!;
    const harness = createRefreshHarness();
    setGitHubCopilotDynamicModelsFetchForTests((async () => new Response(JSON.stringify({ data: [makeLiveModel("gpt-5.6-sol")] }), { status: 200 })) as any);

    await overlay.refreshModels!(harness.context({ credential: oauth("tid=x;proxy-ep=proxy.enterprise.githubcopilot.com;exp=1"), allowNetwork: true }) as any);

    const imported = overlay.getModels().find((model) => model.id === "gpt-5.6-sol");
    const cached = (await harness.read())?.models.find((model) => model.id === "gpt-5.6-sol");
    expect(imported?.baseUrl).toBe("https://api.individual.githubcopilot.com");
    expect(cached?.baseUrl).toBe("https://api.individual.githubcopilot.com");
  });

  test("registers one native provider overlay and leaves OAuth/streams inherited", () => {
    const stream = () => { throw new Error("unused"); };
    const streamSimple = () => { throw new Error("unused"); };
    const baseProvider = { id: "github-copilot", name: "GitHub Copilot", auth: { oauth: { name: "GitHub Copilot" } }, getModels: () => [makeModel()], stream, streamSimple };
    const registrations: any[] = [];
    const runtime = {
      getModels: () => [makeModel()],
      getProvider: () => baseProvider,
      registerNativeProvider: (provider: any) => registrations.push(provider),
    } as any;
    registerGitHubCopilotDynamicModels(runtime);
    expect(registrations).toHaveLength(1);
    expect(registrations[0].id).toBe("github-copilot");
    expect(registrations[0].auth).toBe(baseProvider.auth);
    expect(registrations[0].stream).toBe(stream);
    expect(registrations[0].streamSimple).toBe(streamSimple);
    expect(registrations[0].headers?.["Editor-Version"]).toBe("vscode/1.107.0");
    expect(typeof registrations[0].refreshModels).toBe("function");
  });

  test("keeps live-confirmed Copilot models visible when OAuth availableModelIds is stale, but drops cache-only models", async () => {
    const fable = makeModel({
      id: "claude-fable-5",
      name: "Claude Fable 5",
      api: "openai-completions" as any,
      contextWindow: 1000000,
      maxTokens: 128000,
    });
    const opus = makeModel({
      id: "claude-opus-4.8",
      name: "Claude Opus 4.8",
      api: "anthropic-messages" as any,
      contextWindow: 1000000,
      maxTokens: 64000,
    });
    const baseProvider = {
      id: "github-copilot",
      name: "GitHub Copilot",
      auth: { oauth: { name: "GitHub Copilot" } },
      getModels: () => [fable, opus],
      filterModels: (models: Model<any>[], credential: any) => {
        const ids = new Set(credential?.availableModelIds ?? []);
        return ids.size ? models.filter((model) => ids.has(model.id)) : models;
      },
      stream: () => { throw new Error("unused"); },
      streamSimple: () => { throw new Error("unused"); },
    };
    const runtime = { getProvider: () => baseProvider } as any;
    const overlay = createGitHubCopilotDynamicModelsProvider(runtime)!;

    // Offline: only the cached catalog is known, so upstream availability wins and
    // the unavailable cache-only model must not be selectable.
    const offlineHarness = createRefreshHarness({ models: [fable, opus], checkedAt: Date.now() });
    await overlay.refreshModels!(offlineHarness.context({
      credential: oauth("token", { availableModelIds: ["claude-opus-4.8"] }),
      allowNetwork: false,
    }) as any);

    expect(overlay.filterModels?.(overlay.getModels(), { availableModelIds: ["claude-opus-4.8"] } as any).map((model) => model.id))
      .toEqual(["claude-opus-4.8"]);

    // Live refresh confirms a model that the login-time availableModelIds snapshot
    // does not list yet; that model stays visible, cache-only ones still do not.
    setGitHubCopilotDynamicModelsFetchForTests((async () => new Response(
      JSON.stringify({ data: [makeLiveModel("claude-opus-4.8"), makeLiveModel("claude-opus-5")] }),
      { status: 200 },
    )) as any);
    const liveHarness = createRefreshHarness({ models: [fable, opus], checkedAt: Date.now() });
    await overlay.refreshModels!(liveHarness.context({
      credential: oauth("token", { availableModelIds: ["claude-opus-4.8"] }),
      allowNetwork: true,
      force: true,
    }) as any);

    const visible = overlay.filterModels?.(overlay.getModels(), { availableModelIds: ["claude-opus-4.8"] } as any)
      .map((model) => model.id).sort();
    expect(visible).toEqual(["claude-opus-4.8", "claude-opus-5"]);
    expect(visible).not.toContain("claude-fable-5");
  });
});
