import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { ToolRegistration } from "../../runtime/durable-engine/qualification/durable.ts";
import { actualAddonGraph } from "./src/actual-addon-graph.ts";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import type { ToolDefinition, ExtensionToolContext } from "../../node_modules/@earendil-works/pi-coding-agent";
import type { TSchema } from "../../runtime/durable-engine/qualification/ai.ts";
import type { JsonValue } from "../../runtime/durable-engine/qualification/chord.ts";
import type { ToolExecutionApi } from "../../runtime/durable-engine/qualification/durable.ts";
import { BACKGROUND_CONTEXT as context } from "../../runtime/durable-engine/qualification/context.ts";
import { createHostTool } from "../../runtime/durable-engine/src/index.js";

// Deliberately mandatory companion source, never silently skip or use live add-ons.
const root = process.env.DURABLE_ADDONS_ROOT;
if (!root) throw Error("Requires DURABLE_ADDONS_ROOT at de92bc95b5b3bb1505beec9617d3b8a5e4fa92d3");
const sources = {
  "code-review": { version: "0.1.8", hash: "889769f64cd52c6271aae7bca72467e83c531a82389dc31f787ec40f39055e21", files: ["index", "host", "runtime", "dispatch", "store", "database", "anchors", "contracts", "validation", "source", "render-source", "markdown"] },
  "remote-peer": { version: "0.3.6", hash: "10cfb60a9a5524f877d0a76353b18417dcfd486c0b62ee2a1d0d14a35d13e117", files: ["index", "runtime-service", "compat/runtime", "service", "state", "transport", "discovery", "config", "client-id"] },
};
for (const [addon, pin] of Object.entries(sources)) {
  const hash = createHash("sha256");
  for (const file of pin.files) { hash.update(file + "\0"); hash.update(await Bun.file(resolve(root, "addons", addon, file + ".ts")).text()); }
  expect(hash.digest("hex")).toBe(pin.hash);
  expect((await Bun.file(resolve(root, "addons", addon, "package.json")).json()).version).toBe(pin.version);
}
type Definition = ToolDefinition<TSchema, JsonValue>;
type Capture = { registerTool(tool: Definition): void; on(event: string, hook: () => unknown): void };
// Only hash-pinned source, never the external checkout's node_modules.
const copy = mkdtempSync(resolve(import.meta.dir, "pinned-addon-copy-"));
writeFileSync(join(copy, "package.json"), JSON.stringify({ private: true, type: "module" }));
for (const [addon, pin] of Object.entries(sources)) for (const file of pin.files) {
  const dest = resolve(copy, "addons", addon, file + ".ts");
  mkdirSync(resolve(dest, ".."), { recursive: true });
  copyFileSync(resolve(root!, "addons", addon, file + ".ts"), dest);
}
const path = (addon: string, file: string) => resolve(copy, "addons", addon, file + ".ts");
expect(existsSync(join(copy, "node_modules"))).toBe(false);
expect(createRequire(path("remote-peer", "transport")).resolve("@number0/iroh/index.js")).toStartWith(resolve(import.meta.dir, "node_modules"));
expect(import.meta.resolve("@earendil-works/pi-coding-agent", path("code-review", "index"))).toStartWith("file://" + resolve(import.meta.dir, "../../node_modules"));

