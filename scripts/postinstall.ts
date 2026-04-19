#!/usr/bin/env bun
/**
 * postinstall.ts — Run after `bun add -g github:rcarmo/piclaw`.
 *
 * Repo installs should already contain the vendored runtime assets, including
 * Draw.io. This script only acts as a repair fallback for source checkouts or
 * incomplete package trees.
 *
 * Only uses bun and node:* builtins — no devDependencies required.
 *
 * Safe to re-run: checks whether output already exists.
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = dirname(import.meta.dir);
const LOG = "[postinstall]";

function run(label: string, cmd: string[], cwd = ROOT): boolean {
  console.log(`${LOG} ${label}...`);
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd,
    stdio: "inherit",
    env: { ...process.env },
  });
  if (result.status !== 0) {
    console.warn(`${LOG} ⚠ ${label} failed (exit ${result.status}), skipping`);
    return false;
  }
  return true;
}

// Draw.io should ship inside the repo/package. If it is missing, repair it as a
// last resort so direct source installs still recover to a working runtime.
const drawioIndex = resolve(ROOT, "runtime/extensions/viewers/drawio-editor/vendor/index.html");
if (!existsSync(drawioIndex)) {
  run("Repairing missing vendored draw.io", ["bun", "run", "build:vendor:drawio"]);
} else {
  console.log(`${LOG} draw.io vendor already present, skipping`);
}

// ── CodeMirror singleton enforcement ─────────────────────────────────────────
// Bun can install duplicate nested copies of core CodeMirror packages.
// Multiple instances of @codemirror/state break `instanceof` checks at runtime,
// producing "Unrecognized extension value in extension set" errors.
// Remove any nested duplicates so every package resolves to the single root copy.
const CM_SINGLETONS = ["@codemirror/commands", "@codemirror/state", "@codemirror/view", "@codemirror/language"];
const nodeModules = resolve(ROOT, "node_modules");

function removeNestedCmDuplicates(pkg: string): number {
  // Find every nested node_modules/@codemirror/state (etc.) that is NOT the
  // root node_modules/<pkg>.  We only look one level deep inside each package
  // directory — the pattern is always:
  //   node_modules/<scope>/<name>/node_modules/<pkg>
  let removed = 0;
  const segments = pkg.split("/");
  const rootPkg = resolve(nodeModules, ...segments);
  // Scan all directories that could contain a nested node_modules
  const scanDirs: string[] = [];
  try {
    for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = resolve(nodeModules, entry.name);
      if (entry.name.startsWith("@")) {
        // Scoped: look inside each sub-package
        try {
          for (const sub of readdirSync(full, { withFileTypes: true })) {
            if (sub.isDirectory()) scanDirs.push(resolve(full, sub.name));
          }
        } catch { /* ignore */ }
      } else {
        scanDirs.push(full);
      }
    }
  } catch { /* ignore */ }
  for (const dir of scanDirs) {
    const nested = resolve(dir, "node_modules", ...segments);
    if (nested === rootPkg) continue;
    if (existsSync(resolve(nested, "package.json"))) {
      try {
        rmSync(nested, { recursive: true, force: true });
        removed++;
      } catch { /* best-effort */ }
    }
  }
  return removed;
}

let cmDupsRemoved = 0;
for (const pkg of CM_SINGLETONS) {
  cmDupsRemoved += removeNestedCmDuplicates(pkg);
}
if (cmDupsRemoved > 0) {
  console.log(`${LOG} Removed ${cmDupsRemoved} nested CodeMirror duplicate(s) to enforce singleton instances`);
}

// ── Downstream model patches ────────────────────────────────────────────────
// The upstream pi-ai dependency ships models.generated.js without custom
// model entries or context-window corrections that the downstream fleet needs.
// Instead of a separate patch-models-fleet.py script, apply these patches
// automatically after every `bun install`.
//
// Patches:
//   1. Insert claude-opus-4.6-1m (1M context, github-copilot provider) if missing
//   2. Fix contextWindow on regular opus-4.6 entries: 1000000 → 200000
//      (only the explicit -1m variant keeps 1M)
//   3. Fix reasoning: True → reasoning: true (Python→JS legacy cleanup)

