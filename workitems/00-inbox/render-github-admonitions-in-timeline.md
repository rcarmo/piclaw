---
id: render-github-admonitions-in-timeline
title: Render GitHub-style admonitions in the web timeline
status: inbox
priority: medium
created: 2026-04-23
updated: 2026-04-23
tags:
  - work-item
  - kanban
  - web
  - markdown
  - ui
  - timeline
owner: pi
origin: "User request"
---

# Render GitHub-style admonitions in the web timeline

## Summary

GitHub Flavored Markdown supports admonition blocks using a `> [!TYPE]` syntax
inside blockquotes:

```markdown
> [!NOTE]
> This is a note.

> [!TIP]
> Helpful advice.

> [!IMPORTANT]
> Critical information.

> [!WARNING]
> Needs attention.

> [!CAUTION]
> Potential risk.
```

These currently render as plain blockquotes in the piclaw web timeline. They
should be styled with the appropriate icon and color treatment so users and the
agent can use them as structured callouts.

## Acceptance Criteria

- [ ] The five standard GitHub admonition types are detected and rendered with
      distinct styling: `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`.
- [ ] Each type has an appropriate icon and accent color consistent with GitHub's
      rendering and the active piclaw theme.
- [ ] The `[!TYPE]` prefix line is replaced with a styled header (icon + label),
      not shown as raw text.
- [ ] Nested markdown inside admonitions (code, links, bold, lists) renders
      correctly.
- [ ] Plain blockquotes without the `[!TYPE]` syntax are unaffected.
- [ ] Works correctly across all shipped themes (light, dark, and named presets).
- [ ] Agent-generated messages containing admonitions render correctly in the
      timeline without requiring any agent-side changes.

## Implementation Paths

### Path A — marked extension (recommended)

Add a custom `marked` extension or renderer override that detects the
`> [!TYPE]` pattern in blockquotes and wraps the output in a styled container
with the appropriate class/icon.

This keeps the transformation in the markdown pipeline and avoids post-render
DOM manipulation.

### Path B — CSS-only with existing markup

If `marked` already emits the `[!TYPE]` text inside a `<blockquote>`, use
CSS `:has()` or a lightweight post-render pass to detect and style matching
blockquotes. Simpler but potentially more fragile.

## Test Plan

- Applicable regression classes from `workitems/regression-test-planning-reference.md`:
  - [ ] Bug replay / known-regression test
  - [ ] State-machine / invariant test
  - [ ] Routing matrix test
  - [x] Interaction scenario test
  - [ ] Restore / reconnect matrix test
  - [x] Pane / viewer contract test
  - [x] Real-browser smoke test
- Existing tests to rerun:
  - `make build-web`
  - any markdown rendering tests
- New regression coverage to add:
  - unit test for admonition detection and rendering for all five types
  - visual verification across at least two themes (default light, one dark preset)
- Real-browser smoke pass required? Yes — verify rendered admonitions in the
  timeline with at least one real message.

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
- Created from user request.

## Notes

- The agent frequently uses `> [!NOTE]` and `> [!TIP]` in responses and
  README-style docs, so this improves readability for a common pattern.
- GitHub's rendering uses specific SVG icons and color accents per type.
  We should match or approximate that visual language.

## Links

- GitHub docs: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts
- Markdown renderer: `runtime/web/src/vendor/marked-entry.ts`
- Timeline post component: `runtime/web/src/components/post.ts`
