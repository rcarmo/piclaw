---
id: assess-first-class-scheduled-task-inspection-surface
title: Assess a first-class scheduled-task inspection surface for agents
status: done
created: 2026-04-12
updated: 2026-04-14
tags:
  - work-item
  - kanban
  - scheduling
  - agent-tools
  - ux
owner: 
---

# Assess a first-class scheduled-task inspection surface for agents

## Summary

Assess and design a proper agent-facing way to inspect scheduled tasks without falling back to direct database queries, ad-hoc Python, or low-level implementation details.

The goal is to give the agent a stable, supported surface for answering questions like:

- what tasks are scheduled?
- when do they run next?
- what did they last do?
- which tasks are active, paused, failed, or completed?
- how should task details be surfaced in chat and web UI flows?

## Acceptance Criteria

- [x] Current scheduled-task inspection paths are documented, including DB and shell/python fallbacks currently used.
- [x] Desired agent-facing inspection scenarios are listed and prioritized.
- [x] At least one recommended supported surface is proposed, such as:
  - [x] a native tool
  - [ ] a slash command / control command
  - [ ] a web/API endpoint
  - [x] a shared service used by both tool and UI layers
- [x] The proposal explains how to avoid direct DB poking for routine task inspection.
- [x] The proposal identifies what metadata should be exposed for each task.
- [x] Security, privacy, and channel-appropriate output concerns are covered.
- [x] Follow-up implementation tickets are created if the work is split.

## Current paths and gaps

### Existing supported surfaces
- `schedule_task` internal tool exists, but only for **creation**, not inspection.
- `/tasks` and `/scheduled` already exist via `runtime/src/extensions/scheduled-tasks.ts`.
  - current support is limited to text listing plus a simple status filter (`all|active|paused|completed`)
  - the extension currently queries SQLite directly instead of using a shared task-query service
- `runtime/src/db/tasks.ts` already exposes low-level DB helpers such as:
  - `getTaskById(...)`
  - `getTaskRunLogs(...)`
  - `updateTask(...)`
  - `deleteTask(...)`

### Existing unsupported / low-level fallbacks still used
- direct SQLite inspection for routine checks
- ad hoc Python or shell scripts to answer `did it run yet?`
- raw IPC file writes for pause/resume/update flows
- schedule skill guidance still points verification toward SQL introspection

## Prioritized user scenarios

### Tier 1 — inspection (must support first)
1. Did this task run already?
2. When will it run next?
3. What is the current status?
4. What happened the last time it ran?
5. Show me the recent tasks for this chat.

### Tier 2 — routine mutation (next slice)
1. Delay this task by 5 minutes.
2. Pause/resume this task.
3. Cancel/delete this task.
4. Update the prompt/model/schedule safely.

## Recommended supported surface

### Recommended path — shared service + native tool first

Choose **Path B + Path A together**:

1. extract a canonical scheduled-task query service
2. expose it through a first-class internal inspection tool
3. optionally reuse it from `/tasks` / `/scheduled`
4. keep mutation/update as a second explicit follow-up slice

This is the best fit for current code reality because:

- there is already a `schedule_task` creation tool
- there are already `/tasks` and `/scheduled` command surfaces
- the main missing piece is a **structured inspection surface** that does not depend on raw DB access
- the current extension path is useful but too text-only and too coupled to ad hoc SQL

### Why not command/UI first?

A command-only solution would still leave the agent without a structured task
inspection surface and would keep autonomy weaker than necessary.

## Proposed metadata contract

The inspection surface should expose at least:

- `id`
- `chat_jid`
- `task_kind`
- `status`
- `prompt` or `command` summary
- `model`
- `schedule_type`
- `schedule_value`
- `next_run`
- `last_run`
- `last_result`
- `created_at`
- latest run-log summary where available

Useful filters in v1:

- task id
- chat JID
- status
- recency / limit
- optionally prompt text contains / task kind

## Security, privacy, and channel output notes

- default results should be bounded and summary-first; avoid dumping large `last_result` bodies by default
- shell-task inspection should avoid echoing sensitive command output unless explicitly requested
- chat scoping should be available so routine agent checks prefer the active chat over global enumeration
- structured tool output should be primary; human-readable summary formatting can be layered on top for `/tasks` or future UI surfaces

## Implementation Paths

### Path A — Native tool first
- Add a dedicated internal tool for task inspection
- Return structured task records plus summary formatting guidance
- Prefer this for agent autonomy and reuse

### Path B — Shared service + thin surfaces (**recommended**)
- Extract a canonical scheduled-task query service
- Use it from:
  - agent tool
  - slash command
  - web/API views later if needed
- Keep formatting separate from retrieval

