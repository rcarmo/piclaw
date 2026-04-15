---
id: test-oobe-in-local-container-with-playwright
title: Test OOBE in a local container with Playwright
status: done
priority: medium
created: 2026-04-09
updated: 2026-04-14
target_release: later
estimate: M
risk: low
tags:
  - work-item
  - kanban
  - testing
  - playwright
  - oobe
  - docker
  - web-ui
owner: pi
---

# Test OOBE in a local container with Playwright

## Summary

Add a realistic browser-validation path for the web OOBE flow using a local
containerized Piclaw instance plus Playwright.

The goal is to verify the actual first-run experience in an environment closer
to real deployment, rather than relying only on unit/component tests against
mocked app state.

## Problem Statement

The OOBE work is stateful and environment-sensitive:

- fresh browser storage matters
- runtime startup state matters
- provider readiness can differ between installs
- containerized behavior is closer to real deployment than a purely in-process
  test harness

Without a local container + real browser pass, it is easy to miss issues in:

- initial page load behavior
- persisted dismiss state
- compose prefill wiring
- reload/reconnect behavior
- setup assumptions that only show up in a more realistic runtime

## Desired Behavior

- A local containerized Piclaw test target can be started reproducibly for OOBE validation.
- Playwright can drive the browser against that target.
- The core OOBE states are testable end to end:
  - provider missing
  - provider ready
  - dismissed/hidden
  - popout suppression (if practical in the first slice)
- The test path is documented so it can be rerun locally by maintainers.

## Initial scenarios to cover

### Scenario 1 — first usable load with no provider configured
- start a fresh local containerized Piclaw instance
- open the web UI with fresh browser storage
- verify the OOBE panel appears
- verify copy distinguishes AI provider setup from app sign-in
- verify the primary CTA prefills `/login` into compose

### Scenario 2 — dismiss persistence
- dismiss the OOBE panel
- reload the page
- verify the panel stays hidden

### Scenario 3 — provider-ready state
- arrange a test fixture where models/providers are available
- load the app
- verify the OOBE panel shows the ready/what-next state instead of provider-missing guidance

### Scenario 4 — optional popout suppression
- if practical in the same harness, verify the panel does not render in pane popout mode

## Acceptance Criteria

- [x] A repeatable local container workflow exists for OOBE browser testing.
- [x] A Playwright test or small Playwright suite covers at least the provider-missing OOBE path.
- [x] Dismiss persistence is validated in the browser.
- [x] At least one provider-ready path is validated in the browser.
- [x] Test setup and rerun instructions are documented in the ticket updates or linked docs.
- [x] The test approach is narrow enough to stay reliable in local development.

## Implementation Paths

### Path A — targeted local-container browser smoke suite (recommended)
1. Start Piclaw in a local container with controlled config/state.
2. Use Playwright to drive a fresh browser profile.
3. Cover the smallest high-value OOBE scenarios first.
4. Expand only after the first suite is stable.

**Pros:**
- realistic validation
- directly exercises deployment-like startup behavior
- good confidence for OOBE regressions

**Cons:**
- slower than pure in-process tests
- needs careful fixture/state setup to remain deterministic

## Test Plan

- Applicable regression classes from `workitems/regression-test-planning-reference.md`:
  - [x] Bug replay / known-regression test
  - [x] State-machine / invariant test
  - [x] Routing matrix test
  - [x] Interaction scenario test
  - [x] Restore / reconnect matrix test
  - [ ] Pane / viewer contract test
  - [x] Real-browser smoke test
- [x] Existing tests to rerun are listed.
- [x] New regression coverage to add is listed:
  - [x] fresh OOBE provider-missing browser path
  - [x] dismiss persistence after reload
  - [x] provider-ready OOBE browser path
  - [ ] optional popout suppression path
- [x] Real-browser smoke pass required? If yes, record the surface:
  - [x] local container startup → first web load → OOBE CTA/dismiss/reload behavior

## Definition of Done

- [x] All acceptance criteria satisfied and verified
- [x] Tests added or updated — passing locally
- [x] Type check clean
- [x] Docs and notes updated with links to ticket
- [x] Operational impact assessed
- [x] Follow-up tickets created for deferred scope
- [x] Update history complete with evidence
- [x] Ticket front matter updated

## Updates

