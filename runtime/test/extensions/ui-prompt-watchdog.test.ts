import { afterEach, beforeEach, expect, test } from "bun:test";

import { createUiPromptWatchdogExtension } from "../../src/extensions/ui-prompt-watchdog.js";
import {
  beginTrackedPhase,
  getTrackedPhasesSnapshot,
  resetProgressWatchdogForTests,
} from "../../src/runtime/progress-watchdog.js";
import { createFakeExtensionApi } from "./fake-extension-api.js";

beforeEach(resetProgressWatchdogForTests);
afterEach(resetProgressWatchdogForTests);

function setup(chatJid = "web:test") {
  const fake = createFakeExtensionApi();
  createUiPromptWatchdogExtension(chatJid)(fake.api);
  const fire = (event: string, payload: Record<string, unknown> = {}) => {
    for (const registration of fake.handlers.filter((entry) => entry.event === event)) {
      registration.handler(payload, {});
    }
  };
  return { ...fake, fire };
}

test.each(["select", "confirm", "input", "editor", "custom"] as const)(
  "ui prompt watchdog suspends and resumes %s prompts",
  async (kind) => {
    const { fire } = setup();
    beginTrackedPhase("web:test", "tool_execution", { tool: "interactive" });
    const before = getTrackedPhasesSnapshot()[0];

    fire("ui_prompt_start", { reason: "ui_prompt", kind, title: "Choose" });
    expect(getTrackedPhasesSnapshot()[0]).toEqual({
      ...before,
      suspension: expect.objectContaining({ reason: "ui_prompt", metadata: { kind, title: "Choose" } }),
    });

    await Bun.sleep(2);
    fire("ui_prompt_end", { reason: "ui_prompt", kind, title: "Choose" });
    const resumed = getTrackedPhasesSnapshot()[0];
    expect(resumed?.suspension).toBeUndefined();
    expect(resumed?.phase).toBe("tool_execution");
    expect(resumed?.startedAt).toBe(before?.startedAt);
    expect(resumed?.metadata).toEqual(before?.metadata);
    expect(resumed?.lastProgressAt ?? 0).toBeGreaterThan(before?.lastProgressAt ?? 0);
  },
);

test("ui prompt watchdog handles duplicate and nested prompt lifecycle without early resume", () => {
  const { fire } = setup();
  beginTrackedPhase("web:test", "prompt", { source: "test" });

  fire("ui_prompt_start", { reason: "ui_prompt", kind: "select" });
  const first = getTrackedPhasesSnapshot()[0];
  fire("ui_prompt_start", { reason: "ui_prompt", kind: "confirm" });
  expect(getTrackedPhasesSnapshot()[0]).toEqual(first);

  fire("ui_prompt_end", { reason: "ui_prompt", kind: "confirm" });
  expect(getTrackedPhasesSnapshot()[0]?.suspension?.reason).toBe("ui_prompt");
  fire("ui_prompt_end", { reason: "ui_prompt", kind: "select" });
  expect(getTrackedPhasesSnapshot()[0]?.suspension).toBeUndefined();

  fire("ui_prompt_end", { reason: "ui_prompt", kind: "select" });
  expect(getTrackedPhasesSnapshot()[0]?.suspension).toBeUndefined();
});

test.each(["agent_settled", "session_shutdown"])("ui prompt watchdog clears suspension on %s", (event) => {
  const { fire } = setup();
  beginTrackedPhase("web:test", "streaming", { source: "test" });
  fire("ui_prompt_start", { reason: "ui_prompt", kind: "custom" });
  expect(getTrackedPhasesSnapshot()[0]?.suspension?.reason).toBe("ui_prompt");

  fire(event);
  expect(getTrackedPhasesSnapshot()[0]?.suspension).toBeUndefined();
});

test("ui prompt watchdog is inert without a chat identity", () => {
  const fake = createFakeExtensionApi();
  createUiPromptWatchdogExtension()(fake.api);
  expect(fake.handlers).toEqual([]);
});
