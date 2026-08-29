import { expect, test } from "bun:test";

import {
  resolveTitleFromArgs,
  resolveToolKind,
  TOOL_KIND_LABELS,
} from "../../web/static/visual/frontend/src/utils/agent-status.ts";

test("visual tool status identifies MCP calls by server and selected tool", () => {
  expect(resolveToolKind("mcp")).toBe("mcp");
  expect(TOOL_KIND_LABELS.mcp).toEqual({ label: "MCP", cls: "agent-tool-kind-pill--mcp" });
  expect(resolveTitleFromArgs(
    "mcp",
    "mcp: memento → memory_search",
    { server: "memento", tool: "memory_search", args: { query: "draft metadata" } },
  )).toEqual({
    prefix: "memento → ",
    argument: "memory_search",
    suffix: "",
    gitBranch: null,
  });
});

test("visual tool status identifies non-call MCP gateway operations", () => {
  expect(resolveTitleFromArgs("mcp", "mcp: memento → connect", { connect: "memento" })).toMatchObject({
    prefix: "memento → ",
    argument: "connect",
  });
  expect(resolveTitleFromArgs("mcp", "mcp: search → memory", { search: "memory" })).toMatchObject({
    prefix: "mcp search → ",
    argument: "memory",
  });
  expect(resolveTitleFromArgs("mcp", "mcp: memento → describe memory_search", { server: "memento", describe: "memory_search" })).toMatchObject({
    prefix: "memento → describe ",
    argument: "memory_search",
  });
});
