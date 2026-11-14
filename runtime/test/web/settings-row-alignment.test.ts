import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const classicComponent = readFileSync(join(repoRoot, "runtime/web/src/components/settings/compaction.ts"), "utf8");
const classicCss = readFileSync(join(repoRoot, "runtime/web/static/classic/css/settings.css"), "utf8");

test("Classic Compaction opts into dense rows without changing shared Settings rows", () => {
  expect(classicComponent).toContain('class="settings-section settings-dense-form"');
  // Count rows, not modifier-class occurrences. Native auto plus the eight
  // independent local-lite/tool/semantic/watchdog controls remain editable.
  expect(classicComponent.match(/class="settings-row settings-dense-row[ "]/g)).toHaveLength(9);
  expect(classicComponent).toContain("settings.compaction.enableAutomatic");
  expect(classicComponent).not.toContain("compaction-model-picker");
  expect(classicComponent).not.toContain("smartCompactionMethod");
  expect(classicComponent).not.toContain("compactionModel");
  expect(classicCss).toContain(".settings-dense-row {");
  expect(classicCss).toContain("grid-template-columns: var(--settings-dense-label-width) var(--settings-dense-control-width) minmax(0, 1fr)");
  expect(classicCss).toContain(".settings-dense-row-compound");
  expect(classicCss).toContain(".settings-row {\n    display: flex;");
});
