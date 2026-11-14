import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const classicComponent = readFileSync(join(repoRoot, "runtime/web/src/components/settings/keyboard.ts"), "utf8");
const classicCss = readFileSync(join(repoRoot, "runtime/web/static/classic/css/settings.css"), "utf8");

test("classic Keyboard uses the shared settings model and no layout-critical inline styles", () => {
  expect(classicComponent).toContain("keyboard-shortcut-settings.js");
  expect(classicComponent).not.toContain("style=");
  expect(classicComponent).not.toContain("grid-template-columns:minmax(240px");
  expect(classicComponent).not.toContain("min-height:46px");
  expect(classicComponent).toContain('class="settings-shortcut-input"');
  expect(classicComponent).toContain('for=${inputId}');
  expect(classicCss).toContain(".settings-shortcut-controls .settings-shortcut-input");
  expect(classicCss).toContain(".settings-dialog-narrow .settings-shortcut-card");
});
