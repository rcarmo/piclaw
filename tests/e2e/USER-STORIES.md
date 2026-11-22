# User Stories — Primary User Profile

## Persona: Power User (Rui)

- **Devices:** iPhone (away/quick), iPad (primary daily driver), Desktop (deep work)
- **Sessions:** 5-6 active across multiple instances, topic-based, long-lived
- **Switching:** Typeahead on keyboard, swipe on touch
- **Compose style:** Short concise instructions, occasional long paste (bug reports, feature specs)
- **Queue usage:** Very heavy — queues follow-ups constantly, pulls back for editing frequently
- **Abort:** Rare, expects partial summary
- **Slash commands:** Rare; `/tint` and `/theme` are the most frequent
- **Editor:** Critical on writing-focused instance; zen mode, markdown preview, popouts all used
- **Workspace:** Uploads occasional but critical; rename/delete important but clunky
- **Settings:** Opened very often during dev/test; accessed via typeahead primarily
- **Attachments:** Screenshots pasted constantly, lightbox and file preview heavily used
- **Panes:** Terminal, VNC, office viewers all used on all devices
- **A2UI forms:** Liked for logins/pickers; widgets for complex input
- **Push notifications:** Not a priority (HTTPS-limited)
- **Recovery action:** Refresh (full page reload)

---

## User Stories

### US-01: Morning Triage
> As a power user, I want to quickly scan the timeline across multiple sessions and provide guidance, so that I can keep all workstreams moving.

**Acceptance criteria:**
- Switching between 5-6 sessions is fast (<500ms visual transition)
- Timeline loads without cross-session message bleed
- Compose box is ready for input immediately after switch
- `/tint` and `/theme` work reliably from compose

### US-02: Queue and Steer
> As a power user, I want to queue follow-up messages while the agent works and pull them back for editing, so that I can refine my instructions before delivery.

**Acceptance criteria:**
- Sending while agent is busy adds to queue visibly
- Queue items show edit/remove controls
- Pulling back a queue item returns text to compose box
- Queue state survives SSE reconnect
- No race conditions between queue state and agent completion

### US-03: Multi-Device Session Switching
> As a multi-device user, I want to switch sessions via typeahead (keyboard) or swipe (touch) depending on my device, so that the interaction model matches my input method.

**Acceptance criteria:**
- Typeahead finds sessions by name (prefix and substring match)
- Finger swipe navigates sessions on iPad/iPhone
- Apple Pencil does NOT trigger swipe
- Horizontal gesture on message content does NOT trigger switch
- Session popup sorts alphabetically with active first

### US-04: Editor as Workspace
> As a writer, I want the editor to be stable with zen mode, live markdown preview, and reliable tab management, so that I can focus on content without UI fights.

**Acceptance criteria:**
- Switching files: no flicker
- Dirty tab close: confirmation dialog
- Tab activation: on mouse-down, not mouse-up
- Zen mode: no CPU spikes on hover
- Preview splitter: stable during resize
- Editor state: survives popout/return and page refresh

### US-05: Screenshot Debugging Workflow
> As a developer, I want to paste screenshots into compose and view them in the lightbox, so that I can show the agent what's broken and review its visual output.

**Acceptance criteria:**
- Paste image from clipboard attaches to compose
- Drag-and-drop image attaches to compose
- Sent images appear in timeline with thumbnail
- Clicking thumbnail opens lightbox
- Lightbox supports zoom, pan, close
- File preview works for PDFs and archives

### US-06: Settings During Development
> As a developer iterating on the app, I want settings to open instantly and save changes immediately, so that I don't lose flow switching models or configuring addons.

**Acceptance criteria:**
- Settings opens within 100ms (cached) or shows shell immediately (cold)
- Number fields accept typed values (not just stepper clicks)
- Changes persist without explicit save button
- Rapid open/close does not duplicate dialogs
- Accessible via typeahead, gear icon, or Cmd+,

