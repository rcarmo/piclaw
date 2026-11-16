import { describe, expect, test } from "bun:test";
import {
  REQUIRED_PACK_ENTRIES,
  extractPackedFiles,
  findBlockedPackEntries,
  findMissingRequiredPackEntries,
} from "../../scripts/pack-hygiene.ts";

describe("pack-hygiene", () => {
  test("extractPackedFiles parses bun pack output", () => {
    const output = [
      "packed 2.96KB package.json",
      "packed 4.27KB docs/tool-context-optimizations.md",
      "packed 1.00KB src/index.ts",
      "",
    ].join("\n");

    expect(extractPackedFiles(output)).toEqual([
      "package.json",
      "docs/tool-context-optimizations.md",
      "src/index.ts",
    ]);
  });

  test("findBlockedPackEntries flags blocked prefixes", () => {
    const files = [
      "src/index.ts",
      "test/remote/ssrf.test.ts",
      "coverage/lcov.info",
      "runtime/generated/dist/runtime.js",
      "runtime/generated/coverage/lcov.info",
    ];

    expect(findBlockedPackEntries(files)).toEqual([
      "test/remote/ssrf.test.ts",
      "coverage/lcov.info",
      "runtime/generated/dist/runtime.js",
      "runtime/generated/coverage/lcov.info",
    ]);
  });

  test('one-shot native history importer is packaged and obsolete archive constructors/CLIs are forbidden',()=>{
    for(const path of ['runtime/src/session-import/source.ts','runtime/durable-engine/src/session-history-import.ts','runtime/durable-engine/src/session-history-import-record.ts','runtime/durable-engine/src/legacy-import-schema.ts'])expect(REQUIRED_PACK_ENTRIES).toContain(path);
    for(const path of ['runtime/src/agent-pool/sqlite-session-store.ts','runtime/scripts/lib/sqlite-session-archive.ts','runtime/scripts/import-jsonl-sessions.ts','runtime/scripts/benchmark-sqlite-session-layouts.ts','runtime/src/agent-pool/session-manager.ts','runtime/src/agent-pool/branch-seeding.ts','runtime/src/agent-pool/adopted-session-import.ts','runtime/src/agent-pool/session-file-persistence.ts', 'runtime/src/db/migration-input-holds.ts', 'runtime/src/db/owned-forks.ts']){
      expect(REQUIRED_PACK_ENTRIES).not.toContain(path);expect(findBlockedPackEntries([path])).toEqual([path]);
    }
  });

  test("findBlockedPackEntries allows runtime files", () => {
    const files = ["src/index.ts", "web/static/classic/index.html", "docs/architecture.md"];
    expect(findBlockedPackEntries(files)).toEqual([]);
  });

  test("findMissingRequiredPackEntries flags missing required runtime files", () => {
    const [firstRequired] = REQUIRED_PACK_ENTRIES;
    const files = REQUIRED_PACK_ENTRIES.filter((entry) => entry !== firstRequired);

    expect(findMissingRequiredPackEntries(files)).toEqual([firstRequired]);
  });

  test("findMissingRequiredPackEntries accepts a complete required runtime set", () => {
    expect(findMissingRequiredPackEntries([...REQUIRED_PACK_ENTRIES])).toEqual([]);
  });
});
