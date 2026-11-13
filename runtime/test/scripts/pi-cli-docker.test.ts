import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../../..");

test("Docker's Pi shim executes the installed binary under Bun without changing SDK bytes", async () => {
  const source = readFileSync(join(repo, "scripts/docker/install-agent-runtime.sh"), "utf8");
  expect(source).toContain("sudo rm -f /usr/local/bin/pi\nsudo tee");
  expect(source).not.toContain("sudo sed -i '1s/env node/env bun/'");
  const template = /sudo tee \/usr\/local\/bin\/pi > \/dev\/null <<EOF\n([\s\S]*?)\nEOF/.exec(source)![1];
  const root = mkdtempSync(join(tmpdir(), "docker pi with spaces-"));
  try {
    const prefix = join(root, "bun");
    mkdirSync(join(prefix, "bin"), { recursive: true });
    symlinkSync(process.execPath, join(prefix, "bin/bun"));
    const cli = '#!/usr/bin/env node\nconsole.log(JSON.stringify({ bun: process.versions.bun, args: process.argv.slice(2) })); process.exitCode = 19;\n';
    writeFileSync(join(prefix, "bin/pi"), cli);
    const rendered = Bun.spawnSync(["bash", "-c", `BUN_INSTALL="$1"\ncat <<EOF\n${template}\nEOF`, "--", prefix]);
    expect(rendered.exitCode, rendered.stderr.toString()).toBe(0);
    const shim = join(root, "pi");
    writeFileSync(shim, rendered.stdout, { mode: 0o755 });
    const child = Bun.spawn([shim, "argument with spaces", "--literal=λ"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, stderr).toBe(19);
    expect(JSON.parse(stdout)).toEqual({ bun: process.versions.bun, args: ["argument with spaces", "--literal=λ"] });
    expect(readFileSync(join(prefix, "bin/pi"), "utf8")).toBe(cli);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("published images must execute Pi version and help with a failing Node sentinel", () => {
  const source = readFileSync(join(repo, "scripts/docker/publish-smoke-test.sh"), "utf8");
  expect(source).toContain('echo "=== Pi CLI ===" && pi --version && pi --help >/dev/null');
  expect(source).toContain('export PATH="$node_guard:$PATH"');
  expect(source).toContain("NODE_MUST_NOT_RUN");
});
