import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const classicSource = readFileSync(join(import.meta.dir, "../../web/src/components/model-picker.ts"), "utf8");
const visualSource = readFileSync(join(import.meta.dir, "../../web/static/visual/frontend/src/components/model-context-bar/ModelPicker.tsx"), "utf8");
const visualContextBarSource = readFileSync(join(import.meta.dir, "../../web/static/visual/frontend/src/components/ModelContextBar.tsx"), "utf8");
const classicCss = readFileSync(join(import.meta.dir, "../../web/static/classic/css/chat.css"), "utf8");
const visualCss = readFileSync(join(import.meta.dir, "../../web/static/visual/css/shell.css"), "utf8");

test("classic and visual model pickers expose the shared searchable listbox contract", () => {
  for (const source of [classicSource, visualSource]) {
    expect(source).toContain("buildModelPickerProjection");
    expect(source).toContain('role="combobox"');
    expect(source).toContain('role="listbox"');
    expect(source).toContain('role="option"');
    expect(source).toContain("aria-activedescendant");
    expect(source).toContain("aria-disabled");
    expect(source).toContain("ArrowDown");
    expect(source).toContain("PageDown");
    expect(source).toContain("Open Models settings");
    expect(source).toContain("Compact context");
    expect(source).toContain("formatModelCataloguePricing");
  }
});

test("classic and visual pickers expose a separate accessible pin action", () => {
  for (const source of [classicSource, visualSource]) {
    expect(source).toContain("onTogglePin");
    expect(source).toContain('aria-keyshortcuts="Alt+Enter"');
    expect(source).toContain("event.altKey");
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain('placeholder="Search models…"');
    expect(source).toContain('aria-hidden="true"');
  }
  expect(classicSource).toContain("compose-model-catalogue-pin");
  expect(visualSource).toContain("model-picker__pin");
});

test("visual picker preserves unknown context instead of coercing it to zero", () => {
  expect(visualContextBarSource).toContain("contextTokens={agentContext.value?.tokens ?? null}");
  expect(visualSource).toContain("contextTokens: number | null");
});

test("classic and visual model picker styles include bounded desktop and mobile layouts", () => {
  expect(classicCss).toContain(".compose-model-catalogue-results");
  expect(classicCss).toContain("max-height: min(48vh, 430px)");
  expect(classicCss).toContain("position: fixed");
  expect(visualCss).toContain(".model-picker__results");
  expect(visualCss).toContain("max-height: min(48vh, 430px)");
  expect(visualCss).toContain(".model-picker__footer-start");
  for (const css of [classicCss, visualCss]) {
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("grid-template-columns: 44px minmax(0, 1fr)");
    expect(css).toContain("background: var(--bg-secondary");
    expect(css).toContain("border-right: 1px solid");
  }
});
