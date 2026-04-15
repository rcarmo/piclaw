---
id: improve-first-run-oobe-and-new-user-guidance
title: Improve first-run OOBE and guidance for new users
status: doing
priority: medium
created: 2026-04-04
updated: 2026-04-12
estimate: L
risk: medium
tags:
  - work-item
  - kanban
  - ux
  - onboarding
  - oobe
  - docs
  - web
owner: pi
---

# Improve first-run OOBE and guidance for new users

## Summary

Create a clearer first-run / new-user experience for piclaw so someone opening
it for the first time can understand:

- what piclaw is
- what they need to configure first
- the difference between optional web access control, AI provider setup via `/login`, and workspace setup
- the next recommended actions after the first successful usable load

This should cover both product UX and guidance surfaces, not just
documentation. The goal is to reduce confusion, dead ends, and “what do I do
now?” moments for new users.

## Problem Statement

The current new-user journey is spread across multiple separate concepts and
surfaces:

- optional web authentication / access control
- certificate trust / passkey setup on some devices
- AI provider setup and authentication via `/login`
- workspace/project exploration
- optional advanced capabilities and tools

Each of those areas may make sense in isolation, but the combined first-run
experience is not yet staged clearly for someone who does not already know the
system.

## Entry points to design around

The umbrella should explicitly cover these first-run paths:

1. **Fresh first web visit**
   - user lands on the web UI and the product decides whether web auth even matters for this install
2. **New device onboarding**
   - user may need TLS trust and/or passkey setup before normal use when web auth is enabled
3. **First usable visit with no AI provider configured**
   - user can access the UI but cannot yet use the preferred model/provider path because `/login` has not been completed
4. **First successful provider login**
   - user needs confirmation plus “what next?” guidance after `/login` succeeds
5. **First workspace/project interaction**
   - user needs to understand what the workspace is for and what actions are safe/useful

## Narrow MVP framing

For the first implementation wave, this umbrella should produce a staged MVP
rather than one monolithic wizard.

### MVP stages

#### Stage 1 — access and trust (only when applicable)
Help the user get into the product successfully:
- explain whether web auth is enabled for this install
- link or hand off to trust/passkey onboarding where required
- avoid mixing AI provider setup into this step
- skip this stage entirely when web auth is not configured

#### Stage 2 — provider readiness
Once the user can use the UI:
- explain whether any AI provider is configured
- point to `/login` as the provider setup/auth flow
- explain clearly that `/login` is for AI providers, not for signing into the app itself

#### Stage 3 — first-use orientation
After successful access + provider readiness:
- explain what the workspace is
- suggest one or two safe starter actions
- show a clear “what next?” path

## Out of scope for this umbrella ticket

- implementing every onboarding sub-flow directly in one ticket
- replacing the narrower `web-onboarding-mkcert-passkey` ticket
- a full docs rewrite across the whole project
- advanced user education for power-user/operator-only features

## Desired Behavior

- A first-time user can tell what state they are in.
- The product distinguishes clearly between:
  - optional web access control / trust setup
  - AI provider setup and authentication via `/login`
  - workspace/project setup
- The product does not imply that `/login` is the same thing as logging into the web UI.
- The user always has a visible next action.
- In-product guidance is the primary surface; docs support rather than replace it.
- The resulting work can be split into smaller implementation tickets without losing the overall journey.

## Acceptance Criteria

- [ ] The major first-run entry points are inventoried with concrete state descriptions.
- [ ] Current first-run confusion points are documented with examples.
- [ ] A proposed MVP OOBE flow exists with explicit stages and user-facing copy direction.
- [ ] The MVP clarifies the difference between:
  - [ ] optional web/session access control
  - [ ] AI provider setup and authentication via `/login`
  - [ ] workspace/project setup
- [ ] The MVP handles both installs where web auth is enabled and installs where it is not configured.
- [ ] The MVP includes a clear “next steps” path after first successful provider login.
- [ ] Guidance is available in-product where possible rather than relying only on README/docs.
- [ ] Follow-up implementation tickets are split by area if needed, at minimum covering:
  - [ ] access/trust onboarding
  - [ ] provider login guidance
  - [ ] post-login welcome / empty-state guidance
  - [ ] docs/supporting copy updates

## Implementation Paths

### Path A — documentation-first guidance pass
1. Audit the current first-run experience.
2. Improve README / install docs / inline help copy.
3. Add lightweight in-app pointers to those docs.

**Pros:**
- low implementation risk
- fastest way to reduce confusion

**Cons:**
- still requires users to leave the product flow
- does not fully solve poor empty-state UX

### Path B — staged productized onboarding plus supporting docs (recommended)
1. Audit first-run entry points and confusing branches.
2. Define a compact staged OOBE surface keyed off two axes:
   - whether web auth/trust is required for this install
   - whether AI providers are configured and usable
3. Keep the narrower TLS/passkey onboarding as a linked sub-flow where relevant.
4. Use docs as supporting detail rather than the primary first-run surface.

**Pros:**
- addresses confusion where it happens
- preserves the difference between access setup and actual product onboarding
- naturally splits into smaller implementation tickets

**Cons:**
- touches product UX, content design, and docs together
- needs disciplined scoping to avoid becoming too broad

## Recommended Path

Path B — stage the journey explicitly, keep access/trust, provider readiness,
and first-use orientation separate, and split implementation by stage.

## Follow-up tickets this umbrella likely needs

The expected split should look roughly like:

1. **Access / trust onboarding**
   - likely continues or extends `web-onboarding-mkcert-passkey`
   - only shown when web auth is actually enabled
2. **Provider readiness guidance**
   - first-run guidance when no AI provider is configured
   - explicitly linked to `/login` and its outcomes
   - child ticket created: `20-doing/oobe-provider-readiness-and-first-use-panel.md`
