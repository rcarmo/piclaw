import { expect, test } from "bun:test";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { assertNoTestMounts, ensureTestFilesystemIsolation } from "../../scripts/test-filesystem-isolation.js";
import { requireDisposableTestTarget } from "../../scripts/test-target.js";
import { requireFixturePaths } from "../../../tests/e2e/setup/fixture-paths.js";

test("cleanup refuses mountpoints and descendants but not siblings", () => {
  const info = "22 1 0:21 / /tmp/root/merged rw - overlay overlay rw\n";
  expect(() => assertNoTestMounts("/tmp/root", info)).toThrow("active mount");
  expect(() => assertNoTestMounts("/tmp/root/merged", info)).toThrow("active mount");
  expect(() => assertNoTestMounts("/tmp/root-other", info)).not.toThrow();
  expect(() => assertNoTestMounts("/tmp/with space", "22 1 0:21 / /tmp/with\\040space/merged rw - overlay overlay rw")).toThrow();
});

test("injected provider and SSH credentials never enter test children", () => {
  const env: Record<string, string | undefined> = { ...process.env, PICLAW_TEST_FS_ISOLATION_ACTIVE: "0", GITHUB_PICLAW_BOT: "secret", PORTAINER_RELAY: "secret", GITHUB_PICLAW_BOT_PAT: "secret", AZURE_ACCOUNT_KEY: "secret", GOOGLE_GENERATIVE_AI_API_KEY: "secret", SSH_AZUREVM: "secret", CUSTOM_PASSWORD: "secret", GITHUB_TOKEN: "secret" };
  const iso = ensureTestFilesystemIsolation(env);
  try {
    for (const name of ["AZURE_ACCOUNT_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "SSH_AZUREVM", "CUSTOM_PASSWORD", "GITHUB_TOKEN", "GITHUB_PICLAW_BOT_PAT", "GITHUB_PICLAW_BOT", "PORTAINER_RELAY"]) expect(env[name]).toBeUndefined();
  } finally { iso.cleanup(); }
});

test("external UI targets require both explicit URL and disposable declaration", () => {
  for (const [url, env] of [[undefined, {}], ["http://localhost:8080", {}], [undefined, { PICLAW_E2E_DISPOSABLE: "1" }]] as const) {
    expect(() => requireDisposableTestTarget(url, env)).toThrow();
  }
  for (const url of ["file:///tmp/test", "http://secret@localhost:9999", "http://localhost:9999/private", "http://localhost:9999/?secret=x"]) {
    expect(() => requireDisposableTestTarget(url, { PICLAW_E2E_DISPOSABLE: "1" })).toThrow();
  }
  expect(requireDisposableTestTarget("http://127.0.0.1:9876/", { PICLAW_E2E_DISPOSABLE: "1" })).toBe("http://127.0.0.1:9876");
});

test("provider setup rejects inherited live profile and validates explicit fixture", () => {
  expect(() => requireFixturePaths({ PICLAW_WORKSPACE: '/workspace', PICLAW_PI_AGENT_DIR: '/home/agent/.pi/agent' })).toThrow();
  const root = mkdtempSync('/tmp/test-e2e-owned-');
  try {
    writeFileSync(join(root, '.piclaw-e2e-fixture'), 'piclaw disposable e2e\n');
    const env = { PICLAW_E2E_DISPOSABLE: '1', PICLAW_E2E_FIXTURE_ROOT: root, PICLAW_WORKSPACE: join(root, 'workspace'), PICLAW_PI_AGENT_DIR: join(root, 'profile') };
    expect(requireFixturePaths(env).profile).toBe(join(root, 'profile'));
    expect(() => requireFixturePaths({ ...env, PICLAW_PI_AGENT_DIR: '/home/agent/.pi/agent' })).toThrow();
    symlinkSync('/workspace', join(root, 'workspace'), 'dir');
    expect(() => requireFixturePaths(env)).toThrow('Symlink');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("nested core test directory receives preload before runtime imports", () => {
  const root = mkdtempSync(join(tmpdir(), 'nested-test-audit-'));
  const probe = join(root, 'probe.ts');
  writeFileSync(probe, 'if (!process.env.PICLAW_TEST_FS_ISOLATION_ROOT) throw Error("no isolation");');
  try {
    const child = Bun.spawnSync([process.execPath, 'test', '--preload', probe, 'readme-docker-run.test.ts'], { cwd: resolve(import.meta.dir, '../runtime'), env: { ...process.env, PICLAW_TEST_FS_ISOLATION_ACTIVE: '0' }, stdout: 'pipe', stderr: 'pipe' });
    expect(child.exitCode, child.stderr.toString()).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("script tests bind source paths to their candidate checkout", () => {
  // Tests may use live paths for negative isolation probes, but must never
  // select a specific external checkout as the source for a script test.
  const checkout = /["']\/workspace\/piclaw(?:[\/"'])/;
  for (const file of readdirSync(import.meta.dir).filter(file => file.endsWith('.test.ts'))) {
    expect(readFileSync(join(import.meta.dir, file), 'utf8'), file).not.toMatch(checkout);
  }
});

test("container OOBE only removes its own returned ID and binds loopback", () => {
  const code = readFileSync(resolve(import.meta.dir, "../../scripts/playwright/oobe-local-container.ts"), "utf8");
  expect(code).toContain("['docker', 'rm', '-f', createdContainerId]");
  expect(code).not.toContain("['docker', 'rm', '-f', args.containerName]");
  expect(code).toContain("127.0.0.1:${hostPort}:8080");
});
