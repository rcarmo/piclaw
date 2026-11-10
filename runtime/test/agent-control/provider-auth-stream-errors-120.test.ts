import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
for (const mode of ["refresh-permanent", "refresh-transient", "malformed-storage", "storage-eacces", "storage-elocked", "unknown-resolution", "missing-config", "refresh-retry-success"]) {
  test(`public runtime credential error isolation: ${mode}`, async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", resolve(import.meta.dir, "../setup-filesystem-isolation.ts"), resolve(import.meta.dir, "fixtures/provider-auth-stream-errors-120.ts"), mode], {
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/nonexistent", PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true" }, stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    try {
      const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, err).toBe(0);
      const result = JSON.parse(out);
      expect(result).toMatchObject({ version: "1.5.2", mode, networkRequests: 0, inference: 0, logsRedacted: true });
      expect(result.results.every((row: { status: string }) => row.status === "pass")).toBe(true);
      expect(result.results.map((row: { method: string }) => row.method)).toEqual(mode === "refresh-retry-success" ? ["getAuth"] : ["stream", "streamSimple"]);
      expect(out).not.toContain("PRIVATE-STREAM-CREDENTIAL-SENTINEL");
      expect(err).not.toContain("PRIVATE-STREAM-CREDENTIAL-SENTINEL");
    } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
  }, 20_000);
}
