# piclaw

## Git workflow

- **Always use pull requests** — never commit directly to `main`
- Create a feature branch, commit, push, and open a PR via `gh pr create`
- Wait for the user to approve or say "merge" before merging
- Use `gh pr merge --merge --delete-branch` to merge and clean up
- PR descriptions should include: summary, what changed, test results
- One logical change per PR; don't bundle unrelated work

### Worktrees

- Use `git worktree add` for parallel work instead of switching branches in the main checkout
- After merging a PR, remove the worktree (`git worktree remove <path>`) and confirm cleanup with `git worktree list`
- Before starting new work, run `git worktree list` and prune any stale/orphaned worktrees (`git worktree prune`)
- Never leave merged-branch worktrees lying around

## Build and test

- `bun run typecheck` — type-check the runtime
- `bun run build:web` — build the web frontend
- `bun test <path>` — run tests
- `make ci-fast` — full CI gate

## Conventions

- See `skel/AGENTS.md` for the agent operating context and working style
- For add-on settings panes, prefer the **direct backend add-on config API** (`/agent/addons/api/<addon>/<action>` plus runtime registration via `__piclaw_registerAddonConfigApi`) instead of routing browser settings traffic through slash commands
- Treat slash-command config dispatch as a legacy fallback only; new settings-pane work should register direct handlers in the add-on runtime entry and use browser fetches from the pane
- For web visuals/SVG diagrams, prefer attached `.svg` files (via `attach_file`) over raw SVG markup in message text; use widget/artifact paths only when interactivity is needed
- See `WORKITEMS.md` for the workitem lifecycle
- See `workitems/` for the kanban-style issue tracker
