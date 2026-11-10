import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fingerprints = {
  "anthropic.js": "835268caed5dab6a0c7f157c551ed59a00635c76305e6e0c41b579c41aa07bc5",
  "openrouter.js": "b69e807ed855095aa17b2c0d1a15f350c77e3a49f2a66853f227916daacb4703",
  "callback-server.js": "2dda468f4937edcf7bb5e8528de4bf7753efbe5b48610a3f9ea47ff2c4908ede",
  "pkce.js": "d54668654e89d6fe6994a09a7f9399e732a411fcb31c99eb8b5e60349763708c"
};
const browserModes = ["manual-success", "callback-success", "callback-invalid-first", "callback-denied", "token-denied", "malformed-json", "cancel-prompt", "cancel-exchange", "pre-abort"];
const copyModes = ["code-state", "bare-code", "query", "callback-url", "unrelated-url", "empty", "bad-state", "denied", "malformed-json", "cancel-prompt", "cancel-exchange", "refresh-denied", "cancel-refresh", "unknown-selection", "cancel-selection", "pre-abort-selection", "pre-abort-manual"];

test("1.5.1 browser/copy-code receipt pins public implementation and distinct behaviour", () => {
  const receipt = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-151-provider-browser-bun.json"), "utf8"));
  expect(receipt).toMatchObject({ version: "1.5.1", runtime: "Bun 1.4.4", scope: "public_anthropic_browser_copy_code_and_openrouter_methods_only",
    bootstrapRequests: 0, credentialPersistence: "none", inference: "not_invoked", networkGuard: "distinct_loopback_only_os_namespace_guarded_fetch_and_owned_ipv4_callbacks" });
  expect(receipt.sdkFileSha256).toEqual(fingerprints);
  const root = import.meta.resolve("@earendil-works/pi-ai");
  for (const [file, sha] of Object.entries(fingerprints)) expect(createHash("sha256").update(readFileSync(fileURLToPath(new URL(`auth/oauth/${file}`, root)))).digest("hex")).toBe(sha);
  expect(receipt.results.map((row: { provider: string; mode: string }) => [row.provider, row.mode])).toEqual(
    ["anthropic", "openrouter"].flatMap(provider => [...browserModes, provider === "anthropic" ? "manual-bad-state" : "missing-key"].map(mode => [provider, mode])));
  for (const row of receipt.results) {
    expect(row.status).toBe("pass"); expect(row.requests.unexpected).toBe(0);
    expect(row.selectionPrompts).toBe(row.provider === "anthropic" ? 1 : 0);
    const exchanged = !["cancel-prompt", "callback-denied", "manual-bad-state", "pre-abort"].includes(row.mode);
    const success = ["manual-success", "callback-success", "callback-invalid-first"].includes(row.mode);
    expect(row.requests.exchange).toBe(exchanged ? 1 : 0);
    expect(row.requests.callback).toBe(row.mode === "callback-invalid-first" ? 2 : row.mode.startsWith("callback-") ? 1 : 0);
    expect(row.requests.refresh).toBe(row.provider === "anthropic" && success ? 1 : 0);
    expect(row.pkceVerified).toBe(exchanged);
    expect(row.manualPromptCancelled).toBe(row.mode.startsWith("callback-") || row.mode === "cancel-prompt");
    expect(row.callbackServerReleased).toBe(row.mode !== "pre-abort");
    expect(row.preAbortNotificationObserved).toBe(false);
    expect(row.preAbortRejectionOwner).toBe(row.mode === "pre-abort" ? row.provider === "anthropic" ? "host_selection_prompt" : "sdk_before_notification" : "not_applicable");
    expect(row.lateEvents).toBe(0); expect(row.lateRequests).toBe(0); expect(row.postSettlementObservationMs).toBe(100);
    expect(row.transportCancellationObserved).toBe(row.mode === "cancel-exchange");
  }
  expect(receipt.copyCodeResults.map((row: { mode: string }) => row.mode)).toEqual(copyModes);
  for (const row of receipt.copyCodeResults) {
    const noPrompt = ["unknown-selection", "cancel-selection", "pre-abort-selection"].includes(row.mode);
    const noExchange = noPrompt || ["empty", "bad-state", "cancel-prompt", "pre-abort-manual"].includes(row.mode);
    const success = ["code-state", "bare-code", "query", "callback-url", "unrelated-url", "refresh-denied", "cancel-refresh"].includes(row.mode);
    expect(row.status).toBe("pass"); expect(row.requests.unexpected).toBe(0); expect(row.requests.selection).toBe(1);
    expect(row.requests.manual).toBe(noPrompt ? 0 : 1); expect(row.requests.url).toBe(noPrompt ? 0 : 1);
    expect(row.requests.exchange).toBe(noExchange ? 0 : 1); expect(row.requests.refresh).toBe(success ? 1 : 0);
    expect(row.noListenerAtBoundaries).toBe(true); expect(row.fixedExchangeRedirect).toBe(!noExchange);
    expect(row.providedStateValidated).toBe(row.mode === "bad-state");
    expect(row.transportCancellationObserved).toBe(["cancel-exchange", "cancel-refresh"].includes(row.mode));
    expect(row.manualCancellationObserved).toBe(row.mode === "cancel-prompt");
    expect(row.preAbortRejectionOwner).toBe(row.mode === "pre-abort-selection" ? "host_selection_prompt" : row.mode === "pre-abort-manual" ? "host_manual_prompt_after_sdk_notification" : "not_applicable");
    expect(row.lateEvents).toBe(0); expect(row.lateRequests).toBe(0); expect(row.postSettlementObservationMs).toBe(100);
  }
});

test("1.5.1 browser fixture refuses an ordinary network namespace before SDK imports", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/provider-browser-matrix-120.mjs")], {
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: "/nonexistent", SYNTHETIC_PARENT_NETNS: readlinkSync("/proc/self/ns/net"), SYNTHETIC_EXPECT_UID: String(process.getuid?.()) }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).not.toBe(0); expect(out).toBe(""); expect(err).toContain("A distinct network namespace is required.");
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
});
