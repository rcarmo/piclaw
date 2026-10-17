import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { SettingsManager } from "../../node_modules/@earendil-works/pi-coding-agent";
import { loadApplicationExtensionCatalog, qualifyInstalledDelegate, assertApplicationExtensionCatalogSupported } from "../../runtime/durable-engine/src/host-extension-catalog.ts";

for (const mode of ["approved", "shadow", "dirty", "version", "handler", "execute", "schema"] as const) {
  test(`actual installed Delegate native qualification: ${mode}`, async () => {
    const source = process.env.DURABLE_ADDONS_ROOT;
    if (!source) throw Error("DURABLE_ADDONS_ROOT required at de92bc9");
    const dir = mkdtempSync(join(import.meta.dir, ".qualification-delegate-"));
    const pkg = join(dir, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-delegate");
    const agentDir = join(dir, "agent");
    mkdirSync(join(pkg, "compat"), { recursive: true }); mkdirSync(agentDir);
    const hash = createHash("sha256");
    for (const file of ["index", "delegate", "compat/extension-kv"]) {
      const bytes = readFileSync(join(source, "addons/delegate", `${file}.ts`));
      hash.update(file + "\0"); hash.update(bytes);
      writeFileSync(join(pkg, `${file}.ts`), bytes);
    }
    expect(hash.digest("hex")).toBe("d76c40e6887526ef9d1b19193b617fb25302b8bebbe5b98632b1bb0eea46d584");
    copyFileSync(join(source, "addons/delegate/package.json"), join(pkg, "package.json"));
    if (mode === "shadow") writeFileSync(join(pkg, "delegate.js"), "export default function() {}\n");
    if (mode === "dirty") writeFileSync(join(pkg, "delegate.ts"), readFileSync(join(pkg, "delegate.ts"), "utf8") + "\n// unapproved\n");
    if (mode === "version") {
      const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
      manifest.version = "0.2.21"; writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest));
    }
    let catalog: Awaited<ReturnType<typeof loadApplicationExtensionCatalog>> | undefined;
    try {
      catalog = await loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() });
      const qualified = await qualifyInstalledDelegate(catalog, dir);
      if (["shadow", "dirty", "version"].includes(mode)) { expect(qualified).toBeUndefined(); return; }
      expect(qualified).toBeDefined();
      expect(qualified!.definition.parameters).toHaveProperty("properties.task_category");
      expect(qualified!.nativeLifecycle.events).toEqual(["session_start", "model_select", "before_agent_start"]);
      expect(() => assertApplicationExtensionCatalogSupported(catalog!)).toThrow("delegate: no operation-owned host effect port");
      assertApplicationExtensionCatalogSupported(catalog, undefined, qualified);
      if (mode === "handler") qualified!.extension.handlers.set("session_start", [async () => {}]);
      if (mode === "execute") qualified!.definition.execute = async () => { throw Error("must not run"); };
      if (mode === "schema") qualified!.definition.description += " changed";
      if (mode === "approved") qualified!.assertCurrent();
      else expect(() => qualified!.assertCurrent()).toThrow("Unqualified Delegate capabilities");
    } finally { catalog?.runtime.invalidate("fixture ended"); rmSync(dir, { recursive: true, force: true }); }
  });
}
