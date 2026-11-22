import { expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAddonStatusPanelPayload,
  getInstalledAddonRuntimeEntries,
  initializeStartupAddonRuntime,
  installAddonRuntimeApi,
  resetAddonRuntimeContributionsForTests,
  runAddonStatusPanelAction,
  setAddonAgentMessageEnqueuer,
  setAddonMessagingRuntimeHandlers,
  shutdownAddonRuntimeContributionsForTests,
} from "../../src/addons/runtime-contributions.js";
import { withTempWorkspaceEnv } from "../helpers.js";
import { getChatTransport } from "../../src/extensions/chat-transport-registry.js";
import {
  getRegisteredExternalAddonRoutes,
  handleExternalAddonRoutes,
  isExternalAddonRouteRegistryFrozen,
} from "../../src/addons/external-routes.js";

test("installed addon runtime entries register status panel and stream-session handlers", async () => {
  resetAddonRuntimeContributionsForTests();
  await withTempWorkspaceEnv("piclaw-addon-runtime-", {}, async (workspace) => {
    const addonDir = join(workspace.workspace, ".pi", "extensions", "node_modules", "piclaw-addon-example");
    mkdirSync(addonDir, { recursive: true });
    writeFileSync(join(addonDir, "package.json"), JSON.stringify({
      name: "piclaw-addon-example",
      version: "0.1.0",
      type: "module",
      pi: {
        extensions: ["index.ts"],
        runtime: { entries: ["runtime.ts"] },
      },
    }, null, 2));
    writeFileSync(join(addonDir, "index.ts"), "export default function noop() {}\n");
    writeFileSync(join(addonDir, "runtime.ts"), `
const api = globalThis.__piclaw_runtime;
api?.registerStatusPanelProvider?.({
  key: "example",
  getPayload(chatJid) {
    return { key: "example", chat_jid: chatJid, content: [{ type: "status", value: 1 }] };
  },
  runAction(action, payload) {
    return { action, payload };
  },
});
const stream = api?.streamSessions?.open?.({
  chatJid: "web:test",
  kind: "portainer.logs.follow",
  label: "Follow container logs",
  toolName: "portainer",
  metadata: { endpoint_id: 2, container: "demo" },
  timeoutMs: 5000,
});
stream?.write?.("line one", { kind: "stdout" });
stream?.write?.("line two", { kind: "stdout", metadata: { seq: 2 } });
stream?.complete?.("finished");
export {};
`);

    expect(getInstalledAddonRuntimeEntries(workspace.workspace)).toEqual([{
      packageName: "piclaw-addon-example",
      path: join(addonDir, "runtime.ts"),
      load: "lazy",
    }]);

    expect(await getAddonStatusPanelPayload("example", "web:test")).toEqual({
      key: "example",
      chat_jid: "web:test",
      content: [{ type: "status", value: 1 }],
    });

    expect(await runAddonStatusPanelAction("example", "stop", { chat_jid: "web:test" })).toEqual({
      action: "stop",
      payload: { chat_jid: "web:test" },
    });

    const runtimeApi = (globalThis as any).__piclaw_runtime;
    expect(runtimeApi.a2ui).toMatchObject({ version: 1, post: expect.any(Function) });
    expect(runtimeApi.registerAdaptiveCardIntentHandler).toBeUndefined();
    const sessions = runtimeApi.streamSessions.list({ chatJid: "web:test", toolName: "portainer" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      chatJid: "web:test",
      kind: "portainer.logs.follow",
      label: "Follow container logs",
      toolName: "portainer",
      status: "completed",
      reason: "finished",
      metadata: { endpoint_id: 2, container: "demo" },
      frameCount: 2,
    });
    expect(sessions[0].frames.map((frame: any) => frame.data)).toEqual(["line one", "line two"]);
    expect(runtimeApi.streamSessions.get(sessions[0].id)?.frames[1].metadata).toEqual({ seq: 2 });
  });
  resetAddonRuntimeContributionsForTests();
});

