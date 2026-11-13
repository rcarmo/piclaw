import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolvePiCli } from "../../scripts/pi-cli.ts";
import { REQUIRED_PACK_ENTRIES } from "../../scripts/pack-hygiene.ts";

const repo = resolve(import.meta.dir, "../../..");
const launcher = join(repo, "runtime/scripts/pi-cli.ts");

function fixture(entry: string) {
  const root = mkdtempSync(join(tmpdir(), "pi-cli with spaces-"));
  const app = join(root, "app");
  const pkg = join(app, "node_modules/@earendil-works/pi-coding-agent");
  const cli = join(pkg, entry);
  mkdirSync(dirname(cli), { recursive: true });
  mkdirSync(join(app, "runtime/scripts"), { recursive: true });
  writeFileSync(join(app, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(pkg, "package.json"), JSON.stringify({
    name: "@earendil-works/pi-coding-agent", type: "module", bin: { pi: entry },
    exports: { ".": { import: "./dist/index.js" } },
  }));
  const source = '#!/usr/bin/env node\nconst input = await Bun.stdin.text(); process.stderr.write("pi-stderr\\n"); console.log(JSON.stringify({ bun: process.versions.bun, argv: process.argv.slice(1), cwd: process.cwd(), env: process.env.PI_TEST_SENTINEL, input })); process.exitCode = 23;\n';
  writeFileSync(cli, source);
  copyFileSync(launcher, join(app, "runtime/scripts/pi-cli.ts"));
  chmodSync(join(app, "runtime/scripts/pi-cli.ts"), 0o755);
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "node"), "#!/bin/sh\necho NODE_MUST_NOT_RUN >&2\nexit 91\n", { mode: 0o755 });
  return { root, app, pkg, cli, source, bin };
}

describe("shipped Bun Pi CLI", () => {
  test("the package exposes pi and requires its launcher in the actual archive", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    expect(pkg.bin.pi).toBe("runtime/scripts/pi-cli.ts");
    expect(REQUIRED_PACK_ENTRIES).toContain(pkg.bin.pi);
    expect(readFileSync(launcher, "utf8")).toStartWith("#!/usr/bin/env bun\n");
  });

  for (const entry of ["dist/cli.js", "dist/bundle/cli.js"]) {
    test(`uses the declared ${entry} under Bun with unchanged args, streams, cwd and exit status`, async () => {
      const f = fixture(entry);
      try {
        expect(resolvePiCli(f.app)).toBe(f.cli);
        const child = Bun.spawn([process.execPath, join(f.app, "runtime/scripts/pi-cli.ts"), "argument with spaces", "--literal=λ"], {
          cwd: f.root,
          env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, PI_TEST_SENTINEL: "preserved" },
          stdin: "pipe", stdout: "pipe", stderr: "pipe",
        });
        child.stdin.write("stdin survives\n");
        child.stdin.end();
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(exit).toBe(23);
        expect(stderr).toBe("pi-stderr\n");
        expect(JSON.parse(stdout)).toEqual({ bun: process.versions.bun, argv: [f.cli, "argument with spaces", "--literal=λ"], cwd: f.root, env: "preserved", input: "stdin survives\n" });
        expect(readFileSync(f.cli, "utf8")).toBe(f.source);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    });
  }

  test("missing and escaping declared binaries fail instead of selecting an unrelated CLI", () => {
    const f = fixture("dist/bundle/cli.js");
    try {
      writeFileSync(join(f.pkg, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
      expect(() => resolvePiCli(f.app)).toThrow("does not declare a pi binary");
      writeFileSync(join(f.pkg, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", bin: { pi: "../../../outside.js" } }));
      expect(() => resolvePiCli(f.app)).toThrow("escapes its package");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  test.skipIf(process.platform === "win32")("Pi stays in the launcher process and receives termination directly", async () => {
    const f = fixture("dist/bundle/cli.js");
    writeFileSync(f.cli, '#!/usr/bin/env node\nconsole.log(JSON.stringify({ pid: process.pid })); setInterval(() => {}, 1000);\n');
    const child = Bun.spawn([process.execPath, join(f.app, "runtime/scripts/pi-cli.ts")], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    try {
      const reader = child.stdout.getReader();
      const first = await reader.read();
      expect(JSON.parse(new TextDecoder().decode(first.value)).pid).toBe(child.pid);
      child.kill("SIGTERM");
      await child.exited;
      expect(child.signalCode).toBe("SIGTERM");
      reader.releaseLock();
    } finally {
      if (child.exitCode === null) child.kill();
      await child.exited;
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  test("executes the pinned published Pi CLI version and help without using Node", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-cli-real-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "node"), "#!/bin/sh\necho NODE_MUST_NOT_RUN >&2\nexit 91\n", { mode: 0o755 });
      const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, "config"), PI_CODING_AGENT_DIR: join(root, "agent"), PATH: `${bin}:${process.env.PATH}` };
      const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).dependencies["@earendil-works/pi-coding-agent"];
      for (const arg of ["--version", "--help"]) {
        const child = Bun.spawn([process.execPath, launcher, arg], { cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(exit, stderr).toBe(0);
        expect(stderr).not.toContain("NODE_MUST_NOT_RUN");
        if (arg === "--version") expect(stdout.trim()).toBe(version);
        else expect(stdout).toContain("--help");
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30000);
});