### US-07: Resilient Reconnection
> As a user on flaky WiFi or switching between devices, I want the app to recover from network drops without losing messages or showing stale state.

**Acceptance criteria:**
- SSE reconnects within 5s after network recovery
- Messages delivered during disconnect appear after reconnect
- Queue state refreshes on reconnect
- Agent status shows correct state after reconnect
- No auto-reload loops on version drift
- Page refresh recovers all state (timeline, queue, compose draft)

### US-08: Touch-First Pane Interaction
> As an iPad user, I want VNC, terminal, and office viewer panes to work with touch input without getting stuck or losing connection.

**Acceptance criteria:**
- VNC: touch/pen input does not get stuck
- VNC: reconnect failure shows minimal UI (no complex error screen)
- Terminal: reattaches after popout/return
- Office viewer: renders and controls work on touch
- All panes: no stuck states requiring refresh

### US-09: Session Lifecycle
> As an organiser, I want to name, fork, archive, and find sessions efficiently, so that my topic-based workflow stays manageable at scale.

**Acceptance criteria:**
- Rename propagates to all connected clients (SSE broadcast)
- Renamed sessions findable in typeahead immediately
- Fork creates a sub-session linked to parent
- Archive moves session below active list
- Non-default sessions can be archived
- Delete works for archived sessions

### US-10: Workspace File Operations
> As a user, I want to upload, rename, and delete files in the workspace explorer without frustration, so that I can manage project assets directly.

**Acceptance criteria:**
- Upload: drag-and-drop works, progress shown, up to 512MB
- Rename: clear affordance, keyboard-friendly, no accidental delete
- Delete: confirmation required, no accidental trigger from gestures
- Explorer: responsive to touch, no stuck drag states

### US-11: PWA Manifest and Home Screen Icons
> As a user adding PiClaw to my iOS or Android home screen, I want the manifest and service worker to always be correct and supply high-resolution versions of the avatar icons, so that the installed app looks sharp and behaves like a real PWA.

**Acceptance criteria:**
- `/manifest.json` returns valid JSON with `name`, `icons`, `start_url`, `display`
- Manifest includes 192x192 and 512x512 PNG icons
- Icon URLs actually resolve to PNG images of the declared size
- Apple touch icons at 180x180, 167x167, 152x152 all resolve
- Generic `/apple-touch-icon.png` resolves
- `/favicon.ico` serves a valid PNG (Safari compatibility)
- HTML head contains `<link rel="apple-touch-icon">` tags with correct sizes
- When avatar changes, manifest icon URLs get a new version parameter
- Icons use the custom agent avatar when configured, not generic defaults
- Android Chrome sees an active service worker with a same-origin GET fetch handler

### US-12: Thoughts Panel Scroll Behaviour
> As a user monitoring agent reasoning, I want the thoughts panel to become scrollable when I click "N more lines" and revert to non-scrollable when I collapse it, so that I can read long reasoning without the panel taking over the screen.

**Acceptance criteria:**
- Collapsed: `overflow-y: hidden`, `max-height` clamped to N lines, "X more lines" button visible
- Expanded (thought panel): `overflow-y: auto`, `max-height: min(52vh, 34rem)`, scrollbar appears if content exceeds
- `data-expanded` attribute toggles between "true" and "false"
- Clicking "show less" returns to collapsed state with hidden overflow
- Content is preserved across expand/collapse round-trips
- Scroll position resets to top on re-expand

### US-13: Terminal Standalone
> As a user, I want to open a terminal pane standalone without garbled display, execute commands like `ls -al`, close it cleanly via click or tap, and pop it out to a separate window on desktop.

**Acceptance criteria:**
- Terminal opens without garbled characters or mojibake
- Blinking cursor visible on open
- `ls -al` produces column-aligned output with permissions
- Close button on tab works via click and tap
- Pop-out button opens terminal in separate window (desktop)
- Terminal background/foreground updates when UI theme changes

