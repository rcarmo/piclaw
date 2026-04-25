# Web pane extensions

This document explains how to create a custom pane extension for the piclaw
web UI. Pane extensions provide content-area UI components — editors, viewers,
previewers, or tools — managed by the `PaneRegistry`.

Pane extensions are the web app's **first-class host model** for substantial
extension UI. If you need a persistent mounted UI surface, start here.
For the higher-level product contract between pane extensions, timeline-native
UI, and the lower-level `extension_ui_*` bridge, see
[extension-ui-contract.md](extension-ui-contract.md).

## Current built-in panes

| ID | Placement | Description |
|---|---|---|
| `editor` | tabs | CodeMirror 6 editor (fallback for all text files). Lazy-loaded. |
| `office-viewer` | tabs | Route-backed JS Office viewer for `.docx/.xlsx/.pptx` and OpenDocument files. Workspace preview exposes an **Open in Tab** CTA. |
| `csv-viewer` | tabs | Table viewer for `.csv` / `.tsv` files. Workspace preview exposes an **Open in Tab** CTA. |
| `pdf-viewer` | tabs | Inline PDF viewer. Workspace preview exposes an **Open in Tab** CTA. |
| `image-viewer` | tabs | Inline image viewer with zoom (PNG, JPEG, GIF, WebP, SVG, BMP, ICO). Workspace preview exposes an **Open in Tab** CTA. |
| `html-viewer` | tabs | HTML file preview — renders workspace `.html`/`.htm` files in a sandboxed iframe. Preview card has **Preview in Tab** and **Edit Source** buttons. |
| `workspace-preview` | tabs | Default workspace preview surface. Generic text previews keep the lightweight explorer-header editor action instead. |
| `terminal` | dock | Authenticated terminal pane (feature-flagged, default hidden to workspace actions if disabled). |
| `terminal-tab` | tabs | Same terminal pane instance, opened via explicit tab path `piclaw://terminal`. |
| `vnc-viewer` | tabs | VNC remote-display client at `piclaw://vnc` and `piclaw://vnc/<target>`. |

## Choosing the right surface

Use a pane extension when you need:

- a mounted content-area UI
- tab or dock placement
- focus/resize/dispose lifecycle
- substantial tool or file interaction

Prefer other surfaces when:

- the interaction belongs in conversation history → use timeline messages or Adaptive Cards
- the interaction is only a lightweight browser-session signal → use the `extension_ui_*` browser-event bridge

## Terminal and VNC tabs

Two built-ins are operational, non-file-backed tab surfaces:

- `terminal-tab` (`piclaw://terminal`) — authenticated shell terminal
- `vnc-viewer` (`piclaw://vnc[/<target>]`) — VNC remote display viewer

Typical entry points:

- Workspace context actions in `WorkspaceExplorer`:
  - **Open terminal in tab**
  - **Open VNC in tab**
- Programmatic tab launching from host code: `openEditor(path)`, where `path` is
  `TERMINAL_TAB_PATH` (`piclaw://terminal`) or `piclaw://vnc` / `piclaw://vnc/<encoded-target>`.

They share the same pane host model (`openEditor(path)`), but route to very different backend services.

### Terminal tab flow

```mermaid
flowchart TD
    UI[Workspace menu / context menu] -->|Open terminal in tab| Open[openEditor(TERMINAL_TAB_PATH)]
    Open --> Registry[PaneRegistry.resolve(path)]
    Registry -->|priority 10000| TabExt[terminalTabPaneExtension]
    TabExt -->|mount()| TerminalInstance[TerminalPaneInstance]
    TerminalInstance -->|GET /terminal/session| Sess[/terminal/session]
    Sess -->|enabled + ws_path| SocketInit[/terminal/ws]
    SocketInit --> Upgrader[WebSocket upgrade /auth + CSRF checks]
    Upgrader --> Service[TerminalSessionService
resolveOwnerFromRequest]
    Service --> Pty[spawn `/usr/bin/script -qf -c /usr/bin/bash -i`]
    Pty -->|stdout/stderr| Service
    Service -->|JSON output/resize| TerminalInstance
    TerminalInstance -->|ghostty-web render| RemoteUI[Canvas-like terminal UI]
```

