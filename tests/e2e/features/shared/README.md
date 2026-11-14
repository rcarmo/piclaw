# Shared implemented UX contracts

Import `tests/e2e/features/shared/**/*.feature` together with the Classic root. Shared scenarios have one stable ID in Classic. This root contains eight SVG scenarios/outlines and nineteen example rows.

[SVG images](svg-images.feature) are implemented by the same browser helper in the renderer. `runtime/test/web/svg-images.optional.test.ts` exercises production rendering and copy handlers in Chromium and WebKit; CI runs both. [Evidence and coverage](../canonical/audit/svg-images.md) map scenarios to direct assertions. Gherkin import still requires step bindings; source parsing alone is not implementation evidence.

## SVG subset and limits

- Complete top-level backtick or tilde fences labelled `svg` (case-insensitive). Raw markup, other fences, nested quoted/list fences and uploaded attachments keep their existing paths.
- Maximum 262,144 UTF-8 source bytes before XML parsing; 2,048 original XML nodes including text/comments; 32 element levels including the root. Structural validation stops at the first violation. Parsing itself is bounded by source bytes.
- Geometry, groups, text/tspan, titles/descriptions, gradients and local clip paths are allowlisted. Unknown elements reject the document. Scripts, embedded HTML, image/use trees, filters, animation, processing instructions and DOCTYPE/entity declarations are unsupported and fall back to source.
- Presentation attributes use small value grammars. No event/style/href or foreign-namespace attributes. Fragment paints must target local gradients, clip paths must target local clipPath elements; references inside definitions are removed to prevent reference cycles.
- Omitted root `xmlns` is normalised to SVG. Explicit empty/wrong namespaces, mixed namespaces and prefixed elements reject.
- Output dimensions are capped at 2,048 pixels per axis, preserving aspect ratio. Native `img` isolation prevents model SVG access to the page DOM; model SVG nodes are never inserted into it.
- Original source is readable in an expandable disclosure and copyable after rendering. Fallback is readable/copyable inert code, including incomplete/oversized/rejected input. Names use title/description text or `Model-generated SVG`.
- An eight-entry cache holds at most 2 MiB of estimated UTF-16 strings (input plus result). No DOM nodes are cached. Repeated unchanged valid/invalid SVG avoids XML parsing; large entries evict old entries. Ordinary messages take a fast path.

Source-only tests from #1324 are replaced by desired rendering tests. No server process, network service or new runtime dependency performs validation.

## Theme palettes

`theme-palettes.feature` defines six shared palette/mode/Monokai/glow/import/terminal
scenarios. Executable coverage is in `runtime/test/web/shared-themes.test.ts` and
`runtime/test/web/shared-themes.playwright.optional.test.ts`; the latter mounts
actual Appearance components and xterm against disposable fixture APIs/sockets.
These scenarios do not change a live instance theme.
