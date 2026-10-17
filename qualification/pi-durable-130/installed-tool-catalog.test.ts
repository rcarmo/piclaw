import { expect, test } from "bun:test";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { extensionKvGet } from "../../runtime/src/db/extension-kv.js";
import { registerRootExtensionKvStore } from "../../runtime/src/db/register-extension-kv.js";
import { getExtensionKvStore, withExtensionKvAuthority, requireExtensionKvAuthority, resetExtensionKvStoreForTests } from "../../runtime/src/extension-kv-registry.js";
import { createPlanKvAuthority, createHostPlanTool } from "../../runtime/durable-engine/src/host-plan-tool.js";
import { BACKGROUND_CONTEXT as context } from "../../runtime/durable-engine/qualification/context.ts";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { at, effect, sealed, value } from "./src/host-handoff.js";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync, symlinkSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { SettingsManager } from "../../node_modules/@earendil-works/pi-coding-agent";
import { loadApplicationExtensionCatalog, qualifyInstalledPlan, assertApplicationExtensionCatalogSupported } from "../../runtime/durable-engine/src/host-extension-catalog.ts";

const root = process.env.DURABLE_ADDONS_ROOT;
if (!root) throw Error("DURABLE_ADDONS_ROOT required: pinned Plan 0.1.25 sources, never live packages");
const pins = {
  "index.ts": "b923bff190da94777aaf849667f7a8833be0fae04b76dc3748337552ae642dc8",
  "compat/chat-context.ts": "8cfa6c16f0a27308ecc665f80ba107064d4fa8ac34122676ff0d1cb46e719da5",
  "compat/extension-kv.ts": "04240517e9e8664cae2d2badb99f382100a7af3e12679cfce97087870881551c",
};

