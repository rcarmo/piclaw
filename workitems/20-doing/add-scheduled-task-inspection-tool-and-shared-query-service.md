---
id: add-scheduled-task-inspection-tool-and-shared-query-service
title: Add scheduled-task inspection tool and shared query service
status: doing
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

- [ ] A canonical scheduled-task query service exists outside the current ad hoc extension SQL path.
- [ ] A first-class internal tool exists for listing and inspecting scheduled tasks.
- [ ] The tool returns structured fields including at least:
  - [ ] `id`
  - [ ] `chat_jid`
  - [ ] `task_kind`
  - [ ] `status`
  - [ ] `schedule_type`
  - [ ] `schedule_value`
  - [ ] `next_run`
  - [ ] `last_run`
  - [ ] `last_result`
- [ ] The tool supports bounded filtering/pagination.
- [ ] Existing `/tasks` or `/scheduled` command output is migrated to the same shared query service or explicitly left as a follow-up.
- [ ] Focused regression coverage exists for the service and tool contract.

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
- [ ] Existing tests to rerun are listed
- [ ] New regression coverage to add is listed
- [ ] Real-browser smoke pass required? If yes, record the surface

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

### 2026-04-14
- Promoted from `10-next` to `20-doing` and marked `high` priority by user direction.
- This remains the recommended first implementation slice for the scheduling/tooling gap because it replaces the most common unsupported workflow: routine task inspection via raw DB queries.

### 2026-04-13
- Split out as the first executable slice from `assess-first-class-scheduled-task-inspection-surface`.
- Chosen first because inspection is the most common missing capability and already has partial but ad hoc surfaces (`/tasks`, `/scheduled`, direct DB lookups).

## Links

- `workitems/20-doing/assess-first-class-scheduled-task-inspection-surface.md`
- `runtime/src/extensions/scheduled-tasks.ts`
- `runtime/src/db/tasks.ts`
- `runtime/src/task-scheduler.ts`
