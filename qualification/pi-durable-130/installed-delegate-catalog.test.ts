import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { SettingsManager } from "../../node_modules/@earendil-works/pi-coding-agent";
import { loadApplicationExtensionCatalog, qualifyInstalledDelegate, assertApplicationExtensionCatalogSupported } from "../../runtime/durable-engine/src/host-extension-catalog.ts";
import { buildModelCandidates, type AvailableModel } from "../../runtime/src/delegate/policy.ts";
import { delegateDescription, delegateParameters } from "../../runtime/src/delegate/parameters.ts";

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
    expect(hash.digest("hex")).toBe("3876649c7ef34f291e5f26de4b668dcbfe2105be960eb1bb88b5014d57b5495a");
    copyFileSync(join(source, "addons/delegate/package.json"), join(pkg, "package.json"));
    if (mode === "shadow") writeFileSync(join(pkg, "delegate.js"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(join(dir, "unqualified-module-io"))}, "BAD");
export default function() {}\n`);
    if (mode === "dirty") writeFileSync(join(pkg, "delegate.ts"), readFileSync(join(pkg, "delegate.ts"), "utf8") + "\n// unapproved\n");
    if (mode === "version") {
      const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
      manifest.version = "99.0.0"; writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest));
    }
    let catalog: Awaited<ReturnType<typeof loadApplicationExtensionCatalog>> | undefined;
    try {
      if (["shadow", "dirty", "version"].includes(mode)) {
        await expect(loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() })).rejects.toThrow(/Unqualified installed (add-on package|extension source) before evaluation/);
      expect(await Bun.file(join(dir, "unqualified-module-io")).exists()).toBe(false);
        return;
      }
      catalog = await loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() });
      const qualified = await qualifyInstalledDelegate(catalog, dir);
      expect(qualified).toBeDefined();
      expect(qualified!.definition.parameters).toHaveProperty("properties.task_category");
      expect(qualified!.nativeLifecycle.events).toEqual(["session_start", "model_select", "before_agent_start"]);
      expect(() => assertApplicationExtensionCatalogSupported(catalog!)).toThrow("delegate: no operation-owned host effect port");
      assertApplicationExtensionCatalogSupported(catalog, qualified);
      if (mode === "handler") qualified!.extension.handlers.set("session_start", [async () => {}]);
      if (mode === "execute") qualified!.definition.execute = async () => { throw Error("must not run"); };
      if (mode === "schema") qualified!.definition.description += " changed";
      if (mode === "approved") {
        qualified!.assertCurrent();
        expect(qualified).not.toHaveProperty("buildModelCandidates");
        expect(delegateDescription).toBe(qualified!.definition.description);
        expect(JSON.parse(JSON.stringify(delegateParameters))).toEqual(qualified!.definition.parameters);
        // Already-loaded immutable synthetic installation. Pure export calls only:
        // no legacy execute, lifecycle, config/model API, CLI or provider request.
        const legacy = await import(join(pkg, "delegate.ts"));
        const models: AvailableModel[] = [
          ["github-copilot", "mai-code-1.1-flash"], ["github-copilot", "gpt-6.1-sol"],
          ["github-copilot", "gpt-6.1-sol-next"], ["anthropic", "claude-opus-5.5"],
          ["openai", "gpt-5.4-mini"], ["azure-private", "gpt-5.4-mini"],
          ["openrouter", "openai/gpt-6-astra-pro:batch"],
        ].map(([provider, id]) => ({ provider: provider!, id: id!, fullId: `${provider}/${id}`, supportsImages: true, contextWindow: 64000 }));
        models.push({ ...models[0]!, supportsImages: false });
        for (const config of [undefined, null, {},
          { searchable_providers: [] },
          { searchable_providers: ["github-copilot", "anthropic", "openai", "azure-private", "openrouter"] },
          { searchable_providers: ["azure-private", "github-copilot"], excluded_providers: [] },
          { searchable_providers: ["github-copilot", "openai"], excluded_providers: ["openai"] },
          { searchable_providers: ["github-copilot", "openai"], excluded_models: ["*MAI*", "GPT-5.4"] },
          { searchable_providers: "github-copilot,anthropic", excluded_models: "opus" },
        ]) {
          expect(buildModelCandidates(models, config as never)).toEqual(legacy.buildModelCandidates(models, config));
        }
      } else expect(() => qualified!.assertCurrent()).toThrow("Unqualified Delegate capabilities");
    } finally { catalog?.runtime.invalidate("fixture ended"); rmSync(dir, { recursive: true, force: true }); }
  });
}
