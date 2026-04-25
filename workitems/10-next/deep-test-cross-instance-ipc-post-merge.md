---
id: deep-test-cross-instance-ipc-post-merge
title: Deep-test cross-instance IPC post-merge
status: next
priority: high
created: 2026-04-22
updated: 2026-04-22
target_release: next
estimate: L
risk: high
tags:
  - work-item
  - kanban
  - testing
  - remote-interop
  - security
  - soak
  - follow-up
owner: pi
origin: "Post-merge follow-up for PR #140"
---

# Deep-test cross-instance IPC post-merge

## Summary

PR #140 (`feat: cross-instance IPC — pairing, proposals, and remote execution`)
was merged after targeted review, conflict resolution, and passing focused tests,
but the feature surface is large enough that we should treat it as an
experimental capability requiring deliberate long-term validation.

This ticket tracks a deeper validation pass across pairing, proposal review,
remote execution, result callbacks, permission ceilings, SSRF defenses,
revocation, and operator UX under real multi-instance use.

## Acceptance Criteria

- [ ] Run a multi-instance test matrix covering pair request, accept, deny,
      block, revoke, and re-pair flows.
- [ ] Verify proposal handling across `read-only`, `non-mutating`,
      `restricted`, and `full` peer profiles.
- [ ] Verify both mediated and short-circuit paths, including correct refusal
      when short-circuit prerequisites are not met.
- [ ] Exercise signed result callbacks and confirm local/remote state
      transitions remain consistent on accept, reject, timeout, and replay
      attempts.
- [ ] Run targeted SSRF and callback-origin validation checks against pairing
      callback URLs and result endpoints.
- [ ] Perform at least one longer-lived soak pass with two real instances to
      observe queueing, nonce handling, revocation behavior, and operator UX.
- [ ] Record findings, edge cases, and any newly discovered bugs as linked
      follow-up workitems or fixes.
- [ ] Update `docs/cross-instance-ipc.md` and related docs if operational
      lessons change the recommended configuration or workflow.

## Implementation Paths

### Path A — recommended

Create a compact but explicit validation matrix that combines automated test
expansion with a manual two-instance soak pass:

1. extend `runtime/test/remote/remote-interop.test.ts` for uncovered policy and
   callback edge cases
2. add scripted/manual two-instance validation steps with stable fixtures
3. run a real deployment smoke/soak session and capture evidence in this ticket
4. file narrowly scoped follow-ups for any defects or policy adjustments

### Path B — alternative

Build a heavier dedicated multi-instance harness first and defer the real-world
soak until later. This offers stronger repeatability but delays feedback and is
likely overkill before we learn where the real gaps are.

## Test Plan

- Applicable regression classes from `workitems/regression-test-planning-reference.md`:
  - [ ] Bug replay / known-regression test
  - [x] State-machine / invariant test
  - [x] Routing matrix test
  - [x] Interaction scenario test
  - [x] Restore / reconnect matrix test
  - [ ] Pane / viewer contract test
  - [x] Real-browser smoke test
- Existing tests to rerun:
  - `cd runtime && bun test test/remote/remote-interop.test.ts`
  - `cd runtime && bun test test/channels/web/web-agent-streaming.test.ts`
  - `make build-web`
- New regression coverage to add:
  - profile enforcement matrix for proposal vs execute paths
  - duplicate/replay callback handling beyond the current happy-path set
  - revoke/block behavior after prior trust establishment
  - degraded network / delayed callback / stale trust-epoch scenarios
- Real-browser smoke pass required? Yes — validate the operator-facing `/pair`
  and proposal review flow in the web UI with two live instances.

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
- Created immediately after merging PR #140 as the explicit long-term testing
  follow-up for cross-instance IPC.
- Initial evidence at creation time:
  - `cd runtime && bun test test/remote/remote-interop.test.ts` → 39 pass, 0 fail
  - `make build-web` → pass
- This ticket is the file contributors should use as the anchor for additional
  fixes, observations, and post-merge validation notes.

## Notes

- The feature remains experimental and gated by `PICLAW_REMOTE_INTEROP_ENABLED`.
- Review confidence improved materially once the remote interop test suite
  landed, but the breadth of the feature still warrants extended validation.
- Prefer small follow-up fixes over a large second-wave refactor unless testing
  reveals a structural problem.

## Links

- PR: `#140` — `feat: cross-instance IPC — pairing, proposals, and remote execution`
- Merge commit: `d63c2cb1af7b940e6f581a62c27ae64218e25852`
- Docs: `docs/cross-instance-ipc.md`
- Primary test file: `runtime/test/remote/remote-interop.test.ts`
