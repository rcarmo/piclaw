# Piclaw local config

This directory holds local Piclaw runtime configuration for the workspace.

## Workspace environment hook

PiClaw also supports a workspace shell hook at `/workspace/.env.sh`.

This is a power-user feature. Use it when you intentionally want to customize the environment seen by the embedded terminal and the PiClaw runtime.

Use it for workspace-scoped environment variables that should persist across container recreation, for example:

```bash
export PATH="/workspace/.local/bin:$PATH"
export GH_CONFIG_DIR=/workspace/.config/gh
mkdir -p /workspace/.config/gh
```

The file is sourced for interactive shells and on PiClaw startup. The default workspace `.gitignore` ignores `.env.sh` so local secrets and machine-specific paths do not get committed by accident.

### Embedded terminal use case: GitHub CLI

One practical use case is making `gh auth login` persist from the embedded terminal inside PiClaw.

```bash
export PATH="/workspace/.local/bin:$PATH"
export GH_CONFIG_DIR=/workspace/.config/gh
mkdir -p /workspace/.config/gh
```

With that in `/workspace/.env.sh`, you can install `gh` into `/workspace/.local/bin`, open the embedded terminal, run `gh auth login`, and keep the GitHub CLI auth state in the mounted workspace across container recreation.

### Responsibility boundary

`/workspace/.env.sh` runs as part of the user-controlled workspace environment. If you put incompatible exports, shell logic, or PATH overrides in this file and PiClaw stops working correctly, that breakage is the user's responsibility.

## FTS / workspace search

`search_workspace` indexes a configurable set of workspace roots.

Default roots:

- `notes`
- `.pi/skills`

Override them in `.piclaw/config.json`:

```json
{
  "tools": {
    "workspaceSearchRoots": [
      "notes",
      ".pi/skills",
      "docs",
      "workitems"
    ]
  }
}
```

You can also enable `search_workspace` in the default active tool set:

```json
{
  "tools": {
    "additionalDefaultTools": [
      "search_workspace"
    ]
  }
}
```

Rules:

- relative paths are resolved from the workspace root
- absolute paths are allowed
- configured roots are indexed automatically at session start
- `scope: notes` and `scope: skills` remain the built-in convenience filters
- `scope: all` searches across the configured root set

## Dream and AutoDream

PiClaw has two memory-maintenance modes:

- `Dream` — manual `/dream [days]`
- `AutoDream` — the built-in nightly task

Both run as out-of-band model turns on a temporary `dream:` channel.
That temporary Dream channel is removed after the cycle ends.

Dream uses a 4-step model-driven process:

1. merge
2. fix relative dates
3. delete contradictions
4. prune stale pointers and re-index

Search collection should stay narrow:

- inspect daily/memory files first
- inspect drifted memories
- use narrow searches only for already suspected terms
- avoid exhaustive transcript sweeps

Main files touched:

- `notes/daily/*.md`
- `notes/daily/*.agent.json`
- `notes/memory/days/*.md`
- `notes/memory/user.md`
- `notes/memory/feedback.md`
- `notes/memory/project.md`
- `notes/memory/reference.md`
- `notes/memory/current-state.json`
- `notes/memory/recent-context.md`
- `notes/memory/MEMORY.md`

See also: `.piclaw/config.json.example`
