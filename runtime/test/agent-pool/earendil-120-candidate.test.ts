/** Candidate-only exact-target probes; historical 1.0.0 fixtures stay intact. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace } from "../helpers.js";
const version = JSON.parse(readFileSync(join(import.meta.dir, "../../../node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8")).version;
test("candidate dependency target is exactly 1.5.2", () => { expect(version).toBe("1.5.2"); });
async function run(fixture: string, args: string[], env: Record<string, string> = {}, cwd?: string) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", join(import.meta.dir, "fixtures/earendil-120-offline-guard.ts"), join(import.meta.dir, "fixtures", fixture), ...args], {
    cwd, env: { PATH: process.env.PATH, HOME: "/nonexistent", PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true", PICLAW_DB_IN_MEMORY: "1", ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, stderr || stdout).toBe(0); expect(stderr).toBe("");
    expect(stdout + stderr).not.toContain("SYNTHETIC_BEARER_");
    return JSON.parse(stdout.trim().split("\n").at(-1)!);
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
}
for (const mode of ["success", "failed-initial", "failed-reload", "commit-failure", "unbound", "overlap", "disposed-barrier", "failed-barrier", "shutdown-error", "runtime-dispose"]) {
  test(`1.5.2 candidate bridge lease lifecycle: ${mode}`, async () => {
    const ws = createTempWorkspace("candidate-120-bridge-");
    try { const result = await run("mcp-bridge-reload-120.ts", [mode, "3", "plain", ws.workspace]); expect(result).toMatchObject({ mode, version: "1.5.2", adapterVersion: "2.31.0", status: "pass", network: 0 }); expect(result.released).toBe(result.acquired); }
    finally { ws.cleanup(); }
  }, 25_000);
}
for (const exposure of ["deferred", "codemode"]) {
  test(`1.5.2 candidate real MCP/tool pipeline: ${exposure}`, async () => {
    const ws = createTempWorkspace("candidate-120-public-");
    try {
      const result = await run("mcp-public-runtime-120.ts", [exposure], { MCP_PUBLIC_FIXTURE_ROOT: ws.workspace });
      expect(result).toMatchObject({ version: "1.5.2", exposure, scriptedResponses: 14, networkAttempts: 0, nestedPolicyAndParentId: true, hiddenInvocationBlocked: true, sessionAndHistoryPreserved: true, transportsClosed: true });
    } finally { ws.cleanup(); }
  }, 25_000);
}
test("1.5.2 public OAuth callback path/state isolation on owned loopback", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", join(import.meta.dir, "fixtures/earendil-120-callback-guard.ts"), join(import.meta.dir, "fixtures/earendil-120-callback.ts")], {
    env: { PATH: process.env.PATH, HOME: "/nonexistent", PI_OFFLINE: "1", OTEL_SDK_DISABLED: "true" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, stderr || stdout).toBe(0); expect(stderr).toBe(""); const result = JSON.parse(stdout);
    expect(result.passed).toHaveLength(8); expect(result.guard).toMatchObject({ externalAttempts: 0, childAttempts: 0, servers: 1, closed: 1 });
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
}, 15_000);
for (const mode of ["disabled-trusted", "disabled-untrusted", "exposure", "invalid-extra", "replacement"]) {
  test(`1.5.2 public project MCP override: ${mode}`, async () => {
    const ws = createTempWorkspace("candidate-120-overrides-");
    try {
      const result = await run("earendil-120-overrides.ts", [mode], { CANDIDATE_102_ROOT: ws.workspace });
      expect(result).toMatchObject({ version: "1.5.2", mode, configUnmodified: true, guard: { networkAttempts: 0, childProcessAttempts: 0 } });
    } finally { ws.cleanup(); }
  }, 25_000);
}
test("1.5.2 native transport close failure is retained as a teardown blocker", async () => {
  const ws = createTempWorkspace("candidate-120-close-failure-");
  try {
    const result = await run("earendil-120-close-failure.ts", [], { CANDIDATE_102_ROOT: ws.workspace });
    expect(result).toMatchObject({ version: "1.5.2", closeFailureObserved: true, reloadResolved: true, firstTransportClosed: false, secondTransportClosed: true, surfacedErrors: 0 });
  } finally { ws.cleanup(); }
}, 25_000);
