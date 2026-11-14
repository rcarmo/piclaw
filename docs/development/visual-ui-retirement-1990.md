# Visual UI retirement (#1990)

Classic is the only web UI. Upgrading an instance previously configured for Visual opens the Classic workbench. No configuration or browser-storage migration is required.

## Compatibility

- Root and index requests always serve `classic/index.html` through the existing authenticated router.
- Stored `uiMode` values are ignored and preserved. A Visual selection in the domain, legacy web/root config or former environment alias emits one startup warning: `Visual UI has been removed; using Classic`.
- The runtime config and web-domain schema expose no selectable UI mode. The retired domain key cannot be written through the domain-config API.
- Removed static assets return the ordinary missing-file response. There is no replacement Visual route or compatibility bundle.
- Saved palette IDs and browser light/dark preference remain valid. Visual-only custom theme imports and panel layout settings are inert; their stored bytes are not deleted.

## Removal boundaries

The removal covers the Visual source tree, CSS, fonts and generated bundles; its build command, Docker build step, cache-stamping path and shell dispatch; and its standalone tests and fixtures.

The dependency audit compared both entrypoint graphs on `aeb5130e6`. Only `web/src/ui/theme-terminal.ts` was reachable exclusively from Visual. Classic uses `panes/terminal-pane.ts` and its contrast safeguards. The former CSS-role helper now exists only as a test palette projection. Visual's Default palette, custom-theme guards and selection convenience API are removed; shared named palettes, syntax roles, aliases, editor and widget infrastructure remain.

Paired tests retain the Classic branch. Two Classic model-refresh cases from the misleadingly named `visual-status-polling` suite now live in `classic-model-refresh.playwright.optional.test.ts`. Tests that injected Visual's importer into a Classic fixture lose that unsupported importer portion; their built-in Classic palette, rendering and input assertions remain.

Visual screenshots are archived under `docs/reviews/archive/visual-ui/`. Dated audits, source paths and qualification receipts remain historical evidence. The expense-retention witness records the later removal of its retained Visual file without changing original hashes or financial-retirement accounting.

Companion cleanup is tracked in [piclaw-addons #243](https://github.com/rcarmo/piclaw-addons/issues/243): retire Visual Settings host fixtures and selectors while retaining Classic and older-host coverage. No installed add-on is changed here.

## Qualification

Code qualification used `f2df7eee9` (includes main `33d335ee3`). Logs are retained under `/workspace/tmp/piclaw/runs/remove-visual-1990/`.

| Check | Result |
|---|---|
| Full host gate | 7,182 tests, 25 feature tests and 17 build tests pass; zero failures |
| Final focused browsers | 165 pass, zero failures; Chromium/WebKit, editor, workbench, timeline, queue, reconnect, audio, MCP, widgets, keyboard and real Sample Addon/Delegate Settings panes |
| Types, build, circular dependencies, stale bundles, environment surface | Pass; the configured compose gate retains its existing 291 out-of-seam diagnostics, so raw frontend compilation is not clean |
| Lint and unused exports | Commands fail; normalised diagnostics match untouched main |
| Last complete native attempt | Both private type projects and accepted-source integration pass; all 153 native files execute, 152 pass and `addon-host-services.test.ts` hits its existing five-second scenario deadline |
| Focused native comparisons | The last failing file passes separately on both candidate and main. Four different deadline failures from the earlier complete attempt also pass separately on both. Neither result makes a complete native gate green |

Earlier attempts are retained: the initial native preflight lacked private dev tooling (provisioned outside the gate), the first complete run had four deadline failures, and another stopped on the accepted-source audit deadline. The last receipt remains **INCOMPLETE**: `/workspace/tmp/piclaw/tests/native-gate-JWuQdh/receipt.json`. No deadline or assertion was relaxed.

The broad exploratory browser run exposed stale fixture coupling, which was repaired before the final 165-case run. Existing Classic failures were reproduced in paired base suites (including picker, Settings placement, theme effects and SVG limits); unrelated environment-dependent VNC/provider-auth cases also failed in the sweep. There is no final full-green browser claim. Keep the removal PR in draft until the remaining qualification limits are accepted or resolved.

Against main `33d335ee3`, the handwritten production paths (`runtime/src`, `runtime/web/src`, and the removed Visual tree, excluding `dist` and binary assets) have 16 added and 40,892 deleted lines: **40,876 net lines removed**. Generated outputs, tests, documentation and tooling are excluded from that number.

This source change does not install software, alter live configuration or restart a service.
