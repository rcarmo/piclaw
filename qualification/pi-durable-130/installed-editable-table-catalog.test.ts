import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { SettingsManager } from "../../node_modules/@earendil-works/pi-coding-agent";
import { loadApplicationExtensionCatalog, qualifyInstalledEditableTable, assertApplicationExtensionCatalogSupported } from "../../runtime/durable-engine/src/host-extension-catalog.ts";
import { installEditableTableFixture } from "./editable-table-fixture.ts";

// Unique canonical paths isolate process-wide SDK factory provenance. Reloads
// within a case intentionally retain exactly the same path and module cache.
for (const mode of ["approved", "version", "dirty-helper", "shadow-tool-js", "handler", "execute", "schema", "source-after-load", "restore-poison-cache", "type", "metadata", "layout", "symlink-outside"] as const) {
  test(`actual installed editable_table native qualification: ${mode}`, async () => {
    const dir = mkdtempSync(join(import.meta.dir, ".qualification-editable-table-"));
    const pkg = installEditableTableFixture(dir);
    const agentDir = join(dir, "agent"); mkdirSync(agentDir);
    const helper = join(pkg, "shared.ts");
    const original = readFileSync(helper, "utf8");
    const load = () => loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() });
    let catalog: Awaited<ReturnType<typeof load>> | undefined;
    try {
      if (["version", "type", "metadata", "layout"].includes(mode)) {
        const path = join(pkg, "package.json");
        const manifest = JSON.parse(readFileSync(path, "utf8"));
        if (mode === "version") manifest.version = "0.1.5";
        if (mode === "type") manifest.type = "commonjs";
        if (mode === "metadata") manifest.description += " unapproved";
        if (mode === "layout") { renameSync(join(pkg, "index.ts"), join(pkg, "alternate.ts")); manifest.pi.extensions = ["./alternate.ts"]; }
        writeFileSync(path, JSON.stringify(manifest));
      }
      if (mode === "dirty-helper" || mode === "restore-poison-cache") writeFileSync(helper, original + "\n// unapproved before evaluation\n");
      if (mode === "shadow-tool-js") writeFileSync(join(pkg, "tool.js"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(join(dir, "unqualified-module-io"))}, "BAD");
export function createEditableTableTool() { return { name: 'editable_table' }; }\n`);
      if (mode === "symlink-outside") {
        const outside = join(dir, "outside-shared.ts"); writeFileSync(outside, original); rmSync(helper); symlinkSync(outside, helper);
      }
      if (["version", "dirty-helper", "shadow-tool-js", "restore-poison-cache", "type", "metadata", "layout", "symlink-outside"].includes(mode)) {
        await expect(load()).rejects.toThrow(/Unqualified installed (add-on package|extension source) before evaluation/);
      expect(await Bun.file(join(dir, "unqualified-module-io")).exists()).toBe(false);
        if (mode === "restore-poison-cache") {
          writeFileSync(helper, original);
          await expect(load()).rejects.toThrow("loader cache provenance changed; process restart required");
        }
        return;
      }
      catalog = await load();
      const qualified = await qualifyInstalledEditableTable(catalog, dir);
      expect(qualified).toBeDefined();
      expect(qualified!.extension.handlers.size).toBe(1);
      expect(qualified!.extension.handlers.has("resources_discover")).toBe(true);
      expect(() => assertApplicationExtensionCatalogSupported(catalog!)).toThrow("editable_table: no operation-owned host effect port");
      assertApplicationExtensionCatalogSupported(catalog, undefined, qualified);
      const factory = qualified!.addon.createEditableTableTool;
      expect(typeof factory).toBe("function");
      const unavailable = factory({ available: false, publishWidget() { throw Error("must not publish"); } });
      const result = await unavailable.execute("no-context", { markdown: "a | b\n--- | ---\n1 | 2" }, undefined, undefined, undefined as never);
      expect(result.details).toMatchObject({ ok: false, reason: "no_ui" });
      if (mode === "handler") qualified!.extension.handlers.set("resources_discover", [async () => {}]);
      if (mode === "execute") qualified!.definition.execute = async () => { throw Error("must not run"); };
      if (mode === "schema") qualified!.definition.parameters = { ...qualified!.definition.parameters, description: "changed static schema" };
      if (mode === "source-after-load") writeFileSync(join(pkg, "tool.ts"), readFileSync(join(pkg, "tool.ts"), "utf8") + "\n// changed after capture\n");
      if (mode === "approved") { qualified!.assertCurrent(); const again = await load(); try { expect(await qualifyInstalledEditableTable(again, dir)).toBeDefined(); } finally { again.runtime.invalidate("fixture ended"); } }
      else {
        expect(() => qualified!.assertCurrent()).toThrow(mode === "source-after-load" ? "source changed" : "capabilities");
        expect(() => assertApplicationExtensionCatalogSupported(catalog!, undefined, qualified)).toThrow();
      }
    } finally { catalog?.runtime.invalidate("fixture ended"); rmSync(dir, { recursive: true, force: true }); }
  });
}