3. **Post-provider welcome / empty-state guidance**
   - first usable session with “what next?” guidance once providers are ready
   - included in the same first child slice for a compact v1 panel
4. **Docs/supporting copy cleanup**
   - README / install docs / inline help alignment

## Test Plan

- [ ] Validate the current first-run paths end to end and record confusion/failure points.
- [ ] Review the proposed OOBE flow against at least these scenarios:
  - [ ] first web visit with web auth enabled
  - [ ] first web visit with no web auth configured
  - [ ] new device trust/passkey onboarding when applicable
  - [ ] first usable visit with no AI provider configured
  - [ ] first successful `/login` provider setup flow
  - [ ] first workspace/project interaction
- [ ] Confirm the user can identify the next recommended action at each stage.
- [ ] Confirm new guidance does not obscure normal returning-user flows.

## Definition of Done

- [ ] First-run journey is documented as a concrete staged flow.
- [ ] MVP user-facing surfaces and copy are defined.
- [ ] Related setup/auth/doc gaps are split into implementation tickets where needed.
- [ ] Update history includes audit findings and recommended next actions.
- [ ] Ticket is either refined into `10-next/` or split into smaller ready tickets.

## Updates

### 2026-04-14
- Closed the active provider-readiness child slice end to end:
  - fixed the source-level regression that prevented the provider-ready / first-use OOBE panel from ever appearing once models were available
  - fixed the provider-missing copy so `/login` is explicitly described as AI-provider setup rather than app sign-in
  - passed the local-container Playwright browser smoke for provider-missing, dismiss persistence, provider-ready, and ready-state completion persistence
- The provider-readiness child ticket can now move out of review because source-level tests, typecheck, and browser evidence are all in place.
- Immediate next umbrella question is whether a separate access/trust onboarding slice still needs to be promoted, or whether the umbrella should narrow to docs/copy coordination only.

### 2026-04-12
- Lane change: `10-next` → `20-doing`.
- Promoted back into active work because the narrower OOBE child slices are now far enough along that the broader first-run umbrella should be treated as live coordination work instead of passive roadmap planning.
- Immediate next focus remains to close the remaining browser-validation/evidence gap in the OOBE child work and then reassess what still belongs in the umbrella versus smaller follow-up tickets.
- Quality: ★★★★☆ 8/10 (problem: 2, scope: 2, test: 2, deps: 1, risk: 1)

### 2026-04-08
- Ticket refactored after clarifying a core terminology mistake: `/login` is for **AI provider setup/auth**, not for signing into the app itself.
- Updated the umbrella to treat web auth as an optional access-control layer rather than an assumed universal first step.
- The staged OOBE now branches on two independent axes:
  - whether web auth/trust is required for this install
  - whether any AI provider is configured and usable
- Recommended first implementation slice is now explicitly:
  - initial usable page load with no AI provider configured
  - show clear in-product guidance pointing to `/login`
  - follow with lightweight workspace/next-step guidance once providers are ready
- Child work item created and promoted to doing:
  - `workitems/20-doing/oobe-provider-readiness-and-first-use-panel.md`
- Quality: ★★★★☆ 8/10 (problem: 2, scope: 2, test: 2, deps: 1, risk: 1)

### 2026-04-06
- Lane change: `00-inbox` → `10-next`.
- Promoted after refinement because the problem statement, staged MVP, and follow-up split are now explicit enough for prioritization against other ready work.
- Immediate next step: choose the first implementation slice and split the umbrella into concrete execution tickets for access/trust, provider readiness, and post-login orientation.
- Quality: ★★★★☆ 8/10 (problem: 2, scope: 2, test: 2, deps: 1, risk: 1)

### 2026-04-06
- Refinement pass completed to turn this from a broad idea into a staged OOBE umbrella.
- Locked the design around five explicit entry points:
  - fresh unauthenticated visit
  - new-device onboarding
  - first authenticated visit with no provider configured
  - first successful provider login
  - first workspace/project interaction
- Split the intended MVP into three stages:
  - access and trust
  - provider readiness
  - first-use orientation
- Clarified that the narrower mkcert/passkey onboarding work remains a linked sub-flow rather than the whole OOBE story.
- Quality: ★★★★☆ 8/10 (problem: 2, scope: 2, test: 2, deps: 1, risk: 1)
- Gap: the remaining step is to turn the umbrella into 2–4 concrete implementation tickets and decide which stage should ship first.

### 2026-04-04
- Created from direct request to track a broader first-run / new-user experience pass.
- Initial scope is intentionally broader than certificate/passkey onboarding alone: it should also cover login guidance, empty states, and “what next?” direction after first launch.
- Related existing onboarding ticket already covers the narrower mkcert + passkey flow; this ticket should act as the umbrella for the broader OOBE/guidance problem.
- Quality: ★★★☆☆ 5/10 (problem: 2, scope: 1, test: 1, deps: 0, risk: 1)

## Notes

- This is broader than `web-onboarding-mkcert-passkey`.
- Likely needs to unify several currently separate concepts that are easy for new users to confuse:
  - optional web authentication / access control
  - AI provider authentication via `/login`
  - workspace/project readiness
  - optional features and advanced tooling
- The ticket must avoid implying that `/login` is a web-app sign-in step; in Piclaw it is primarily the AI-provider setup/auth surface.
- A good outcome may be a welcome/checklist pattern plus contextual hints rather than one monolithic wizard.

## Links

- `workitems/00-inbox/web-onboarding-mkcert-passkey.md`
- `workitems/20-doing/oobe-provider-readiness-and-first-use-panel.md`
- `workitems/40-review/login-command-passthrough.md`
- `README.md`
- `docs/install-from-repo.md`
