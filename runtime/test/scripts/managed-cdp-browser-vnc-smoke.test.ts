import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const runtimeRoot = resolve(import.meta.dir, "../..");
const smoke = readFileSync(resolve(runtimeRoot, "scripts/managed-cdp-browser-vnc-smoke.ts"), "utf8");
const skill = readFileSync(resolve(runtimeRoot, "skills/integrations/cdp-browser-vnc-setup/SKILL.md"), "utf8");

test("managed CDP browser smoke exercises the production lifecycle and loopback protocols", () => {
  expect(smoke).toContain("new ManagedCdpBrowserDesktop");
  expect(smoke).toContain("http://127.0.0.1:${prepared.cdpPort}/json/version");
  expect(smoke).toContain('connect({ host: "127.0.0.1", port })');
  expect(smoke).toContain("Promise.all([\n    openVncGreeting");
  expect(smoke).toContain('greeting.startsWith("RFB ")');
  expect(smoke).toContain("concurrentViewers: viewers.length");
  expect(smoke).toContain("stateMode !== 0o600");
  expect(smoke).toContain("service.shutdown()");
  expect(smoke).toContain("remained open after shutdown");
});

test("setup skill documents managed Linux and bring-your-own workflows", () => {
  expect(skill).toContain("name: cdp-browser-vnc-setup");
  expect(skill).toContain("piclaw://vnc/cdp-browser");
  expect(skill).toContain("sudo apt install xvfb x11vnc xauth chromium");
  expect(skill).toContain("macOS and Windows");
  expect(skill).toContain("managed-cdp-browser-vnc-smoke.ts");
  expect(skill).toContain("--no-sandbox");
});