test("startup and lazy add-on runtime entries load independently", async () => {
  resetAddonRuntimeContributionsForTests();
  await withTempWorkspaceEnv("piclaw-addon-runtime-load-", {}, async (workspace) => {
    const modulesDir = join(workspace.workspace, ".pi", "extensions", "node_modules");
    const lazyDir = join(modulesDir, "piclaw-addon-lazy");
    const startupDir = join(modulesDir, "piclaw-addon-startup-test");
    mkdirSync(lazyDir, { recursive: true });
    mkdirSync(startupDir, { recursive: true });
    writeFileSync(join(lazyDir, "package.json"), JSON.stringify({
      name: "piclaw-addon-lazy",
      type: "module",
      pi: { runtime: { entries: ["runtime.ts"] } },
    }));
    writeFileSync(join(lazyDir, "runtime.ts"), `globalThis.__piclaw_lazy_runtime_loaded = true; export {};\n`);
    writeFileSync(join(startupDir, "package.json"), JSON.stringify({
      name: "piclaw-addon-startup-test",
      type: "module",
      pi: { runtime: { entries: ["runtime.ts"], load: "startup" } },
    }));
    writeFileSync(join(startupDir, "runtime.ts"), `
const api = globalThis.__piclaw_runtime;
api.messaging.registerChatTransport({
  id: "startup-test",
  kind: "bang",
  async send(request) { return { status: "ok", source_chat_jid: request.source_chat_jid }; },
});
api.externalRoutes.register({
  addonId: "startup-test",
  prefix: "/api/addons/startup-test/v1",
  methods: ["GET"],
  maxBodyBytes: 1024,
  handler(_req, pathname, context) {
    return new Response(JSON.stringify({ pathname, context }), { headers: { "Content-Type": "application/json" } });
  },
});
globalThis.__piclaw_startup_agents = await api.messaging.listAdvertisableAgents();
globalThis.__piclaw_startup_runtime_loaded = true;
export {};
`);

    expect(getInstalledAddonRuntimeEntries(workspace.workspace)).toEqual([
      { packageName: "piclaw-addon-lazy", path: join(lazyDir, "runtime.ts"), load: "lazy" },
      { packageName: "piclaw-addon-startup-test", path: join(startupDir, "runtime.ts"), load: "startup" },
    ]);

    await initializeStartupAddonRuntime({
      agentMessageEnqueuer: async (request) => ({ status: "ok", chat_jid: request.chatJid, thread_id: null, created: false }),
      messagingHandlers: {
        listAdvertisableAgents: () => [],
        listAdvertisableSessions: () => [],
        resolveLocalTarget: () => ({ status: "not_found" }),
        deliverPeerMessage: async () => ({ status: "ok", chat_jid: "web:test", thread_id: null, created: false }),
      },
    });
    expect((globalThis as any).__piclaw_startup_runtime_loaded).toBe(true);
    expect((globalThis as any).__piclaw_startup_agents).toEqual([]);
    expect((globalThis as any).__piclaw_lazy_runtime_loaded).toBeUndefined();
    expect(getChatTransport("bang")?.id).toBe("startup-test");
    expect(isExternalAddonRouteRegistryFrozen()).toBe(true);
    expect(getRegisteredExternalAddonRoutes()).toMatchObject([{
      addonId: "startup-test",
      packageName: "piclaw-addon-startup-test",
      entryPath: join(startupDir, "runtime.ts"),
      prefix: "/api/addons/startup-test/v1",
      methods: ["GET"],
      maxBodyBytes: 1024,
    }]);
    const externalResponse = await handleExternalAddonRoutes(
      new Request("http://localhost/api/addons/startup-test/v1/ping"),
      "/api/addons/startup-test/v1/ping",
    );
    expect(await externalResponse?.json()).toMatchObject({
      pathname: "/api/addons/startup-test/v1/ping",
      context: { addonId: "startup-test", packageName: "piclaw-addon-startup-test" },
    });

    expect(await getAddonStatusPanelPayload("missing", "web:test")).toBeNull();
    expect((globalThis as any).__piclaw_lazy_runtime_loaded).toBe(true);
    expect(getChatTransport("bang")?.id).toBe("startup-test");

    delete (globalThis as any).__piclaw_startup_runtime_loaded;
    delete (globalThis as any).__piclaw_startup_agents;
    delete (globalThis as any).__piclaw_lazy_runtime_loaded;
  });
  resetAddonRuntimeContributionsForTests();
  expect(getChatTransport("bang")).toBeNull();
  expect(getRegisteredExternalAddonRoutes()).toEqual([]);
  expect(isExternalAddonRouteRegistryFrozen()).toBe(false);
});

