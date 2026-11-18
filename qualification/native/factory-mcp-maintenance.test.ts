import './src/test-guard.js';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import { getConfigPath } from "../../runtime/src/core/config-context.js";
import { expect } from "bun:test";
import { createTestCredentialStore } from "../../runtime/test/model-services-fixture.js";
import type { Model } from "../../node_modules/@earendil-works/pi-ai";
import { ModelRuntime, ModelRegistry } from "../../node_modules/@earendil-works/pi-coding-agent";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { storeChatMetadata, storeMessage } from "../../runtime/src/db.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import type { RuntimeModelServices } from "../../runtime/src/agent-pool/model-services.js";
import { Harness, AgentDoc, createRegistry } from "../../runtime/durable-engine/qualification/durable.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BACKGROUND_CONTEXT as context } from "../../runtime/durable-engine/qualification/context.ts";
import { createHostModels } from "../../runtime/durable-engine/src/host-models.js";
const applicationTest=isolatedApplicationTest(import.meta.url);
applicationTest("deferred MCP preserves explicit SDK restrictions and one-shot metadata across maintenance",async () => {
  process.env.PICLAW_DB_IN_MEMORY = "0"; initDatabase();
  const workspace = process.env.PICLAW_WORKSPACE!;
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "deferred-owner.lock"), strictOwnership: true, disabled: false });
  const model = { provider: "synthetic", id: "approved", name: "Approved", api: "openai-completions", baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model<"openai-completions">;
  const runtime = await ModelRuntime.create({ modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} }, credentials: createTestCredentialStore({ synthetic: { type: "api_key", key: "synthetic-only" } }), allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerNativeProvider({ id: model.provider, name: "Synthetic", getModels: () => [model], auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: { apiKey: "synthetic-only" }, source: "fixture" }) } }, stream: () => { throw Error("No generation"); }, streamSimple: () => { throw Error("No generation"); } });
  await runtime.refresh({ allowNetwork: false });
  const services = { modelRuntime: runtime, modelRegistry: new ModelRegistry(runtime) } as RuntimeModelServices;
  const root = getDb();
  const pid = join(workspace, "deferred-mcp-pid");
  mkdirSync(join(workspace, ".pi"), { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify({ domains: { mcp: { engine: "native", codemode: "on" } } }), { mode: 0o600 });
  writeFileSync(join(workspace, ".pi/mcp.json"), JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [join(import.meta.dir, "mcp-stdio-fixture.ts"), join(workspace, "deferred-calls"), pid] } } }));
  storeChatMetadata("web:default", new Date().toISOString());
  storeMessage({ id: "deferred-old-row", chat_jid: "web:default", sender: "user", sender_name: "User", content: "synthetic legacy content", timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false });
  writeFileSync(join(workspace, "AGENTS.md"), "DEFERRED_POLICY_ONE");
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  let explicitSelection:string[]|undefined;
  const inspect = async (selection?: string[]) => {
    if(selection!==undefined)explicitSelection=selection;
    const path = (root.query("PRAGMA database_list").all() as {name:string;file:string}[]).find(row => row.name === "main")!.file;
    const models = createHostModels(runtime, [model], { signal: new AbortController().signal, async authorize() {}, assertCurrent() { owner.assertCurrentOwner(); } });
    const harness = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => owner.assertCurrentOwner(), fenceTransactions: true })), { models, registry: createRegistry() }, context);
    try {
      const app = await harness.root(context);
      return await app.commit(async tx => {
        const ids=(root.query(`SELECT owner_id FROM documents WHERE kind='"pi.agent"' AND scope_kind='conversation' AND retired_at IS NULL`).all() as {owner_id:number}[]).map(row=>row.owner_id);
        for(const id of ids){const doc=await tx.doc(AgentDoc,id as typeof app.id);if(selection!==undefined)doc.tools=selection;if(explicitSelection!==undefined)expect(JSON.parse(JSON.stringify(doc.tools))).toEqual(explicitSelection);}
        const doc=await tx.doc(AgentDoc,app.id);return doc.tools===undefined?undefined:JSON.parse(JSON.stringify(doc.tools));
      }, context);
    } finally { await harness.close(context); }
  };
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => services, { offlineMaintenance: true });
    expect(existsSync(pid)).toBe(false);
    expect(() => backend!.bind({} as never)).toThrow("Offline maintenance");
    await backend.close(); backend = undefined;
    const factory = await inspect();
    expect(factory).toBeUndefined();
    writeFileSync(join(workspace, "AGENTS.md"), "DEFERRED_POLICY_TWO");
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    const deadline=Date.now()+5000;while(!existsSync(pid)&&Date.now()<deadline)await Bun.sleep(10);expect(existsSync(pid)).toBe(true);
    await backend.close(); backend = undefined;
    expect(JSON.stringify(root.query("SELECT content FROM document_revisions").all())).toContain("DEFERRED_POLICY_TWO");
    expect(await inspect()).toBeUndefined();
    for (const selection of [[], ["read"], ["bash"], ["mcp__fixture__echo"]]) {
      await inspect(selection);
      backend = await createDefaultApplicationRuntime(owner, async () => services, { offlineMaintenance: true });
      await backend.close(); backend = undefined;
      expect(await inspect()).toEqual(selection);
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      await backend.close(); backend = undefined;
      expect(await inspect()).toEqual(selection);
    }
    // SDK-owned explicit selections remain byte-for-byte across startup too.
    // The host must not recreate a competing tool-selection validator.
    await inspect(["mcp_x"]);
    backend = await createDefaultApplicationRuntime(owner, async () => services, { offlineMaintenance: true });
    await backend.close(); backend = undefined;
    expect(await inspect()).toEqual(["mcp_x"]);
    backend=await createDefaultApplicationRuntime(owner,async()=>services);
    await backend.close();backend=undefined;
    expect(await inspect()).toEqual(['mcp_x']);
    // A future live-document format must fail before recovery/configuration;
    // accepting current SDK versions must not turn this preflight permissive.
    const revision = root.query(`SELECT r.document_id,r.seq,r.version FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.kind='"pi.live"' ORDER BY r.seq DESC LIMIT 1`).get() as {document_id:number;seq:number;version:number};
    expect(revision).toBeDefined();
    writeFileSync(join(workspace, "AGENTS.md"), "DEFERRED_POLICY_THREE");
    root.query('UPDATE document_revisions SET version=99 WHERE document_id=? AND seq=?').run(revision.document_id,revision.seq);
    try { await expect(createDefaultApplicationRuntime(owner,async()=>services)).rejects.toThrow('Invalid persisted document version'); }
    finally { root.query('UPDATE document_revisions SET version=? WHERE document_id=? AND seq=?').run(revision.version,revision.document_id,revision.seq); }
    const receipt=root.query("SELECT value FROM router_state WHERE key='native.mcp-config-import.v1'").get();
    writeFileSync(join(workspace, ".pi/mcp.json"), JSON.stringify({mcpServers:{fixture:{url:"https://invalid.invalid/mcp",unsupportedRestriction:true}}}));
    backend=await createDefaultApplicationRuntime(owner,async()=>services,{offlineMaintenance:true});await backend.close();backend=undefined;
    expect(root.query("SELECT value FROM router_state WHERE key='native.mcp-config-import.v1'").get()).toEqual(receipt);
  } finally { await backend?.close(); owner.release(); await closeDatabase(); }
},30000);
