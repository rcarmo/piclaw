---
id: oobe-provider-readiness-and-first-use-panel
title: Add provider-readiness and first-use OOBE panel in the web app
status: done
priority: medium
created: 2026-04-08
updated: 2026-04-14
parent: improve-first-run-oobe-and-new-user-guidance
estimate: M
risk: medium
tags:
  - work-item
  - kanban
  - web
  - ux
  - onboarding
  - oobe
  - providers
owner: pi
---

# Add provider-readiness and first-use OOBE panel in the web app

## Summary

Add a native web onboarding panel inside the main app shell that guides new
users from the first usable page load through:

- no AI provider configured yet
- first successful provider setup via `/login`
- lightweight “what next?” workspace guidance

This slice intentionally treats `/login` as the AI-provider setup/auth surface,
not as app sign-in.

## Problem Statement

Today a new user can land in the web UI and still not know:

- whether PiClaw is actually ready to answer requests
- what `/login` is for
- that `/login` configures AI providers rather than web access control
- what to do after providers are ready

A timeline tutorial would pollute chat history, and a full wizard is too heavy
for the first implementation slice.

## Desired Behavior

- On first usable app load, the main shell can show a product-owned OOBE panel.
- If no AI providers/models are available, the panel explains that PiClaw needs
  provider setup and points the user to `/login`.
- Once providers are available, the panel changes to a small first-use guidance
  state with “what next?” actions.
- The panel is dismissible and should stay out of chat history.
- The panel should not imply that `/login` is app sign-in.
- The panel should work whether web auth is enabled or not, because it keys off
  provider readiness rather than assuming a login journey.

## V1 scope

For the first implementation slice, lock scope to:

- **surface:** native web component/panel in the main shell
- **states:**
  - provider missing
  - provider ready / first-use guidance
  - hidden
- **provider signal:** existing `/agent/models` / `getAgentModels()` data
- **actions:**
  - prefill compose with `/login`
  - dismiss panel
  - one or two lightweight next-step actions when ready
- **persistence:** local web storage only for dismiss/completion state

## Out of scope for v1

- timeline tutorial messages
- Adaptive Card-first onboarding
- full access/trust/passkey onboarding redesign
- provider-specific wizards
- DB-backed onboarding progress state
- cross-device onboarding sync
- full empty-workspace coaching system

## Acceptance Criteria

- [x] A native OOBE panel renders in the main web shell, not in the timeline.
- [x] When no AI providers/models are available, the panel explains that the
      next step is `/login` provider setup.
- [x] The panel copy explicitly distinguishes AI-provider setup from app access
      control/sign-in.
- [x] The primary provider CTA prefills the compose box with `/login`.
- [x] When providers/models become available, the panel switches to a compact
      “you’re ready / what next?” state.
- [x] The panel can be dismissed.
- [x] Dismiss/completion state persists locally for the web user.
- [x] The panel does not appear as a fake/tutorial chat message.
- [x] The panel does not show in pane-popout mode.
- [x] Minimal regression coverage exists for provider-missing, ready, dismiss,
      and `/login` prefill behavior.

## Implementation Paths

### Path A — native shell panel with local UI state (recommended)
1. Add a small OOBE state helper derived from provider/model readiness.
2. Add a dedicated `oobe-panel` web component/Preact component.
3. Render it above the timeline in the main shell.
4. Prefill `/login` into compose via an explicit action.
5. Track dismiss/completion in local storage.

**Pros:**
- smallest useful product slice
- state-aware and easy to hide once resolved
- no timeline pollution
- no new backend contract required for v1

**Cons:**
- local-only persistence first
- may need later refinement for richer onboarding states

### Path B — Adaptive Card in the timeline
1. Emit a structured onboarding card as an agent/system message.
2. Update card state as providers become available.

**Pros:**
- structured actions possible
- reuses card machinery

**Cons:**
- message-like rather than layout-like
- pollutes history/state more easily
- weaker fit for persistent shell guidance

## Recommended Path

Path A — native shell panel with provider-driven state.

## Likely implementation surfaces

- `runtime/web/src/app.ts`
- `runtime/web/src/ui/app-main-shell-render.ts`
- `runtime/web/src/ui/app-main-render-composition.ts`
- `runtime/web/src/components/compose-box.ts`
- `runtime/web/src/api.ts`
- new helper such as `runtime/web/src/ui/oobe-state.ts`
- new component such as `runtime/web/src/components/oobe-panel.ts`

## Test Plan

- Applicable regression classes from `workitems/regression-test-planning-reference.md`:
  - [ ] Bug replay / known-regression test
  - [x] State-machine / invariant test
  - [x] Routing matrix test
  - [x] Interaction scenario test
  - [ ] Restore / reconnect matrix test
  - [ ] Pane / viewer contract test
  - [ ] Real-browser smoke test
- [x] Existing tests to rerun are listed:
  - [x] app-shell render/composition tests
  - [x] compose-box interaction tests
