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
- `bun run test:controlled -- -- <path>` — run focused tests through the local test-priority launcher
- `bun run test:local --cwd runtime -- bun test <path>` — direct focused Bun test form when staging is not wanted
- Local repository-owned test processes use minimum effective niceness `10`; override with `PICLAW_LOCAL_TEST_NICE=0..19`. The launcher never raises priority, and hosted CI bypasses niceness.
- Do not add raw `bun test`/Playwright test entry points outside the central launcher or its documented nested-runner allowlist.
- Test filesystem isolation is mandatory, including in CI: preserve the Bun preloads and launcher bootstrap. Use owned temporary fixtures, never cached live `/workspace` paths, for mutation/cleanup. An in-memory DB does not protect files. Do not run older worktrees without the isolation harness on a live workspace host.
- `make ci-fast` — host-only fast checks; does not qualify the native runtime
- `make ci-native` — required offline native gate: provenance, two private type projects, required source integration and all 109 native files including Goal
- `make ci-full` — host + native gate (`ci:fast && ci:native`); use before pushing
- `make ci-integration` — integration gate; native qualification is mandatory regardless of Docker/Playwright skips
- Prepare all five fixture exports from the shared JSON pins before native validation; see [Native validation](docs/native-validation.md). ADDONS/CORE/GOAL share one native checkout, CONTRACT uses the historical checkout, and catalogue dependencies use frozen `qualification/pi-durable-130/node_modules`, never a live profile. The gate performs no acquisition or installation.
- Keep the root and private-engine Pi 1.4.0 dependency graphs physically separate. Native exit 0 requires fresh parent-specific JUnit artifacts, terminal positive-pass Bun reports and the printed run receipt. Filtered, empty, skipped-only or interrupted runs and omitted mandatory stages are insufficient.

### Portable build caches and scratch

- `make policy-config` prints paths without creating directories. Build/test targets create the required directories through `policy-dirs`.
- Select `CACHE_TMP_BASE` explicitly when needed. Otherwise CI uses `RUNNER_TEMP`, then the caller's original `TMPDIR`, then system temp (`/tmp`). Outside CI, use writable/searchable `/workspace/tmp` when available, otherwise `/tmp`.
- Always append the fixed project name `piclaw`. Use `cache/`, `build/`, `tests/`, `logs/` and `runs/` below that root; unique runs belong below `runs/<run-id>/`.
- Make snapshots inherited `TMPDIR` as `PICLAW_INHERITED_TMPDIR` before exporting its project-scoped test temp path. It exports the selected base through recursive Make, plus project-scoped Bun, npm and XDG cache paths.
- Preserve an explicit `PLAYWRIGHT_BROWSERS_PATH`; otherwise use the existing `/workspace/bin/pw-browsers` outside CI when present, or the project's `cache/ms-playwright`. Do not migrate or reinstall an existing browser installation to adopt this policy.
- Make exports do not change the caller's shell. Direct Bun/Playwright commands must explicitly use the values printed by `make policy-config` and create needed scratch directories first.
- Do not relocate source, credentials, curated data, published deliverables or service state. Preserve active artifacts; this policy does not authorise cleanup, permission changes or service restarts.

### Local-first CI policy

- Complete iterative validation locally: use focused tests through the isolated launcher, host-independent fixtures for platform/policy variants, relevant package tests, static/workflow-contract checks, and `make ci-full` before pushing. Prepare native fixtures separately; missing prerequisites must fail, never trigger an install inside the gate.
- Do **not** add temporary or per-feature GitHub Actions workflows to obtain development evidence that can be produced locally.
- Do **not** dispatch GitHub Actions manually or use hosted CI as an iterative/ad-hoc test runner.
- Push/open a PR only after the candidate is locally complete. The repository's existing automatic PR check is supplementary hosted evidence, not the development loop.
- For repository-owned PRs that we authored and validated locally, explicit user merge authorization plus passing required local gates is sufficient: merge without waiting for hosted CI.
- External/untrusted PRs, or changes whose defining behavior could not be reproduced locally (for example platform-specific behavior), may still require hosted checks before merge.
- Automatic PR/main checks may finish after an authorized merge; inspect failures and remediate them, but do not make waiting for them the default gate for our own locally validated PRs.
- Manual workflow dispatch is reserved for explicitly authorized, documented release or operational procedures; it is not an exception for feature testing.

## Release process

Releases follow a two-phase tag workflow. **No release ships without passing UX tests.**

### Phase 1 — Prerelease validation

1. Prepare pinned fixtures, build and run `make ci-full` (host + required native qualification) locally.
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
- Use `workflow_dispatch` on the E2E workflow only when the documented release/operations procedure explicitly requires it and the user has authorized that run; do not use it for iterative or ad-hoc feature testing.

## UX conventions

- **Do not reinvent the UX paradigm.** Reuse established interaction patterns, components, visual styles and terminology before adding new UI.
- Read the [UX guidelines](docs/web-ui.md#ux-guidelines) and inspect the existing implementation for the same interaction before changing it.
- Keep accepted conversation input in the timeline, queued follow-ups in the existing queue UI, and ongoing activity in the native agent-status surface. Do not add parallel banners, acknowledgements or state displays for the same event.
- Fix lifecycle and data-flow problems at their source; extra status text or a custom spinner must not conceal a broken handoff.
- Classic is the only web UI. Do not add alternate skin implementations. Test keyboard, touch, accessibility and pending/error states using the existing conventions.
- If a genuinely new interaction paradigm is needed, explain why existing patterns cannot meet the requirement and obtain explicit user approval before implementing it.

## Conventions

- See `skel/AGENTS.md` for the agent operating context and working style
- For add-on settings panes, prefer the **direct backend add-on config API** (`/agent/addons/api/<addon>/<action>` plus runtime registration via `__piclaw_registerAddonConfigApi`) instead of routing browser settings traffic through slash commands
- Treat slash-command config dispatch as a legacy fallback only; new settings-pane work should register direct handlers in the add-on runtime entry and use browser fetches from the pane
- For web visuals/SVG diagrams, prefer attached `.svg` files (via `attach_file`) over raw SVG markup in message text; use widget/artifact paths only when interactivity is needed
- See `WORKITEMS.md` for the workitem lifecycle
