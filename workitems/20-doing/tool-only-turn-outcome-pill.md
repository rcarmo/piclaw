---
id: tool-only-turn-outcome-pill
title: "UX: distinct outcome pill for tool-only turn completions"
status: doing
priority: medium
created: 2026-04-22
updated: 2026-04-22
estimate: S
risk: low
tags:
  - work-item
  - kanban
  - web
  - ux
  - recovery
owner: smith
---

# UX: distinct outcome pill for tool-only turn completions

## Summary

When the model completes a turn by finishing tool use without emitting a trailing
text reply, PiClaw currently emits a `turn_outcome_marker` with `kind: "error"`.
This is misleading — the turn succeeded, the model just didn't add a closing
sentence. The red "Turn failed" pill alarms users for no reason.

## Root cause

`run-agent-orchestrator.ts` detects `providerStoppedAfterToolUse` correctly but
feeds it into the same `status: "error"` output path as genuine failures.
The `turn_outcome_marker` content block and its web renderer treat it identically.

## Proposed fix

### Backend (`run-agent-orchestrator.ts`)

- When `providerStoppedAfterToolUse` is true and there are no other failure
  signals (no blank turn, no partial-only output), emit `status: "tool_complete"`
  instead of `status: "error"`.
- Pass a `providerStoppedAfterToolUse: true` flag through to the outcome marker.

### Content block (`turn_outcome_marker`)

Add a new `kind`:
```ts
kind: "tool_complete"
label: "done via tools"
title: "Completed via tools"
detail: "Turn finished after tool use without a closing reply."
severity: "info"  // neutral, not warning/error
```

### Web renderer

- Render `kind: "tool_complete"` as a muted/neutral pill (grey or accent, not red/orange).
- Keep it compact — single line, no expansion needed.
- Do not show it at all if `draft_recovered: true` is also set (recovery chip
  already covers the context).

## Files to touch

- `runtime/src/agent-pool/run-agent-orchestrator.ts` — classify tool-only completion separately
- `runtime/src/channels/web/handlers/agent.ts` — propagate new kind through SSE
- `runtime/src/channels/web/runtime/recovery.ts` — exclude from recovery pill logic if needed
- `runtime/web/src/components/turn-outcome-marker.ts` (or equivalent) — new pill style
- `runtime/test/web/post-recovery-chip.test.ts` — add coverage for tool-complete case

## Definition of done

- [ ] Tool-only turn shows a neutral "done via tools" pill
- [ ] Genuine error turns still show the red "Turn failed" pill  
- [ ] Recovery chip cases unaffected
- [ ] Test coverage for the new pill kind
