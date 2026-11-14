# Full UI effects and palette-aware input focus

SynthWave Full now glows across chat text, controls and the composer. Normal keeps its steady syntax glow. Input focus is themed consistently across both skins and all presets, independently of Full's effects.

## Findings

The served Classic CSS matched the merged `0aedc96c1` bundle (SHA-256 `05dc84bb9f6e48b9a3a880051de37e543859bd21c79cca2cfb560ac855da8110`). The missing prose glow was an implementation restriction: Full targeted syntax and selected action buttons, while its regression test explicitly required prose to have no shadow.

The focus audit covered Classic, Visual and shared CSS, inline component styles, and viewer-owned styles. Most explicit focus rules already used theme variables. Inputs without a rule, notably session searches, could retain native focus and selection colours. CustomSelect also needed a focus indicator after pointer selection returned focus to its trigger; `:focus-visible` alone did not cover that interaction.

## Changes

- `theme-focus.css` provides a two-pixel palette focus ring for native fields, editable surfaces and custom-select triggers. Keyboard-focusable controls use the same indicator. Negative-tabindex dialog containers keep their existing programmatic-focus presentation.
- Carets, native accents and DOM selections follow the palette. Imported VS Code themes use the same variables. Invalid borders and disabled/read-only state are preserved.
- Full uses inherited neon text on prose, labels and controls with a six-second pulse. Existing syntax colours and token-specific halos are retained.
- Actual Classic/Visual composers have layered cyan/magenta borders, scanlines and a 4.8-second frame pulse. Popups, focused inputs and active navigation receive neon edges.
- Effects depend on the Full ID and enabled glow state. Palette changes and custom imports remove them. Reduced motion keeps static glow; forced colours suppress decoration and use system focus colours. Hidden-document events pause all Full animations.

## Coverage

`theme-ui-effects.playwright.optional.test.ts` serves built CSS from a disposable localhost fixture. It makes no requests to the live application. Its 26 cases cover:

- 56 presets × 55 input/control cases × both skins × Chromium/WebKit: **12,320 focus/caret/accent checks**. The matrix includes native types, app input class families, a textarea, select, editable surface, invalid and read-only fields. DOM selection is checked for every palette.
- Imported VS Code focus colours, real model pickers, Classic session search, Visual session creation dialog, settings add-on controls and CustomSelect selection/keyboard traversal/Escape/Tab-out.
- Real Classic ComposeBox and Visual ChatPanel at 390px and 1280px. Tests check computed glow, animation progression, focus, horizontal overflow, reduced motion, forced colours, simulated hidden-document pause/resume and switching away.

The four-suite browser run passes **130 cases / 5,676 assertions**, with 16 optional external add-on cases skipped when their companion checkout is not configured. It includes existing palette/syntax/import/xterm, Settings and picker regressions.

The full `make ci-fast` gate passes **5,481 runtime tests** (4 skipped), **25 feature tests** and **9 build tests**. Typechecks, scoped lint, packaging hygiene, stale-bundle checks and the environment-surface audit pass.

## Limits

Native OS popup menus, mobile selection handles and content inside iframe/shadow roots are outside the page stylesheet. Login/family pages use separate styles and do not share the chat palette. Canvas terminals receive palette colours, not CSS text shadows. Hidden state is simulated; no native background-throttling, battery or idle-CPU claim is made. Visible Full intentionally incurs extra paint work. The attempted delegated audit timed out; these results are local checks, not independent review.

## Captures

Actual components, disposable fixture data:

- [Classic composer, 390px](synthwave-full-ui/classic-compose-390.png)
- [Visual composer, 1280px](archive/visual-ui/synthwave-full-ui/visual-compose-1280.png)
- [Visual model picker, 390px](archive/visual-ui/synthwave-full-ui/visual-model-390.png)
- [Classic session picker, 390px](synthwave-full-ui/classic-session-390.png)

No live theme change, merge, installation or reload is included.
