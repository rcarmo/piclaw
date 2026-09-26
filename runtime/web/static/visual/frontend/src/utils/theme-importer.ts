import {
  resolveVSCodeSyntax,
  type VSCodeSyntaxTheme,
} from "../../../../../../src/core/theme-syntax";
import { paletteVariables } from "../../../../../src/ui/theme-palette";
import { applyThemeChrome } from "../../../../../src/ui/theme-chrome";
import { reapplyStoredTheme } from "../../../../../src/ui/theme";
/**
 * VS Code theme importer — maps VS Code color keys to our CSS custom properties
 * and handles persistence via safe storage wrappers.
 */
import { safeRemoveItem, safeParseJSON, safeSetItem } from "./storage";

const LS_KEY = "piclaw_custom_theme";

/** VS Code → our CSS var mappings */
const VSCODE_TO_CSS: Record<string, string> = {
  // Background layers
  "editor.background": "--bg",
  "sideBar.background": "--bg-sidebar",
  "activityBar.background": "--bg-sidebar",
  "panel.background": "--bg-terminal",
  "statusBar.background": "--bg-status",
  "titleBar.activeBackground": "--bg-status",
  "input.background": "--input-bg",
  "dropdown.background": "--input-bg",
  "editorWidget.background": "--bg-elevated",
  "list.activeSelectionBackground": "--bg-elevated",
  "list.hoverBackground": "--bg-elevated",
  "quickInput.background": "--bg-elevated",
  "notifications.background": "--bg-elevated",
  "menu.background": "--bg-elevated",

  // Text
  "editor.foreground": "--text",
  "sideBar.foreground": "--text",
  "activityBar.foreground": "--text",
  "statusBar.foreground": "--text-soft",
  "tab.activeForeground": "--text",
  "tab.inactiveForeground": "--text-muted",
  "list.activeSelectionForeground": "--text",
  "list.inactiveSelectionForeground": "--text-muted",
  "input.foreground": "--text",
  "dropdown.foreground": "--text",
  "menu.foreground": "--text",
  "quickInput.foreground": "--text",

  // Borders
  "input.border": "--border",
  "panel.border": "--border",
  "sideBar.border": "--border",
  "editorGroup.border": "--border",
  "activityBar.border": "--border",
  "statusBar.border": "--border",
  "tab.border": "--border",
  "menu.border": "--border",

  // Accent / focus
  focusBorder: "--accent",
  "button.background": "--accent",
  "progressBar.background": "--accent",
  "list.highlightForeground": "--accent",
  "editorLink.activeForeground": "--accent",
  "textLink.foreground": "--accent",
  "textLink.activeForeground": "--accent",
  "editor.selectionBackground": "--selection-background",
  "selection.background": "--selection-background",

  // Semantic colors
  errorForeground: "--error",
  "editorError.foreground": "--error",
  "inputValidation.errorBorder": "--error",
  "editorWarning.foreground": "--warning",
  "inputValidation.warningBorder": "--warning",
  "gitDecoration.addedResourceForeground": "--success",
  "testing.iconPassed": "--success",

  // Editor-specific
  "editorLineNumber.foreground": "--text-muted",
  "editorLineNumber.activeForeground": "--text",
  "editorCursor.foreground": "--accent",
  "editorIndentGuide.background": "--border",
  "editorIndentGuide.activeBackground": "--border",
  "editorWhitespace.foreground": "--text-muted",

  // Scrollbar / handle
  "scrollbar.shadow": "--handle",
  "scrollbarSlider.background": "--handle",
  "scrollbarSlider.hoverBackground": "--handle-hover",
  "scrollbarSlider.activeBackground": "--handle-hover",

  // Terminal ANSI colors
  "terminal.ansiBlack": "--term-black",
  "terminal.ansiRed": "--term-red",
  "terminal.ansiGreen": "--term-green",
  "terminal.ansiYellow": "--term-yellow",
  "terminal.ansiBlue": "--term-blue",
  "terminal.ansiMagenta": "--term-magenta",
  "terminal.ansiCyan": "--term-cyan",
  "terminal.ansiWhite": "--term-white",
  "terminal.ansiBrightBlack": "--term-bright-black",
  "terminal.ansiBrightRed": "--term-bright-red",
  "terminal.ansiBrightGreen": "--term-bright-green",
  "terminal.ansiBrightYellow": "--term-bright-yellow",
  "terminal.ansiBrightBlue": "--term-bright-blue",
  "terminal.ansiBrightMagenta": "--term-bright-magenta",
  "terminal.ansiBrightCyan": "--term-bright-cyan",
  "terminal.ansiBrightWhite": "--term-bright-white",
  "terminal.foreground": "--term-fg",
  "terminal.background": "--bg-terminal",
};

