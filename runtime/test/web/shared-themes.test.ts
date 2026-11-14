import { expect, test } from "bun:test";
import {
  WEB_THEME_PRESETS,
  normaliseWebThemeId,
} from "../../src/core/ui-theme-catalogue.js";
import { THEME_PRESETS } from "../../src/channels/web/theming/ui-theme-data.js";

import {
  paletteVariables,
  themeContrast,
  themeForeground,
} from "../../web/src/ui/theme-palette.js";

test("the palette catalogue shares all identities and distinguishes Monokai Original and Pro", () => {
  expect(new Set(WEB_THEME_PRESETS.map((t) => t.id)).size).toBe(
    WEB_THEME_PRESETS.length,
  );
  expect(THEME_PRESETS.map((t) => t.name)).toEqual(
    WEB_THEME_PRESETS.map((t) => t.id),
  );

  for (const [id, label] of [
    ["monokai", "Monokai Original"],
    ["monokai-pro", "Monokai Pro"],
  ])
    expect(WEB_THEME_PRESETS.find((t) => t.id === id)?.label).toBe(label);
  for (const id of [
    "catppuccin-latte",
    "catppuccin",
    "everforest-dark",
    "everforest-light",
    "rose-pine-dawn",
    "graphite",
    "paper",
    "accessible-dark",
    "accessible-light",
    "colour-friendly-dark",
    "colour-friendly-light",
    "oled",
    "petrol",
    "petrol-light",
    "aubergine",
    "cobalt2",
    "burgundy",
    "porcelain",
    "synthwave-84",
  ])
    expect(normaliseWebThemeId(id)).toBe(id);
  expect(normaliseWebThemeId("monokai-original")).toBe("monokai");
  expect(normaliseWebThemeId("synthwave")).toBe("synthwave-84");
  expect(normaliseWebThemeId("synthwave-full")).toBe("synthwave-84-full");
  const normal = WEB_THEME_PRESETS.find((t) => t.id === "synthwave-84")!;
  const full = WEB_THEME_PRESETS.find((t) => t.id === "synthwave-84-full")!;
  expect(normal.label).toBe("SynthWave ’84");
  expect(full.label).toBe("SynthWave ’84 Full");
  expect(full.dark).toEqual(normal.dark);
  expect(full.glow).toBe(true);
  expect(normaliseWebThemeId("solarized-light")).toBe("solarized-light");
  expect(normaliseWebThemeId("not-a-theme")).toBeNull();
});

test("Fallout renames Petrol & Copper in Classic without changing saved identity", () => {
  expect(WEB_THEME_PRESETS.find((theme) => theme.id === "petrol")?.label).toBe("Fallout");
  expect(THEME_PRESETS.find((theme) => theme.name === "petrol")?.label).toBe("Fallout");

  for (const name of ["petrol", "petrol-copper", "fallout", " Fallout "])
    expect(normaliseWebThemeId(name)).toBe("petrol");
  expect(WEB_THEME_PRESETS.find((theme) => theme.id === "petrol-light")?.label).toBe("Ivory & Petrol");
});

test("all palette variants have consistent aliases, readable text and complete syntax/ANSI roles", () => {
  for (const theme of WEB_THEME_PRESETS)
    for (const mode of ["light", "dark"] as const) {
      const p = theme[mode];
      if (!p) continue;
      const vars = paletteVariables(p, mode);
      for (const [left, right] of [
        ["--bg", "--bg-primary"],
        ["--text", "--text-primary"],
        ["--accent", "--accent-color"],
        ["--error", "--danger-color"],
        ["--success", "--success-color"],
      ])
        expect(vars[left]).toBe(vars[right]);
      for (const surface of ["--bg-primary", "--bg-secondary", "--bg-hover"]) {
        expect(
          themeContrast(vars["--text-primary"], vars[surface]),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          themeContrast(vars["--text-secondary"], vars[surface]),
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        themeContrast(vars["--accent-contrast-text"], vars["--accent-color"]),
      ).toBeGreaterThanOrEqual(4.5);
      for (const token of [
        "--bg-code",
        "--text-code",
        "--syn-keyword",
        "--syn-comment",
        "--syn-inserted",
        "--syn-deleted",
        "--syntax-variable-definition",
        "--term-red",
        "--term-bright-blue",
        "--focus-ring",
        "--chart-4",
        "--tint-blue-13",
        "--overlay-white-07",
      ])
        expect(vars[token]).toBeTruthy();
    }
});

test("accent foreground maximises black/white contrast, including vivid Monokai pink", () => {
  expect(themeForeground("#f92672")).toBe("#000000");
  expect(themeForeground("#ffffff")).toBe("#000000");
  expect(themeForeground("#000000")).toBe("#ffffff");
});

test("requested catalogue families retain explicit source identity, mode and ANSI roles", () => {
  const ids = [
    "turbo-pascal",
    "tokyo",
    "tokyo-night-storm",
    "tokyo-night-light",
    "noctis",
    "noctis-lux",
    "bearded-arc",
    "catppuccin",
    "catppuccin-latte",
    "catppuccin-frappe",
    "catppuccin-macchiato",
    "nord",
    "as400",
    "lumon",
  ];
  for (const id of ids)
    expect(WEB_THEME_PRESETS.find((t) => t.id === id)).toBeTruthy();
  expect(normaliseWebThemeId("catpuccin")).toBe("catppuccin");
  expect(normaliseWebThemeId("bearded")).toBe("bearded-arc");
  expect(normaliseWebThemeId("as400-green-screen")).toBe("as400");
  const turbo = WEB_THEME_PRESETS.find((t) => t.id === "turbo-pascal")!;
  expect(turbo.mode).toBe("dark");
  expect(turbo.dark?.bgPrimary).toBe("#000088");
  expect(
    WEB_THEME_PRESETS.find((t) => t.id === "tokyo-night-light")!.mode,
  ).toBe("light");
  const as400 = WEB_THEME_PRESETS.find((t) => t.id === "as400")!;
  const vars = paletteVariables(as400.dark!, "dark");
  expect(vars["--text-primary"]).toBe("#00ff00");
  expect(vars["--term-green"]).toBe("#00cc00");
  expect(vars["--term-bright-green"]).toBe("#00ff00");
  expect(vars["--danger-color"]).toBe("#00ff00");
  expect(WEB_THEME_PRESETS.find((t) => t.id === "lumon")!.dark?.bgPrimary).toBe(
    "#1b2d40",
  );
});

test("AS/400 derived semantic, syntax, ANSI and overlay roles are strictly green or black", () => {
  const theme = WEB_THEME_PRESETS.find((t) => t.id === "as400")!;
  expect(theme.dark?.monochrome).toBe(true);
  const vars = paletteVariables(theme.dark!, "dark");
  for (const [key, color] of Object.entries(vars)) {
    const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
    const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),/.exec(color);
    expect(Boolean(hex || rgba)).toBe(true);
    const channels = hex
      ? hex.slice(1).map((c) => parseInt(c, 16))
      : rgba!.slice(1).map(Number);
    expect({ key, red: channels[0], blue: channels[2] }).toEqual({
      key,
      red: 0,
      blue: 0,
    });
  }
  for (const name of [
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
  ]) {
    expect(vars[`--term-${name}`]).toMatch(/^#00[\da-f]{2}00$/i);
    expect(vars[`--term-bright-${name}`]).toMatch(/^#00[\da-f]{2}00$/i);
  }
});
