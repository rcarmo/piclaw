/**
 * test/extensions/extensions-tool-activation.test.ts – Tests for lazy tool activation.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import "../helpers.js";
import { withTempWorkspaceEnv } from "../helpers.js";
import { createFakeExtensionApi } from "./fake-extension-api.js";

describe("tool-activation extension", () => {
  test("combined model control and quota access are active by default and discoverable", async () => {
    const { getEffectiveDefaultActiveToolNames, TOOLSETS } = await import("../../src/extensions/tool-activation.js");
    expect(getEffectiveDefaultActiveToolNames([{ name: "set_model" }, { name: "provider_quota" }, { name: "switch_thinking" }])).toEqual(["set_model", "provider_quota"]);
    expect(TOOLSETS.find((set) => set.name === "model-control")?.toolNames).toContain("set_model");
    expect(TOOLSETS.find((set) => set.name === "model-control")?.toolNames).toContain("provider_quota");
  });
  test("registers activation tools and default baseline metadata", async () => {
    const { toolActivation, getDefaultActiveToolNames, getEffectiveDefaultActiveToolNames } = await import("../../src/extensions/tool-activation.js");
    const fake = createFakeExtensionApi({ allTools: [] });

    toolActivation(fake.api);

    expect(fake.tools.has("activate_tools")).toBe(true);
    expect(fake.tools.has("reset_active_tools")).toBe(true);
    expect(getDefaultActiveToolNames()).toContain("list_tools");
    expect(getDefaultActiveToolNames()).not.toContain(["list", "internal", "tools"].join("_"));
    expect(getDefaultActiveToolNames()).toContain("attach_file");
    expect(getDefaultActiveToolNames()).toContain("messages");
    expect(getDefaultActiveToolNames()).toContain("chat_project");
    expect(getDefaultActiveToolNames()).toContain("keychain");
    expect(getDefaultActiveToolNames()).toContain("exit_process");
    expect(getDefaultActiveToolNames()).not.toContain("list_models");
    expect(getDefaultActiveToolNames()).not.toContain("bun_run");
    expect(getEffectiveDefaultActiveToolNames([
      { name: "read" },
      { name: "list_models" },
      { name: "search_workspace" },
      { name: "schedule_task" },
      { name: "read_attachment" },
      { name: "export_attachment" },
      { name: "switch_model" },
    ])).toEqual([
      "read",
      "list_models",
      "search_workspace",
      "schedule_task",
      "read_attachment",
      "export_attachment",
    ]);
    expect(getDefaultActiveToolNames("win32")).toContain("powershell");
    expect(getDefaultActiveToolNames("win32")).toContain("bun_run");
    expect(getDefaultActiveToolNames("win32")).not.toContain("bash");
  });

  test("session_start activates the effective default baseline including read-only, scheduling, and attachment tools", async () => {
    const { toolActivation, getDefaultActiveToolNames, getEffectiveDefaultActiveToolNames } = await import("../../src/extensions/tool-activation.js");
    const availableTools = [
      ...getDefaultActiveToolNames().map((name) => ({ name, description: `${name} description` })),
      { name: "search_workspace", description: "Search workspace." },
      { name: "introspect_sql", description: "Read-only SQL." },
      { name: "list_models", description: "List models." },
      { name: "schedule_task", description: "Schedule task." },
      { name: "read_attachment", description: "Read attachment." },
      { name: "export_attachment", description: "Export attachment." },
      { name: "switch_model", description: "Switch model." },
    ];
    const fake = createFakeExtensionApi({
      allTools: availableTools,
      activeTools: ["messages", "keychain"],
    });

    toolActivation(fake.api);

    const sessionStart = fake.handlers.find((entry) => entry.event === "session_start");
    expect(sessionStart).toBeDefined();
    await sessionStart!.handler({}, {});
    expect(fake.api.getActiveTools()).toEqual(getEffectiveDefaultActiveToolNames(availableTools));
    expect(fake.api.getActiveTools()).toContain("search_workspace");
    expect(fake.api.getActiveTools()).not.toContain("introspect_sql"); // Unknown third-party SQL is not silently declared safe.
    expect(fake.api.getActiveTools()).toContain("list_models");
    expect(fake.api.getActiveTools()).toContain("schedule_task");
    expect(fake.api.getActiveTools()).toContain("read_attachment");
    expect(fake.api.getActiveTools()).toContain("export_attachment");
    expect(fake.api.getActiveTools()).not.toContain("switch_model");
  });

  test("session_start ignores stale extension context after session replacement", async () => {
    const { toolActivation } = await import("../../src/extensions/tool-activation.js");
    const fake = createFakeExtensionApi({ activeTools: ["read"] });
    const stale = new Error("This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload().");
    (fake.api as any).getAllTools = () => {
      throw stale;
    };

    toolActivation(fake.api);

    const sessionStart = fake.handlers.find((entry) => entry.event === "session_start");
    expect(sessionStart).toBeDefined();
    await expect(sessionStart!.handler({}, {})).resolves.toBeUndefined();
  });

  test("windows baseline includes bun_run alongside powershell", async () => {
    const { getDefaultActiveToolNames } = await import("../../src/extensions/tool-activation.js");
    const names = getDefaultActiveToolNames("win32");

    expect(names).toContain("powershell");
    expect(names).toContain("bun_run");
    expect(names.indexOf("powershell")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("bun_run")).toBeGreaterThanOrEqual(0);
  });

  test("activate_tools appends tools and reports missing names", async () => {
    const { toolActivation } = await import("../../src/extensions/tool-activation.js");
    const fake = createFakeExtensionApi({
      allTools: [
        { name: "read", description: "Read a file." },
        { name: "bash", description: "Run shell commands." },
        { name: "messages", description: "Read and write timeline messages." },
        { name: "list_tools", description: "List tools." },
        { name: "activate_tools", description: "Activate tools." },
        { name: "reset_active_tools", description: "Reset tools." },
        { name: "attach_file", description: "Attach a file." },
        { name: "read_attachment", description: "Read attachment." },
        { name: "export_attachment", description: "Export attachment." },
        { name: "get_model_state", description: "Get model state." },
        { name: "list_models", description: "List models." },
        { name: "switch_model", description: "Switch model." },
        { name: "switch_thinking", description: "Switch thinking." },
      ],
      activeTools: ["read", "bash", "list_tools", "activate_tools", "reset_active_tools"],
    });

    toolActivation(fake.api);

    const tool = fake.tools.get("activate_tools");
    const result = await tool.execute("t1", { names: ["messages", "missing_tool"] });
    expect(result.content[0].text).toContain("1 accepted");
    expect(result.content[0].text).toContain("next model step");
    expect(result.details.availability).toBe("same_turn");
    expect(result.details.newlyActivated).toEqual(["messages"]);
    expect(result.details.missing).toEqual(["missing_tool"]);
    expect(fake.api.getActiveTools()).toContain("messages");
  });

  test("reset_active_tools returns to the effective baseline after manual activation", async () => {
    const { toolActivation, getDefaultActiveToolNames, getEffectiveDefaultActiveToolNames } = await import("../../src/extensions/tool-activation.js");
    const available = [
      ...getDefaultActiveToolNames(),
      "introspect_sql",
      "list_models",
      "schedule_task",
      "read_attachment",
    ];
    const availableTools = available.map((name) => ({ name, description: `${name} description` }));
    const fake = createFakeExtensionApi({
      allTools: availableTools,
      activeTools: getDefaultActiveToolNames(),
    });

    toolActivation(fake.api);

    const activateTools = fake.tools.get("activate_tools");
    const resetActiveTools = fake.tools.get("reset_active_tools");

    await activateTools.execute("t2", { names: ["introspect_sql"] });
    expect(fake.api.getActiveTools()).toContain("introspect_sql");

    const resetResult = await resetActiveTools.execute("t3", {});
    expect(resetResult.details.availability).toBe("same_turn");
    expect(fake.api.getActiveTools()).toEqual(getEffectiveDefaultActiveToolNames(availableTools));
    expect(fake.api.getActiveTools()).not.toContain("introspect_sql");
    expect(fake.api.getActiveTools()).toContain("list_models");
    expect(fake.api.getActiveTools()).toContain("schedule_task");
    expect(fake.api.getActiveTools()).toContain("read_attachment");
  });

  test("default active tools include config-defined additions", async () => {
    await withTempWorkspaceEnv("piclaw-tool-activation-config-", {}, async (ws) => {
      const configDir = join(ws.workspace, ".piclaw");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), JSON.stringify({
        tools: {
          additionalDefaultTools: ["search_workspace", "introspect_sql"],
        },
      }, null, 2));

      const proc = Bun.spawnSync({
        cmd: [
          "bun",
          "-e",
          "import { getDefaultActiveToolNames } from './src/extensions/tool-activation.js'; console.log(JSON.stringify(getDefaultActiveToolNames()));",
        ],
        cwd: join(import.meta.dir, "../.."),
        env: {
          PATH: process.env.PATH || "",
          HOME: process.env.HOME || "/tmp",
          TMPDIR: process.env.TMPDIR || "/tmp",
          TMP: process.env.TMP || "/tmp",
          TEMP: process.env.TEMP || "/tmp",
          USER: process.env.USER || "agent",
          PICLAW_WORKSPACE: ws.workspace,
          PICLAW_STORE: ws.store,
          PICLAW_DATA: ws.data,
          PICLAW_DB_IN_MEMORY: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(proc.exitCode, proc.stderr.toString()).toBe(0);
      const names = JSON.parse(proc.stdout.toString().trim());
      expect(names).toContain("search_workspace");
      expect(names).toContain("introspect_sql");
      expect(names).not.toContain("activate_toolset");
    });
  });
});

test('activation reports the effective scoped tool set without bypassing a ceiling',async()=>{
 const {toolActivation}=await import('../../src/extensions/tool-activation');const fake=createFakeExtensionApi({allTools:[{name:'activate_tools',description:'activate'},{name:'plan',description:'plan'}],activeTools:['activate_tools']});
 fake.api.setActiveTools=(names:string[])=>fake.setActiveTools(names.filter(name=>name!=='plan'));toolActivation(fake.api);
 const result=await fake.tools.get('activate_tools')!.execute('test',{names:['plan']},undefined,undefined,fake.ctx);
 expect(result.details.accepted).toEqual(['plan']);expect(result.details.unavailable).toEqual(['plan']);expect(result.details.newlyActivated).toEqual([]);expect(result.details.activeToolNames).toEqual(['activate_tools']);expect(result.content[0].text).toContain('Not activated in this execution scope');
});
