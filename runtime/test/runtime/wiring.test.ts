import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import { createTempWorkspace, importFresh, setEnv } from "../helpers.js";
import { createRuntimeSenders, getDreamQueueLane } from "../../src/runtime/wiring.js";

let restoreEnv: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
});

describe("runtime wiring", () => {
  test("getDreamQueueLane isolates Dream work from the interactive chat lane", () => {
    expect(getDreamQueueLane("web:default")).toBe("dream:web:default");
    expect(getDreamQueueLane("web:default")).not.toBe("chat:web:default");
  });

  test("createRuntimeSenders routes web chat messages to web channel", async () => {
    const webCalls: Array<{ jid: string; text: string; source?: string }> = [];
    const whatsappCalls: Array<{ jid: string; text: string }> = [];

    const senders = createRuntimeSenders(
      {
        sendMessage: async (jid, text, options) => {
          webCalls.push({ jid, text, source: options?.source });
        },
        resumeChat: () => {},
        resumePendingChats: () => {},
      },
      {
        sendMessage: async (jid, text) => {
          whatsappCalls.push({ jid, text });
        },
      },
      null
    );

    await senders.sendMessage("web:default", "hello", { source: "scheduled" });

    expect(webCalls).toHaveLength(1);
    expect(webCalls[0]).toEqual({ jid: "web:default", text: "hello", source: "scheduled" });
    expect(whatsappCalls).toHaveLength(0);
  });

  test("createRuntimeSenders routes non-web chat messages to whatsapp channel", async () => {
    const webCalls: Array<{ jid: string; text: string }> = [];
    const whatsappCalls: Array<{ jid: string; text: string }> = [];

    const senders = createRuntimeSenders(
      {
        sendMessage: async (jid, text) => {
          webCalls.push({ jid, text });
        },
        resumeChat: () => {},
        resumePendingChats: () => {},
      },
      {
        sendMessage: async (jid, text) => {
          whatsappCalls.push({ jid, text });
        },
      },
      null
    );

    await senders.sendMessage("12345@s.whatsapp.net", "hi");

    expect(webCalls).toHaveLength(0);
    expect(whatsappCalls).toEqual([{ jid: "12345@s.whatsapp.net", text: "hi" }]);
  });

  test("workspaceNeedsDreamBootstrap only requires the core Dream memory files", async () => {
    const ws = createTempWorkspace("piclaw-runtime-wiring-");
    restoreEnv = setEnv({
      PICLAW_WORKSPACE: ws.workspace,
      PICLAW_STORE: ws.store,
      PICLAW_DATA: ws.data,
    });

    const wiring = await importFresh<typeof import("../src/runtime/wiring.js")>("../src/runtime/wiring.js");
    expect(wiring.workspaceNeedsDreamBootstrap()).toBe(true);

    mkdirSync(join(ws.workspace, "notes", "memory"), { recursive: true });
    writeFileSync(join(ws.workspace, "notes", "memory", "MEMORY.md"), "# MEMORY\n", "utf8");
    writeFileSync(join(ws.workspace, "notes", "memory", "current-state.md"), "# Current Dream state\n", "utf8");
    writeFileSync(join(ws.workspace, "notes", "memory", "recent-context.md"), "# Recent context\n", "utf8");

    let wiringFresh = await importFresh<typeof import("../src/runtime/wiring.js")>("../src/runtime/wiring.js");
    expect(wiringFresh.workspaceNeedsDreamBootstrap()).toBe(false);

    mkdirSync(join(ws.workspace, "notes", "daily"), { recursive: true });
    const recentDay = new Date();
    recentDay.setUTCDate(recentDay.getUTCDate() - 1);
    const year = recentDay.getUTCFullYear();
    const month = String(recentDay.getUTCMonth() + 1).padStart(2, "0");
    const day = String(recentDay.getUTCDate()).padStart(2, "0");
    const dayKey = `${year}-${month}-${day}`;
    const firstIso = `${dayKey}T10:00:00.000Z`;
    const lastIso = `${dayKey}T10:05:00.000Z`;
    const dayPath = join(ws.workspace, "notes", "daily", `${dayKey}.md`);
    writeFileSync(
      dayPath,
      `---\ndate: ${dayKey}\nsummarised_until:\nmessages_total: 2\nmessages_user: 1\nmessages_assistant: 1\nsession_trees: 1\nsession_chats: 1\nfirst_message: ${firstIso}\nlast_message: ${lastIso}\nscope_mode: all-chats\nscope_anchor: *\n---\n# ${dayKey}\n\n## Summary\n\n<!-- NEEDS_SUMMARY -->\n`,
      "utf8",
    );

    wiringFresh = await importFresh<typeof import("../src/runtime/wiring.js")>("../src/runtime/wiring.js");
    expect(wiringFresh.workspaceNeedsDreamBootstrap()).toBe(false);

    writeFileSync(
      dayPath,
      `---\ndate: ${dayKey}\nsummarised_until: ${lastIso}\nmessages_total: 2\nmessages_user: 1\nmessages_assistant: 1\nsession_trees: 1\nsession_chats: 1\nfirst_message: ${firstIso}\nlast_message: ${lastIso}\nscope_mode: all-chats\nscope_anchor: *\n---\n# ${dayKey}\n\n## Summary\n\nA complete daily summary.\n`,
      "utf8",
    );

    wiringFresh = await importFresh<typeof import("../src/runtime/wiring.js")>("../src/runtime/wiring.js");
    expect(wiringFresh.workspaceNeedsDreamBootstrap()).toBe(false);

    ws.cleanup();
  });

  test("createRuntimeSenders exposes optional sendNudge when pushover exists", async () => {
    const nudges: string[] = [];

    const senders = createRuntimeSenders(
      {
        sendMessage: async () => {},
        resumeChat: () => {},
        resumePendingChats: () => {},
      },
      {
        sendMessage: async () => {},
      },
      {
        sendMessage: async (_jid, text) => {
          nudges.push(text);
        },
      }
    );

    await senders.sendNudge?.("nudge");
    expect(nudges).toEqual(["nudge"]);
  });
});
