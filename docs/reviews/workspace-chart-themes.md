# Workspace and meter theme consistency

Workspace selection, folder-size charts and meter traces now follow the active palette in both skins. Normal SynthWave gives the meters steady glow; Full adds animated neon halos and chart/card edges.

## Audit findings

- Classic folder charts generated an angle-based HSL rainbow and observed dark/light state independently of the palette.
- Visual sunbursts generated another HSL rainbow, with a fixed dark centre and fixed translucent tracks. List/donut dots used a separate ten-colour array.
- Visual selected tree rows fell back to blue because `--accent-bg`/`--accent-rgb` were not supplied by the shared theme map. Seti pseudo-elements also carried fixed file-type colours.
- The Classic VRAM sparkline mixed a fixed purple into the palette accent. None of the meter traces had the requested glow.

## Implementation

`workspaceChartColor(path, depth)` selects one of six CSS chart roles with a stable path hash. Ring depth blends towards `--bg-secondary`; segment geometry, ordering and sizes are unchanged. Visual list/donut dots use the same helper. Track, centre, separators and legend text use surface/border/text roles. Classic no longer needs a dark-mode observer or theme-driven chart regeneration.

`workspace-theme.css` provides shared explorer selection/hover, palette folder/file-icon foregrounds and six semantic meter colours. It removes the fixed blue selection and purple VRAM leaks. Glyphs and layout remain unchanged.

Normal SynthWave uses a static two-layer SVG drop shadow. Full uses three layers with a 5.5-second pulse, plus neon chart/card borders. Hidden-document state pauses the meter animation; reduced motion retains static glow; forced colours remove filters/shadows and use system stroke/selection colours. Switching to another palette removes the effects.

The new styles do not alter metric collection or polling. This branch incorporates main `97ed1f7a5`, including the shared five-second snapshot. Visual's production status bar still uses inline statistics. The shared HUD is additionally mounted under Visual CSS in the disposable fixture to verify its colour contract; this does not add a Visual production HUD.

## Validation

- 48 Chromium/WebKit browser tests passed / 3,446 assertions: eight new explorer/chart/meter cases at 390px/1100px, two existing workspace responsive cases and 38 shared-theme/syntax/import cases.
- 32 focused unit tests passed / 4,261 assertions, including chart slot determinism, sort-independent dot identity, all palette roles, AS/400 green-only colours, existing meter formatting and explorer behaviour.
- Full `make ci-fast` passed after integration with main: **5,508 runtime tests**, 4 skips, zero failures; 25 feature tests and 9 build tests. Four typechecks passed.
- Browser matrix cycles all 56 presets on mounted Classic WorkspaceExplorer or Visual FileTree/FolderPreview, checks actual SVG fill/stroke values, selected-row colours and Seti pseudo-elements, and exercises imported theme values. Theme switching issues no folder tree/stat requests and leaves arc geometry unchanged.
- Classic drill-in/zoom-out remains functional. The drill-in test dispatches a DOM click to the SVG segment because its bounding-box centre can fall in the centre hole; this is handler/geometry coverage, not a claim of improved pointer hit-testing.
- Both engines verify animation progression, simulated hidden pause/resume, reduced-motion static glow and switch-away cleanup. Chromium also checks forced colours. The phone fixture retains compact meter text and expands to desktop width to exercise real sparklines.

The fixture uses deterministic folder/metric data and a disposable localhost origin. No live workspace, user preference, metrics service or production theme is changed. No independent delegated review was available.

## Captures

- [Classic Full explorer and meters](workspace-chart-themes/classic-full.png)
- [Visual Full chart and shared-HUD contract](archive/visual-ui/workspace-chart-themes/visual-full.png)
- [Classic Paper](workspace-chart-themes/classic-paper.png)
- [Visual Paper](archive/visual-ui/workspace-chart-themes/visual-paper.png)
- [Classic phone layout](workspace-chart-themes/classic-phone.png)

No merge, install or reload is included.
