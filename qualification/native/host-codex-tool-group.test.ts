import { test, expect } from "bun:test";
import { createHostCodexToolGroup, type HostCodexToolGroupAddon } from "../../runtime/durable-engine/src/host-codex-tool-group.js";
import { createHostCodexProcessTools } from "../../runtime/durable-engine/src/host-codex-process.js";
import { createHostCodexProviderTools } from "../../runtime/durable-engine/src/host-codex-provider-tools.js";
import { assertHostToolDeclaration } from "../../runtime/durable-engine/src/host-tools.js";

// Composition-only fixture: deliberately no owned database or default-runtime proof.
test("six native declarations retain metadata, capture actual IDs, and dispose the process pool", async () => {
  let disposed = 0, legacyCalls = 0, patchFactories = 0;
  const definitions = new Map<string, any>();
  const declaration = (name: string) => {
    const tool = { name, label: name, description: `Original ${name}`, parameters: { type: "object", properties: {} },
      async execute() { legacyCalls++; throw Error("Legacy execution forbidden"); } };
    definitions.set(name, tool); return tool;
  };
  const addon: HostCodexToolGroupAddon = {
    createNativeProcessPool: () => ({ dispose() { disposed++; }, disposeSession() {}, disposeIdentity() {} }),
    createNativeExecCommandTool: () => declaration("exec_command"),
    createNativeWriteStdinTool: () => declaration("write_stdin"),
    createNativeWebSearchTool: () => declaration("web_search"),
    createNativeImageGenerationTool: () => declaration("image_generation"),
    createNativeViewImageTool: () => declaration("view_image"),
    createNativeApplyPatchFactory() { patchFactories++; throw Error("No captured authority"); },
  };
  const captures: unknown[][] = [];
  const shared = { root: {} as any, assertOwner() {}, runtime: () => ({
    async captureToolSource(...ids: any[]) { captures.push(ids); throw Error("No owned source"); },
  }) };
  const group = createHostCodexToolGroup(addon, {
    process: { ...shared, ownerIncarnation: "owner", async bind() { throw Error("Not bound"); } },
    provider: { ...shared, metadata: () => ({ cwd: "/fixture", model: { provider: "openai-codex", input: ["text", "image"] } }),
      async bind() { throw Error("Not bound"); } },
    applyPatch: declaration("apply_patch"),
  });
  expect(group.tools.map(t => t.name)).toEqual(["exec_command", "write_stdin", "apply_patch", "web_search", "image_generation", "view_image"]);
  for (const tool of group.tools) assertHostToolDeclaration(tool, definitions.get(tool.name));
  for (const tool of group.tools) {
    await expect((tool.execute as any)({}, { callId: "call", conversationId: "conversation", taskId: "task" }, {})).rejects.toThrow("Host tool execution failed");
  }
  expect(captures).toEqual(Array.from({ length: 6 }, () => ["conversation", "task", "call"]));
  expect(legacyCalls).toBe(0); expect(patchFactories).toBe(0);
  group.dispose(); expect(disposed).toBe(1);
});

test("installed declarations survive native factories with different presentation metadata", () => {
  const definition = (name: string, description: string) => ({ name, label: name, description,
    parameters: { type: "object", properties: {} }, async execute() { throw Error("Declaration only"); } });
  const declarations = new Map(["exec_command", "write_stdin", "web_search", "image_generation", "view_image"].map(name => [name, definition(name, "Qualified installed presentation")]));
  const native = (name: string) => () => definition(name, "Native factory presentation");
  const shared = { root: {} as any, declarations, assertOwner() {}, runtime: () => ({ async captureToolSource() { throw Error("No source"); } }) };
  const process = createHostCodexProcessTools({ createNativeProcessPool: () => ({ dispose() {} }),
    createNativeExecCommandTool: native("exec_command"), createNativeWriteStdinTool: native("write_stdin") },
    { ...shared, ownerIncarnation: "owner", async bind() { throw Error("No source"); } });
  const provider = createHostCodexProviderTools({ createNativeWebSearchTool: native("web_search"),
    createNativeImageGenerationTool: native("image_generation"), createNativeViewImageTool: native("view_image") },
    { ...shared, metadata: () => ({ cwd: "/fixture", model: {} }), async bind() { throw Error("No source"); } });
  for (const tool of [...process.tools, ...provider]) expect(() => assertHostToolDeclaration(tool, declarations.get(tool.name)! as any)).not.toThrow();
  process.dispose();
});

test("patch result branch requires formatted native ToolResult without raw fallback", async () => {
  const source = await Bun.file(new URL("../../runtime/durable-engine/src/host-codex-tool-group.ts", import.meta.url)).text();
  expect(source).toContain("executeTool(args: { input: string })");
  expect(source).toContain("const result = native.executeTool({ input:");
  expect(source).toContain("authority.assertCurrent();\n        return result;");
  expect(source).not.toContain("JSON.stringify(result)");
  expect(source).not.toContain("native.execute({");
});
