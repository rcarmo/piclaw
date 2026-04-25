---
id: audit-and-stage-typebox-adoption-for-pi-0-69-0
title: Audit and stage TypeBox adoption for pi 0.69.0
status: doing
priority: high
created: 2026-04-22
updated: 2026-04-22
target_release: next
estimate: M
risk: medium
tags:
  - work-item
  - kanban
  - typebox
  - upgrade
  - planning
  - coding-agent
owner: pi
---

# Audit and stage TypeBox adoption for pi 0.69.0

## Summary

Prepare a dedicated, low-noise first PR that turns the TypeBox 1.x migration
from a vague upgrade risk into a bounded, testable change plan for Piclaw.

This ticket exists to make the later implementation PRs cheaper to review,
safer to land, and easier to roll back if needed.

## Acceptance Criteria

- [ ] A complete Piclaw inventory of current TypeBox usage is captured and grouped by surface area:
  - runtime core
  - bundled extensions
  - vendored extensions
  - experimental integrations
  - package-local locks / pins
- [ ] The chosen migration stance is explicit:
  - temporary compatibility path, or
  - direct TypeBox 1.x migration path
- [ ] The migration guide/checklist is saved in-project and linked from the work item.
- [ ] A targeted validation matrix is recorded for:
  - schema construction
  - runtime validation/coercion
  - extension loading
  - repo-install smoke
- [ ] PR boundaries are defined clearly enough that PR2 and PR3 can be executed without rescoping.

## Implementation Paths

### Path A — Documentation-first staging (recommended)

1. Search all current `@sinclair/typebox` imports and helper usage.
2. Group them by risk and by owning runtime surface.
3. Record whether each surface can migrate directly or needs compatibility handling.
4. Save the migration checklist and PR boundaries in docs + workitem links.

**Pros:** lowest-risk first step; easy to review; makes later failures attributable.

**Cons:** does not itself remove technical risk.

### Path B — Probe a compatibility shim during the audit

1. Build the same inventory.
2. Prototype one compatibility approach in a narrow sandbox.
3. Use that result to decide whether PR2 is direct migration or compatibility-first.

**Pros:** reduces ambiguity earlier.

**Cons:** risks mixing planning and implementation in the same PR.

## Test Plan

- Applicable regression classes from `workitems/regression-test-planning-reference.md`:
  - [x] Bug replay / known-regression test
  - [x] State-machine / invariant test
  - [ ] Routing matrix test
  - [x] Interaction scenario test
  - [x] Restore / reconnect matrix test
  - [ ] Pane / viewer contract test
  - [ ] Real-browser smoke test
- [x] Existing tests to rerun are listed
- [x] New regression coverage to add is listed
- [ ] Real-browser smoke pass required? If yes, record the surface

### Existing tests to rerun

- `bun run test`
- `runtime/test/config/config.test.ts`
- `runtime/test/config/config-coverage-import.test.ts`
- `runtime/test/core/config.test.ts`
- `runtime/test/agent-pool/agent-pool-tools.test.ts`
- `runtime/test/agent-pool/mcp-adapter-bundled.test.ts`

### New regression coverage to add

- narrow audit assertions if the migration introduces a compatibility helper or central TypeBox adapter
- import-resolution regression coverage if package aliases or wrappers are introduced

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
- Created from the post-audit request to sketch a concrete 3-PR adoption plan for `@mariozechner/pi-coding-agent` `0.69.0`.
- Scoped as PR1 of 3: make TypeBox adoption explicit before any dependency bump.
- Seed document created: `docs/development/pi-mono-0.69.0-impact-checklist-2026-04-22.md`.

## Notes

This ticket is intentionally the first slice. The goal is to prevent a noisy PR
that mixes dependency bumping, schema migration, extension fixes, and cleanup.

## Links

- `docs/development/pi-mono-0.69.0-impact-checklist-2026-04-22.md`
- `workitems/20-doing/migrate-piclaw-to-typebox-1-x-across-runtime-and-extensions.md`
- `workitems/20-doing/bump-pi-coding-agent-to-0-69-0-and-run-post-bump-validation.md`
