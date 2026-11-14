import { completeSyntaxPalette } from "../../../src/core/theme-syntax.js";
import type {
  ThemeMode,
  ThemePalette,
} from "../../../src/core/ui-theme-catalogue.js";

function rgb(value: string): number[] | null {
  const match = /^#([\da-f]{6})$/i.exec(value || "");
  if (match)
    return [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16));
  const short = /^#([\da-f]{3})$/i.exec(value || "");
  if (short) return [...short[1]].map((c) => parseInt(c + c, 16));
  const css =
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i.exec(
      value || "",
    );
  return css ? css.slice(1, 4).map(Number) : null;
}
function luminance(value: string): number {
  const channels = (rgb(value) || [0, 0, 0]).map((v) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
export function themeContrast(a: string, b: string): number {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function themeForeground(accent: string): string {
  return themeContrast("#000000", accent) > themeContrast("#ffffff", accent)
    ? "#000000"
    : "#ffffff";
}
function mix(a: string, b: string, weight: number): string {
  const x = rgb(a),
    y = rgb(b);
  if (!x || !y) return a;
  return (
    "#" +
    x
      .map((v, i) =>
        Math.round(v * (1 - weight) + y[i] * weight)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function readableThemeColor(
  value: string,
  foreground: string,
  surfaces: string[],
  minimum = 4.5,
): string {
  if (!rgb(value) || !rgb(foreground) || surfaces.some((s) => !rgb(s)))
    return value;
  for (let i = 0; i <= 100; i++) {
    const next = mix(value, foreground, i / 100);
    if (surfaces.every((bg) => themeContrast(next, bg) >= minimum)) return next;
  }
  return foreground;
}
export function themeAlpha(value: string, opacity: number): string {
  const c = rgb(value);
  return c
    ? `rgba(${c.join(", ")}, ${opacity})`
    : `color-mix(in srgb, ${value} ${opacity * 100}%, transparent)`;
}
/** Keep selected prose readable without changing the theme's foreground hues.
 * Keep authored code foregrounds unchanged and at least at their 3:1 baseline. */
function selectionBackground(accent: string, mode: ThemeMode, pairs: [string, string][]): string {
  const maximum = mode === 'dark' ? 0.28 : 0.2;
  if (!rgb(accent) || pairs.some(([fg, bg]) => !rgb(fg) || !rgb(bg))) return themeAlpha(accent, maximum);
  for (let step = Math.round(maximum * 100); step >= 0; step--) {
    const alpha = step / 100;
    if (pairs.every(([fg, bg], index) => themeContrast(fg, mix(bg, accent, alpha)) >= Math.min(index === 0 ? 4.5 : 3, themeContrast(fg, bg)))) {
      return themeAlpha(accent, alpha);
    }
  }
  return themeAlpha(accent, 0);
}
export function paletteVariables(
  p: ThemePalette,
  mode: ThemeMode,
): Record<string, string> {
  const bg = p.bgPrimary,
    panel = p.bgSecondary,
    raised = p.bgHover || panel;
  const text = readableThemeColor(
    p.textPrimary,
    p.monochrome ? p.textPrimary : mode === "dark" ? "#ffffff" : "#000000",
    [bg, panel, raised],
  );
  const muted = readableThemeColor(p.textSecondary, text, [bg, panel, raised]);
  const accent = p.accent,
    danger = p.danger,
    success = p.success,
    warning = p.warning || "#f0b429";
  const vars: Record<string, string> = {
    "--bg-primary": bg,
    "--bg-secondary": panel,
    "--bg-hover": raised,
    "--text-primary": text,
    "--text-secondary": muted,
    "--border-color": p.borderColor,
    "--accent-color": accent,
    "--accent-hover": p.accentHover || accent,
    "--accent-contrast-text": themeForeground(accent),
    "--accent-foreground": themeForeground(accent),
    "--danger-color": danger,
    "--success-color": success,
    "--warning-color": warning,
    "--bg": bg,
    "--bg-sidebar": panel,
    "--bg-status": panel,
    "--bg-terminal": panel,
    "--bg-elevated": raised,
    "--bg-input": panel,
    "--input-bg": panel,
    "--border": p.borderColor,
    "--input-border": p.borderColor,
    "--text": text,
    "--text-muted": muted,
    "--text-soft": muted,
    "--accent": accent,
    "--success": success,
    "--warning": warning,
    "--error": danger,
    "--handle": p.borderColor,
    "--handle-hover": accent,
    "--bg-code": p.codeBackground || p.bgPrimary,
    "--text-code": p.codeForeground || p.textPrimary,
    "--term-fg": text,
    "--focus-ring": readableThemeColor(accent, text, [bg, panel], 3),
    "--disabled-text": muted,
    "--readonly-background": panel,
    "--selection-background": selectionBackground(accent, mode, [[text, bg], [p.codeForeground || p.textPrimary, p.codeBackground || bg]]),
    "--accent-color-alpha": themeAlpha(accent, mode === "dark" ? 0.35 : 0.25),
    "--accent-soft": themeAlpha(accent, mode === "dark" ? 0.16 : 0.12),
    "--accent-soft-strong": themeAlpha(accent, mode === "dark" ? 0.28 : 0.2),
    "--search-highlight-color": themeAlpha(
      accent,
      mode === "dark" ? 0.35 : 0.2,
    ),
    "--chart-1": accent,
    "--chart-2": success,
    "--chart-3": warning,
    "--chart-4": danger,
    "--chart-5": p.syntax?.keyword || accent,
    "--chart-6": p.syntax?.type || success,
    "--overlay": themeAlpha("#000000", mode === "dark" ? 0.5 : 0.22),
    "--media-backdrop": themeAlpha(bg, 0.62),
    "--scrollbar-thumb": themeAlpha(
      p.monochrome ? text : mode === "dark" ? "#ffffff" : "#000000",
      0.25,
    ),
  };
  const syntax = completeSyntaxPalette(
    p.syntax,
    p.codeForeground || p.textPrimary,
  );
  const aliases: Record<string, string> = {
    literal: "atom",
    "variable-definition": "definition",
    "variable-local": "local",
    "variable-special": "variable2",
  };
  for (const [key, value] of Object.entries(syntax)) {
    vars[`--syn-${key}`] = value;
    vars[`--syntax-${key}`] = value;
  }
  for (const [key, role] of Object.entries(aliases))
    vars[`--syntax-${key}`] = syntax[role as keyof typeof syntax];
  const ansi = {
    black: muted,
    red: danger,
    green: success,
    yellow: warning,
    blue: accent,
    magenta: p.syntax?.keyword || danger,
    cyan: p.syntax?.type || accent,
    white: text,
  };
  for (const [key, value] of Object.entries(ansi)) {
    vars[`--term-${key}`] = readableThemeColor(
      p.terminal?.[key] || value,
      text,
      [panel],
      key === "black" ? 3 : 4.5,
    );
    vars[`--term-bright-${key}`] = p.terminal?.[`bright-${key}`]
      ? readableThemeColor(
          p.terminal[`bright-${key}`],
          text,
          [panel],
          key === "black" ? 3 : 4.5,
        )
      : mix(vars[`--term-${key}`], text, 0.18);
  }
  for (const n of [35, 40, 50, 85])
    vars[`--overlay-black-${n}`] = themeAlpha(
      "#000000",
      mode === "dark" ? n / 100 : n / 150,
    );
  for (const n of [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 18, 25, 28])
    vars[`--overlay-white-${String(n).padStart(2, "0")}`] = themeAlpha(
      p.monochrome ? text : mode === "dark" ? "#ffffff" : "#000000",
      n / 100,
    );
  for (const [name, color, steps] of [
    ["red", danger, [10, 13, 15, 25, 27, 40]],
    ["blue", accent, [8, 13, 15, 27]],
    ["green", success, [8, 10, 13, 15, 18, 27]],
  ] as const) {
    for (const n of steps)
      vars[`--tint-${name}-${String(n).padStart(2, "0")}`] = themeAlpha(
        color,
        n / 100,
      );
  }
  return vars;
}
