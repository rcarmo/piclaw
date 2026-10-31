# Web UI

Piclaw ships with a single-user streaming web UI that combines chat, workspace,
editor, terminal, viewers, and lightweight control surfaces in one app.

The UI supports one user across multiple sessions and browser tabs. Family account and invitation pages have been removed.

## Login

The login shell loads public method flags before enabling credential inputs. Code login sends only the six-digit code. Passkey-only and code-only policies hide unsupported controls. Explicit actions cancel competing passkey work; failed policy loading offers retry.

## UX guidelines

**Do not reinvent the UX paradigm.** Extend the established interface using its existing interaction patterns, components, visual styles and terminology. Before changing an interaction, inspect the equivalent behaviour in both skins and reuse its implementation where possible.

- Conversation input and accepted steering belong in the timeline. Pending follow-ups use the existing queue UI. Ongoing activity uses the native agent-status surface.
- Give each state one appropriate presentation. Do not add parallel banners, persistent acknowledgement notices or custom spinners for states already represented by the timeline, queue or agent status.
- Keep transient submission and error feedback consistent with existing controls. End transient feedback when its operation finishes; do not leave it beside newer authoritative activity.
- Repair event ordering, persistence and lifecycle handoffs at their source. Additional status text is not a substitute for correct state transitions.
- Preserve keyboard, touch, focus, accessibility, theme and responsive-layout conventions. Equivalent interactions must behave consistently in Classic and Visual.
- Introduce a new interaction paradigm only when existing patterns cannot meet the requirement. Explain the limitation and obtain explicit user approval before implementing it.

