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

Validation logs and the Classic case audit are retained under `/workspace/tmp/piclaw/runs/remove-visual-1990/`. Build, runtime/web type gates and circular-dependency checks pass. The configured compose gate retains its existing 291 out-of-seam diagnostics; raw frontend compilation is not clean.

Lint and unused-export commands already fail on the untouched base. Normalised candidate diagnostics match that base. The broad optional browser suite also contains existing failures and environment-dependent cases; focused and paired baseline results must accompany the PR. No full-green browser claim follows from the focused tests.

This source change does not install software, alter live configuration or restart a service.