**Implementation choices**

- Uses a separate dock extension (`terminalPaneExtension`) for background terminal UX and a tab-capable extension (`terminalTabPaneExtension`) for explicit tab access.
- WebSocket payload is JSON (`{ type: 'input' | 'resize' }`) with `type:'output'` and `type:'exit'` replies from backend.
- PTY session state (process, socket clients, PTY path) is retained per web session token.
- Resize is propagated as terminal columns/rows and mirrored into PTY via `ioctl(TIOCSWINSZ)` + SIGWINCH.
- Terminal frontend is vendored `ghostty-web` with a light theme sync loop so the remote canvas follows web theme changes.

### VNC tab flow

```mermaid
flowchart TD
    User[User] -->|Open VNC in tab| OpenVnc[openEditor(VNC_TAB_PREFIX)]
    OpenVnc --> Registry2[PaneRegistry.resolve(path)]
    Registry2 -->|priority 9000| VncExt[vncPaneExtension]
    VncExt --> VncInstance[VncPaneInstance]
    VncInstance -->|GET /vnc/session?target=...| Sess2[/vnc/session]
    Sess2 -->|target metadata + ws_path| SocketReq[/vnc/ws?target=...]
    SocketReq --> Upgrader2[WebSocket upgrade + /auth + CSRF]
    Upgrader2 --> VncService[VncSessionService
resolveOwnerFromRequest]
    VncService --> Bridge[WebSocketTcpBridge
create TCP socket]
    Bridge --> Target[(Remote VNC host:port)]
    Target -->|RFB protocol bytes| VncInstance
    VncInstance --> Decoder[VncRemoteDisplayProtocol + WASM decoder]
    Decoder --> Canvas[Canvas framebuffer rendering]
```

**Implementation choices**

- `vnc` pane is path-based (`piclaw://vnc`, `piclaw://vnc/<target>`); the target is parsed from the path.
- VNC targets are resolved from:
  1. `PICLAW_WEB_VNC_TARGETS` / `PICLAW_VNC_TARGETS` allow-list (JSON array or map)
  2. Direct-connect when `PICLAW_WEB_VNC_ALLOW_DIRECT` / `PICLAW_VNC_ALLOW_DIRECT` is enabled (default on Linux, macOS, and Windows)
- When neither saved targets nor direct-connect are available, the pane renders explicit empty-state copy that tells the user direct connect is disabled instead of pretending the manual entry flow still exists.
- `WebSocketTcpBridge` is protocol-agnostic:
  - forwards binary traffic between websocket clients and TCP sockets
  - keeps per-connection byte counters for UI metrics
  - handles `ping`/`pong` as control plane messages
- Client render path supports remote-framebuffer negotiation events (`protocol-version`, `security-types`, `display-init`, `framebuffer-update`) and scales pixels into a contained canvas.
- Input is mapped through dedicated utilities:
  - `vnc-input.ts` for pointer/key encoding
  - `remote-display-socket.ts` for transport metrics and control message parsing
  - `remote-display-decoder.ts` for optional AssemblyScript/WASM fast-path raw decoding (JS fallback exists)
- A fallback is attempted when no paintable frame appears quickly after `display-init` (RAW encoding request), which helps compatibility with servers that do not send the preferred encoding set.

## Concepts

| Term | Description |
|---|---|
| **WebPaneExtension** | The extension contract. Declares what a pane can do and how to mount it. |
| **PaneRegistry** | Singleton that tracks registered panes and resolves the best one for a file. |
| **PaneContext** | Data passed when mounting: file path, content, mtime, mode. |
| **PaneInstance** | The mounted pane. Communicates with the host via callbacks. |
| **PanePlacement** | `"tabs"` (tabbed content area) or `"dock"` (persistent bottom panel). |
| **PaneCapability** | `"edit"`, `"readonly"`, `"preview"`, or `"terminal"`. |

## Extension interface

