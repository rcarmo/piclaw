# Compose session picker alignment proposal

Status: proposal
Scope: classic compose-box session picker
Reference: model catalogue picker shipped through issue #1053

## Goal

Give the compose session picker the model picker’s clearer shell, search and navigation without making sessions behave like models.

The shared visual language should make both pickers feel related. Session hierarchy, lifecycle and management actions remain session-specific.

## Evidence

The live instance exposed 23 sessions on 30 August 2026:

- 14 root sessions;
- 9 branches;
- 2 active sessions;
- 16 idle sessions;
- 5 archived sessions.

Browser measurements found:

| Surface | Desktop | Phone |
|---|---:|---:|
| Session rows | 23 | 23 |
| Search fields | 0 | 0 |
| Groups | 0 | 0 |
| Focusable controls | 63 | 63 |
| Result viewport | 38 px | 218 px |
| Result scroll height | 38 px | 830 px |
| Position | compose popover | compose popover |

The 38 px desktop result viewport is a layout bug: the popup has 23 sessions but can collapse to roughly one row because the generic popup shell lacks the model catalogue’s minimum result height and flex sizing.

The model picker provides:

- a labelled search field with a clear button;
- result count and refresh state;
- a stable 110–430 px desktop result viewport;
- listbox semantics and one active option;
- arrow, Home, End, PageUp, PageDown, Enter and Escape handling;
- sticky section headings;
- a structured footer;
- a full-screen mobile sheet with 44 px controls.

## Product boundary

### Reuse from the model picker

- popover/sheet proportions;
- header spacing and background;
- labelled search field and clear affordance;
- result count;
- bounded, flexible result viewport;
- sticky section headings;
- active-row treatment;
- listbox keyboard navigation;
- focus restoration;
- mobile full-screen sheet;
- footer spacing and 44 px mobile action targets.

### Keep session-specific

- branch hierarchy;
- current, active, compacting and archived states;
- switch versus restore behaviour;
- pop-out action;
- branch prune and archived purge confirmation;
- create branch, create root, merge, rename and delete actions;
- `@` shortcut from blank compose;
- handle-first identity.

### Do not copy from the model picker

- pinning and recency sections;
- provider/publisher grouping;
- compatibility filtering;
- pricing, context and capability badges;
- large-catalogue virtualisation in the first change;
- model-style ranking rules.

The session set is currently 23 items, not hundreds. Search, hierarchy and stable sizing solve the observed problem without importing unnecessary catalogue machinery.

## Proposed structure

```text
Sessions                                              [×]

[ Search handles and session IDs…                    ]
23 sessions · 2 active · 5 archived

Current
  @ux                                      ACTIVE
  web:default:branch:4165db5c5a0f       [↗]

Active · 1
  @github                                  ACTIVE
  web:chat:94b5b0fe-d4d6-4e37-b6fe…     [↗]

This session tree · 8
  @default                                  ROOT
  web:default                              [↗]
    @runtime                               BRANCH
    web:default:branch:…                   [↗] [×]
    @addons                                BRANCH
    web:default:branch:…                   [↗] [×]

Other sessions · 9
  @epub                                     ROOT
  web:epub                                 [↗]

Archived · 5                                      [Show]

[New branch] [New root…]       [More actions ▾]
```

The labels and exact counts are illustrative. The hierarchy and states come from existing branch data.

## Header and search

Use a session-specific variant of the model catalogue header:

- label: **Search sessions**;
- placeholder: **Search handles and session IDs…**;
- search across:
  - agent handle;
  - full chat JID;
  - root chat JID;
  - active/idle/compacting/archived state;
  - model label, if present;
- show total and filtered counts;
- include a clear button;
- focus search on open;
- preserve the existing bare-`@` compose shortcut.

Search uses these hierarchy rules:

