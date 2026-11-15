import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SettingsManager } from "../runtime/src/durable-legacy-sdk.js";
import { loadApplicationExtensionCatalog, qualifyInstalledAddon, bindInstalledAddon, assertApplicationExtensionCatalogSupported } from "../runtime/durable-engine/src/host-extension-catalog.js";
import { installedAddonProfiles } from "../runtime/durable-engine/src/host-installed-addon-profiles.js";

test("native receipt is catalog-bound, opaque and requires complete hook coverage", async () => {
 const root = process.env.DURABLE_ADDONS_ROOT!;
 if (!root) throw Error("Candidate DURABLE_ADDONS_ROOT required");
 const cwd = mkdtempSync(join(import.meta.dir, ".native-binding-"));
 try {
  const profile = installedAddonProfiles["yolo-vibe"];
  const pkg = join(cwd, ".pi/extensions/node_modules", profile.name), agentDir = join(cwd, "agent");
  mkdirSync(pkg, { recursive: true }); mkdirSync(agentDir);
  for (const file of Object.keys(profile.files)) { const target = join(pkg, file); mkdirSync(join(target, ".."), { recursive: true }); copyFileSync(join(root, "addons/yolo-vibe", file), target); }
  const catalog = await loadApplicationExtensionCatalog({ cwd, agentDir, settingsManager: SettingsManager.inMemory() });
  const q = (await qualifyInstalledAddon(catalog, cwd, "yolo-vibe"))!;
  const support = (receipts: any[]) => assertApplicationExtensionCatalogSupported(catalog, undefined, undefined, undefined, undefined, undefined, undefined, undefined, receipts);
  support([]); // Static default profile retains its existing exemption.
  expect(() => support([Object.freeze({})])).toThrow();
  expect(() => bindInstalledAddon({ ...q }, { tools: [], lifecycle: {}, commands: {} })).toThrow();
  if (q.capabilities.events.length) expect(() => bindInstalledAddon(q, { tools: [], lifecycle: {}, commands: {} })).toThrow();
  const lifecycle = Object.fromEntries(q.capabilities.events.map(event => [event, () => q.assertCurrent()]));
  const commands = Object.fromEntries(q.capabilities.commands.map(command => [command, () => q.assertCurrent()]));
  const receipt = bindInstalledAddon(q, { tools: [], lifecycle, commands });
  expect(Object.isFrozen(receipt)).toBe(true);
  support([receipt]);
  expect(() => support([{ ...receipt }])).toThrow();
  expect(() => bindInstalledAddon(q, { tools: [], lifecycle: { ...lifecycle, unknown() {} }, commands })).toThrow();
  const foreign = { ...catalog };
  expect(() => assertApplicationExtensionCatalogSupported(foreign, undefined, undefined, undefined, undefined, undefined, undefined, undefined, [receipt])).toThrow();
 } finally { rmSync(cwd, { recursive: true, force: true }); }
});
