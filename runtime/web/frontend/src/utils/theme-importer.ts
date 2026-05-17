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
  "focusBorder": "--accent",
  "button.background": "--accent",
  "progressBar.background": "--accent",
  "list.highlightForeground": "--accent",
  "editorLink.activeForeground": "--accent",
  "textLink.foreground": "--accent",
  "textLink.activeForeground": "--accent",
  "selection.background": "--accent",
  "editor.selectionBackground": "--accent",

  // Semantic colors
  "errorForeground": "--error",
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

/** Token scope → our syntax highlight CSS var */
const TOKEN_SCOPE_TO_CSS: Record<string, string> = {
  "keyword": "--syn-keyword",
  "keyword.control": "--syn-keyword",
  "keyword.operator": "--syn-operator",
  "constant.numeric": "--syn-number",
  "constant.language": "--syn-atom",
  "string": "--syn-string",
  "string.quoted": "--syn-string",
  "comment": "--syn-comment",
  "comment.line": "--syn-comment",
  "comment.block": "--syn-comment",
  "variable": "--syn-variable",
  "variable.other": "--syn-variable",
  "variable.parameter": "--syn-variable",
  "entity.name.function": "--syn-definition",
  "entity.name.type": "--syn-type",
  "entity.name.class": "--syn-type",
  "entity.other.attribute-name": "--syn-property",
  "support.function": "--syn-definition",
  "support.type": "--syn-type",
  "support.class": "--syn-type",
  "storage.type": "--syn-keyword",
  "storage.modifier": "--syn-keyword",
  "meta.preprocessor": "--syn-macro",
  "meta.tag": "--syn-punctuation",
  "punctuation": "--syn-punctuation",
  "markup.heading": "--syn-heading",
  "markup.inline.raw": "--syn-string",
  "markup.deleted": "--syn-deleted",
  "markup.inserted": "--syn-inserted",
  "invalid": "--syn-invalid",
};

export interface VSCodeThemeJSON {
  name?: string;
  type?: "dark" | "light";
  colors?: Record<string, string>;
  tokenColors?: Array<{
    name?: string;
    scope?: string | string[];
    settings?: {
      foreground?: string;
      background?: string;
      fontStyle?: string;
    };
  }>;
}

/**
 * Parse a VS Code theme JSON and return a map of CSS custom property → value.
 */
export function importVSCodeTheme(json: VSCodeThemeJSON): Record<string, string> {
  const result: Record<string, string> = {};

  const colors = json.colors ?? {};

  // Map color keys
  for (const [vsKey, cssVar] of Object.entries(VSCODE_TO_CSS)) {
    const val = colors[vsKey];
    if (val && !result[cssVar]) {
      result[cssVar] = normalizeColor(val);
    }
  }

  // Map token colors (syntax highlighting)
  if (Array.isArray(json.tokenColors)) {
    for (const rule of json.tokenColors) {
      const scopes = Array.isArray(rule.scope)
        ? rule.scope
        : typeof rule.scope === "string"
        ? rule.scope.split(",").map((s) => s.trim())
        : [];

      for (const scope of scopes) {
        const cssVar = TOKEN_SCOPE_TO_CSS[scope];
        if (cssVar && rule.settings?.foreground && !result[cssVar]) {
          result[cssVar] = normalizeColor(rule.settings.foreground);
        }
      }
    }
  }

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

/** Apply a CSS var map to document.documentElement */
export function applyTheme(vars: Record<string, string>): void {
  // Remove any previous injected theme style
  const existing = document.getElementById('piclaw-theme-override');
  if (existing) existing.remove();

  // Inject a <style> block with :root overrides — wins over stylesheet :root
  const css = `:root { ${Object.entries(vars).map(([k, v]) => `${k}: ${v} !important`).join('; ')} }`;
  const style = document.createElement('style');
  style.id = 'piclaw-theme-override';
  style.textContent = css;
  document.head.appendChild(style);
}

/** Remove all custom properties set by applyTheme / loadSavedTheme */
export function resetTheme(): void {
  const existing = document.getElementById('piclaw-theme-override');
  if (existing) existing.remove();
  safeRemoveItem(LS_KEY);
}

/** Read saved theme vars from localStorage (returns empty object if none) */
function loadSavedThemeVars(): Record<string, string> {
  return safeParseJSON<Record<string, string>>(LS_KEY, {});
}

/** Load and apply the persisted theme from localStorage */
export function loadSavedTheme(): void {
  const vars = loadSavedThemeVars();
  if (Object.keys(vars).length > 0) {
    applyTheme(vars);
  }
}

/** Persist a CSS var map to localStorage and apply it */
export function saveTheme(vars: Record<string, string>): void {
  safeSetItem(LS_KEY, JSON.stringify(vars));
  applyTheme(vars);
}

/** Return the currently saved theme vars (for display/editing) */
export function getSavedThemeVars(): Record<string, string> {
  return loadSavedThemeVars();
}
