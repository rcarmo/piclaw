# Extension UI contract

This document defines the supported extension UI surfaces in Piclaw's web app.

Piclaw supports four extension UI surfaces:

1. **Pane extensions** are the first-class host for substantial tool or file UI.
2. **Adaptive Cards and normal timeline messages** are preferred for structured conversation UI that belongs in chat history.
3. **Add-on settings panes** use the direct backend add-on config API.
4. **`extension_ui_*` events** remain a low-level compatibility bridge for lightweight browser-session integrations; they are not a full plugin UI framework.

## The supported surfaces

| UI need | Preferred surface | Why |
|---|---|---|
| File editors, viewers, dashboards, tool panes, persistent chrome-adjacent UI | **Web pane extension** | First-class host model with tabs/dock lifecycle |
| Structured chat decisions, approvals, forms, receipts | **Adaptive Cards / timeline messages** | Persisted, agent-owned, reconnect-safe, visible in history |
| Add-on settings inside **Settings** | **Add-on web settings pane + direct backend config API** | Browser-side pane with explicit local config transport |
| Lightweight web-only signals for an already-open browser session | **`extension_ui_*` bridge** | Minimal compatibility path for browser event consumers |

## First-class host: pane extensions

Piclaw already ships a first-class content host for substantial extension UI:

- `WebPaneExtension`
- `PaneRegistry`
- tab placement
- dock placement
- built-in pane implementations (editor, terminal, draw.io, office/pdf/image/csv viewers, workspace preview)

If an extension needs a real surface with mounting, focus, resize, disposal, and routing, it should use a pane extension.

See [web-pane-extensions.md](web-pane-extensions.md) for the pane contract.

## Structured conversation UI: Adaptive Cards and timeline messages

If the interaction should be visible in conversation history, survive reconnects, or be attributable to the agent/user, prefer timeline-native UI:

- normal messages
- attachments
- Adaptive Cards
- persisted Adaptive Card submission receipts

This is the preferred path for:

- approvals/choices that belong in the chat history
- read-only receipts or structured results
- workflows that should still make sense after reload/reconnect

## Settings panes are their own surface

Add-on settings panes are **not** part of the `extension_ui_*` bridge.

They are browser-side modules loaded from installed add-on `pi.web.entries`, and they should communicate with the runtime through the authenticated local add-on config API:

- `GET /agent/addons/api/<addon>/config`
- `POST /agent/addons/api/<addon>/config`
- optional add-on-specific actions like `GET /agent/addons/api/<addon>/browser-config`
- `GET` / `POST /agent/keychain` for secrets that belong in the keychain

Runtime add-on modules register those handlers via `globalThis.__piclaw_registerAddonConfigApi(...)`.

Do **not** treat add-on settings panes as slash-command clients. The slash-command bridge remains only as a legacy fallback for older add-ons.

### Settings buttons

Classic and Visual apply host-owned button styles inside registered add-on
panes. Classic matches General's **Widget bearer token → Regenerate** button;
Visual uses its own shared defaults. Plain `<button>` elements need no class.
The host normalises typography, padding, borders, colours, hover, keyboard focus and disabled states,
including older add-ons with inline button styles. Pane layout and event handlers
remain add-on-owned; controls outside Settings are unaffected.

Use `data-settings-button="primary"` for a primary action, `"danger"` for a
destructive action, or `"icon"` for a compact icon button with an accessible label.
The existing `primary` and `danger` classes also work. Native `disabled` prevents
activation; `aria-disabled="true"` only supplies the visual state, so add-ons using
it must also block the action in their handler.

Tabs, switches and the host's number-stepper controls retain their geometry.
Use `data-settings-button="unstyled"` only for a custom composite control that
provides its own styling and keyboard focus indication.

## Low-level bridge: `extension_ui_*`

The web runtime forwards `extension_ui_*` SSE events into browser events for the current chat.

Browser events are dispatched as:

- `piclaw-extension-ui`
- `piclaw-extension-ui:<suffix>`

Examples:

- `extension_ui_notify` → `piclaw-extension-ui:notify`
- `extension_ui_status` → `piclaw-extension-ui:status`
- `extension_ui_editor_text` → `piclaw-extension-ui:editor-text`

### Native runtime ownership

`WebSessionBroadcastService` owns SSE fanout, chat-scoped `UiBridge` requests and provider-usage refresh notifications. Native agent/tool status uses runtime watch projections; history actions use native control routes.

`UiBridge` retains workspace-file requests, browser acknowledgements, 15-second request expiry and shutdown rejection. Completed requests leave no per-chat adapter state. SSE construction performs no legacy session lookup or binder installation.

The earlier retention of `UiBridge.createUiContext` and `channels/web/ui-context.ts` is superseded by the durable-convergence retirement under #1824. The unused Core `ExtensionUIContext` constructor, fallback Theme, editor/theme caches, cache TTL and synchronous theme writer are removed without a compatibility shim. Theme commands/settings keep their admitted HTTP paths; native browser tools use their existing opener/widget ports. Add-on-owned `ctx.ui` APIs, SSE names and browser rendering are unchanged.