const OPUS_1M_ENTRY = `
        "claude-opus-4.6-1m": {
            id: "claude-opus-4.6-1m",
            name: "Claude Opus 4.6 (1M context)",
            api: "anthropic-messages",
            provider: "github-copilot",
            baseUrl: "https://api.individual.githubcopilot.com",
            headers: { "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat" },
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 1000000,
            maxTokens: 64000,
        },`;

function patchModelsGenerated(): void {
  const modelsPath = join(nodeModules, "@mariozechner", "pi-ai", "dist", "models.generated.js");
  if (!existsSync(modelsPath)) {
    console.log(`${LOG} models.generated.js not found, skipping model patches`);
    return;
  }

  let content = readFileSync(modelsPath, "utf-8");
  let changed = false;

  // Patch 3: Fix Python True → JavaScript true (legacy cleanup)
  if (content.includes("reasoning: True,")) {
    content = content.replaceAll("reasoning: True,", "reasoning: true,");
    changed = true;
    console.log(`${LOG} Fixed reasoning: True → true`);
  }

  // Patch 2: Fix contextWindow on regular opus-4.6 entries (not -1m)
  // Only the -1m variant should have contextWindow: 1000000
  const opusPatterns = [
    /"anthropic\.claude-opus-4-6-v1"/g,
    /"claude-opus-4-6"/g,
    /"claude-opus-4\.6"/g,
    /"eu\.anthropic\.claude-opus-4-6-v1"/g,
  ];
  for (const pattern of opusPatterns) {
    let match: RegExpExecArray | null;
    // Reset and scan — we modify content in place so re-scan each time
    while ((match = pattern.exec(content)) !== null) {
      const start = match.index;
      const blockEnd = content.indexOf("\n        },", start);
      if (blockEnd === -1) continue;
      const block = content.slice(start, blockEnd + 12);
      // Skip the -1m variant
      if (block.includes("claude-opus-4.6-1m")) continue;
      if (block.includes("contextWindow: 1000000")) {
        const newBlock = block.replace("contextWindow: 1000000", "contextWindow: 200000");
        content = content.slice(0, start) + newBlock + content.slice(start + block.length);
        changed = true;
        const entryId = match[0].replace(/"/g, "");
        console.log(`${LOG} Fixed contextWindow 1M→200K: ${entryId}`);
      }
    }
  }

  // Patch 1: Insert claude-opus-4.6-1m if missing
  if (!content.includes('"claude-opus-4.6-1m"')) {
    // Insert after the github-copilot claude-opus-4.6 entry
    const marker = '"claude-opus-4.6": {';
    const idx = content.indexOf(marker);
    if (idx === -1) {
      console.log(`${LOG} No claude-opus-4.6 entry found, cannot insert -1m variant`);
    } else {
      // Find the end of this entry block (matching braces)
      let depth = 0;
      let end = idx;
      for (let i = idx; i < content.length; i++) {
        if (content[i] === "{") depth++;
        else if (content[i] === "}") {
          depth--;
          if (depth === 0) {
            end = i + 1;
            if (end < content.length && content[end] === ",") end++;
            break;
          }
        }
      }
      content = content.slice(0, end) + OPUS_1M_ENTRY + content.slice(end);
      changed = true;
      console.log(`${LOG} Inserted claude-opus-4.6-1m entry`);
    }
  } else {
    console.log(`${LOG} claude-opus-4.6-1m already present`);
  }

  if (changed) {
    writeFileSync(modelsPath, content, "utf-8");
    console.log(`${LOG} models.generated.js patched`);
  } else {
    console.log(`${LOG} models.generated.js already up to date`);
  }
}

patchModelsGenerated();

console.log(`${LOG} Done`);
