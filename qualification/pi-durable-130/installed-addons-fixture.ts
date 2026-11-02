import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./src/repo-root.js";
import { applicationAddonSourceProfiles } from "../../runtime/durable-engine/src/host-extension-catalog.js";

/** Copies only approved candidate sources; never installs or mutates dependencies.
 * The actual production catalog still verifies every source before evaluation. */
export function installApprovedAddonsFixture(workspace: string) {
  const source = realpathSync(process.env.DURABLE_ADDONS_ROOT!);
  const rootModules = realpathSync(join(repoRoot("CORE"), "node_modules"));
  const catalogModules = realpathSync(process.env.DURABLE_CATALOG_DEPENDENCIES ?? join(source, "node_modules"));
  const installed = [];
  for (const [kind, profile] of Object.entries(applicationAddonSourceProfiles)) {
    const slug = profile.name.replace("@rcarmo/piclaw-addon-", "");
    const pkg = join(workspace, ".pi/extensions/node_modules", profile.name);
    cpSync(join(source, "addons", slug), pkg, { recursive: true, filter: path => !path.split("/").includes("node_modules") });
    const dependencies = join(pkg, "node_modules");
    mkdirSync(dependencies, { recursive: true });
    const graphs = [rootModules, catalogModules, ...Object.values(applicationAddonSourceProfiles).map(profile => join(source, "addons", profile.name.replace("@rcarmo/piclaw-addon-", ""), "node_modules")).filter(path => existsSync(path))];
    for (const modules of graphs) for (const entry of readdirSync(modules)) {
      if (entry.startsWith(".")) continue;
      if (entry.startsWith("@")) {
        mkdirSync(join(dependencies, entry), { recursive: true });
        for (const child of readdirSync(join(modules, entry))) {
          const target = join(dependencies, entry, child);
          if (!existsSync(target)) symlinkSync(join(modules, entry, child), target);
        }
      } else if (!existsSync(join(dependencies, entry))) symlinkSync(join(modules, entry), join(dependencies, entry));
    }
    installed.push({ kind, name: profile.name });
  }
  return installed;
}
