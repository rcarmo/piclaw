---
id: migrate-piclaw-to-typebox-1-x-across-runtime-and-extensions
title: Migrate Piclaw to TypeBox 1.x across runtime and extensions
status: doing
priority: high
created: 2026-04-22
updated: 2026-04-22
target_release: next
estimate: L
risk: high
tags:
  - work-item
  - kanban
  - typebox
  - runtime
  - extensions
  - upgrade
owner: pi
---

# Migrate Piclaw to TypeBox 1.x across runtime and extensions

## Summary

Execute the dedicated TypeBox migration PR after the audit/staging ticket has
made scope and validation explicit.

This ticket covers the code changes needed to keep Piclaw tool schemas,
extension schemas, and schema-adjacent validation paths working against the
chosen TypeBox 1.x adoption strategy.

## Acceptance Criteria

- [ ] All in-scope Piclaw TypeBox imports/usages are migrated or wrapped consistently.
- [ ] Runtime tool schemas still register and validate correctly.
- [ ] Bundled and vendored extensions that depend on TypeBox still load correctly.
- [ ] Experimental/integration surfaces with their own package pins are handled explicitly.
- [ ] Repo-install packaging and startup still work after the migration.
- [ ] No behavior change is introduced beyond the intended TypeBox compatibility/migration scope.

## Implementation Paths

### Path A — Direct migration to the new API/import shape (recommended if audit shows low wrapper value)

1. Update imports/usages across runtime and extension surfaces.
2. Fix any helper/compiler/value API changes.
3. Re-run targeted tests and repo-install smoke.
4. Land as a schema-only migration PR.

**Pros:** clearer steady state; less long-term compatibility debt.

**Cons:** broader edit surface in one PR.

### Path B — Central compatibility wrapper first

1. Introduce a small compatibility layer for current Piclaw call sites.
2. Switch scattered imports to the wrapper.
3. Keep the wrapper as a temporary bridge while upstream dependency changes land.

**Pros:** can reduce repetitive edits and isolate version-sensitive code.

**Cons:** adds one more abstraction to unwind later.

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
- `bun run typecheck`
- `runtime/test/agent-pool/agent-pool-tools.test.ts`
- `runtime/test/agent-pool/mcp-adapter-bundled.test.ts`
- `runtime/test/extensions/index.test.ts`
- `runtime/test/config/config.test.ts`
- `runtime/test/config/config-coverage-import.test.ts`
- `runtime/test/core/config.test.ts`
- `runtime/test/runtime/startup.test.ts`

### New regression coverage to add

- tests for any compatibility wrapper introduced in the migration
- regression coverage for schema-bearing bundled extensions that currently rely on `@sinclair/typebox`
- targeted import/load tests for vendored integrations touched by the migration

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
- Created from the 0.69.0 adoption audit as PR2 of 3.
- Sequenced after the audit/staging PR so TypeBox migration can land independently from the upstream dependency bump.
- Initial migration target surfaces identified in the audit checklist, including runtime extensions, bundled integrations, and vendored `pi-autoresearch` code.

## Notes

Keep this PR behavior-preserving. If a change is not required to make TypeBox
1.x work, defer it.

## Links

- `docs/development/pi-mono-0.69.0-impact-checklist-2026-04-22.md`
- `workitems/20-doing/audit-and-stage-typebox-adoption-for-pi-0-69-0.md`
- `workitems/20-doing/bump-pi-coding-agent-to-0-69-0-and-run-post-bump-validation.md`