test("startup entry loading fails clearly when concrete messaging handlers were not wired", async () => {
  resetAddonRuntimeContributionsForTests();
  await withTempWorkspaceEnv("piclaw-addon-runtime-unwired-", {}, async (workspace) => {
    const addonDir = join(workspace.workspace, ".pi", "extensions", "node_modules", "piclaw-addon-unwired");
    mkdirSync(addonDir, { recursive: true });
    writeFileSync(join(addonDir, "package.json"), JSON.stringify({
      name: "piclaw-addon-unwired",
      type: "module",
      pi: { runtime: { entries: ["runtime.ts"], load: "startup" } },
    }));
    writeFileSync(join(addonDir, "runtime.ts"), `await globalThis.__piclaw_runtime.messaging.listAdvertisableAgents(); export {};\n`);
    const mod = await import("../../src/addons/runtime-contributions.js");
    await expect(mod.ensureStartupAddonRuntimeEntriesLoaded()).rejects.toThrow("not available yet");
  });
  resetAddonRuntimeContributionsForTests();
});

test("runtime add-on lifecycle cleanup is process-scoped, awaited, and unregisterable", async () => {
  resetAddonRuntimeContributionsForTests();
  const api = installAddonRuntimeApi();
  expect(api.lifecycle.version).toBe(1);
  const events: string[] = [];
  api.lifecycle.onShutdown(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    events.push("async");
  });
  const unregister = api.lifecycle.onShutdown(() => events.push("removed"));
  unregister();
  unregister();
  api.lifecycle.onShutdown(() => {
    events.push("throws");
    throw new Error("cleanup failure");
  });
  await shutdownAddonRuntimeContributionsForTests();
  expect(events.sort()).toEqual(["async", "throws"]);
  await shutdownAddonRuntimeContributionsForTests();
  expect(events.sort()).toEqual(["async", "throws"]);
  resetAddonRuntimeContributionsForTests();
});

test("runtime add-on lifecycle shutdown is bounded when a handler never settles", async () => {
  resetAddonRuntimeContributionsForTests();
  const api = installAddonRuntimeApi();
  api.lifecycle.onShutdown(() => new Promise(() => {}));
  const started = Date.now();
  await shutdownAddonRuntimeContributionsForTests();
  expect(Date.now() - started).toBeGreaterThanOrEqual(3900);
  expect(Date.now() - started).toBeLessThan(5500);
  resetAddonRuntimeContributionsForTests();
}, 7000);

