import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SettingsManager } from "../../node_modules/@earendil-works/pi-coding-agent";
import { loadApplicationExtensionCatalog, qualifyInstalledGoal, assertApplicationExtensionCatalogSupported } from "../../runtime/durable-engine/src/host-extension-catalog.ts";
import { installGoalFixture } from "./goal-fixture.ts";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { registerRootExtensionKvStore } from "../../runtime/src/db/register-extension-kv.js";
import { extensionKvGet } from "../../runtime/src/db/extension-kv.js";
import { withExtensionKvAuthority, requireExtensionKvAuthority, resetExtensionKvStoreForTests } from "../../runtime/src/extension-kv-registry.js";

for (const mode of ["approved", "tamper", "shadow", "execute", "command", "command-handler", "event", "extra-tool"] as const) test(`actual installed Goal source qualification remains startup denied: ${mode}`, async () => {
  const dir = mkdtempSync(join(import.meta.dir, ".qualification-goal-"));
  const pkg = installGoalFixture(dir);
  const agentDir = join(dir, "agent"); mkdirSync(agentDir);
  let catalog: Awaited<ReturnType<typeof loadApplicationExtensionCatalog>> | undefined;
  try {
    if (mode === "tamper") writeFileSync(join(pkg, "index.ts"), readFileSync(join(pkg, "index.ts"), "utf8") + "\n// changed\n");
    if (mode === "shadow") writeFileSync(join(pkg, "deadline-checkpoint.js"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(join(dir, "unqualified-module-io"))}, "BAD");
throw Error('unapproved shadow');\n`);
    if (mode === "tamper" || mode === "shadow") {
      await expect(loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() })).rejects.toThrow(/Unqualified installed (add-on package|extension source) before evaluation/);
      expect(await Bun.file(join(dir, "unqualified-module-io")).exists()).toBe(false);
      return;
    }
    catalog = await loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() });
    const qualified = await qualifyInstalledGoal(catalog, dir);
    expect(qualified).toBeDefined();
    expect(qualified!.extension.tools.size).toBe(5);
    expect(qualified!.extension.commands.size).toBe(1);
    expect(qualified!.extension.handlers.size).toBe(6);
    expect(typeof qualified!.addon.goalInputIdentity).toBe("function");
    expect(typeof qualified!.addon.accountGoalProgress).toBe("function");
    expect(typeof qualified!.addon.accountTerminalGoalProgress).toBe("function");
    expect(() => assertApplicationExtensionCatalogSupported(catalog!)).toThrow("no operation-owned host effect port");
    assertApplicationExtensionCatalogSupported(catalog!, undefined, undefined, undefined, undefined, undefined, undefined, qualified);
    const extension = qualified!.extension;
    if (mode === "execute") extension.tools.get("goal_stop")!.definition.execute = async () => { throw Error("substituted"); };
    if (mode === "command") extension.commands.delete("goal");
    if (mode === "command-handler") extension.commands.get("goal")!.handler = async () => undefined;
    if (mode === "event") extension.handlers.get("agent_end")!.push(() => undefined);
    if (mode === "extra-tool") extension.tools.set("foreign", extension.tools.get("get_goal")!);
    if (mode !== "approved") expect(() => qualified!.assertCurrent()).toThrow("capabilities");
    else {
      qualified!.assertCurrent();
      initDatabase(); registerRootExtensionKvStore(); requireExtensionKvAuthority();
      try {
        const db = getDb(), chatJid = "web:installed-goal-factory";
        const tools = qualified!.addon.createGoalTools(() => chatJid) as { name: string; execute(...args: unknown[]): Promise<unknown> }[];
        const scoped = <T>(body: () => T) => withExtensionKvAuthority({ extensionId: "goal", chatJid, assertCurrent() { qualified!.assertCurrent(); },
          write<T>(body: () => T) { return db.transaction(body).immediate(); } }, body);
        const invoke = (name: string, args: unknown) => scoped(() => tools.find(tool => tool.name === name)!.execute("installed-factory", args, undefined, undefined, {}));
        await invoke("create_goal", { objective: "Exact installed native factory" });
        expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toMatchObject({ objective: "Exact installed native factory", status: "active" });
        await invoke("goal_stop", { reason: "other", summary: "Factory qualified" });
        expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toMatchObject({ status: "stopped", stop_summary: "Factory qualified" });
        expect(() => assertApplicationExtensionCatalogSupported(catalog!)).toThrow("no operation-owned host effect port");
      } finally { resetExtensionKvStoreForTests(); await closeDatabase(); }
      writeFileSync(join(pkg, "compat/chat-context.ts"), "// replaced\n");
      expect(() => qualified!.assertCurrent()).toThrow("Installed Goal source changed");
    }
  } finally { catalog?.runtime.invalidate("fixture ended"); rmSync(dir, { recursive: true, force: true }); }
});
