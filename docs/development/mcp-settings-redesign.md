# MCP Settings redesign

The MCP pane uses the existing Settings list/detail, grouped-form and explicit-action patterns. MCP capabilities, endpoints, storage, authentication and runtime controllers are unchanged.

## Scope

- Make server configuration the main task; separate instance-wide runtime policy below it.
- Show configuration state, provenance and private-field preservation without implying live connectivity.
- Group connection, authentication, tools/resources and advanced options.
- Use labelled choices for authentication, availability, lifecycle, HTTP transport, resources and prefixes. Keep structured arrays/maps in labelled textareas with examples and local validation.
- Support generic remote HTTP servers with bearer credentials referenced through keychain or environment, custom header references, resource exposure and proxy/direct-tool settings. Do not add server-specific integrations or presets.
- Retain local process/socket configuration and the existing search preset.

## Editing contracts

- Safe current values are read-only context, not an automatically resubmitted draft. Only entered fields become a patch.
- Empty leaves the existing value unchanged; explicit `null` removes a local value and may reveal inherited configuration. Timeout fields remain text with a numeric input hint so `null` is still representable.
- Existing names are read-only; New server uses the existing explicit create action and collision protection. Selecting a saved server returns to update intent.
- Secret/private/advanced source values remain withheld. No token entry, secret retrieval or keychain mutation is added.
- Edits invalidate previews and acknowledgements. Apply still requires a fresh compatible preview and an explicit interruption acknowledgement, with the existing revision fence and uncertain-outcome handling.
- Refresh clears the affected controller’s retained payload while loading. Owner-denial responses clear that controller’s rendered configuration. Refresh/new selection and successful application clear the local editor state.

## Acceptance checks

- All 21 supported fields remain available; blank/null and friendly choice values round-trip through the unchanged parser.
- HTTP bearer setup works using generic endpoint and reference names, without automatic preview or application.
- Inherited/private configuration is not echoed into editable values or unrelated patches.
- Invalid structured input is identified with `aria-invalid` and linked explanatory text, blocks preview, and does not send a request.
- Desktop and 320px layouts fit the viewport. Light/dark palettes use Settings tokens; visible controls retain 36px desktop and 44px phone targets, focus indication and native keyboard behaviour.
- Existing real-backend tests retain Native rejection, owner denial, preview cancellation, interruption order, private-field preservation, create collisions, disable/remove and persisted-result checks.

## Evidence

- Eight initial layout regressions failed before implementation.
- 19 Chromium/WebKit browser cases pass, including the existing real-backend suites and new light/dark, narrow/wide, generic HTTP bearer and accessible-error coverage.
- 95 focused model, API, secure-writer, form and retained-file tests pass.
- Web build (17 build/link-preview checks), configured typecheck, stale-dist, hook-TDZ, cycles, environment surface and local-test-entrypoint checks pass. Lint/unused diagnostics match the recorded unchanged baseline.
- The configured compose type gate still accepts 291 pre-existing out-of-seam diagnostics; raw frontend compilation is not clean.
- The richer editor adds 9,817 raw and 2,510 gzip bytes over 78d7852f2. Bundle bounds account for that measured feature footprint while retaining the previous approximate headroom; no functional assertion or test deadline is weakened.
- Actual Settings-tab screenshots were inspected at 390px/1440px in light/dark mode with synthetic configuration only.
- This is focused UI qualification, not a complete new host/native gate or physical iOS keyboard qualification. No live configuration, installation, deployment or restart was performed.
