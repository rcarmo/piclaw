import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace } from "../helpers.js";
import { seedFreshWorkspaceCoreAddons } from "../../src/runtime/core-addon-defaults.js";

function bundledFixture(base: string) {
  const skel = join(base, "skel");
  const defaults = join(skel, ".piclaw/core-addons/defaults");
  const name = "@rcarmo/piclaw-addon-example";
  mkdirSync(join(defaults, "node_modules", name), { recursive: true });
  writeFileSync(join(defaults, "node_modules", name, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  writeFileSync(join(defaults, "package.json"), JSON.stringify({ name: "piclaw-local-addons", private: true, dependencies: { [name]: "https://example.invalid/example.tgz" } }));
  writeFileSync(join(defaults, "core-addons.lock.json"), JSON.stringify({ schemaVersion: 1, addons: [{ name, version: "1.0.0" }] }));
  return { skel, defaults, name };
}

describe("fresh workspace core add-ons", () => {
  test("seeds installed packages without a network or package manager and leaves an upgrade/removal alone", () => {
    const ws = createTempWorkspace("piclaw-core-defaults-");
    try {
      const { skel, name } = bundledFixture(ws.base);
      const dest = join(ws.workspace, ".pi/extensions");
      expect(seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toBe(true);
      expect(JSON.parse(readFileSync(join(dest, "node_modules", name, "package.json"), "utf8")).version).toBe("1.0.0");
      writeFileSync(join(dest, "node_modules", name, "package.json"), JSON.stringify({ name, version: "9.0.0" }));
      expect(seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toBe(false);
      expect(JSON.parse(readFileSync(join(dest, "node_modules", name, "package.json"), "utf8")).version).toBe("9.0.0");
      rmSync(join(dest, "node_modules", name), { recursive: true });
      expect(seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toBe(false);
      expect(existsSync(join(dest, "node_modules", name))).toBe(false);
    } finally { ws.cleanup(); }
  });

  test("does not modify existing workspaces, even when the add-on directory was removed", () => {
    const ws = createTempWorkspace("piclaw-core-existing-");
    try {
      const { skel } = bundledFixture(ws.base);
      writeFileSync(join(ws.store, "messages.db"), "existing");
      expect(seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toBe(false);
      expect(existsSync(join(ws.workspace, ".pi/extensions"))).toBe(false);
      rmSync(join(ws.store, "messages.db"));
      mkdirSync(join(ws.workspace, ".pi/extensions"), { recursive: true });
      expect(seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toBe(false);
    } finally { ws.cleanup(); }
  });

  test("rejects an incomplete bundle without publishing a partial installation", () => {
    const ws = createTempWorkspace("piclaw-core-invalid-");
    try {
      const { skel, defaults, name } = bundledFixture(ws.base);
      rmSync(join(defaults, "node_modules", name), { recursive: true });
      expect(() => seedFreshWorkspaceCoreAddons(ws.workspace, ws.store, skel)).toThrow();
      expect(existsSync(join(ws.workspace, ".pi/extensions"))).toBe(false);
    } finally { ws.cleanup(); }
  });
});
