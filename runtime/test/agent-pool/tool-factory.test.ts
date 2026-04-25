import { expect, test } from "bun:test";

import { AgentToolFactory } from "../../src/agent-pool/tool-factory.js";
import { getDefaultActiveToolNames } from "../../src/extensions/tool-activation.js";

test("AgentToolFactory matches the intended default active-tool baseline on non-Windows", () => {
  const factory = new AgentToolFactory({ workspaceDir: "/workspace", platform: "linux" });
  const tools = factory.createDefaultTools();

  expect(tools).toEqual(getDefaultActiveToolNames("linux"));
  expect(tools).toContain("list_tools");
  expect(tools).toContain("activate_tools");
  expect(tools).toContain("attach_file");
});

test("AgentToolFactory matches the intended default active-tool baseline on Windows", () => {
  const factory = new AgentToolFactory({ workspaceDir: "/workspace", platform: "win32" });
  const tools = factory.createDefaultTools();

  expect(tools).toEqual(getDefaultActiveToolNames("win32"));
  expect(tools).toContain("powershell");
  expect(tools).toContain("bun_run");
  expect(tools).not.toContain("bash");
});