// Raw denial checks and public durable graph; no authentication/network proof.
// Only JSON arguments/results cross the model-facing bridge; the exact
// invocation's capability is host-owned ALS. No 1.3 context is cast into a 1.2 ctx.
test("actual Code Review and Remote Peer factories: disposable services, host-local capability, read-only actions and mutation denial", async () => {
  const globals = globalThis as unknown as Record<string | symbol, any>;
  const keys = ["__piclaw_runtime", "__piclaw_registerAddonConfigApi", Symbol.for("piclaw.remote-peer.iroh-v1.service")];
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globals, key));
  const dir = mkdtempSync(join(tmpdir(), "durable-addon-host-"));
  const local = new AsyncLocalStorage<{ jid: string; owner: boolean }>();
  const jid = "web:synthetic-addon-owner";
  let owner = true, invocations = 0;
  const tools: ToolRegistration<TSchema, JsonValue>[] = [];
  let shutdown = 0, transportRegistrations = 0, checks = 0;
  const denied = () => { throw Error("SYNTHETIC_PRIVATE_HOST_CAPABILITY"); };
  const capability = {
    version: 1, accessMode: "single-user", kind: "operator", ownerId: "fixture-owner", actorId: "fixture-actor",
    workspaceRoot: dir, workspaceId: "fixture-workspace",
    async listTargets() { checks++; if (!local.getStore()?.owner || local.getStore()?.jid !== jid) denied(); return []; },
    async resolveTarget() { return null; }, enqueue: denied,
  };
  const check = () => { if (!local.getStore()?.owner || local.getStore()?.jid !== jid) denied(); };
  globals.__piclaw_runtime = {
    localContext: { version: 1, getToolContext() { check(); return capability; }, getRequestContext: denied },
    messaging: { version: 1, getAddonDataDir(addon: string) { check(); const d = join(dir, addon); mkdirSync(d, { recursive: true }); return d; },
      registerChatTransport() { transportRegistrations++; return () => { transportRegistrations--; }; },
      async listAdvertisableAgents() { return []; }, deliverPeerMessage: denied, resolveLocalTarget: denied },
    lifecycle: { version: 1, onShutdown() { shutdown++; return () => { shutdown--; }; } },
  };
  delete globals.__piclaw_registerAddonConfigApi;
  delete globals[keys[2]!];
  let reviews: { closeReviewServices(): void; reviewService(): any } | undefined;
  let peers: { closePeerService(): Promise<void>; getPeerService(): any } | undefined;
  try {
    reviews = await import(path("code-review", "runtime"));
    peers = await import(path("remote-peer", "runtime-service"));
    for (const [addon, name, action] of [["code-review", "code_review", "dispatches"], ["remote-peer", "remote_peer", "status"]]) {
      const actual = await import(path(addon!, "index")) as { default(api: Capture): void };
      let definition: Definition | undefined;
      const resources: (() => unknown)[] = [];
      actual.default({ registerTool(tool) { expect(definition).toBeUndefined(); definition = tool; }, on(event, hook) { expect(event).toBe("resources_discover"); resources.push(hook); } });
      if (!definition) throw Error("Missing actual registered tool");
      expect(definition.name).toBe(name!);
      expect(resources).toHaveLength(1);
      expect(JSON.stringify(resources[0]!())).toContain("skills/");
      const tool = createHostTool(definition, { authority: { check }, effectFence: "host-effect-port",
        async invoke(args, call) { call.assertAllowed(); return call.execute(call.toolCallId, args, call.signal, call.onUpdate, { cwd: dir } as ExtensionToolContext); } });
      expect(tool.parameters).not.toBe(definition.parameters);
      expect(tool.parameters).toEqual(structuredClone(definition.parameters));
      expect(tool.callers).toEqual(["model"]); expect(tool.replay).toBe("unsafe");
      const api = { callId: "synthetic-call", output: denied, details: denied } as unknown as ToolExecutionApi<JsonValue>;
      const invoke = (args: Record<string, string>, scope = { jid, owner: true }) => local.run(scope, () => tool.execute(JSON.parse(JSON.stringify(args)), api, context));
      const result = await invoke({ action: action! });
      if (result.isError) throw Error(JSON.stringify(result));
      // The actual Remote Peer dashboard contains optional undefined fields;
      // explicitly project into JSON at this model-only boundary.
      expect(JSON.stringify(result)).not.toContain("getToolContext");
      if (addon === "code-review") {
        expect(result.details).toEqual([]); expect(checks).toBeGreaterThan(0);
        const before = local.run({ jid, owner: true }, () => reviews!.reviewService().database.all("SELECT * FROM request_receipts"));
        await expect(invoke({ action: "reply", threadId: "synthetic-missing", body: "must not publish", requestId: "foreign" }, { jid: "web:synthetic-foreign", owner: true })).rejects.toThrow("Host tool authority unavailable");
        const after = local.run({ jid, owner: true }, () => reviews!.reviewService().database.all("SELECT * FROM request_receipts"));
        expect(after).toEqual(before);
        await expect(invoke({ action: "dispatch", dispatchId: "synthetic-missing" })).rejects.toThrow("Host tool execution failed");
      } else {
        expect(result.details).toMatchObject({ config: { enabled: false }, transport: { active: false } });
        const service = local.run({ jid, owner: true }, () => peers!.getPeerService());
        expect(service.state.peers()).toEqual([]); expect(service.discovery).toBeNull();
        const deniedResult = await invoke({ action: "session_advertise", agent: "fixture", session_alias: "test", chat_jid: jid, incarnation: "fixture-incarnation" });
        expect(deniedResult.isError).toBe(true);
        expect(service.state.db.query("SELECT * FROM advertised_sessions").all()).toEqual([]);
      }
      await expect(invoke({ action: action! }, { jid, owner: false })).rejects.toThrow("Host tool authority unavailable");
      tools.push(createHostTool(definition, { authority: { check() { if (!owner) denied(); } }, effectFence: "host-effect-port",
        invoke(args, call) {
          invocations++;
          return local.run({ jid, owner: true }, async () => {
            call.assertAllowed(); check();
            const result = await call.execute(call.toolCallId, args, call.signal, call.onUpdate, { cwd: dir } as ExtensionToolContext);
            call.assertAllowed(); check();
            return JSON.parse(JSON.stringify(result));
          });
        } }));
    }
    expect(transportRegistrations).toBe(1);
    const data = () => local.run({ jid, owner: true }, () => ({
      reviews: reviews!.reviewService().database.all("SELECT * FROM request_receipts"),
      peers: peers!.getPeerService().state.db.query("SELECT * FROM advertised_sessions").all(),
    }));
    await actualAddonGraph(dir, tools, () => invocations, () => { owner = false; }, data);
    expect(local.getStore()).toBeUndefined();
  } finally {
    await peers?.closePeerService(); reviews?.closeReviewServices();
    expect(transportRegistrations).toBe(0);
    keys.forEach((key, i) => { const descriptor = descriptors[i]; if (descriptor) Object.defineProperty(globals, key, descriptor); else delete globals[key]; });
    rmSync(dir, { recursive: true, force: true });
    rmSync(copy, { recursive: true, force: true });
  }
});
