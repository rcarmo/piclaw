import { describe, expect, mock, test } from "bun:test";
import { executeCall, executeDescribe, executeList, executeSearch, executeStatus } from "../../../node_modules/pi-mcp-adapter/proxy-modes.ts";
import { createMcpStatusSnapshot } from "../../../node_modules/pi-mcp-adapter/mcp-status.ts";

describe("retained adapter metadata policy (no native parity)", () => {
  test("enforces proxy include/exclude policy on stale discovery and before transport", async () => {
    const callTool = mock(async () => ({ isError: false, content: [{ type: "text", text: "ok" }] }));
    const connection = {
      status: "connected",
      tools: [
        { name: "retrieve", description: "Read data", inputSchema: { type: "object" } },
        { name: "delete_entity", description: "Delete data", inputSchema: { type: "object" } },
      ],
      resources: [],
      prompts: [],
      client: { callTool, readResource: mock() },
    };
    const state = {
      config: {
        settings: { toolPrefix: "server" },
        mcpServers: {
          workiq: {
            command: "workiq.exe",
            includeTools: ["retrieve"],
            excludeTools: ["delete_entity"],
          },
        },
      },
      manager: {
        getConnection: mock(() => connection),
        isConnecting: mock(() => false),
        getRequestOptions: mock(() => undefined),
        touch: mock(),
        incrementInFlight: mock(),
        decrementInFlight: mock(),
      },
      // Adapter 2.31 applies include/exclude policy before publishing metadata.
      toolMetadata: new Map([["workiq", [
        { name: "workiq_retrieve", originalName: "retrieve", description: "Read data" },
      ]]]),
      resourceCounts: new Map(),
      serverInstructions: new Map(),
      failureTracker: new Map(),
      completedUiSessions: [],
    } as any;

    expect(executeList(state, "workiq").details).toMatchObject({ tools: ["workiq_retrieve"], count: 1 });
    expect(executeSearch(state, "delete").details).toMatchObject({ matches: [], count: 0 });
    expect(executeDescribe(state, "workiq_delete_entity").details).toMatchObject({ error: "tool_not_found" });
    expect(executeStatus(state).details).toMatchObject({ totalTools: 1 });
    expect(createMcpStatusSnapshot(state)).toMatchObject({ totalTools: 1 });

    const denied = await executeCall(state, "workiq_delete_entity", {});
    expect(denied.details).toMatchObject({ error: "tool_not_found" });
    expect(callTool).not.toHaveBeenCalled();

    const allowed = await executeCall(state, "workiq_retrieve", { q: "status" });
    expect(allowed.content[0]?.text).toContain("ok");
    expect(callTool).toHaveBeenCalledTimes(1);
  });

});