### US-14: Terminal Dock (beneath editor)
> As a user editing files, I want a terminal docked below the editor that I can toggle, resize, and use alongside the editor without focus conflicts.

**Acceptance criteria:**
- Ctrl+` toggles dock visibility
- Tab strip dock toggle button works
- Dock splitter is draggable (resizes terminal vs editor)
- Terminal and editor have independent focus
- Dock is hidden in zen mode
- Terminal in dock is interactive (can type and see output)

### US-15: Terminal Zen Mode
> As a user wanting focused terminal or editor work, I want zen mode to hide all chrome and provide a permanently visible exit indicator in the top-right corner.

**Acceptance criteria:**
- Zen mode hides workspace sidebar, chat container, dock
- Editor/terminal fills viewport
- Zen exit indicator permanently visible (not hover-dependent) in top-right corner
- Clicking indicator exits zen mode
- Escape key exits zen mode
- Tab strip hidden by default, revealed on hover near top edge
- Minimum 44×44px tap target on exit indicator for touch devices

### US-16: Message Deletion from Timeline
> As a user managing conversation history, I want to delete messages and their cascading thread replies correctly, so that cleanup doesn't leave orphaned replies or lose data unexpectedly.

**Acceptance criteria:**
- Delete button visible on message hover
- Single message (no replies): deletes immediately, no confirmation
- Parent with replies: shows confirmation dialog mentioning reply count
- Confirming cascade: removes parent and ALL thread replies
- Cancelling: preserves all messages unchanged
- Server fallback: if backend detects replies client missed, shows second confirmation
- No orphaned replies remain after cascade delete
- Deleted messages stay gone after page refresh
- Media attachments cleaned up on delete (not leaked)
- Delete animation (`.removing` class) plays before removal
- No accidental deletion from drag/swipe gestures

### US-17: Compose Submission Instant Visibility
> As a user sending messages, I want my submitted text to appear instantly in the timeline without waiting for the agent to respond, so that I have immediate confirmation my message was received.

**Acceptance criteria:**
- Message appears in timeline within 1 second of pressing Enter
- Compose box clears immediately after submission
- Compose box stays focused and editable after send
- Multiple rapid submissions all appear in correct order
- Long multi-line messages appear completely (not truncated)
- Timeline auto-scrolls to bottom to show new message
- User message visible before agent response arrives (SSE `new_post` event)
- Message with file attachment shows attachment indicator immediately

### US-18: Compaction Indicator Instant Updates
> As a user, I want the compaction indicator to update instantly during and after compaction, so that I always know the current state of my context window.

**Acceptance criteria:**
- Context pie shows `.is-compacting` class during compaction
- Elapsed timer (0:05, 1:23) counts in real-time on the pie
- Aria-label mentions "Smart compaction" during active compaction
- Abort/stop button shows compacting spinner during compaction
- Indicator clears immediately when compaction_end SSE arrives
- Context usage percentage updates after successful compaction
- Suppressed compaction shows backoff notice with failure count / retry timing

### US-19: Model Switching After Compaction
> As a user, I want to switch to a smaller context model immediately after compaction, so that I can continue working with a model appropriate for my reduced context.

**Acceptance criteria:**
- Model button in compose bar is clickable during and after compaction
- Clicking model button opens model selector/settings
- `/model` command shows current model or available list
- Model switch shows "Switching…" transition label
- Compose bar updates to new model name after switch
- Context usage recalculates for the new model's context window
- No delay or blocked state between compaction end and model switch

### US-20: Lightbox Dismissal
> As a user viewing attachments in the lightbox, I want to dismiss it by any key press, click, or tap anywhere, so that I can quickly return to the conversation without hunting for a close button.

**Acceptance criteria:**
- Escape key dismisses (already works)
- Any other key press (Space, Enter, letters, arrows) dismisses
- Click on dark backdrop dismisses (already works)
- Click directly on the image/content itself dismisses (currently blocked by stopPropagation)
- Tap anywhere on touch device dismisses
- Close button still works as explicit fallback
- Lightbox stays closed after dismissal (no flicker/re-render)

### US-21: Session Swipe Independence
> As a mobile user, I want to swipe between sessions regardless of which UI elements are visible, so that session navigation works consistently no matter what pane is open.

**Acceptance criteria:**
- Swipe works on the timeline regardless of which panes are open (workspace, editor, dock)
- Workspace explorer being visible does NOT prevent swipe on the timeline
- Editor pane being visible does NOT prevent swipe on the timeline
- Terminal dock being visible does NOT prevent swipe on the timeline
- Swipe IS blocked inside actual interactive controls (compose box, text inputs, contenteditable)
- Swipe IS blocked inside the editor content area (which handles its own horizontal gestures)
- Swipe passes through agent thinking/status panels
- Apple Pencil does not trigger swipe
- Visual indicator shows adjacent session name during gesture

### US-22: Settings Dialog Layering
> As a user opening settings while the workspace pane is visible, I want the settings backdrop to be partially opaque and above all other elements, so that only the settings dialog is interactive and the rest is dimmed.

**Acceptance criteria:**
- Semi-transparent backdrop covers entire viewport when settings opens
- Backdrop is above workspace pane (z-index: 2400 > workspace z-index)
- Backdrop opacity is between 0.3 and 0.8 (dimmed but visible behind)
- Workspace pane is not clickable through the backdrop
- Settings dialog is fully visible (not clipped by workspace or any other pane)
- Closing settings removes backdrop and restores workspace interactivity
- No stacking context leakage from workspace tooltips (z-index: 9999)

### US-23: Context Meter Tooltip
> As a user, I want to see the current token values when I hover over the context meter, so that I know exactly how much context I'm using.

**Acceptance criteria:**
- Hovering over the context pie shows "Context: XK / YK tokens (Z%)"
- Both used and total token counts are present
- Percentage matches the visual fill of the pie arc
- Tooltip includes "Compact context" action hint when not compacting
- Tooltip shows compaction title + elapsed time during compaction
- aria-label matches title for screen reader accessibility
- Token values update after agent turns (usage increases)
- Title attribute is always present (native tooltip on hover)

### US-23: Mobile PWA Viewport and Themed Safe Areas
> As an iPhone/iPad home-screen webapp user, I want the compose area to remain flush with the bottom edge and the active theme to cover every safe-area/background surface, so that the app feels native and never shows a blank strip below compose.

**Acceptance criteria:**
- In standalone mobile mode, `--app-height` uses the layout viewport when `visualViewport.height` is only slightly shorter due to iOS chrome/safe-area reporting
- Small closed-keyboard viewport gaps (for example ~59px) do not shorten the app shell or create whitespace below compose
- Large viewport shrink values are still respected for the virtual keyboard
- The compose box bottom edge is within a few pixels of the visible app surface bottom
- The point below compose is either outside the viewport or belongs to compose/app chrome, never a blank body strip
- Persisted themes apply before/at app boot in standalone mode
- Theme changes update CSS variables, root/body inline backgrounds, and PWA `theme-color` meta tags
- Non-default themes and default+tint both cover root/body safe-area backgrounds

---

## Priority Matrix

| Story | iPad | iPhone | Desktop | Frequency | Regression risk |
|-------|------|--------|---------|-----------|-----------------|
| US-02 Queue & steer | ★★★ | ★★ | ★★★ | Very high | **Very high** |
| US-03 Session switch | ★★★ | ★★★ | ★★ | High | High |
| US-01 Morning triage | ★★★ | ★★ | ★★ | Daily | Medium |
| US-07 Reconnection | ★★★ | ★★★ | ★★ | High | High |
| US-04 Editor | ★★ | ☆ | ★★★ | High | Medium |
| US-05 Screenshots | ★★★ | ★★ | ★★★ | High | Medium |
| US-06 Settings | ★★ | ★ | ★★★ | High | **Very high** |
| US-08 Panes | ★★★ | ★ | ★★★ | Medium | High |
| US-09 Session lifecycle | ★★ | ★ | ★★ | Medium | Medium |
| US-10 Workspace files | ★★ | ★ | ★★ | Low-Medium | Medium |
| US-11 PWA manifest | ★★★ | ★★★ | ★ | Every install | Medium |
| US-12 Thoughts panel | ★★★ | ★★ | ★★★ | Every turn with thinking | Medium |
| US-13 Terminal standalone | ★★★ | ★★ | ★★★ | Frequent | High |
| US-14 Terminal dock | ★★ | ★ | ★★★ | Frequent (desktop) | Medium |
| US-15 Terminal zen mode | ★★ | ★ | ★★★ | Occasional | Medium |
| US-16 Message deletion | ★★★ | ★★ | ★★ | Frequent | High |
| US-17 Compose instant visibility | ★★★ | ★★★ | ★★★ | Every message | Very high |
| US-18 Compaction indicator | ★★★ | ★★ | ★★★ | Every compaction | High |
| US-19 Model switching | ★★★ | ★★ | ★★★ | Frequent (dev) | High |
| US-20 Lightbox dismissal | ★★★ | ★★★ | ★★ | Every image view | Medium |
| US-21 Swipe independence | ★★★ | ★★★ | ★ | Every session switch (touch) | High |
| US-22 Settings layering | ★★★ | ★★ | ★★★ | Every settings open | Medium |
| US-23 Context meter tooltip | ★★★ | ★★ | ★★★ | Every hover on pie | Low |
| US-24 Hamburger menu items | ★★★ | ★★★ | ★★ | Every menu open | Medium |
| US-25 Safe area / layout | ★★★ | ★★★ | ★★ | Always (PWA) | Medium |
| US-26 PWA scale / preview | ★★ | ★★★ | ★ | Occasional | Low |
| US-27 Context scoping | ★★★ | ★★ | ★★★ | Every session switch | High |
| US-28 Image annotation | ☆ | ★★★ | ☆ | iPad image review | Medium |
| US-29 Text highlighting | ★★ | ★★★ | ★★ | Post review | Medium |
| US-30 Compaction settings | ★★ | ★ | ★★★ | Settings config | Low |
| US-23 Mobile PWA viewport/theme | ★★★ | ★★★ | ☆ | Every mobile webapp session | Very high |

## Test implementation priority

1. **US-02** — Queue/steer (keeps breaking, daily pain)
2. **US-03** — Session switching (multi-device, touch)
3. **US-07** — Reconnection (silent failures)
4. **US-06** — Settings (frequent regressions from race conditions)
5. **US-01** — Morning triage (composition of 02+03)
6. **US-04** — Editor stability
7. **US-05** — Screenshot workflow
8. **US-08** — Panes
9. **US-09** — Session lifecycle
10. **US-10** — Workspace files
11. **US-11** — PWA manifest & icons
12. **US-12** — Thoughts panel scroll behaviour
13. **US-13** — Terminal standalone
14. **US-14** — Terminal dock (beneath editor)
15. **US-15** — Terminal zen mode
16. **US-16** — Message deletion from timeline
17. **US-17** — Compose submission instant visibility
18. **US-18** — Compaction indicator instant updates
19. **US-19** — Model switching after compaction
20. **US-20** — Lightbox dismissal (any key/click/tap)
21. **US-21** — Session swipe independence from visible elements
22. **US-22** — Settings dialog layering above workspace
23. **US-23** — Context meter tooltip with token values
24. **US-24** — Hamburger menu items and workspace state
25. **US-25** — Safe area and layout fixes
26. **US-26** — PWA display scale and editor preview
27. **US-27** — Context scoping and compaction
28. **US-28** — Image annotation (iPad)
29. **US-29** — Text highlighting
30. **US-30** — Compaction and context mode settings pane
23. **US-23** — Mobile PWA viewport and themed safe-area coverage
