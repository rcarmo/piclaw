# Settings control contract

Ordinary Classic fields define the control reference. Preserve role-specific typography, density, native semantics and keyboard focus.

## Built-in reference roles

| Role | Classic |
| --- | --- |
| Text and number | `.settings-row input`, `.settings-number-input` |
| Password | `.settings-keychain-input` |
| Search | `.settings-header-filter` / `.settings-filter-input` |
| Select | `.settings-keychain-select` |
| Textarea | `.settings-row textarea`, `.settings-keychain-input` |
| Label | `.settings-row label` |
| Help | `.settings-hint` |
| Action | `.settings-row button` |
| Card | Existing pane-specific cards |

Classic ordinary text controls currently use 6px/10px padding, a 6px radius,
1px border, and 0.88em text. Their native input font is intentionally preserved;
textarea/monospace roles need not use the same family. In the Chromium fixture,
text computes to 13.2px at 1366/820px and 11.088px at 520/390px.
Widths are bounded by their containing pane. Preserve the existing role-specific dimensions.

Native number steppers, search affordances, selects, multiline text and monospace
shortcut values retain role differences. Focus must be keyboard-visible; keep
the browser outline where it already works. Controls that suppress it receive
the existing palette accent. Disabled/read-only controls retain native semantics;
validation errors use `aria-invalid` and a referenced error message, not colour
alone. Status/error messages use a live region, and closing a transient form
returns focus to its opener without changing save/authentication behavior.

## Add-on authoring

The host puts `.settings-addon-pane` **only** on registered add-on content.
Do not add it to built-in panes or supply global descendant CSS. Existing legacy
add-ons retain host compatibility styling; new panes opt into these classes:

| Class | Purpose |
| --- | --- |
| `settings-addon-section` | Bounded section spacing |
| `settings-addon-field` | Label, input and optional help/validation stack |
| `settings-addon-label` | Host label typography; use `for`/`id` or wrap the input |
| `settings-addon-control` | Text/search/password/URL/number/select/textarea shell |
| `settings-addon-control-group` | Wrapping compound controls, such as password + Save; keep both in the same parent |
| `settings-addon-help` | Help text; connect with `aria-describedby` when appropriate |
| `settings-addon-actions` | Wrapping action row |
| `settings-addon-error` | Validation/error colour; use `role="alert"` for new errors |
| `settings-addon-status` | Neutral status; use `role="status"` for asynchronous results |

```html
<section class="settings-addon-section">
  <div class="settings-addon-field">
    <label class="settings-addon-label" for="my-addon-endpoint">Endpoint</label>
    <input class="settings-addon-control" id="my-addon-endpoint" type="url"
           aria-describedby="my-addon-endpoint-help">
    <span class="settings-addon-help" id="my-addon-endpoint-help">HTTPS endpoint.</span>
  </div>
  <div class="settings-addon-actions">
    <button type="button">Save</button>
    <button type="button" data-settings-button="danger">Remove</button>
  </div>
  <p class="settings-addon-status" role="status"></p>
</section>
```

The existing button contract is unchanged: ordinary buttons need no new class;
`data-settings-button="primary|danger|icon|unstyled"` supplies semantic variants
or the deliberate custom-widget escape. Native `disabled` prevents activation;
`aria-disabled` alone requires the author to prevent the handler action.

Host variables named `--settings-addon-control-{font,size,padding,radius,width,
background,border,accent}` and `--settings-addon-{label,help}-size` expose the
host defaults. Prefer the classes rather than copying their current values into
inline styles. Checkbox/radio controls remain native; do not give them the text
control class. At <=640px text controls fit the field width and action rows wrap.
Field labels, controls and help stack at every width; no fixed help indentation
is needed. A control group may contain wrapping labelled radios without assigning
the text-control class to them. Add-ons supporting older hosts can supply scoped,
low-specificity fallback CSS, for example `:where(.my-addon) .settings-addon-field`;
the host's `.settings-addon-pane .settings-addon-field` contract wins when present.
Do not claim the new classes are available in an older published host version.
Complex lists/grids can retain pane-owned layout CSS; the host no longer erases
their `max-height`. Prefix DOM IDs with the add-on identity to avoid collisions.

Configuration transport is unchanged: use the authenticated direct add-on config
API for non-secrets and `/agent/keychain` for secrets, as described in
[Settings and add-ons](settings-and-addons.md). These classes do not confer
authorization or change persistence.

## Regression evidence

`settings-controls.playwright.optional.test.ts` mounts real Settings hosts and
General/Keychain components, using fixture-only responses. It checks content
viewport bounds at 1366, 820, 520 and 390px, opt-in control shells against each
host's actual General input, and native state/focus semantics in light/dark.
It writes screenshots and structured computed-style measurements to
`.artifacts/settings-controls/`. Run through the local isolated test launcher
with the optional browser flag and an explicit existing Playwright browser cache.

Source guards in `settings-controls.test.ts` keep host normalization scoped.
Existing Keyboard, dense-row and add-on-button browser suites remain required
regressions. Screenshots and counts are validation receipts only after the
corresponding run passes; the fixture itself is not evidence of completion.

To include the actual first-party Sample Addon and Delegate entries, set
`PICLAW_SETTINGS_ADDONS_ROOT` to an absolute companion `piclaw-addons` checkout
when invoking the isolated test launcher. The additional eight cases mount both
real host at all four widths, retain Delegate's bounded lists and check the
root disappears when returning to General. Without that explicit checkout these
cases are skipped; synthetic controls alone do not certify add-on integration.
Entries are served as exact-path, individually transpiled modules, like the
production asset handler. Do not bundle them for this acceptance check: bundlers
can hide an invalid `./styles.js` import when only `styles.ts` exists in a package.
