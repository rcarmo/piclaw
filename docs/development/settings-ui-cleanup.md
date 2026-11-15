# Settings UI cleanup

Follows the [MCP settings redesign](mcp-settings-redesign.md). Audit of every core Settings pane using the synthetic settings fixture (`web/src/dev/settings-widget-fixture.ts`) at 390 and 1280 px, light and dark. No live Settings endpoints were used.

## Fixed

| Area | Problem | Change |
|---|---|---|
| Editor, Developer panes | Not listed in the navigation since lazy loading was introduced; opening `developer` directly threw (`… is not a function`), and `editor` fell back to General | Listed up front with ids matching `registerSettingsPane`; the module loads when the pane opens; load failures show a status message |
| Tools | Column headers overlapped (`Enabled` over the icon, `Result compaction` over `Kind`) | Header and rows share one subgrid; summary column hidden in narrow dialogs |
| Models | Beside the detail panel the catalogue clipped the price columns behind a scrollbar | Containers are named; a list container query drops Family and Mode (both in the detail panel) below 640 px |
| Keychain | Phone headers broke mid-word (`TY PE`, `UPDAT ED`) | Narrow dialogs show name, variable and actions; the type moves under the name |
| Environment | Add/edit rows overflowed phones; empty list read `match ""` | `minmax(0, …)` grids that stack in narrow dialogs; separate empty message |
| Authentication | TOTP fields truncated beside the QR on phones; page-level `h2` | QR above full-width fields; `h3` like other panes |
| Type scale | Phones shrank Settings to 0.9em and nested `em` sizes compounded to 7.5–11 px | No phone shrink; small text floors at 12 px, controls and labels at 13 px |
| Controls | Unclassed buttons and selects used browser defaults; touch targets 18–32 px | Shared zero-specificity base for unclassed buttons/selects; 44 px targets in narrow dialogs |
| Phone header | Icon-only navigation hid the open pane's name | Narrow dialogs show the pane name in the header |

Registered add-on panes keep their own button contract (`.settings-addon-pane`); their button text follows the 13 px control size.

## Tests

`runtime/test/web/settings-ui-cleanup.playwright.optional.test.ts` (Chromium and WebKit, synthetic fixture) checks the cases above, plus every core pane at 390 and 1280 px for text under 12 px and controls under 44 px (narrow) or 28 px (desktop). Before the changes the scan reported 788 problems.

Intentional test updates:

- `settings-controls`: phone General field text is 12.32 px (was 11.088 px).
- `settings-addon-buttons`: add-on button text is 13 px at both widths; the narrow stepper is 44 px.
- `keyboard-settings-ux`: narrow shortcut inputs are 44 px; the off-dialog reference row cannot show that.
- `model-settings-components`: the catalogue's container query is named.

The compose type baseline drops from 291 to 283 diagnostics: typing the section metadata removed eight `isExtension`/`component` errors, and two existing diagnostics moved lines.

## Follow-up pass

| Area | Problem | Change |
|---|---|---|
| Navigation | Core Editor and Developer panes were listed among add-ons and styled with the add-on button contract; on phones the icon-only items had no accessible name; no item was marked as current | Core panes sit in the built-in group with core styling; every item has `aria-label`, `title` and `type="button"`; the open pane has `aria-current="page"`; the phone strip fades at its trailing edge |
| Add-ons | Absolutely positioned actions covered the description (and approached the core ribbon) once cards narrowed | Actions flow at the end of the card header |
| General | Avatar pickers were clickable `div`s without a name or keyboard access; on phones the picker sat on its own row | Labelled buttons beside their name field; 44 px on phones |
| Errors | Six different presentations of a block error | One alert style (tinted background, danger border, primary text, 13 px); inline field errors stay red text |
| Quick Actions | Toolbar buttons centred on phones; `Save & apply` lost its primary style inside `.settings-row`; empty list said "match this filter" without a filter | Left-aligned `.settings-actions` toolbar; separate empty message |

Three Settings browser suites had been failing on `main`, so they no longer protected Settings. They now pass:

- The shell placement and passkey suites did not mock `/agent/system-metrics`, which the always-on meters poll. A route was added.
- The widget-token Regenerate comparison opened General; that control now lives in Authentication → API access. Add-on buttons now match it: UI font, 13 px, control height.
- In a narrow work-area tab at 1024 px, the Sessions isolation select and its hint overflowed the pane. Settings rows now wrap, and selects can shrink.

The compose type baseline drops to 281: two `__piclawSettingsRequestedSection` writes are now typed instead of tracked by line number.

## Consistency pass

| Area | Change |
|---|---|
| Form rows | Sessions, Workspace, Editor and Developer use the dense label/control/help grid that Compaction already used, so controls start in one column within and across panes. The grid shrinks in narrow tabs and stacks on phones. |
| Labels | Visible labels name their checkboxes, selects and text fields (Compaction included) through a shared per-instance id helper. |
| Keychain (phones) | Notes stack; Save sits under them; reveal and delete share a row where they fit and wrap, rather than clip, at 320 px. |
| Providers | A configured provider shows its active auth type once; capability tags appear only when it is not configured. |
| Add-ons | The type chip appears only for skill packages, not on every extension. |
| About | Unknown versions are plain secondary text, not GitHub links. |
| Models (phones) | The 44 px pin no longer overlaps the model name. |
| Browser-local badge | Stays on one line. |
| Tests | The workspace About shell suite mocks the always-on meters endpoint and passes again. |

The app bundle raw budget rises from 1,520,000 to 1,525,000 bytes. `main` sat 890 bytes under the old limit after the earlier Settings changes; this pass adds about 1.2 KB, mostly label/id attributes. Deduplicating the Editor and Developer icons recovered about 0.4 KB.

## Not covered

- Registered add-on panes from the add-ons repository were reviewed from source only. They use inline styles and fixed colours; moving them to shared settings classes is separate work.
- Remaining polish: button variants, card styles, provider labels, add-on card badges and the phone navigation's scroll affordance.
