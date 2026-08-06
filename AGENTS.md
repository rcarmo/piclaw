# piclaw

## Git workflow

- **Always use pull requests** — never commit directly to `main`
- Create a feature branch, commit, push, and open a PR via `gh pr create`
- Wait for the user to approve or say "merge" before merging
- Use `gh pr merge --merge --delete-branch` to merge and clean up
- PR descriptions should include a summary, the change, and test results
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

## Release process

Releases follow a two-phase tag workflow. **No release ships without passing UX tests.**

### Phase 1 — Prerelease validation

1. Build, run `make ci-fast` (unit + integration tests) locally.
2. Push a prerelease tag: `v<version>-ux` (e.g. `v2.3.0-ux`).
3. This tag triggers the **E2E Tests** workflow (Playwright UX regression suite) on CI.
4. It does **not** trigger Docker builds, the integration gate, or publish workflows.
5. Wait for the E2E workflow to complete. Review the uploaded report artifact.
6. If UX tests fail, fix and re-push the `-ux` tag.

### Phase 2 — Final release

1. Once the `-ux` tag is green, push the final release tag: `v<version>` (e.g. `v2.3.0`).
2. This tag triggers **Publish Docker images**, but not the **CI** or **E2E Tests** workflows.
3. Publish invokes the reusable **Integration gate** for that exact immutable tag SHA; it must pass before Docker images are built.
4. Publish release notes to GitHub Releases.
5. Download the E2E report artifact from the `-ux` workflow run and **attach it as a release asset** (PDF or HTML).

### Tag routing summary

| Tag pattern | CI | Integration gate | E2E (UX) | Docker publish |
|---|---|---|---|---|
| Push to `main` | ✅ | — | — | — |
| `v*-ux` / `v*-prerelease` | — | — | ✅ | — |
| `v*` (no suffix) | — | ✅ (inside publish) | — | ✅ |

### Quick reference

```bash
# Push a UX prerelease tag to trigger E2E tests
git tag -a v2.3.0-ux -m 'UX prerelease' && git push origin v2.3.0-ux

# After E2E passes, push the final release tag
git tag -a v2.3.0 -m 'PiClaw v2.3.0 — Movie Name' && git push origin v2.3.0

# Clean up the prerelease tag
git tag -d v2.3.0-ux && git push origin :refs/tags/v2.3.0-ux
```

### Rules

- Never push a final release tag without a passing `-ux` run first.
- The `-ux` tag can be deleted after the final tag is pushed.
- Use `workflow_dispatch` on the E2E workflow for ad-hoc UX test runs on any branch.

## Conventions

- See `skel/AGENTS.md` for the agent operating context and working style
- For add-on settings panes, prefer the **direct backend add-on config API** (`/agent/addons/api/<addon>/<action>` plus runtime registration via `__piclaw_registerAddonConfigApi`) instead of routing browser settings traffic through slash commands
- Treat slash-command config dispatch as a legacy fallback only; new settings-pane work should register direct handlers in the add-on runtime entry and use browser fetches from the pane
- For web visuals/SVG diagrams, prefer attached `.svg` files (via `attach_file`) over raw SVG markup in message text; use widget/artifact paths only when interactivity is needed
- See `WORKITEMS.md` for the workitem lifecycle
