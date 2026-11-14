# SVG light/dark defaults and palette alignment

SVG fence previews now use the selected palette for unstyled fills and `currentColor`. Explicit source paints remain unchanged. Each preview has a **Theme / Light / Dark** background selector, so a fixed-colour diagram can be viewed on a suitable surface.

## Fenced SVG

The sanitizer still produces an isolated `data:image/svg+xml` image. Missing root `color` uses the palette foreground; missing root `fill` becomes `currentColor`. Authored root/element colours, `fill="none"`, gradients and clipping retain their semantics. The renderer does not invert images or replace explicit black/white paints.

Presentation attributes `fill`, `stroke`, `color` and `stop-color` may use these exact theme tokens:

- `var(--svg-background)` and `var(--svg-foreground)`
- `var(--svg-muted)`, `var(--svg-accent)`, `var(--svg-border)` and `var(--svg-surface)`
- `var(--svg-success)`, `var(--svg-warning)` and `var(--svg-danger)`

The host resolves these finite tokens to computed colours before serialization. Arbitrary variables, fallbacks, stylesheet rules and external URLs remain unsupported. This does not allow `<style>`, event handlers, scripts, `foreignObject` or remote images through the sanitizer. Existing byte/node/depth/dimension limits are unchanged.

Theme changes update mounted image URLs from the original source. Theme-aware cache keys prevent stale palette results; the cache stays bounded to eight entries/two MiB. Fixed Light/Dark selections remain fixed when the application theme changes. Original source and copy output are unchanged. The selection is local to the rendered preview and resets when that message view is recreated.

With `sanitizeSvgFences:false`, trusted inline source keeps its existing behavior and receives no host preview controls or source rewriting. Inline source remains responsible for its own styling and safety.

## Mermaid

The renderer passes host CSS variables to the vendored renderer: foreground, background, accent, muted text, panel and border. Existing rendered SVG follows palette changes through CSS variables without layout regeneration.

The renderer uses the system UI font. Generated Google Fonts `@import` statements are removed before insertion; tests enforce no external requests. Existing Mermaid sanitization and scoped-resource restrictions are retained.

## Workspace image viewer

The authenticated image viewer follows its same-origin parent's palette for page/toolbar chrome and default image surface. Standalone viewing uses OS light/dark defaults. Its toolbar offers **Theme / Light / Dark / Transparent**, remains available on keyboard focus and touch, and retains zoom controls.

The workspace SVG file is loaded once as an image from the existing authenticated raw route. Its bytes are not rewritten or recoloured. The embedded SVG can still use its own authored CSS and media rules; page CSS cannot inject palette tokens into that separate document. The viewer CSP and same-origin framing restriction are unchanged.

## Historical verification

The counts below describe the original delivery. The second UI and its custom-theme importer have since been removed; Classic rendering, copying, palette and safety cases remain.

- Nineteen SVG cases pass in each of Chromium and WebKit: **38 passes / 502 assertions**. They cover both production Markdown renderers/copy handlers, all 56 palettes, explicit paints, finite tokens, fixed surfaces, imported palette values, exact source/CRLF copying, real Mermaid output and teardown.
- Pixel reads from decoded SVG images verify unstyled/current palette colours, unchanged authored orange, AS/400 green-only defaults and imported accent RGB values.
- Existing hazardous SVG, duplicate ID, namespace, malformed XML, reference, byte/node/depth/dimension and bounded-cache checks remain green. No unexpected requests, dialogs or navigation occur.
- Two workspace-viewer cases pass / 28 assertions, checking palette/mode changes despite opposing OS preference, unchanged raw URL/one image request, surface choices, keyboard toolbar access, zoom and CSP headers.
- Final full `make ci-fast`: **5,521 runtime passes**, 4 skips, zero failures; 25 feature tests and 9 build tests. Four typechecks, scoped lint, packaging hygiene, stale-bundle and environment-surface checks pass. Final browser reruns reproduce all 40 passes / 530 assertions.
- Local browser fixtures contain only synthetic source and do not access the live instance. No independent review is claimed.

## Limits

An explicitly authored black diagram may still need the Light surface; guessing which authored colours to replace would alter its meaning. Generic SVG attachments outside this fenced-preview/workspace-viewer path are unchanged. External SVG stylesheets are not accepted by the fenced sanitizer. Colour-scheme behavior inside arbitrary SVG images remains browser-controlled.

No installation or reload is included. The separately approved compose/pin PRs #1366/#1368 were merged before this branch; this SVG correction requires its own merge approval.
