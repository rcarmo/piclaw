---
id: improve-turn-error-outcome-ux
title: Improve turn error/outcome UX with table layout and tool-budget pill
status: inbox
priority: medium
created: 2026-04-23
updated: 2026-04-23
tags:
  - work-item
  - kanban
  - web
  - ui
  - timeline
  - errors
  - ux
owner: pi
origin: "User request"
---

# Improve turn error/outcome UX with table layout and tool-budget pill

## Summary

Turn failures and outcome markers in the web timeline currently render as plain
inline text or small chips. The user wants two improvements:

1. **Render error/outcome details as a markdown table** — when a turn fails
   (rate limit, timeout, empty reply, error), the diagnostic details (title,
   detail, last action, recovery attempts, classifier) should be presented in a
   compact, readable table rather than joined plain-text lines.

2. **Add a specific pill for tool-use budget exceeded** — when the agent hits
   the tool-use step budget (currently handled by the `tool_complete` and
   budget-exceeded paths in `run-agent-orchestrator.ts`), the timeline should
   show a visually distinct pill/chip that communicates "tool budget reached"
   rather than a generic error.

## Current State

### Turn outcome markers

The outcome markers stored as `content_blocks` have this shape:

```json
{
  "type": "turn_outcome_marker",
  "kind": "provider|blank_final|timeout|tool_complete|error",
  "label": "short label",
  "title": "Human title",
  "detail": "Longer explanation",
  "severity": "info|warning|error",
  "tool_action_summary": "last tool action"
}
```

### Current rendering

- `runtime/web/src/components/post.ts` renders these as small `<span>` chips
  in the post meta row (after the timestamp).
- The visible text body is built by `buildFailureVisibleText()` in
  `runtime/src/channels/web/handlers/agent.ts` — it joins title, detail, and
  action summary as plain `\n\n`-separated text.

### Tool budget exceeded

- `runtime/src/agent-pool/run-agent-orchestrator.ts` tracks tool-use step
  count and aborts when budget is exceeded, returning an error with
  `toolStepsBudget` metadata.
- The `tool_complete` kind handles clean exits after tool use.
- There is no distinct `tool_budget_exceeded` kind or dedicated pill.

## Acceptance Criteria

- [ ] Turn failure diagnostics render as a compact markdown table in the
      timeline post body when there are 2+ diagnostic fields.
- [ ] Table should include relevant fields: title, detail, last action,
      recovery attempts, classifier — only rows with actual values.
- [ ] When the failure is a tool-budget exceeded event, a distinct
      `tool budget` pill/chip renders in the post meta row with an
      appropriate label, icon intent, and tooltip.
- [ ] The `tool_budget_exceeded` outcome kind is added to the marker builder
      and the orchestrator wires it when the budget is hit.
- [ ] Existing outcome types (rate limit, timeout, no reply, tool complete,
      generic error) continue to render correctly.
- [ ] Draft-recovery text preceding the table is preserved and displayed above
      the table.
- [ ] The table respects the active theme (light/dark).

## Implementation Paths

### Path A — recommended

1. Add a `tool_budget_exceeded` kind to `buildTurnOutcomeMarker` in
   `runtime/src/channels/web/handlers/agent.ts`.
2. Wire it from the budget-exceeded path in `run-agent-orchestrator.ts`.
3. Add CSS for the new pill class in `agent.css`.
4. Change `buildFailureVisibleText()` to emit a markdown table when
   there are multiple diagnostic fields.
5. The web UI already renders markdown in post bodies — the table will
   render automatically via `marked`.

### Path B — alternative

Use a structured `content_block` for the table instead of markdown text.
More control, but requires a new block type and renderer.

## Test Plan

- Applicable regression classes from `workitems/regression-test-planning-reference.md`:
  - [x] Bug replay / known-regression test
  - [ ] State-machine / invariant test
  - [x] Interaction scenario test
  - [ ] Restore / reconnect matrix test
  - [x] Pane / viewer contract test
  - [x] Real-browser smoke test
- Existing tests to rerun:
  - `runtime/test/web/post-recovery-chip.test.ts`
  - `runtime/test/channels/web/web-channel.test.ts` (processChat outcome tests)
  - `make build-web`
- New regression coverage to add:
  - `buildFailureVisibleText` table output for multi-field cases
  - `tool_budget_exceeded` marker construction and rendering
  - feature test for the new pill in the timeline
- Real-browser smoke pass required? Yes — verify the table and pill render
  in the actual timeline.

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

### 2026-04-23
- Created from user request for nicer turn error rendering.

## Notes

- Keep the table compact — no more than 4-5 rows.
- The pill should be visually similar to the existing recovery/timeout chips
  but with a distinct color (e.g. amber for tool budget, red for hard errors).

## Links

- Turn outcome builder: `runtime/src/channels/web/handlers/agent.ts`
- Post rendering: `runtime/web/src/components/post.ts`
- Orchestrator budget logic: `runtime/src/agent-pool/run-agent-orchestrator.ts`
- Chip CSS: `runtime/web/static/css/agent.css`
