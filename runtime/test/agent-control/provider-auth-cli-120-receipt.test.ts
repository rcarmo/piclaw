import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(import.meta.dir, "../../..");
const artifactPath = resolve(root, "runtime/test/fixtures/earendil-package-admission/cli-artifact-1.5.1.json");
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

test("1.5.1 CLI artifact and measured outcomes remain separate from historical receipts", () => {
  expect(digest(artifactPath)).toBe("a14ffd81fe812a4be7999857c07163a3c92fcc763d9a6ef3e36f4eb02adca2af");
  expect(artifact.version).toBe("1.5.1"); expect(artifact.gitHead).toBe("dd30101cfc5b0609411dd80b6f93adbc14db14cf");
  const registry = JSON.parse(readFileSync(resolve(root, "runtime/test/fixtures/earendil-package-admission/registry-1.5.1.json"), "utf8"));
  for (const pkg of artifact.packages) {
    const published = registry.find((entry: { name: string }) => entry.name === pkg.name);
    expect(pkg.version).toBe(published.version); expect(pkg.gitHead).toBeNull(); expect(pkg.registryGitHead).toBe("omitted"); expect(published.gitHead).toBeUndefined();
    expect(pkg.shasum).toBe(published.dist.shasum); expect(pkg.integrity).toBe(published.dist.integrity);
    expect(pkg.treeSha256).toMatch(/^[a-f0-9]{64}$/); expect(pkg.files).toBeGreaterThan(800);
  }
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
  expect(manifest.version).toBe("1.5.1"); expect(manifest.bin.pi).toBe(artifact.bin); expect(artifact.bin).toBe("dist/bundle/cli.js");
  const bundle = resolve(packageRoot, "dist/bundle"), files = [...new Bun.Glob("**/*.js").scanSync(bundle)].sort();
  expect(files.length).toBe(artifact.bundleFileCount);
  expect(createHash("sha256").update(files.map(file => `${file}\0${digest(resolve(bundle, file))}\n`).join("")).digest("hex")).toBe(artifact.bundleSha256);
  const aiRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-ai"))));
  for (const [file, sha] of Object.entries(artifact.sdkFileSha256)) {
    if (typeof sha !== "string") throw new Error("Invalid OAuth fingerprint.");
    expect(digest(resolve(aiRoot, "dist/auth/oauth", file))).toBe(sha);
  }
  const receipt = JSON.parse(readFileSync(resolve(root, "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-151-packaged-cli-auth-bun.json"), "utf8"));
  expect(receipt.version).toBe("1.5.1"); expect(receipt.runtime).toBe("Bun 1.4.4"); expect(receipt.artifactReceiptSha256).toBe(digest(artifactPath)); expect(receipt.bundleSha256).toBe(artifact.bundleSha256);
  expect(receipt.results.map((row: { provider: string; mode: string }) => [row.provider, row.mode])).toEqual(
    ["openai", "openai-codex"].flatMap(provider => ["success", "denied", "bad-state", "cancel", "provider-only"].map(mode => [provider, mode])));
  for (const row of receipt.results) {
    expect(row.status).toBe("pass"); expect(row.version).toBe("1.5.1"); expect(row.runtime).toBe("Bun 1.4.4");
    expect(row.unexpectedFetchRequests).toBe(0); expect(row.inference).toBe("not_invoked"); expect(row.bundleSha256).toBe(artifact.bundleSha256);
    expect(row.credentialPersistence).toBe(row.mode === "success" ? "disposable_profile" : "none");
    expect(row.tokenRequests).toBe(["success", "denied"].includes(row.mode) ? 1 : 0);
    if (row.mode === "provider-only") {
      expect(row.exitCode).toBe(1); expect(row.diagnostic).toBe("provider_requires_model"); expect(row.browserLauncher).toBe("not_invoked");
    } else {
      expect(row.browserLauncher).toBe("test_owned_noop"); expect(row.cliExit).toBe("restored_editor_quit_0"); expect(row.externalEgress).toBe("os_namespace_denied");
      expect(row.networkGuard).toBe("distinct_loopback_only_os_namespace_and_stable_preload");
      expect(row.bundleFileCount).toBe(artifact.bundleFileCount); expect(row.sdkFileSha256).toEqual(artifact.sdkFileSha256);
      expect(row.codexBrowserChoiceVerified).toBe(row.provider === "openai-codex"); expect(row.hostIdVerified).toBe(row.provider === "openai");
    }
  }
});

test("1.5.1 CLI fixture rejects ordinary-namespace execution before creating a profile", async () => {
  const scratch = mkdtempSync(resolve(tmpdir(), "cli100-refusal-"));
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/packaged-cli-auth-120.ts"), "openai", "success", scratch, readlinkSync("/proc/self/ns/net")], {
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", SYNTHETIC_EXPECT_UID: String(process.getuid?.()) }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).not.toBe(0); expect(out).toBe(""); expect(err).toContain("A distinct network namespace is required."); expect(existsSync(resolve(scratch, "agent"))).toBe(false);
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; rmSync(scratch, { recursive: true, force: true }); }
});
