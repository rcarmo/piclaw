import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ensureTestFilesystemIsolation } from "../../../runtime/scripts/test-filesystem-isolation.js";

// Caller identity is mandatory: import.meta here identifies the helper, not the fixture.
export function isolatedApplicationTest(caller: string) {
  const file = caller.startsWith("file:") ? fileURLToPath(caller) : caller;
  const directory = dirname(file);
  const cases = new Set<string>();
  return (title: string, body: () => unknown | Promise<unknown>, timeout = 30_000) => {
    const scenario = `${file}::${title}`;
    if (cases.has(scenario)) throw Error(`Duplicate isolated application scenario: ${scenario}`);
    cases.add(scenario);
    const selected = process.env.PICLAW_ISOLATED_APPLICATION_CASE;
    if (selected && selected !== scenario) return;
    const scenarioTimeout = Math.min(timeout, 60_000);
    // The child's Bun test owns the scenario deadline. The parent must also
    // allow bounded process launch/import and cleanup; killing it after 4s for
    // a 5s scenario discarded still-valid cold-start assertion receipts.
    const parentTimeout = scenarioTimeout + 10_000;
    test(title, async () => {
      if (selected) {
        expect(process.env.PICLAW_TEST_FS_ISOLATION_ROOT).not.toBe(process.env.PICLAW_ISOLATED_APPLICATION_PARENT_ROOT);
        await body();
        return;
      }
      const env = { ...process.env };
      delete env.PICLAW_TEST_FS_ISOLATION_ACTIVE;
      delete env.PICLAW_TEST_FS_ISOLATION_ROOT;
      const isolation = ensureTestFilesystemIsolation(env);
      try {
        expect(isolation.root).not.toBe(process.env.PICLAW_TEST_FS_ISOLATION_ROOT);
        // Every child enters the central local-test-priority launcher.
        const child = Bun.spawn([process.execPath, resolve(directory, "../../runtime/scripts/local-test-priority.ts"), "--cwd", directory, "--", "bun", "test", file], {
          cwd: dirname(file),
          env: { ...env, PICLAW_ISOLATED_APPLICATION_CASE: scenario,
            PICLAW_ISOLATED_APPLICATION_PARENT_ROOT: process.env.PICLAW_TEST_FS_ISOLATION_ROOT ?? "" },
          stdout: "pipe", stderr: "pipe",
        });
        const timer = setTimeout(() => child.kill(), parentTimeout - 1000);
        try {
          const [code, out, err] = await Promise.all([child.exited,
            new Response(child.stdout).text(), new Response(child.stderr).text()]);
          // Keep the child's assertion receipt visible, including on success.
          process.stdout.write(out);
          process.stderr.write(err);
          expect(code, `Isolated application ${scenario}`).toBe(0);
        } finally { clearTimeout(timer); }
      } finally { isolation.cleanup(); }
    }, selected ? scenarioTimeout : parentTimeout);
  };
}
