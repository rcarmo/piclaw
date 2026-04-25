---
id: validate-drawio-ui-overrides-after-vendor-upgrade
title: Validate draw.io UI overrides after vendor upgrade
status: next
priority: high
created: 2026-04-22
updated: 2026-04-22
target_release: next
estimate: M
risk: high
tags:
  - work-item
  - kanban
  - drawio
  - vendor
  - web
  - ui
  - overrides
  - regression
owner: pi
origin: "User request after draw.io vendor refresh"
---

# Validate draw.io UI overrides after vendor upgrade

## Summary

We have a fresh draw.io vendor upgrade in-tree, and the last time this area
changed we ran into painful regressions around UI override behavior.

This ticket tracks a deliberate validation pass for the draw.io editor/viewer
integration, with special attention to the custom UI override layer, startup
hooks, embed-mode behavior, and any places where upstream file/layout changes
can silently break our override assumptions.

## Acceptance Criteria

- [ ] Confirm the draw.io editor still opens correctly inside the Piclaw pane
      host after the vendor upgrade.
- [ ] Verify the expected Piclaw-specific UI overrides still apply at startup
      and are not ignored due to upstream boot-order or file-layout changes.
- [ ] Validate the customized draw.io surface for toolbar/menu visibility,
      embed-mode constraints, and any intentionally hidden upstream controls.
- [ ] Verify file open, edit, save, export, and reload flows still work for the
      draw.io editor integration.
- [ ] Run browser-level validation for at least one real diagram edit session,
      including refresh/reopen behavior and no obvious console/runtime errors.
- [ ] Identify any override points that are brittle against future upstream
      upgrades and document them in the ticket notes or follow-up fixes.
- [ ] File any discovered regressions as follow-up fixes with explicit links.

## Implementation Paths

### Path A — recommended

Run a focused validation pass against the current upgraded vendor payload,
starting from the actual Piclaw draw.io entry flow and checking each known UI
override assumption in the live browser.

This should include:

1. source review of the draw.io viewer/editor integration and override hooks
2. browser smoke test in the embedded pane
3. save/export/reopen validation
4. targeted follow-up fixes only where a regression is confirmed

### Path B — alternative

Add a deeper automated harness first, then validate manually. This may be worth
it if the current pass finds repeated breakage, but is likely more work than we
need for the first post-upgrade check.

## Test Plan

- Applicable regression classes from `workitems/regression-test-planning-reference.md`:
  - [x] Bug replay / known-regression test
  - [ ] State-machine / invariant test
  - [ ] Routing matrix test
  - [x] Interaction scenario test
  - [x] Restore / reconnect matrix test
  - [x] Pane / viewer contract test
  - [x] Real-browser smoke test
- Existing tests to rerun are listed:
  - `make build-web`
  - any draw.io viewer/editor-specific tests found during implementation
- New regression coverage to add is listed:
  - focused coverage for any brittle override bootstrapping logic discovered
  - a smoke/assertion path for the draw.io pane contract if currently missing
- Real-browser smoke pass required? Yes — validate the actual draw.io pane in
  the web UI after the vendor refresh.

## Definition of Done

- [ ] All acceptance criteria satisfied and verified
- [ ] Tests added or updated — passing locally
- [ ] Type check clean
- [ ] Docs and notes updated with links to ticket
- [ ] Operational impact assessed
- [ ] Follow-up tickets created for deferred scope
- [ ] Update history complete with evidence
- [ ] Ticket front matter updated

## Updates

### 2026-04-22
- Created immediately after the draw.io vendor upgrade because this surface has
  a history of breaking around UI overrides and upstream bootstrap changes.
- Marked high priority so we do not repeat the previous round of silent
  override regressions.

## Notes

- Treat upstream file moves, renamed bootstrap assets, or changed init timing
  as likely regression sources.
- Prefer validating the live integrated pane over only checking vendored files
  on disk.

## Links

- Vendor script: `runtime/scripts/vendor-drawio.ts`
- Vendor payload: `runtime/extensions/viewers/drawio-editor/vendor/`
- Related viewer extension: `runtime/extensions/viewers/drawio-editor/`