### Path C — Control command/UI-first
- Add or expand a `/tasks` / `/scheduled` inspection surface
- Ensure the same underlying service can be used by agent tools later

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

### Existing tests to rerun
- task scheduler unit/integration tests touching task listing and execution
- any `/tasks` or `/scheduled` command tests
- `bun run typecheck`

### New regression coverage to add
- [x] structured task-inspection service tests
- [x] tool/command contract tests for scheduled-task inspection
- [ ] channel-formatting tests for task summaries where applicable
- [ ] permission/visibility tests if sensitive command/task data is exposed

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

### 2026-04-14 — implementation slice landed and assessment closed
- The recommended architecture from this assessment is now implemented in the first concrete slice:
  - `runtime/src/scheduled-task-query-service.ts`
  - `scheduled_tasks` internal tool in `runtime/src/extensions/scheduled-tasks.ts`
  - `/tasks` and `/scheduled` migrated to the shared query service
- Focused validation passed on the service/tool contract plus typecheck.
- Moved to `50-done` because the design/assessment goal is complete and the implementation follow-up exists as its own reviewed ticket.

### 2026-04-13 — assessment conclusion and split
- Code-path review confirmed the current state:
  - `schedule_task` exists for creation only
  - `/tasks` and `/scheduled` already exist, but they are text-only and query SQLite directly inside `runtime/src/extensions/scheduled-tasks.ts`
  - routine mutation/update still falls back to IPC or low-level DB knowledge
- Recommended architecture:
  - canonical scheduled-task query service
  - first-class internal inspection tool over that service
  - mutation/update as a separate follow-up slice
- Split concrete implementation tickets:
  - `workitems/40-review/add-scheduled-task-inspection-tool-and-shared-query-service.md`
  - `workitems/10-next/add-scheduled-task-update-and-reschedule-tool.md`
- This assessment is now refined enough to drive implementation without reopening the product question.
- Quality: ★★★★☆ 8/10 (problem: 2, scope: 2, test: 1, deps: 2, risk: 1)

### 2026-04-12 — concrete pain point from live scheduling flow
- During a real user request, I scheduled a one-shot agent task to check for new GHCR images and upgrade `relay` and `sandbox` later.
- When the user asked `did the scheduled task run already?`, I did **not** have a first-class inspection surface available.
- To answer, I had to query `/workspace/.piclaw/store/messages.db` directly with ad-hoc Python and inspect `scheduled_tasks` fields such as:
  - `id`
  - `status`
  - `schedule_type`
  - `schedule_value`
  - `next_run`
  - `last_run`
  - `last_result`
- When the user then asked to delay the task by another 5 minutes, I again lacked a first-class reschedule/update tool.
- I had to fall back to the IPC implementation detail by writing an `update_task` JSON payload into `/workspace/.piclaw/data/ipc/tasks/`, then re-query the DB to confirm the new `schedule_value` / `next_run`.
- This is exactly the unsupported workflow we want to eliminate: routine inspection and simple changes required a mix of SQLite poking, Python, and low-level IPC knowledge.
- The minimum first-class surface should cover:
  - list/find scheduled tasks by chat, prompt, status, or recency
  - inspect one task's current schedule and latest execution metadata
  - delay/reschedule a task without writing raw IPC files
  - show whether a task has run yet, when it will run next, and the last result summary
- This incident is a strong argument for either:
  - a native scheduled-task inspection/update tool, or
  - a shared scheduled-task service used by both a tool and a `/tasks`-style command.

### 2026-04-12
- Created from user request to stop relying on database inspection and ad-hoc Python for scheduled-task checks.
- Marked as `doing` to drive an assessment of the right first-class surface for agent use.

## Notes

- Prefer a supported runtime/service surface over SQLite introspection for routine checks.
- Avoid coupling the agent to raw DB schema details.
- Keep the resulting interface useful for both agent reasoning and human-facing summaries.
- The live reschedule example on 2026-04-12 showed two separate missing capabilities:
  - inspection (`did it run? what is next_run?`)
  - mutation (`delay this task by 5 minutes`)
- Even if this ticket remains inspection-first, the eventual tool shape should likely be designed so simple task updates can share the same canonical task lookup surface instead of forcing IPC fallbacks.

## Links

- `runtime/src/task-scheduler.ts`
- `runtime/src/ipc.ts`
- `runtime/src/agent-control/handlers/info.ts`
- `runtime/src/extensions/messages-crud.ts`
- `runtime/src/extensions/scheduled-tasks.ts`
- `runtime/src/db/tasks.ts`
- `/workspace/.pi/skills/schedule/SKILL.md`
- `workitems/10-next/add-scheduled-task-inspection-tool-and-shared-query-service.md`
- `workitems/10-next/add-scheduled-task-update-and-reschedule-tool.md`