- [x] New regression coverage to add is listed:
  - [x] provider missing → panel visible
  - [x] provider available → ready-state panel visible
  - [x] dismissed panel stays hidden
  - [x] `/login` CTA prefills compose
  - [x] pane popout mode suppresses panel
- [x] Real-browser smoke pass required? If yes, record the surface:
  - [x] initial web load with no models configured

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
- Browser-validated the full first-slice panel behavior through the local-container Playwright harness:
  - provider-missing visible
  - `/login` prefill works
  - dismiss persistence holds across reload
  - provider-ready visible
  - `/model` prefill works
  - ready-state completion persists across reload
- The browser run also caught a product-copy gap: the provider-missing panel did not explicitly say that `/login` configures AI providers rather than acting as app sign-in. Fixed in `runtime/web/src/components/oobe-panel.ts` and revalidated.
- Fresh evidence:
  - `artifacts/oobe-local-container/oobe-provider-missing-2026-04-14T22-07-37-904Z.png`
  - `artifacts/oobe-local-container/oobe-provider-ready-2026-04-14T22-07-37-904Z.png`
- Moved to `50-done` after source-level regressions, typecheck, and local-container browser validation all passed.

### 2026-04-14
- Fixed a follow-up state-resolution regression in `runtime/web/src/ui/oobe-state.ts`: configured installs with available models were being forced back to `hidden`, which prevented the intended provider-ready / first-use guidance panel from appearing.
- Updated both source-level and runtime-side OOBE state tests to require `provider-ready` when models are available and the ready-state has not been completed.
- Focused validation passed:
  - `bun test web/src/ui/oobe-state.test.ts test/web/oobe-state.test.ts test/web/oobe-panel.test.ts test/web/app-main-render-composition.test.ts test/web/app-main-shell-composition.test.ts`
  - `bun run typecheck`
- The child ticket remains in `40-review` pending final browser evidence / closeout rather than source-level correctness.

### 2026-04-09
- Diagnosed and fixed a lifecycle wiring bug in `runtime/web/src/ui/app-main-orchestration-composition.ts`: `/agent/models` responses were arriving, but `setAgentModelsPayload` and `setHasLoadedAgentModels` were not being forwarded into lifecycle composition, so the OOBE panel stayed hidden even after model readiness had loaded.
- Added regression coverage for that lifecycle forwarding so the OOBE state setters stay wired through future refactors.
- Updated the current panel copy in `runtime/web/src/components/oobe-panel.ts` to the latest wording for the provider-missing and provider-ready states.
- Focused web/OOBE regression tests are passing after the latest wiring fix.
- Dedicated source-level browser validation can now surface the provider-missing panel again.
- Current status for tomorrow:
  - source-level panel logic and focused regression coverage are healthy
  - local-container Playwright validation still needs one fresh rerun after the latest source fix to capture final evidence for provider-missing, dismiss persistence, and provider-ready states
- Evidence and follow-up logs live under:
  - `/workspace/tmp/test-evidence/oobe-async-verbose-20260409T214220Z/combined.log`
  - `artifacts/oobe-local-container/`

### 2026-04-08
- Created as a child implementation slice under `improve-first-run-oobe-and-new-user-guidance`.
- Promoted directly to `20-doing` by user direction.
- Locked the first slice to a native web onboarding panel rather than timeline tutorial messages.
- Locked `/login` terminology to **AI provider setup/auth**, not app sign-in.
- Locked v1 persistence to local web state rather than DB-backed onboarding progress.
- Implemented the first panel slice in the main shell with two rendered states:
  - provider missing → `/login` provider setup guidance
  - provider ready → compact “what next?” guidance
- Added local persistence keys for provider-missing dismissal and provider-ready completion state.
- Added compose prefill wiring so the panel can inject `/login` and `/model` into the compose box without creating timeline messages.
- Added regression coverage for OOBE state resolution, panel rendering, compose prefill semantics, and deterministic audit grouping updates for the new tests.
- Validation:
  - `bun run build:web` ✅
  - targeted web/OOBE tests ✅
  - `bun run test:optional:browser-isolation` ✅
  - `bun run test` still shows an unrelated existing `runtime wiring > workspaceNeedsDreamBootstrap...` suite failure when run in the full repo sweep, although the wiring test passes when rerun directly.

## Notes

- This ticket is intentionally narrower than the parent OOBE umbrella.
- The main decision is to make onboarding a product-owned shell state, not a
  conversational artifact.
- If this proves useful, later follow-ups can cover:
  - access/trust onboarding surfaces
  - richer example prompts
  - DB-backed onboarding progress
  - adaptive-card subflows for structured setup actions

## Links

- `workitems/20-doing/improve-first-run-oobe-and-new-user-guidance.md`
- `runtime/web/src/app.ts`
- `runtime/web/src/ui/app-main-shell-render.ts`
- `runtime/web/src/components/compose-box.ts`
- `runtime/web/src/api.ts`
