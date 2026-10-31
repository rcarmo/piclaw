import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = resolve(import.meta.dir, "../../..");
const dockerfile = readFileSync(resolve(repoRoot, "Dockerfile"), "utf8");
const dockerignore = readFileSync(resolve(repoRoot, ".dockerignore"), "utf8");
const buildScript = readFileSync(resolve(repoRoot, "scripts/docker/build-piclaw-package.sh"), "utf8");

test("Docker pack command creates the install tarball in a path containing spaces", () => {
  const fixture = mkdtempSync(join(tmpdir(), "piclaw-docker-pack-"));
  try {
    writeFileSync(join(fixture, "package.json"), JSON.stringify({
      name: "piclaw-pack-fixture", version: "1.0.0",
    }));
    // Reason: execute the actual Docker command with Bun so invalid CLI flags fail here.
    const command = buildScript.split("\n").find(line => line.startsWith("bun pm pack "));
    expect(command).toBeDefined();
    const packed = join(fixture, "packed output");
    const result = Bun.spawnSync(["bash", "-c", command!], {
      cwd: fixture,
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, PACK_DIR: packed },
    });
    expect({ status: result.exitCode, stderr: result.stderr.toString() }).toEqual({ status: 0, stderr: expect.any(String) });
    expect(readFileSync(join(packed, "piclaw-pack-fixture-1.0.0.tgz")).length).toBeGreaterThan(0);
    const archive = Bun.spawnSync(["tar", "-tzf", join(packed, "piclaw-pack-fixture-1.0.0.tgz")]);
    expect(archive.exitCode).toBe(0);
    expect(archive.stdout.toString()).toContain("package/package.json");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("Docker image staging does not require the removed pi-ai package patch", () => {
  expect(dockerfile).not.toContain("COPY --chown=agent:agent patches/");
  expect(dockerignore).not.toContain("!patches/**");
  expect(dockerfile).toContain("COPY --chown=agent:agent scripts/prepare-local-install.ts /home/agent/piclaw/scripts/prepare-local-install.ts");
  expect(dockerignore).toContain("!scripts/prepare-local-install.ts");

  expect(buildScript).toContain("bun run scripts/prepare-local-install.ts");
  expect(buildScript).toContain('install -g "$INSTALL_TARBALL"');
  expect(buildScript).not.toContain('install -g "$TARBALL"');
});

test("Docker stages the installer imported by the packaged postinstall", () => {
  const postinstall = readFileSync(resolve(repoRoot, "scripts/postinstall.ts"), "utf8");
  expect(postinstall).toContain('from "./install-durable-engine.js"');
  expect(dockerfile).toContain("COPY --chown=agent:agent scripts/install-durable-engine.ts /home/agent/piclaw/scripts/install-durable-engine.ts");
});
