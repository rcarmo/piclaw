# Workspace About and window visibility

The shared timeline/workspace hamburger menu groups **Scale** immediately above **Language** and ends with **About…**. It opens a compact Settings-style dialog containing the running PiClaw, pi-ai and Bun versions, each linked to its GitHub project. Both General settings panes show the same list at the bottom. The old Visual version-only row is removed.

## Version source

`getRuntimeVersions()` reads PiClaw's runtime package metadata, the resolved installed pi-ai package metadata and `Bun.version`. It does not use dependency ranges or query GitHub. `/agent/about` and `/agent/settings-data` use the same helper. Existing authentication and family-route boundaries remain unchanged; the new route accepts GET only.

The dialog supports Escape, backdrop and close-button dismissal, focus restoration and a focus loop across its close button and project links. Loading failures display a status message without inventing version values. GitHub links open separately with `noopener noreferrer`.

## Workspace visibility

Classic previously restored `workspaceOpen.desktop` from origin-wide local storage on every document load. Another window could overwrite that value. A background window discarded and reloaded by the browser would then inherit the other window's choice.

Each window now snapshots its desktop preference in session storage, including on a narrow first load. Explicit desktop toggles update that snapshot. Local storage remains the default for newly opened windows. Focus, pageshow and visibility events do not replace the window's choice.

Responsive behaviour is unchanged: entering a narrow layout collapses the drawer without overwriting the desktop preference; widening does not automatically open it. A desktop reload restores that window's saved desktop choice. This fix does not change Visual's separate sidebar layout settings.

## Refinement and validation

Scope is the existing Classic workspace menu and both General panes. There is no new setting, footer, navigation page or persistence on the server. The About dialog contains only the requested core version information.

Tests cover installed version values, endpoint/General agreement, per-window snapshots, unavailable storage, narrow initial loads, two-window return/reload behaviour, menu ordering, links, dialog focus, failure status and mobile layout. Browser tests serve disposable local fixtures and intercept settings requests; they do not mutate live settings.

An independent source review found that narrow first loads must snapshot their per-window desktop preference before returning closed; this is fixed and covered by a unit test. The follow-up review found no blocking source issues. The existing narrow-to-desktop non-opening rule is deliberately preserved.

Browser validation also caught that the old explorer hamburger is hidden by CSS. The action now belongs to the visible shared `TimelineMenu`; no hidden duplicate remains.

Final validation:

- Clean full runtime phase: **5,836 passes, 7 skips, zero failures**, in 734 seconds, with owned frozen-lockfile dependencies.
- Final feature and web-build phases: **25 feature passes and 9 build passes**. The first feature run rejected missing acceptance tags on the new scenario file; correcting the tags passed the rerun without product changes.
- **37 focused tests, 95 assertions**; rebuilt Classic/Visual Chromium/WebKit: **4 passes, 92 assertions**, including Scale/Language adjacency, About-last ordering and two-window return/reload persistence.
- All five repository typechecks pass with the same 95 existing transitive frontend diagnostics. Silent-catch, structured-logging, scoped lint, stale-dist, pack-hygiene and diff checks pass.
- Current main `e27f6401f` was merged into this isolated branch after its MCP cleanup landed. The compatibility rerun passed **45 tests, 147 assertions**, the same **4 browser cases, 92 assertions**, and all typechecks. About and workspace-state source did not change during that integration.
- Independent final source review found no remaining blockers. The browser fixture waits for loaded General data rather than asserting against its initial placeholder.

The first full gate rejected comment-only storage catches; explicit safe read/write helpers now return fallback values. The next full run was interrupted by an authorised runtime reload before completion. It also exposed MCP credential-generation contamination in later session/add-on tests and two recovery-test timeouts. The test-only MCP cleanup from #1465 was applied before the clean full runtime rerun, and subsequently arrived through the merge of current main. The interrupted run is not counted as passing evidence.

No merge, deployment or restart is part of this change. A separately authorised runtime reload by another session occurred while this work was paused; these worktree changes were not installed.
