# Compose focus belongs to the frame

Both skins now highlight the outer compose frame when it contains focus. The inner textarea has no outline, border or focus box shadow. This corrects the generic input-focus styling introduced in #1362.

`theme-focus.css` excludes compose textareas from the generic input ring and applies the palette ring to `.compose-input-wrapper:focus-within` and `.chat__compose-container:focus-within`. The inner-field reset applies across focus/blur states. Full supplies a cyan frame-focus colour; its text glow, scanlines and animated outer shadow remain unchanged. Other themes use `--focus-ring`. Forced colours use the system Highlight outline on the frame.

Picker, session, custom-select and Settings fields retain their existing individual focus indicators. Carets, selection colours and composer keyboard/send behaviour are unchanged. Focus outlines do not change element dimensions.

## Verification

A red regression on the unchanged build reproduced inner-field outlines and absent outer outlines across the catalogue. The corrected browser suite passes **34 Chromium/WebKit cases / 762 assertions**. Eight new cases exercise real Classic ComposeBox and Visual ChatPanel at 390px and 1280px, looping all 56 presets plus an imported theme. They check:

- outer focus colour/width and removal after blur;
- no inner outline, border or box shadow;
- stable dimensions and themed caret;
- pointer focus and keyboard traversal;
- Full text/frame effects, reduced motion and forced colours;
- existing picker/settings/custom-select focus, selection and dismissal regressions.

The fixture is served on a disposable localhost origin with synthetic responses; it does not change live preferences. Base includes chart-theme PR #1365 at `4c2d61a61`.

The first full gate also exposed an existing shared-snapshot import assumption: rendering tests use partial `window` objects without `addEventListener`. The module now checks that method before registering browser listeners. A standalone red run failed all eight Post recovery-chip tests; the guard and a partial-window import regression pass 15 tests / 61 assertions. Real-browser polling/event behaviour is unchanged.

Final combined validation passes **46 browser cases / 858 assertions**, including the shared poller lifecycle suite. `make ci-fast` passes **5,509 runtime tests** (4 skipped), 25 feature tests and 9 build tests. Four typechecks, scoped lint, packaging hygiene, stale-dist and environment-surface checks pass.

## Captures

- [Classic phone composer](compose-frame-focus/classic-phone.png)
- [Visual desktop composer](archive/visual-ui/compose-frame-focus/visual-desktop.png)

No merge, installation or reload is included.
