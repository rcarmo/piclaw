import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { mkdirSync } from "node:fs";
import { join } from "path";

import "../helpers.js";
import { createTempWorkspace } from "../helpers.js";
import { readJsonConfig, writeJsonConfig } from "../../src/core/config-store.js";

describe("config-store helpers", () => {
  test("readJsonConfig returns an empty object for missing, invalid, or scalar JSON files", () => {
    const workspace = createTempWorkspace("piclaw-config-store-read-");
    try {
      const missingPath = join(workspace.workspace, "missing.json");
      expect(readJsonConfig(missingPath)).toEqual({});

      const invalidPath = join(workspace.workspace, "invalid.json");
      writeFileSync(invalidPath, "{not-json", "utf8");
      expect(readJsonConfig(invalidPath)).toEqual({});

      const scalarPath = join(workspace.workspace, "number.json");
      writeFileSync(scalarPath, "42", "utf8");
      expect(readJsonConfig(scalarPath)).toEqual({});
    } finally {
      workspace.cleanup();
    }
  });

  test("new and replaced configuration files remain private under the normal process umask", () => {
    const workspace = createTempWorkspace("piclaw-config-store-private-");
    const previousMask = process.umask(0o022);
    try {
      const path = join(workspace.workspace, "config.json");
      writeJsonConfig(path, { web: { widgetToken: "synthetic-private-token" } });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      writeJsonConfig(path, { web: { widgetToken: "synthetic-replaced-token" } });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readJsonConfig(path)).toEqual({ web: { widgetToken: "synthetic-replaced-token" } });
    } finally { process.umask(previousMask); workspace.cleanup(); }
  });

  test("widget bootstrap persistence preserves private permissions and retired MCP metadata", async () => {
    const workspace = createTempWorkspace("piclaw-config-store-widget-");
    const { setEnv } = await import("../helpers.js");
    const restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace });
    const previousMask = process.umask(0o022);
    const { setWebWidgetToken, getWebRuntimeConfig } = await import("../../src/core/config-web.js");
    const previousToken = getWebRuntimeConfig().widgetToken;
    try {
      const path = join(workspace.workspace, ".piclaw", "config.json");
      mkdirSync(join(workspace.workspace, ".piclaw"));
      writeFileSync(path, JSON.stringify({ domains: { access: { mode: "single-user" }, mcp: { engine: 'adapter', codemode: 'on' } } }), { mode: 0o600 });
      setWebWidgetToken("synthetic-bootstrap-widget-token");
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect((readJsonConfig(path) as any).domains.mcp).toEqual({ engine: 'adapter', codemode: 'on' });
    } finally { getWebRuntimeConfig().widgetToken = previousToken; process.umask(previousMask); restore(); workspace.cleanup(); }
  });

  test("writeJsonConfig creates parent directories and pretty-prints with a trailing newline", () => {
    const workspace = createTempWorkspace("piclaw-config-store-write-");
    try {
      const targetPath = join(workspace.workspace, ".piclaw", "nested", "config.json");
      writeJsonConfig(targetPath, {
        web: { trustProxy: true },
        assistant: { assistantName: "PiClaw" },
      });

      expect(existsSync(targetPath)).toBe(true);
      expect(readJsonConfig(targetPath)).toEqual({
        web: { trustProxy: true },
        assistant: { assistantName: "PiClaw" },
      });
      expect(readFileSync(targetPath, "utf8").endsWith("\n")).toBe(true);
    } finally {
      workspace.cleanup();
    }
  });
});