1. A matching session row is always shown.
2. If the match is a branch, show its root as a non-selectable context heading unless the root already appears as a result.
3. Do not show unmatched siblings or descendants.
4. A row assigned to Current or Active is omitted from tree sections, but its root context may still appear as a heading.
5. Archived matches are shown while a query is active even when the Archived section was collapsed before search; clearing the query restores the previous collapsed state.
6. Duplicate handles remain distinct because every result includes its chat JID.
7. Deeper trees retain their full accessible ancestry. Visual indentation is capped at two levels and deeper rows show an ellipsis/tree marker before the handle.

No separate filter-chip row is needed initially. Archived visibility is the only explicit filter.

## Loading, error and empty states

- While refreshing, retain the previous list and show `Refreshing…` in the summary.
- On first load, show a bounded skeleton/`Loading sessions…` state; do not collapse the result viewport.
- On fetch failure, retain stale rows when available and show a retry action. If no rows exist, show `Could not load sessions` plus Retry.
- With no sessions, show `No sessions available` and retain permitted New branch/New root actions.
- With no search matches, show `No sessions match “…”` and a Clear search action.
- If every query match is archived, reveal those archived matches and label the section `Archived matches`.
- Disabled switch/restore/action controls remain visible with an explicit reason in accessible text or an associated description.

## Sections and ordering

Use five priority sections:

1. **Current** — exactly one row when the current session exists;
2. **Active** — other active or compacting sessions;
3. **This session tree** — current root and its non-archived descendants;
4. **Other sessions** — other non-archived roots and descendants;
5. **Archived** — collapsed by default, with count.

Assignment precedence is Current → Active → This session tree → Other sessions → Archived. A row appears in exactly one section. Archived state wins over active/compacting flags if inconsistent backend data contains both.

Within tree sections:

- roots precede descendants;
- descendants are indented by one level;
- siblings use handle-first natural alphabetical ordering;
- do not render more than two levels of visual indentation;
- preserve full hierarchy in accessible labels and optional title text.

The live response already provides `root_chat_jid`, `parent_branch_id`, `branch_id`, `activity_status`, `archived_at`, `is_active`, `is_compacting` and `model`.

## Row design

Use the model picker’s two-line rhythm, but not its pin column.

Primary line:

- `@handle` first;
- lifecycle badges aligned at the end;
- current row uses the accent treatment;
- active rows use weight and badge, not inline `font-weight` styles.

Secondary line:

- full chat JID, truncated visually but available in `title`/accessible name;
- optional short model label for active sessions only;
- root/branch relationship where needed.

Example:

```text
@ux                                  CURRENT · ACTIVE
web:default:branch:4165db5c5a0f · GPT-5.6 Sol
```

Lifecycle badges:

- CURRENT;
- ACTIVE;
- COMPACTING;
- ARCHIVED;
- ROOT or BRANCH only when hierarchy is otherwise ambiguous.

Avoid repeating every possible badge. Indentation already communicates branch status in grouped sections.

## Row actions

Keep row selection and management separate.

- clicking/pressing the row switches to an active session;
- clicking/pressing an archived row restores it;
- pop-out remains a distinct icon button;
- prune/purge remains a distinct icon button with the current two-step confirmation;
- management buttons must not become listbox options;
- action buttons appear on hover/focus for pointer devices and remain visible on coarse-pointer devices;
- destructive confirmation must not move the active listbox option unexpectedly.

The current implementation creates many tab stops because each row has multiple buttons. Use one explicit pattern:

- the session itself is one listbox option;
- one trailing `Session actions` menu button belongs to the active option only;
- `Shift+F10` or the Menu key opens the same menu;
- the menu contains Pop out and, when allowed, Prune or Permanently delete;
- opening the menu moves focus into it; closing it returns focus to the owning option;
- pointer users may reveal the button on hover, but it remains available when the option has keyboard focus;
- coarse-pointer devices always show the action button.

This avoids multiple row-level tab stops and keeps destructive controls out of listbox selection semantics.

## Keyboard contract

Use the model picker’s listbox navigation, adapted for sessions:

- `ArrowDown` / `ArrowUp`: next/previous selectable session;
- `Home` / `End`: first/last selectable session;
- `PageDown` / `PageUp`: one visible page;
- `Enter`: switch or restore the active session;
- `Escape`: close and restore focus to the session trigger;
- `Tab`: normal focus traversal; it must not select a session;
- typing edits the focused search field;
- `Shift+F10` or `Menu`: open the active row's Session actions menu;
- optional `ArrowLeft` / `ArrowRight`: collapse/expand Archived or tree groups after grouped navigation is stable.

Do not retain the current behaviour where `Tab` selects the active item.

Use `combobox` + `listbox` + `option`, with `aria-activedescendant`, `aria-selected` and `aria-disabled` where applicable.

## Footer actions

The model picker has one strong settings action. Sessions have more management commands, so the footer should be simpler rather than identical.

Primary actions:

- **New branch**;
- **New root…**.

Secondary menu or compact group:

- Rename current;
- Merge into parent, when available;
- Delete current, when allowed;
- Open Session settings.

Keep destructive actions visually separated. Do not place five equal-weight buttons across the footer.

Settings → Sessions currently controls lifecycle and agent behaviour; it is a valid destination for **Open Session settings**, but it does not replace branch management.

## Desktop layout

Use a session-specific class layered on shared picker-shell tokens:

```text
.compose-session-picker
.compose-picker-shell
.compose-picker-header
.compose-picker-results
.compose-picker-footer
```

Shared tokens must define the same numerical desktop header padding, result border treatment, footer padding and mobile safe-area inset for both model and session pickers. Session rows retain their own typography, hierarchy and lifecycle styling.

Recommended size:

- width: 520–620 px;
- maximum height: min(70dvh, 620 px);
- result minimum height: 180 px;
- result maximum height: min(48dvh, 430 px);
- anchor above the compose box;
- keep the popup inside viewport margins.

The minimum result height fixes the observed 38 px collapse.

## Mobile layout

Match the model picker’s mobile shell:

- fixed within safe-area-aware 8 px margins;
- near-full-screen result area;
- search and summary remain visible;
- footer stacks or wraps into 44 px targets;
- row selection area is at least 44 px high;
- trailing actions are at least 44×44 px;
- no 218 px nested menu above the keyboard;
- search input uses a font size that does not trigger iOS page zoom.

This is the most visible alignment with the model picker and removes the cramped compose-popover behaviour shown on phone.

## Shared implementation boundary

Extract a small presentation shell, not a generic catalogue framework.

Suggested components:

```text
runtime/web/src/components/compose-picker-shell.ts
runtime/web/src/components/session-picker.ts
runtime/web/src/ui/session-picker.ts
```

`ComposePickerShell` owns:

- header/search layout;
- count summary;
- result viewport;
- footer layout;
- mobile sheet styling hooks;
- close/focus contract.

`ClassicModelPicker` may migrate to the shell if doing so reduces duplication without changing behaviour. The session picker can adopt it first if migrating the model picker would enlarge the change.

`session-picker.ts` owns pure functions for:

- normalising session rows;
- search documents;
- section assignment;
- tree ordering;
- selectable-option movement;
- action availability.

Move session rendering and keyboard logic out of `compose-box.ts`. Keep orchestration callbacks in ComposeBox.

## Proposed data shape

```ts
interface SessionPickerEntry {
  key: string;
  chatJid: string;
  handle: string;
  rootChatJid: string;
  parentBranchId: string | null;
  branchId: string | null;
  depth: 0 | 1 | 2;
  model: string | null;
  state: 'current' | 'active' | 'compacting' | 'idle' | 'archived';
  isRoot: boolean;
  canSwitch: boolean;
  canRestore: boolean;
  canPopOut: boolean;
  canPrune: boolean;
  canPurge: boolean;
}
```

This is a UI projection of existing branch data. No backend schema change is required for the first phase.

## Delivery scope

### Phase 1 — shell, search and navigation

- extract `SessionPicker` from ComposeBox;
- add search/header/count summary and explicit loading/error/empty states;
- add stable desktop result height;
- add listbox keyboard semantics;
- adopt the model picker's mobile full-screen sheet geometry;
- keep the existing flat alphabetical session order and footer actions;
- retain the bare-`@` shortcut.