export interface VSCodeThemeJSON extends VSCodeSyntaxTheme {
  name?: string;
}

/**
 * Parse a VS Code theme JSON and return a map of CSS custom property → value.
 */
export function importVSCodeTheme(
  json: VSCodeThemeJSON,
): Record<string, string> {
  const result: Record<string, string> = {};

  const colors = json.colors ?? {};

  // Map color keys
  for (const [vsKey, cssVar] of Object.entries(VSCODE_TO_CSS)) {
    const val = colors[vsKey];
    if (val && !result[cssVar]) {
      result[cssVar] = normalizeColor(val);
    }
  }

  if (
    Object.keys(result).length ||
    json.tokenColors?.length ||
    Object.keys(json.semanticTokenColors || {}).length
  ) {
    const resolved = resolveVSCodeSyntax(json);
    result["--text-code"] = resolved.foreground;
    result["--bg-code"] =
      result["--bg"] ||
      (json.type === "light" || json.type === "hcLight"
        ? "#ffffff"
        : "#1e1e2e");
    for (const [key, value] of Object.entries(resolved.syntax))
      result[`--syn-${key}`] = normalizeColor(value);
  }

  if (!Object.keys(result).length) return result;
  const dark =
    json.type === "dark" ||
    json.type === "hc" ||
    (!json.type && inferMode(result) === "dark");
  result["--piclaw-theme-mode"] = dark ? "dark" : "light";
  return result;
}

/** Normalize a VS Code color value (strip alpha shorthand, ensure #rrggbb) */
function normalizeColor(val: string): string {
  if (!val.startsWith("#")) return val;
  // VS Code uses #rrggbbaa (8-digit hex) — convert to rgba() for CSS
  if (val.length === 9) {
    const r = parseInt(val.slice(1, 3), 16);
    const g = parseInt(val.slice(3, 5), 16);
    const b = parseInt(val.slice(5, 7), 16);
    const a = (parseInt(val.slice(7, 9), 16) / 255).toFixed(3);
    return `rgba(${r},${g},${b},${a})`;
  }
  return val;
}

