import { expect, test } from "bun:test";

import {
  mergeSavedSettings,
  SettingsSaveGeneration,
} from "../../web/static/visual/frontend/src/panels/settings/save-state.js";

test("workspace save responses replace nested workspace settings and preserve unrelated data", () => {
  const current = {
    assistantName: "Piclaw",
    workspaceSettings: {
      webTerminalEnabled: false,
      vncAllowDirect: true,
      treeMaxDepth: 4,
      treeMaxEntries: 5000,
    },
  };

  expect(mergeSavedSettings(current, "workspace", "webTerminalEnabled", {
    webTerminalEnabled: true,
    vncAllowDirect: false,
    treeMaxDepth: 6,
    treeMaxEntries: 6000,
  } as any)).toEqual({
    assistantName: "Piclaw",
    workspaceSettings: {
      webTerminalEnabled: true,
      vncAllowDirect: true,
      treeMaxDepth: 4,
      treeMaxEntries: 5000,
    },
  });
  expect(current.workspaceSettings.webTerminalEnabled).toBe(false);
});

test("non-workspace save responses retain the existing top-level merge contract", () => {
  expect(mergeSavedSettings({
    assistantName: "Old",
    workspaceSettings: { webTerminalEnabled: true },
  }, "general", "assistantName", {
    assistantName: "New",
  })).toEqual({
    assistantName: "New",
    workspaceSettings: { webTerminalEnabled: true },
  });
});

test("save generations accept only the newest response per endpoint", () => {
  const generations = new SettingsSaveGeneration();
  const firstTerminal = generations.begin("workspace", "webTerminalEnabled");
  const vnc = generations.begin("workspace", "vncAllowDirect");
  const secondTerminal = generations.begin("workspace", "webTerminalEnabled");

  expect(generations.isCurrent("workspace", "webTerminalEnabled", firstTerminal)).toBe(false);
  expect(generations.isCurrent("workspace", "webTerminalEnabled", secondTerminal)).toBe(true);
  expect(generations.isCurrent("workspace", "vncAllowDirect", vnc)).toBe(true);
});
