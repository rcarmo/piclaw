# Web theme palettes

Classic is the only web UI. Its 56 named palette IDs remain available; Default follows the selected browser mode, and **PiClaw Classic** is the explicit black palette.

## Choose a theme

Use **Settings → Appearance** in the web UI, or `/theme <id>`. Named palette and Default tint settings are instance-wide. Existing theme IDs remain valid; `monokai` is labelled **Monokai Original** and `monokai-pro` is **Monokai Pro** everywhere. They are separate palettes, not light/dark variants.

**Automatic theme mode (this browser)** selects system/light/dark for the Default, Solarized and GitHub automatic pairs. Explicit Light/Dark presets keep their own mode. This local preference does not change another user's browser. Default tint applies only to Default; selecting a named palette uses its authored accent.

**SynthWave ’84** is the normal, steady-glow version. **SynthWave ’84 Full** is a separate preset with bright neon text cores, layered halos, a slow 5.5-second syntax pulse and 4.8-second accent-light animation. Both include their glow without a checkbox; old browser opt-out values are ignored.

Full adapts upstream's light-core/coloured-halo treatment to Piclaw syntax roles. It also gives prose and controls inherited neon text, a six-second UI pulse, a glowing composer with scanlines and a 4.8-second frame pulse, neon popup edges and active navigation accents. Normal leaves ordinary prose unchanged. These UI effects and motion are Piclaw additions. There is no rapid flashing. Reduced motion keeps Full's strong static glow but stops animation; a document visibility event pauses CSS animations in hidden tabs. Forced colours suppress decorative shadows. Switching themes removes the effects. There is no perpetual JavaScript timer or RAF loop; visible Full effects can still consume browser paint/compositing work. Canvas terminals receive the palette, not CSS token glow.

## Catalogue

| Family | IDs / variants |
|---|---|
| Default / Classic | `default` (automatic), `piclaw-classic` (dark), `tango` (light), `xterm` (dark) |
| Monokai | `monokai` (**Original**), `monokai-pro` (**Pro**), `ristretto` |
| Familiar dark palettes | `dracula`, `nord`, `miasma`, `gotham`, `one-dark-pro` |
| Tokyo Night | `tokyo` (Night), `tokyo-night-storm`, `tokyo-night-light` |
| GitHub | `github` (automatic), `github-light`, `github-dark` |
| Solarized | `solarized` (automatic), `solarized-light`, `solarized-dark` |
| VS Code / Ayu | `vscode-light`, `vscode-dark`, `ayu-light`, `ayu-dark` |
| Gruvbox | `gruvbox` (dark), `gruvbox-light` |
| Catppuccin | `catppuccin` (Mocha), `catppuccin-latte`, `catppuccin-frappe`, `catppuccin-macchiato` |
| Everforest | `everforest-dark`, `everforest-light` (medium-background palettes) |
| Rosé Pine | `rose-pine`, `rose-pine-dawn` |
| Neutral concepts | `graphite`, `paper`, `oled` |
| Accessibility-focused concepts | `accessible-dark`, `accessible-light`, `colour-friendly-dark`, `colour-friendly-light` |
| Warm/cool concepts | `petrol`, `petrol-light` (Ivory & Petrol), `aubergine`, `burgundy`, `porcelain` |
| Vivid adaptations | `cobalt2`, `synthwave-84`, `synthwave-84-full` |
| Requested catalogue additions | `turbo-pascal`, `noctis`, `noctis-lux`, `bearded-arc`, `as400`, `lumon` |

The catalogue has 56 IDs, including explicit variants and automatic pairs. Aliases include `monokai-original`, `catppuccin-mocha`, `tokyo-night`, `synthwave`, `synthwave-full` and `petrol-copper`. `bearded` selects Bearded Arc, `catpuccin` resolves the common misspelling to Catppuccin Mocha, and `as400-green-screen` selects the AS/400 preset. Unlike the historical aliases, explicit `solarized-light/dark` and `github-light/dark` now choose their labelled mode rather than silently following the system.

