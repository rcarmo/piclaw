import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

test("pre-push CI clears hook-local Git routing before install, receipt and nested fixture commands", () => {
  const dir = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, "pre-push-env-"));
  const repo = join(dir, "repo"), bin = join(dir, "bin"), marker = join(dir, "calls");
  mkdirSync(repo); mkdirSync(bin);
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    return result.stdout.toString().trim();
  };
  try {
    git("init", "-q");
    writeFileSync(join(repo, "source.txt"), "original source\n");
    git("add", "source.txt");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "original");
    const head = git("rev-parse", "HEAD");
    writeFileSync(join(bin, "bun"), `#!/usr/bin/env bash
set -eu
for name in GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX; do
  if [[ -v "$name" ]]; then echo "Leaked $name" >&2; exit 42; fi
done
test "$(git rev-parse --show-toplevel)" = "$PWD"
# A nested test repository must have its own HEAD, not the initiating checkout.
if [[ "$1" != install ]]; then
  mkdir -p "$HOOK_FIXTURE_DIR/nested"
  git -C "$HOOK_FIXTURE_DIR/nested" init -q
  printf fixture > "$HOOK_FIXTURE_DIR/nested/fixture.txt"
  git -C "$HOOK_FIXTURE_DIR/nested" add fixture.txt
  git -C "$HOOK_FIXTURE_DIR/nested" -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm fixture
fi
printf '%s\\n' "$1" >> "$HOOK_FIXTURE_MARKER"
`, { mode: 0o755 });
    const result = Bun.spawnSync(["bash", resolve(import.meta.dir, "../../../scripts/git-pre-push-ci-fast.sh"), "--current"], {
      cwd: repo, stdout: "pipe", stderr: "pipe", env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: dir,
        GIT_DIR: join(repo, ".git"), GIT_WORK_TREE: repo, GIT_INDEX_FILE: join(repo, ".git/index"), GIT_PREFIX: "",
        PICLAW_PRE_PUSH_HOME: join(dir, "home"), PICLAW_PRE_PUSH_RECEIPT_DIR: join(dir, "receipts"),
        PICLAW_SKIP_PRE_PUSH_CI: "0", PICLAW_PRE_PUSH_CI: "1", HOOK_FIXTURE_DIR: dir, HOOK_FIXTURE_MARKER: marker,
      },
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(readFileSync(marker, "utf8").trim().split("\n")).toHaveLength(2);
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(git("status", "--porcelain")).toBe("");
    expect(readFileSync(join(repo, "source.txt"), "utf8")).toBe("original source\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
