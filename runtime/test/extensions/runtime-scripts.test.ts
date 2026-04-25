import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import "../helpers.js";
import { createFakeExtensionApi } from "./fake-extension-api.js";
import { importFresh, withTempWorkspaceEnv } from "../helpers.js";

describe("runtime-scripts extension", () => {
  test("parses SCRIPT_JDOC JSON blocks from source", async () => {
    const { parseScriptJDocFromSource } = await import("../../src/extensions/runtime-scripts.js");
    const source = `#!/usr/bin/env bun
/**
 * SCRIPT_JDOC:
 * {
 *   "summary": "Check stale dist artifacts.",
 *   "aliases": ["repo audit"],
 *   "domains": ["repo", "runtime"],
 *   "verbs": ["check"],
 *   "nouns": ["dist"],
 *   "keywords": ["stale dist"],
 *   "examples": ["check stale dist in the repo"],
 *   "kind": "read-only",
 *   "weight": "standard",
 *   "role": "entrypoint"
 * }
 */
console.log("ok");\n`;
    const metadata = parseScriptJDocFromSource(source);
    expect(metadata?.summary).toBe("Check stale dist artifacts.");
    expect(metadata?.aliases).toContain("repo audit");
    expect(metadata?.kind).toBe("read-only");
    expect(metadata?.role).toBe("entrypoint");
  });

  test("loads packaged skill and workspace script catalogs from the repo", async () => {
    const { loadScriptCatalogEntries } = await import("../../src/extensions/runtime-scripts.js");
    const entries = loadScriptCatalogEntries({ scope: "packaged", role: "all" });
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.some((entry) => entry.displayPath.endsWith("runtime/skills/operator/token-chart/token-chart.ts"))).toBe(true);
    expect(entries.some((entry) => entry.displayPath.includes("runtime/scripts/check-stale-dist.ts"))).toBe(false);
    expect(entries.some((entry) => entry.displayPath.endsWith("render-proxmox-guest-compare.ts"))).toBe(true);
  });

  test("registers list_scripts and supports query + intent", async () => {
    const { runtimeScripts } = await import("../../src/extensions/runtime-scripts.js");
    const fake = createFakeExtensionApi({ allTools: [] });
    runtimeScripts(fake.api);

    const tool = fake.tools.get("list_scripts");
    expect(tool).toBeDefined();

    const filtered = await tool.execute("s1", { query: "token chart", scope: "packaged" });
    expect(filtered.content[0].text).toContain("Available scripts");
    expect(filtered.content[0].text).toContain("Hint: use scope=packaged|workspace|all");
    expect(filtered.content[0].text).toContain("token-chart");

    const recommended = await tool.execute("s2", { intent: "generate token usage chart", scope: "packaged" });
    expect(recommended.content[0].text).toContain("Recommended scripts");
    expect(recommended.content[0].text).toContain("Hint: use scope=packaged|workspace|all");
    expect(recommended.details.scripts[0].path).toContain("token-chart");
  });

  test("workspace scope exposes workspace-relative invocation hints and metadata", async () => {
    await withTempWorkspaceEnv("piclaw-list-scripts-workspace-", {}, async (workspace) => {
      const skillDir = path.join(workspace.workspace, ".pi", "skills", "demo-search");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "demo-search.ts"), `#!/usr/bin/env bun\n/**\n * SCRIPT_JDOC:\n * {\n *   "summary": "Search demo data for a workspace skill.",\n *   "aliases": ["demo search"],\n *   "domains": ["search"],\n *   "verbs": ["search"],\n *   "nouns": ["demo"],\n *   "keywords": ["demo data"],\n *   "examples": ["search demo data"],\n *   "kind": "read-only",\n *   "weight": "lightweight",\n *   "role": "entrypoint"\n * }\n */\nconsole.log("demo");\n`, "utf8");

      const notesDir = path.join(workspace.workspace, "notes", "tools");
      fs.mkdirSync(notesDir, { recursive: true });
      fs.writeFileSync(path.join(notesDir, "helper.ts"), `/**\n * SCRIPT_JDOC:\n * {\n *   "summary": "Helper module for demo notes.",\n *   "aliases": ["demo helper"],\n *   "domains": ["notes"],\n *   "verbs": ["inspect"],\n *   "nouns": ["helper"],\n *   "keywords": ["demo helper"],\n *   "examples": ["inspect demo helper"],\n *   "kind": "read-only",\n *   "weight": "lightweight",\n *   "role": "module"\n * }\n */\nexport const value = 1;\n`, "utf8");

      const proc = Bun.spawnSync([
        "bun",
        "-e",
        `import { runtimeScripts } from \"./src/extensions/runtime-scripts.ts\";
         const tools = new Map();
         const api = {
           on() {},
           registerTool(tool) { tools.set(tool.name, tool); },
           registerCommand() {}, registerShortcut() {}, registerFlag() {}, getFlag() { return undefined; },
           registerMessageRenderer() {}, sendMessage() {}, sendUserMessage() {}, appendEntry() {},
           setSessionName() {}, getSessionName() { return undefined; }, setLabel() {},
           exec: async () => ({ exitCode: 0, stdout: \"\", stderr: \"\" }),
           getActiveTools: () => [], getAllTools: () => [], setActiveTools() {}, getCommands: () => [],
           setModel: async () => true, getThinkingLevel: () => \"off\", setThinkingLevel() {}, registerProvider() {}, unregisterProvider() {},
         };
         runtimeScripts(api);
         const result = await tools.get(\"list_scripts\").execute(\"tool\", { scope: \"workspace\", include_metadata: true, role: \"all\" });
         console.log(JSON.stringify(result));`,
      ], {
        cwd: path.resolve(import.meta.dir, "../.."),
        env: { ...process.env, PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data, PICLAW_DB_IN_MEMORY: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(proc.exitCode, `stderr: ${proc.stderr.toString()}`).toBe(0);
      const result = JSON.parse(proc.stdout.toString());
      expect(result.details.count).toBe(2);
      const entrypoint = result.details.scripts.find((entry: any) => entry.name === "demo-search");
      expect(entrypoint.workspace_path).toBe(".pi/skills/demo-search/demo-search.ts");
      expect(entrypoint.invocation.via).toBe("bun_run");
      expect(entrypoint.metadata.summary).toBe("Search demo data for a workspace skill.");

      const module = result.details.scripts.find((entry: any) => entry.name === "helper");
      expect(module.role).toBe("module");
      expect(module.workspace_path).toBe("notes/tools/helper.ts");
    });
  });

  test("role filtering and module penalty keep entrypoints ahead of helper modules", async () => {
    await withTempWorkspaceEnv("piclaw-list-scripts-role-", {}, async (workspace) => {
      const skillDir = path.join(workspace.workspace, ".pi", "skills", "demo-compare");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "entry.ts"), `#!/usr/bin/env bun\n/**\n * SCRIPT_JDOC:\n * {\n *   "summary": "Compare demo metrics.",\n *   "aliases": ["demo compare"],\n *   "domains": ["metrics"],\n *   "verbs": ["compare"],\n *   "nouns": ["demo", "metrics"],\n *   "keywords": ["compare demo metrics"],\n *   "examples": ["compare demo metrics"],\n *   "kind": "read-only",\n *   "weight": "lightweight",\n *   "role": "entrypoint"\n * }\n */\nconsole.log("entry");\n`, "utf8");
      fs.writeFileSync(path.join(skillDir, "helper.ts"), `/**\n * SCRIPT_JDOC:\n * {\n *   "summary": "Compare demo metrics helper.",\n *   "aliases": ["demo compare helper"],\n *   "domains": ["metrics"],\n *   "verbs": ["compare"],\n *   "nouns": ["demo", "metrics"],\n *   "keywords": ["compare demo metrics"],\n *   "examples": ["compare demo metrics"],\n *   "kind": "read-only",\n *   "weight": "lightweight",\n *   "role": "module"\n * }\n */\nexport const helper = true;\n`, "utf8");

      const moduleApi = await importFresh<typeof import("../src/extensions/runtime-scripts.js")>("../src/extensions/runtime-scripts.js");
      const entries = moduleApi.loadScriptCatalogEntries({ workspaceDir: workspace.workspace, scope: "workspace", role: "module" });
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("helper");

      const proc = Bun.spawnSync([
        "bun",
        "-e",
        `import { runtimeScripts } from \"./src/extensions/runtime-scripts.ts\";
         const tools = new Map();
         const api = {
           on() {},
           registerTool(tool) { tools.set(tool.name, tool); },
           registerCommand() {}, registerShortcut() {}, registerFlag() {}, getFlag() { return undefined; },
           registerMessageRenderer() {}, sendMessage() {}, sendUserMessage() {}, appendEntry() {},
           setSessionName() {}, getSessionName() { return undefined; }, setLabel() {},
           exec: async () => ({ exitCode: 0, stdout: \"\", stderr: \"\" }),
           getActiveTools: () => [], getAllTools: () => [], setActiveTools() {}, getCommands: () => [],
           setModel: async () => true, getThinkingLevel: () => \"off\", setThinkingLevel() {}, registerProvider() {}, unregisterProvider() {},
         };
         runtimeScripts(api);
         const result = await tools.get(\"list_scripts\").execute(\"tool\", { scope: \"workspace\", role: \"all\", intent: \"compare demo metrics\" });
         console.log(JSON.stringify(result));`,
      ], {
        cwd: path.resolve(import.meta.dir, "../.."),
        env: { ...process.env, PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data, PICLAW_DB_IN_MEMORY: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(proc.exitCode).toBe(0);
      const result = JSON.parse(proc.stdout.toString());
      expect(result.details.scripts[0].name).toBe("entry");
      expect(result.details.scripts[1].name).toBe("helper");
    });
  });

  test("returns clear no-result responses for empty query and weak intent matches", async () => {
    const { runtimeScripts } = await import("../../src/extensions/runtime-scripts.js");
    const fake = createFakeExtensionApi({ allTools: [] });
    runtimeScripts(fake.api);
    const tool = fake.tools.get("list_scripts");

    const noQuery = await tool.execute("s5", { query: "definitely-not-a-real-script", scope: "packaged" });
    expect(noQuery.content[0].text).toContain("No scripts found matching");
    expect(noQuery.details.scripts).toEqual([]);

    const noIntent = await tool.execute("s6", { intent: "solder gpio pins", scope: "packaged" });
    expect(noIntent.content[0].text).toContain("No strong script recommendation");
    expect(noIntent.details.scripts).toEqual([]);
  });

  test("packaged script files all carry parseable SCRIPT_JDOC metadata", async () => {
    const { getScriptRoots, parseScriptJDocFromSource } = await import("../../src/extensions/runtime-scripts.js");
    const missing: string[] = [];
    const packagedRoots = getScriptRoots().filter((root) => root.scope === "packaged");

    for (const root of packagedRoots) {
      if (!fs.existsSync(root.root)) continue;
      const stack = [root.root];
      while (stack.length > 0) {
        const current = stack.pop()!;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const absolutePath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            stack.push(absolutePath);
            continue;
          }
          if (!entry.isFile()) continue;
          if (!absolutePath.endsWith(".ts") || absolutePath.endsWith(".d.ts")) continue;
          if (!root.include(absolutePath)) continue;
          const metadata = parseScriptJDocFromSource(fs.readFileSync(absolutePath, "utf8"));
          if (!metadata) missing.push(absolutePath);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
