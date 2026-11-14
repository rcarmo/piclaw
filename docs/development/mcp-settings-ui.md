# MCP settings pane

Current native hosts retain the existing read/preview pane, with Apply disabled by backend capability fields and observed policy unknown. Startup-owned native MCP contexts cannot be reconfigured through a legacy session-pool shutdown. See [native host composition](native-host-composition.md). The earlier Apply/browser receipts below concern the explicit historical session-owner boundary; they do not enable native live Apply.

Classic Settings includes an MCP pane backed by the owner-only [settings API](mcp-settings-api.md). It previews engine/codemode compatibility and applies adapter codemode changes to current and new sessions. Engine replacement remains blocked, with the exact 1.0.1 public-contract gaps and closure blocker listed for Native.

The web UI uses one request/state controller and the Preact renderer. Initial load and Refresh use GET; Preview sends only the selected engine/codemode. Changing a selector sends nothing until Preview is pressed. Apply requires a fresh compatible preview and an explicit acknowledgement that turns across all chats may be interrupted. Changing a selector clears that acknowledgement. The pane separates persisted and observed policy; native projection and unknown connection status are not connection health.

## Request lifecycle and safety

- Each request has a generation and abort controller. Changing a selection, starting another request or unmounting cancels the previous request and rejects its late result even if the transport ignores abort.
- Refresh clears the previous server snapshot while loading. It cannot leave old data looking freshly loaded after a selection cancels the refresh.
- Partial selection updates merge against controller state, avoiding stale render closures when events arrive in one task.
- Preview responses must echo the requested policy. Malformed results and owner denials clear retained server data.
- Active Apply cannot overlap Refresh, Preview or selection changes. Its request sends only the policy, opaque revision and interruption acknowledgement. Success requires both persisted and observed policy to match the draft; errors/ambiguous outcomes ask for a refresh and never claim rollback.
- Unexpected transport/JSON errors use fixed UI text. Server strings render as escaped text, never HTML.
- No auth material, server config or fallback engine is introduced. The backend remains the authority; the pane itself grants no access.

Shared theme-compatible CSS constrains controls and long names, with 44-pixel controls below 600px. The pane uses existing Classic styles. The core MCP nav label is registered in each supported Classic locale; the pane's English copy follows existing core settings conventions.

## Validation and profiling

> Historical qualification of the original delivery. Visual was later retired in #1990.


Controller tests exercise preview-only requests, stale responses, refresh/selection ordering, rapid partial selections, malformed state, denied access and disposal. Registration tests cover both actual shells and the shared controller. Chromium and WebKit cases at 1280px and 390px use real renderer code, compiled skin styles and the real read/preview handler behind a synthetic local principal. They check unchanged config, no Apply/Save, hostile/long server names, stale-response suppression, refresh clearing, owner revocation and responsive controls. Two additional Chromium cases navigate through the actual Classic and Visual settings shells and verify a new GET after remount.

Final browser matrix: 10 tests / 270 assertions. Controller/registration/order tests: 12 tests / 71 assertions. All five existing typecheck stages passed with the unchanged 95-diagnostic compose baseline; explicit strict checking of the new Visual component/controller and scoped lint passed.

The [browser receipt](receipts/mcp-settings-ui-browser.json) records single-run load-to-ready timings, request counts and Chromium CPU samples/script/layout/style/heap metrics. WebKit CPU sampling is not claimed. Each functional matrix case made five API requests and two previews; there is no polling loop or request on each selector change. These are small synthetic fixtures, not comparative performance benchmarks or a complete authenticated host test. Profiling does not imply live-server connection or production adoption.

## Frozen candidate gate

Frozen tree `b8899a8de25a938c5d148ef8a3cf2658f16962ee` passed `make ci-fast` on 3 October 2026: 6,010 runtime tests, eight existing skips, zero failures; 25 feature tests, nine web checks, and the separate historical 0.99.1 replay of 468 tests / 8,720 assertions. The rebuilt browser matrix passed again (10 tests / 270 assertions); five typechecks, scoped lint, pack hygiene (24,750 files) and stale-dist passed. A second independent source review found no blocker. Rebuilt Classic/Visual assets are included; no production install or restart was performed.

Full log: `/workspace/tmp/mcp-settings-ui-100/ci-fast.log`, SHA-256 `d74673fbbd916c52fd61e295b34354cc84a125d99909715ca1cfacc132c854e3`. Only this validation prose changed after the frozen gate.

## Retained failures and limits

An initial controller test exposed raw JSON parse text in UI errors; fixed generic unexpected-error handling replaced it. Review found the stale-refresh snapshot issue and incomplete payload validation; both were corrected with regressions. Browser setup initially exceeded the default five-second hook limit; it now has an explicit 30-second setup allowance. Full-shell fixture tests used a wrong Classic open-state flag and an incorrect Visual accessible-name assumption; correcting those fixtures made both pass. No functional assertion was weakened. Esbuild reports the pre-existing shared passkey JSX annotation warning when bundling the whole settings shells.

Both panes now include an adapter server editor for transport, authentication references, exposure, lifecycle and timeout patches, with separate Preview and acknowledged Apply. Forms use the direct server API and clear stale previews on every edit. Server Apply and codemode Apply disable the other pane's controls. Owner/policy denial unmounts the editor and discards its private snapshot. An effective safe preview is shown before Apply; withheld fields stay private. Removing a local override warns that an inherited definition may return. Native engine replacement is still unavailable.

Adapter codemode changes retain the existing MCP owner without reloading transports; server changes require acknowledged extension reload. The earlier frozen-gate/profile counts above are historical preview-slice evidence. The [server qualification](../reviews/mcp-adapter-server-settings.md) records the expanded current browser/runtime matrix. No native-auth gap or capability waiver is inferred.