### 2026-04-14
- Re-ran the local-container Playwright smoke successfully against current source using the mounted web-dist harness path.
- Browser-validated scenarios now covered end to end:
  - provider-missing panel visible
  - `/login` CTA prefill
  - dismiss persistence after reload
  - provider-ready panel visible
  - `/model` CTA prefill
  - ready-state completion persistence after reload
- Fresh evidence captured under `artifacts/oobe-local-container/`:
  - `oobe-provider-missing-2026-04-14T22-07-37-904Z.png`
  - `oobe-provider-ready-2026-04-14T22-07-37-904Z.png`
- Improved the harness to mount the repo's current `runtime/web/static/dist` into the container image so UI-only OOBE fixes can be validated quickly with `PICLAW_OOBE_TEST_SKIP_BUILD=1` after `bun run build:web`.
- While revalidating, the smoke exposed a real copy gap: the provider-missing panel did not explicitly distinguish AI-provider setup from app sign-in. Fixed in `runtime/web/src/components/oobe-panel.ts` and revalidated.
- Moved to `50-done` after the browser-validation slice fully passed.

### 2026-04-09
- Added `runtime/scripts/playwright/oobe-local-container.ts`, the `bun run test:oobe:local-container` entry point, and `docs/development.md` rerun notes for the local-container OOBE smoke path.
- Added failure instrumentation for screenshot, DOM dump, body text, model-response state, and container logs under `artifacts/oobe-local-container/`.
- Fixed the Docker image build bottleneck in `scripts/docker/build-piclaw-package.sh` by replacing the broad recursive Bun-tree permission sweep with narrower runtime permission normalization; rebuilt image creation now completes again.
- Diagnosed and fixed a second OOBE regression in lifecycle wiring: `/agent/models` responses were arriving, but `setAgentModelsPayload` and `setHasLoadedAgentModels` were not being forwarded into lifecycle composition, so `modelsLoaded` stayed false and the panel remained hidden.
- Added regression coverage for that lifecycle forwarding and reran focused web/OOBE tests successfully.
- Current status:
  - dedicated source-level browser validation can show the provider-missing OOBE panel
  - local-container smoke now rebuilds successfully and reaches the Playwright OOBE phase
  - provider-missing local-container proof still needs one fresh rerun against the very latest source after the final lifecycle fix
  - dismiss persistence and provider-ready local-container validation remain open
- Evidence to pick up tomorrow:
  - `/workspace/tmp/test-evidence/oobe-async-verbose-20260409T214220Z/combined.log`
  - `artifacts/oobe-local-container/`
- Next follow-up tomorrow:
  - rerun `bun run test:oobe:local-container` against a freshly rebuilt image containing the latest lifecycle fix
  - capture a clean provider-missing screenshot plus dismiss-persistence and provider-ready evidence
  - if the smoke still fails, instrument `hasLoadedAgentModels` and `agentModelsPayload` directly in the browser during the local-container run
- Quality: ★★★★☆ 8/10 (problem: 2, scope: 2, test: 2, deps: 1, risk: 1)

### 2026-04-09
- Lane change: `00-inbox` → `20-doing`.
- Promoted by user direction as the active validation slice for OOBE.
- Current first implementation target remains narrow:
  - local containerized Piclaw startup
  - Playwright browser pass for provider-missing OOBE
  - dismiss persistence after reload
  - at least one provider-ready validation path
- Quality: ★★★★☆ 8/10 (problem: 2, scope: 2, test: 2, deps: 1, risk: 1)

### 2026-04-09
- Created from request to add a local container + Playwright validation path for the web OOBE flow.
- Intended as a realistic browser smoke layer complementing unit/component coverage for OOBE state and rendering.
- Quality: ★★★★☆ 8/10 (problem: 2, scope: 2, test: 2, deps: 1, risk: 1)

## Notes

- Keep the first slice narrow and deterministic; do not try to cover every provider/auth combination in the initial browser suite.
- Prefer explicit test fixtures for provider-missing vs provider-ready states rather than ad hoc manual environment setup.

## Links

- `workitems/50-done/oobe-provider-readiness-and-first-use-panel.md`
- `workitems/10-next/improve-first-run-oobe-and-new-user-guidance.md`
- `docs/development.md`
- `Makefile`
