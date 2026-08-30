import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import "../helpers.js";
import { createSessionInDir } from "../../src/agent-pool/session.ts";
import { createRealTestModelServices } from "../model-services-fixture.js";

describe("bundled extension gating by channel/platform", () => {
  test("removed viewer tools stay out of bundled session bootstrap while platform-gated tools remain gated", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "piclaw-session-gating-"));
    const { modelRuntime } = await createRealTestModelServices(join(tempRoot, "agent"));
    const settingsManager = SettingsManager.create("/workspace", getAgentDir());
    const webSessionDir = join(tempRoot, "web-session");
    const whatsappSessionDir = join(tempRoot, "wa-session");
    const workspaceDir = join(tempRoot, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((value) => String(value)).join(" "));
    };

    try {
      const webRuntime = await createSessionInDir(webSessionDir, {
        modelRuntime,
        settingsManager,
        tools: [],
        chatJid: "web:test",
        cwd: workspaceDir,
      });
      const whatsappRuntime = await createSessionInDir(whatsappSessionDir, {
        modelRuntime,
        settingsManager,
        tools: [],
        chatJid: "whatsapp:test",
        cwd: workspaceDir,
      });

      const webSession: any = webRuntime.session;
      const whatsappSession: any = whatsappRuntime.session;

      expect(webSession._toolRegistry.has("open_office_viewer")).toBe(false);
      expect(whatsappSession._toolRegistry.has("open_office_viewer")).toBe(false);

      expect(webSession._toolRegistry.has("powershell")).toBe(true);
      expect(whatsappSession._toolRegistry.has("powershell")).toBe(true);
      expect(webSession.getActiveToolNames()).not.toContain("powershell");
      expect(whatsappSession.getActiveToolNames()).not.toContain("powershell");
      expect(warnings.some((line) => line.includes("[office-viewer] WARNING"))).toBe(false);

      webRuntime.dispose?.();
      whatsappRuntime.dispose?.();
    } finally {
      console.warn = originalWarn;
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 15000);
});
