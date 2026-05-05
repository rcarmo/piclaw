# Dream and AutoDream

PiClaw has two related memory-maintenance features:

- `Dream` — manual `/dream [days]`
- `AutoDream` — the built-in nightly maintenance cycle

Both now run as **out-of-band agent turns** on a dedicated temporary `dream:` channel.
That channel is cleaned up after the run, so Dream work does not remain as a normal persisted chat/session.

## Core behavior

Dream is now **model-driven**.

The model follows the original 4-phase Dream flow:

1. **Orient** — load startup memory first and inspect the existing daily/memory state
2. **Signal** — gather only the narrow confirming evidence needed for suspected drift
3. **Consolidate** — merge, normalize dates, and correct contradictions at the source
4. **Prune and Index** — prune stale pointers, add references to newly important memories, and keep the compact memory index clean

The model is responsible for deciding what is relevant.
Do not treat Dream as a fixed rule-based length filter.

## Narrow search criteria

Dream follows Claude-style rough search behavior during the **Signal** phase and looks for new information worth persisting:

1. inspect the existing daily/memory files first
2. inspect memories that appear drifted or contradicted
3. only then do **narrow** transcript/message searches for terms already suspected to matter
4. do **not** exhaustively sweep transcript history

In PiClaw this means Dream should prefer:

- `notes/daily/*.md`
- `notes/memory/*`
- narrow `messages.search` queries
- `search_workspace` for note lookup

## Trigger modes

### Dream

Manual slash command:

```text
/dream
/dream 7
/dream 30
```

Behavior:

- creates a pre-Dream `.zip` backup of `notes/daily/` and `notes/memory/`
- prunes older Dream backups after writing the new archive (default keep: 10)
- refreshes/seeds in-window daily note files from the messages database before the model starts
- queues an out-of-band Dream run
- no visible user message is injected
- the Dream run executes on a temporary `dream:` channel
- Dream work is queued on a dedicated `dream:<chatJid>` lane so it does not block the interactive chat lane
- a visible agent summary is posted back to the original chat when done
- default window: last 7 days unless you pass an explicit `/dream <days>`

### AutoDream

Built-in scheduled task:

- task id: `builtin-dream-midnight`
- task kind: `internal`
- schedule: default cron `0 1 * * *` (01:00 in the runtime timezone)

Behavior:

- creates a pre-Dream `.zip` backup of `notes/daily/` and `notes/memory/`
- prunes older Dream backups after writing the new archive (default keep: 10)
- refreshes/seeds in-window daily note files from the messages database before the model starts
- runs in the background on a temporary `dream:` channel
- runs on the dedicated `dream:<chatJid>` queue lane rather than the interactive chat lane
- executes silently unless you inspect logs/task results
- cleans up the temporary dream channel after the run
- default window: last 2 days

## AutoDream gating

AutoDream is bounded to avoid no-op nightly runs, but it no longer waits for a full 24-hour gap.

It now behaves like this:

- if there is no prior consolidation, AutoDream runs
- if there have been **no sessions** since the last consolidation, AutoDream skips
- otherwise the nightly run proceeds, even if the previous consolidation happened late the night before

This keeps the nightly cadence stable while still avoiding empty runs.

## First-boot bootstrap

Fresh workspaces may start with only seeded scaffolding files and placeholder daily-note summaries.
To keep container behavior consistent, runtime now queues a silent Dream bootstrap on startup whenever the core memory files are missing:

- `notes/memory/MEMORY.md`
- `notes/memory/current-state.md`
- `notes/memory/recent-context.md`

That bootstrap runs as an out-of-band Dream turn on the temporary `dream:` channel and uses the broader manual-style window so the first container boot can populate both the memory layer and proper daily summaries.

## Memory lifecycle and content model

Dream now treats memory as layered outputs rather than a mirrored `notes/daily/` → `notes/memory/days/` copy.

### Lifecycle

1. runtime creates a pre-Dream `.zip` backup of `notes/daily/` and `notes/memory/`, then prunes older Dream backups (default keep: 10)
2. runtime refreshes/seeds in-window `notes/daily/*.md` from the messages database
3. the model runs Orient → Signal → Consolidate → Prune and Index
4. runtime refreshes workspace FTS and cleans up the temporary `dream:` session

### Which file should contain what?

