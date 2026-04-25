#!/usr/bin/env bun

const BLOCKED_PREFIXES = ["coverage/", "test/", "dist/", "runtime/generated/"];
const BLOCKED_EXACT = new Set(["coverage/lcov.info", "runtime/generated/coverage/lcov.info"]);
export const REQUIRED_PACK_ENTRIES = [
  "runtime/src/dream.ts",
  "runtime/src/agent-memory/daily-notes.ts",
  "runtime/src/agent-memory/dream-prompt.ts",
  "runtime/src/agent-memory/refresh.ts",
  "runtime/src/extensions/dream-maintenance.ts",
  "runtime/src/extensions/workspace-memory-bootstrap.ts",
  "runtime/docs/dream-memory.md",
  "skel/AGENTS.md",
  "skel/.mcp.json.example",
  "skel/.piclaw/README.md",
  "skel/.piclaw/config.json.example",
  "skel/notes/index.md",
  "skel/notes/memory/README.md",
  "skel/notes/daily/.gitkeep",
  "skel/notes/memory/days/.gitkeep",
  "skel/.pi/skills/situate-daily-notes/SKILL.md",
  "skel/.pi/skills/situate-daily-notes/situate.ts",
  "skel/.pi/skills/situate-daily-notes/daily-notes.ts",
  "skel/.pi/skills/situate-daily-notes/chat-session-scope.ts",
  "skel/.pi/skills/situate-daily-notes/agent-memory-sidecar.ts",
  "skel/.pi/skills/timeline-cleanup/SKILL.md",
  "skel/.pi/skills/timeline-cleanup/cleanup.ts",
  "skel/.pi/skills/timeline-cleanup/chat-session-scope.ts",
  "skel/scripts/daily-notes.ts",
  "skel/scripts/lib/chat-session-scope.ts",
  "skel/scripts/lib/agent-memory-sidecar.ts",
] as const;

export function extractPackedFiles(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^packed\s+\S+\s+(.+)$/);
    if (!match) continue;
    files.push(match[1].trim());
  }
  return files;
}

export function findBlockedPackEntries(files: string[]): string[] {
  return files.filter((file) => {
    if (BLOCKED_EXACT.has(file)) return true;
    return BLOCKED_PREFIXES.some((prefix) => file.startsWith(prefix));
  });
}

export function findMissingRequiredPackEntries(files: string[]): string[] {
  const fileSet = new Set(files);
  return REQUIRED_PACK_ENTRIES.filter((file) => !fileSet.has(file));
}

export function runPackHygieneCheck(cwd = process.cwd()): { ok: boolean; blocked: string[]; missingRequired: string[]; files: string[]; error?: string } {
  const proc = Bun.spawnSync(["bun", "pm", "pack", "--dry-run"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  if (proc.exitCode !== 0) {
    return {
      ok: false,
      blocked: [],
      missingRequired: [],
      files: [],
      error: stderr || stdout || `pack failed with code ${proc.exitCode}`,
    };
  }

  const files = extractPackedFiles(stdout);
  const blocked = findBlockedPackEntries(files);
  const missingRequired = findMissingRequiredPackEntries(files);
  return { ok: blocked.length === 0 && missingRequired.length === 0, blocked, missingRequired, files };
}

if (import.meta.main) {
  const result = runPackHygieneCheck();
  if (!result.ok) {
    if (result.error) {
      console.error(`[pack-hygiene] ${result.error}`);
    } else {
      if (result.blocked.length > 0) {
        console.error("[pack-hygiene] blocked entries found in package tarball:");
        for (const file of result.blocked) {
          console.error(` - ${file}`);
        }
      }
      if (result.missingRequired.length > 0) {
        console.error("[pack-hygiene] required runtime entries missing from package tarball:");
        for (const file of result.missingRequired) {
          console.error(` - ${file}`);
        }
      }
    }
    process.exit(1);
  }

  console.log(`[pack-hygiene] ok (${result.files.length} files checked)`);
}
