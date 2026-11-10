import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const modes = ["pending-success", "denied", "malformed-device", "malformed-token", "blocked-cancel", "expiry", "slow-down", "unsafe-device-uri", "initial-wait-cancel", "pending-wait-cancel", "slow-wait-cancel"];
test("public Copilot and Kimi device methods execute synthetic polling, failure and cancellation matrix", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/provider-device-matrix-120.mjs")], {
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: "/nonexistent", PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true" }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, err).toBe(0); expect(err).toBe("");
    const executed = JSON.parse(out);
    expect(executed.version).toBe("1.5.2");
    expect(executed.runtime).toBe("Bun 1.4.4");
    expect(executed.scope).toBe("public_provider_device_methods_only");
    expect(executed.inference).toBe("not_invoked");
    expect(executed.networkGuard).toBe("fetch_interception_no_os_sandbox");
    expect(executed.results.map((row: any) => [row.provider, row.mode])).toEqual(["github-copilot", "kimi-coding"].flatMap(provider => modes.map(mode => [provider, mode])));
    expect(executed.results.every((row: any) => row.status === "pass" && row.requests.unexpected === 0)).toBe(true);
    expect(executed.modelPolicyWrites).toBe("none");
    expect(executed.credentialPersistence).toBe("none");
    for (const runtime of ["bun"]) {
      const archived = JSON.parse(readFileSync(resolve(import.meta.dir, `../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-152-provider-devices-${runtime}.json`), "utf8"));
      expect(archived.version).toBe("1.5.2");
      expect(archived.runtime).toBe("Bun 1.4.4");
      expect(archived.results).toEqual(executed.results);
      expect(archived.sdkFileSha256).toEqual(executed.sdkFileSha256);
      expect(archived.runtime).toMatch(runtime === "node" ? /^Node / : /^Bun /);
    }
    expect(out).not.toContain("SYNTHETIC-CODE");
    expect(out).not.toContain("synthetic-kimi-access");
    expect(out).not.toContain("synthetic-github-refresh");
  } finally {
    clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited;
  }
}, 35_000);