test("installed pinned Plan executes the public registry definition against root extension_kv; default still blocks missing operation binding", async () => {
  // Keep resolution inside this disposable qualification tree, never external
  // node_modules. Real packages and real public registerTool, no API capture.
  const dir = mkdtempSync(join(import.meta.dir, ".qualification-addons-"));
  const globals = globalThis as unknown as Record<string, unknown>;
  const keys = ["__piclaw_planSidebarApi", "__piclaw_registerAddonConfigApi", "__piclawRuntimeInterop", "__PICLAW_BROADCAST_EVENT__"];
  const saved = keys.map(key => Object.getOwnPropertyDescriptor(globals, key));
  let catalog: Awaited<ReturnType<typeof loadApplicationExtensionCatalog>> | undefined;
  const savedDbMode = process.env.PICLAW_DB_IN_MEMORY;
  process.env.PICLAW_DB_IN_MEMORY = "0";
  initDatabase();
  const db = getDb();
  let active = true;
  const controller = new AbortController();
  const chatJid = "web:installed-plan-qualification";
  installTerminalSettlementCompositionSchema(db);
  const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {} }));
  const source = value(await work.acceptSource(sealed({ effect: effect("plan:accept"), chatJid, sourceId: "plan:source", kind: "message" as const,
    payloadRef: "plan:payload", targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  const claimed = value(await work.claimNext(sealed({ effect: effect("plan:claim"), chatJid, expectedFrontier: 0, newOperationId: "plan:operation", claimedAt: at })))!;
  const operation = value(await work.bindHarness(sealed({ effect: effect("plan:bind", claimed.operation.operationId, source.sourceSeq),
    expectedVersion: claimed.operation.version, sessionId: "plan:session", lane: "main", harnessOperationId: "42", state: "running" as const, watchGeneration: 1 })));
  // Committed root evidence; this fixture does not claim public run-capture proof.
  const captured = { operation, inputs: [{ incarnation: "plan:copy", conversationId: 2 as never,
    chatJid, branchId: "main", operationId: operation.operationId, sourceSeq: source.sourceSeq, sourceId: source.sourceId,
    payloadRef: source.payloadRef, requestId: "plan:request", requestHash: "a".repeat(64), submissionId: 42 as never }] };
  const assertOwner = () => {
    controller.signal.throwIfAborted(); if (!active) throw Error("Owner revoked");
  };
  const authority = createPlanKvAuthority(db, captured, assertOwner);
  try {
    const pkg = join(dir, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-plan-sidebar");
    mkdirSync(join(pkg, "compat"), { recursive: true });
    for (const [file, hash] of Object.entries(pins)) {
      const source = resolve(root!, "addons/plan-sidebar", file);
      expect(createHash("sha256").update(await Bun.file(source).bytes()).digest("hex")).toBe(hash);
      copyFileSync(source, join(pkg, file));
    }
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@rcarmo/piclaw-addon-plan-sidebar", version: "0.1.25", type: "module", pi: { extensions: ["./index.ts"] } }));
    const agentDir = join(dir, "agent"); mkdirSync(agentDir);
    delete globals.__piclaw_registerAddonConfigApi;
    delete globals.__PICLAW_BROADCAST_EVENT__;
    registerRootExtensionKvStore();
    requireExtensionKvAuthority();
    const cached = getExtensionKvStore();
    catalog = await loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() });
    expect(catalog.errors).toEqual([]);
    const definitions = catalog.extensions.flatMap(extension => [...extension.tools.values()].map(tool => tool.definition));
    expect(definitions.map(tool => tool.name).sort()).toEqual(["plan"]);
    expect(definitions.every(tool => typeof tool.execute === "function")).toBe(true);
    expect(() => assertApplicationExtensionCatalogSupported(catalog!)).toThrow("plan: no operation-owned host effect port");
    expect(() => assertApplicationExtensionCatalogSupported(catalog!)).toThrow("before_agent_start lifecycle not bound");
    expect(() => catalog!.runtime.createContext()).toThrow();
    // Select the loader's existing registration; never invoke the factory again
    // or fabricate ExtensionAPI/ExtensionContext/SessionManager.
    const extension = catalog.extensions[0]!;
    expect(resolve(extension.resolvedPath)).toBe(resolve(pkg, "index.ts"));
    const registered = [...extension.tools.values()][0]!;
    const definition = registered.definition;
    // Tool-name spoofing is not package provenance. Only a canonical declared
    // installed entry with the actual public exports can qualify.
    const qualified = await qualifyInstalledPlan(catalog, dir);
    expect(qualified?.extension).toBe(extension);
    expect(qualified?.definition).toBe(definition);
    expect(() => assertApplicationExtensionCatalogSupported(catalog!, qualified)).not.toThrow();
    const prompt = withExtensionKvAuthority(authority, () => {
      const state = qualified!.addon.loadSessionPlan(chatJid);
      return { system: qualified!.addon.buildPlanSystemPrompt(state), message: qualified!.addon.buildPlanTurnMessage(state) };
    });
    expect(prompt.system).toContain("## Plan Sidebar");
    expect(prompt.message).toMatchObject({ customType: "plan_sidebar_context", display: false });
    // Restoring an untrusted declaration revokes qualification even though the
    // registered tool and exported builders are unchanged.
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@qualification/plan", version: "0.1.25", type: "module", pi: { extensions: ["./index.ts"] } }));
    expect(await qualifyInstalledPlan(catalog, dir)).toBeUndefined();
    expect(() => qualified!.assertCurrent()).toThrow("Installed Plan source changed");
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@rcarmo/piclaw-addon-plan-sidebar", version: "0.1.25", type: "module", pi: { extensions: ["./index.ts"] } }));
    qualified!.assertCurrent();
    for (const file of Object.keys(pins)) {
      const path = join(pkg, file);
      const bytes = await Bun.file(path).bytes();
      writeFileSync(path, Buffer.concat([bytes, Buffer.from("\n// changed after evaluation\n")]));
      expect(() => qualified!.assertCurrent()).toThrow("Installed Plan source changed");
      expect(await qualifyInstalledPlan(catalog, dir)).toBeUndefined();
      writeFileSync(path, bytes);
    }
    const registeredExecute = definition.execute;
    definition.execute = async () => ({ content: [], details: undefined });
    expect(() => qualified!.assertCurrent()).toThrow("Unqualified Plan capabilities");
    await expect(qualifyInstalledPlan(catalog, dir)).rejects.toThrow("Unqualified Plan capabilities");
    definition.execute = registeredExecute;
    qualified!.assertCurrent();
    expect(Object.isFrozen(qualified)).toBe(true);
    // Exercise the production effect port, with an explicitly fixture-owned
    // capture. This is not a claim that default startup has a lifecycle port.
    let captures = 0;
    let duringCapture = () => {};
    // The hash-pinned Plan result is JSON; the generic Pi catalog deliberately
    // erases its details type. No argument/input narrowing is delegated to this.
    const port = createHostPlanTool(definition as Parameters<typeof createHostPlanTool>[0], { root: db, assertOwner,
      runtime: () => ({ async captureToolSource(conversationId, taskId, callId) {
        captures++;
        expect(Number(conversationId)).toBe(2); expect(Number(taskId)).toBe(99); expect(callId).toBe("production-plan-port");
        await Promise.resolve(); duringCapture(); return captured;
      } }),
    });
    const api = { conversationId: 2, taskId: 99, callId: "production-plan-port", output() {}, async details() {} } as unknown as Parameters<typeof port.execute>[1];
    for (const invalid of [null, [], "plan", 7, new Date()]) {
      await expect(port.execute(invalid, api, context)).rejects.toThrow("Host tool execution failed");
    }
    expect(captures).toBe(0);
    const mutable = { action: "write", markdown: "PORT_CLONED_BEFORE_AWAIT" };
    duringCapture = () => { mutable.markdown = "MUTATED_CALLER_INPUT"; };
    await port.execute(mutable, api, context);
    expect(extensionKvGet("plan-sidebar", "plan", "chat", chatJid)).toMatchObject({ markdown: "PORT_CLONED_BEFORE_AWAIT" });
    duringCapture = () => {};
    await expect(port.execute({ action: "write", chat_jid: "web:other", markdown: "DENIED" }, api, context)).rejects.toThrow("Host tool execution failed");
    duringCapture = () => { active = false; };
    await expect(port.execute({ action: "write", markdown: "REVOKED_DURING_CAPTURE" }, api, context)).rejects.toThrow();
    active = true; duringCapture = () => {};
    expect(extensionKvGet("plan-sidebar", "plan", "chat", chatJid)).toMatchObject({ markdown: "PORT_CLONED_BEFORE_AWAIT" });
    const execute = (args: Record<string, unknown>) => withExtensionKvAuthority(authority, () => definition.execute("installed-plan-port", args as never,
      controller.signal, undefined, undefined as never));
    expect(getExtensionKvStore()).toBe(cached);
    expect(() => cached.get("plan-sidebar", "plan", "chat", chatJid)).toThrow("authority required");
    const written = await execute({ action: "update", chat_jid: chatJid, plan: [{ step: "REAL_REGISTERED_PLAN", status: "in_progress" }] });
    expect(written.content).toEqual([{ type: "text", text: "Plan updated." }]);
    expect(extensionKvGet("plan-sidebar", "plan", "chat", chatJid)).toMatchObject({ markdown: "- [-] REAL_REGISTERED_PLAN" });
    const read = await execute({ action: "read", chat_jid: chatJid });
    expect(read.details).toMatchObject({ markdown: "- [-] REAL_REGISTERED_PLAN" });
    expect(db.query("SELECT COUNT(*) AS count FROM extension_kv WHERE extension_id='plan-sidebar' AND scope_key=?").get(chatJid)).toEqual({ count: 1 });
    await expect(execute({ action: "write", chat_jid: "web:other", markdown: "FORBIDDEN" })).rejects.toThrow("Extension KV scope denied");
    // Revoke after an await and before the actual SQLite sink. There is no
    // production claim that this fixture boolean is committed host ownership.
    await Promise.resolve(); active = false;
    await expect(execute({ action: "write", chat_jid: chatJid, markdown: "FORBIDDEN" })).rejects.toThrow("Owner revoked");
    active = true;
    await Promise.resolve();
    db.query("UPDATE service_effect_s01_operations SET version=version+1 WHERE operation_id=?").run(operation.operationId);
    await expect(execute({ action: "write", chat_jid: chatJid, markdown: "STALE_VERSION" })).rejects.toThrow("Stale Plan operation authority");
    db.query("UPDATE service_effect_s01_operations SET version=? WHERE operation_id=?").run(operation.version, operation.operationId);
    db.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(operation.operationId);
    await expect(execute({ action: "write", chat_jid: chatJid, markdown: "CANCELLED" })).rejects.toThrow("Stale Plan operation authority");
    db.query("UPDATE service_effect_s01_operations SET phase='executing' WHERE operation_id=?").run(operation.operationId);
    await expect(withExtensionKvAuthority(authority, async () => cached.set("plan-sidebar", "rollback", {
      toJSON() { active = false; return "FORBIDDEN"; },
    }, "chat", chatJid))).rejects.toThrow("Owner revoked");
    expect(extensionKvGet("plan-sidebar", "rollback", "chat", chatJid)).toBeNull();
    active = true; controller.abort();
    await expect(execute({ action: "write", chat_jid: chatJid, markdown: "FORBIDDEN" })).rejects.toThrow();
    expect(extensionKvGet("plan-sidebar", "plan", "chat", chatJid)).toMatchObject({ markdown: "- [-] REAL_REGISTERED_PLAN" });
    expect(await Bun.file(join(dir, "agent/sessions")).exists()).toBe(false);
  } finally {
    catalog?.runtime.invalidate("qualification complete");
    resetExtensionKvStoreForTests();
    closeDatabase();
    if (savedDbMode === undefined) delete process.env.PICLAW_DB_IN_MEMORY;
    else process.env.PICLAW_DB_IN_MEMORY = savedDbMode;
    keys.forEach((key, i) => { if (saved[i]) Object.defineProperty(globals, key, saved[i]!); else delete globals[key]; });
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const scenario of ["renamed-after-load", "wrong-path", "unsupported-version", "unsupported-code", "shadowed-helper", "changed-during-load", "symlink-escape", "symlink-package", "replaced-extension"] as const) test(`Plan loaded provenance rejects ${scenario}`, async () => {
  const dir = mkdtempSync(join(import.meta.dir, ".qualification-addons-"));
  const canonicalName = "@rcarmo/piclaw-addon-plan-sidebar";
  const pkg = join(dir, ".pi/extensions/node_modules", scenario === "wrong-path" ? "@qualification/plan" : canonicalName);
  const globals = globalThis as unknown as Record<string, unknown>;
  const keys = ["__piclaw_planSidebarApi", "__piclaw_registerAddonConfigApi", "__piclawRuntimeInterop", "__PICLAW_BROADCAST_EVENT__"];
  const saved = keys.map(key => Object.getOwnPropertyDescriptor(globals, key));
  let catalog: Awaited<ReturnType<typeof loadApplicationExtensionCatalog>> | undefined;
  try {
    mkdirSync(join(pkg, "compat"), { recursive: true });
    for (const file of Object.keys(pins)) copyFileSync(resolve(root!, "addons/plan-sidebar", file), join(pkg, file));
    const manifest = { name: scenario === "renamed-after-load" ? "@qualification/plan" : canonicalName,
      version: scenario === "unsupported-version" ? "0.1.26" : "0.1.25", type: "module", pi: { extensions: ["./index.ts"] } };
    writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest));
    if (scenario === "unsupported-code") writeFileSync(join(pkg, "compat/chat-context.ts"), `${await Bun.file(join(pkg, "compat/chat-context.ts")).text()}\n// unsupported executable input\n`);
    if (scenario === "shadowed-helper") writeFileSync(join(pkg, "compat/chat-context.js"), 'export function getChatJid() { return "web:spoofed"; }');
    if (scenario === "symlink-package") {
      const moved = join(dir, "external-package");
      renameSync(pkg, moved);
      symlinkSync(moved, pkg);
    }
    if (scenario === "symlink-escape") {
      const escaped = join(dir, "escaped.ts");
      copyFileSync(join(pkg, "compat/chat-context.ts"), escaped);
      rmSync(join(pkg, "compat/chat-context.ts"));
      symlinkSync(escaped, join(pkg, "compat/chat-context.ts"));
    }
    if (scenario === "changed-during-load") {
      const mutator = join(dir, ".pi/extensions/node_modules/aaa-mutator"); mkdirSync(mutator, { recursive: true });
      writeFileSync(join(mutator, "package.json"), JSON.stringify({ name: "aaa-mutator", type: "module", pi: { extensions: ["index.ts"] } }));
      writeFileSync(join(mutator, "index.ts"), `import { writeFileSync } from "node:fs"; export default function () { writeFileSync(${JSON.stringify(join(pkg, "package.json"))}, ${JSON.stringify(JSON.stringify({ ...manifest, description: "changed while loading" }))}); }`);
    }
    const agentDir = join(dir, "agent"); mkdirSync(agentDir);
    delete globals.__piclaw_registerAddonConfigApi;
    delete globals.__PICLAW_BROADCAST_EVENT__;
    catalog = await loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() });
    expect(catalog.errors).toEqual([]);
    if (scenario === "renamed-after-load") writeFileSync(join(pkg, "package.json"), JSON.stringify({ ...manifest, name: canonicalName }));
    if (scenario === "replaced-extension") {
      const qualified = await qualifyInstalledPlan(catalog, dir);
      expect(qualified).toBeDefined();
      catalog.extensions[0] = { ...catalog.extensions[0]! };
      expect(() => qualified!.assertCurrent()).toThrow("Installed Plan source changed");
    }
    expect(await qualifyInstalledPlan(catalog, dir)).toBeUndefined();
    expect(() => assertApplicationExtensionCatalogSupported(catalog!)).toThrow("no operation-owned host effect port");
    if (scenario === "changed-during-load") {
      writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest));
      await expect(loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() })).rejects.toThrow("process restart required");
    }
  } finally {
    catalog?.runtime.invalidate();
    keys.forEach((key, i) => { if (saved[i]) Object.defineProperty(globals, key, saved[i]!); else delete globals[key]; });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("same-path same-CWD unsupported Plan cache cannot qualify restored approved source", async () => {
  const dir = mkdtempSync(join(import.meta.dir, ".qualification-addons-"));
  const pkg = join(dir, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-plan-sidebar");
  const agentDir = join(dir, "agent");
  let catalog: Awaited<ReturnType<typeof loadApplicationExtensionCatalog>> | undefined;
  try {
    mkdirSync(join(pkg, "compat"), { recursive: true }); mkdirSync(agentDir);
    for (const file of Object.keys(pins)) copyFileSync(resolve(root!, "addons/plan-sidebar", file), join(pkg, file));
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@rcarmo/piclaw-addon-plan-sidebar", version: "0.1.25", type: "module", pi: { extensions: ["./index.ts"] } }));
    const marker = join(dir, "factory-executions");
    writeFileSync(join(pkg, "index.ts"), `import { appendFileSync } from "node:fs";
      export default function (pi) {
        appendFileSync(${JSON.stringify(marker)}, "BAD\\n");
        pi.registerTool({ name: "plan", label: "plan", description: "unsupported", parameters: { type: "object", properties: {} },
          async execute() { return { content: [{ type: "text", text: "BAD" }], details: {} }; } });
      }`);
    const options = { cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() };
    catalog = await loadApplicationExtensionCatalog(options);
    expect(catalog.errors).toEqual([]);
    const definition = catalog.extensions[0]!.tools.get("plan")!.definition;
    expect((await definition.execute("marker", {} as never, undefined, undefined, undefined as never)).content).toEqual([{ type: "text", text: "BAD" }]);
    expect(await qualifyInstalledPlan(catalog, dir)).toBeUndefined();
    expect(() => assertApplicationExtensionCatalogSupported(catalog!)).toThrow("no operation-owned host effect port");
    copyFileSync(resolve(root!, "addons/plan-sidebar/index.ts"), join(pkg, "index.ts"));
    expect(createHash("sha256").update(await Bun.file(join(pkg, "index.ts")).bytes()).digest("hex")).toBe(pins["index.ts"]);
    // A fresh application loader at exactly the same path/CWD must not attach
    // the new hash snapshot to BAD's process-cached registration or run it again.
    await expect(loadApplicationExtensionCatalog({ ...options, settingsManager: SettingsManager.inMemory() })).rejects.toThrow("process restart required");
    expect(await qualifyInstalledPlan(catalog, dir)).toBeUndefined();
    expect(await Bun.file(marker).text()).toBe("BAD\n");
  } finally { catalog?.runtime.invalidate(); rmSync(dir, { recursive: true, force: true }); }
});

test("empty public application registry passes; actual factory load failure is not silently omitted", async () => {
  const dir = mkdtempSync(join(import.meta.dir, ".qualification-addons-"));
  const agentDir = join(dir, "agent"); mkdirSync(agentDir);
  let catalog: Awaited<ReturnType<typeof loadApplicationExtensionCatalog>> | undefined;
  try {
    catalog = await loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() });
    expect(() => assertApplicationExtensionCatalogSupported(catalog!)).not.toThrow();
    catalog.runtime.invalidate();
    const pkg = join(dir, ".pi/extensions/node_modules/broken"); mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "broken", pi: { extensions: ["index.ts"] } }));
    writeFileSync(join(pkg, "index.ts"), 'export default function () { throw Error("PRIVATE_FACTORY_FAILURE"); }');
    catalog = await loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() });
    expect(catalog.errors).toHaveLength(1);
    expect(() => assertApplicationExtensionCatalogSupported(catalog!)).toThrow("extension load failed");
    expect(() => assertApplicationExtensionCatalogSupported(catalog!)).not.toThrow("PRIVATE_FACTORY_FAILURE");
  } finally { catalog?.runtime.invalidate(); rmSync(dir, { recursive: true, force: true }); }
});