The private `agent-pool-binder.ts` helper, `UiBridge.bindSession`, `bindSessionUiContext` wrapper and `bindSessionBinder` construction option are retired. Their session-bound `waitForIdle`, `newSession`, `fork`, `navigateTree`, `switchSession` and `reload` callbacks are removed. No identified repository or supported add-on consumer requires a compatibility shim.

The separate AgentPool/session-manager binder still exists for the composition cleanup tracked by #1672. Native SSE does not install it. Transport, browser controls and event rendering are unchanged; no persisted data or configuration is migrated.

### Important non-goal

This bridge is **not** currently a general-purpose extension-host framework.

Piclaw does **not** promise that every `extension_ui_*` event automatically gets a first-class built-in shell renderer. In most cases, the shell simply:

1. delivers the event to the current chat's browser session, and
2. re-dispatches it as a browser event.

Extension authors should treat the bridge as a **transport + lightweight affordance layer**, not as a promise of rich shell UI.

## Event classification

| Event | Contract class | Shell-visible effect | Guidance |
|---|---|---|---|
| `extension_ui_request` | Supported public bridge event | No built-in generic renderer today | Use only when your browser-side integration is prepared to render/respond |
| `extension_ui_timeout` | Supported public bridge event | No shell UI guarantee | Treat as lifecycle signal for request UIs |
| `extension_ui_status` | Supported public bridge event | No built-in shell panel today | Suitable for lightweight status syncing to extension-owned browser UI |
| `extension_ui_working` | Supported public bridge event | Working message shown in compose strip | Use for transient progress text; cleared automatically on turn end |
| `extension_ui_working_indicator` | Supported public bridge event **plus** shell-owned affordance | Yes — animated spinner/glyph in compose strip | Use `ctx.ui.setWorkingIndicator()` from extension API; supports default/hidden/custom-frame modes; cleared on turn done, error, and chat switch |
| `extension_ui_widget` | Supported public bridge event | No built-in shell slot today | Suitable only for extension-owned browser listeners/widgets |
| `extension_ui_title` | Supported public bridge event | No shell title integration today | Use only for extension-owned browser UI |
| `extension_ui_editor_text` | Supported public bridge event | No shell-owned editor contract yet | Do not assume a generic editor/compose insertion target exists |
| `extension_ui_notify` | Supported bridge event **plus** shell-owned affordance | Yes — toast/intent surface | Good for lightweight notifications; browser event is still emitted too |
| `extension_ui_error` | Supported bridge event **plus** shell-owned affordance | Yes — error toast/intent surface | Use for user-visible extension failures; browser event is still emitted too |

## What extensions should prefer

| Scenario | Recommended surface |
|---|---|
| Open a custom viewer/editor/tool | Pane extension |
| Need a long-lived panel or dock | Pane extension |
| Need a structured yes/no/choice form in chat history | Adaptive Card |
| Need a compact success/failure/result message in history | Normal timeline message or Adaptive Card receipt |
| Need a transient browser-only notification | `extension_ui_notify` |
| Need browser-only status updates for custom JS UI | `extension_ui_status` / `extension_ui_working` |
| Need a bespoke browser-side request/response UI | `extension_ui_request` with your own browser listener |

## Right-edge docking

Classic reads `--piclaw-shell-inset-right` from `:root` and shrinks its shell by that amount. A browser add-on that docks a fixed panel or edge tab on the right can set the variable so the panel does not cover the workspace:

```js
document.documentElement.style.setProperty('--piclaw-shell-inset-right', `${panelWidth + tabWidth}px`);
```

Set it only for desktop layouts (`(min-width: 1024px) and (orientation: landscape)`), and set it to `0px` when the panel overlays on smaller screens. Pane sizes are clamped to the remaining shell width. The plan sidebar add-on uses this to dock as a column.

## Current non-goals / unsupported assumptions

Extension authors should **not** assume Piclaw currently provides:

- a generic plugin modal framework
- arbitrary shell slot mounting outside the pane host
- guaranteed compose/editor insertion semantics from `extension_ui_editor_text`
- a stable built-in renderer for `extension_ui_widget`
- a durable/persisted history model for arbitrary `extension_ui_*` events

If the interaction needs those properties, prefer a pane extension or timeline-native UI instead.

## Practical guidance

Use this decision order:

1. **Should this live in history?**
   - Yes → timeline message / Adaptive Card.
2. **Is this an add-on settings surface inside Settings?**
   - Yes → add-on web settings pane + direct backend config API.
3. **Does this need a persistent mounted UI surface?**
   - Yes → pane extension.
4. **Is this just a lightweight signal to an already-open browser session?**
   - Yes → `extension_ui_*` bridge.

## Related files

- `runtime/src/channels/web/theming/ui-bridge.ts`
- `runtime/src/channels/web/sse/sse.ts`
- `runtime/web/src/ui/extension-ui-events.ts`
- `runtime/web/src/app.ts`
- `runtime/src/channels/web/handlers/addon-config-api.ts`
- `runtime/src/channels/web/handlers/addons.ts`
- `docs/settings-and-addons.md`
- `docs/web-pane-extensions.md`