```typescript
interface WebPaneExtension {
  id: string;                        // Unique identifier
  label: string;                     // Human-readable name
  icon?: string;                     // Icon identifier or SVG
  capabilities: PaneCapability[];    // What this pane can do
  placement: PanePlacement;          // "tabs" or "dock"

  // For tabs panes: can this pane handle the given context?
  // Return false to decline, true for default priority (0),
  // or a number (higher wins).
  canHandle?(context: PaneContext): boolean | number;

  // Mount the pane into a container element.
  mount(container: HTMLElement, context: PaneContext): PaneInstance;
}
```

## Creating a tabs pane

Tabs panes appear in the tabbed content area. The registry calls `canHandle()`
on each registered tabs pane to find the best handler for a file.

### Step 1: Define the extension

```typescript
import type { WebPaneExtension, PaneContext, PaneInstance } from '../panes/pane-types.js';

export const markdownPreviewExtension: WebPaneExtension = {
  id: 'markdown-preview',
  label: 'Markdown Preview',
  capabilities: ['preview'],
  placement: 'tabs',

  canHandle(context: PaneContext): boolean | number {
    if (!context.path) return false;
    // Only handle .md files, with higher priority than the editor (1)
    return context.path.endsWith('.md') ? 10 : false;
  },

  mount(container: HTMLElement, context: PaneContext): PaneInstance {
    return new MarkdownPreviewInstance(container, context);
  },
};
```

### Step 2: Implement PaneInstance

```typescript
class MarkdownPreviewInstance implements PaneInstance {
  private container: HTMLElement;
  private el: HTMLElement;

  constructor(container: HTMLElement, context: PaneContext) {
    this.container = container;
    this.el = document.createElement('div');
    this.el.className = 'markdown-preview';
    this.el.innerHTML = renderMarkdown(context.content || '');
    container.appendChild(this.el);
  }

  getContent(): string | undefined {
    return undefined; // Read-only — no editable content
  }

  isDirty(): boolean {
    return false; // Never dirty
  }

  setContent(content: string, _mtime: string): void {
    this.el.innerHTML = renderMarkdown(content);
  }

  focus(): void {
    this.el.focus();
  }

  dispose(): void {
    this.el.remove();
  }
}
```

### Step 3: Register

In `app.ts` (or an extension entry point):

```typescript
import { paneRegistry } from './panes/index.js';
import { markdownPreviewExtension } from './my-panes/markdown-preview.js';

paneRegistry.register(markdownPreviewExtension);
```

## Creating a dock pane

Dock panes appear in the persistent bottom panel (e.g., terminal). They are
mounted once and toggled visible/hidden — they survive tab switches.

```typescript
export const myDockExtension: WebPaneExtension = {
  id: 'my-dock',
  label: 'My Tool',
  capabilities: ['readonly'],
  placement: 'dock',
  // No canHandle needed for dock panes

  mount(container, context) {
    // Build your UI, attach to container
    // Return a PaneInstance
  },
};
```

## Priority and routing

When a file is opened, the registry calls `canHandle(context)` on every
registered `placement: "tabs"` pane:

- `false` or `0` → skip this pane
- `true` → priority 0 (default)
- `number > 0` → that priority value

The pane with the highest priority wins. The built-in editor returns `1`
(lowest), so any specialized viewer that returns `≥ 2` will take precedence.

If `canHandle()` throws, the exception is caught and the pane is skipped.
If `resolve()` returns no match, the host falls back to the built-in editor.

## Preview affordance guidance

Specialized preview panes in the workspace explorer should keep their
preview-card affordances intentional and narrow:

- **Draw.io** → `Edit in Tab` because the promoted destination is an editor
- **Office / CSV / PDF / Image** → `Open in Tab` because the promoted destination is a dedicated viewer tab
- **Generic workspace preview** → keep using the explorer-header editor action rather than duplicating pane-specific CTA chrome inside the preview body

Avoid inventing pane-specific “open elsewhere” routes unless the destination is
materially different from the normal tab-opening path.

## Host ↔ Pane communication

| Direction | Method | When |
|---|---|---|
| Host → Pane | `setContent(content, mtime)` | File reloaded from disk |
| Host → Pane | `focus()` | Tab activated |
| Host → Pane | `resize()` | Container resized (splitter drag) |
| Pane → Host | `onDirtyChange(cb)` | Pane dirty state changed |
| Pane → Host | `onSaveRequest(cb)` | User pressed Cmd+S |
| Pane → Host | `onClose(cb)` | Pane requests close |

