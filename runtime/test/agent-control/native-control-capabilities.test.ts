import { expect, test } from "bun:test";
import { getNativeCommandCatalogue, getNativeControlCapabilities } from "../../src/agent-control/native-control-capabilities.js";
import { parseControlCommand } from "../../src/agent-control/agent-control-parser.js";
import type { DurableSessionPositionPort } from "../../src/agent-pool/durable-runtime-adapter.js";

const port: DurableSessionPositionPort = {
  sessionId: "native-audit", branchId: "main", readPosition: async () => null,
  readModel: async () => "test/model", setModel: async () => {},
  readThinkingLevel: async () => "off", setThinkingLevel: async () => {},
  reset: async () => {}, abort: async () => false, compact: async () => ({ compacted: false }),
  readReport: async () => { throw Error("Catalogue must not inspect SDK data"); },
  readTree: async () => { throw Error("Catalogue must not inspect SDK data"); },
};

test("native catalogue classifies every core command and preserves registered aliases", () => {
  const catalogue = getNativeCommandCatalogue(port);
  for (const command of catalogue) {
    expect(["native", "web input", "web UI", "unavailable"]).toContain(command.status);
    if (!command.type) expect(["/theme", "/settings"]).toContain(command.name);
    for (const alias of [command.name.replace(/-/g, "_"), ...(command.aliases ?? [])])
      expect(parseControlCommand(alias)?.type ?? null).toBe(command.type);
  }
  expect(catalogue.find(command => command.name === "/queue")?.status).toBe("web input");
  expect(catalogue.find(command => command.name === "/steer")?.status).toBe("web input");
  expect(catalogue.find(command => command.name === "/theme")?.status).toBe("web UI");
  expect(catalogue.find(command => command.name === "/fork")?.status).toBe("unavailable");
  expect(catalogue.find(command => command.name === "/stats")?.status).toBe("native");
});

test("native authentication capabilities require a current owned host lifetime", () => {
  const lifetime = new AbortController();
  const owned = { ...port, lifetimeSignal: lifetime.signal, assertCurrent: () => {}, runOwnedControl: async <T>(operation: () => Promise<T>) => operation() };
  expect(getNativeControlCapabilities(owned).login).toBe("native");
  expect(getNativeControlCapabilities(owned).logout).toBe("native");
  expect(getNativeControlCapabilities({ ...owned, runOwnedControl: undefined }).login).toBe("unavailable");
  lifetime.abort();
  expect(getNativeControlCapabilities(owned).login).toBe("unavailable");
  expect(getNativeControlCapabilities(owned).logout).toBe("unavailable");
});

test("native catalogue respects missing optional ports, never infers a legacy fallback", () => {
  const capabilities = getNativeControlCapabilities({ sessionId: "minimal", branchId: "main", readPosition: async () => null });
  for (const type of ["abort", "compact", "new_session", "stats", "context", "last", "model", "thinking", "tree"] as const)
    expect(capabilities[type]).toBe("unavailable");
  expect(capabilities.shell).toBe("native");
  expect(capabilities.commands).toBe("native");
});
