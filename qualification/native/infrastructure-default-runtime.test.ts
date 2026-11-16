import { test, expect } from "bun:test";
import { infrastructurePrompt, infrastructureLifecycle } from "../../runtime/durable-engine/src/host-addon-prompts.ts";

test("infrastructure policies use current native exports and cover actual catalog keys", () => {
  let current = true, policy = "current policy";
  const qualified = { kind: "proxmox", assertCurrent() { if (!current) throw Error("revoked"); },
    nativeExports: { "index.ts": { getProxmoxPrompt: () => policy } }, skillPaths: ["/qualified/skill"],
    capabilities: { events: ["before_agent_start", "resources_discover"] } } as any;
  const callbacks = infrastructureLifecycle(qualified);
  expect(Object.keys(callbacks)).toEqual(qualified.capabilities.events);
  expect(callbacks.before_agent_start!()).toBe("current policy");
  policy = "updated policy";
  expect(infrastructurePrompt(qualified)).toBe("updated policy");
  expect(callbacks.resources_discover!()).toEqual({ skills: ["/qualified/skill"] });
  current = false;
  expect(() => callbacks.before_agent_start!()).toThrow("revoked");
  expect(() => callbacks.resources_discover!()).toThrow("revoked");
});

test("unknown lifecycle cannot receive a receipt via a guessed callback", () => {
  expect(() => infrastructureLifecycle({ capabilities: { events: ["unknown"] } } as any)).toThrow("Unqualified native");
});