These rules apply to core UI, add-ons and generated interactive surfaces. Visual consistency does not replace correct acceptance, cancellation or error semantics. See the [project instructions](../AGENTS.md#ux-conventions) and [extension UI contract](extension-ui-contract.md).

## Chat and status surfaces

### Streaming chat

- thought and draft panels during streaming
- live steering and queued follow-ups
- Adaptive Cards with persisted submissions
- `/btw` side conversations
- file attachments, link previews, and threaded turns
- syntax-highlighted previews for common text/code attachments
- theme and tint controls via `/theme` and `/tint`

### Model selection

Both model pickers and Models settings send the selection to the backend. Catalogue context windows describe model capacity; the browser does not infer whether the current conversation fits. Models settings shows candidate fit as unknown until the backend checks the switch.

Backend refusals leave the current selection unchanged. Successful selections require confirmation from `/agent/models` and apply to the next model request. Selecting a model never implicitly compacts or replays conversation input. Use the existing explicit compaction control when needed.

### Native reply threads

A native terminal reply uses the thread root of its accepted user message. The host resolves that message from the immutable source ID and payload reference. It never selects the latest timeline message. Existing null-rooted and self-threaded roots are valid; cross-chat and nested roots are rejected.

Queued compose input starts a new thread unless the request supplies `thread_id`. An explicit selection survives both busy-input admission and a turn becoming busy during storage. Native settlement publishes the reply once through the terminal commit. Message-reference pills open and highlight the referenced timeline post.

[Native queue ownership](development/native-queue-boundaries.md) defines source admission, steering, exact-row cancellation and the conflict response for historical unaccepted queue items. SDK queue injection and content-based clear/replay are retired from the web queue interface.

The resolver is in [`host-message-thread.ts`](../runtime/durable-engine/src/host-message-thread.ts). [`application-web.test.ts`](../qualification/pi-durable-130/application-web.test.ts) covers normal and queued publication with the real pool and channel.

### Tool and turn status

The status surface is designed to keep the most useful in-flight context visible
instead of collapsing everything into generic waiting copy.

Current behavior:

- active `tool_call` / `tool_status` rows stay visible during silence probing
  instead of being replaced immediately by `Waiting for model…`
- recent-activity restore keeps the last meaningful status payload when the web
  UI reconnects or when you return to an active chat
- tool-status rows can show an age hint in the meta row, alongside git/status
  metadata, using a small clock icon and labels like `10s ago` or `2m 3s ago`
- intent panels can also show an elapsed-time hint once they have been active
  for at least 10 seconds
- recovered turns can render a compact `recovered` chip in the message metadata
  row
- timed-out turns can render a compact `timeout` chip in the message metadata
  row, plus a salvaged partial draft in the timeline fallback post

### Timeout and recovery UX

When a turn stalls or times out, Piclaw preserves partial context where possible:

- preserve the last visible tool action when possible
- preserve the last draft in the draft panel when the turn stalls
- append a local fallback timeline post containing the salvaged partial draft
- attach a visible timeout marker so the fallback is distinguishable from a
  normal answer

See [runtime-flows.md](runtime-flows.md) for the runtime-level details.

## Workspace

- sidebar file browser with auto-refresh
- drag-and-drop upload progress
- client-side 256 MB upload guard before the request starts
- file-reference pills in prompts
- folder sizes in the starburst explorer
- workspace search index status with one-click reindex from the explorer header

## Editor

- CodeMirror 6 editor
- syntax highlighting for JS/TS, Python, Go, JSON, CSS, HTML, YAML, SQL,
  XML/SVG, Markdown, and Shell
- search and replace
- dirty-state tracking
- line wrapping
- lazy-loaded local bundle with no CDN dependency
- editor, Markdown preview, search, diff and selection colours follow the active theme; widget inputs keep native text selection
- file-reference pills can be added from an open editor tab; closing a referenced file tab removes that file from the compose references

Bundled palette selection aims to keep prose legible; authored syntax and imported selection colours remain under their theme's control. See the [editor theme audit](reviews/editor-highlight-theme.md) for test scope and native iOS limits.

## Terminal

- bundled xterm.js web terminal
- authenticated shell session in the browser
- dock panel or standalone tab
- detachable into popout windows with live session transfer
- enabled by default on Linux and macOS
- disabled by default on Windows unless explicitly enabled
- optional Ghostty renderer available through the `@rcarmo/piclaw-addon-ghostty-terminal` add-on

Configuration details live in [configuration.md](configuration.md).

## Viewers and panes

- **Draw.io add-on** — optional self-hosted editor with SVG/PNG/XML export back to workspace
- **Office viewer add-on** — `.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods`, `.odp`; backend supplied by the optional Office add-on
- **CSV/TSV** — dedicated table viewer
- **PDF, images, video** — inline viewers
- **Text/code attachments** — timeline preview modal for common code/config
  formats
- **Kanban boards** — `*.kanban.md` in a drag-and-drop board editor via the
  `kanban-editor` add-on (Obsidian Kanban compatible)
- **VNC remote display** — connect to allowlisted targets from a tab; direct
  targets are enabled by default on Linux/macOS/Windows and can be disabled
  with `PICLAW_WEB_VNC_ALLOW_DIRECT=0`

## Automation and integrations

- **`/image` and `/flux`** — workspace-backed image generation commands for
  Azure OpenAI / Foundry; `/image` supports `--transparent` when the selected
  model can generate transparent PNG output
- **`image_process`** — sharp-backed workspace image manipulation for resize,
  crop, convert, optimise, metadata inspection, text/SVG/composite operations,
  and animated GIF workflows
- **`cdp_browser`** — Chromium/Edge/Chrome automation via CDP for navigation,
  DOM clicking, JS evaluation, and screenshots
- **`mcp` via `pi-mcp-adapter`** — token-efficient MCP access through
  shared `.mcp.json` plus optional Pi-specific `.pi/mcp.json` overrides
- **Remote Peer add-on** — optional paired-instance messaging and mediated work through generic core add-on transport APIs
- **[Microsoft 365 add-on](https://rcarmo.github.io/piclaw-addons/addons/m365/)** — optional browser-auth automation for Teams, Graph, OneDrive, SharePoint, and calendar flows
- **`win_*` tools** — Windows-only desktop automation via Win32 FFI

## Related docs

- [configuration.md](configuration.md) — ports, auth, terminal, VNC, runtime
  knobs, and workspace env hook
- [tools-and-skills.md](tools-and-skills.md) — internal tools, skills, and
  slash commands
- [Remote Peer add-on](https://rcarmo.github.io/piclaw-addons/addons/remote-peer/) — pairing, signed messaging, policy, and mediated work
- [Microsoft 365 add-on](https://rcarmo.github.io/piclaw-addons/addons/m365/) — Teams, Graph, Outlook, OneDrive, SharePoint, Calendar, and To Do tools
- [runtime-flows.md](runtime-flows.md) — session lifecycle, reconnect behavior,
  recovery, and timeout handling
- [web-pane-extensions.md](web-pane-extensions.md) — pane extension model
- [extension-ui-contract.md](extension-ui-contract.md) — event bridge contract
