---
id: improve-messages-tool-for-audit-and-debugging-workflows
title: Improve messages tool for audit and debugging workflows
status: review
priority: high
created: 2026-04-14
updated: 2026-04-14
target_release: later
estimate: M
risk: medium
tags:
  - work-item
  - kanban
  - tools
  - messages
  - audit
  - debugging
  - sqlite
owner: pi
blocked-by: []
---

# Improve messages tool for audit and debugging workflows

## Summary

Improve the `messages` tool so agents can inspect long histories, compare
progress from a row checkpoint, grep for repeated patterns, and extract
structured values without falling back to raw SQLite queries, shell pipelines,
or ad hoc scripts.

This ticket is driven by a concrete audit workflow where the current tool was
insufficient for reviewing another agent's long debugging run and identifying
loop/stall behavior.

## Problem Statement

The current `messages` tool is good for ordinary search/get/add/delete flows,
but it is weak for agent-audit/debug workflows that need:

- rowid-bounded review (`after_row`, `before_row`)
- content-oriented grep rather than only FTS keyword search
- line-level inspection of large messages
- extraction of repeated structured values across many messages
- compact answers to “what changed since checkpoint X?”

Today those workflows often fall back to:

- direct `sqlite3` queries against `messages.db`
- shell `grep` / `awk` / `sort -u`
- manual rereading of large tails

That breaks the intended tool boundary and makes debugging/auditing less
portable and less agent-friendly.

## Recommended implementation order

### Slice 1 — bounded search/get improvements (highest leverage)
- add `after_row` / `before_row` support to `search`
- add sender filter in addition to existing role filter where appropriate
- add excerpt/highlight support for `search`
- add `content_lines` and `content_grep` support to `get`

### Slice 2 — `grep` action
- add content-pattern matching across messages
- support substring by default and optional regex mode
- return matching lines plus bounded context

### Slice 3 — `extract` action
- extract repeated structured values across a message window
- support capture groups, dedupe, sorting, and first-seen metadata

### Slice 4 — optional `diff` action
- rowid checkpoint delta view
- ship only after plain row-window support and grep/extract prove useful
- keep any “progress/stagnation” heuristic explicitly lightweight

## Desired Behavior

- Agents can review history since a checkpoint row without raw SQL.
- Agents can grep message content for patterns and inspect only matching lines.
- Agents can extract structured values like PC addresses, error codes, or
  metric lines from a message range.
- Large message inspection becomes line-oriented and bounded.
- The tool remains safe and bounded for normal use.

## Acceptance Criteria

- [x] `search` supports `after_row` / `before_row` bounds.
- [x] `search` supports sender-level filtering or an explicitly documented
      equivalent beyond the current role filter.
- [x] `search` can return bounded highlighted/excerpted matches.
- [x] `get` supports `content_lines` range selection.
- [x] `get` supports `content_grep` line filtering.
- [x] A new `grep` action exists for content-pattern matching with bounded
      context output.
- [x] A new `extract` action exists for pulling structured repeated values from
      a row-bounded message window.
- [x] Any new actions/params respect bounded limits and avoid unbounded content
      dumps.
- [x] Focused regression coverage exists for the new action/parameter contracts.

## Open refinement decisions

- decide whether sender filtering should be a literal `sender` field, an
  expansion of `role`, or both
- decide regex policy (`regex: true` vs substring-only default)
- decide bounded defaults for:
  - matches per request
  - context lines
  - extracted values
  - highlighted excerpt size
- decide whether `diff` belongs in this first ticket or should be split later

## Implementation Paths

### Path A — extend existing `messages` tool in place (recommended)
1. Add row bounds and get/search improvements first.
2. Add `grep` and `extract` as new actions on the existing tool.
3. Leave `diff` for a later tranche unless the simpler slices land cleanly.

**Pros:**
- keeps one familiar tool surface
- highest leverage with minimal surface proliferation
- eliminates most current raw-SQL fallbacks quickly

**Cons:**
- action surface grows and must stay well-bounded/documented

## Test Plan

- Applicable regression classes from `workitems/regression-test-planning-reference.md`:
  - [x] Bug replay / known-regression test
  - [x] State-machine / invariant test
  - [x] Routing matrix test
  - [x] Interaction scenario test
  - [ ] Restore / reconnect matrix test
  - [ ] Pane / viewer contract test
  - [ ] Real-browser smoke test
- [x] Existing tests to rerun are listed
- [x] New regression coverage to add is listed
- [ ] Real-browser smoke pass required? If yes, record the surface

### Likely validation
- `runtime/test/extensions/messages-crud*.test.ts` and adjacent tool-contract tests
- any agent-tool registration tests touching `messages`
- `bun run typecheck`

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
- Moved to `40-review` after landing the full planned audit/debug surface and revalidating focused tests + typecheck.

### 2026-04-14
- Completed the planned message-audit surface in `runtime/src/extensions/messages-crud.ts`:
  - Slice 1: `search` now supports `after_row` / `before_row`, sender filtering via `sender`, highlighted excerpts via `excerpt_chars`, and `get` now supports `content_lines` / `content_grep`
  - Slice 2: added `grep` action for bounded content-pattern matching with optional regex mode and context lines
  - Slice 3: added `extract` action for repeated structured-value extraction with regex capture groups, dedupe, sorting, and first-seen metadata
  - Slice 4: added lightweight `diff` action for checkpoint-delta review (`what changed since row X?`) with bounded row windows, role counts, sender counts, and ordered changed-message output
- Added focused regression coverage in `runtime/test/extensions/messages-crud.test.ts` and revalidated `runtime/test/extensions/messages-delete-all-chats.test.ts`.
- Focused validation passed:
  - `bun test test/extensions/messages-crud.test.ts test/extensions/messages-delete-all-chats.test.ts`
  - `bun run typecheck`
- The planned scope from this ticket is now effectively implemented; remaining work is closeout/board hygiene rather than feature gaps.

### 2026-04-14
- Created from an external improvement spec captured at `http://orangepi6plus.local:8080/media/634`.
- Initial assessment:
  - strongest immediate value is row-bounded `search` plus smarter `get`
  - `grep` and `extract` are strong fits for audit/debug workflows
  - `diff` is useful but should remain the most optional/last slice because heuristic “progress” detection is easy to overdesign
- Marked `doing` and `high` priority by user direction.
- Quality: ★★★★☆ 8/10 (problem: 2, scope: 2, test: 2, deps: 1, risk: 1)

## Notes

Keep the first implementation tranche tightly bounded. The main success metric is
eliminating the most common raw `sqlite3`/`grep` audit fallbacks, not building a
full analytics system for messages.

## Links

- `runtime/src/extensions/messages-crud.ts`
- `http://orangepi6plus.local:8080/media/634`
