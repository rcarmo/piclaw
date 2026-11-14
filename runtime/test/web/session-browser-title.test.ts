import { expect, test } from "bun:test";

import { formatSessionBrowserTitle } from "../../web/src/ui/browser-title.js";

const cases: Array<[unknown, unknown, string]> = [
  ["Smith", "research", "Smith - @research"],
  [" Smith ", "@research", "Smith - @research"],
  ["Smith", "", "Smith"],
  ["", null, "PiClaw"],
];

test("browser title appends the active session handle", () => {
  for (const [agentName, sessionHandle, expected] of cases) {
    expect(formatSessionBrowserTitle(agentName, sessionHandle)).toBe(expected);
  }
});
