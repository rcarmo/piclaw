---
id: evaluate-lsp-support-as-piclaw-addons-extension
title: Evaluate LSP support as a piclaw-addons extension, not core
status: next
priority: medium
created: 2026-04-23
updated: 2026-04-23
target_release: later
estimate: M
risk: medium
tags:
  - work-item
  - kanban
  - lsp
  - editor
  - extensions
  - addons
owner: pi
---

# Evaluate LSP support as a piclaw-addons extension, not core

## Summary

Issue `#147` requested first-class LSP support in Piclaw core for both the web
editor and agent tools.

After evaluation, this is **not a core-project fit right now**. The feature is
valuable, but it is broader than a small editor enhancement and would add a
large amount of backend/runtime/editor complexity to the core project:

- language-server lifecycle management
- lazy per-language startup and project-root detection
- browser/editor ↔ runtime transport
- editor diagnostics/hover/definition plumbing
- agent-facing LSP tools with compact outputs
- curated server packaging/runtime dependencies

That makes it a better fit for **`piclaw-addons`** as an extension-led effort.
If contributors want to pursue it, the preferred path is an extension/adjacent
repo implementation rather than landing it directly in Piclaw core.

## Acceptance Criteria

- [ ] The core-project position is documented: LSP is out of scope for Piclaw core for now.
- [ ] Issue `#147` is closed with a polite redirection to `piclaw-addons`.
- [ ] The recommended extension architecture is captured here:
  - backend LSP/session manager
  - editor integration layer
  - optional agent-facing LSP tools
- [ ] The board item links back to the original issue and notes contributor PRs should target `piclaw-addons`.

## Implementation Paths

### Path A — Extension-led implementation in `piclaw-addons` (recommended)

1. Add an extension-side LSP runtime/session manager.
2. Wire the web editor pane to diagnostics/hover/definition first.
3. Add compact agent-facing tools only after the runtime is stable.
4. Keep language servers curated and lazily started by file type/project.

**Pros:** keeps core smaller; lower maintenance burden in Piclaw proper; easier to iterate.

**Cons:** extension packaging/runtime boundaries need to be designed carefully.

### Path B — Land in Piclaw core

1. Add language-server lifecycle management to core runtime.
2. Add transport endpoints and editor integration in core web stack.
3. Expose agent tools from core.

**Pros:** fully integrated product surface.

**Cons:** large scope increase in core; more packaging, dependency, and support burden.

## Test Plan

- Applicable regression classes from `workitems/regression-test-planning-reference.md`:
  - [ ] Bug replay / known-regression test
  - [x] State-machine / invariant test
  - [ ] Routing matrix test
  - [x] Interaction scenario test
  - [ ] Restore / reconnect matrix test
  - [x] Pane / viewer contract test
  - [ ] Real-browser smoke test
- [x] Existing tests to rerun are listed
- [x] New regression coverage to add is listed
- [ ] Real-browser smoke pass required? If yes, record the surface

### Existing tests to rerun

If this is ever pursued in `piclaw-addons`:

- editor pane open/save flows
- pane-host attach/detach lifecycle tests
- file conflict monitoring tests
- any extension route/runtime startup tests for the new LSP manager

### New regression coverage to add

If implemented later:

- lazy language-server startup by file type
- unrelated file types do not start servers
- diagnostics/hover/definition contract tests
- compact agent-tool output tests for LSP-backed lookups

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

### 2026-04-23
- Evaluated GitHub issue `#147` (`feature: LSP support`).
- Conclusion: valuable feature, but out of scope for Piclaw core at present.
- Recommendation: pursue as an extension in `piclaw-addons`, where editor/runtime/tooling integration can evolve without expanding core maintenance burden.
- Captured the implementation analysis here and prepared the issue for closure with contributor guidance.

## Notes

If implemented later, the recommended order is:

1. backend LSP manager
2. editor diagnostics/hover/definition
3. completion/references/rename
4. agent-facing LSP tools

Initial likely languages if someone prototypes this:
- TypeScript/JavaScript
- Python
- Go
- Rust

## Links

- GitHub issue: `#147` — `https://github.com/rcarmo/piclaw/issues/147`
- Suggested extension target: `https://github.com/rcarmo/piclaw-addons`
