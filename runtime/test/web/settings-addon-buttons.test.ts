import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../web");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("both Settings hosts scope button normalisation to registered add-on content", () => {
  expect(read("src/components/settings-dialog.ts")).toContain("activeMeta?.isExtension ? ' settings-addon-pane' : ''");

  for (const skin of ["classic"]) {
    expect(read(`static/${skin}/css/styles.css`)).toContain('@import "../../common/css/settings-addon-buttons.css";');
  }
});

test("shared add-on button contract covers interaction states and composite control exclusions", () => {
  const css = read("static/common/css/settings-addon-buttons.css");
  for (const state of [":focus-visible", ":disabled", '[aria-disabled="true"]', '[data-settings-button="danger"]', '[data-settings-button="primary"]']) {
    expect(css).toContain(state);
  }
  expect(css).toContain(':not(.settings-number-step-btn):not(.settings-panel__stepper-btn):not([role="tab"]):not([role="switch"]):not([data-settings-button="unstyled"])');
  expect(css).toContain("prefers-reduced-motion: reduce");
});
