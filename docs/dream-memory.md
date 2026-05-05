# Dream and AutoDream

Piclaw has two related memory-maintenance features that keep the workspace memory
layer coherent across sessions:

- **`Dream`** — triggered manually via `/dream [days]`
- **`AutoDream`** — the built-in nightly maintenance cycle (default cron `0 1 * * *`, i.e. 01:00 in the runtime timezone)

Both run as **out-of-band agent turns** on a dedicated temporary `dream:` channel
that is cleaned up after the run, so Dream work does not appear in normal chat history.

## What it does

Dream follows a four-phase model-driven flow:

1. **Orient** — load startup memory index and inspect existing daily/memory state
2. **Signal** — gather only the narrow confirming evidence needed for suspected drift
3. **Consolidate** — merge, normalize, and correct contradictions at the source
4. **Prune and Index** — remove stale pointers, add references to newly important
   memories, and keep the compact memory index clean

## Memory files touched

| File | Role |
|---|---|
| `notes/daily/*.md` | Human-readable day narratives |
| `notes/memory/MEMORY.md` | Compact startup index |
| `notes/memory/current-state.md` | Recent Dream state snapshot |
| `notes/memory/recent-context.md` | Agent-ready digest |
| `notes/memory/user.md` | Durable user preferences |
| `notes/memory/feedback.md` | Corrections and steering cues |
| `notes/memory/project.md` | Ongoing work and outcomes |
| `notes/memory/reference.md` | Note index and external pointers |
| `notes/memory/days/*.md` | Sparse optional episodic memory |

Dream must not modify project code, tests, or unrelated config.

## Trigger modes

### Manual `/dream`

```text
/dream
/dream 7
/dream 30
```

Creates a pre-Dream zip backup, refreshes in-window daily note files from the
messages database, runs the Dream turn, and posts a summary back to chat.
Unfinished daily notes are seeded with hidden `DREAM_CUES` based on their
front-matter transcript slice, and unresolved backlog dates are reported after
the run if consolidation remains incomplete. Default window: last 7 days.

### AutoDream

Built-in scheduled task `builtin-dream-midnight` runs nightly at `0 1 * * *` by default.
That is 01:00 in the runtime timezone (for example, 01:00 Lisbon time when `TZ=Europe/Lisbon`).
Uses a 2-day window. Runs silently unless you inspect task results.
Skips when no sessions have occurred since the last consolidation.

## First-boot bootstrap

On a fresh workspace, if the core memory files are missing, runtime queues a
silent Dream bootstrap on startup using a broader window to populate the memory
layer and initial daily summaries.

## Search indexing

Dream ends with a runtime-owned workspace FTS index refresh, so updated memory
files are immediately searchable via `search_workspace` without a manual refresh.

## Detailed reference

For the full specification — including memory lifecycle, content model, file
ownership rules, and the out-of-band channel contract — see:

- [`runtime/docs/dream-memory.md`](../runtime/docs/dream-memory.md)