| Surface | Role | Content approach |
|---|---|---|
| `notes/daily/*.md` | Human-readable day narrative | Concise day summary, summary updates, truthful front matter (`summarised_until`, `first_message`, `last_message`, counts) |
| `notes/memory/MEMORY.md` | Compact startup index | One-line hooks only; links to sparse `notes/memory/days/*.md` when present, otherwise links back to `notes/daily/*.md` |
| `notes/memory/current-state.md` | Compact Dream state snapshot | Markdown summary of complete/partial/unsummarised day status plus recent-window state |
| `notes/memory/recent-context.md` | Agent-ready digest | Compact recent context for quick orientation |
| `notes/memory/user.md` | Durable user memory | Stable role/preferences |
| `notes/memory/feedback.md` | Durable feedback memory | Corrections and steering cues |
| `notes/memory/project.md` | Durable project memory | Ongoing work and recent outcomes |
| `notes/memory/reference.md` | Durable reference memory | Note-index and durable external pointers |
| `notes/memory/days/*.md` | Optional sparse episodic memory | Only when a day has durable agent-facing signal beyond the daily note; should not mirror every day |

### Sparse day-memory rule

`notes/memory/days/*.md` is intentionally model-owned and sparse:

- create/update it only when a day carries durable agent-facing memory beyond the daily note
- do not generate it as a required mirror of every complete daily note
- keep `MEMORY.md` pointing at the best available artifact for that day: sparse day-memory file if it exists, otherwise the daily note

### Incomplete daily-note recovery cues

When runtime seeds or refreshes an unfinished daily note, it also writes a hidden `DREAM_CUES` comment. Those cues are compact transcript hints derived from the message slice described by front matter (`scope_anchor`, `first_message`, `last_message`, `messages_total`, `session_trees`, `session_chats`). Dream should use them before searching broadly, and may inspect the full bounded slice for small days (`messages_total <= 50`, `session_trees <= 2`) before declaring consolidation unsafe. If a pass still leaves unresolved notes, the run result and logs report the unresolved dates.

## Files touched

Dream is allowed to modify only the Dream note surfaces. Daily-note structure stays inside Markdown front matter and sections; Dream should not create JSON sidecars.

- `notes/daily/*.md`
- `notes/memory/days/*.md` (optional sparse episodic memory files; do not mirror every daily note)
- `notes/memory/user.md`
- `notes/memory/feedback.md`
- `notes/memory/project.md`
- `notes/memory/reference.md`
- `notes/memory/current-state.md`
- `notes/memory/recent-context.md`
- `notes/memory/MEMORY.md`

Dream must not modify project code, tests, or unrelated config.

## Ordered sequence

Dream/AutoDream should complete work in this order:

1. **Orient** — load startup memory (`notes/memory/MEMORY.md`, `notes/index.md`) and inspect recent daily/memory files
2. **Signal** — run narrow message searches only for already suspected terms
3. **Consolidate** — update the summary for each daily note in scope, edit durable memory files in `notes/memory/`, and keep aligned derived outputs truthful
4. **Prune and Index** — remove stale pointers, add references to newly important memories, shorten overly verbose index lines, and let the runtime refresh workspace FTS indexing at the very end

`notes/memory/MEMORY.md` should point to `notes/memory/days/*.md` only when a sparse episodic day-memory file actually exists. Otherwise it should point back to the corresponding `notes/daily/*.md` note.

Runtime/sidecar refresh no longer materializes `notes/memory/days/*.md` automatically from daily notes; that subtree is model-owned and intentionally sparse.

## Startup memory contract

At session start, PiClaw loads the compact memory/index layer first:

- `notes/memory/MEMORY.md`
- `notes/index.md`
- `notes/preferences/agent.md` when present

Deeper files are opened only when needed.

## Search / indexing

Dream ends with a runtime-owned workspace FTS index refresh.
Runtime also handles the pre-run backup and the deterministic daily-note seeding pass before the model turn begins.

That means after Dream/AutoDream completes:

- newly updated memory files are searchable immediately
- no separate manual refresh is required
- `search_workspace` and `refresh_workspace_index` operate over the configured FTS roots

Default FTS roots are:

- `notes`
- `.pi/skills`

These roots are configurable via `.piclaw/config.json` (`tools.workspaceSearchRoots`) or `PICLAW_WORKSPACE_SEARCH_ROOTS`.

## Temporary dream channel

Dream runs on a dedicated temporary chat/session namespace like `dream:...`.

Requirements:

- no visible user message should be injected into the main chat
- the dream channel should be used only for the background Dream turn
- dream messages/session data should be removed after the cycle ends
- only the final agent summary should return to the source chat for manual `/dream`
