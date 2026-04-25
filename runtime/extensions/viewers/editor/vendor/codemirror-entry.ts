import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightWhitespace,
  scrollPastEnd,
  showPanel,
  Decoration,
  ViewPlugin,
  WidgetType,
  drawSelection,
} from "@codemirror/view";
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { defaultHighlightStyle, StreamLanguage, HighlightStyle, syntaxHighlighting, syntaxTree, indentOnInput, indentUnit } from "@codemirror/language";

export { EditorState, Compartment, RangeSetBuilder, RangeSet, Prec } from "@codemirror/state";
export {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightWhitespace,
  scrollPastEnd,
  showPanel,
  Decoration,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
export { javascript } from "@codemirror/lang-javascript";
export { python } from "@codemirror/lang-python";
export { markdown, markdownLanguage } from "@codemirror/lang-markdown";
export { go } from "@codemirror/lang-go";
export { cpp, cppLanguage } from "@codemirror/lang-cpp";
export { json } from "@codemirror/lang-json";
export { css } from "@codemirror/lang-css";
export { html } from "@codemirror/lang-html";
export { rust, rustLanguage } from "@codemirror/lang-rust";
export { yaml } from "@codemirror/lang-yaml";
export { sql } from "@codemirror/lang-sql";
export { xml } from "@codemirror/lang-xml";
export { StreamLanguage, HighlightStyle, syntaxHighlighting, syntaxTree, indentOnInput, indentUnit } from "@codemirror/language";
export { tags, classHighlighter } from "@lezer/highlight";
export { shell } from "@codemirror/legacy-modes/mode/shell";
export { indentWithTab } from "@codemirror/commands";
export { search, openSearchPanel, closeSearchPanel, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
export { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
export { lintGutter } from "@codemirror/lint";
export { vim } from "@replit/codemirror-vim";
export { indentationMarkers } from "@replit/codemirror-indentation-markers";
export { githubLight, githubDark } from "@uiw/codemirror-theme-github";
export { MergeView } from "@codemirror/merge";

// Additional exports for shared vendor usage by app-side syntax highlighting.
export { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
export { pythonLanguage } from "@codemirror/lang-python";
export { goLanguage } from "@codemirror/lang-go";
export { jsonLanguage } from "@codemirror/lang-json";
export { cssLanguage } from "@codemirror/lang-css";
export { htmlLanguage } from "@codemirror/lang-html";
export { yamlLanguage } from "@codemirror/lang-yaml";
export { xmlLanguage } from "@codemirror/lang-xml";
export { StandardSQL } from "@codemirror/lang-sql";
export { highlightTree } from "@lezer/highlight";
export { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
export { powerShell } from "@codemirror/legacy-modes/mode/powershell";
export { ruby } from "@codemirror/legacy-modes/mode/ruby";
export { swift } from "@codemirror/legacy-modes/mode/swift";
export { toml } from "@codemirror/legacy-modes/mode/toml";

/**
 * Keep the editor bootstrap on the direct @codemirror/* packages only.
 * Importing minimalSetup from the aggregate `codemirror` package can pull a
 * second @codemirror/state instance into the graph, which then breaks
 * extension flattening with "Unrecognized extension value" errors.
 */
export const minimalSetup = [
  highlightSpecialChars(),
  history(),
  drawSelection(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  keymap.of([
    ...defaultKeymap,
    ...historyKeymap,
  ]),
];
