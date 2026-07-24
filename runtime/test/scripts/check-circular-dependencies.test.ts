import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import {
  checkCircularDependencies,
  extractModuleSpecifiers,
  resolveRuntimeImport,
} from "../../scripts/check-circular-dependencies.js";

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "piclaw-cycle-fixture-"));
  const src = join(root, "src");
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(src, relativePath);
    mkdirSync(join(absolutePath, ".."), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
  return {
    root,
    src,
    entrypoint: join(src, "index.ts"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("check-circular-dependencies", () => {
  test("extracts static, side-effect, export, and dynamic import specifiers", () => {
    expect(extractModuleSpecifiers([
      "import x from './a.js';",
      "import './side-effect.js';",
      "export { y } from './b.js';",
      "await import('./dynamic.js');",
    ].join("\n"))).toEqual(["./a.js", "./side-effect.js", "./b.js", "./dynamic.js"]);
  });

  test("resolves runtime-relative TypeScript imports and ignores external packages", () => {
    const fs = fixture({
      "index.ts": "import './a.js'; import path from 'node:path';",
      "a.ts": "export const a = 1;",
    });
    try {
      expect(resolveRuntimeImport(fs.entrypoint, "./a.js", fs.src)).toBe(join(fs.src, "a.ts"));
      expect(resolveRuntimeImport(fs.entrypoint, "node:path", fs.src)).toBeNull();
    } finally {
      fs.cleanup();
    }
  });

  test("ignores self-resolution from barrel-style same-basename imports", () => {
    const fs = fixture({
      "index.ts": "export { a } from './index.js'; export const a = 1;",
    });
    try {
      const result = checkCircularDependencies({ entrypoint: fs.entrypoint, rootDir: fs.src });
      expect(result.fileCount).toBe(1);
      expect(result.cycles).toEqual([]);
    } finally {
      fs.cleanup();
    }
  });

  test("clean server graph fixture exits with no cycles", () => {
    const fs = fixture({
      "index.ts": "import './a.js';",
      "a.ts": "import './b.js'; export const a = 1;",
      "b.ts": "export const b = 1;",
    });
    try {
      const result = checkCircularDependencies({ entrypoint: fs.entrypoint, rootDir: fs.src });
      expect(result.fileCount).toBe(3);
      expect(result.cycles).toEqual([]);
    } finally {
      fs.cleanup();
    }
  });

  test("injected fixture cycle is reported with the concrete cycle path", () => {
    const fs = fixture({
      "index.ts": "import './a.js';",
      "a.ts": "import './b.js'; export const a = 1;",
      "b.ts": "import './a.js'; export const b = 1;",
    });
    try {
      const result = checkCircularDependencies({ entrypoint: fs.entrypoint, rootDir: fs.src });
      expect(result.cycles).toHaveLength(1);
      expect(result.cycles[0].map((file) => file.replace(fs.src + "/", ""))).toEqual(["a.ts", "b.ts", "a.ts"]);
    } finally {
      fs.cleanup();
    }
  });
});
