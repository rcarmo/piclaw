import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../../..");

test("Docker's Pi shim executes the installed binary under Bun without changing SDK bytes", async () => {
  const source = readFileSync(join(repo, "scripts/docker/install-agent-runtime.sh"), "utf8");
  expect(source).toContain('sudo rm -f "$BUN_INSTALL/bin/pi"\nsudo tee');
  expect(source).not.toContain("sudo sed -i '1s/env node/env bun/'");
  const template = /sudo tee "\$BUN_INSTALL\/bin\/pi" > \/dev\/null <<EOF\n([\s\S]*?)\nEOF/.exec(source)![1];
  const resolver = /PI_CLI=.* -e '([^']+)' "\$BUN_INSTALL"\)/.exec(source)![1];
  const root = mkdtempSync(join(tmpdir(), "docker pi with spaces-"));
  try {
    const prefix = join(root, "bun");
    mkdirSync(join(prefix, "bin"), { recursive: true });
    symlinkSync(process.execPath, join(prefix, "bin/bun"));
    const pkg = join(prefix, "install/global/node_modules/@earendil-works/pi-coding-agent");
    mkdirSync(join(pkg, "dist/bundle"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ bin: { pi: "dist/bundle/cli.js" } }));
    const cli = '#!/usr/bin/env node\nconsole.log(JSON.stringify({ bun: process.versions.bun, args: process.argv.slice(2) })); process.exitCode = 19;\n';
    const sdkCli = join(pkg, "dist/bundle/cli.js");
    writeFileSync(sdkCli, cli);
    const selected = Bun.spawnSync([process.execPath, "-e", resolver, prefix]);
    expect(selected.exitCode, selected.stderr.toString()).toBe(0);
    expect(selected.stdout.toString().trim()).toBe(sdkCli);
    const rendered = Bun.spawnSync(["bash", "-c", `BUN_INSTALL="$1"\nPI_CLI="$2"\ncat <<EOF\n${template}\nEOF`, "--", prefix, sdkCli]);
    expect(rendered.exitCode, rendered.stderr.toString()).toBe(0);
    const shim = join(prefix, "bin/pi");
    symlinkSync(sdkCli, shim);
    rmSync(shim);
    writeFileSync(shim, rendered.stdout, { mode: 0o755 });
    const child = Bun.spawn([shim, "argument with spaces", "--literal=λ"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, stderr).toBe(19);
    expect(JSON.parse(stdout)).toEqual({ bun: process.versions.bun, args: ["argument with spaces", "--literal=λ"] });
    expect(readFileSync(sdkCli, "utf8")).toBe(cli);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("published images must execute Pi version and help with a failing Node sentinel", () => {
  const source = readFileSync(join(repo, "scripts/docker/publish-smoke-test.sh"), "utf8");
  expect(source).toContain('echo "=== Pi CLI ===" && pi --version && pi --help >/dev/null');
  expect(source).toContain('export PATH="$node_guard:$PATH"');
  expect(source).toContain("NODE_MUST_NOT_RUN");
});
