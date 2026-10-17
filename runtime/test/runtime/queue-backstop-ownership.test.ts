import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireRuntimeLock } from "../../src/runtime/single-instance.js";

for (const strict of [false, true]) {
  for (const mode of ["normal-exit", "backstop", "queue-timeout", "success"]) {
    test(`actual main/process exit ${mode} retains uncertified owner (strict=${strict})`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "queue-backstop-"));
      const lockPath = join(dir, "runtime.lock");
      const child = Bun.spawn([process.execPath, new URL("../fixtures/queue-backstop-owner.ts", import.meta.url).pathname, lockPath, mode, String(strict)], {
        env: { ...process.env }, stdout: "pipe", stderr: "pipe",
      });
      try {
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(code, stderr || stdout).toBe(0);
        const rows = stdout.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
        const acquired = rows.find(row => row.acquired)?.acquired;
        expect(acquired).toBeTruthy();
        const calls = rows.find(row => row.calls)?.calls;
        if (mode === "success") {
          expect(calls).toEqual(["pool", "web"]);
          expect(existsSync(lockPath)).toBe(false);
          acquireRuntimeLock({ lockPath, strictOwnership: strict, disabled: false }).release();
        } else {
          expect(calls).toEqual(mode === "queue-timeout" ? ["task"] : []);
          expect(readFileSync(lockPath, "utf8")).toBe(acquired);
          expect(() => acquireRuntimeLock({ lockPath, disabled: false })).toThrow(/Offline operator cleanup required/);
          if (mode === "queue-timeout") expect(rows.some(row => row.error === "QueueShutdownTimeoutError")).toBe(true);
          if (mode === "backstop") expect(stdout + stderr).toContain("Forcing shutdown after timeout");
        }
      } finally {
        child.kill();
        await child.exited;
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}