## Lifecycle

1. User opens a file → `paneRegistry.resolve(context)` finds best pane
2. Host creates container element → calls `pane.mount(container, context)`
3. Pane renders into container, returns `PaneInstance`
4. User edits → pane calls `onDirtyChange(true)` → tab shows dirty dot
5. User saves → pane calls `onSaveRequest(content)` → host writes file
6. Tab closed → host calls `instance.dispose()` → pane cleans up

## Manual test notes

### Pane disposal
Verify no leaked listeners or DOM nodes after pane lifecycle:

1. Open a file tab → tab appears, editor mounts
2. Close the tab → verify no orphaned DOM in `.editor-pane-container`
3. Open 5 files, close all → verify memory (DevTools → Heap snapshot)
4. Open a file, switch tabs 10× → verify no accumulated event listeners
   (DevTools → Performance monitor → Event Listeners count)
5. Toggle dock open/close 10× → verify no DOM leaks

### Dock splitter
1. Open dock (Ctrl+`) → drag splitter up and down
2. Verify height persists after page reload
3. Test on iPad: touch-drag the splitter
4. Verify editor and dock both re-layout smoothly

## Built-in panes

| ID | Placement | Priority | Location | Description |
|---|---|---|---|---|
| `editor` | tabs | 1 | `runtime/extensions/viewers/editor/editor-extension.ts` | CodeMirror 6 editor — handles all text files (fallback). Lazy-loaded as `editor.bundle.js` (~1.57 MB). |
| `office-viewer` | tabs | 10 | `runtime/web/src/panes/office-viewer-pane.ts` | Built-in JS viewer (`/office-viewer/*`) for `.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods`, `.odp` with zoom/fit/search and format-specific controls; workspace preview promotes via **Open in Tab**. |
| `csv-viewer` | tabs | 10 | `runtime/web/src/panes/csv-viewer-pane.ts` | Lightweight table viewer for `.csv` and `.tsv` files; workspace preview promotes via **Open in Tab**. |
| `pdf-viewer` | tabs | 10 | `runtime/web/src/panes/pdf-viewer-pane.ts` | Inline PDF viewer for `.pdf` files; workspace preview promotes via **Open in Tab**. |
| `image-viewer` | tabs | 10 | `runtime/web/src/panes/image-viewer-pane.ts` | Inline image viewer with zoom for common image formats; workspace preview promotes via **Open in Tab**. |
| `workspace-preview` | tabs | — | `runtime/web/src/panes/workspace-preview-pane.ts` | Default workspace preview surface for the explorer sidebar; generic text previews rely on the explorer header's editor action instead of pane-body CTA duplication. |
| `terminal` | dock | — | `runtime/web/src/panes/terminal-pane.ts` | Terminal dock pane. Enabled by default on Linux/macOS; controlled by `PICLAW_WEB_TERMINAL_ENABLED`. |
| `terminal-tab` | tabs | 10_000 | `runtime/web/src/panes/terminal-pane.ts` | Same terminal implementation opened by explicit path `piclaw://terminal` from the pane registry. |
| `vnc-viewer` | tabs | 9_000 | `runtime/web/src/panes/vnc-pane.ts` | VNC viewer tab (`piclaw://vnc`, optional `/target`) with allowlist and direct-connect mode enabled by default on Linux/macOS/Windows. |

### Editor extension architecture

The editor lives in `runtime/extensions/viewers/editor/` as a self-contained pane extension:

```
runtime/extensions/viewers/editor/
  editor-extension.ts       — StandaloneEditorInstance + WebPaneExtension registration
  vendor/
    codemirror-entry.ts     — CodeMirror re-export entry point
    codemirror.js           — Pre-built CodeMirror vendor bundle
```

The core app only includes a lightweight **lazy proxy** (`runtime/web/src/panes/editor-loader.ts`)
that shows a loading spinner and dynamically imports `editor.bundle.js` on first mount.
This keeps the editor isolated from the main app bundle; the current built sizes are roughly ~1.24 MB for `app.bundle.js` and ~1.57 MB for `editor.bundle.js`.
