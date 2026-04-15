---
id: add-scheduled-task-inspection-tool-and-shared-query-service
title: Add scheduled-task inspection tool and shared query service
status: review
priority: high
created: 2026-04-13
updated: 2026-04-14
target_release: later
estimate: M
risk: medium
tags:
  - work-item
  - kanban
  - scheduling
  - tools
  - runtime
  - tasks
owner: pi
blocked-by: []
---

# Add scheduled-task inspection tool and shared query service

## Summary

Add a canonical scheduled-task query service plus a first-class internal tool
for task inspection so agents can answer routine schedule questions without
SQLite introspection or raw IPC knowledge.

This is the first implementation slice from
`assess-first-class-scheduled-task-inspection-surface`.

## Desired Behavior

- A supported internal tool can list and inspect scheduled tasks.
- The tool returns structured task records instead of free-form DB output.
- `/tasks` and `/scheduled` can reuse the same underlying query service rather
  than each surface querying SQLite ad hoc.
- Agents can answer questions like:
  - did this task run yet?
  - when is it due next?
  - what happened last time?
  - which tasks are active/paused/completed?

## V1 scope

- shared query/list/get service for scheduled tasks
- internal inspection tool
- task filters for at least:
  - `chat_jid`
  - `status`
  - `id`
  - recency / limit
- optional latest-run-log lookup
- summary-friendly result details for agent use

## Out of scope

- task mutation/update/reschedule
- web-specific new UI beyond existing command output
- replacing scheduler execution logic

## Acceptance Criteria

- [x] A canonical scheduled-task query service exists outside the current ad hoc extension SQL path.
- [x] A first-class internal tool exists for listing and inspecting scheduled tasks.
- [x] The tool returns structured fields including at least:
  - [x] `id`
  - [x] `chat_jid`
  - [x] `task_kind`
  - [x] `status`
  - [x] `schedule_type`
  - [x] `schedule_value`
  - [x] `next_run`
  - [x] `last_run`
  - [x] `last_result`
- [x] The tool supports bounded filtering/pagination.
- [x] Existing `/tasks` or `/scheduled` command output is migrated to the same shared query service or explicitly left as a follow-up.
- [x] Focused regression coverage exists for the service and tool contract.

## Implementation Paths

### Path A — shared service + tool first (recommended)
1. Extract reusable scheduled-task list/get helpers into a runtime service.
2. Add an internal tool over that service.
3. Reuse the service from `/tasks` / `/scheduled` where practical.

## Test Plan

- Applicable regression classes from `workitems/regression-test-planning-reference.md`:
  - [ ] Bug replay / known-regression test
  - [x] State-machine / invariant test
  - [x] Routing matrix test
  - [x] Interaction scenario test
  - [ ] Restore / reconnect matrix test
  - [ ] Pane / viewer contract test
  - [ ] Real-browser smoke test
- [x] Existing tests to rerun are listed
- [x] New regression coverage to add is listed
- [ ] Real-browser smoke pass required? If yes, record the surface

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
- Moved to `40-review` after landing the shared service/tool tranche and revalidating focused tests + typecheck.

### 2026-04-14
- Implemented the core shared inspection slice:
  - added `runtime/src/scheduled-task-query-service.ts` as the canonical scheduled-task query service
  - added a first-class `scheduled_tasks` internal tool for structured list/get inspection
  - migrated `/tasks` and `/scheduled` to read through the same shared query service instead of ad hoc extension SQL
- The structured inspection surface returns the required core fields (`id`, `chat_jid`, `task_kind`, `status`, `schedule_type`, `schedule_value`, `next_run`, `last_run`, `last_result`) plus summary fields and optional latest-run-log summaries.
- Added focused regression coverage in:
  - `runtime/test/scheduled-task-query-service.test.ts`
  - `runtime/test/extensions/extensions-scheduled-tasks.test.ts`
  - `runtime/test/agent-pool/agent-pool-tools.test.ts`
- Focused validation passed:
  - `bun test test/extensions/extensions-scheduled-tasks.test.ts test/scheduled-task-query-service.test.ts test/agent-pool/agent-pool-tools.test.ts`
  - `bun run typecheck`
- Remaining closeout work is mostly board hygiene / docs / any follow-up scope split rather than the core service/tool implementation.

### 2026-04-14
- Promoted from `10-next` to `20-doing` and marked `high` priority by user direction.
- This remains the recommended first implementation slice for the scheduling/tooling gap because it replaces the most common unsupported workflow: routine task inspection via raw DB queries.

### 2026-04-13
- Split out as the first executable slice from `assess-first-class-scheduled-task-inspection-surface`.
- Chosen first because inspection is the most common missing capability and already has partial but ad hoc surfaces (`/tasks`, `/scheduled`, direct DB lookups).

## Links

- `workitems/50-done/assess-first-class-scheduled-task-inspection-surface.md`
- `runtime/src/extensions/scheduled-tasks.ts`
- `runtime/src/db/tasks.ts`
- `runtime/src/task-scheduler.ts`
