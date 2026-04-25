import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStorage, ModelRegistry, SettingsManager, getAgentDir } from "@mariozechner/pi-coding-agent";
import "../helpers.js";
import { createSessionInDir } from "../../src/agent-pool/session.ts";

describe("bundled extension gating by channel/platform", () => {
  test("web viewer tools stay web-only without importing the heavy route extensions during session bootstrap", async () => {
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const settingsManager = SettingsManager.create("/workspace", getAgentDir());
    const tempRoot = mkdtempSync(join(tmpdir(), "piclaw-session-gating-"));
    const webSessionDir = join(tempRoot, "web-session");
    const whatsappSessionDir = join(tempRoot, "wa-session");
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((value) => String(value)).join(" "));
    };

    try {
      const webRuntime = await createSessionInDir(webSessionDir, {
        authStorage,
        modelRegistry,
        settingsManager,
        tools: [],
        chatJid: "web:test",
      });
      const whatsappRuntime = await createSessionInDir(whatsappSessionDir, {
        authStorage,
        modelRegistry,
        settingsManager,
        tools: [],
        chatJid: "whatsapp:test",
      });

      const webSession: any = webRuntime.session;
      const whatsappSession: any = whatsappRuntime.session;

      expect(webSession._toolRegistry.has("open_office_viewer")).toBe(true);

      expect(whatsappSession._toolRegistry.has("open_office_viewer")).toBe(false);

      expect(webSession._toolRegistry.has("powershell")).toBe(false);
      expect(whatsappSession._toolRegistry.has("powershell")).toBe(false);
      expect(warnings.some((line) => line.includes("[office-viewer] WARNING"))).toBe(false);

      webRuntime.dispose?.();
      whatsappRuntime.dispose?.();
    } finally {
      console.warn = originalWarn;
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
