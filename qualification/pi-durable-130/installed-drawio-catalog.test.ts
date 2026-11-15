import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SettingsManager } from "../../node_modules/@earendil-works/pi-coding-agent";
import { loadApplicationExtensionCatalog, qualifyInstalledDrawio, assertApplicationExtensionCatalogSupported } from "../../runtime/durable-engine/src/host-extension-catalog.ts";
import { installDrawioFixture } from "./drawio-fixture.ts";

test("actual Draw.io public factory and owned vendor prepare/close", async () => {
  const dir = mkdtempSync(join(import.meta.dir, ".qualification-drawio-"));
  const pkg = await installDrawioFixture(dir);
  const agentDir = join(dir, "agent"); mkdirSync(agentDir);
  const catalog = await loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() });
  try {
    const q = await qualifyInstalledDrawio(catalog, dir);
    expect(q).toBeDefined();
    assertApplicationExtensionCatalogSupported(catalog, undefined, undefined, undefined, q);
    const host = q!.addon.bindDrawioVendorHost({ assertCurrent: q!.assertCurrent, baseDir: pkg, cwd: dir, cacheDir: join(dir, "cache") });
    try {
      await host.prepare();
      expect(readFileSync(join(dir, "cache/index.html"), "utf8")).toBe("DRAWIO_NATIVE_FIXTURE");
      let current = true;
      const opened: string[] = [];
      const tool = q!.addon.createDrawioEditorTool({ cwd: dir, authority: {
        assertCurrent() { if (!current) throw Error("revoked"); },
        async openWorkspaceFile(path) { opened.push(path); return { ok: true, opened: true }; },
      } });
      await tool.execute("new", { path: "nested/new.drawio" }, undefined, undefined, undefined as never);
      expect(readFileSync(join(dir, "nested/new.drawio"), "utf8")).toContain("<mxfile");
      writeFileSync(join(dir, "nested/new.drawio"), "PRESERVED");
      await tool.execute("existing", { path: "nested/new.drawio" }, undefined, undefined, undefined as never);
      expect(readFileSync(join(dir, "nested/new.drawio"), "utf8")).toBe("PRESERVED");
      current = false;
      await expect(tool.execute("cancelled", { path: "denied/new.drawio" }, undefined, undefined, undefined as never)).rejects.toThrow("revoked");
      expect(opened).toEqual(["nested/new.drawio", "nested/new.drawio"]);
    } finally { await host.close(); }
    await expect(host.prepare()).rejects.toThrow("closed");
    writeFileSync(join(pkg, "package.json"), readFileSync(join(pkg, "package.json"), "utf8") + "\n");
    expect(() => q!.assertCurrent()).toThrow("source changed");
  } finally { catalog.runtime.invalidate("fixture ended"); rmSync(dir, { recursive: true, force: true }); }
});

test("actual Draw.io altered metadata denied before native qualification", async () => {
  const dir = mkdtempSync(join(import.meta.dir, ".qualification-drawio-"));
  const pkg = await installDrawioFixture(dir);
  const agentDir = join(dir, "agent"); mkdirSync(agentDir);
  writeFileSync(join(pkg, "package.json"), readFileSync(join(pkg, "package.json"), "utf8") + "\n");
  try {
    await expect(loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() })).rejects.toThrow(/Unqualified installed (add-on package|extension source) before evaluation/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
