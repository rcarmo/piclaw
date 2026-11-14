import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) => readFileSync(join(import.meta.dir, "../../web/static", file), "utf8");

test("opt-in Settings field styles are loaded in Classic and confined to the add-on host", () => {
  for (const skin of ["classic"]) {
    expect(read(`${skin}/css/styles.css`)).toContain('@import "../../common/css/settings-addon-controls.css";');
  }
  const css = read("common/css/settings-addon-controls.css");
  for (const role of ["section", "field", "label", "control", "control-group", "help", "actions", "error", "status"]) {
    expect(css).toContain(`.settings-addon-${role}`);
  }
  for (const rule of [":focus-visible", ":disabled", "[readonly]", '[aria-invalid="true"]', "max-width: 100%", "min-width: 0", "flex-wrap: wrap"]) expect(css).toContain(rule);
  expect(css).not.toContain("!important");
  expect(css).not.toContain("min-height: 44px");
});