The approved custom concepts are Piclaw palettes, not upstream theme products. Cobalt2 uses its blue/yellow vocabulary with a yellow primary action; SynthWave uses its midnight/magenta/cyan vocabulary, with normal static and Full animated glow variants. Both are adapted mappings, not claims of pixel-identical upstream UI styling.

## Requested vscodethemes families

The catalogue request was resolved through [vscodethemes](https://vscodethemes.com/?sort=trendingWeekly), then pinned to its publishers' source repositories. The listing is discovery, not a licence grant.

- [Turbo Pascal](https://vscodethemes.com/e/ionis.modern-turbo-pascal-ui/borland-turbo-pascal-original): **Turbo Pascal (Original)**, blue editor with grey shell/yellow accent. Theme JSON is MIT; the repository's separate non-commercial written-content licence is not used for copied code or documentation. Its source says `light` despite the dark blue editor; Piclaw intentionally classifies it as dark.
- [Tokyo Night](https://vscodethemes.com/e/enkia.tokyo-night/tokyo-night): existing `tokyo` ID preserved and labelled **Tokyo Night**, with Storm and Light added. Light is classified from the actual light palette despite upstream's inconsistent `dark` metadata.
- [Noctis](https://vscodethemes.com/e/liviuschera.noctis/noctis): representative original dark and **Noctis Lux** light variants; not every Noctis variation is bundled.
- [Bearded](https://vscodethemes.com/e/BeardedBear.beardedtheme/bearded-theme-arc): **Bearded Arc** from immutable MIT-licensed revision `01455843a944ec51216b373a13bd620fbea92e5a`. Current upstream is GPL-3.0; do not update this pinned source blindly or imply it is the latest release/all 60+ variants.
- [Catppuccin](https://vscodethemes.com/e/Catppuccin.catppuccin-vsc/catppuccin-mocha): official palette 1.8.0 values for Latte, Frappé, Macchiato and Mocha.
- [Nord](https://vscodethemes.com/e/arcticicestudio.nord-visual-studio-code/nord): source palette refreshed from the canonical Nord VS Code repository without changing the `nord` ID.
- [AS/400 Green Screen (5250)](https://vscodethemes.com/e/jordan-diaz-dev.as400-cursor/as-400-green-screen-5250): strict green-on-black UI, syntax, status and all 16 ANSI roles. Piclaw deliberately replaces the source's red errors, yellow warnings and cyan/mixed-green syntax with green intensities; existing labels/icons distinguish states. Contrast fallbacks and interaction overlays retain the phosphor hue.
- [Lumon](https://vscodethemes.com/e/oldjobobo.lumon-theme/lumon): the requested trending **OldJobobo Lumon**, not a different extension with the same name. Its restrained blue role palette is kept.

Source revisions, JSON hashes, catalogue links and notices are in the palette manifest. VS Code editor/sidebar/syntax/ANSI roles are mapped into Piclaw's shared model; action accents are deliberate palette-derived mappings, alpha surfaces are composited, and foreground contrast guards apply. This is a theme adaptation, not the original editor UI.

## Colour roles and contrast

`runtime/src/core/ui-theme-catalogue.ts` contains data only. Server theme discovery and Classic use those IDs and colours. `runtime/web/src/ui/theme-palette.ts` derives shared CSS namespaces from one palette:

- surfaces, foregrounds, muted text, borders and accents;
- maximum-contrast black/white text on accent buttons;
- warning/error/success, selection, focus, overlay and tint roles;
- syntax/code colours and terminal ANSI colours;
- reusable chart series colours.

Primary/secondary UI text is adjusted towards the palette foreground where needed to reach 4.5:1 on the declared solid UI surfaces. Code text/background and syntax roles preserve authored source colours; they are not substituted with UI accent/status colours or silently contrast-remapped. ANSI colours retain the terminal readability safeguard. Palette identity and characteristic accents are retained. These calculations are guardrails, not certification of every rendered component: alpha composition, images, custom add-ons and font sizes need their own checks. Colour-friendly presets change semantic hues; status text and existing icons remain necessary. The accessible pair targets stronger contrast without globally resizing controls.

The Classic terminal retains its contrast safeguards and uses the palette ANSI roles.

## Workspace and charts

Explorer selection, hover, folders and file-icon foregrounds use the shared palette. Folder-size segments and legend dots map stable paths onto six chart roles; deeper rings blend towards the panel background. SVG fills reference CSS variables directly, so changing a palette repaints an open chart without refetching folder data or rebuilding geometry. AS/400 stays green-only.

The system-meter traces use the same roles: CPU/accent, RAM/success, swap/danger, buffers/warning, RSS/type and VRAM/keyword. Normal SynthWave adds steady meter halos; Full adds layered pulsing halos plus chart/card neon edges. Reduced motion retains steady glow, hidden-document state pauses it, and forced colours remove it. Other palettes have no chart glow. Compact mobile meters keep their existing text-only layout.

See [the workspace/chart audit](reviews/workspace-chart-themes.md) for actual component captures and test coverage.

## Input focus

The web UI uses `theme-focus.css`, loaded after component styles and before Full's effects. Native inputs, textareas, selects, editable surfaces and custom selects use the palette focus ring. Keyboard-focusable controls use the same indicator; programmatically focused dialog containers are excluded. Carets, native control accents and DOM text selection follow the palette accent. The composer is one compound control: its outer frame receives the focus ring through `:focus-within`, while the inner textarea has no outline, border or focus shadow. Full keeps its glowing text and animated frame with a cyan focus ring. Fields and compose frames draw their ring over the existing border to avoid duplicate sharp contours; Full keeps soft halos without an extra zero-blur rim. Pickers and settings fields retain their own focus indicators. Invalid borders, disabled states and read-only behaviour are unchanged.

This styling cannot cross iframe/shadow roots or control operating-system select popups and mobile selection handles. Login and family pages have separate styles; the selected chat palette does not apply there. Forced-colour mode uses system Highlight/HighlightText colours.

Attachment/image lightboxes use a theme-derived backdrop with 0.62 alpha; images and controls stay opaque. Context and timestamp details use native browser `title` tooltips like model-picker controls. Their text can contain line breaks, but browser tooltip geometry is not controlled by Piclaw.

## Palette provenance

Colour data, adapted to Piclaw roles:

- Existing Piclaw Classic presets form the compatibility baseline (`eef87deaf`).
- [Catppuccin palette v1.8.0](https://github.com/catppuccin/palette): Latte and Mocha; MIT.
- [Everforest](https://github.com/sainnhe/everforest): medium dark/light palette; MIT.
- [Rosé Pine palette](https://github.com/rose-pine/palette): main and Dawn; MIT.
- [Cobalt2](https://github.com/wesbos/cobalt2-vscode): editor surfaces and syntax colour vocabulary; MIT.
- [SynthWave ’84](https://github.com/robb0wen/synthwave-vscode): colour vocabulary and Full's adapted light-core/layered-halo formulas; MIT. No VS Code injection/observer code is run. Pulse and accent motion are Piclaw-specific.

No external theme assets are fetched at runtime or during builds. Palette sources and upstream licence notices are recorded in `runtime/vendor-manifests/theme-palettes.json` and `docs/licenses/theme-palettes.txt`.

## Validation

`shared-themes.test.ts` checks catalogue parity, aliases, Original/Pro identity, complete semantic/ANSI roles and contrast. `shared-themes.playwright.optional.test.ts` uses real Appearance components with disposable stub APIs in Chromium and WebKit, checks every preset, actual selection, mode switching, intrinsic glow/forced colours, real syntax classes and palette syntax roles. It never changes the active instance's theme or opens its terminal.
