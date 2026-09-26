# Editor theme and selection audit

Plain-text selection in Markdown live preview was painted twice. CodeMirror's drawn selection sat beneath a native selection using the global accent/contrast pair; the GitHub editor theme also supplied important native selection colours. The editor's accent override only changed the drawn layer and parsed accents as six-digit hex.

The new regression failed against the original implementation: native selection in GitHub Light computed to an opaque `rgb(9, 105, 218)` instead of transparent. This reproduces the plain-text report in attachment 3114; it is not a code-block reproduction.

## Findings and changes

| Surface | Finding | Change |
| --- | --- | --- |
| Plain-text selection | Native and drawn selection competed; native text colour could obscure prose | Keep one drawn selection background; native editor selection is transparent and preserves text colour |
| Syntax inside selections | Chromium can inherit the selection foreground from plain text | Explicit semantic-token selection foregrounds preserve authored syntax colours |
| Theme switching | Separate GitHub light/dark themes and a hex-only accent sampler | One CSS-variable editor theme, shared by current and baseline views; reconfigure only CodeMirror's light/dark theme extension |
| Selection readability | Five bundled palettes lost plain-text contrast under the tint | Derive visible selection alpha with a 4.5:1 prose target and a code-foreground baseline; preserve authored foreground colours |
| Live-preview prose | Named themes applied the code background/foreground to the whole editor | Preview prose uses primary reading colours; raw/code and fenced/inline code use code roles |
| Preview decorations | Active line, table zebra/hover/focus, copy feedback and unresolved notes used fixed tints | Shared accent, primary text, hover, success, danger and warning roles |
| Preview syntax | Separate hard-coded `.tok-*` palette existed, mostly masked by the shared important rules | Remove redundant token colours; retain the shared syntax-role contract |
| Callouts | Several types had fixed colours | Use theme semantic roles for warning, success, danger, muted and accent callouts |
| Vim | Fixed pink fat cursor | Accent/contrast cursor pair and accent outline; native selection stays suppressed in visual mode |
| Search and panels | Vendor/default colours differed from the host palette | Shared search/selection, panel, field, tooltip and autocomplete roles; initial reveal uses the same search role |
| Saved diff | Current and baseline views used the competing theme system | Both use the same new theme; existing success/danger diff decoration roles are retained |
| Large files | Reduced-feature mode still needs theme and selection support | New theme remains installed when parsing, preview and whitespace features are disabled |
| Editable table widgets | These use native contenteditable selection, not CodeMirror's layer | Exempt widget inputs and contenteditables from editor selection suppression |
| Imported VS Code themes | Editor selection background could become the UI accent and was not retained independently | Map selection to its own role; prefer editor-specific selection over generic selection; preserve explicit imported colour |
| Skin CSS | Repeated fixed light/dark token and active-line palettes | Remove duplicates from both skins; preserve shared token typography |
| Popout/host transfer | Styling must follow the destination document | Keep existing transfer lifecycle; verify content and destination theme foreground after moving hosts |
| High contrast | Vendor colours must not override system selection | System Highlight/HighlightText for forced-colour selection/cursor/widget states |

The code-review add-on supplied the useful convention: use shared `--bg-code`, `--text-code`, semantic status colours and accent-based selection. Core does not import add-on code or depend on the add-on being installed.

No change to document storage, editing transactions, live-preview parsing, keybindings, Vim commands, dirty tracking or save endpoints. No new dependencies. Unused imports exposed by scoped lint were removed.

## Validation

Base: `db1f1025d`. Isolated branch/worktree: `fix/editor-highlight-theme`, `/workspace/piclaw-worktrees/editor-highlight-theme`. The user-approved Restic restart interrupted the initial audit; work resumed from a checkpoint without editor deployment.

- Full local `make ci-fast`: 5,681 runtime passes, 7 skips, zero failures; 25 feature checks; 9 build tests.
- Focused editor, palette, syntax, table and transfer tests: 56 passes, 4,096 assertions.
- Editor and existing shared-theme browser suites: 50 passes. New editor matrix covers all 56 palettes across seven modes, both skins, Chromium/WebKit, source and compiled editor entrypoints.
- Additional browser checks cover syntax-role parity, editable-table native selection, RGB accents without an event, imported selection colours, search panels/matches, Vim visual selection, diff views, high contrast and cross-document moves.
- A pixel-level check hides only the selection layer and compares screenshots, proving the selection is painted rather than merely reporting a computed CSS colour.
- Four repository typecheck projects, scoped Oxlint, stale-dist, pack hygiene and diff checks pass.
- Two bounded independent reviews found no blockers: selection/theme CSS, then the source diff covering palette/import and preview changes. Earlier broad delegate attempts timed out; those provide no approval.

Browser fixtures use an ephemeral loopback server and block external requests. They load the real `StandaloneEditorInstance`, production CSS, and the compiled editor bundle with the shared vendor import map. No live files or credentials are mutated. Screenshots and full logs are retained under `/workspace/.pi/artifacts/editor-highlight-theme-20260926/` and `/workspace/tmp/editor-theme-*`.

## Limits

The contrast guarantee applies to bundled-palette prose selection. Authored syntax colours remain unchanged; low-contrast authored syntax is not silently recoloured. Explicit imported selection backgrounds remain user-authored. Desktop WebKit tests do not establish native iOS selection-handle behaviour, and Firefox was not run. The editor theme follows existing host theme events and CSS variables; no polling was added.

No merge, installation or restart was performed for this editor change.