test("runtime add-on messaging API validates lifecycle, data dirs, and transport cleanup", async () => {
  resetAddonRuntimeContributionsForTests();
  await withTempWorkspaceEnv("piclaw-addon-messaging-api-", {}, async (workspace) => {
    const runtimeApi = installAddonRuntimeApi();
    expect(runtimeApi.messaging.version).toBe(1);
    await expect(runtimeApi.messaging.listAdvertisableAgents()).rejects.toThrow("not available yet");
    await expect(runtimeApi.messaging.listAdvertisableSessions()).rejects.toThrow("not available yet");
    await expect(runtimeApi.messaging.resolveLocalTarget({ target_agent_name: "research" })).rejects.toThrow("not available yet");
    await expect(runtimeApi.messaging.deliverPeerMessage({} as any)).rejects.toThrow("not available yet");

    const dataDir = runtimeApi.messaging.getAddonDataDir("remote-peer");
    expect(dataDir).toBe(join(workspace.data, "addons", "remote-peer"));
    expect(existsSync(dataDir)).toBe(true);
    expect(() => runtimeApi.messaging.getAddonDataDir("../escape")).toThrow("Add-on id");
    expect(() => runtimeApi.messaging.getAddonDataDir("RemotePeer")).toThrow("Add-on id");
    const escapedTarget = join(workspace.data, "addons", "escaped");
    const outsideDir = join(workspace.base, "outside-data");
    mkdirSync(join(workspace.data, "addons"), { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    symlinkSync(outsideDir, escapedTarget);
    expect(() => runtimeApi.messaging.getAddonDataDir("escaped")).toThrow("escapes the runtime data root");

    setAddonMessagingRuntimeHandlers({
      listAdvertisableAgents: () => [{ agent_name: "research", active: true }],
      listAdvertisableSessions: () => [{ chatJid: "web:research", agentName: "research", incarnation: "branch-1", active: true }],
      resolveLocalTarget: () => ({ status: "resolved", target_agent_name: "research", active: true }),
      deliverPeerMessage: async () => ({ status: "ok", chat_jid: "web:research", row_id: 9, thread_id: 9, created: true }),
    });
    await expect(runtimeApi.messaging.listAdvertisableAgents()).resolves.toEqual([{ agent_name: "research", active: true }]);
    await expect(runtimeApi.messaging.listAdvertisableSessions()).resolves.toEqual([{ chatJid: "web:research", agentName: "research", incarnation: "branch-1", active: true }]);
    await expect(runtimeApi.messaging.resolveLocalTarget({ target_agent_name: "research" })).resolves.toMatchObject({ status: "resolved" });
    await expect(runtimeApi.messaging.deliverPeerMessage({} as any)).resolves.toMatchObject({ chat_jid: "web:research" });

    expect(() => runtimeApi.messaging.registerChatTransport({
      id: "malicious-local",
      kind: "local",
      send: async (request) => ({ status: "ok", source_chat_jid: request.source_chat_jid }),
    })).toThrow("only the one-hop bang");

    const unregister = runtimeApi.messaging.registerChatTransport({
      id: "remote-peer",
      kind: "bang",
      send: async (request) => ({ status: "ok", source_chat_jid: request.source_chat_jid }),
    });
    expect(getChatTransport("bang")?.id).toBe("remote-peer");
    unregister();
    unregister();
    expect(getChatTransport("bang")).toBeNull();
  });
  resetAddonRuntimeContributionsForTests();
});

test("runtime entry discovery rejects traversal and symlink escapes", async () => {
  await withTempWorkspaceEnv("piclaw-addon-runtime-escape-", {}, async (workspace) => {
    const addonDir = join(workspace.workspace, ".pi", "extensions", "node_modules", "piclaw-addon-escape");
    const outsideFile = join(workspace.base, "outside.ts");
    mkdirSync(addonDir, { recursive: true });
    writeFileSync(outsideFile, "throw new Error('must not load');\n");
    symlinkSync(outsideFile, join(addonDir, "linked.ts"));
    writeFileSync(join(addonDir, "package.json"), JSON.stringify({
      name: "piclaw-addon-escape",
      type: "module",
      pi: { runtime: { entries: ["../../../outside.ts", "linked.ts"], load: "startup" } },
    }));
    expect(getInstalledAddonRuntimeEntries(workspace.workspace)).toEqual([]);
  });
});

test("runtime add-on API exposes the in-process targeted agent-message enqueuer", async () => {
  resetAddonRuntimeContributionsForTests();
  const runtimeApi = installAddonRuntimeApi();
  await expect(runtimeApi.enqueueAgentMessage({ chatJid: "web:test", content: "before wire-up" })).rejects.toThrow("not available yet");

  const requests: unknown[] = [];
  setAddonAgentMessageEnqueuer(async (request) => {
    requests.push(request);
    return { status: "ok", chat_jid: request.chatJid, row_id: 12, thread_id: 12, created: true };
  });

  await expect(runtimeApi.enqueueAgentMessage({ chatJid: "web:test", content: "continue", source: "test.addon" })).resolves.toEqual({
    status: "ok",
    chat_jid: "web:test",
    row_id: 12,
    thread_id: 12,
    created: true,
  });
  expect(requests).toEqual([{ chatJid: "web:test", content: "continue", source: "test.addon" }]);
  resetAddonRuntimeContributionsForTests();
});

test("runtime stream sessions support cancellation and timeout cleanup", async () => {
  resetAddonRuntimeContributionsForTests();
  const runtimeApi = (await import("../../src/addons/runtime-contributions.js")).installAddonRuntimeApi();
  const cancellations: string[] = [];
  const cleaned: string[] = [];
  const events: string[] = [];
  const unsubscribe = runtimeApi.streamSessions.subscribe((event: any) => {
    events.push(event.type);
  });

  const cancellable = runtimeApi.streamSessions.open({
    chatJid: "web:test",
    kind: "portainer.exec.attach",
    label: "Attach shell",
    timeoutMs: 5000,
    onCancel: (reason: string) => cancellations.push(reason),
    onCleanup: (snapshot: any) => cleaned.push(snapshot.status),
  });
  cancellable.write("ready", { kind: "status" });
  const cancelled = runtimeApi.streamSessions.cancel(cancellable.id, "user abort");
  expect(cancelled?.status).toBe("cancelled");
  expect(cancellable.signal.aborted).toBe(true);
  expect(cancellations).toEqual(["user abort"]);
  expect(cleaned).toEqual(["cancelled"]);

  const timedOut = runtimeApi.streamSessions.open({
    chatJid: "web:test",
    kind: "portainer.logs.follow",
    timeoutMs: 1,
    onCancel: (reason: string) => cancellations.push(reason),
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(runtimeApi.streamSessions.get(timedOut.id)?.status).toBe("timed_out");
  expect(cancellations).toContain("timeout");
  expect(events).toContain("created");
  expect(events).toContain("frame");
  expect(events).toContain("cancelled");
  expect(events).toContain("timed_out");
  unsubscribe();
  resetAddonRuntimeContributionsForTests();
});

test('held or rejected socket disposal does not prevent independent runtime shutdown handlers',async()=>{
 const {withAddonRegistrationOwner}=await import('../../src/addons/registration-owner');
 const {registerAuthenticatedWebSocket,reserveAuthenticatedAddonSocket,resetAuthenticatedAddonSocketsForTests}=await import('../../src/addons/authenticated-socket-registry');
 resetAddonRuntimeContributionsForTests();let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let cleaned=false;
 await withAddonRegistrationOwner({addonId:'shutdown-test',packageName:'shutdown-test',entryPath:'test'},async()=>{registerAuthenticatedWebSocket({path:'stream',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:1000,maxConnections:1,authorize:async()=>({chatJid:'web:a'}),open:async()=>({message:async()=>{},dispose:async()=>{await held;throw Error('sensitive transcript');}})});});
 const session=reserveAuthenticatedAddonSocket('/agent/addons/shutdown-test/stream')!.session;await session.open({} as any,{chatJid:'web:a'},{send:async()=>{},close:()=>{}});
 installAddonRuntimeApi().lifecycle.onShutdown(()=>{cleaned=true;});
 const stopping=shutdownAddonRuntimeContributionsForTests();await new Promise(resolve=>setTimeout(resolve,0));expect(cleaned).toBe(true);release();await expect(stopping).rejects.toThrow('Authenticated socket shutdown failed.');resetAuthenticatedAddonSocketsForTests();
});

test('actual startup socket registrar expires and lazy loading cannot borrow its held owner',async()=>{
 resetAddonRuntimeContributionsForTests();await withTempWorkspaceEnv('socket-import-scope-',{},async(workspace)=>{
  const globals=globalThis as any;let release!:()=>void;globals.__socketHeld=new Promise<void>(resolve=>{release=resolve;});globals.__socketEntered=false;globals.__socketLazy=false;
  for(const[name,load,source]of[
   ['piclaw-addon-held','startup',`const api=globalThis.__piclaw_runtime;globalThis.__socketCaptured=api.authenticatedSockets.register;globalThis.__socketEntered=true;await globalThis.__socketHeld;api.authenticatedSockets.register({path:'stream',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:1000,maxConnections:1,authorize:async()=>({chatJid:'web:a'}),open:async()=>({message:async()=>{},dispose:async()=>{}})});`],
   ['piclaw-addon-borrow','lazy',`globalThis.__socketLazy=true;try{globalThis.__piclaw_runtime.authenticatedSockets.register({path:'borrowed',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:1000,maxConnections:1,authorize:async()=>({chatJid:'web:a'}),open:async()=>({message:async()=>{},dispose:async()=>{}})});}catch{globalThis.__socketDenied=true;}`],
  ]){const dir=join(workspace.workspace,'.pi/extensions/node_modules',name);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'package.json'),JSON.stringify({name,version:'0.0.1',type:'module',pi:{runtime:{entries:['runtime.ts'],load}}}));writeFileSync(join(dir,'runtime.ts'),source);}
  const starting=initializeStartupAddonRuntime({agentMessageEnqueuer:async request=>({status:'ok',chat_jid:request.chatJid,thread_id:null,created:false}),messagingHandlers:{listAdvertisableAgents:()=>[],listAdvertisableSessions:()=>[],resolveLocalTarget:()=>({status:'not_found'}),deliverPeerMessage:async()=>({status:'ok',chat_jid:'web:a',thread_id:null,created:false})}});while(!globals.__socketEntered)await new Promise(resolve=>setTimeout(resolve,0));
  const lazy=getAddonStatusPanelPayload('missing','web:a');await new Promise(resolve=>setTimeout(resolve,0));expect(globals.__socketLazy).toBe(false);release();await starting;await lazy;expect(globals.__socketDenied).toBe(true);
  expect(()=>globals.__socketCaptured({})).toThrow('expired');const {hasAuthenticatedAddonSocket}=await import('../../src/addons/authenticated-socket-registry');expect(hasAuthenticatedAddonSocket('/agent/addons/held/stream')).toBe(true);expect(hasAuthenticatedAddonSocket('/agent/addons/held/borrowed')).toBe(false);
  await shutdownAddonRuntimeContributionsForTests();const {resetAuthenticatedAddonSocketsForTests}=await import('../../src/addons/authenticated-socket-registry');resetAuthenticatedAddonSocketsForTests();
  for(const key of ['__socketHeld','__socketEntered','__socketLazy','__socketCaptured','__socketDenied'])delete globals[key];
 });resetAddonRuntimeContributionsForTests();
});
