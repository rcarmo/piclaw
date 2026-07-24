import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  buildAuditCommandEnv,
  buildFollowupTicketMarkdown,
  computeAuditMetrics,
} from "../../../scripts/audit-baseline-quality-deterministic.ts";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const auditScriptPath = path.join(repoRoot, "scripts", "audit-baseline-quality-deterministic.ts");

async function runAuditWithRootGates(rootGates: Array<{ id: string; label: string; command: string }>) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "piclaw-audit-harness-"));
  const runDir = path.join(tempDir, "run");
  try {
    const proc = Bun.spawn(["bun", "run", auditScriptPath], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PICLAW_AUDIT_RUN_DIR: runDir,
        PICLAW_AUDIT_ROOT_GATES_JSON: JSON.stringify(rootGates),
        PICLAW_AUDIT_SKIP_GROUPS: "1",
        TZ: "UTC",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        CI: "1",
        FORCE_COLOR: "0",
      },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const summary = JSON.parse(readFileSync(path.join(runDir, "summary.json"), "utf8"));
    const followups = readFileSync(path.join(runDir, "followups.md"), "utf8");
    return { stdout, stderr, exitCode, summary, followups, runDir };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("audit-baseline-quality-deterministic", () => {
  test("buildAuditCommandEnv isolates runtime state away from the live workspace", () => {
    const env = buildAuditCommandEnv({ PATH: process.env.PATH, PICLAW_WORKSPACE: "/workspace" });

    const pathEntries = String(env.PATH || "").split(path.delimiter);
    expect(pathEntries).toContain(path.dirname(process.execPath));
    expect(pathEntries).toContain(path.join(repoRoot, "node_modules", ".bin"));
    expect(new Set(pathEntries).size).toBe(pathEntries.length);
    expect(env.PICLAW_WORKSPACE).not.toBe("/workspace");
    expect(env.PICLAW_WORKSPACE).toContain("artifacts/baseline-quality-deterministic");
    expect(env.PICLAW_STORE).toContain("isolated-state/store");
    expect(env.PICLAW_DATA).toContain("isolated-state/data");
    expect(env.PICLAW_DB_IN_MEMORY).toBe("1");
  });

  test("buildAuditCommandEnv lets nested commands resolve Bun sibling tools", async () => {
    const env = buildAuditCommandEnv({ PATH: "/usr/bin:/bin" });
    const proc = Bun.spawn(["bash", "-c", "command -v bunx && bunx --version >/dev/null"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode, stderr).toBe(0);
    expect(stdout.trim()).toContain("bunx");
  });

  test("controlled audit exits zero when root gates pass and groups are skipped", async () => {
    const result = await runAuditWithRootGates([
      { id: "bunx-path", label: "bunx path", command: "command -v bunx && bunx --version >/dev/null" },
    ]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.summary.metrics).toMatchObject({
      failed_root_gates: 0,
      failed_deterministic_groups: 0,
      flaky_groups_after_3x_rerun: 0,
      followup_tickets_needed: 0,
      unresolved_failures_without_followup_ticket: 0,
      stability_gap_count: 0,
    });
    expect(result.followups).toContain("No follow-up tickets required");
  });

  test("controlled audit creates root-gate follow-up and non-duplicated metrics on failure", async () => {
    const result = await runAuditWithRootGates([
      { id: "failing-root", label: "failing root", command: "echo root gate evidence >&2; exit 7" },
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.summary.metrics).toMatchObject({
      failed_root_gates: 1,
      failed_deterministic_groups: 0,
      flaky_groups_after_3x_rerun: 0,
      followup_tickets_needed: 1,
      unresolved_failures_without_followup_ticket: 0,
      stability_gap_count: 1,
    });
    expect(result.summary.followupDrafts[0]).toMatchObject({
      category: "root_gate",
      groupId: "failing-root",
      command: "echo root gate evidence >&2; exit 7",
      exitCode: 7,
      timedOut: false,
    });
    expect(result.followups).toContain("root gate evidence");
    expect(result.stdout).toContain("METRIC unresolved_failures_without_followup_ticket=0");
  });

  test("list-groups exposes finer deterministic subgroup coverage", async () => {
    const proc = Bun.spawn(["bun", "run", auditScriptPath, "--list-groups"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        TZ: "UTC",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        CI: "1",
        FORCE_COLOR: "0",
      },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const lines = stdout.trim().split(/\r?\n/);
    const groups = new Map<string, { count: number; label: string }>();
    for (const line of lines) {
      const [id = "", countText = "", label = ""] = line.split("\t");
      const count = Number.parseInt(countText, 10);
      if (!id || !label || !Number.isFinite(count)) continue;
      groups.set(id, { count, label });
    }

    const expectGroup = (id: string, label: string) => {
      const group = groups.get(id);
      expect(group).toBeDefined();
      expect(group?.label).toBe(label);
      expect((group?.count ?? 0) > 0).toBe(true);
    };

    expectGroup("channels-web-agent-flow", "channels web agent flow");
    expectGroup("channels-web-auth-security", "channels web auth and security");
    expectGroup("channels-web-http-routes", "channels web http and route surfaces");
    expectGroup("channels-web-media-workspace-remote", "channels web media, workspace, and remote surfaces");
    expectGroup("web-ui-interaction-and-state", "web ui interaction and state");
    expectGroup("web-ui-rendering-and-panes", "web ui rendering and panes");
    expectGroup("web-ui-remote-and-workspace", "web ui remote and workspace");
  });

  test("metrics count each underlying gap once when follow-ups cover failures", () => {
    expect(computeAuditMetrics({
      failedRootGates: 1,
      failedDeterministicGroups: 0,
      flakyGroupsAfter3xRerun: 0,
      missingArtifactOutputs: 0,
      followupTicketsNeeded: 1,
    })).toEqual({
      stabilityGapCount: 1,
      unresolvedFailuresWithoutFollowupTicket: 0,
    });

    expect(computeAuditMetrics({
      failedRootGates: 1,
      failedDeterministicGroups: 1,
      flakyGroupsAfter3xRerun: 1,
      missingArtifactOutputs: 1,
      followupTicketsNeeded: 2,
    })).toEqual({
      stabilityGapCount: 4,
      unresolvedFailuresWithoutFollowupTicket: 1,
    });
  });

  test("follow-up ticket markdown captures reproducible failure evidence", () => {
    const markdown = buildFollowupTicketMarkdown({
      id: "01-web-agent-flow",
      title: "Fix deterministic channels web agent flow sweep failures",
      slug: "01-web-agent-flow",
      category: "consistent_fail",
      groupId: "channels-web-agent-flow",
      groupLabel: "channels web agent flow",
      command: "cd runtime && bun test test/channels/web/web-channel.test.ts",
      logPaths: [
        "/tmp/audit/logs/group-channels-web-agent-flow-attempt-1.log",
        "/tmp/audit/logs/group-channels-web-agent-flow-attempt-2.log",
      ],
      artifactPath: "/tmp/audit",
      artifactTicketPath: "/tmp/audit/followups/01-web-agent-flow.md",
      boardTicketPath: "/tmp/board/01-web-agent-flow.md",
      excerpt: [
        "Expected queue item to be removed before steer enqueue",
        "1 fail, 0 pass",
      ],
      fileCount: 2,
      files: [
        "channels/web/web-channel.test.ts",
        "channels/web/agent-message-handler.test.ts",
      ],
    });

    expect(markdown).toContain("id: deterministic-sweep-01-web-agent-flow");
    expect(markdown).toContain("# Fix deterministic channels web agent flow sweep failures");
    expect(markdown).toContain("The deterministic sweep left the `channels-web-agent-flow` group in a `consistent_fail` state");
    expect(markdown).toContain("- Artifact dir: `/tmp/audit`");
    expect(markdown).toContain("- Artifact ticket path: `/tmp/audit/followups/01-web-agent-flow.md`");
    expect(markdown).toContain("- Board ticket path: `/tmp/board/01-web-agent-flow.md`");
    expect(markdown).toContain("- Logs: `/tmp/audit/logs/group-channels-web-agent-flow-attempt-1.log`, `/tmp/audit/logs/group-channels-web-agent-flow-attempt-2.log`");
    expect(markdown).toContain("- `channels/web/web-channel.test.ts`");
    expect(markdown).toContain("- Expected queue item to be removed before steer enqueue");
  });

  test("root-gate follow-up markdown captures command, status, log, and excerpt", () => {
    const markdown = buildFollowupTicketMarkdown({
      id: "01-root-gate-unused-exports",
      title: "Fix deterministic root gate check:unused-exports",
      slug: "01-root-gate-unused-exports",
      category: "root_gate",
      groupId: "unused-exports",
      groupLabel: "check:unused-exports",
      command: "bun run check:unused-exports",
      logPaths: ["/tmp/audit/logs/root-gate-unused-exports.log"],
      artifactPath: "/tmp/audit",
      artifactTicketPath: "/tmp/audit/followups/01-root-gate-unused-exports.md",
      boardTicketPath: null,
      excerpt: ["error: Failed to spawn 'bunx': ENOENT"],
      fileCount: 0,
      files: [],
      exitCode: 1,
      timedOut: false,
    });

    expect(markdown).toContain("The deterministic sweep root gate `unused-exports` failed");
    expect(markdown).toContain("- Command: `bun run check:unused-exports`");
    expect(markdown).toContain("- Exit status: 1");
    expect(markdown).toContain("- Timed out: false");
    expect(markdown).toContain("- Logs: `/tmp/audit/logs/root-gate-unused-exports.log`");
    expect(markdown).toContain("- error: Failed to spawn 'bunx': ENOENT");
    expect(markdown).toContain("- n/a (root gate)");
  });
});
