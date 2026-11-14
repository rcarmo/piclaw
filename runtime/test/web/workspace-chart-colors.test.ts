import { expect, test } from "bun:test";
import { workspaceChartColor } from "../../web/src/ui/workspace-chart-colors";
import { paletteVariables } from "../../web/src/ui/theme-palette";
import { WEB_THEME_PRESETS } from "../../src/core/ui-theme-catalogue";

test("stable workspace slots and depth shading resolve through CSS instead of fixed hues", () => {
  expect(workspaceChartColor("src")).toBe(workspaceChartColor("src"));
  expect(workspaceChartColor("src")).toMatch(/^var\(--chart-[1-6]\)$/);
  expect(workspaceChartColor("src", 1)).toBe(
    `color-mix(in srgb, ${workspaceChartColor("src")} 90%, var(--bg-secondary))`,
  );
  expect(workspaceChartColor("src", 99)).toContain("70%");
});
test("every preset exports six chart colours and AS400 remains green-only", () => {
  for (const theme of WEB_THEME_PRESETS)
    for (const mode of ["light", "dark"] as const) {
      const p = theme[mode];
      if (!p) continue;
      const vars = paletteVariables(p, mode);
      for (let i = 1; i <= 6; i++) {
        expect(vars[`--chart-${i}`]).toBeTruthy();
        if (theme.id === "as400")
          expect(vars[`--chart-${i}`]).toMatch(/^#00[0-9a-f]{2}00$/i);
      }
    }
});
