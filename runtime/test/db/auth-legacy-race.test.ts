import { expect, test } from "bun:test";
import { withTempWorkspaceEnv } from "../helpers.js";

for (const mode of ["delete", "expire", "owner", "method", "created", "identity", "migrate", "id-delete", "id-expire", "id-owner", "id-method", "id-created", "null-method", "both-migrate", "id-migrate"]) {
  test(`legacy repair revalidates committed state: ${mode}`, async () => {
    await withTempWorkspaceEnv("auth-legacy-race-", {}, async () => {
      const child = Bun.spawn([process.execPath, "--no-env-file", new URL("../fixtures/auth-legacy-race.ts", import.meta.url).pathname, "reader", mode], {
        env: { ...process.env, PICLAW_DB_IN_MEMORY: "0", PI_OFFLINE: "1", OTEL_SDK_DISABLED: "true" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
      try {
        const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(exit, stderr).toBe(0);
        const receipt = JSON.parse(stdout.trim().split("\n").at(-1)!);
        expect(receipt).toMatchObject({ mode, repairReached: true, selectedOld: true, error: null, status: "pass" });
        expect(receipt.returned).toBe(mode === "migrate" || mode === "id-migrate" || mode === "both-migrate");
        expect(stdout + stderr).not.toContain("synthetic-legacy");
      } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
    });
  }, 25000);
}
