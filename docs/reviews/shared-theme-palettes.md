# Shared theme implementation evidence

Implemented from the approved theme galleries on 20 September 2026, based on `eef87deaf`. No live instance theme, service, credential or add-on configuration was changed.

## Scope

Both skins now use 45 shared palette identities/variants, retaining existing choices and adding the approved concepts. Monokai Original and Monokai Pro remain separate IDs/labels. Named palettes drive both token namespaces, document/native-control mode, syntax/code colours, semantic roles and ANSI terminal colours. Skin typography/layout remains independent. Default retains each skin's familiar starting palette.

The implementation includes browser-local system/light/dark preference for automatic pairs, optional static SynthWave glow (suppressed in forced colours), contrast-adjusted text and maximum-contrast accent foregrounds. Visual imports preserve preview/cancel/apply/reset semantics and explicit mode; a selected custom import remains a deliberate local override. Visual xterm now refreshes the chosen palette without reconnecting or sending terminal input.

## Verified locally

- Shared palette/alias/contrast and existing theme/terminal/slash-command suites: 40 tests passed, 1,330 assertions.
- Chromium and WebKit actual-component browser suite: 12 cases passed, 1,356 assertions.
  - Every one of the 45 presets checked through the shared runtime in each skin/engine.
  - Actual Appearance controls select Monokai Original, Monokai Pro, SynthWave and Paper at 390px.
  - Explicit mode vs system, token aliases, terminal variables and static glow on actual syntax-highlighter classes.
  - Glow toggle, no glow on normal prose, forced-colours suppression and switching away.
  - VS Code import through the file control, cancel to previous named theme, apply/reload/reset, invalid stylesheet fragments.
  - Real Visual xterm mounted against a stub WebSocket; switching light/dark repaints without reconnection or input injection.
- Repository typechecks and both web builds pass; 9 build tests passed.
- Palette source licences recorded under `docs/licenses/theme-palettes.txt`; source hashes recorded in `runtime/vendor-manifests/theme-palettes.json`.

Screenshots below are actual Appearance components with disposable API fixtures, not the earlier concept mock-ups. They cover narrow layouts; physical macOS/iOS/Windows and a screen reader were not exercised. Static contrast calculations are palette guardrails, not whole-application accessibility certification.

## Captures

- [Classic Paper at 390px](shared-theme-palettes/classic-paper.png)
- [Visual Paper at 390px](archive/visual-ui/shared-theme-palettes/visual-paper.png)
- [Classic SynthWave glow at 390px](shared-theme-palettes/classic-synthwave.png)
- [Visual SynthWave glow at 390px](archive/visual-ui/shared-theme-palettes/visual-synthwave.png)

## Gate caveats

The independent delegate review timed out; it is not counted as review evidence. An extra standalone strict Visual TypeScript invocation reports existing shared-module/baseline errors; the repository-owned typecheck targets and web build pass. `check:import-boundaries` reports ten existing latent-service imports in untouched database/scheduler files. Scoped lint passes for the new/changed theme files; four existing control-regex warnings in `terminal-pane.ts` are on unchanged lines. No unrelated scheduler, database or compiler-policy changes were made.

Full `make ci-fast` passed: 5,439 runtime tests passed, 4 skipped, zero failures; 25 feature tests and 9 web-build tests passed. Acceptance prose and executable mappings are in `tests/e2e/features/shared/theme-palettes.feature`.
