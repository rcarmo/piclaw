import { test, expect } from "bun:test";
import { createHostCodexProcessTools } from "../../runtime/durable-engine/src/host-codex-process.ts";
test("parent owns one shared pool and explicit disposal; both tools unsafe", () => {
 let pools = 0, disposed = false;
 const pool = { dispose() { disposed = true; }, disposeSession() {}, disposeIdentity() {} };
 const factory = () => ({ name: "process", label: "process", description: "process", parameters: { type: "object", properties: {} }, async execute() {} });
 const parent = createHostCodexProcessTools({ createNativeProcessPool() { pools++; return pool; }, createNativeExecCommandTool: factory, createNativeWriteStdinTool: factory }, { root: {} as any, runtime: () => ({} as any), assertOwner() {}, ownerIncarnation: "one", async bind() { return { cwd: "/tmp", sessionRevision: "r1" }; } });
 expect(pools).toBe(1); expect(parent.tools.length).toBe(2);
 parent.dispose(); expect(disposed).toBe(true);
});