function inferMode(vars: Record<string, string>): "light" | "dark" {
  const bg = vars["--bg"] || "#1e1e2e";
  const match = /^#([0-9a-f]{6})$/i.exec(bg);
  if (!match) return "dark";
  const n = parseInt(match[1], 16);
  return 0.2126 * ((n >> 16) & 255) +
    0.7152 * ((n >> 8) & 255) +
    0.0722 * (n & 255) >
    150
    ? "light"
    : "dark";
}
export function applyTheme(vars: Record<string, string>): void {
  vars = Object.fromEntries(
    Object.entries(vars).filter(([key, value]) =>
      key === "--piclaw-theme-mode"
        ? value === "light" || value === "dark"
        : typeof value === "string" &&
          CSS.supports("color", value) &&
          !/[;{}]/.test(value),
    ),
  );
  document.getElementById("piclaw-theme-override")?.remove();
  const mode =
    vars["--piclaw-theme-mode"] === "light"
      ? "light"
      : vars["--piclaw-theme-mode"] === "dark"
        ? "dark"
        : inferMode(vars);
  const text = vars["--text"] || (mode === "dark" ? "#e7e9ea" : "#24292f");
  const syntax = Object.fromEntries(
    Object.entries(vars)
      .filter(([k]) => k.startsWith("--syn-"))
      .map(([k, v]) => [k.slice(6), v]),
  );
  const complete = paletteVariables(
    {
      bgPrimary: vars["--bg"] || (mode === "dark" ? "#1e1e2e" : "#ffffff"),
      bgSecondary:
        vars["--bg-sidebar"] ||
        vars["--bg"] ||
        (mode === "dark" ? "#16181c" : "#f6f8fa"),
      bgHover:
        vars["--bg-elevated"] ||
        vars["--bg-sidebar"] ||
        vars["--bg"] ||
        (mode === "dark" ? "#16181c" : "#f6f8fa"),
      textPrimary: text,
      codeForeground: vars["--text-code"] || text,
      codeBackground:
        vars["--bg-code"] ||
        vars["--bg"] ||
        (mode === "dark" ? "#1e1e2e" : "#ffffff"),
      textSecondary: vars["--text-muted"] || text,
      borderColor: vars["--border"] || "#718096",
      accent: vars["--accent"] || "#1d9bf0",
      danger: vars["--error"] || "#e65050",
      success: vars["--success"] || "#00ba7c",
      warning: vars["--warning"] || "#b58900",
      syntax,
    },
    mode,
  );
  // Only palette keys, with CSS colour values; imported content cannot inject stylesheet syntax.
  const allowed = new Set([...Object.keys(complete), "--term-fg"]);
  const safe = Object.fromEntries(
    Object.entries(vars).filter(
      ([key, value]) =>
        allowed.has(key) &&
        typeof value === "string" &&
        CSS.supports("color", value) &&
        !/[;{}]/.test(value),
    ),
  );
  // Explicit ANSI colours may be kept; UI text/aliases remain the contrast-adjusted complete map.
  const ansi = Object.fromEntries(
    Object.entries(safe).filter(
      ([key]) =>
        key.startsWith("--term-") ||
        [
          "--bg-terminal",
          "--bg-status",
          "--input-bg",
          "--input-border",
          "--handle",
          "--handle-hover",
          "--selection-background",
        ].includes(key),
    ),
  );
  const values = { ...complete, ...ansi };
  const style = document.createElement("style");
  style.id = "piclaw-theme-override";
  style.textContent =
    ":root {" +
    Object.entries(values)
      .filter(([, v]) => CSS.supports("color", v) && !/[;{}]/.test(v))
      .map(([k, v]) => k + ":" + v + " !important")
      .join(";") +
    "}";
  document.head.appendChild(style);
  const root = document.documentElement;
  root.dataset.customTheme = "true";
  root.dataset.theme = mode;
  root.dataset.synthwaveGlow = "off";
  root.classList.toggle("light", mode === "light");
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
  applyThemeChrome(values["--bg"]);
  window.dispatchEvent(
    new CustomEvent("piclaw-theme-change", { detail: { mode, custom: true } }),
  );
}
export function resetTheme(): void {
  document.getElementById("piclaw-theme-override")?.remove();
  document.documentElement.dataset.customTheme = "false";
  safeRemoveItem(LS_KEY);
  reapplyStoredTheme();
}
export function loadSavedTheme(): void {
  const vars = getSavedThemeVars();
  if (Object.keys(vars).length) applyTheme(vars);
}
export function saveTheme(vars: Record<string, string>): void {
  safeSetItem(LS_KEY, JSON.stringify(vars));
  applyTheme(vars);
}
export function getSavedThemeVars(): Record<string, string> {
  return safeParseJSON<Record<string, string>>(LS_KEY, {});
}
