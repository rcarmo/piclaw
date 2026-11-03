import { expect, test } from "bun:test";
import { withTempWorkspaceEnv, waitFor } from "../helpers.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test("two processes initialize the same empty database without corruption", async () => {
  await withTempWorkspaceEnv("db-startup-race-", {}, async ws => {
    const go = join(ws.base, "go");
    const ready = [join(ws.base, "left"), join(ws.base, "right")];
    const resume = ready.map(path => path + ".resume");
    const children = ready.map((path, index) => Bun.spawn([process.execPath, "--no-env-file", new URL("../fixtures/db-startup-concurrent.ts", import.meta.url).pathname, path, go, resume[index]], {
      env: { ...process.env, PICLAW_DB_IN_MEMORY: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    }));
    const timer = setTimeout(() => { for (const child of children) child.kill("SIGKILL"); }, 20000);
    const results = children.map(async child => ({ exit: await child.exited, stdout: await new Response(child.stdout).text(), stderr: await new Response(child.stderr).text() }));
    try {
      await waitFor(() => ready.every(existsSync), 5000); writeFileSync(go, "go");
      await waitFor(() => ready.every(path => existsSync(path + ".attempt")), 5000);
      for (let index = 0; index < results.length; index++) {
        expect(["ready", "busy"]).toContain(JSON.parse(readFileSync(ready[index] + ".attempt", "utf8")).outcome);
        writeFileSync(resume[index], "go");
        const result = await results[index];
        expect(result.exit, result.stderr).toBe(0); expect(result.stdout).toContain("CONCURRENT_INIT_OK");
      }
    } finally { clearTimeout(timer); for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); await Promise.all(results); }
  });
}, 25000);

for (const mode of ["fresh", "empty-file", "existing", "rollback", "late-rollback", "existing-rollback"]) {
  test(`disk startup batching: ${mode}`, async () => {
    await withTempWorkspaceEnv("db-startup-contract-", {}, async () => {
      const child = Bun.spawn([process.execPath, "--no-env-file", new URL("../fixtures/db-startup-contracts.ts", import.meta.url).pathname, mode], {
        env: { ...process.env, PICLAW_DB_IN_MEMORY: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
      try {
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(exit, stderr).toBe(0);
        const receipt = JSON.parse(stdout.split("\n").find(line => line.startsWith('{"mode"'))!);
        expect(receipt).toMatchObject({ mode, vacuums: 0, schemaStable: true, rowsAndFtsPreserved: true });
      } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
    });
  }, 25_000);
}
