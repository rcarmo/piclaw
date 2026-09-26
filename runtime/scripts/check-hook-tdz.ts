#!/usr/bin/env bun
/**
 * check-hook-tdz.ts — Detect temporal dead zone (TDZ) violations in
 * React/Preact hook dependency arrays.
 *
 * When `useCallback`, `useEffect`, or `useMemo` list a `const`/`let`
 * identifier in their deps array, that identifier is evaluated eagerly.
 * If the declaration appears later in the same function scope, the
 * minified bundle will crash with:
 *
 *   ReferenceError: Cannot access '<mangled>' before initialization
 *
 * This script statically detects such forward references so they're
 * caught at lint time instead of at runtime.
 *
 * Usage:
 *   bun run scripts/check-hook-tdz.ts
 *   bun run check:hook-tdz
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const WEB_SRC = join(import.meta.dir, "..", "web", "src");

/** Recursively collect all .ts files under a directory. */
function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (full.endsWith(".ts")) files.push(full);
  }
  return files;
}

interface Violation {
  file: string;
  line: number;
  funcName: string;
  dep: string;
  declLine: number;
}

/**
 * For a given source file, find all function scopes and check that
 * hook deps arrays don't reference const/let declarations that come
 * later in the same scope.
 */
function checkFile(filePath: string): Violation[] {
  const src = readFileSync(filePath, "utf-8");
  const lines = src.split("\n");
  const violations: Violation[] = [];

  // Find top-level and exported function declarations
  const funcStarts: { name: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(
      /(?:export\s+)?function\s+(\w+)\s*\(/
    );
    if (m) funcStarts.push({ name: m[1], line: i });
  }

  for (const func of funcStarts) {
    // Track brace depth to find the function's scope boundaries
    let depth = 0;
    let funcDepth = -1;
    let funcEnd = lines.length - 1;

    // First pass: collect const/let declarations at the function's
    // immediate scope level (depth === funcDepth).
    const decls = new Map<string, number>();

    for (let i = func.line; i < lines.length; i++) {
      // Depth at the START of the line is what matters for declarations,
      // since `const foo = useCallback(() => {` opens a new brace on
      // the same line but the `const` itself is at the outer scope.
      const depthBeforeLine = depth;

      for (const ch of lines[i]) {
        if (ch === "{") {
          depth++;
          if (funcDepth === -1) funcDepth = depth;
        }
        if (ch === "}") depth--;
      }

      if (funcDepth !== -1 && depthBeforeLine === funcDepth) {
        // Match simple const declarations: const foo = ...
        const m = lines[i].match(/^\s*const\s+(\w+)\s*=/);
        if (m && m[1].length > 2 && !decls.has(m[1])) {
          decls.set(m[1], i);
        }
        // Match destructured const: const { a, b } = ... or const [a, b] = ...
        const dm = lines[i].match(
          /^\s*const\s+(?:\{([^}]+)\}|\[([^\]]+)\])\s*=/
        );
        if (dm) {
          const names = (dm[1] || dm[2] || "")
            .split(",")
            .map((s) => {
              // Handle renaming: original: renamed
              const parts = s.split(":");
              return (parts.length > 1 ? parts[1] : parts[0]).trim();
            })
            .filter((n) => n.length > 2);
          for (const name of names) {
            if (!decls.has(name)) decls.set(name, i);
          }
        }
      }

      if (funcDepth !== -1 && depth < funcDepth) {
        funcEnd = i;
        break;
      }
    }

    if (decls.size === 0) continue;

    // Second pass: find hook deps arrays and check for forward references
    depth = 0;
    funcDepth = -1;

    for (let i = func.line; i <= funcEnd; i++) {
      for (const ch of lines[i]) {
        if (ch === "{") {
          depth++;
          if (funcDepth === -1) funcDepth = depth;
        }
        if (ch === "}") depth--;
      }

      // Match deps arrays: }, [dep1, dep2, ...])
      // Also match: , [dep1, dep2]) for useMemo/useCallback without trailing }
      const depsMatch = lines[i].match(
        /(?:\}\s*,|\,)\s*\[([^\]]*)\]\s*\)/
      );
      if (depsMatch) {
        const depsStr = depsMatch[1];
        const deps = depsStr
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean);

        for (const dep of deps) {
          // Skip non-identifier patterns (e.g., expressions, string literals)
          if (!/^[a-zA-Z_$]\w*$/.test(dep)) continue;

          const declLine = decls.get(dep);
          if (declLine !== undefined && declLine > i) {
            violations.push({
              file: filePath.replace(WEB_SRC + "/", ""),
              line: i + 1,
              funcName: func.name,
              dep,
              declLine: declLine + 1,
            });
          }
        }
      }
    }
  }

  return violations;
}

// ── Main ──────────────────────────────────────────────────────

const files = walk(WEB_SRC);
const allViolations: Violation[] = [];

for (const file of files) {
  allViolations.push(...checkFile(file));
}

if (allViolations.length === 0) {
  console.log("✅ No hook dependency TDZ violations found.");
  process.exit(0);
} else {
  console.error(
    `❌ Found ${allViolations.length} hook dependency TDZ violation(s):\n`
  );
  for (const v of allViolations) {
    console.error(
      `  ${v.file}:${v.line} — "${v.dep}" in deps array before declaration (line ${v.declLine}) [${v.funcName}]`
    );
  }
  console.error(
    "\nMove the referenced const/let declarations above the hook that uses them."
  );
  process.exit(1);
}
