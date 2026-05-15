---
name: pi-workers-orchestration
description: Use when orchestrating pi-workers, especially while waiting for worker results, deciding whether to spawn additional investigators/workers, handling waiting interactive planners, or synthesizing worker outputs before implementation.
---

# pi-workers orchestration

Use this protocol when coordinating pi-workers from a parent agent session.

## Protocol

- Use `crew_list` before `crew_spawn` to understand current workers and avoid duplicate assignments.
- Prefer investigators, scouts, or a planner before implementation when context is broad, ambiguous, or likely to pollute the parent context window.
- Do not poll `crew_list` for completion. Worker results arrive as steering messages.
- While workers are running, do not duplicate their assigned task in the parent unless the scope changes or the worker is aborted.
- If a worker is waiting for response, read its draft/output, then respond with precise constraints, answer the blocking question, or mark it done with `crew_done` when complete.
- Once results arrive, synthesize them in the parent session. Use a planner if the findings need to become a deterministic implementation spec.
- For implementation work, spawn workers with strict file ownership, acceptance criteria, verification commands, and explicit instructions about what not to edit.
- Use worktrees and branches according to the target repository policy when implementing in git repos.
- If workers become obsolete because scope changed, a better result arrived, or implementation moved elsewhere, abort them instead of leaving them running.

## Good worker prompt example

```text
Investigate how authentication settings are loaded and propose the minimal implementation plan.

Scope:
- Read only files under runtime/auth/ and tests/auth/.
- Do not edit files.
- Identify existing helpers to reuse.

Output:
- Relevant files and current flow.
- One recommended implementation approach.
- Risks or unknowns.
- Suggested verification commands.

Do not:
- Implement changes.
- Modify application code.
- Broaden into unrelated settings or UI work.
```