### Phase 2 — hierarchy and action simplification

- add Current, Active, This session tree, Other and Archived sections;
- apply the explicit filtered-ancestor rules;
- render capped visual indentation with full accessible ancestry;
- collapse Archived by default outside search;
- replace row pop-out/delete buttons with one Session actions menu;
- move rename/merge/delete footer commands into a secondary action group/menu.

Phase 1 is a small-to-medium change. Phase 2 should follow after the interaction shell is stable.

## Phase 1 acceptance criteria

### Shared visual alignment

- [ ] Model and session picker headers use the same padding values and search-control height.
- [ ] Model and session picker result containers use the same border treatment and footer padding.
- [ ] Session picker has a visible labelled search field, clear button and live result count.
- [ ] With at least one session, the desktop result element reports a computed height of at least 180 px and no more than 430 px in the Playwright fixture.
- [ ] At 412×915, the session picker is fixed within the same 8 px safe-area-aware viewport inset used by the model picker.
- [ ] Session rows render a primary handle line and secondary chat-JID line; current rows use the shared accent background/border tokens.

### Search and states

- [ ] Search matches handle, chat JID, root JID, lifecycle state and model label, case-insensitively.
- [ ] First-load, refreshing, failure-with-stale-data, failure-without-data, no-sessions and no-match states render the specified copy/actions.
- [ ] Clearing search restores the full session list and focuses the search field.
- [ ] The bare-`@` compose shortcut still opens the picker and focuses search.

### Keyboard and regression coverage

- [ ] Search receives focus on open and exposes `aria-controls`/`aria-activedescendant` for the session listbox.
- [ ] Arrow, Home, End, PageUp, PageDown, Enter and Escape select/move/close according to the keyboard contract.
- [ ] Tab never switches or restores a session.
- [ ] Closing restores focus to the session trigger; selecting restores focus to compose after navigation completes.
- [ ] Playwright covers desktop, tablet and phone geometry plus keyboard selection using at least 25 session rows.
- [ ] Existing switching, restoration, pop-out, deletion, bare-`@` shortcut and branch lifecycle tests continue to pass.
- [ ] Model picker component and browser tests continue to pass if shared shell tokens/components change.

## Phase 2 acceptance criteria

- [ ] Every session is assigned by the precedence Current → Active → This session tree → Other sessions → Archived, with archived state winning inconsistent active flags.
- [ ] A session row appears once across all sections.
- [ ] Branch search results show their root as a non-selectable context heading, omit unmatched siblings and expose full ancestry in the accessible name.
- [ ] Active/current rows removed from tree sections still retain a root-context heading where needed.
- [ ] Archived is collapsed by default, exposes `aria-expanded`, and announces its count; active search temporarily reveals archived matches.
- [ ] Duplicate handles remain distinguishable by visible chat JID.
- [ ] Each active option exposes one Session actions menu button; the menu contains only actions allowed for that row.
- [ ] `Shift+F10` and Menu open the row menu; closing returns focus to the owning option.
- [ ] Switch, restore, pop-out, prune and purge retain current backend behaviour and confirmation rules.
- [ ] Current, active, compacting, root/branch and archived state are included in accessible labels without relying on `title`.
- [ ] Playwright covers section order, filtered ancestor context, archived-search reveal, action-menu focus and destructive confirmation.

## Non-goals

- redesigning Settings → Sessions in this change;
- adding session pinning or recency ranking;
- changing branch storage or API contracts;
- adding drag-and-drop tree reordering;
- showing full model catalogue details in session rows;
- merging branch management into the model picker;
- implementing virtualisation for a 20–30-row session set.

## Recommendation

Implement Phase 1 first. It fixes the desktop collapse, improves phone use, introduces search and aligns the interaction model with the new picker without changing branch semantics. Add hierarchy and action-menu simplification in Phase 2 after the shell and keyboard contract have browser coverage.
