import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ALLOWED_PACKAGED_EXTENSION_SRC_TARGETS, extractModuleSpecifiers, findImportBoundaryViolations, findPackagedExtensionImportViolations, resolveProjectImportTarget } from "../../scripts/check-import-boundaries.ts";

describe("check-import-boundaries", () => {
  test("extractModuleSpecifiers parses static, dynamic, and CommonJS imports", () => {
    const content = [
      "import x from 'a';",
      "export { y } from \"b\";",
      "const mod = await import('c');",
      "const legacy = require(\"d\");",
      "const dynamicLegacy = require(moduleName);",
    ].join("\n");

    expect(extractModuleSpecifiers(content)).toEqual(["a", "b", "c", "d"]);
  });

  test("resolveProjectImportTarget normalizes importer depth, dot segments, and platform separators", () => {
    const root = join(tmpdir(), "boundary-project");
    expect(resolveProjectImportTarget(root, join(root, "extensions", "top.ts"), "../src/db/messages.js")).toBe("src/db/messages.js");
    expect(resolveProjectImportTarget(root, join(root, "extensions", "integrations", "nested.ts"), "../../src/./db/../db/messages.js")).toBe("src/db/messages.js");
    expect(resolveProjectImportTarget(root, join(root, "extensions", "integrations", "nested.ts"), "..\\..\\src\\db\\messages.js")).toBe("src/db/messages.js");
    expect(resolveProjectImportTarget(root, join(root, "extensions", "nested.ts"), "../../../outside.js")).toBeNull();
    expect(resolveProjectImportTarget(root, join(root, "extensions", "nested.ts"), "some-package")).toBeNull();
  });

  test("findImportBoundaryViolations reports restricted extension imports", () => {
    const dir = mkdtempSync(join(tmpdir(), "import-boundaries-"));
    try {
      mkdirSync(join(dir, "extensions"), { recursive: true });
      mkdirSync(join(dir, "src", "extensions"), { recursive: true });

      writeFileSync(join(dir, "extensions", "bad.ts"), "import x from '../node_modules/pkg';\n");
      writeFileSync(join(dir, "extensions", "bad2.ts"), "import x from '@earendil-works/pi-ai/dist/providers/x.js';\n");
      writeFileSync(join(dir, "extensions", "bad3.ts"), "import x from '../src/db/messages.js';\n");
      writeFileSync(
        join(dir, "src", "extensions", "helper.ts"),
        "import x from '@earendil-works/pi-ai/dist/api/openai-responses-shared.js';\n"
      );

      const violations = findImportBoundaryViolations(dir);
      expect(violations.length).toBe(4);
      expect(violations.some((v) => v.includes("node_modules relative import") && v.includes("../node_modules/pkg -> node_modules/pkg"))).toBeTrue();
      expect(violations.some((v) => v.includes("disallowed direct pi-ai dist import"))).toBeTrue();
      expect(violations.some((v) => v.includes("disallowed direct src import"))).toBeTrue();
      expect(violations.some((v) => v.includes("outside allowlist"))).toBeTrue();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("findImportBoundaryViolations rejects equivalent direct core targets at every nesting depth", () => {
    const dir = mkdtempSync(join(tmpdir(), "import-boundaries-"));
    try {
      mkdirSync(join(dir, "extensions", "integrations", "deeper"), { recursive: true });
      mkdirSync(join(dir, "src", "db"), { recursive: true });
      writeFileSync(join(dir, "extensions", "top.ts"), "import x from '../src/db/messages.js';\n");
      writeFileSync(join(dir, "extensions", "integrations", "nested.ts"), "import x from '../../src/db/messages.js';\n");
      writeFileSync(join(dir, "extensions", "integrations", "deeper", "windows.ts"), "import x from '..\\\\..\\\\..\\\\src\\\\db\\\\messages.js';\n");
      writeFileSync(join(dir, "src", "db", "messages.ts"), "export default 1;\n");

      expect(findImportBoundaryViolations(dir)).toEqual([
        "extensions/integrations/deeper/windows.ts: disallowed direct src import (..\\\\..\\\\..\\\\src\\\\db\\\\messages.js -> src/db/messages.js)",
        "extensions/integrations/nested.ts: disallowed direct src import (../../src/db/messages.js -> src/db/messages.js)",
        "extensions/top.ts: disallowed direct src import (../src/db/messages.js -> src/db/messages.js)",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("findImportBoundaryViolations allows bridges and reviewed compatibility seams", () => {
    const dir = mkdtempSync(join(tmpdir(), "import-boundaries-"));
    try {
      mkdirSync(join(dir, "extensions"), { recursive: true });
      mkdirSync(join(dir, "src", "extensions"), { recursive: true });

      mkdirSync(join(dir, "extensions", "integrations"), { recursive: true });
      writeFileSync(join(dir, "extensions", "ok.ts"), "import x from '../src/extensions/azure-openai-api.js';\n");
      writeFileSync(join(dir, "extensions", "integrations", "nested.ts"), [
        "import x from '../../src/extensions/azure-openai-api.js';",
        "import y from '../../src/tool-status-hints.js';",
        "import z from '../../src/utils/logger.js';",
      ].join("\n"));
      writeFileSync(
        join(dir, "src", "extensions", "azure-openai-api.ts"),
        "import x from '@earendil-works/pi-ai/api/openai-responses-shared';\n"
      );

      expect(findImportBoundaryViolations(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("scoped extension checks do not hide or relax separate service-effects findings", () => {
    const dir = mkdtempSync(join(tmpdir(), "import-boundaries-"));
    try {
      mkdirSync(join(dir, "extensions"), { recursive: true });
      mkdirSync(join(dir, "src", "runtime"), { recursive: true });
      mkdirSync(join(dir, "src", "service-effects", "contracts"), { recursive: true });
      writeFileSync(join(dir, "extensions", "ok.ts"), "import x from '../src/tool-status-hints.js';\n");
      writeFileSync(join(dir, "src", "runtime", "bad.ts"), "import x from '../service-effects/contracts/common.js';\n");
      writeFileSync(join(dir, "src", "service-effects", "contracts", "common.ts"), "export default 1;\n");
      expect(findPackagedExtensionImportViolations(dir)).toEqual([]);
      expect(findImportBoundaryViolations(dir)).toEqual([
        "src/runtime/bad.ts: production core cannot import latent service effects (../service-effects/contracts/common.js)",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("MCP adapter subpath imports stay behind the approved status-hint adapter", () => {
    const dir = mkdtempSync(join(tmpdir(), "import-boundaries-"));
    try {
      mkdirSync(join(dir, "extensions", "integrations"), { recursive: true });
      mkdirSync(join(dir, "src", "extensions"), { recursive: true });
      writeFileSync(
        join(dir, "extensions", "integrations", "bad.ts"),
        "import { loadMcpConfig } from 'pi-mcp-adapter/config.ts';\n",
      );
      writeFileSync(
        join(dir, "src", "extensions", "bad.ts"),
        "import { loadMetadataCache } from 'pi-mcp-adapter/metadata-cache.ts';\n",
      );
      writeFileSync(
        join(dir, "src", "extensions", "mcp-status-hint-adapter.ts"),
        "import { loadMcpConfig } from 'pi-mcp-adapter/config.ts';\n",
      );

      expect(findPackagedExtensionImportViolations(dir)).toEqual([
        "extensions/integrations/bad.ts: retired MCP adapter is forbidden in extensions (pi-mcp-adapter/config.ts)",
        "src/extensions/bad.ts: retired MCP adapter is forbidden in extensions (pi-mcp-adapter/metadata-cache.ts)",
        "src/extensions/mcp-status-hint-adapter.ts: retired MCP adapter is forbidden in extensions (pi-mcp-adapter/config.ts)",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("findImportBoundaryViolations keeps latent service effects unreachable from production core", () => {
    const dir = mkdtempSync(join(tmpdir(), "import-boundaries-"));
    try {
      mkdirSync(join(dir, "src", "service-effects", "contracts"), { recursive: true });
      mkdirSync(join(dir, "src", "runtime"), { recursive: true });
      writeFileSync(
        join(dir, "src", "service-effects", "contracts", "common.ts"),
        "export const latent = true;\n",
      );
      writeFileSync(
        join(dir, "src", "service-effects", "contracts", "peer.ts"),
        "import { latent } from './common.js';\nconst peer = require('./common.js');\nexport { latent, peer };\n",
      );
      writeFileSync(
        join(dir, "src", "runtime", "bad.ts"),
        "import { latent } from '../service-effects/contracts/common.js';\n",
      );
      writeFileSync(
        join(dir, "src", "runtime", "bad-require.ts"),
        "const latent = require('../service-effects/contracts/common.js');\n",
      );
      mkdirSync(join(dir, "src", "service-effects", "current-piclaw"), { recursive: true });
      mkdirSync(join(dir, "src", "service-effects", "testing"), { recursive: true });
      writeFileSync(
        join(dir, "src", "service-effects", "current-piclaw", "bad.ts"),
        "import { runner } from '../testing/contract-suite.js';\n",
      );
      writeFileSync(
        join(dir, "src", "service-effects", "testing", "allowed.ts"),
        "import { latent } from '../contracts/common.js';\nexport { latent };\n",
      );

      expect(findImportBoundaryViolations(dir)).toEqual([
        "src/runtime/bad-require.ts: production core cannot import latent service effects (../service-effects/contracts/common.js)",
        "src/runtime/bad.ts: production core cannot import latent service effects (../service-effects/contracts/common.js)",
        "src/service-effects/current-piclaw/bad.ts: service-effects production layer cannot import testing (../testing/contract-suite.js)",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reviewed exact compatibility seams stay explicit and minimal", () => {
    expect([...ALLOWED_PACKAGED_EXTENSION_SRC_TARGETS]).toEqual([
      "src/core/config-secrets.js",
      "src/core/config-web.js",
      "src/core/config.js",
      "src/tool-status-hints.js",
      "src/tools/tracked-bash.js",
      "src/utils/azure-tool-call-limit.js",
      "src/utils/logger.js",
      "src/utils/process-spawn.js",
    ]);
    expect(ALLOWED_PACKAGED_EXTENSION_SRC_TARGETS.every((target) => !target.endsWith("/") && !target.includes("*") && !target.includes(".."))).toBeTrue();
  });

  test("findImportBoundaryViolations ignores optional extension node_modules", () => {
    const dir = mkdtempSync(join(tmpdir(), "import-boundaries-"));
    try {
      mkdirSync(join(dir, "extensions"), { recursive: true });
      symlinkSync(join(dir, "missing-extension-deps"), join(dir, "extensions", "node_modules"));
      writeFileSync(join(dir, "extensions", "ok.ts"), "import x from './local.js';\n");

      expect(findImportBoundaryViolations(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
