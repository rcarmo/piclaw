---
id: bump-pi-coding-agent-to-0-69-0-and-run-post-bump-validation
title: Bump pi-coding-agent to 0.69.0 and run post-bump validation
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
  - upgrade
  - coding-agent
  - validation
  - runtime
owner: pi
---

# Bump pi-coding-agent to 0.69.0 and run post-bump validation

## Summary

After the TypeBox migration is stable, bump `@mariozechner/pi-coding-agent` to
`0.69.0`, revalidate the full Piclaw runtime, and confirm that the upstream
behavior changes do not regress Piclaw-specific flows.

This is the final PR in the planned sequence.

## Acceptance Criteria

- [ ] `@mariozechner/pi-coding-agent` is bumped to `0.69.0` cleanly.
- [ ] Full Piclaw tests pass after the bump.
- [ ] Targeted validation passes for:
  - `before_agent_start` prompt chaining
  - orphan/trailing tool-result handling
  - web restart/recovery flows
  - login/provider config flows
  - repo-install / packaged startup behavior
- [ ] Any required Piclaw-local follow-ups are captured as separate tickets.
- [ ] Only after validation, any proven-redundant compatibility/workaround code is identified for later cleanup.

## Implementation Paths

### Path A — Strict bump-and-validate (recommended)

1. Update the dependency.
2. Run the full test suite.
3. Run targeted validation in the high-risk Piclaw areas called out by the audit.
4. Capture any cleanup separately instead of mixing it into the bump PR.

**Pros:** clean blame surface; easier rollback.

**Cons:** may leave temporary compatibility code in place for one more PR.

### Path B — Bump and cleanup together

1. Update the dependency.
2. Remove any code that looks redundant after the bump.
3. Re-test everything.

**Pros:** fewer PRs overall.

**Cons:** noisier review; harder to isolate regressions.

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
- `bun run check:pack-hygiene`
- repo-install smoke
- `runtime/test/agent-pool/orphan-tool-results.test.ts`
- `runtime/test/agent-pool/run-agent-orchestrator.test.ts`
- `runtime/test/channels/web/recovery.test.ts`
- `runtime/test/channels/web/web-channel.test.ts`
- `runtime/test/channels/web/web-channel-recovery-state.test.ts`
- `runtime/test/runtime/startup.test.ts`

### New regression coverage to add

- prompt-composition regression coverage if upstream `before_agent_start` chaining changes observable output
- targeted login/provider tests if header-only overrides become newly supported or exposed
- any fixture updates needed for post-bump output wording or recovery-state semantics

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
- Created from the 0.69.0 adoption audit as PR3 of 3.
- Scoped to keep the dependency bump isolated from the TypeBox migration.
- Seed validation areas copied from the audit checklist: prompt chaining, orphan tool results, web recovery flows, login/provider behavior, and packaged startup.

## Notes

Do not remove Piclaw-local safeguards in the same PR unless the validation pass
proves they are redundant and the cleanup is tiny. Prefer separate follow-up
cleanup tickets.

## Links

- `docs/development/pi-mono-0.69.0-impact-checklist-2026-04-22.md`
- `workitems/20-doing/audit-and-stage-typebox-adoption-for-pi-0-69-0.md`
- `workitems/20-doing/migrate-piclaw-to-typebox-1-x-across-runtime-and-extensions.md`
